import { describe, expect, it, vi } from 'vitest';
import { createHostedDemoDbQuery } from './hosted-demo-db-query';
import { consumeOvdbOrdinaryQuery } from './ovdb-ordinary-execution';
import { FederatedSourceRights } from './federated-source-rights';

const rights = (): FederatedSourceRights =>
  new FederatedSourceRights(
    [{ database: 'chinook', name: 'Customer' }],
    new Map(),
  );

describe('ordinary OVDB result execution', () => {
  it('uses the worker direct-result sink after validating the complete envelope', async () => {
    const sink = vi.fn(async () => undefined);
    const result = await consumeOvdbOrdinaryQuery(
      Response.json({
        records: [{ data: { CustomerId: 1, FirstName: 'Ana' } }],
        columns: ['CustomerId', 'FirstName'],
        execution: { route: 'database' },
      }),
      createHostedDemoDbQuery('new-query'),
      'https://demodb.dev/ovdb',
      'chinook',
      rights(),
      undefined,
      undefined,
      undefined,
      { onNativeRecord: sink },
    );
    expect(sink).toHaveBeenCalledOnce();
    expect(sink).toHaveBeenCalledWith(
      { CustomerId: 1, FirstName: 'Ana' },
      undefined,
    );
    expect(result.nativeDirect).toBe(true);
    expect(result.totalRows).toBe(1);
    expect(result.recordset.rows).toEqual([]);
  });

  it('never stages rows from a malformed ordinary result', async () => {
    const sink = vi.fn(async () => undefined);
    await expect(
      consumeOvdbOrdinaryQuery(
        new Response('{"records":[{"data":{"CustomerId":1}}],"columns":[]}', {
          headers: { 'Content-Type': 'application/json' },
        }),
        createHostedDemoDbQuery('new-query'),
        'https://demodb.dev/ovdb',
        'chinook',
        rights(),
        undefined,
        undefined,
        undefined,
        { onNativeRecord: sink },
      ),
    ).rejects.toThrow(/invalid ordinary query result/);
    expect(sink).not.toHaveBeenCalled();
  });
});
