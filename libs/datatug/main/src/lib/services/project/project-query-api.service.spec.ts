import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { SneatApiService } from '@sneat/api';
import { readGithubProjectId } from '@datatug/project-address';
import { of, firstValueFrom, throwError } from 'rxjs';
import {
  ProjectQueryApiService,
  QualifiedLocalReadVersionError,
  qualifiedLocalReadVersionGuidance,
} from './project-query-api.service';
import { StoreApiService } from '../repo/store-api.service';
import { toProjectQueryWire } from '../../queries/project-query-contract';
import { createHostedDemoDbQuery } from '../../queries/hosted-demo-db-query';

describe('ProjectQueryApiService', () => {
  const api = {
    get: vi.fn((...args: unknown[]) => {
      void args;
      return of({});
    }),
    post: vi.fn((...args: unknown[]) => {
      void args;
      return of({});
    }),
  };
  const http = {
    get: vi.fn((...args: unknown[]) => {
      void args;
      return of({});
    }),
    post: vi.fn((...args: unknown[]) => {
      void args;
      return of({});
    }),
  };
  const storeApi = {
    get: vi.fn((...args: unknown[]) => {
      void args;
      return of({ version: '0.97.0' });
    }),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockImplementation(() => of({}));
    storeApi.get.mockImplementation(() => of({ version: '0.97.0' }));
    TestBed.configureTestingModule({
      providers: [
        ProjectQueryApiService,
        { provide: SneatApiService, useValue: api },
        { provide: HttpClient, useValue: http },
        { provide: StoreApiService, useValue: storeApi },
      ],
    });
  });
  it('routes GitHub reads/saves through authenticated Cloud API with flat scope and no provider fallback', async () => {
    const service = TestBed.inject(ProjectQueryApiService);
    const ref = {
      storeId: 'github.com',
      projectId: 'repo@owner@datatug@working',
    };
    await firstValueFrom(service.read(ref, 'folder/q', 'working'));
    const params = api.get.mock.calls[0][1] as HttpParams;
    expect(api.get.mock.calls[0][0]).toBe('datatug/queries/query_revision');
    expect(params.get('storage')).toBe('github.com');
    expect(params.get('project')).toBe('repo@owner@datatug');
    expect(params.get('branch')).toBe('working');
    await firstValueFrom(
      service.save(ref, {
        operationId: 'stable-retry-id',
        branch: 'working',
        expectedBranchHead: 'head',
        ifNoneMatch: true,
        query: toProjectQueryWire(createHostedDemoDbQuery('q')),
      }),
    );
    expect(api.post.mock.calls[0][0]).toBe('datatug/queries/save_query');
    expect(api.post.mock.calls[0][1]).toMatchObject({
      storage: 'github.com',
      project: 'repo@owner@datatug',
      operationId: 'stable-retry-id',
      ifNoneMatch: true,
    });
    expect(http.get).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });
  it('reads the fixed source catalogue for a private cloned project on its selected branch', async () => {
    const ref = {
      storeId: 'github.com',
      projectId: 'demo@buyer@project',
      projectApi: 'cloud' as const,
      branch: 'work',
    };
    await firstValueFrom(
      TestBed.inject(ProjectQueryApiService).connectionCatalog(ref),
    );
    expect(api.get.mock.calls[0][0]).toBe(
      'datatug/projects/connection_catalog',
    );
    const params = api.get.mock.calls[0][1] as HttpParams;
    expect(params.get('project')).toBe('demo@buyer@project');
    expect(params.get('branch')).toBe('work');
    expect(http.get).not.toHaveBeenCalled();
    expect(storeApi.get).not.toHaveBeenCalled();
  });
  it('rejects a branch qualifier that conflicts with the branch embedded in the project address', async () => {
    const service = TestBed.inject(ProjectQueryApiService);
    await expect(
      firstValueFrom(
        service.boards({
          storeId: 'github.com',
          projectId: 'repo@owner@folder@old',
          projectApi: 'cloud',
          branch: 'new',
        }),
      ),
    ).rejects.toThrow('conflicts');
    expect(api.get).not.toHaveBeenCalled();
    expect(http.get).not.toHaveBeenCalled();
  });
  it('routes fixed asset reads through the full-ref transport', async () => {
    const service = TestBed.inject(ProjectQueryApiService);
    const ref = {
      storeId: 'github.com',
      projectId: 'demo@buyer@project',
      projectApi: 'cloud' as const,
      branch: 'topic',
    };
    await firstValueFrom(service.boards(ref));
    await firstValueFrom(service.board(ref, 'board_1'));
    await firstValueFrom(service.entities(ref));
    await firstValueFrom(service.entity(ref, 'Entity_1'));
    await firstValueFrom(service.environments(ref));
    expect(api.get.mock.calls.map((call) => call[0])).toEqual([
      'datatug/boards/all_boards',
      'datatug/boards/board',
      'datatug/entities/all_entities',
      'datatug/entities/entity',
      'datatug/environments/all_environments',
    ]);
    for (const [, params] of api.get.mock.calls.slice(0, 5)) {
      expect((params as HttpParams).get('branch')).toBe('topic');
      expect((params as HttpParams).get('project')).toBe('demo@buyer@project');
    }
    expect((api.get.mock.calls[1][1] as HttpParams).get('id')).toBe('board_1');
    expect((api.get.mock.calls[3][1] as HttpParams).get('id')).toBe('Entity_1');
  });

  it('checks the current local CLI version before every qualified asset, catalog, and summary read', async () => {
    const service = TestBed.inject(ProjectQueryApiService);
    const ref = {
      storeId: 'http-localhost:8989',
      projectId: 'local-project',
      projectApi: 'local' as const,
      branch: 'feature/read-contract',
    };
    await firstValueFrom(service.boards(ref));
    await firstValueFrom(service.board(ref, 'sales'));
    await firstValueFrom(service.entities(ref));
    await firstValueFrom(service.entity(ref, 'Customer'));
    await firstValueFrom(service.environments(ref));
    await firstValueFrom(service.connectionCatalog(ref));
    await firstValueFrom(service.summary(ref));

    expect(storeApi.get).toHaveBeenCalledTimes(7);
    for (const [storeId, path] of storeApi.get.mock.calls) {
      expect(storeId).toBe(ref.storeId);
      expect(path).toBe('/agent-info');
    }
    expect(http.get).toHaveBeenCalledTimes(7);
    const calls = http.get.mock.calls as [string, { params: HttpParams }][];
    expect(calls.map(([url]) => url)).toEqual([
      'http://localhost:8989/datatug/boards/all_boards',
      'http://localhost:8989/datatug/boards/board',
      'http://localhost:8989/datatug/entities/all_entities',
      'http://localhost:8989/datatug/entities/entity',
      'http://localhost:8989/datatug/environments/all_environments',
      'http://localhost:8989/datatug/projects/connection_catalog',
      'http://localhost:8989/datatug/projects/project_summary',
    ]);
    for (const [, options] of calls.slice(0, 6)) {
      expect(options.params.get('storage')).toBe('local');
      expect(options.params.get('project')).toBe(ref.projectId);
      expect(options.params.get('branch')).toBe(ref.branch);
    }
    expect(calls[1][1].params.get('id')).toBe('sales');
    expect(calls[3][1].params.get('id')).toBe('Customer');
    expect(calls[6][1].params.get('storage')).toBe('local');
    expect(calls[6][1].params.get('project')).toBeNull();
    expect(calls[6][1].params.get('id')).toBe(ref.projectId);
    expect(calls[6][1].params.get('branch')).toBe(ref.branch);
  });

  it.each(['0.96.9', '0.97.0-rc.1', 'dev', undefined])(
    'blocks qualified local reads when CLI version is %s before requesting the asset',
    async (version) => {
      storeApi.get.mockReturnValue(
        of(version === undefined ? ({} as { version: string }) : { version }),
      );
      const service = TestBed.inject(ProjectQueryApiService);
      await expect(
        firstValueFrom(
          service.boards({
            storeId: 'localhost:8989',
            projectId: 'local-project',
            branch: 'feature',
          }),
        ),
      ).rejects.toThrow(/update DataTug CLI to v0\.97\.0 or later.*restart/i);
      expect(storeApi.get).toHaveBeenCalledTimes(1);
      expect(http.get).not.toHaveBeenCalled();
    },
  );

  it('types only the compatibility refusal for trusted UI guidance', async () => {
    storeApi.get.mockReturnValue(of({ version: '0.93.0' }));
    const request = firstValueFrom(
      TestBed.inject(ProjectQueryApiService).connectionCatalog({
        storeId: 'localhost:8989',
        projectId: 'local-project',
        branch: 'feature',
      }),
    );
    await expect(request).rejects.toBeInstanceOf(
      QualifiedLocalReadVersionError,
    );
    expect(
      qualifiedLocalReadVersionGuidance(new QualifiedLocalReadVersionError()),
    ).toMatch(/update DataTug CLI to v0\.97\.0 or later.*restart its agent/i);
    expect(
      qualifiedLocalReadVersionGuidance(
        new Error('server included private response text'),
      ),
    ).toBeUndefined();
    expect(http.get).not.toHaveBeenCalled();
  });

  it('fails closed with update guidance if the local CLI version cannot be read', async () => {
    storeApi.get.mockReturnValue(throwError(() => new Error('offline')));
    await expect(
      firstValueFrom(
        TestBed.inject(ProjectQueryApiService).entities({
          storeId: 'localhost:8989',
          projectId: 'local-project',
          branch: 'feature',
        }),
      ),
    ).rejects.toThrow(/Could not verify.*update.*restart/i);
    expect(http.get).not.toHaveBeenCalled();
  });
  it('surfaces private asset authorization denial on the shared denial stream', async () => {
    const service = TestBed.inject(ProjectQueryApiService);
    const denied: unknown[] = [];
    service.authorityDenied.subscribe((ref) => denied.push(ref));
    api.get.mockImplementation(() => throwError(() => ({ status: 403 })));
    const ref = {
      storeId: 'github.com',
      projectId: 'demo@buyer@project',
      projectApi: 'cloud' as const,
      branch: 'topic',
    };
    await expect(firstValueFrom(service.entities(ref))).rejects.toMatchObject({
      status: 403,
    });
    expect(denied).toEqual([ref]);
    expect(http.get).not.toHaveBeenCalled();
  });
  it('uses the authenticated Space-qualified transport for shared query read, catalogue and save', async () => {
    const service = TestBed.inject(ProjectQueryApiService);
    const ref = {
      storeId: 'firestore',
      spaceID: 'space_1',
      projectId: 'project_1',
    };
    await firstValueFrom(service.folder(ref));
    await firstValueFrom(service.read(ref, 'q'));
    await firstValueFrom(service.connectionCatalog(ref));
    for (const call of api.get.mock.calls) {
      const params = call[1] as HttpParams;
      expect(params.get('storage')).toBe('firestore');
      expect(params.get('spaceID')).toBe('space_1');
      expect(params.get('project')).toBe('project_1');
      expect(params.has('branch')).toBe(false);
    }
    await firstValueFrom(
      service.save(ref, {
        operationId: 'operation_1',
        ifNoneMatch: true,
        query: toProjectQueryWire(createHostedDemoDbQuery('q')),
      }),
    );
    expect(api.post.mock.calls[0][1]).toMatchObject({
      storage: 'firestore',
      spaceID: 'space_1',
      project: 'project_1',
      operationId: 'operation_1',
      ifNoneMatch: true,
    });
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('branch');
    expect(http.get).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });
  it.each([
    ['Repo@Owner@datatug@working', 'repo@owner@datatug', 'datatug'],
    ['Repo@Owner@datatug@HEAD', 'repo@owner@datatug', 'datatug'],
    ['Repo@Owner@@working', 'repo@owner@', ''],
    [
      'Repo@Owner@Folder/Nested@working',
      'repo@owner@Folder/Nested',
      'Folder/Nested',
    ],
  ])(
    'projects %s into a canonical API scope with branch separate',
    async (projectId, canonical, folder) => {
      const service = TestBed.inject(ProjectQueryApiService);
      await firstValueFrom(
        service.read(
          { storeId: 'github.com', projectId },
          'q',
          'selected-branch',
        ),
      );
      const params = api.get.mock.calls[0][1] as HttpParams;
      expect(params.get('project')).toBe(canonical);
      expect(params.get('branch')).toBe('selected-branch');
      expect(readGithubProjectId(params.get('project'))).toEqual({
        ok: true,
        id: { repo: 'repo', org: 'owner', folder },
      });
    },
  );
  it.each([
    'my project',
    'é',
    '.hidden',
    'a'.repeat(129),
    'a'.repeat(128) + '/' + 'b'.repeat(128),
  ])(
    'refuses unsupported API folder %j through observable errors before GET or save',
    async (folder) => {
      const service = TestBed.inject(ProjectQueryApiService);
      const ref = { storeId: 'github.com', projectId: 'repo@owner@' + folder };
      await expect(firstValueFrom(service.read(ref, 'q'))).rejects.toThrow(
        'Invalid GitHub project API key',
      );
      await expect(
        firstValueFrom(
          service.save(ref, {
            operationId: 'op',
            query: toProjectQueryWire(createHostedDemoDbQuery('q')),
          }),
        ),
      ).rejects.toThrow('Invalid GitHub project API key');
      expect(api.get).not.toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();
    },
  );
  it('uses the exact local CLI prefix and local storage envelope', async () => {
    const service = TestBed.inject(ProjectQueryApiService);
    const ref = { storeId: 'http-localhost:8989', projectId: 'local-project' };
    await firstValueFrom(service.read(ref, 'q', 'work'));
    expect(http.get.mock.calls[0][0]).toBe(
      'http://localhost:8989/datatug/queries/query_revision',
    );
    expect(
      (http.get.mock.calls[0][1] as { params: HttpParams }).params.get(
        'storage',
      ),
    ).toBe('local');
    await firstValueFrom(
      service.save(ref, {
        operationId: 'op',
        branch: 'work',
        expectedBranchHead: 'head',
        ifMatch: 'revision',
        query: toProjectQueryWire(createHostedDemoDbQuery('q')),
      }),
    );
    expect(http.post.mock.calls[0][0]).toBe(
      'http://localhost:8989/datatug/queries/save_query',
    );
    expect(api.post).not.toHaveBeenCalled();
  });
  it('refuses a malformed Space reference before any network request', async () => {
    await expect(
      firstValueFrom(
        TestBed.inject(ProjectQueryApiService).read(
          { storeId: 'firestore', projectId: 'q', spaceID: 'bad space' },
          'query',
        ),
      ),
    ).rejects.toThrow('Invalid shared project reference');
    expect(api.get).not.toHaveBeenCalled();
    expect(http.get).not.toHaveBeenCalled();
  });
});

it('emits explicit private read authority denial without treating a network failure as revocation', async () => {
  TestBed.resetTestingModule();
  const get = vi.fn(() => throwError(() => ({ status: 0 })));
  TestBed.configureTestingModule({
    providers: [
      ProjectQueryApiService,
      { provide: SneatApiService, useValue: { get } },
      { provide: HttpClient, useValue: {} },
    ],
  });
  const service = TestBed.inject(ProjectQueryApiService);
  const ref = {
    storeId: 'github.com',
    projectId: 'repo@owner@folder',
    projectApi: 'cloud' as const,
    branch: 'work',
  };
  const denied: unknown[] = [];
  service.authorityDenied.subscribe((value) => denied.push(value));
  await expect(firstValueFrom(service.summary(ref))).rejects.toMatchObject({
    status: 0,
  });
  expect(denied).toEqual([]);
  get.mockImplementation(() => throwError(() => ({ status: 403 })));
  await expect(firstValueFrom(service.summary(ref))).rejects.toMatchObject({
    status: 403,
  });
  expect(denied).toEqual([ref]);
});

describe('ProjectQueryApiService qualified local runtime compatibility', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ProjectQueryApiService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SneatApiService, useValue: { get: vi.fn() } },
      ],
    });
  });

  const ref = {
    storeId: 'http-localhost:8989',
    projectId: 'demo-project',
    projectApi: 'local' as const,
    branch: 'feature/demo',
  };

  it('does not send an asset request to an older CLI that would ignore branch', async () => {
    const http = TestBed.inject(HttpTestingController);
    const request = firstValueFrom(
      TestBed.inject(ProjectQueryApiService).boards(ref),
    );
    http.expectOne('http://localhost:8989/datatug/agent-info').flush({
      version: '0.93.0',
      uptimeMinutes: 3,
    });
    await expect(request).rejects.toThrow(
      /update DataTug CLI to v0\.97\.0 or later.*restart/i,
    );
    http.expectNone('http://localhost:8989/datatug/boards/all_boards');
    http.verify();
  });

  it.each([
    ['unknown', {}],
    ['development', { version: 'dev' }],
    ['prerelease', { version: '0.97.0-rc.1' }],
    ['malformed build metadata', { version: '0.97.0+foo..bar' }],
    ['oversized version numbers', { version: '999999999999999999999999.0.0' }],
  ])('fails closed for %s agent-info metadata', async (_name, info) => {
    const http = TestBed.inject(HttpTestingController);
    const request = firstValueFrom(
      TestBed.inject(ProjectQueryApiService).summary(ref),
    );
    http.expectOne('http://localhost:8989/datatug/agent-info').flush(info);
    await expect(request).rejects.toThrow(
      /update DataTug CLI to v0\.97\.0 or later.*restart/i,
    );
    http.expectNone('http://localhost:8989/datatug/projects/project_summary');
    http.verify();
  });

  it('fails closed with restart guidance when agent-info cannot be reached', async () => {
    const http = TestBed.inject(HttpTestingController);
    const request = firstValueFrom(
      TestBed.inject(ProjectQueryApiService).entity(ref, 'Customer'),
    );
    http
      .expectOne('http://localhost:8989/datatug/agent-info')
      .error(new ProgressEvent('network error'));
    await expect(request).rejects.toThrow(/Could not verify.*update.*restart/i);
    http.expectNone('http://localhost:8989/datatug/entities/entity');
    http.verify();
  });

  it('sends the full branch and summary ID only after a supported fresh probe', async () => {
    const http = TestBed.inject(HttpTestingController);
    const service = TestBed.inject(ProjectQueryApiService);

    const boardRead = firstValueFrom(service.board(ref, 'sales'));
    http.expectOne('http://localhost:8989/datatug/agent-info').flush({
      version: 'v0.97.0',
      uptimeMinutes: 4,
    });
    const board = http.expectOne(
      (request) => request.url === 'http://localhost:8989/datatug/boards/board',
    );
    expect(board.request.params.get('storage')).toBe('local');
    expect(board.request.params.get('project')).toBe('demo-project');
    expect(board.request.params.get('branch')).toBe('feature/demo');
    expect(board.request.params.get('id')).toBe('sales');
    board.flush({ id: 'sales', title: 'Feature sales' });
    await expect(boardRead).resolves.toMatchObject({ title: 'Feature sales' });

    const summaryRead = firstValueFrom(service.summary(ref));
    http.expectOne('http://localhost:8989/datatug/agent-info').flush({
      version: '0.97.1',
      uptimeMinutes: 5,
    });
    const summary = http.expectOne(
      (request) =>
        request.url ===
        'http://localhost:8989/datatug/projects/project_summary',
    );
    expect(summary.request.params.get('storage')).toBe('local');
    expect(summary.request.params.get('project')).toBeNull();
    expect(summary.request.params.get('id')).toBe('demo-project');
    expect(summary.request.params.get('branch')).toBe('feature/demo');
    summary.flush({ id: 'demo-project', title: 'Feature project' });
    await expect(summaryRead).resolves.toMatchObject({
      title: 'Feature project',
    });
    http.verify();
  });
});
