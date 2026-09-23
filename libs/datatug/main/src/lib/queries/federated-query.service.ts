import { Injectable } from '@angular/core';
import type { RunQueryResponse } from '@sneat/datatug-semantic';
import type { IQueryDef } from '../models/definition/query-def';
import { runFederatedQuery, type FederatedQueryProgress } from './federated-query-executor';

export type { FederatedQueryProgress } from './federated-query-executor';

/** Keeps download, merge, and calculation off the browser UI thread. */
@Injectable({ providedIn: 'root' })
export class FederatedQueryService {
  run(definition: IQueryDef, onProgress?: (progress: FederatedQueryProgress) => void, token = ''): Promise<RunQueryResponse> {
    if (typeof Worker === 'undefined') return runFederatedQuery(definition, onProgress, token);
    return new Promise<RunQueryResponse>((resolve, reject) => {
      const worker = new Worker(new URL('./federated-query.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<
        | { type: 'progress'; progress: FederatedQueryProgress }
        | { type: 'result'; result: RunQueryResponse }
        | { type: 'error'; message: string }
      >) => {
        const message = event.data;
        if (message.type === 'progress') { onProgress?.(message.progress); return; }
        worker.terminate();
        if (message.type === 'result') resolve(message.result);
        else reject(new Error(message.message));
      };
      worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message || 'The query worker failed.')); };
      worker.postMessage({ definition, token });
    });
  }
}
