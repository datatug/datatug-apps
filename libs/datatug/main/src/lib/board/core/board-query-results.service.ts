import type { HostedQueryResponse } from '../../detective/detective-client.service';
import {
  Inject,
  Injectable,
  InjectionToken,
  OnDestroy,
  Optional,
} from '@angular/core';
import type { FederatedQueryResult } from '../../queries/federated-query-executor';

export interface BoardHeldExecution {
  readonly result: FederatedQueryResult;
  readonly hostedResponse?: HostedQueryResponse;
}
export function boardExecutionCacheKey(
  value: Readonly<Record<string, unknown>>,
  operationId?: string,
): string {
  return JSON.stringify({
    ...value,
    // A retained receipt can confirm only the dispatch that carried this ID.
    // Current hosted intents therefore cannot borrow another card's response.
    ...(operationId ? { operationId } : {}),
  });
}

/** Bounds and collaborators of one result cache. */
export interface BoardQueryResultsOptions {
  /** Maximum retained runs (settled + in flight). Default 12. */
  readonly maxEntries?: number;
  /** Maximum retained settled bytes (JSON size). Default 8 MB. */
  readonly maxBytes?: number;
  /** Settled results older than this are dropped on read. Default: no expiry. */
  readonly ttlMs?: number;
  /** Injectable clock, milliseconds. Default `Date.now`. */
  readonly now?: () => number;
  /**
   * When true, entries live under `scope + key` and a scope change leaves
   * other scopes' entries alone (they simply never hit). When false (the
   * dashboard default) a scope change clears everything.
   */
  readonly partitionByScope?: boolean;
}

export const BOARD_QUERY_RESULTS_OPTIONS =
  new InjectionToken<BoardQueryResultsOptions>('BOARD_QUERY_RESULTS_OPTIONS');

/** Bounds of the project-scoped cache shared by cards beside grids. */
export const PROJECT_CARD_RESULTS_OPTIONS: BoardQueryResultsOptions = {
  maxEntries: 200,
  maxBytes: 32 * 1024 * 1024,
  ttlMs: 5 * 60 * 1000,
  partitionByScope: true,
};

/** A project-scoped cache for cards: 200 entries, 32 MB, 5 minutes, LRU. */
export const PROJECT_CARD_RESULTS = new InjectionToken<BoardQueryResults>(
  'PROJECT_CARD_RESULTS',
  {
    providedIn: 'root',
    factory: () => new BoardQueryResults(PROJECT_CARD_RESULTS_OPTIONS),
  },
);

const sortedJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = sortedJson(item);
    }
    return out;
  }
  return value;
};

/** JSON with recursively sorted keys; types preserved, `null` explicit, `undefined` omitted. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortedJson(value));
}

/** The cache scope of a card run: actor + project + environment. */
export function cardResultScope(parts: {
  actor?: string;
  project: string;
  environment?: string;
}): string {
  return canonicalJson({
    actor: parts.actor ?? '',
    project: parts.project,
    environment: parts.environment ?? '',
  });
}

/**
 * Cache key of one saved-query run for a card (spec REQ: result-cache):
 * query id, revision when the backend supplies one, and the bound
 * parameters canonicalised as sorted-key JSON (`"42"` and `42` differ;
 * unset parameters are omitted by passing them as `undefined`).
 */
export function cardResultKey(parts: {
  queryId: string;
  revision?: string;
  /** Anything else that versions the result when no revision exists (query definition, runtime). */
  variant?: string;
  parameters?: Readonly<Record<string, unknown>>;
}): string {
  return canonicalJson({
    queryId: parts.queryId,
    revision: parts.revision,
    variant: parts.variant,
    parameters: parts.parameters ?? {},
  });
}

interface HeldRun {
  readonly scope: string;
  readonly key: string;
  readonly controller: AbortController;
  result: Promise<BoardHeldExecution>;
  users: number;
  settled: boolean;
  settledAt: number;
  bytes: number;
}

/** One board owns a bounded set of held results. Every caller still revalidates
 * its card and saved definition before asking to share execution. */
@Injectable()
export class BoardQueryResults implements OnDestroy {
  private scope = '';
  private readonly runs = new Map<string, HeldRun>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly ttlMs: number | undefined;
  private readonly now: () => number;
  private readonly partition: boolean;

  // Constructor injection on purpose: the cache is also built directly with
  // `new BoardQueryResults(options)` (project-scoped factory, tests), where
  // `inject()` has no injection context.
  constructor(
    @Optional()
    @Inject(BOARD_QUERY_RESULTS_OPTIONS)
    // eslint-disable-next-line @angular-eslint/prefer-inject
    options?: BoardQueryResultsOptions | null,
  ) {
    this.maxEntries = options?.maxEntries ?? 12;
    this.maxBytes = options?.maxBytes ?? 8 * 1024 * 1024;
    this.ttlMs = options?.ttlMs;
    this.now = options?.now ?? (() => Date.now());
    this.partition = options?.partitionByScope ?? false;
  }

  /** Number of retained runs (settled and in flight). */
  get size(): number {
    return this.runs.size;
  }

  /** Total JSON bytes of the settled runs. */
  get bytes(): number {
    let sum = 0;
    for (const run of this.runs.values()) sum += run.bytes;
    return sum;
  }

  /**
   * With no argument drops everything (aborting in-flight runs). With a list
   * of keys, or a predicate over `(key, scope)`, drops only the matching
   * entries (aborting matching in-flight runs). In-flight runs that still
   * have requesters keep serving them but are no longer cached.
   */
  invalidate(
    which?: readonly string[] | ((key: string, scope: string) => boolean),
  ): void {
    if (which === undefined) {
      this.clear();
      return;
    }
    const test = Array.isArray(which)
      ? (key: string) => (which as readonly string[]).includes(key)
      : (which as (key: string, scope: string) => boolean);
    for (const [id, run] of [...this.runs]) {
      if (!test(run.key, run.scope)) continue;
      this.runs.delete(id);
      if (!run.settled) run.controller.abort();
    }
  }

  async read(
    scope: string,
    key: string,
    signal: AbortSignal,
    reuse: boolean,
    execute: (signal: AbortSignal) => Promise<FederatedQueryResult>,
  ): Promise<FederatedQueryResult> {
    return (
      await this.readExecution(scope, key, signal, reuse, async (owned) => ({
        result: await execute(owned),
      }))
    ).result;
  }

  private id(scope: string, key: string): string {
    return this.partition ? JSON.stringify([scope, key]) : key;
  }

  private expired(run: HeldRun): boolean {
    return (
      run.settled &&
      this.ttlMs !== undefined &&
      this.now() - run.settledAt >= this.ttlMs
    );
  }

  async readExecution(
    scope: string,
    key: string,
    signal: AbortSignal,
    reuse: boolean,
    execute: (signal: AbortSignal) => Promise<BoardHeldExecution>,
  ): Promise<BoardHeldExecution> {
    signal.throwIfAborted();
    if (!this.partition && scope !== this.scope) {
      this.clear();
      this.scope = scope;
    }
    const id = this.id(scope, key);
    const previous = this.runs.get(id);
    if (previous?.settled && (!reuse || this.expired(previous)))
      this.runs.delete(id);
    let run = this.runs.get(id);
    if (run) {
      // Least recently used: a hit moves the entry to the newest position.
      this.runs.delete(id);
      this.runs.set(id, run);
    } else {
      this.sweep();
      if (this.runs.size >= this.maxEntries) {
        const oldest = [...this.runs].find(
          ([, candidate]) => candidate.settled,
        );
        if (!oldest)
          throw new Error(
            'Too many board queries are running. Wait for one to finish.',
          );
        this.runs.delete(oldest[0]);
      }
      const controller = new AbortController();
      const entry: HeldRun = {
        scope,
        key,
        controller,
        users: 0,
        settled: false,
        settledAt: 0,
        bytes: 0,
        result: undefined as unknown as Promise<BoardHeldExecution>,
      };
      entry.result = Promise.resolve()
        .then(() => execute(controller.signal))
        .then(
          (result) => {
            entry.settled = true;
            entry.settledAt = this.now();
            entry.bytes = new TextEncoder().encode(
              JSON.stringify(result),
            ).byteLength;
            this.trim();
            return result;
          },
          (error: unknown) => {
            if (this.runs.get(id) === entry) this.runs.delete(id);
            throw error;
          },
        );
      this.runs.set(id, entry);
      run = entry;
    }
    run.users++;
    const owned = run;
    try {
      return await new Promise<BoardHeldExecution>((resolve, reject) => {
        const abort = () =>
          reject(new DOMException('The board context changed.', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        void owned.result
          .then(resolve, reject)
          .finally(() => signal.removeEventListener('abort', abort));
        if (signal.aborted) abort();
      });
    } finally {
      owned.users--;
      // Completed results stay cached when the last viewer leaves; only an
      // in-flight run with no requester left is aborted.
      if (!owned.settled && owned.users === 0) {
        owned.controller.abort();
        if (this.runs.get(id) === owned) this.runs.delete(id);
      }
    }
  }

  /** Drops expired settled runs. */
  private sweep(): void {
    for (const [id, run] of [...this.runs])
      if (this.expired(run)) this.runs.delete(id);
  }

  private trim(): void {
    this.sweep();
    let bytes = this.bytes;
    for (const [id, run] of [...this.runs]) {
      if (this.runs.size <= this.maxEntries && bytes <= this.maxBytes) break;
      if (!run.settled) continue;
      this.runs.delete(id);
      bytes -= run.bytes;
    }
  }

  private clear(): void {
    for (const run of this.runs.values()) run.controller.abort();
    this.runs.clear();
  }
  ngOnDestroy(): void {
    this.clear();
  }
}
