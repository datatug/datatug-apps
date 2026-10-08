import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IQueryDef } from '../models/definition/query-def';
import { runFederatedQuery, type FederatedSourceLoaded } from './federated-query-executor';

const definition = (): IQueryDef => ({
  id: 'q', title: 'q', request: { queryType: 'DTQL', text: 'from: {database: db, name: items, alias: i}\ncolumns: [{field: name, source: i}]\n' },
  federation: { ovdbBaseUrl: 'https://ovdb.example.test', tables: [{ name: 'items', database: 'db', fields: ['name'] }] },
} as unknown as IQueryDef);

describe('federated executor seams', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads through the fetch it is given, not the global one, and reports each source it finished reading', async () => {
    const global = vi.fn(async () => { throw new Error('the global fetch must not be used'); });
    vi.stubGlobal('fetch', global);
    const own = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (new Headers(init?.headers).get('OVDB-Page-Close') === 'true') return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ records: [{ key: 'a', data: { name: 'A' } }, { key: 'b', data: { name: 'B' } }], snapshotToken: 's' }), { status: 200 });
    });
    const loaded: FederatedSourceLoaded[] = [];
    const firstRecord = vi.fn();
    const result = await runFederatedQuery(definition(), undefined, '', undefined, undefined, 'full', undefined, undefined, { fetch: own as unknown as typeof fetch, onSourceLoaded: (event) => loaded.push(event), onFirstRecord: firstRecord });
    expect(result.recordset.rows.map((row) => row[0].value)).toEqual(['A', 'B']);
    expect(global).not.toHaveBeenCalled();
    expect(own).toHaveBeenCalled();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ database: 'db', name: 'items', rows: 2, requests: 1 });
    expect(loaded[0].elapsedMs).toBeGreaterThanOrEqual(0);
    expect(firstRecord).toHaveBeenCalledOnce();
  });

  it('still uses the global fetch when no seam is given', async () => {
    const global = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      new Headers(init?.headers).get('OVDB-Page-Close') === 'true' ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ records: [{ key: 'a', data: { name: 'A' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', global);
    const result = await runFederatedQuery(definition());
    expect(result.recordset.rows).toHaveLength(1);
    expect(global).toHaveBeenCalled();
  });
});
