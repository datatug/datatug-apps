import { BoardQueryResults } from './board-query-results.service';
import type { FederatedQueryResult } from '../../queries/federated-query-executor';

const result = {
  recordset: { columns: [], rows: [] },
} as unknown as FederatedQueryResult;

describe('BoardQueryResults', () => {
  it('shares one execution between cards and subsequent mounted views', async () => {
    const cache = new BoardQueryResults();
    const execute = vi.fn(async () => result);
    const signal = new AbortController().signal;
    const [a, b] = await Promise.all([
      cache.read('board', 'query-revision', signal, true, execute),
      cache.read('board', 'query-revision', signal, true, execute),
    ]);
    expect(a).toBe(b);
    await cache.read('board', 'query-revision', signal, true, execute);
    expect(execute).toHaveBeenCalledOnce();
    await cache.read('board', 'query-revision', signal, false, execute);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('keeps a shared run alive until its final consumer cancels', async () => {
    const cache = new BoardQueryResults();
    const a = new AbortController();
    const b = new AbortController();
    let owned!: AbortSignal;
    const execute = vi.fn((signal: AbortSignal) => {
      owned = signal;
      return new Promise<FederatedQueryResult>(() => undefined);
    });
    const first = cache.read('board', 'query', a.signal, true, execute);
    const second = cache.read('board', 'query', b.signal, true, execute);
    await Promise.resolve();
    a.abort();
    await expect(first).rejects.toThrow();
    expect(owned.aborted).toBe(false);
    b.abort();
    await expect(second).rejects.toThrow();
    expect(owned.aborted).toBe(true);
  });

  it('invalidates held results on board or security context change and retries failures', async () => {
    const cache = new BoardQueryResults();
    const signal = new AbortController().signal;
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValue(result);
    await expect(
      cache.read('one', 'query', signal, true, execute),
    ).rejects.toThrow('Unavailable');
    await cache.read('one', 'query', signal, true, execute);
    await cache.read('two', 'query', signal, true, execute);
    expect(execute).toHaveBeenCalledTimes(3);
    cache.ngOnDestroy();
  });
});
