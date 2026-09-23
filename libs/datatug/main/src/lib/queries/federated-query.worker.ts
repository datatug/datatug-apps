import type { TypedValue } from '@sneat/datatug-semantic';
import type { IQueryDef } from '../models/definition/query-def';
import { runFederatedQuery } from './federated-query-executor';

let outputDb: IDBDatabase | undefined;
let outputName: string | undefined;

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
  const db = await openOutput();
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
  outputName = undefined;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Cannot remove temporary output table.'));
    request.onblocked = () => reject(new Error('Temporary output table is still open.'));
  });
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
  if (message.type === 'close') { void closeOutput().then(() => self.postMessage({ type: 'closed' })); return; }
  void closeOutput().then(() => runFederatedQuery(message.definition, (progress) => self.postMessage({ type: 'progress', progress }), message.token, storeRows))
    .then((result) => self.postMessage({ type: 'result', result }))
    .catch(async (error: unknown) => {
      await closeOutput();
      self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'The query failed.' });
    });
};
