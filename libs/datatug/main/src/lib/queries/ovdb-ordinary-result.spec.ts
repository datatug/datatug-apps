import { describe, expect, it } from 'vitest';
import { readOvdbOrdinaryResult } from './ovdb-ordinary-result';

const response = (body: string): Response =>
  new Response(body, { headers: { 'Content-Type': 'application/json' } });

describe('released OVDB ordinary DTQL result', () => {
  it('reads the complete released envelope without inventing a stream footer', async () => {
    const result = await readOvdbOrdinaryResult(
      response(
        JSON.stringify({
          records: [{ data: { CustomerId: 1, FirstName: 'Ana' } }],
          columns: ['CustomerId', 'FirstName'],
          execution: { route: 'database', rowsReturned: 1 },
        }),
      ),
    );
    expect(result.columns).toEqual(['CustomerId', 'FirstName']);
    expect(result.records).toEqual([
      { data: { CustomerId: 1, FirstName: 'Ana' } },
    ]);
    expect(result.evidence['execution']).toEqual({
      route: 'database',
      rowsReturned: 1,
    });
  });

  it('refuses truncated, inconsistent and lossy results before exposing rows', async () => {
    const bodies = [
      '{"records":[{"data":{"id":1}}],"columns":["id"],"execution":',
      '{"records":[{"data":{"id":1}}],"columns":["other"],"execution":{}}',
      '{"records":[{"data":{"id":9007199254740993}}],"columns":["id"],"execution":{}}',
      '{"records":[],"columns":[],"execution":{},"complete":false}',
      '{"records":[],"columns":[],"execution":{},"complete":"yes"}',
    ];
    for (const body of bodies)
      await expect(readOvdbOrdinaryResult(response(body))).rejects.toThrow();
  });

  it('bounds the response independently of Content-Length', async () => {
    const large = 'x'.repeat(8 * 1024 * 1024 + 1);
    await expect(readOvdbOrdinaryResult(response(large))).rejects.toThrow(
      /browser limit/,
    );
  });

  it('stops a stalled response when the caller aborts', async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>();
    const reading = readOvdbOrdinaryResult(
      new Response(body, {
        headers: { 'Content-Type': 'application/json' },
      }),
      controller.signal,
    );
    controller.abort(new Error('query cancelled'));
    await expect(reading).rejects.toThrow('query cancelled');
  });
});
