import { decodeResult } from '@sneat/datatug-semantic';
import fixture from '../../evidence/testdata/backend-v044-retained.json';
import { readRetainedSourcePin } from '../../evidence/retained-evidence-contract';
import {
  BoardQueryResults,
  PROJECT_CARD_RESULTS_OPTIONS,
  boardExecutionCacheKey,
  canonicalJson,
  cardResultKey,
  cardResultScope,
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

describe('BoardQueryResults bounds (project card cache)', () => {
  const signal = new AbortController().signal;
  const make = (extra = {}) => {
    const clock = { t: 0 };
    const cache = new BoardQueryResults({
      ...PROJECT_CARD_RESULTS_OPTIONS,
      now: () => clock.t,
      ...extra,
    });
    return { cache, clock };
  };
  const exec = () => vi.fn(async () => result);

  it('uses the dashboard defaults when no options are given', async () => {
    const cache = new BoardQueryResults();
    const e = exec();
    for (let i = 0; i < 13; i++)
      await cache.read('s', 'k' + i, signal, true, e);
    expect(cache.size).toBe(12);
    // the oldest was evicted, the newest kept
    await cache.read('s', 'k12', signal, true, e);
    expect(e).toHaveBeenCalledTimes(13);
    await cache.read('s', 'k0', signal, true, e);
    expect(e).toHaveBeenCalledTimes(14);
  });

  it('evicts least recently used beyond maxEntries', async () => {
    const { cache } = make({ maxEntries: 3 });
    const e = exec();
    for (const k of ['a', 'b', 'c']) await cache.read('s', k, signal, true, e);
    await cache.read('s', 'a', signal, true, e); // touch a: b is now oldest
    await cache.read('s', 'd', signal, true, e); // evicts b
    expect(e).toHaveBeenCalledTimes(4);
    await cache.read('s', 'a', signal, true, e);
    await cache.read('s', 'c', signal, true, e);
    await cache.read('s', 'd', signal, true, e);
    expect(e).toHaveBeenCalledTimes(4);
    await cache.read('s', 'b', signal, true, e);
    expect(e).toHaveBeenCalledTimes(5);
  });

  it('evicts by maxBytes', async () => {
    const big = {
      recordset: { columns: [], rows: ['x'.repeat(400)] },
    } as unknown as FederatedQueryResult;
    const { cache } = make({ maxBytes: 1000 });
    const e = vi.fn(async () => big);
    for (const k of ['a', 'b', 'c']) await cache.read('s', k, signal, true, e);
    expect(cache.bytes).toBeLessThanOrEqual(1000);
    expect(cache.size).toBe(2);
    await cache.read('s', 'a', signal, true, e);
    expect(e).toHaveBeenCalledTimes(4);
  });

  it('expires settled entries after ttlMs using the injected clock', async () => {
    const { cache, clock } = make({ ttlMs: 5 * 60_000 });
    const e = exec();
    await cache.read('s', 'k', signal, true, e);
    clock.t = 5 * 60_000 - 1;
    await cache.read('s', 'k', signal, true, e);
    expect(e).toHaveBeenCalledOnce();
    clock.t = 5 * 60_000;
    await cache.read('s', 'k', signal, true, e);
    expect(e).toHaveBeenCalledTimes(2);
    // a hit does not extend the entry's life
    clock.t = 5 * 60_000 + 10;
    await cache.read('s', 'k', signal, true, e);
    expect(e).toHaveBeenCalledTimes(2);
  });

  it('never serves another scope and does not clear it either', async () => {
    const { cache } = make();
    const e = exec();
    const p1 = cardResultScope({ actor: 'a', project: 'p1', environment: 'dev' });
    const p2 = cardResultScope({ actor: 'a', project: 'p2', environment: 'dev' });
    const prod = cardResultScope({ actor: 'a', project: 'p1', environment: 'prod' });
    await cache.read(p1, 'k', signal, true, e);
    await cache.read(p2, 'k', signal, true, e);
    await cache.read(prod, 'k', signal, true, e);
    expect(e).toHaveBeenCalledTimes(3);
    await cache.read(p1, 'k', signal, true, e);
    expect(e).toHaveBeenCalledTimes(3);
  });

  it('keeps a completed result when its last viewer leaves, aborts in-flight only without requesters', async () => {
    const { cache } = make();
    const e = exec();
    const a = new AbortController();
    await cache.read('s', 'k', a.signal, true, e);
    a.abort();
    await cache.read('s', 'k', signal, true, e);
    expect(e).toHaveBeenCalledOnce();
    let owned!: AbortSignal;
    const pending = vi.fn((s: AbortSignal) => {
      owned = s;
      return new Promise<FederatedQueryResult>(() => undefined);
    });
    const v1 = new AbortController();
    const v2 = new AbortController();
    const p1 = cache.read('s', 'slow', v1.signal, true, pending);
    const p2 = cache.read('s', 'slow', v2.signal, true, pending);
    await Promise.resolve();
    await Promise.resolve();
    expect(pending).toHaveBeenCalledOnce();
    v1.abort();
    await expect(p1).rejects.toThrow();
    expect(owned.aborted).toBe(false);
    v2.abort();
    await expect(p2).rejects.toThrow();
    expect(owned.aborted).toBe(true);
  });

  it('invalidates by key list and by predicate', async () => {
    const { cache } = make();
    const e = exec();
    for (const k of ['a', 'b', 'c']) await cache.read('s', k, signal, true, e);
    cache.invalidate(['a']);
    await cache.read('s', 'a', signal, true, e);
    await cache.read('s', 'b', signal, true, e);
    expect(e).toHaveBeenCalledTimes(4);
    cache.invalidate((key, scope) => scope === 's' && key !== 'c');
    await cache.read('s', 'c', signal, true, e);
    expect(e).toHaveBeenCalledTimes(4);
    await cache.read('s', 'b', signal, true, e);
    expect(e).toHaveBeenCalledTimes(5);
  });

  it('canonicalises keys: sorted, typed, null explicit, unset omitted', () => {
    expect(cardResultKey({ queryId: 'q', parameters: { b: 1, a: '2' } })).toBe(
      cardResultKey({ queryId: 'q', parameters: { a: '2', b: 1 } }),
    );
    expect(cardResultKey({ queryId: 'q', parameters: { id: '42' } })).not.toBe(
      cardResultKey({ queryId: 'q', parameters: { id: 42 } }),
    );
    expect(cardResultKey({ queryId: 'q', parameters: { id: null } })).not.toBe(
      cardResultKey({ queryId: 'q', parameters: {} }),
    );
    expect(cardResultKey({ queryId: 'q', parameters: { id: undefined } })).toBe(
      cardResultKey({ queryId: 'q', parameters: {} }),
    );
    expect(cardResultKey({ queryId: 'q', revision: 'r1' })).not.toBe(
      cardResultKey({ queryId: 'q', revision: 'r2' }),
    );
    expect(canonicalJson({ z: { y: 1, x: [{ b: 1, a: 2 }] } })).toBe(
      '{"z":{"x":[{"a":2,"b":1}],"y":1}}',
    );
  });

  it('shares an in-flight run between requesters of the same key', async () => {
    const { cache } = make();
    const e = exec();
    await Promise.all([
      cache.read('s', 'k', signal, true, e),
      cache.read('s', 'k', signal, true, e),
    ]);
    expect(e).toHaveBeenCalledOnce();
  });
});
