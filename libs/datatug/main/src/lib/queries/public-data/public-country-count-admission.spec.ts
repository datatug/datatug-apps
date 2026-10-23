import { describe, expect, it } from 'vitest';
import {
  executePublishedCountryCounts,
  NORTHWIND_COUNTRY_COUNT_PIN,
  verifyPublishedCountryCounts,
  type CountryCountPin,
} from './public-country-count-admission';

const encoder = new TextEncoder();
const sourceId = 'ovdb:https%3A%2F%2Fdemodb.dev%2Fovdb/northwind/Orders';
const serverId = 'https://demodb.dev/ovdb';
const query = 'from: {name: Orders}\nlimit: 100\n';
const savedQuery = 'from: {name: Orders}\ngroupBy: [{field: ShipCountry}]\norderBy: [{field: ShipCountry}]\ncolumns: [{field: ShipCountry}, {aggregate: {function: count, args: [{star: true}]}, as: orders}]\nlimit: 100\n';
const rows: [string, number][] = [['France', 1], ['UK', 2]];
const response = {
  columns: ['ShipCountry', 'orders'], complete: true,
  execution: { route: 'database', rowsReturned: 2, sources: [{ database: 'northwind', collection: 'Orders' }] },
  records: rows.map(([ShipCountry, orders]) => ({ data: { ShipCountry, orders } })),
};

async function digest(value: Uint8Array): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fixture(): Promise<{ pin: CountryCountPin; publication: Uint8Array }> {
  const querySha256 = await digest(encoder.encode(query));
  const canonicalRowsSha256 = await digest(encoder.encode(JSON.stringify(rows)));
  const publication = encoder.encode(JSON.stringify({
    format: 'demodb-observed-aggregate-rights/v1',
    admission: {
      endpoint: NORTHWIND_COUNTRY_COUNT_PIN.endpoint, query, querySha256,
      complete: true, rows: 2, fields: ['ShipCountry', 'orders'], totalOrders: 3,
      canonicalRowsSha256, executionSource: { database: 'northwind', collection: 'Orders' },
    },
    sourceRights: [{
      sourceId, source: { serverId, databaseId: 'northwind', recordset: 'Orders' },
      declaration: { spdx: 'MIT', url: 'https://example.test/LICENSE' },
      declarationScope: 'recordset',
      declaredAt: { serverId, databaseId: 'northwind', recordset: 'Orders' },
      evidenceOrigin: 'publisher-verified', pins: [], transformations: [],
    }],
    usedSourceIds: [sourceId],
  }));
  return {
    pin: {
      ...NORTHWIND_COUNTRY_COUNT_PIN, publicationSha256: await digest(publication),
      querySha256, rows: 2, totalOrders: 3, canonicalRowsSha256,
    },
    publication,
  };
}

describe('published Northwind SQLite shipping-country aggregate', () => {
  it('admits exact complete rows with the publisher source terms', async () => {
    const { pin, publication } = await fixture();
    const result = await verifyPublishedCountryCounts(query, response, publication, pin);
    expect(result.rows).toEqual(rows);
    expect(result.totalOrders).toBe(3);
    expect(result.usedSourceIds).toEqual([sourceId]);
    expect(result.sourceRights[0].evidenceOrigin).toBe('publisher-verified');
    expect(result.provenance.endpoint).toBe(pin.endpoint);
  });

  it('rejects changed query, publisher bytes, source and partial results', async () => {
    const { pin, publication } = await fixture();
    await expect(verifyPublishedCountryCounts(`${query}#`, response, publication, pin)).rejects.toThrow(/query differs/);
    await expect(verifyPublishedCountryCounts(query, response, encoder.encode('{}'), pin)).rejects.toThrow(/pinned artifact/);
    await expect(verifyPublishedCountryCounts(query, { ...response, complete: false }, publication, pin)).rejects.toThrow(/incomplete/);
    await expect(verifyPublishedCountryCounts(query, { ...response, nextCursor: 'more' }, publication, pin)).rejects.toThrow(/incomplete/);
    await expect(verifyPublishedCountryCounts(query, {
      ...response, execution: { ...response.execution, sources: [{ database: 'other', collection: 'Orders' }] },
    }, publication, pin)).rejects.toThrow(/physical source/);
  });

  it('rejects changed, duplicate, unsafe and invalid country counts', async () => {
    const { pin, publication } = await fixture();
    const changed = (index: number, data: Record<string, unknown>) => ({
      ...response, records: response.records.map((row, position) => position === index ? { data: { ...row.data, ...data } } : row),
    });
    for (const bad of [
      changed(0, { orders: 2 }), changed(0, { orders: 0 }), changed(0, { orders: 1.5 }),
      changed(0, { orders: Number.MAX_SAFE_INTEGER + 1 }), changed(0, { ShipCountry: 'UK' }),
      changed(0, { ShipCountry: '' }), changed(0, { ShipCountry: null }),
    ]) {
      await expect(verifyPublishedCountryCounts(query, bad, publication, pin)).rejects.toThrow();
    }
  });

  it('keeps the production entry point pinned before it makes a request', async () => {
    let called = false;
    await expect(executePublishedCountryCounts('changed query', {
      fetch: async () => { called = true; return new Response('{}'); },
    })).rejects.toThrow(/query differs/);
    expect(called).toBe(false);
    expect(NORTHWIND_COUNTRY_COUNT_PIN.rows).toBe(21);
    expect(NORTHWIND_COUNTRY_COUNT_PIN.totalOrders).toBe(830);
    expect(NORTHWIND_COUNTRY_COUNT_PIN.canonicalRowsSha256).toBe('10180147a7752d4006c28d438d7deed96461336b865156036c2c017f5c82b235');
    expect(await digest(encoder.encode(savedQuery))).toBe(NORTHWIND_COUNTRY_COUNT_PIN.querySha256);
  });

  it('stops cancelled and oversized publication reads before TugQL execution', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      return new Response('{}', { headers: { 'Content-Length': '65537' } });
    };
    await expect(executePublishedCountryCounts(savedQuery, { signal: controller.signal, fetch: fetcher }))
      .rejects.toThrow(/cancelled/);
    expect(calls).toBe(0);
    await expect(executePublishedCountryCounts(savedQuery, { fetch: fetcher }))
      .rejects.toThrow(/browser limit/);
    expect(calls).toBe(1);
  });
});
