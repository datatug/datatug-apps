import initSqlJs from 'sql.js';
import { vi } from 'vitest';
import { QueryType, type IQueryDef } from '../models/definition/query-def';
import { BrowserSqliteQueryService } from './browser-sqlite-query.service';
import { executeBrowserSqlite, type BrowserSqliteWorkerRequest } from './browser-sqlite-query.worker';
import type { QueryDispatchPlan, QueryDispatchRequest } from './query-dispatch';
import { QueryDispatchError } from './query-dispatch';

describe('BrowserSqliteQueryService', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('dispatches an arbitrary pinned connection through the generic worker', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE NorthwindOrders (OrderId INTEGER, CustomerCode TEXT)');
    db.run("INSERT INTO NorthwindOrders VALUES (42, 'ALFKI')");
    const bytes = new Uint8Array(db.export());
    db.close();
    const hashBytes = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(hashBytes)].map((part) => part.toString(16).padStart(2, '0')).join('');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes.buffer, {
      status: 200,
      headers: { 'content-length': String(bytes.byteLength) },
    })));
    const terminate = vi.fn();
    vi.stubGlobal('Worker', class {
      onmessage?: (event: MessageEvent) => void;
      onerror?: (event: Event) => void;
      postMessage(request: BrowserSqliteWorkerRequest): void {
        void executeBrowserSqlite(request, async () => SQL).then(
          (result) => this.onmessage?.({ data: { ok: true, result } } as MessageEvent),
          (error: unknown) => this.onmessage?.({ data: { ok: false, error: error instanceof Error ? error.message : String(error) } } as MessageEvent),
        );
      }
      terminate(): void { terminate(); this.onmessage = undefined; }
    });

    const definition: IQueryDef = {
      id: 'northwind/orders/by-customer', title: 'Orders by customer', connectionId: 'northwind-archive-v8',
      request: { queryType: QueryType.SQL, text: 'SELECT CustomerCode FROM NorthwindOrders WHERE OrderId = 42' } as import('../models/definition/query-def').ISqlQueryRequest,
    };
    const request: QueryDispatchRequest = {
      projectRef: { storeId: 'github.com', projectId: 'sample/northwind', branch: 'release' },
      definition, queryId: definition.id, environment: 'test', target: { kind: 'browser-sqlite' },
    };
    const plan: QueryDispatchPlan = {
      projectRef: request.projectRef,
      definition,
      environment: 'test',
      target: { kind: 'browser-sqlite' },
      connection: {
        id: 'northwind-archive-v8', storage: 'sqlite', environment: 'test', fixtureSha256: sha256,
        browserFixture: { url: 'https://cdn.example.org/northwind-v8.sqlite', bytes: bytes.byteLength },
      },
    };

    const result = await new BrowserSqliteQueryService().execute(plan, request);
    expect(result.recordset.columns.map((column) => column.name)).toEqual(['CustomerCode']);
    expect(result.recordset.rows).toEqual([[{ type: 'string', value: 'ALFKI' }]]);
    expect(result.browserExecution).toEqual({ runtime: 'sqlite-fixture', fixtureSha256: sha256 });
    expect(fetch).toHaveBeenCalledWith('https://cdn.example.org/northwind-v8.sqlite', expect.objectContaining({
      credentials: 'omit', redirect: 'error',
    }));

    const optional: IQueryDef = {
      ...definition,
      parameters: [{ id: 'prefix', type: 'string', isRequired: false }],
      request: { queryType: QueryType.SQL,
        text: 'SELECT CustomerCode FROM NorthwindOrders WHERE :prefix IS NULL OR CustomerCode LIKE :prefix',
      } as import('../models/definition/query-def').ISqlQueryRequest,
    };
    const optionalResult = await new BrowserSqliteQueryService().execute(
      { ...plan, definition: optional }, { ...request, definition: optional },
    );
    expect(optionalResult.recordset.rows).toEqual([[{ type: 'string', value: 'ALFKI' }]]);
    expect(optionalResult.bindingsApplied).toEqual([]);
    const pinnedConnection = plan.connection;
    const browserFixture = pinnedConnection?.browserFixture;
    if (!pinnedConnection || !browserFixture) throw new Error('The test needs a pinned browser fixture.');
    await expect(new BrowserSqliteQueryService().execute(
      { ...plan, connection: { ...pinnedConnection, fixtureSha256: 'f'.repeat(64) } }, request,
    )).rejects.toThrow(/hash differs from its pin/u);
    await expect(new BrowserSqliteQueryService().execute(
      { ...plan, connection: { ...pinnedConnection, browserFixture: { ...browserFixture, bytes: bytes.byteLength + 1 } } }, request,
    )).rejects.toThrow(/size differs from its pin/u);
    await expect(new BrowserSqliteQueryService().execute(
      { ...plan, definition: { ...optional, parameters: [{ id: 'prefix', type: 'string', isRequired: true }] } },
      { ...request, definition: { ...optional, parameters: [{ id: 'prefix', type: 'string', isRequired: true }] } },
    )).rejects.toThrow(/missing required/u);

    const writeDefinition: IQueryDef = { ...definition,
      request: { queryType: QueryType.SQL, text: 'DELETE FROM NorthwindOrders' } as import('../models/definition/query-def').ISqlQueryRequest,
    };
    await expect(new BrowserSqliteQueryService().execute(
      { ...plan, definition: writeDefinition }, { ...request, definition: writeDefinition },
    )).rejects.toThrow(/read-only SELECT/u);

    vi.stubGlobal('Worker', class {
      onmessage?: (event: MessageEvent) => void;
      postMessage(): void { this.onmessage?.({ data: { ok: false, error: 'private worker detail' } } as MessageEvent); }
      terminate(): void { terminate(); this.onmessage = undefined; }
    });
    await expect(new BrowserSqliteQueryService().execute(plan, request))
      .rejects.toEqual(new QueryDispatchError('The browser SQLite query failed. Check its read-only SQL and declared inputs.'));
    expect(terminate).toHaveBeenCalledTimes(4);
  });

  it('terminates an allocated worker on context abort and on its wall-time limit', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE Inventory (id INTEGER)');
    const bytes = new Uint8Array(db.export());
    db.close();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes.buffer, { status: 200 })));
    const terminate = vi.fn();
    vi.stubGlobal('Worker', class {
      onmessage?: (event: MessageEvent) => void;
      onerror?: (event: Event) => void;
      postMessage(): void { /* Remain pending until abort or deadline. */ }
      terminate(): void { terminate(); }
    });
    const definition: IQueryDef = { id: 'inventory', title: 'Inventory', connectionId: 'edition-2',
      request: { queryType: QueryType.SQL, text: 'SELECT id FROM Inventory' } as import('../models/definition/query-def').ISqlQueryRequest };
    const request: QueryDispatchRequest = { projectRef: { storeId: 'github.com', projectId: 'sample/inventory' }, definition };
    const plan: QueryDispatchPlan = { projectRef: request.projectRef, definition, target: { kind: 'browser-sqlite' },
      connection: { id: 'edition-2', storage: 'sqlite', fixtureSha256: sha256,
        browserFixture: { url: 'https://cdn.example.org/inventory.sqlite', bytes: bytes.byteLength } } };

    const controller = new AbortController();
    let dispatched!: () => void;
    const accepted = new Promise<void>((resolve) => { dispatched = resolve; });
    const cancelled = new BrowserSqliteQueryService().execute(plan, { ...request, signal: controller.signal, onDispatched: dispatched });
    await accepted;
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    expect(terminate).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    let dispatchedAgain!: () => void;
    const acceptedAgain = new Promise<void>((resolve) => { dispatchedAgain = resolve; });
    const expired = new BrowserSqliteQueryService().execute(plan, { ...request, onDispatched: dispatchedAgain });
    await acceptedAgain;
    const deadlineAssertion = expect(expired).rejects.toEqual(new QueryDispatchError('The browser SQLite query exceeded 10 seconds.'));
    await vi.advanceTimersByTimeAsync(10_001);
    await deadlineAssertion;
    expect(terminate).toHaveBeenCalledTimes(2);
  });
});
