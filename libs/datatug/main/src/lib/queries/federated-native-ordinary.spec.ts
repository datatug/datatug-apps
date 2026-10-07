import { describe, expect, it, vi } from 'vitest';
import type { ITextQueryRequest } from '../models/definition/query-def';
import { runFederatedQuery } from './federated-query-executor';
import {
  createHostedDemoDbQuery,
  withHostedDemoDbSource,
} from './hosted-demo-db-query';

vi.mock('@dalgo/indexeddb', () => ({
  IndexedDbDatabase: class {
    constructor() {
      throw new Error('Unexpected browser table scan');
    }
  },
}));

describe('hosted DemoDB ordinary DTQL responses', () => {
  it.each([
    ['chinook.Customer', 'chinook', 'CustomerId', 1],
    ['adventureworks.Person.Person', 'adventureworks', 'BusinessEntityID', 42],
  ])(
    'runs %s through one complete database query',
    async (source, database, field, value) => {
      const starter = createHostedDemoDbQuery('new-query');
      const definition =
        source === 'chinook.Customer'
          ? starter
          : withHostedDemoDbSource(starter, source);
      const calls: { url: string; init?: RequestInit }[] = [];
      const fetcher = vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        return url.endsWith(`/${database}`)
          ? Response.json({
              id: database,
              capabilities: { dtql: true, query: true, read: true },
            })
          : Response.json({
              records: [{ data: { [field]: value } }],
              columns: [field],
              execution: { route: 'database', rowsReturned: 1 },
            });
      });
      const result = await runFederatedQuery(
        definition,
        undefined,
        '',
        undefined,
        undefined,
        'full',
        undefined,
        undefined,
        { fetch: fetcher },
      );
      expect(calls.map(({ url }) => url)).toEqual([
        `https://demodb.dev/ovdb/v1/databases/${database}`,
        `https://demodb.dev/ovdb/v1/databases/${database}/dtql`,
      ]);
      expect(calls[1].init?.method).toBe('POST');
      expect(calls[1].init?.body).toBe(
        (definition.request as ITextQueryRequest).text,
      );
      expect(result.recordset.columns.map((column) => column.name)).toEqual([
        field,
      ]);
      expect(result.recordset.rows[0][0]).toEqual({ type: 'number', value });
      expect(result.totalRows).toBe(1);
    },
  );

  it('rejects a mismatched ordinary database identity before the query POST', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        id: 'adventureworks',
        capabilities: { dtql: true, read: true },
      }),
    );
    await expect(
      runFederatedQuery(
        createHostedDemoDbQuery('new-query'),
        undefined,
        '',
        undefined,
        undefined,
        'full',
        undefined,
        undefined,
        { fetch: fetcher },
      ),
    ).rejects.toThrow(/identity/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
