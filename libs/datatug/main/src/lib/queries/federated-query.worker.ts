import type { TypedValue } from '@sneat/datatug-semantic';
import type { IQueryDef } from '../models/definition/query-def';
import {
  createStaticOvdbFetch,
  type StaticOvdbSource,
} from './sources/static-ovdb-fetch';
import {
  runFederatedQuery,
  type FederatedQueryMode,
  type FederatedQueryResult,
  type FederatedRuntimeSession,
} from './federated-query-executor';
import {
  deleteQueryDatabase,
  queryStorageError,
} from './federated-query-storage';

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
let storageId: string | undefined;
let runtimeSession: FederatedRuntimeSession | undefined;
let stagedRows: TypedValue[][] | undefined;

async function openOutput(): Promise<IDBDatabase> {
  if (outputDb) return outputDb;
  const name = `datatug-output-${storageId ?? `${Date.now()}-${crypto.randomUUID()}`}`;
  outputName = name;
  self.postMessage({ type: 'storage', name });
  outputDb = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('rows', { autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(queryStorageError(request.error));
  });
  return outputDb;
}

async function storeRows(
  rows: readonly (readonly TypedValue[])[],
): Promise<void> {
  if (!rows.length) return;
  if (closing) throw new Error('The query was cancelled.');
  if (stagedRows) {
    stagedRows.push(...rows.map((row) => [...row]));
    return;
  }
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
  if (!pending || (pending.index * 100 >= rowsStored && activeRun)) return;
  pendingPage = undefined;
  try {
    self.postMessage({
      type: 'page',
      requestId: pending.requestId,
      rows: await readPage(pending.index),
    });
  } catch (error) {
    self.postMessage({
      type: 'page-error',
      requestId: pending.requestId,
      message:
        error instanceof Error ? error.message : 'Cannot read result page.',
    });
  }
}

async function readPage(index: number): Promise<TypedValue[][]> {
  const db = outputDb;
  if (!db || !Number.isSafeInteger(index) || index < 0)
    throw new Error('Result page is unavailable.');
  const start = index * 100 + 1;
  if (!Number.isSafeInteger(start))
    throw new Error('Result page is out of range.');
  return await new Promise<TypedValue[][]>((resolve, reject) => {
    const transaction = db.transaction('rows', 'readonly');
    const request = transaction
      .objectStore('rows')
      .getAll(IDBKeyRange.bound(start, start + 99));
    request.onsuccess = () => resolve(request.result as TypedValue[][]);
    request.onerror = () =>
      reject(request.error ?? new Error('Cannot read result page.'));
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

self.onmessage = (
  event: MessageEvent<
    | {
        type: 'run';
        definition: IQueryDef;
        token: string;
        mode?: FederatedQueryMode;
        staticSource?: StaticOvdbSource;
        deadline?: number;
        storageId?: string;
      }
    | { type: 'page'; index: number; requestId: number }
    | {
        type: 'source-page';
        sourceId: string;
        limit: number;
        offset: number;
        requestId: number;
      }
    | { type: 'expire-runtime' }
    | { type: 'close' }
  >,
): void => {
  const message = event.data;
  if (message.type === 'expire-runtime') {
    runtimeSession?.close();
    runtimeSession = undefined;
    return;
  }
  if (message.type === 'source-page') {
    const session = runtimeSession;
    if (!session || activeRun || closing) {
      self.postMessage({
        type: 'source-error',
        requestId: message.requestId,
        message:
          'The bounded source continuation is unavailable or expired. Run explicitly again.',
      });
      return;
    }
    activeRun = (async () => {
      try {
        stagedRows = [];
        const result = await session.readPage(message.sourceId, {
          limit: message.limit,
          offset: message.offset,
        });
        const rows = stagedRows;
        stagedRows = undefined;
        await closeOutput();
        rowsStored = 0;
        await storeRows(rows);
        if (!closing)
          self.postMessage({
            type: 'source-result',
            requestId: message.requestId,
            result: { ...result, totalRows: rowsStored },
          });
      } catch (error) {
        session.close();
        runtimeSession = undefined;
        const reason =
          error instanceof Error
            ? error.message
            : 'The bounded source continuation failed.';
        stagedRows = undefined;
        if (!closing)
          self.postMessage({
            type: 'source-error',
            requestId: message.requestId,
            message: reason,
          });
      } finally {
        stagedRows = undefined;
        activeRun = undefined;
      }
    })();
    return;
  }
  if (message.type === 'page') {
    if (visibleMode && message.index * 100 >= rowsStored && activeRun) {
      pendingPage = { index: message.index, requestId: message.requestId };
      resumePage?.();
      resumePage = undefined;
      return;
    }
    void readPage(message.index)
      .then((rows) =>
        self.postMessage({ type: 'page', requestId: message.requestId, rows }),
      )
      .catch((error: unknown) =>
        self.postMessage({
          type: 'page-error',
          requestId: message.requestId,
          message:
            error instanceof Error ? error.message : 'Cannot read result page.',
        }),
      );
    return;
  }
  if (message.type === 'close') {
    const wasRunning = activeRun !== undefined;
    closing = true;
    controller?.abort();
    runtimeSession?.close();
    runtimeSession = undefined;
    resumePage?.();
    resumePage = undefined;
    void (async () => {
      await activeRun;
      if (wasRunning) self.postMessage({ type: 'cancelled' });
      try {
        await closeOutput();
      } catch (error) {
        self.postMessage({
          type: 'cleanup-error',
          message:
            error instanceof Error
              ? error.message
              : 'Cannot remove temporary output.',
        });
      }
      self.postMessage({ type: 'closed' });
    })();
    return;
  }
  closing = false;
  runtimeSession?.close();
  runtimeSession = undefined;
  storageId = message.storageId;
  visibleMode = message.mode === 'visible';
  rowsStored = 0;
  resultReady = false;
  controller = new AbortController();
  const runController = controller;
  activeRun = (async () => {
    try {
      await closeOutput();
      if (
        (message.definition.federation?.bounds?.driver ||
          message.definition.federation?.bounds?.runtime) &&
        message.staticSource
      )
        throw new Error(
          'A declared driver cannot replace its public targets with a static fallback.',
        );
      const result = await runFederatedQuery(
        message.definition,
        (progress) => self.postMessage({ type: 'progress', progress }),
        message.token,
        storeRows,
        runController.signal,
        message.mode ?? 'full',
        (first: FederatedQueryResult) => {
          if (!resultReady && !closing) {
            resultReady = true;
            self.postMessage({ type: 'result', result: first });
          }
          void sendPendingPage();
        },
        () =>
          new Promise<void>((resolve) => {
            resumePage = resolve;
            if (pendingPage) {
              resumePage();
              resumePage = undefined;
            }
          }),
        {
          deadline: message.deadline,
          storageId,
          onRuntimeSession: (session) => {
            runtimeSession = session;
          },
          onStorageOwned: (name) => self.postMessage({ type: 'storage', name }),
          ...(message.staticSource
            ? { fetch: createStaticOvdbFetch(message.staticSource) }
            : {}),
          onSourceLoaded: (event) =>
            self.postMessage({ type: 'source', event }),
        },
      );
      if (!closing && !resultReady)
        self.postMessage({
          type: 'result',
          result: visibleMode
            ? { ...result, totalRows: rowsStored, hasMore: false }
            : result.runtimeRead
              ? { ...result, totalRows: rowsStored }
              : result,
        });
      if (!closing && visibleMode) {
        self.postMessage({
          type: 'finished',
          totalRows: result.totalRows ?? rowsStored,
        });
        void sendPendingPage();
      }
    } catch (error) {
      let messageText =
        error instanceof Error ? error.message : 'The query failed.';
      try {
        await closeOutput();
      } catch (cleanupError) {
        messageText += `; cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
      }
      if (!closing) self.postMessage({ type: 'error', message: messageText });
    } finally {
      activeRun = undefined;
      controller = undefined;
      void sendPendingPage();
    }
  })();
};
