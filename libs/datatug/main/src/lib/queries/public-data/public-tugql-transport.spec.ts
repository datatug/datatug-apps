import { describe, expect, it, vi } from 'vitest';
import { executePublicTugql, type PublicTugqlSource } from './public-tugql-transport';

const source: PublicTugqlSource = {
  endpoint: 'https://cloud.openvaultdb.com/v1/databases/northwind-postgresql/tugql',
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

describe('public TugQL transport', () => {
  function observedResponse(body: BodyInit) {
    const response = new Response(body, { status: 200 });
    if (!response.body) throw new Error('Missing response body');
    const reader = response.body.getReader();
    const cancel = vi.spyOn(reader, 'cancel');
    const release = vi.spyOn(reader, 'releaseLock');
    vi.spyOn(response.body, 'getReader').mockReturnValue(reader);
    const fetch: typeof globalThis.fetch = async () => response;
    return { reader, cancel, release, fetch };
  }

  it('releases a fully consumed response without cancelling its completed reader', async () => {
    const observed = observedResponse(JSON.stringify(result));
    const executed = await executePublicTugql('query', source, { fetch: observed.fetch });
    expect(executed.rowsReturned).toBe(1);
    expect(observed.cancel).not.toHaveBeenCalled();
    expect(observed.release).toHaveBeenCalledOnce();
  });

  it('releases EOF even when the complete bytes fail JSON validation, without accepting them', async () => {
    const observed = observedResponse('not JSON');
    await expect(executePublicTugql('query', source, { fetch: observed.fetch })).rejects.toThrow('malformed JSON');
    expect(observed.cancel).not.toHaveBeenCalled();
    expect(observed.release).toHaveBeenCalledOnce();
  });

  it('cancels an incomplete oversized response instead of admitting any rows', async () => {
    const observed = observedResponse(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1_000_001)); } }));
    await expect(executePublicTugql('query', source, { fetch: observed.fetch })).rejects.toThrow('browser limit');
    expect(observed.cancel).toHaveBeenCalledOnce();
    await observed.cancel.mock.results[0].value.catch(() => undefined);
    await Promise.resolve();
    expect(observed.release).toHaveBeenCalledOnce();
  });

  it('cancels unread bytes after a user abort, preserving the cancellation error', async () => {
    const controller = new AbortController();
    const observed = observedResponse(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode('{')); } }));
    const read = observed.reader.read.bind(observed.reader);
    vi.spyOn(observed.reader, 'read').mockImplementationOnce(async () => {
      const chunk = await read(); controller.abort(); return chunk;
    });
    await expect(executePublicTugql('query', source, { fetch: observed.fetch, signal: controller.signal })).rejects.toThrow('cancelled');
    expect(observed.cancel).toHaveBeenCalledOnce();
    await observed.cancel.mock.results[0].value.catch(() => undefined);
    await Promise.resolve();
    expect(observed.release).toHaveBeenCalledOnce();
  });

  it('cancels a failed body reader and preserves its error', async () => {
    const failure = new Error('body read failed');
    const observed = observedResponse(new ReadableStream({ start(stream) { stream.error(failure); } }));
    await expect(executePublicTugql('query', source, { fetch: observed.fetch })).rejects.toBe(failure);
    expect(observed.cancel).toHaveBeenCalledOnce();
    await observed.cancel.mock.results[0].value.catch(() => undefined);
    await Promise.resolve();
    expect(observed.release).toHaveBeenCalledOnce();
  });

  it('retains the independently observed physical source and complete rows', async () => {
    const executed = await executePublicTugql('from: {name: Orders}\n', source, { fetch: transport(result) });
    expect(executed.records[0].data['orders']).toBe(56);
    expect(executed.executionSources).toEqual(result.execution.sources);
    expect(executed.complete).toBe(true);
  });

  it('rejects missing source, partial pages and changed columns', async () => {
    await expect(executePublicTugql('query', source, { fetch: transport({ ...result, execution: undefined }) }))
      .rejects.toThrow(/omitted/);
    await expect(executePublicTugql('query', source, { fetch: transport({ ...result, nextCursor: 'next' }) }))
      .rejects.toThrow(/incomplete/);
    await expect(executePublicTugql('query', source, { fetch: transport({ ...result, columns: ['orders', 'ShipCountry'] }) }))
      .rejects.toThrow(/columns/);
  });

  it('rejects a non-integer or non-finite saved row limit before fetching', async () => {
    for (const maxRows of [NaN, Infinity, 1.5]) {
      await expect(executePublicTugql('query', { ...source, maxRows }, { fetch: transport(result) }))
        .rejects.toThrow(/browser execution policy/);
    }
  });
});
