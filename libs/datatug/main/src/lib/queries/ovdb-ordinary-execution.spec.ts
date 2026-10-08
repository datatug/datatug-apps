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
    const firstRecord = vi.fn();
    const events: string[] = [];
    firstRecord.mockImplementation(() => events.push('first-record'));
    sink.mockImplementation(async () => { events.push('stage-record'); });
    const result = await consumeOvdbOrdinaryQuery(
      Response.json({
        records: [
          { data: { CustomerId: 1, FirstName: 'Ana' } },
          { data: { CustomerId: 2, FirstName: 'Bea' } },
        ],
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
      { onFirstRecord: firstRecord, onNativeRecord: sink },
    );
    expect(firstRecord).toHaveBeenCalledOnce();
    expect(sink).toHaveBeenCalledTimes(2);
    expect(events[0]).toBe('first-record');
    expect(sink).toHaveBeenCalledWith(
      { CustomerId: 1, FirstName: 'Ana' },
      undefined,
    );
    expect(result.nativeDirect).toBe(true);
    expect(result.totalRows).toBe(2);
    expect(result.recordset.rows).toEqual([]);
  });

  it('never stages rows from a malformed ordinary result', async () => {
    const sink = vi.fn(async () => undefined);
    const firstRecord = vi.fn();
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
        { onFirstRecord: firstRecord, onNativeRecord: sink },
      ),
    ).rejects.toThrow(/invalid ordinary query result/);
    expect(sink).not.toHaveBeenCalled();
    expect(firstRecord).not.toHaveBeenCalled();
  });

  it('does not report a first record for an empty ordinary result', async () => {
    const firstRecord = vi.fn();
    const result = await consumeOvdbOrdinaryQuery(
      Response.json({ records: [], columns: ['CustomerId'], execution: {} }),
      createHostedDemoDbQuery('new-query'),
      'https://demodb.dev/ovdb',
      'chinook',
      rights(),
      undefined,
      undefined,
      undefined,
      { onFirstRecord: firstRecord },
    );

    expect(result.totalRows).toBe(0);
    expect(firstRecord).not.toHaveBeenCalled();
  });
});
