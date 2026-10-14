import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { key } from '@dalgo/core';
import { IndexedDbDatabase } from '@dalgo/indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { DemoDbLocalCopy } from './demo-db-local-copy';

const fixtureSha256 = 'a'.repeat(64);

const descriptor = (rowCount: number) => ({
  localId: 'chinook',
  apiUrl: 'https://demodb.dev/ovdb/v1/databases/chinook',
  capabilities: { read: true, write: false },
  provenance: { sha256: fixtureSha256, revision: 'b'.repeat(40) },
  recordsets: [{ name: 'Things', kind: 'table', rowCount,
    columns: [{ name: 'thing_id', type: 'INTEGER' }, { name: 'amount', type: 'DECIMAL_TEXT(10,2)' }, { name: 'blob', type: 'BLOB' }],
    primaryKey: [{ column: 'thing_id', position: 1 }], foreignKeys: [] }],
});
const database = {
  id: 'chinook', collections: ['Things'],
  capabilities: { read: true, write: false, dtql: true },
};
const response = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function fixture(rows: readonly { key: string; data: Record<string, unknown> }[], failAfterFirst = false) {
  const requests: string[] = [];
  const httpFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith('/ovdb-database.json')) return response(descriptor(rows.length));
    if (url.endsWith('/chinook')) return response(database);
    if (url.endsWith('/dtql')) {
      const headers = new Headers(init?.headers);
      if (headers.get('OVDB-Page-Close')) return response({});
      const token = headers.get('OVDB-Page-Token');
      if (token && failAfterFirst) return response({ error: 'unavailable' }, 503);
      const offset = token ? 1 : 0;
      return response({ records: rows.slice(offset, offset + 1),
        snapshotToken: 'snapshot-1', snapshotExpiresAt: '2099-01-01T00:00:00Z',
        ...(offset + 1 < rows.length ? { nextPageToken: 'next-1' } : {}) });
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  return { httpFetch, requests };
}

const rows = [
  { key: 'Things/ovdb:composite-1', data: { thing_id: 9007199254740993n, amount: 10, blob: 'AAE=' } },
  { key: 'Things/ovdb:composite-2', data: { thing_id: 2, amount: 2, blob: '' } },
];

// JSON.stringify cannot encode bigint. The wire fixture keeps the literal
// token so the test proves that the importer never rounds it through Number.
function exactFixture() {
  const base = fixture(rows.map((row, index) => ({ ...row, data: { ...row.data, thing_id: index + 1 } })));
  const httpFetch: typeof fetch = async (input, init) => {
    const result = await base.httpFetch(input, init);
    if (!String(input).endsWith('/dtql') || new Headers(init?.headers).get('OVDB-Page-Close') ||
        new Headers(init?.headers).get('OVDB-Page-Token')) return result;
    const text = await result.text();
    return new Response(text.replace('"thing_id":1', '"thing_id":9007199254740993'), { status: result.status });
  };
  return { httpFetch, requests: base.requests };
}

describe('explicit DemoDB browser copy', () => {
  const services: DemoDbLocalCopy[] = [];
  afterEach(async () => { for (const service of services.splice(0)) await service.close(); });

  it('streams pages into a persistent queryable Dev connection with exact numeric tokens and source schema', async () => {
    const factory = new IDBFactory();
    const source = exactFixture();
    const copy = new DemoDbLocalCopy(factory, source.httpFetch);
    services.push(copy);
    const progress: number[] = [];
    const ready = await copy.copy('chinook', fixtureSha256, new AbortController().signal, (done) => progress.push(done));
    expect(progress).toEqual([1, 2]);
    expect(ready.rowCount).toBe(2);
    expect(ready.tables[0].primaryKey).toEqual([{ column: 'thing_id', position: 1 }]);
    expect(ready.tables[0].columns[1].transport).toBe('json-numeric-wire-token');
    const page = await copy.query<Record<string, unknown>>('chinook', 'Things', { filters: [], orders: [], limit: 10 });
    expect(page.records.map((record) => record.data)).toEqual([
      { thing_id: '9007199254740993', amount: '10', blob: 'AAE=' },
      { thing_id: 2, amount: '2', blob: '' },
    ]);
    const ordered = await copy.query<Record<string, unknown>>('chinook', 'Things', {
      filters: [], orders: [{ field: 'amount', direction: 'asc' }], limit: 2,
    });
    expect(ordered.records.map((record) => record.data['amount'])).toEqual(['2', '10']);
    const exactWide = await copy.query<Record<string, unknown>>('chinook', 'Things', {
      filters: [{ field: 'thing_id', operator: '>', value: '9007199254740992' }], orders: [], limit: 2,
    });
    expect(exactWide.records.map((record) => record.data['thing_id'])).toEqual(['9007199254740993']);
    const reopened = new DemoDbLocalCopy(factory, source.httpFetch);
    services.push(reopened);
    expect((await reopened.connection('chinook'))?.databaseName).toBe(ready.databaseName);
    expect((await reopened.query('chinook', 'Things', { filters: [], orders: [], limit: 10 })).records).toHaveLength(2);
    expect(source.requests.filter((url) => url.endsWith('/dtql'))).toHaveLength(3); // two pages and close
  });

  it('queries BOOLEAN cells consistently when the public source uses either 0/1 or JSON booleans', async () => {
    const factory = new IDBFactory();
    const raw = fixture([
      { key: 'Things/1', data: { thing_id: 1, amount: 1, blob: null, flag: 1 } },
      { key: 'Things/2', data: { thing_id: 2, amount: 2, blob: null, flag: false } },
    ]);
    const httpFetch: typeof fetch = (input, init) => String(input).endsWith('/ovdb-database.json')
      ? Promise.resolve(response({ ...descriptor(2), recordsets: [{ ...descriptor(2).recordsets[0],
        columns: [...descriptor(2).recordsets[0].columns, { name: 'flag', type: 'BOOLEAN' }] }] }))
      : raw.httpFetch(input, init);
    const copy = new DemoDbLocalCopy(factory, httpFetch);
    services.push(copy);
    const ready = await copy.copy('chinook', fixtureSha256, new AbortController().signal);
    expect(ready.tables[0].columns.find((column) => column.name === 'flag')?.transport).toBe('logical-boolean');
    const trueRows = await copy.query<Record<string, unknown>>('chinook', 'Things', {
      filters: [{ field: 'flag', operator: '==', value: true }], orders: [], limit: 10,
    });
    expect(trueRows.records.map((record) => record.data['flag'])).toEqual([true]);
    const falseRows = await copy.query<Record<string, unknown>>('chinook', 'Things', {
      filters: [{ field: 'flag', operator: '==', value: false }], orders: [], limit: 10,
    });
    expect(falseRows.records.map((record) => record.data['flag'])).toEqual([false]);
  });

  it('keeps the prior usable copy when a replacement page fails', async () => {
    const factory = new IDBFactory();
    const good = fixture([{ key: 'Things/1', data: { thing_id: 1, amount: 1.5, blob: null } }]);
    const copy = new DemoDbLocalCopy(factory, good.httpFetch);
    services.push(copy);
    const before = await copy.copy('chinook', fixtureSha256, new AbortController().signal);
    const failing = fixture([{ key: 'Things/2', data: { thing_id: 2, amount: 2.5, blob: null } },
      { key: 'Things/3', data: { thing_id: 3, amount: 3.5, blob: null } }], true);
    const replacement = new DemoDbLocalCopy(factory, failing.httpFetch);
    services.push(replacement);
    await expect(replacement.copy('chinook', fixtureSha256, new AbortController().signal)).rejects.toThrow('503');
    expect((await replacement.connection('chinook'))?.databaseName).toBe(before.databaseName);
    expect((await replacement.query('chinook', 'Things', { filters: [], orders: [], limit: 10 })).records).toHaveLength(1);
  });

  it('cancels before promotion and refuses a source outside the fixed allowlist', async () => {
    const factory = new IDBFactory();
    const source = fixture([{ key: 'Things/1', data: { thing_id: 1, amount: 1.5, blob: null } },
      { key: 'Things/2', data: { thing_id: 2, amount: 2.5, blob: null } }]);
    const copy = new DemoDbLocalCopy(factory, source.httpFetch);
    services.push(copy);
    const controller = new AbortController();
    await expect(copy.copy('chinook', fixtureSha256, controller.signal, () => controller.abort())).rejects.toThrow();
    expect(await copy.connection('chinook')).toBeUndefined();
    await expect(copy.copy('bigquery-world-bank-wdi', fixtureSha256, new AbortController().signal)).rejects.toThrow('allowlist');
    expect(source.requests.every((url) => url.startsWith('https://demodb.dev/ovdb/'))).toBe(true);
  });

  it('rejects malformed binary cells and leaves no completed connection', async () => {
    const factory = new IDBFactory();
    const source = fixture([{ key: 'Things/1', data: { thing_id: 1, amount: 1.5, blob: 'not base64' } }]);
    const copy = new DemoDbLocalCopy(factory, source.httpFetch);
    services.push(copy);
    await expect(copy.copy('chinook', fixtureSha256, new AbortController().signal)).rejects.toThrow('base64');
    expect(await copy.connection('chinook')).toBeUndefined();
  });

  it.each(['Person.Address', 'Order Details'])('copies and queries a source table named %s', async (table) => {
    const factory = new IDBFactory();
    const base = fixture([{ key: 'Things/1', data: { thing_id: 1, amount: 2, blob: null } }]);
    const renamed: typeof fetch = async (input, init) => {
      const result = await base.httpFetch(input, init);
      return new Response((await result.text()).replaceAll('Things', table), { status: result.status });
    };
    const copy = new DemoDbLocalCopy(factory, renamed);
    services.push(copy);
    const complete = await copy.copy('chinook', fixtureSha256, new AbortController().signal);
    expect(complete.tables.map((entry) => entry.name)).toEqual([table]);
    const page = await copy.query<Record<string, unknown>>('chinook', table, { filters: [], orders: [], limit: 10 });
    expect(page.records.map((record) => record.data['thing_id'])).toEqual([1]);
  });

  it('rejects inconsistent numeric and text source cells before publishing a local connection', async () => {
    const factory = new IDBFactory();
    for (const data of [
      { thing_id: 1, amount: 'not-a-decimal', blob: null },
      { thing_id: '1.5', amount: 2, blob: null },
      { thing_id: 1, amount: '1e1000000', blob: null },
      { thing_id: '1'.repeat(1200), amount: 2, blob: null },
    ]) {
      const source = fixture([{ key: 'Things/1', data }]);
      const copy = new DemoDbLocalCopy(factory, source.httpFetch);
      services.push(copy);
      await expect(copy.copy('chinook', fixtureSha256, new AbortController().signal)).rejects.toThrow(/numeric|integer/);
      expect(await copy.connection('chinook')).toBeUndefined();
    }
    const tokenBase = fixture([{ key: 'Things/1', data: { thing_id: 1, amount: 2, blob: null } }]);
    const hugeTokenSource: typeof fetch = async (input, init) => {
      const result = await tokenBase.httpFetch(input, init);
      if (!String(input).endsWith('/dtql') || new Headers(init?.headers).get('OVDB-Page-Close')) return result;
      return new Response((await result.text()).replace('"thing_id":1', `"thing_id":${'1'.repeat(1200)}`), { status: result.status });
    };
    const hugeTokenCopy = new DemoDbLocalCopy(factory, hugeTokenSource);
    services.push(hugeTokenCopy);
    await expect(hugeTokenCopy.copy('chinook', fixtureSha256, new AbortController().signal)).rejects.toThrow('Nonfinite JSON number');
    expect(await hugeTokenCopy.connection('chinook')).toBeUndefined();
    const base = fixture([{ key: 'Things/1', data: { thing_id: 1, amount: 2, blob: null, label: 42 } }]);
    const source: typeof fetch = (input, init) => String(input).endsWith('/ovdb-database.json')
      ? Promise.resolve(response({ ...descriptor(1), recordsets: [{ ...descriptor(1).recordsets[0],
        columns: [...descriptor(1).recordsets[0].columns, { name: 'label', type: 'TEXT' }] }] }))
      : base.httpFetch(input, init);
    const copy = new DemoDbLocalCopy(factory, source);
    services.push(copy);
    await expect(copy.copy('chinook', fixtureSha256, new AbortController().signal)).rejects.toThrow('Unexpected numeric');
    expect(await copy.connection('chinook')).toBeUndefined();
    const flagBase = fixture([{ key: 'Things/1', data: { thing_id: 1, amount: 2, blob: null, flag: 'garbage' } }]);
    const flagSource: typeof fetch = (input, init) => String(input).endsWith('/ovdb-database.json')
      ? Promise.resolve(response({ ...descriptor(1), recordsets: [{ ...descriptor(1).recordsets[0],
        columns: [...descriptor(1).recordsets[0].columns, { name: 'flag', type: 'BOOLEAN' }] }] }))
      : flagBase.httpFetch(input, init);
    const flagCopy = new DemoDbLocalCopy(factory, flagSource);
    services.push(flagCopy);
    await expect(flagCopy.copy('chinook', fixtureSha256, new AbortController().signal)).rejects.toThrow('Invalid boolean');
    expect(await flagCopy.connection('chinook')).toBeUndefined();
  });

  it('rejects changed descriptor provenance while retaining the prior queryable generation', async () => {
    const factory = new IDBFactory();
    const source = fixture([{ key: 'Things/1', data: { thing_id: 1, amount: 1.5, blob: null } }]);
    const copy = new DemoDbLocalCopy(factory, source.httpFetch);
    services.push(copy);
    const original = await copy.copy('chinook', fixtureSha256, new AbortController().signal);
    const changed: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/ovdb-database.json')) {
        return response({ ...descriptor(1), provenance: { sha256: 'c'.repeat(64), revision: 'd'.repeat(40) } });
      }
      return source.httpFetch(input, init);
    };
    const replacement = new DemoDbLocalCopy(factory, changed);
    services.push(replacement);
    await expect(replacement.copy('chinook', fixtureSha256, new AbortController().signal)).rejects.toThrow('read-only edition');
    expect((await replacement.connection('chinook'))?.databaseName).toBe(original.databaseName);
    expect((await replacement.query('chinook', 'Things', { filters: [], orders: [], limit: 10 })).records).toHaveLength(1);
  });

  it('bounds retired generations and clears them only under a browser lock', async () => {
    const factory = new IDBFactory();
    const source = fixture([{ key: 'Things/1', data: { thing_id: 1, amount: 1.5, blob: null } }]);
    const copy = new DemoDbLocalCopy(factory, source.httpFetch);
    services.push(copy);
    const first = await copy.copy('chinook', fixtureSha256, new AbortController().signal);
    const second = await copy.copy('chinook', fixtureSha256, new AbortController().signal);
    await copy.copy('chinook', fixtureSha256, new AbortController().signal);
    expect((await copy.connection('chinook'))?.retiredDatabaseNames).toEqual([first.databaseName, second.databaseName]);
    await expect(copy.copy('chinook', fixtureSha256, new AbortController().signal)).rejects.toThrow('Clear old');
    const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: async <T>(_name: string, _options: unknown, operation: () => Promise<T>): Promise<T> => operation(),
    } });
    try {
      expect(await copy.clearRetired('chinook')).toBe(2);
      expect((await copy.connection('chinook'))?.retiredDatabaseNames).toEqual([]);
      expect((await copy.query('chinook', 'Things', { filters: [], orders: [], limit: 10 })).records).toHaveLength(1);
    } finally {
      if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
      else Reflect.deleteProperty(navigator, 'locks');
    }
  });

  it('refuses to delete an unrelated IndexedDB database from corrupted retired metadata', async () => {
    const factory = new IDBFactory();
    const source = fixture([{ key: 'Things/1', data: { thing_id: 1, amount: 1.5, blob: null } }]);
    const copy = new DemoDbLocalCopy(factory, source.httpFetch);
    services.push(copy);
    const current = await copy.copy('chinook', fixtureSha256, new AbortController().signal);
    const metadata = new IndexedDbDatabase({ name: 'datatug-demo-dev-connections', factory });
    await metadata.runReadwriteTransaction(async (tx) => tx.set(key('connections', 'dev/chinook'), {
      ...current, retiredDatabaseNames: ['unrelated-customer-data'],
    }));
    await metadata.close();
    const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: async <T>(_name: string, _options: unknown, operation: () => Promise<T>): Promise<T> => operation(),
    } });
    try {
      await expect(copy.clearRetired('chinook')).rejects.toThrow('outside this DemoDB connection');
      expect((await copy.connection('chinook'))?.databaseName).toBe(current.databaseName);
    } finally {
      if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
      else Reflect.deleteProperty(navigator, 'locks');
    }
  });

  it('settles a cancelled copy even if closing its source snapshot stalls', async () => {
    const factory = new IDBFactory();
    const source = fixture([{ key: 'Things/1', data: { thing_id: 1, amount: 1.5, blob: null } }]);
    let closeAborted = false;
    const fetchWithStalledClose: typeof fetch = (input, init) => {
      if (!new Headers(init?.headers).get('OVDB-Page-Close')) return source.httpFetch(input, init);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          closeAborted = true;
          reject(new Error('close aborted'));
        }, { once: true });
      });
    };
    const copy = new DemoDbLocalCopy(factory, fetchWithStalledClose);
    services.push(copy);
    const controller = new AbortController();
    await expect(copy.copy('chinook', fixtureSha256, controller.signal, () => controller.abort())).rejects.toThrow();
    expect(closeAborted).toBe(true);
    expect(await copy.connection('chinook')).toBeUndefined();
  });
});
