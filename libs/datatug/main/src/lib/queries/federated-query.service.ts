import { Injectable } from '@angular/core';
import type { TypedValue } from '@sneat/datatug-semantic';
import type { IQueryDef } from '../models/definition/query-def';
import type { StaticOvdbSource } from './sources/static-ovdb-fetch';
import type {
  FederatedQueryMode,
  FederatedQueryProgress,
  FederatedQueryResult,
  FederatedSourceLoaded,
} from './federated-query-executor';
import {
  cleanupOrphanedQueryDatabases,
  deleteQueryDatabase,
} from './federated-query-storage';
import { monotonicTime } from './public-data/bounded-run-budget';
import {
  associateLocalResult, deleteLocalResult, isCommittedLocalResult, listLocalResults,
  openLocalResult, readLocalResultPage, type LocalResultRef, type LocalResultScope,
} from './federated-local-results';
import type { IProjectRef } from '../core/project-context';
export type { LocalResultDescriptor, LocalResultRef, LocalResultScope } from './federated-local-results';

export type { FederatedQueryProgress } from './federated-query-executor';
export type {
  FederatedQueryResult,
  FederatedSourceLoaded,
} from './federated-query-executor';

/** Optional extras for one run: a per-source report, and a static data adapter to read from instead of an OVDB server. */
export interface FederatedRunExtras {
  readonly onHistoryError?: (message: string) => void;
  /** Absolute monotonic timestamp captured when the first output record is decoded. */
  readonly onFirstRecord?: (at: number) => void;
  readonly onSourceLoaded?: (event: FederatedSourceLoaded) => void;
  readonly staticSource?: StaticOvdbSource;
}

/** Keeps download, merge, and calculation off the browser UI thread. */
@Injectable({ providedIn: 'root' })
export class FederatedQueryService {
  private worker?: Worker;
  private stopBounded?: (error: Error) => Promise<void>;
  private runtimeExpired = false;
  private localResult?: LocalResultRef;
  private resultEpoch = 0;
  private runLifetime = 0;
  private cancelRun?: () => void;
  /** Catalog/storage failures remain visible to consumers; a retained artifact is
   * not erased merely because its compact catalog registration failed. */
  readonly historyErrors: string[] = [];
  readonly listLocalResults = (scope?: LocalResultScope, onUnavailable?: (message: string) => void) => listLocalResults(scope, (message) => { this.historyErrors.push(message); onUnavailable?.(message); });
  readonly openLocalResult = (id: string) => openLocalResult(id);
  async associateLocalResult(projectRef: IProjectRef, queryId: string, result: LocalResultRef): Promise<void> {
    if (!this.worker || this.runtimeExpired || this.localResult?.id !== result.id) return associateLocalResult(projectRef, queryId, result);
    if (this.sourceRequests.size || this.associationRequests.size) throw new Error('The current result is busy. Wait for its operation to finish.');
    const requestId = ++this.nextRequestId;
    return new Promise((resolve, reject) => { this.associationRequests.set(requestId, { resolve, reject }); this.worker?.postMessage({ type: 'associate-local', requestId, projectRef, queryId, localResult: result }); });
  }
  private readonly associationRequests = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  async deleteLocalResult(id: string): Promise<void> {
    if (this.localResult?.id === id) { await this.dispose(); this.localResult = undefined; }
    await deleteLocalResult(id);
  }
  private readonly sourceRequests = new Map<
    number,
    {
      resolve: (result: FederatedQueryResult) => void;
      reject: (error: Error) => void;
    }
  >();
  private nextRequestId = 0;
  private readonly pageRequests = new Map<
    number,
    { resolve: (rows: TypedValue[][]) => void; reject: (error: Error) => void }
  >();

  async run(
    definition: IQueryDef,
    onProgress?: (progress: FederatedQueryProgress) => void,
    token = '',
    mode: FederatedQueryMode = 'full',
    onFinished?: (totalRows: number) => void,
    extras: FederatedRunExtras = {},
  ): Promise<FederatedQueryResult> {
    // Capture the executed graph before the first await; editor mutations cannot
    // alter the identity that is later transferred to the Worker and persisted.
    if (definition.federation?.nativeGraph) definition = structuredClone(definition);
    // Detach the previous session synchronously, before installing this lifetime.
    // External disposal must also invalidate startup while cleanup is still pending.
    const previousCleanup = this.dispose();
    const lifetime = ++this.runLifetime;
    const cancelled = new Promise<never>((_resolve, reject) => {
      this.cancelRun = () => reject(new Error('The query was cancelled.'));
    });
    const current = (): boolean => lifetime === this.runLifetime;
    this.resultEpoch++;
    const boundedTimeout = definition.federation?.nativeGraph ? 10000 : definition.federation?.bounds?.timeoutMs;
    const runDeadline = definition.federation?.nativeGraph || definition.federation?.bounds?.runtime
      ? monotonicTime() + (boundedTimeout ?? 10000)
      : undefined;
    await Promise.race([previousCleanup, cancelled]);
    if (!current()) throw new Error('The query was cancelled.');
    if (typeof Worker === 'undefined')
      throw new Error(
        'This browser does not support query workers. Run this query in a supported browser to avoid locking the page.',
      );
    await Promise.race([cleanupOrphanedQueryDatabases(), cancelled]);
    if (!current()) throw new Error('The query was cancelled.');
    if (runDeadline !== undefined && monotonicTime() >= runDeadline)
      throw new Error(
        'The bounded lookup exceeded its deadline before execution.',
      );
    return Promise.race([cancelled, new Promise<FederatedQueryResult>((resolve, reject) => {
      const worker = new Worker(
        new URL('./federated-query.worker.ts', import.meta.url),
        { type: 'module' },
      );
      this.worker = worker;
      const storageId =
        runDeadline !== undefined
          ? `${Date.now()}-${crypto.randomUUID()}`
          : undefined;
      const ownedStorage = new Set<string>(
        storageId
          ? [`datatug-federated-${storageId}`, `datatug-output-${storageId}`]
          : [],
      );
      const graphRun = !!definition.federation?.nativeGraph;
      this.runtimeExpired = false;
      let resultReceived = false;
      // A worker can be busy in synchronous DALgo work: enforce the wall-clock
      // bound from the UI thread as well as aborting requests inside the worker.
      const deadline = boundedTimeout !== undefined
        ? setTimeout(
            () => {
              if (!current() || this.worker !== worker) return;
              if (
                runDeadline !== undefined &&
                resultReceived &&
                this.sourceRequests.size === 0
              ) {
                this.runtimeExpired = true;
                worker.postMessage({ type: 'expire-runtime' });
                return;
              }
              if (this.stopBounded) {
                void this.stopBounded(
                  new Error('The bounded lookup exceeded its deadline.'),
                ).catch(() => undefined);
                return;
              }
              worker.terminate();
              if (this.worker === worker) this.worker = undefined;
              reject(
                new Error(
                  'The bounded lookup exceeded its deadline. Temporary storage is cleaned before the next run.',
                ),
              );
            },
            runDeadline === undefined
              ? boundedTimeout
              : Math.max(0, runDeadline - monotonicTime()),
          )
        : undefined;
      const clearDeadline = (): void => {
        if (deadline !== undefined) clearTimeout(deadline);
      };
      if (runDeadline !== undefined)
        this.stopBounded = async (error) => {
          clearDeadline();
          worker.postMessage({ type: 'close' });
          worker.terminate();
          this.stopBounded = undefined;
          if (this.worker === worker) this.worker = undefined;
          for (const pending of this.pageRequests.values())
            pending.reject(error);
          this.pageRequests.clear();
          for (const pending of this.sourceRequests.values())
            pending.reject(error);
          this.sourceRequests.clear();
          this.rejectAssociations(error);
          try {
            await Promise.all(
              [...ownedStorage].map(async (name) => {
                if (graphRun && name.startsWith('datatug-output-') && await isCommittedLocalResult(name)) return;
                await deleteQueryDatabase(name);
              }),
            );
          } catch (cleanup) {
            const failure = new Error(
              `${error.message} Temporary storage cleanup failed: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`,
            );
            reject(failure);
            throw failure;
          }
          reject(error);
        };
      worker.onmessage = (
        event: MessageEvent<
          | { type: 'progress'; progress: FederatedQueryProgress }
          | { type: 'source'; event: FederatedSourceLoaded }
          | { type: 'first-record'; at: number }
          | { type: 'result'; result: FederatedQueryResult }
          | { type: 'error'; message: string }
          | { type: 'page'; requestId: number; rows: TypedValue[][] }
          | { type: 'page-error'; requestId: number; message: string }
          | { type: 'cleanup-error'; message: string }
          | { type: 'history-error'; message: string }
          | { type: 'associated'; requestId: number }
          | { type: 'association-error'; requestId: number; message: string }
          | { type: 'cancelled' }
          | { type: 'closed' }
          | { type: 'finished'; totalRows: number }
          | { type: 'storage'; name: string }
          | {
              type: 'source-result';
              requestId: number;
              result: FederatedQueryResult;
            }
          | { type: 'source-error'; requestId: number; message: string }
        >,
      ) => {
        const message = event.data;
        if (!current() || this.worker !== worker) return; // A stopped/previous Worker has no publication authority.
        if (message.type === 'associated' || message.type === 'association-error') {
          const pending = this.associationRequests.get(message.requestId); this.associationRequests.delete(message.requestId);
          if (message.type === 'associated') pending?.resolve(); else pending?.reject(new Error(message.message)); return;
        }
        if (message.type === 'history-error') { this.historyErrors.push(message.message); extras.onHistoryError?.(message.message); return; }
        if (
          message.type === 'source-result' ||
          message.type === 'source-error'
        ) {
          const pending = this.sourceRequests.get(message.requestId);
          this.sourceRequests.delete(message.requestId);
          if (message.type === 'source-result') {
            this.resultEpoch++;
            this.localResult = message.result.localResult;
            pending?.resolve(message.result);
          } else { this.runtimeExpired = true; pending?.reject(new Error(message.message)); }
          return;
        }
        if (message.type === 'storage') {
          if (
            storageId === undefined &&
            /^datatug-(?:federated|output)-\d+-[a-f0-9-]+$/.test(message.name)
          )
            ownedStorage.add(message.name);
          return;
        }
        if (message.type === 'progress') {
          onProgress?.(message.progress);
          return;
        }
        if (message.type === 'source') {
          extras.onSourceLoaded?.(message.event);
          return;
        }
        if (message.type === 'first-record') {
          if (Number.isFinite(message.at)) extras.onFirstRecord?.(message.at);
          return;
        }
        if (message.type === 'finished') {
          onFinished?.(message.totalRows);
          return;
        }
        if (message.type === 'cleanup-error') return;
        if (message.type === 'cancelled') {
          clearDeadline();
          reject(new Error('The query was cancelled.'));
          return;
        }
        if (message.type === 'page' || message.type === 'page-error') {
          const pending = this.pageRequests.get(message.requestId);
          this.pageRequests.delete(message.requestId);
          if (message.type === 'page') pending?.resolve(message.rows);
          else pending?.reject(new Error(message.message));
          return;
        }
        if (message.type === 'closed') {
          this.rejectAssociations(new Error('The result worker was closed.'));
          clearDeadline();
          worker.terminate();
          if (this.worker === worker) this.worker = undefined;
          return;
        }
        if (message.type === 'result') {
          this.resultEpoch++;
          this.localResult = message.result.localResult;
          resultReceived = true;
          if (runDeadline === undefined) clearDeadline();
          if (mode === 'full' && message.result.totalRows === undefined)
            void this.closeWorker().catch(() => undefined);
          resolve(message.result);
        } else {
          clearDeadline();
          void this.closeWorker().catch(() => undefined);
          reject(new Error(message.type === 'error' && typeof message.message === 'string' && message.message.trim() ? message.message : 'The query worker returned an unexpected or invalid protocol message.'));
        }
      };
      worker.onerror = (event) => {
        if (!current() || this.worker !== worker) return;
        clearDeadline();
        void this.closeWorker().catch(() => undefined);
        reject(new Error(event.message || 'The query worker failed.'));
      };
      worker.postMessage({
        type: 'run',
        definition,
        token,
        mode,
        ...(runDeadline !== undefined ? { deadline: runDeadline } : {}),
        ...(storageId !== undefined ? { storageId } : {}),
        ...(extras.staticSource ? { staticSource: extras.staticSource } : {}),
      });
    })]);
  }

  getPage(index: number, resultSet = 'affiliations', localResult?: LocalResultRef): Promise<TypedValue[][]> {
    const ref = localResult ?? this.localResult;
    if (ref) {
      const epoch = this.resultEpoch;
      return readLocalResultPage(ref, index, resultSet).then((rows) => {
        if ((!localResult && epoch !== this.resultEpoch) || (this.localResult?.id === ref.id && this.localResult.generation !== ref.generation)) throw new Error('The local result generation changed. Open the committed result again.');
        return rows;
      });
    }
    const worker = this.worker;
    if (!worker)
      return Promise.reject(new Error('The result pages are unavailable.'));
    const requestId = ++this.nextRequestId;
    return new Promise<TypedValue[][]>((resolve, reject) => {
      this.pageRequests.set(requestId, { resolve, reject });
      worker.postMessage({ type: 'page', index, requestId, ...(resultSet !== 'affiliations' ? { resultSet } : {}) });
    });
  }

  /** Explicit user action only; the worker retains the original run budget. */
  continueSource(
    sourceId: string,
    limit: number,
    offset: number,
  ): Promise<FederatedQueryResult> {
    const worker = this.worker;
    if (!worker || !this.stopBounded || this.runtimeExpired)
      return Promise.reject(
        new Error(
          'The bounded source continuation is unavailable or expired. Run explicitly again.',
        ),
      );
    if (this.sourceRequests.size || this.associationRequests.size)
      return Promise.reject(
        new Error('A source continuation is already running.'),
      );
    const requestId = ++this.nextRequestId;
    return new Promise((resolve, reject) => {
      this.sourceRequests.set(requestId, { resolve, reject });
      worker.postMessage({
        type: 'source-page',
        sourceId,
        limit,
        offset,
        requestId,
      });
    });
  }

  private rejectAssociations(error: Error): void {
    for (const pending of this.associationRequests.values()) pending.reject(error);
    this.associationRequests.clear();
  }

  async dispose(): Promise<void> {
    this.rejectAssociations(new Error('The query was cancelled.'));
    ++this.runLifetime;
    this.cancelRun?.(); this.cancelRun = undefined;
    await this.closeWorker();
  }

  /** Internal cleanup preserves the just-completed run promise. */
  private async closeWorker(): Promise<void> {
    this.rejectAssociations(new Error('The result worker was closed.'));
    if (this.stopBounded) {
      await this.stopBounded(new Error('The query was cancelled.'));
      return;
    }
    const worker = this.worker;
    if (!worker) return;
    this.worker = undefined;
    for (const pending of this.pageRequests.values())
      pending.reject(new Error('The result was closed.'));
    this.pageRequests.clear();
    await new Promise<void>((resolve, reject) => {
      let cleanupError: Error | undefined;
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('The result worker did not finish cleaning up.'));
      }, 10000);
      worker.addEventListener(
        'message',
        function onClosed(
          event: MessageEvent<{ type: string; message?: string }>,
        ) {
          if (event.data.type === 'cleanup-error') {
            cleanupError = new Error(
              event.data.message || 'Cannot remove temporary output.',
            );
            return;
          }
          if (event.data.type !== 'closed') return;
          clearTimeout(timeout);
          worker.removeEventListener('message', onClosed);
          worker.terminate();
          if (cleanupError) reject(cleanupError);
          else resolve();
        },
      );
      worker.postMessage({ type: 'close' });
    });
  }
}
