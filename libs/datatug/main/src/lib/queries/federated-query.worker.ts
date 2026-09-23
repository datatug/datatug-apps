import type { IQueryDef } from '../models/definition/query-def';
import { runFederatedQuery } from './federated-query-executor';

self.onmessage = (event: MessageEvent<{ definition: IQueryDef; token: string }>): void => {
  void runFederatedQuery(event.data.definition, (progress) => self.postMessage({ type: 'progress', progress }), event.data.token)
    .then((result) => self.postMessage({ type: 'result', result }))
    .catch((error: unknown) => self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'The query failed.' }));
};
