import {
  HttpErrorResponse,
  HttpParams,
  provideHttpClient,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DatatugApiService } from '../services/base/datatug-api.service';
import { of, throwError } from 'rxjs';
import { SessionContextApiService } from './session-context-api.service';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import {
  ContextCapabilities,
  ContextCommand,
  ContextReceipt,
} from './session-context-contract';
import { datatugApiRealProviders, expectDatatugApiRequest } from '../services/base/datatug-api.test-helpers';


const localProject = { storeId: 'http-localhost:8989', projectId: 'chinook' };
const capabilities: ContextCapabilities = {
  schemaVersion: 1,
  actorId: 'local-principal',
  databaseId: 'ops-db',
  projectId: 'chinook',
  environments: [],
  actions: ['createSession'],
};
const command: ContextCommand = {
  opId: 'op_123',
  action: 'createSession',
  sessionId: 'session_123',
  bagId: 'bag_123',
  title: 'Imported context',
  scope: { environmentId: 'local', identityDomain: 'chinook-local' },
};
const receipt: ContextReceipt = {
  opId: command.opId,
  actor: 'actor',
  action: command.action,
  payloadDigest: 'digest',
  sessionId: command.sessionId,
  sessionVersion: 1,
  at: '2026-10-13T00:00:00.000Z',
};

describe('SessionContextApiService command wire boundary', () => {
  it.each(['createSession', 'createBag', 'importLegacy'] as const)('projects capability metadata out of %s scope on the wire', async (action) => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), SessionContextApiService] });
    const service = TestBed.inject(SessionContextApiService);
    const http = TestBed.inject(HttpTestingController);
    const scope = { environmentId: 'local', identityDomain: 'chinook-local', title: 'Chinook invoices', querySources: [{ kind: 'public-sqlite', connectionId: 'chinook-sqlite' }] };
    const enriched: ContextCommand = { ...command, action, scope, ...(action === 'importLegacy' ? { legacyImport: { sourceId: 'legacy_0123456789abcdef', scope, entries: [], messages: [] } } : {}) };
    const pending = service.command(localProject, capabilities, enriched);
    const request = http.expectOne(candidate => candidate.url.endsWith('/session-context/commands'));
    const expectedScope = { environmentId: 'local', identityDomain: 'chinook-local' };
    expect(action === 'importLegacy' ? request.request.body.legacyImport.scope : request.request.body.scope).toEqual(expectedScope);
    expect(scope.title).toBe('Chinook invoices');
    expect(scope.querySources).toHaveLength(1);
    request.flush({ receipt: { ...receipt, action } });
    await pending;
    http.verify();
  });

  it('sends local selector and database identity only as query parameters', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        SessionContextApiService,
      ],
    });
    const service = TestBed.inject(SessionContextApiService);
    const http = TestBed.inject(HttpTestingController);
    const pending = service.command(localProject, capabilities, command);
    const request = http.expectOne((candidate) =>
      candidate.url.endsWith('/session-context/commands'),
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      ...command,
      databaseId: 'ops-db',
      projectId: 'chinook',
    });
    expect(request.request.body).not.toHaveProperty('storage');
    expect(request.request.params.get('storage')).toBe('local');
    expect(request.request.params.get('project')).toBe('chinook');
    expect(request.request.params.get('databaseId')).toBe('ops-db');
    expect(request.request.params.get('projectId')).toBe('chinook');
    request.flush({ receipt });
    await expect(pending).resolves.toEqual(receipt);
    http.verify();
  });

  it('uses hosted API query options and keeps the strict command body selector-free', async () => {
    const post = vi.fn(() => of({ receipt }));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        SessionContextApiService,
        { provide: DatatugApiService, useValue: { post } },
      ],
    });
    const service = TestBed.inject(SessionContextApiService);
    await expect(
      service.command(
        { storeId: 'firestore', projectId: 'chinook', spaceID: 'space_1' },
        capabilities,
        command,
      ),
    ).resolves.toEqual(receipt);
    expect(post).toHaveBeenCalledOnce();
    const [endpoint, body, options] = post.mock.calls[0] as unknown as [
      string,
      ContextCommand,
      { params: HttpParams },
    ];
    expect(endpoint).toBe('datatug/session-context/commands');
    expect(body).toEqual({
      ...command,
      databaseId: 'ops-db',
      projectId: 'chinook',
    });
    expect(body).not.toHaveProperty('storage');
    expect(body).not.toHaveProperty('spaceID');
    expect(options.params.get('storage')).toBe('firestore');
    expect(options.params.get('spaceID')).toBe('space_1');
    expect(options.params.get('project')).toBe('chinook');
    expect(options.params.get('databaseId')).toBe('ops-db');
    expect(options.params.get('projectId')).toBe('chinook');
  });

  it('imports legacy records with selectors in query and only the command binding in the body', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        SessionContextApiService,
      ],
    });
    const service = TestBed.inject(SessionContextApiService);
    const http = TestBed.inject(HttpTestingController);
    const importCommand: ContextCommand = {
      opId: 'op_import',
      action: 'importLegacy',
      sessionId: '',
      scope: { environmentId: 'local', identityDomain: 'local-actor' },
      legacyImport: {
        sourceId: 'legacy_0123456789abcdef',
        scope: { environmentId: 'local', identityDomain: 'local-actor' },
        entries: [],
        messages: [
          { id: 'legacy-chat-1', role: 'user', text: 'Find invoice 1' },
        ],
      },
    };
    const expected: ContextReceipt = {
      ...receipt,
      opId: importCommand.opId,
      action: 'importLegacy',
      sessionId: 'session_imported',
    };
    const pending = service.command(localProject, capabilities, importCommand);
    const request = http.expectOne((candidate) =>
      candidate.url.endsWith('/session-context/commands'),
    );
    expect(request.request.body).toEqual({
      opId: 'op_import',
      action: 'importLegacy',
      legacyImport: importCommand.legacyImport,
      databaseId: 'ops-db',
      projectId: 'chinook',
    });
    expect(request.request.body).not.toHaveProperty('sessionId');
    expect(request.request.body).not.toHaveProperty('scope');
    expect(request.request.params.get('storage')).toBe('local');
    expect(request.request.params.get('databaseId')).toBe('ops-db');
    expect(request.request.params.get('projectId')).toBe('chinook');
    request.flush({ receipt: expected });
    await expect(pending).resolves.toEqual(expected);
    http.verify();
  });

  it('reads the operation endpoint bare receipt before recovering an uncertain command', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        SessionContextApiService,
      ],
    });
    const service = TestBed.inject(SessionContextApiService);
    const http = TestBed.inject(HttpTestingController);
    const pending = service.operation(localProject, capabilities, command.opId);
    const request = http.expectOne((candidate) =>
      candidate.url.endsWith(`/session-context/operations/${command.opId}`),
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('databaseId')).toBe('ops-db');
    request.flush(receipt);
    await expect(pending).resolves.toEqual(receipt);
    http.verify();
  });
});

describe('SessionContextApiService GitHub branch admission', () => {
  const github = {
    storeId: 'github.com',
    projectId: 'datatug-demo-project@datatug@demo-project-1',
  };
  function setup(defaultBranch = 'trunk') {
    const get = vi.fn((_path: string, _params: HttpParams) => {
      void _path;
      void _params;
      return of(capabilities);
    });
    const post = vi.fn(
      (_path: string, _body: unknown, _options: { params: HttpParams }) => {
        void _path;
        void _body;
        void _options;
        return of({ receipt });
      },
    );
    const branches = vi.fn(() => of({ branches: [], defaultBranch }));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        SessionContextApiService,
        { provide: DatatugApiService, useValue: { get, post } },
        { provide: ProjectQueryApiService, useValue: { branches } },
      ],
    });
    return {
      service: TestBed.inject(SessionContextApiService),
      get,
      post,
      branches,
    };
  }
  it('resolves a normal HEAD address through authenticated repository metadata and pins it for commands', async () => {
    const { service, get, post, branches } = setup();
    const ref = { ...github };
    await service.capabilities(ref);
    expect(branches).toHaveBeenCalledWith(ref);
    expect(get.mock.calls[0][1].get('branch')).toBe('trunk');
    expect(get.mock.calls[0][1].get('project')).toBe(
      'datatug-demo-project@datatug@demo-project-1',
    );
    branches.mockReturnValue(of({ branches: [], defaultBranch: 'changed' }));
    await service.command(ref, capabilities, command);
    expect(post.mock.calls[0][2].params.get('branch')).toBe('trunk');
    expect(branches).toHaveBeenCalledTimes(1);
    await service.capabilities({ ...github });
    expect(branches).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][1].get('branch')).toBe('changed');
  });
  it.each([
    { ...github, projectId: github.projectId + '@main' },
    { ...github, projectApi: 'cloud' as const, branch: 'main' },
  ])(
    'preserves the explicit branch for reads and commands: %j',
    async (ref) => {
      const { service, get, post, branches } = setup();
      await service.capabilities(ref);
      await service.command(ref, capabilities, command);
      expect(get.mock.calls[0][1].get('branch')).toBe('main');
      expect(post.mock.calls[0][2].params.get('branch')).toBe('main');
      expect(branches).not.toHaveBeenCalled();
    },
  );
  it('rejects conflicting explicit selectors before mutation', async () => {
    const { service, get, post, branches } = setup();
    const ref = {
      ...github,
      projectId: github.projectId + '@main',
      branch: 'other',
    };
    await expect(service.command(ref, capabilities, command)).rejects.toThrow(
      'disagree',
    );
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(branches).not.toHaveBeenCalled();
  });
  it('sanitizes lookup failures and permits a later retry with the same project reference', async () => {
    const { service, branches, get } = setup();
    const ref = { ...github };
    branches.mockReturnValueOnce(
      throwError(() => new Error('private provider diagnostic')),
    );
    await expect(service.capabilities(ref)).rejects.toThrow(
      'The repository default branch could not be resolved. Open this project with an explicit branch.',
    );
    expect(get).not.toHaveBeenCalled();
    await expect(service.capabilities(ref)).resolves.toEqual(capabilities);
    expect(branches).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 503])(
    'retains authoritative admission status %s for workspace handling',
    async (status) => {
      const { service, branches, get, post } = setup();
      const failure = new HttpErrorResponse({ status });
      branches.mockReturnValue(throwError(() => failure));
      await expect(service.capabilities({ ...github })).rejects.toBe(failure);
      await expect(
        service.command({ ...github }, capabilities, command),
      ).rejects.toBe(failure);
      expect(get).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    },
  );
  it.each(['', 'HEAD', ' main', 'bad\nbranch', '@'])(
    'blocks unavailable or invalid defaults before a session request: %j',
    async (branch) => {
      const { service, get, post } = setup(branch);
      await expect(service.capabilities({ ...github })).rejects.toThrow(
        'default branch could not be resolved',
      );
      await expect(
        service.command({ ...github }, capabilities, command),
      ).rejects.toThrow('default branch could not be resolved');
      expect(get).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    },
  );
});

describe('SessionContextApiService DataTug API base URL', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SessionContextApiService, ...datatugApiRealProviders()],
    });
  });

  it('reads cloud capabilities from the DataTug API base URL', () => {
    TestBed.inject(SessionContextApiService)
      .capabilities({ storeId: 'firestore', projectId: 'project_1' })
      .catch(() => undefined);
    expectDatatugApiRequest('GET', 'datatug/session-context/capabilities');
  });
});

describe('Session command native credential cancellation', () => {
  const ref = { storeId: 'firestore', projectId: 'chinook', spaceID: 'space_1' };
  beforeEach(() => TestBed.configureTestingModule({ providers: [SessionContextApiService, ...datatugApiRealProviders()] }));
  it('does not automatically resend the original operation under a replacement credential after401', async () => {
    const { SneatApiAuthTokenBridge } = await import('@sneat/api');
    const bridge = TestBed.inject(SneatApiAuthTokenBridge);
    const http = TestBed.inject(HttpTestingController);
    bridge.setExplicitToken('token-A');
    const pending = TestBed.inject(SessionContextApiService).command(ref, capabilities, command);
    const denied = expect(pending).rejects.toMatchObject({status:401});
    const request = http.expectOne(r=>r.url.endsWith('/session-context/commands'));
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-A');
    bridge.setExplicitToken('token-B');
    request.flush({}, {status:401,statusText:'Unauthorized'});
    await denied;
    http.expectNone(r=>r.url.endsWith('/session-context/commands'));
    http.verify();
  });
  it('cancels an initial native token wait before replacement token dispatch', async () => {
    const { SneatApiAuthTokenBridge } = await import('@sneat/api');
    const bridge = TestBed.inject(SneatApiAuthTokenBridge);
    const http = TestBed.inject(HttpTestingController);
    const readiness = bridge.beginAuthentication();
    let finish: ((token:string)=>void)|undefined;
    readiness.resolveWithTokenResolver(()=>new Promise<string>(resolve=>{finish=resolve;}));
    const lifetime = new AbortController();
    const pending = TestBed.inject(SessionContextApiService).command(ref, capabilities, command, lifetime.signal);
    const cancelled = expect(pending).rejects.toThrow();
    lifetime.abort();
    bridge.setExplicitToken('token-B');
    finish?.('late-token-A');
    await cancelled;
    await Promise.resolve();
    http.expectNone(r=>r.url.endsWith('/session-context/commands'));
    http.verify();
  });
  it('does not dispatch with an already invalidated scope', async () => {
    const lifetime = new AbortController();lifetime.abort();
    await expect(TestBed.inject(SessionContextApiService).command(ref,capabilities,command,lifetime.signal)).rejects.toThrow(/scope changed/);
    TestBed.inject(HttpTestingController).expectNone(()=>true);
  });
});

describe('per-scope native dispatch metadata', () => {
  it.each([false, undefined])('preserves explicit false or omitted eligibility without dropping either demo domain: %s', async eligibility => {
    TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting(),SessionContextApiService]});
    const http=TestBed.inject(HttpTestingController),service=TestBed.inject(SessionContextApiService);
    const environments=[{environmentId:'demo',identityDomain:'invoice'},{environmentId:'demo',identityDomain:'shipping',...(eligibility===undefined?{}:{nativeDetective:eligibility})}];
    const pending=service.capabilities(localProject);http.expectOne(r=>r.url.endsWith('/session-context/capabilities')).flush({...capabilities,environments});
    expect((await pending).environments).toEqual(environments);http.verify();
  });
  it('refuses a string false instead of treating it as a native dispatch grant', async () => {
    TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting(),SessionContextApiService]});
    const http=TestBed.inject(HttpTestingController),service=TestBed.inject(SessionContextApiService);
    const pending=service.capabilities(localProject),assertion=expect(pending).rejects.toThrow('does not support');
    http.expectOne(r=>r.url.endsWith('/session-context/capabilities')).flush({...capabilities,environments:[{environmentId:'demo',identityDomain:'shipping',nativeDetective:'false'}]});await assertion;http.verify();
  });
});
