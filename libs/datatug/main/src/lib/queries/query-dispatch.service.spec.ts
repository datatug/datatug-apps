import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of, Subject } from 'rxjs';
import { QueryType, type IQueryDef, type ITextQueryRequest } from '../models/definition/query-def';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { BrowserSqliteQueryService } from './browser-sqlite-query.service';
import { DetectiveClientService } from '../detective/detective-client.service';
import { QueryDispatchService } from './query-dispatch.service';
import { QueryDispatchError, type QueryDispatchRequest } from './query-dispatch';
import type { OvdbConnection } from '../ovdb/ovdb-connection';
import { QueryRuntimeRegistry } from './query-runtime-registry.service';
import { FederatedQueryService } from './federated-query.service';
import { createHostedDemoDbQuery } from './hosted-demo-db-query';

const sqlDefinition = (): IQueryDef => ({
  id: 'report', title: 'Report',
  request: { queryType: QueryType.SQL, text: 'select 1' } as ITextQueryRequest,
});
const result = {
  recordset: { columns: [{ name: 'value', type: 'integer' }], rows: [[{ type: 'integer', value: '1' }]] },
  limitations: [], bindingsApplied: [], truncated: false,
  provenance: { source: 'agent', queryId: 'folder/report', mode: 'live', observedAt: '2026-10-16T00:00:00Z', executionProfile: 'protected' },
};

describe('QueryDispatchService transport boundary', () => {
  let service: QueryDispatchService;
  let http: HttpTestingController;
  const catalog = vi.fn();
  const github = vi.fn();
  const browser = vi.fn();
  const hosted = vi.fn();

  beforeEach(() => {
    catalog.mockReset(); github.mockReset(); browser.mockReset(); hosted.mockReset();
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: ProjectQueryApiService, useValue: { connectionCatalog: catalog } },
      { provide: GithubProjectReaderService, useValue: { getRawJson: github } },
      { provide: BrowserSqliteQueryService, useValue: { execute: browser } },
      { provide: DetectiveClientService, useValue: { runHostedQuery: hosted } },
    ] });
    service = TestBed.inject(QueryDispatchService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('keeps a folder-qualified local query identity and full semantic request', async () => {
    const request: QueryDispatchRequest = {
      projectRef: { storeId: 'localhost:8989', projectId: 'demo', projectApi: 'local' },
      definition: sqlDefinition(), queryId: 'folder/report', environment: 'LOCAL', securityContextId: 'sctx',
      agentRequest: {
        project: 'demo', environment: 'LOCAL', securityContextId: 'sctx', queryId: 'folder/report',
        parameters: { id: { type: 'integer', value: '2' } },
        bindingOrigins: [{ parameterId: 'id', origin: 'manual' }], mode: 'snapshot', snapshotId: 'snap',
        record: true, limit: 10,
      },
      target: { kind: 'local-agent', agentStoreId: 'localhost:8989' },
    };
    const session = service.start(request);
    await Promise.resolve();
    await Promise.resolve();
    const pending = http.expectOne((call) => call.url.endsWith('localhost:8989/datatug/exec/run_query'));
    expect(pending.request.body).toEqual(request.agentRequest);
    pending.flush(result);
    expect((await session.result).provenance.queryId).toBe('folder/report');
    await session.dispose();
    expect(catalog).not.toHaveBeenCalled();
    expect(browser).not.toHaveBeenCalled();
  });

  it('rejects contradictory displayed inputs and origins before sending a local agent request', async () => {
    const request: QueryDispatchRequest = {
      projectRef: { storeId: 'localhost:8989', projectId: 'demo', projectApi: 'local' },
      definition: sqlDefinition(), queryId: 'folder/report', environment: 'LOCAL', securityContextId: 'sctx',
      target: { kind: 'local-agent', agentStoreId: 'localhost:8989' },
      parameters: { id: { type: 'integer', value: '3' } },
      bindingOrigins: [{ parameterId: 'id', origin: 'manual' }],
      agentRequest: { project: 'demo', environment: 'LOCAL', securityContextId: 'sctx', queryId: 'folder/report',
        parameters: { id: { type: 'integer', value: '2' } }, bindingOrigins: [{ parameterId: 'id', origin: 'manual' }], mode: 'live' },
    };
    await expect(service.start(request).result).rejects.toThrow('Local agent inputs differ');
    http.expectNone((call) => call.url.endsWith('/exec/run_query'));
    await expect(service.start({ ...request, parameters: request.agentRequest?.parameters,
      bindingOrigins: [{ parameterId: 'id', origin: 'context' }] }).result)
      .rejects.toThrow('Local agent binding origins differ');
    http.expectNone((call) => call.url.endsWith('/exec/run_query'));
  });

  it('does not dispatch after cancellation during a branch-qualified catalog read', async () => {
    const pending = new Subject<unknown>();
    github.mockReturnValue(pending);
    const session = service.start({
      projectRef: { storeId: 'github.com', projectId: 'repo@owner', branch: 'release' },
      definition: { ...sqlDefinition(), connectionId: 'edition-v4' }, queryId: 'one/report',
      target: { kind: 'browser-sqlite' },
    });
    await vi.waitFor(() => expect(github).toHaveBeenCalledWith('repo@owner@datatug@release', 'connections/demo-db.json'));
    await session.cancel();
    await expect(session.result).rejects.toMatchObject({ name: 'AbortError' });
    pending.next({ connections: [{ id: 'edition-v4', storage: 'sqlite' }] });
    expect(browser).not.toHaveBeenCalled();
  });

  it('uses the hosted Firestore query contract and checks the retained receipt', async () => {
    hosted.mockReturnValue(of({ result: {
      ...result,
      execution: { storeId: 'firestore', projectId: 'demo', executionId: 'run-1' },
      provenance: { ...result.provenance, queryId: 'folder/report' },
    } }));
    const session = service.start({
      projectRef: { storeId: 'firestore', projectId: 'demo', spaceID: 'space-1' },
      definition: sqlDefinition(), queryId: 'folder/report', environment: 'qa',
      target: { kind: 'hosted-cloud' }, hostedInputs: { id: { type: 'integer', value: '2' } },
    });
    expect((await session.result).execution?.executionId).toBe('run-1');
    expect(hosted).toHaveBeenCalledWith(
      { kind: 'cloud', storage: 'firestore', spaceID: 'space-1', project: 'demo' },
      'folder/report', 'qa', { id: { type: 'integer', value: '2' } },
    );
    await session.dispose();
  });

  it('runs a backend-shaped hosted federation with a paid source absent from the demo catalog', async () => {
    const definition: IQueryDef = { ...createHostedDemoDbQuery('reports/paid-customers'),
      connectionId: 'paid-source-unknown-to-demo-catalog' };
    hosted.mockReturnValue(of({ result: {
      ...result,
      execution: { storeId: 'firestore', projectId: 'paid-project', executionId: 'run-paid-1' },
      provenance: { ...result.provenance, queryId: 'reports/paid-customers' },
    } }));
    const session = service.start({
      projectRef: { storeId: 'firestore', projectId: 'paid-project', spaceID: 'shared-space' },
      definition, queryId: 'reports/paid-customers', environment: 'production',
      target: { kind: 'hosted-cloud' }, hostedInputs: { CustomerId: { type: 'integer', value: '42' } },
    });
    expect((await session.result).execution?.executionId).toBe('run-paid-1');
    expect(hosted).toHaveBeenCalledExactlyOnceWith(
      { kind: 'cloud', storage: 'firestore', spaceID: 'shared-space', project: 'paid-project' },
      'reports/paid-customers', 'production', { CustomerId: { type: 'integer', value: '42' } },
    );
    expect(catalog).not.toHaveBeenCalled();
    expect(github).not.toHaveBeenCalled();
    expect(browser).not.toHaveBeenCalled();
    http.expectNone((call) => call.url.includes('/exec/run_query'));
    await session.dispose();
  });

  it('lets the local saved-query endpoint admit its source without consulting the browser catalog', async () => {
    const definition: IQueryDef = { ...createHostedDemoDbQuery('reports/local'), connectionId: 'server-source' };
    const session = service.start({
      projectRef: { storeId: 'localhost:8989', projectId: 'demo', projectApi: 'local' },
      definition, queryId: 'reports/local', environment: 'LOCAL', securityContextId: 'sctx',
      target: { kind: 'local-agent', agentStoreId: 'localhost:8989' },
    });
    const pending = await vi.waitFor(() => http.expectOne((call) => call.url.endsWith('/exec/run_query')));
    pending.flush({ ...result, provenance: { ...result.provenance, queryId: 'reports/local' } });
    expect((await session.result).provenance.queryId).toBe('reports/local');
    expect(catalog).not.toHaveBeenCalled();
    expect(github).not.toHaveBeenCalled();
    await session.dispose();
  });

  it.each([
    ['inprocess', { query: true }, '/query'],
    ['hosted', { dtql: true }, '/dtql'],
  ] as const)('sends %s OVDB reads through the explicitly bound connection fetch', async (_label, capabilities, path) => {
    const pin = 'a'.repeat(64);
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      records: [{ key: 'items/1', data: { Name: 'changed working copy' } }], nextCursor: 'next',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const binding: OvdbConnection = {
      id: 'native-runtime-17', title: 'Working copy', baseUrl: 'https://ovdb.example', databaseId: 'db-17', fetch,
      descriptor: { id: 'db-17', capabilities,
        canonical: { url: 'https://fixture.example/db.sqlite', sha256: pin, bytes: 64 },
        schemas: { collections: { items: { fields: { Name: { type: 'string' } } } } },
      },
    };
    github.mockReturnValue(of({ connections: [{ id: 'logical-edition-4', storage: 'sqlite', fixtureSha256: pin }] }));
    const execution = service.execute({
      projectRef: { storeId: 'github.com', projectId: 'repo@owner' },
      definition: { ...sqlDefinition(), connectionId: 'logical-edition-4', request: {
        queryType: QueryType.DTQL, text: 'from:\n  name: "items"\nlimit: 1\n',
      } as ITextQueryRequest },
      queryId: 'folder/report',
      target: { kind: 'ovdb-connection', connectionId: binding.id, databaseId: binding.databaseId },
      runtimeBinding: binding,
    });
    const output = await execution;
    expect(fetch).toHaveBeenCalledOnce();
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toContain(path);
    expect(output.recordset.rows[0][0]).toEqual({ type: 'string', value: 'changed working copy' });
    expect(output.truncated).toBe(true);
    expect(output.hasMore).toBe(false);
    expect(globalThis.fetch).not.toBe(fetch);
  });

  it('runs an explicitly selected registered working copy and observes its changed rows', async () => {
    const pin = 'd'.repeat(64);
    let currentName = 'before edit';
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      records: [{ key: 'records/1', data: { Name: currentName } }],
    }), { headers: { 'Content-Type': 'application/json' } }));
    const connection: OvdbConnection = {
      id: 'native-open-copy', title: 'Open copy', baseUrl: 'https://local.ovdb.invalid', databaseId: 'copy-1', fetch,
      descriptor: { id: 'copy-1', capabilities: { query: true, write: true },
        canonical: { url: 'https://fixtures.example/edition.sqlite', sha256: pin, bytes: 128 },
        schemas: { collections: { records: { fields: { Name: { type: 'string' } } } } },
      },
    };
    const registry = TestBed.inject(QueryRuntimeRegistry);
    const registration = registry.register(connection);
    const definition: IQueryDef = { ...sqlDefinition(), connectionId: 'published-edition-v4', request: {
      queryType: QueryType.DTQL, text: 'from:\n  name: "records"\nlimit: 10\n',
    } as ITextQueryRequest };
    github.mockReturnValue(of({ connections: [{ id: 'published-edition-v4', fixtureSha256: pin }] }));
    const request: QueryDispatchRequest = {
      projectRef: { storeId: 'github.com', projectId: 'repo@owner' },
      definition, queryId: 'folder/report', runtimeSelectionId: registration.selectionId,
    };
    expect((await service.availableWorkingCopies(request)).map((option) => option.selectionId))
      .toEqual([registration.selectionId]);
    expect((await service.execute(request)).recordset.rows[0][0]).toEqual({ type: 'string', value: 'before edit' });
    currentName = 'after edit';
    expect((await service.execute(request)).recordset.rows[0][0]).toEqual({ type: 'string', value: 'after edit' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(browser).not.toHaveBeenCalled();
    registration.dispose();
    await expect(service.execute(request)).rejects.toThrow(/working copy is closed/u);
  });

  it('reports an OVDB wall-time deadline as a safe timeout and keeps context cancellation separate', async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const pin = 'e'.repeat(64);
    const started = vi.fn();
    const connection: OvdbConnection = {
      id: 'native-copy', title: 'Open copy', baseUrl: 'https://local.ovdb.invalid', databaseId: 'copy-1',
      fetch: (_input, init) => new Promise<Response>((_resolve, reject) => {
        started();
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }),
      descriptor: { id: 'copy-1', capabilities: { query: true },
        canonical: { url: 'https://fixture.example/edition.sqlite', sha256: pin, bytes: 128 },
        schemas: { collections: { records: { fields: { Name: { type: 'string' } } } } },
      },
    };
    github.mockReturnValue(of({ connections: [{ id: 'logical-copy', fixtureSha256: pin }] }));
    const request: QueryDispatchRequest = {
      projectRef: { storeId: 'github.com', projectId: 'repo@owner' },
      definition: { ...sqlDefinition(), connectionId: 'logical-copy', request: {
        queryType: QueryType.DTQL, text: 'from:\n  name: "records"\nlimit: 10\n',
      } as ITextQueryRequest },
      runtimeBinding: connection,
    };
    try {
      const run = service.execute(request);
      await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
      deadline.abort();
      await expect(run).rejects.toBeInstanceOf(QueryDispatchError);
      await expect(run).rejects.toThrow(/30-second browser limit/u);
    } finally {
      timeout.mockRestore();
    }
  });

  it('owns federation pages and cancellation independently for concurrent sessions', async () => {
    const owners: FederatedQueryService[] = [];
    const disposed = new Set<FederatedQueryService>();
    const run = vi.spyOn(FederatedQueryService.prototype, 'run').mockImplementation(async function (this: FederatedQueryService) {
      owners.push(this);
      return result as Awaited<ReturnType<FederatedQueryService['run']>>;
    });
    const getPage = vi.spyOn(FederatedQueryService.prototype, 'getPage').mockImplementation(async function (this: FederatedQueryService) {
      return [[{ type: 'string', value: owners.indexOf(this).toString() }]];
    });
    const dispose = vi.spyOn(FederatedQueryService.prototype, 'dispose').mockImplementation(async function (this: FederatedQueryService) {
      disposed.add(this);
    });
    try {
      const request: QueryDispatchRequest = {
        projectRef: { storeId: 'github.com', projectId: 'repo@owner' },
        definition: { ...sqlDefinition(), federation: { ovdbBaseUrl: 'https://db.example', tables: [] } },
        target: { kind: 'ovdb-federation' },
      };
      const first = service.start(request);
      const second = service.start(request);
      await Promise.all([first.result, second.result]);
      expect(owners).toHaveLength(2);
      expect(owners[0]).not.toBe(owners[1]);
      expect(await first.getPage?.(0)).toEqual([[{ type: 'string', value: '0' }]]);
      expect(await second.getPage?.(0)).toEqual([[{ type: 'string', value: '1' }]]);
      await first.cancel();
      expect(disposed.has(owners[0])).toBe(true);
      expect(disposed.has(owners[1])).toBe(false);
      expect(await second.getPage?.(1)).toEqual([[{ type: 'string', value: '1' }]]);
      await second.dispose();
    } finally {
      run.mockRestore(); getPage.mockRestore(); dispose.mockRestore();
    }
  });
});
