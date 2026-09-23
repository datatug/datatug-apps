import type { TypedValue } from '@sneat/datatug-semantic';
import type { IQueryDef } from '../models/definition/query-def';
import { runFederatedQuery, type FederatedQueryMode, type FederatedQueryResult } from './federated-query-executor';
import { deleteQueryDatabase, queryStorageError } from './federated-query-storage';

let outputDb: IDBDatabase | undefined;
let outputName: string | undefined;
let activeRun: Promise<void> | undefined;
let controller: AbortController | undefined;
let closing = false;
let visibleMode = false;
let rowsStored = 0;
let resultReady = false;
let resumePage: (() => void) | undefined;
let pendingPage: { index: number; requestId: number } | undefined;

async function openOutput(): Promise<IDBDatabase> {
  if (outputDb) return outputDb;
  const name = `datatug-output-${Date.now()}-${crypto.randomUUID()}`;
  outputName = name;
  outputDb = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('rows', { autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(queryStorageError(request.error));
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
    transaction.onerror = () => reject(queryStorageError(transaction.error));
    transaction.onabort = () => reject(queryStorageError(transaction.error));
  });
  rowsStored += rows.length;
}

async function sendPendingPage(): Promise<void> {
  const pending = pendingPage;
  if (!pending || pending.index * 100 >= rowsStored && activeRun) return;
  pendingPage = undefined;
  try { self.postMessage({ type: 'page', requestId: pending.requestId, rows: await readPage(pending.index) }); }
  catch (error) { self.postMessage({ type: 'page-error', requestId: pending.requestId, message: error instanceof Error ? error.message : 'Cannot read result page.' }); }
}

async function readPage(index: number): Promise<TypedValue[][]> {
  const db = outputDb;
  if (!db || !Number.isSafeInteger(index) || index < 0) throw new Error('Result page is unavailable.');
  const start = index * 100 + 1;
  if (!Number.isSafeInteger(start)) throw new Error('Result page is out of range.');
  return await new Promise<TypedValue[][]>((resolve, reject) => {
    const transaction = db.transaction('rows', 'readonly');
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
  await deleteQueryDatabase(name);
  outputName = undefined;
}

self.onmessage = (event: MessageEvent<
  | { type: 'run'; definition: IQueryDef; token: string; mode?: FederatedQueryMode }
  | { type: 'page'; index: number; requestId: number }
  | { type: 'close' }
>): void => {
  const message = event.data;
  if (message.type === 'page') {
    if (visibleMode && message.index * 100 >= rowsStored && activeRun) {
      pendingPage = { index: message.index, requestId: message.requestId };
      resumePage?.();
      resumePage = undefined;
      return;
    }
    void readPage(message.index)
      .then((rows) => self.postMessage({ type: 'page', requestId: message.requestId, rows }))
      .catch((error: unknown) => self.postMessage({ type: 'page-error', requestId: message.requestId, message: error instanceof Error ? error.message : 'Cannot read result page.' }));
    return;
  }
  if (message.type === 'close') {
    const wasRunning = activeRun !== undefined;
    closing = true;
    controller?.abort();
    resumePage?.();
    resumePage = undefined;
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
  visibleMode = message.mode === 'visible';
  rowsStored = 0;
  resultReady = false;
  controller = new AbortController();
  const runController = controller;
  activeRun = (async () => {
    try {
      await closeOutput();
      const result = await runFederatedQuery(message.definition, (progress) => self.postMessage({ type: 'progress', progress }), message.token, storeRows, runController.signal,
        message.mode ?? 'full', (first: FederatedQueryResult) => {
          if (!resultReady && !closing) { resultReady = true; self.postMessage({ type: 'result', result: first }); }
          void sendPendingPage();
        }, () => new Promise<void>((resolve) => { resumePage = resolve; if (pendingPage) { resumePage(); resumePage = undefined; } }));
      if (!closing && !resultReady) self.postMessage({ type: 'result', result: visibleMode ? { ...result, totalRows: rowsStored, hasMore: false } : result });
      if (!closing && visibleMode) { self.postMessage({ type: 'finished', totalRows: result.totalRows ?? rowsStored }); void sendPendingPage(); }
    } catch (error) {
      let messageText = error instanceof Error ? error.message : 'The query failed.';
      try { await closeOutput(); }
      catch (cleanupError) { messageText += `; cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`; }
      if (!closing) self.postMessage({ type: 'error', message: messageText });
    } finally {
      activeRun = undefined;
      controller = undefined;
      void sendPendingPage();
    }
  })();
};
