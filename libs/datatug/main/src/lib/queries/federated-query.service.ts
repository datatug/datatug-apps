import { Injectable } from '@angular/core';
import type { TypedValue } from '@sneat/datatug-semantic';
import type { IQueryDef } from '../models/definition/query-def';
import { runFederatedQuery, type FederatedQueryProgress, type FederatedQueryResult } from './federated-query-executor';

export type { FederatedQueryProgress } from './federated-query-executor';
export type { FederatedQueryResult } from './federated-query-executor';

/** Keeps download, merge, and calculation off the browser UI thread. */
@Injectable({ providedIn: 'root' })
export class FederatedQueryService {
  private worker?: Worker;
  private nextRequestId = 0;
  private readonly pageRequests = new Map<number, { resolve: (rows: TypedValue[][]) => void; reject: (error: Error) => void }>();

  async run(definition: IQueryDef, onProgress?: (progress: FederatedQueryProgress) => void, token = ''): Promise<FederatedQueryResult> {
    await this.dispose();
    if (typeof Worker === 'undefined') return runFederatedQuery(definition, onProgress, token);
    return new Promise<FederatedQueryResult>((resolve, reject) => {
      const worker = new Worker(new URL('./federated-query.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<
        | { type: 'progress'; progress: FederatedQueryProgress }
        | { type: 'result'; result: FederatedQueryResult }
        | { type: 'error'; message: string }
        | { type: 'page'; requestId: number; rows: TypedValue[][] }
        | { type: 'page-error'; requestId: number; message: string }
        | { type: 'cleanup-error'; message: string }
        | { type: 'cancelled' }
        | { type: 'closed' }
      >) => {
        const message = event.data;
        if (message.type === 'progress') { onProgress?.(message.progress); return; }
        if (message.type === 'cleanup-error') return;
        if (message.type === 'cancelled') { reject(new Error('The query was cancelled.')); return; }
        if (message.type === 'page' || message.type === 'page-error') {
          const pending = this.pageRequests.get(message.requestId);
          this.pageRequests.delete(message.requestId);
          if (message.type === 'page') pending?.resolve(message.rows);
          else pending?.reject(new Error(message.message));
          return;
        }
        if (message.type === 'closed') { worker.terminate(); if (this.worker === worker) this.worker = undefined; return; }
        if (message.type === 'result') {
          if (message.result.totalRows === undefined) void this.dispose().catch(() => undefined);
          resolve(message.result);
        } else {
          void this.dispose().catch(() => undefined);
          reject(new Error(message.message));
        }
      };
      worker.onerror = (event) => { void this.dispose().catch(() => undefined); reject(new Error(event.message || 'The query worker failed.')); };
      worker.postMessage({ type: 'run', definition, token });
    });
  }

  getPage(index: number): Promise<TypedValue[][]> {
    if (!this.worker) return Promise.reject(new Error('The result pages are unavailable.'));
    const requestId = ++this.nextRequestId;
    return new Promise<TypedValue[][]>((resolve, reject) => {
      this.pageRequests.set(requestId, { resolve, reject });
      this.worker!.postMessage({ type: 'page', index, requestId });
    });
  }

  async dispose(): Promise<void> {
    const worker = this.worker;
    if (!worker) return;
    this.worker = undefined;
    for (const pending of this.pageRequests.values()) pending.reject(new Error('The result was closed.'));
    this.pageRequests.clear();
    await new Promise<void>((resolve, reject) => {
      let cleanupError: Error | undefined;
      const timeout = setTimeout(() => { worker.terminate(); reject(new Error('The result worker did not finish cleaning up.')); }, 10000);
      worker.addEventListener('message', function onClosed(event: MessageEvent<{ type: string; message?: string }>) {
        if (event.data.type === 'cleanup-error') { cleanupError = new Error(event.data.message || 'Cannot remove temporary output.'); return; }
        if (event.data.type !== 'closed') return;
        clearTimeout(timeout);
        worker.removeEventListener('message', onClosed);
        worker.terminate();
        if (cleanupError) reject(cleanupError);
        else resolve();
      });
      worker.postMessage({ type: 'close' });
    });
  }
}
