import type { HostedQueryResponse } from '../../detective/detective-client.service';
import { Injectable, OnDestroy } from '@angular/core';
import type { FederatedQueryResult } from '../../queries/federated-query-executor';

export interface BoardHeldExecution { readonly result: FederatedQueryResult; readonly hostedResponse?: HostedQueryResponse; }

interface HeldRun {
  readonly controller: AbortController;
  readonly result: Promise<BoardHeldExecution>;
  users: number;
  settled: boolean;
  bytes: number;
}

/** One board owns a bounded set of held results. Every caller still revalidates
 * its card and saved definition before asking to share execution. */
@Injectable()
export class BoardQueryResults implements OnDestroy {
  private scope = '';
  private readonly runs = new Map<string, HeldRun>();

  async read(
    scope: string, key: string, signal: AbortSignal, reuse: boolean,
    execute: (signal: AbortSignal) => Promise<FederatedQueryResult>,
  ): Promise<FederatedQueryResult> {
    return (await this.readExecution(scope, key, signal, reuse, async (owned) => ({ result: await execute(owned) }))).result;
  }

  async readExecution(
    scope: string,
    key: string,
    signal: AbortSignal,
    reuse: boolean,
    execute: (signal: AbortSignal) => Promise<BoardHeldExecution>,
  ): Promise<BoardHeldExecution> {
    signal.throwIfAborted();
    if (scope !== this.scope) {
      this.clear();
      this.scope = scope;
    }
    if (!reuse) {
      const previous = this.runs.get(key);
      if (previous?.settled) this.runs.delete(key);
    }
    let run = this.runs.get(key);
    if (!run) {
      if (this.runs.size >= 12) {
        const oldest = [...this.runs].find(([, candidate]) => candidate.settled);
        if (!oldest) throw new Error('Too many board queries are running. Wait for one to finish.');
        this.runs.delete(oldest[0]);
      }
      const controller = new AbortController();
      const entry: HeldRun = {
        controller,
        users: 0,
        settled: false,
        bytes: 0,
        result: Promise.resolve()
          .then(() => execute(controller.signal))
          .then(
            (result) => {
              entry.settled = true;
              entry.bytes = new TextEncoder().encode(
                JSON.stringify(result),
              ).byteLength;
              this.trim();
              return result;
            },
            (error: unknown) => {
              if (this.runs.get(key) === entry) this.runs.delete(key);
              throw error;
            },
          ),
      };
      this.runs.set(key, entry);
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
      if (!owned.settled && owned.users === 0) {
        owned.controller.abort();
        if (this.runs.get(key) === owned) this.runs.delete(key);
      }
    }
  }

  private trim(): void {
    let bytes = [...this.runs.values()].reduce(
      (sum, run) => sum + run.bytes,
      0,
    );
    for (const [key, run] of this.runs) {
      if (this.runs.size <= 12 && bytes <= 8 * 1024 * 1024) break;
      if (!run.settled) continue;
      this.runs.delete(key);
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
