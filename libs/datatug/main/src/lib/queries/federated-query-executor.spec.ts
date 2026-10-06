import { afterEach, describe, expect, it, vi } from 'vitest';
import { runFederatedQuery, type FederatedQueryProgress } from './federated-query-executor';
import { QueryType, type IQueryDef } from '../models/definition/query-def';

import rightsWire from '@sneat/datatug-semantic/fixtures/client-only-source-rights.json';

vi.mock('@dalgo/indexeddb', () => ({
  IndexedDbDatabase: class { async close(): Promise<void> { /* no scratch rows for direct lookups */ } },
}));

const query: IQueryDef = {
  id: 'detail', title: 'Invoice detail',
  request: { queryType: QueryType.DTQL, text: JSON.stringify({ from: { database: 'sales', name: 'Invoice' } }) },
  federation: {
    ovdbBaseUrl: 'https://ovdb.example.test',
    tables: [{ database: 'sales', name: 'Invoice', fields: ['id', 'country_id'] }],
    lookups: [{ database: 'geo', collection: 'Country', fromColumn: 'country_id', fields: [{ source: 'name', target: 'country' }] }],
  },
} as IQueryDef;

const response = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('visible browser query execution', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('waits for a requested page, reuses snapshot tokens, and preserves cumulative lookup progress', async () => {
    vi.stubGlobal('indexedDB', { deleteDatabase: () => {
      const request: { onsuccess?: () => void } = {};
      queueMicrotask(() => request.onsuccess?.());
      return request;
    } });
    const sourceRequests: Headers[] = [];
    let lookups = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (/\/v1\/databases\/[^/]+$/.test(url)) return response({});
      expect(url).not.toContain('secret');
      if (url.endsWith('/dtql')) {
        sourceRequests.push(new Headers(init.headers));
        const token = new Headers(init.headers).get('OVDB-Page-Token');
        if (new Headers(init.headers).get('OVDB-Page-Close') === 'true') return new Response(null, { status: 204 });
        const first = token === null;
        return response({
          records: Array.from({ length: first ? 100 : 5 }, (_, index) => ({ key: String(index + (first ? 1 : 101)), data: { id: index + (first ? 1 : 101), country_id: index % 2 } })),
          snapshotToken: 'immutable-snapshot',
          ...(first ? { nextPageToken: 'immutable-page-2' } : {}),
        });
      }
      lookups++;
      return response({ key: 'country', data: { name: 'Alpha' } });
    }));
    const pages: number[] = [];
    const progress: FederatedQueryProgress[] = [];
    const gates: Array<() => void> = [];
    let firstPage!: () => void;
    const ready = new Promise<void>((resolve) => { firstPage = resolve; });
    const run = runFederatedQuery(query, (item) => progress.push(item), 'secret',
      async (rows) => { pages.push(rows.length); }, undefined, 'visible',
      () => firstPage(), () => new Promise<void>((resolve) => { gates.push(resolve); }));
    await ready;
    expect(pages).toEqual([100]);
    expect(sourceRequests).toHaveLength(1);
    expect(lookups).toBe(2);
    expect(progress.some((item) => item.requestsPending === 2)).toBe(true);
    expect(progress.some((item) => item.requestsInFlight === 2)).toBe(true);
    expect(progress.at(-1)).toMatchObject({ requestsCompleted: 2, requestsInFlight: 0, requestsPending: 0 });
    gates.shift()?.();
    await run;
    expect(pages).toEqual([100, 5]);
    expect(sourceRequests).toHaveLength(3);
    expect(sourceRequests[1].get('OVDB-Page-Token')).toBe('immutable-page-2');
    expect(sourceRequests[1].get('Authorization')).toBe('Bearer secret');
    expect(sourceRequests[2].get('OVDB-Page-Token')).toBe('immutable-snapshot');
    expect(sourceRequests[2].get('OVDB-Page-Close')).toBe('true');
    expect(lookups).toBe(2);
    expect(progress.at(-1)).toMatchObject({ requestsCompleted: 2, requestsInFlight: 0, requestsPending: 0, rowsLoaded: 105 });
  });

  it('releases scratch storage when a paused visible run is cancelled', async () => {
    const deleted: string[] = [];
    vi.stubGlobal('indexedDB', { deleteDatabase: (name: string) => {
      deleted.push(name);
      const request: { onsuccess?: () => void } = {};
      queueMicrotask(() => request.onsuccess?.());
      return request;
    } });
    const requests: Headers[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (/\/v1\/databases\/[^/]+$/.test(url)) return response({});
      if (!url.endsWith('/dtql')) return response({ data: { name: 'Alpha' } });
      const headers = new Headers(init.headers);
      requests.push(headers);
      if (headers.get('OVDB-Page-Close') === 'true') return new Response(null, { status: 204 });
      return response({ records: Array.from({ length: 100 }, (_, index) => ({ key: String(index), data: { id: index, country_id: index } })), nextPageToken: 'next', snapshotToken: 'cancelled-snapshot' });
    }));
    const controller = new AbortController();
    let release!: () => void;
    let ready!: () => void;
    const first = new Promise<void>((resolve) => { ready = resolve; });
    const run = runFederatedQuery(query, undefined, '', async () => undefined, controller.signal, 'visible',
      () => ready(), () => new Promise<void>((resolve) => { release = resolve; }));
    await first;
    controller.abort();
    release();
    await expect(run).rejects.toBeDefined();
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatch(/^datatug-federated-/);
    expect(requests.at(-1)?.get('OVDB-Page-Token')).toBe('cancelled-snapshot');
    expect(requests.at(-1)?.get('OVDB-Page-Close')).toBe('true');
  });
  it('carries actual raw point/page evidence through the installed lookup engine and blocks missing expected discovery before rows', async () => {
    vi.stubGlobal('indexedDB', { deleteDatabase: () => { const request: { onsuccess?: () => void } = {}; queueMicrotask(() => request.onsuccess?.()); return request; } });
    const definition = { ...query, request: { queryType: QueryType.DTQL, text: JSON.stringify({ from: { database: 'fx', name: 'Rates' } }) }, federation: { ...query.federation, expectedServerIdentity: { baseUrl: 'https://ovdb.example.test', serverId: 'fixture-server' }, expectedSourceRights: rightsWire.structured.sourceRights, tables: [{ database: 'fx', name: 'Rates', fields: ['id', 'country_id'] }], lookups: [{ database: 'music', collection: 'Album', fromColumn: 'country_id', fields: [{ source: 'name', target: 'country' }] }] } } as unknown as IQueryDef;
    const calls: string[] = [];
    const http = vi.fn<typeof fetch>(async (url, init) => {
      calls.push(String(url));
      if (String(url).endsWith('/v1/databases/fx')) return response({ sourceRights: rightsWire.structured.sourceRights });
      if (String(url).endsWith('/v1/databases/music')) return response({ sourceRights: rightsWire.legacy.sourceRights });
      if (new Headers(init?.headers).get('OVDB-Page-Close') === 'true') return new Response(null, { status: 204 });
      if (String(url).endsWith('/dtql')) return response({ ...rightsWire.structured, records: [{ key: '1', data: { id: 1, country_id: 3 } }], snapshotToken: 'fixture-snapshot' });
      return response({ ...rightsWire.legacy, key: '3', data: { name: 'Fixture album' } });
    });
    const rows = vi.fn();
    const result = await runFederatedQuery(definition, undefined, '', async (page) => { rows(page); }, undefined, 'visible', undefined, undefined, { fetch: http });
    expect(calls.slice(0, 2)).toEqual(['https://ovdb.example.test/v1/databases/fx', 'https://ovdb.example.test/v1/databases/music']);
    expect(rows).toHaveBeenCalledOnce();
    expect(result.sourceRights?.map((right) => right.sourceId)).toEqual([...rightsWire.structured.usedSourceIds, ...rightsWire.legacy.usedSourceIds]);
    expect(result.usedSourceIds).toEqual([...rightsWire.structured.usedSourceIds, ...rightsWire.legacy.usedSourceIds]);
    const before = vi.fn();
    await expect(runFederatedQuery(definition, undefined, '', before, undefined, 'visible', undefined, undefined, { fetch: async () => response({}) })).rejects.toThrow(/Expected structured/);
    expect(before).not.toHaveBeenCalled();
  });

  it('rejects unsafe bounded origins, runtime profiles and bounds before any network or authorization exposure', async () => {
    const bounds = { userRows: 1000, userOffset: 0, identifierKind: 'place' as const, identifierLimit: 100, resultRows: 5000, bytes: 5242880, timeoutMs: 10000, sources: [{ database: 'user', name: 'Customer', keyField: 'Country' }, { database: 'geo', name: 'Countries', keyField: 'raw', parent: { database: 'user', name: 'Customer', field: 'Country' } }] };
    for (const federation of [
      { ovdbBaseUrl: 'https://untrusted.example', bounds },
      { ovdbBaseUrl: 'https://demodb.dev.evil.example/ovdb', bounds },
      { ovdbBaseUrl: 'https://fixture-token@demodb.dev/ovdb', bounds },
      { ovdbBaseUrl: 'https://demodb.dev/ovdb?secret=fixture-token', bounds },
      { ovdbBaseUrl: 'https://cloud.openvaultdb.com', bounds },
      { ovdbBaseUrl: 'https://demodb.dev/ovdb', bounds: { ...bounds, bytes: 5242881 } },
      { ovdbBaseUrl: 'https://cloud.openvaultdb.com', bounds: { ...bounds, runtime: { readProfile: 'invalid', databases: {} } } },
      { ovdbBaseUrl: 'https://demodb.dev/ovdb', bounds, expectedServerIdentity: { baseUrl: 'https://other.example', serverId: 'fixture-server' } },
    ]) {
      const network = vi.fn<typeof fetch>(async () => response({}));
      const definition = { ...query, federation: { ...query.federation, expectedServerIdentity: { baseUrl: federation.ovdbBaseUrl, serverId: 'fixture-server' }, ...federation } } as unknown as IQueryDef;
      await expect(runFederatedQuery(definition, undefined, 'fixture-token', undefined, undefined, 'full', undefined, undefined, { fetch: network })).rejects.toThrow();
      expect(network).not.toHaveBeenCalled();
    }
  });

});
