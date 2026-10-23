import { TestBed } from '@angular/core/testing';
import initSqlJs from 'sql.js';
import { AgentContextService } from '@sneat/datatug-semantic';
import { of } from 'rxjs';
import { ProjectAIService, ProjectAIContext } from './project-ai.service';
import { ChatInterpretService } from './chat-interpret.service';
import { ManagedAIGatewayService } from './managed-ai-gateway.service';
import { ProjectAssetsReadService } from '../services/project/project-assets-read.service';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { QueriesService } from '../queries/queries.service';
import { QueryDispatchService } from '../queries/query-dispatch.service';
import { QueryRuntimeRegistry } from '../queries/query-runtime-registry.service';
import { ITextQueryRequest } from '../models/definition/query-def';
import { QueryDispatchRequest } from '../queries/query-dispatch';
import { executeBrowserSqlite } from '../queries/browser-sqlite-query.worker';
import { ChatProvider } from './chat.types';

const provider: ChatProvider = { id: 'own', name: 'Own', protocol: 'openai-chat', baseUrl: 'https://provider.example', model: 'test', apiKey: 'test-key' };
const context: ProjectAIContext = {
  ref: { storeId: 'github.com', projectId: 'factory/project', branch: 'production' },
  environments: [{ id: 'prod' }], queries: [], entities: [{ id: 'Equipment', fields: [{ id: 'assetTag', type: 'string' }] }],
  connections: [{ id: 'factory', storage: 'sqlite', browserFixture: { url: '/factory.sqlite' }, fixtureSha256: 'a'.repeat(64) },
    { id: 'shipping', storage: 'sqlite', browserFixture: { url: '/shipping.sqlite' }, fixtureSha256: 'b'.repeat(64) }],
};

describe('ProjectAIService real generic project query execution', () => {
  let service: ProjectAIService;
  let captured: string[];
  let execute: ReturnType<typeof vi.fn>;
  let gateway: { chat: ReturnType<typeof vi.fn> };
  beforeEach(async () => {
    captured = [];
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE Equipment (assetTag TEXT, overdue INTEGER)');
    db.run("INSERT INTO Equipment VALUES ('pump-1',1),('valve-2',0)");
    const fixture = db.export(); db.close();
    const shipping = new SQL.Database(); shipping.run('CREATE TABLE Shipments (trackingCode TEXT, delivered INTEGER)'); shipping.run("INSERT INTO Shipments VALUES ('parcel-7',0)");
    const shippingFixture = shipping.export(); shipping.close();
    execute = vi.fn(async (request: QueryDispatchRequest) => {
      expect(request.projectRef).toEqual(context.ref);
      expect(['factory', 'shipping']).toContain(request.definition.connectionId);
      const result = await executeBrowserSqlite({ sql: (request.definition.request as ITextQueryRequest).text, fixture: request.definition.connectionId === 'shipping' ? shippingFixture : fixture, bindings: [] }, async () => SQL);
      if (!result) throw new Error('The engine returned no result.');
      return { recordset: { columns: result.columns.map((name) => ({ name, type: 'string' })), rows: result.rows.map((row) => row.map((value) => ({ type: typeof value, value }))) } };
    });
    gateway = { chat: vi.fn(async (body: { context: { text: string }[] }) => {
      captured.push(body.context[0].text);
      return { text: JSON.stringify({ sql: 'SELECT assetTag FROM Equipment WHERE overdue = 1 LIMIT 100' }) };
    }) };
    TestBed.configureTestingModule({ providers: [ProjectAIService, ChatInterpretService, { provide: ProjectQueryApiService, useValue: {} }, { provide: AgentContextService, useValue: null },
      { provide: ProjectAssetsReadService, useValue: { environments: () => of([{ id: 'prod' }]), entities: () => of(context.entities) } },
      { provide: QueriesService, useValue: { getQueriesFolder: () => of({ id: '~', items: [] }) } },
      { provide: QueryDispatchService, useValue: { execute, connectionCatalog: () => Promise.resolve(context.connections) } },
      { provide: QueryRuntimeRegistry, useValue: { candidates: () => [], revision: () => 0 } }, { provide: ManagedAIGatewayService, useValue: gateway },
    ] });
    service = TestBed.inject(ProjectAIService);
  });

  it.each(['managed', 'byok', 'anthropic'])('generates and executes non-Chinook SQL and follow-up with %s, without sending rows or credentials in metadata', async (mode) => {
    const fetch = vi.fn(async (_input: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      captured.push(body.messages.at(-1).content);
      const content = JSON.stringify({ sql: 'SELECT assetTag FROM Equipment WHERE overdue = 1 LIMIT 100' });
      return new Response(JSON.stringify(mode === 'anthropic' ? { content: [{ type: 'text', text: content }] } : { choices: [{ message: { content } }] }));
    });
    vi.stubGlobal('fetch', fetch);
    const own = mode === 'managed' ? undefined : mode === 'anthropic' ? { ...provider, protocol: 'anthropic-messages' as const } : provider;
    const result = await service.answer(context, 'prod', 'factory', 'Which equipment is overdue?', [], new AbortController().signal, own);
    expect(result.rows).toEqual([{ assetTag: 'pump-1' }]);
    const followup = await service.answer(context, 'prod', 'factory', 'Show those again', [{ id: 'turn', question: 'Which equipment is overdue?', state: 'result', generatedTugql: result.generatedTugql, rows: result.rows }], new AbortController().signal, own);
    expect(followup.rows).toEqual(result.rows);
    expect(captured.join(' ')).toContain('Equipment');
    expect(captured.join(' ')).toContain('assetTag');
    expect(captured.join(' ')).toContain('production');
    expect(captured.join(' ')).toContain('Which equipment is overdue?');
    expect(captured.join(' ')).not.toMatch(/pump-1|test-key|factory.sqlite|Chinook/);
    expect(execute).toHaveBeenCalledTimes(4);
    if (own) { expect(gateway.chat).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(2); }
    else { expect(gateway.chat).toHaveBeenCalledTimes(2); expect(fetch).not.toHaveBeenCalled(); }
  });

  it('reads and uses the selected second source schema rather than another connection’s tables', async () => {
    gateway.chat.mockResolvedValue({ text: '{"sql":"SELECT trackingCode FROM Shipments LIMIT 10"}' });
    const result = await service.answer(context, 'prod', 'shipping', 'Show shipments', [], new AbortController().signal);
    expect(result.rows).toEqual([{ trackingCode: 'parcel-7' }]);
    const request = gateway.chat.mock.calls[0][0];
    const metadata = JSON.parse(request.context[0].text);
    expect(metadata.connectionId).toBe('shipping');
    expect(metadata.schema).toEqual([{ name: 'Shipments', fields: ['trackingCode', 'delivered'] }]);
    expect(JSON.stringify(request)).not.toContain('parcel-7');
  });

  it('rejects a model-selected connection and unbounded or mutating proposals before data dispatch', async () => {
    gateway.chat.mockResolvedValue({ text: '{"sql":"DELETE FROM Equipment","connectionId":"shipping"}' });
    await expect(service.answer(context, 'prod', 'factory', 'Delete equipment', [], new AbortController().signal)).rejects.toThrow('unsupported query proposal');
    expect(execute).toHaveBeenCalledTimes(1); // schema only
    gateway.chat.mockResolvedValue({ text: '{"sql":"SELECT * FROM Equipment"}' });
    await expect(service.answer(context, 'prod', 'factory', 'Everything', [], new AbortController().signal)).rejects.toThrow('LIMIT');
  });

  it('does not silently switch from the pinned project source to an open checksum-matched working copy', async () => {
    vi.spyOn(TestBed.inject(QueryRuntimeRegistry), 'candidates').mockReturnValue([{
      selectionId: 'edited-copy', title: 'Edited equipment',
      connection: {} as import('../ovdb/ovdb-connection').OvdbConnection,
    }]);
    const result = await service.answer(context, 'prod', 'factory', 'Show equipment', [], new AbortController().signal);
    expect(result.rows).toEqual([{ assetTag: 'pump-1' }]);
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: 'browser-sqlite' }, runtimeSelectionId: undefined }));
  });

  it('rejects duplicate names from a real SQLite join instead of collapsing differing values', async () => {
    gateway.chat.mockResolvedValue({ text: JSON.stringify({ sql: "SELECT a.assetTag, b.assetTag FROM Equipment a JOIN Equipment b ON a.assetTag != b.assetTag LIMIT 10" }) });
    await expect(service.answer(context, 'prod', 'factory', 'Compare tags', [], new AbortController().signal)).rejects.toThrow('duplicate column names');
  });

  it('does not dispatch an answer after cancellation during inference', async () => {
    const controller = new AbortController();
    gateway.chat.mockImplementation(async () => { controller.abort(); return { text: '{"sql":"SELECT assetTag FROM Equipment LIMIT 5"}' }; });
    await expect(service.answer(context, 'prod', 'factory', 'Show equipment', [], controller.signal)).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
