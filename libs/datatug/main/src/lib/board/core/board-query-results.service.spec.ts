import { decodeResult } from '@sneat/datatug-semantic';
import fixture from '../../evidence/testdata/backend-v044-retained.json';
import { readRetainedSourcePin } from '../../evidence/retained-evidence-contract';
import {
  BoardQueryResults,
  boardExecutionCacheKey,
} from './board-query-results.service';
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
  it('shares and evicts the complete authenticated metadata/result pair together without a second execution', async () => {
    const cache = new BoardQueryResults(),
      controller = new AbortController();
    const pair = {
      result,
      hostedResponse: {
        result: decodeResult(fixture.query.result),
        queryRevision: 'revision',
        resultFingerprint: 'a'.repeat(64),
        sourcePin: readRetainedSourcePin(fixture.execution.sourcePin, {
          projectRef: {
            storeId: 'firestore',
            spaceID: 'fixture-space',
            projectId: 'fixture-project',
          },
          environment: 'demo',
          actor: 'reader',
        }),
      },
    };
    const execute = vi.fn(async () => pair);
    const first = await cache.readExecution(
      'actor/space/project/demo',
      'order11045',
      controller.signal,
      true,
      execute,
    );
    const second = await cache.readExecution(
      'actor/space/project/demo',
      'order11045',
      controller.signal,
      true,
      execute,
    );
    expect(first).toBe(second);
    expect(first.hostedResponse).toBe(pair.hostedResponse);
    expect(first.result).toBe(pair.result);
    expect(execute).toHaveBeenCalledOnce();
    await cache.readExecution(
      'other-actor/space/project/demo',
      'order11045',
      controller.signal,
      true,
      execute,
    );
    expect(execute).toHaveBeenCalledTimes(2);
    cache.ngOnDestroy();
  });

  it('never reuses a retained response across different operation owners', async () => {
    const cache = new BoardQueryResults(),
      controller = new AbortController(),
      first = vi.fn(async () => ({ result })),
      second = vi.fn(async () => ({ result })),
      base = { queryId: 'shipping/receipt', parameters: {} };
    await cache.readExecution(
      'actor/space/project/demo',
      boardExecutionCacheKey(base, 'operation-first'),
      controller.signal,
      true,
      first,
    );
    await cache.readExecution(
      'actor/space/project/demo',
      boardExecutionCacheKey(base, 'operation-second'),
      controller.signal,
      true,
      second,
    );
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    cache.ngOnDestroy();
  });

  it('aborts and evicts an in-flight authenticated metadata/result pair on explicit source invalidation', async () => {
    const cache = new BoardQueryResults();
    const caller = new AbortController();
    let owned!: AbortSignal;
    const execute = vi.fn(
      (signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          owned = signal;
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Source changed.', 'AbortError')),
            { once: true },
          );
        }),
    );
    const pending = cache.readExecution(
      'actor/space/project/demo',
      'order11045',
      caller.signal,
      true,
      execute,
    );
    await Promise.resolve();
    cache.invalidate();
    expect(owned.aborted).toBe(true);
    await expect(pending).rejects.toThrow('Source changed.');

    const replacement = vi.fn(async () => ({ result }));
    await cache.readExecution(
      'actor/space/project/demo',
      'order11045',
      caller.signal,
      true,
      replacement,
    );
    expect(replacement).toHaveBeenCalledOnce();
    cache.ngOnDestroy();
  });
});
