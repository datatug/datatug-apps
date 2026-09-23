import type { TypedValue } from '@sneat/datatug-semantic';
import type { IQueryDef } from '../models/definition/query-def';
import { runFederatedQuery } from './federated-query-executor';

let outputDb: IDBDatabase | undefined;
let outputName: string | undefined;
let activeRun: Promise<void> | undefined;
let controller: AbortController | undefined;
let closing = false;

async function openOutput(): Promise<IDBDatabase> {
  if (outputDb) return outputDb;
  outputName = `datatug-output-${crypto.randomUUID()}`;
  outputDb = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(outputName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('rows', { autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Cannot open temporary output table.'));
  });
  return outputDb;
}

async function storeRows(rows: readonly (readonly TypedValue[])[]): Promise<void> {
  if (!rows.length) return;
  if (closing) throw new Error('The query was cancelled.');
  const db = await openOutput();
  if (closing) throw new Error('The query was cancelled.');
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('rows', 'readwrite');
    for (const row of rows) transaction.objectStore('rows').add(row);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Cannot store result page.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Result page storage aborted.'));
  });
}

async function readPage(index: number): Promise<TypedValue[][]> {
  if (!outputDb || !Number.isSafeInteger(index) || index < 0) throw new Error('Result page is unavailable.');
  const start = index * 100 + 1;
  if (!Number.isSafeInteger(start)) throw new Error('Result page is out of range.');
  return await new Promise<TypedValue[][]>((resolve, reject) => {
    const transaction = outputDb!.transaction('rows', 'readonly');
    const request = transaction.objectStore('rows').getAll(IDBKeyRange.bound(start, start + 99));
    request.onsuccess = () => resolve(request.result as TypedValue[][]);
    request.onerror = () => reject(request.error ?? new Error('Cannot read result page.'));
  });
}

async function closeOutput(): Promise<void> {
  outputDb?.close();
  outputDb = undefined;
  if (!outputName) return;
  const name = outputName;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Cannot remove temporary output table.'));
    request.onblocked = () => reject(new Error('Temporary output table is still open.'));
  });
  outputName = undefined;
}

self.onmessage = (event: MessageEvent<
  | { type: 'run'; definition: IQueryDef; token: string }
  | { type: 'page'; index: number; requestId: number }
  | { type: 'close' }
>): void => {
  const message = event.data;
  if (message.type === 'page') {
    void readPage(message.index)
      .then((rows) => self.postMessage({ type: 'page', requestId: message.requestId, rows }))
      .catch((error: unknown) => self.postMessage({ type: 'page-error', requestId: message.requestId, message: error instanceof Error ? error.message : 'Cannot read result page.' }));
    return;
  }
  if (message.type === 'close') {
    const wasRunning = activeRun !== undefined;
    closing = true;
    controller?.abort();
    void (async () => {
      await activeRun;
      if (wasRunning) self.postMessage({ type: 'cancelled' });
      try { await closeOutput(); }
      catch (error) { self.postMessage({ type: 'cleanup-error', message: error instanceof Error ? error.message : 'Cannot remove temporary output.' }); }
      self.postMessage({ type: 'closed' });
    })();
    return;
  }
  closing = false;
  controller = new AbortController();
  activeRun = (async () => {
    try {
      await closeOutput();
      const result = await runFederatedQuery(message.definition, (progress) => self.postMessage({ type: 'progress', progress }), message.token, storeRows, controller!.signal);
      if (!closing) self.postMessage({ type: 'result', result });
    } catch (error) {
      let messageText = error instanceof Error ? error.message : 'The query failed.';
      try { await closeOutput(); }
      catch (cleanupError) { messageText += `; cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`; }
      if (!closing) self.postMessage({ type: 'error', message: messageText });
    } finally {
      activeRun = undefined;
      controller = undefined;
    }
  })();
};
