import { describe, expect, it } from 'vitest';
import { executePublicDtql, type PublicDtqlSource } from './public-dtql-transport';

const source: PublicDtqlSource = {
  endpoint: 'https://cloud.openvaultdb.com/v1/databases/northwind-postgresql/dtql',
  databaseId: 'northwind-postgresql',
  collectionId: 'pg1_AAAACW5vcnRod2luZAAAAAZPcmRlcnM',
  requireExecutionSource: true,
  maxRows: 100,
  expectedFields: ['ShipCountry', 'orders'],
};

function transport(result: unknown): typeof fetch {
  return async () => new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const result = {
  complete: true,
  columns: ['ShipCountry', 'orders'],
  records: [{ data: { ShipCountry: 'UK', orders: 56 } }],
  execution: {
    rowsReturned: 1,
    sources: [{ database: 'northwind-postgresql', collection: 'pg1_AAAACW5vcnRod2luZAAAAAZPcmRlcnM' }],
  },
};

describe('public DTQL transport', () => {
  it('retains the independently observed physical source and complete rows', async () => {
    const executed = await executePublicDtql('from: {name: Orders}\n', source, { fetch: transport(result) });
    expect(executed.records[0].data['orders']).toBe(56);
    expect(executed.executionSources).toEqual(result.execution.sources);
    expect(executed.complete).toBe(true);
  });

  it('rejects missing source, partial pages and changed columns', async () => {
    await expect(executePublicDtql('query', source, { fetch: transport({ ...result, execution: undefined }) }))
      .rejects.toThrow(/omitted/);
    await expect(executePublicDtql('query', source, { fetch: transport({ ...result, nextCursor: 'next' }) }))
      .rejects.toThrow(/incomplete/);
    await expect(executePublicDtql('query', source, { fetch: transport({ ...result, columns: ['orders', 'ShipCountry'] }) }))
      .rejects.toThrow(/columns/);
  });

  it('rejects a non-integer or non-finite saved row limit before fetching', async () => {
    for (const maxRows of [NaN, Infinity, 1.5]) {
      await expect(executePublicDtql('query', { ...source, maxRows }, { fetch: transport(result) }))
        .rejects.toThrow(/browser execution policy/);
    }
  });
});
