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
import { associateLocalResult, buildLocalResultDescriptor, createOutputStores, replaceGraphOutput, registerLocalResult, readLocalResultPage, type LocalResultDescriptor } from './federated-local-results';
import { localResultBytes } from './local-result-bytes';
import { ovdbStreamRow, type OvdbResultColumn } from './ovdb-stream-values';

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
const relatedStored = new Map<string, number>();
let stagedRows: TypedValue[][] | undefined;
let executedDefinition: IQueryDef | undefined;
let committed: LocalResultDescriptor | undefined;
let replacementController: AbortController | undefined;
let nativeColumns: readonly OvdbResultColumn[] | undefined;
let nativePending: Readonly<Record<string, unknown>>[] = [];
let nativePendingBytes = 0;
const nativeBatchBytes = 1024 * 1024;

async function openOutput(): Promise<IDBDatabase> {
  if (outputDb) return outputDb;
  const name = `datatug-output-${storageId ?? `${Date.now()}-${crypto.randomUUID()}`}`;
  outputName = name;
  self.postMessage({ type: 'storage', name });
  outputDb = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 2);
    request.onupgradeneeded = () => createOutputStores(request.result);
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
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
    for (const row of rows) stagedRows.push(row as TypedValue[]);
    return;
  }
  const db = await openOutput();
  if (closing) throw new Error('The query was cancelled.');
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('rows', 'readwrite');
    for (const [index, row] of rows.entries()) transaction.objectStore('rows').put(row, rowsStored + index + 1);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(queryStorageError(transaction.error));
    transaction.onabort = () => reject(queryStorageError(transaction.error));
  });
  rowsStored += rows.length;
}

async function storeNativeRows(rows: readonly Readonly<Record<string, unknown>>[], signal?: AbortSignal): Promise<void> {
  if (!rows.length) return;
  signal?.throwIfAborted();
  if (closing) throw new Error('The query was cancelled.');
  const db = await openOutput();
  signal?.throwIfAborted();
  if (closing) throw new Error('The query was cancelled.');
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('rows', 'readwrite');
    const abort = (): void => {
      try { transaction.abort(); } catch { /* The transaction may have completed before the abort event. */ }
    };
    signal?.addEventListener('abort', abort, { once: true });
    for (const [index, data] of rows.entries())
      transaction.objectStore('rows').put({ nativeData: data }, rowsStored + index + 1);
    transaction.oncomplete = () => { signal?.removeEventListener('abort', abort); resolve(); };
    transaction.onerror = () => { signal?.removeEventListener('abort', abort); reject(queryStorageError(transaction.error)); };
    transaction.onabort = () => { signal?.removeEventListener('abort', abort); reject(signal?.reason ?? queryStorageError(transaction.error)); };
    if (signal?.aborted) abort();
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

async function readPage(index: number, resultSet = 'affiliations'): Promise<TypedValue[][]> {
  if (committed) return readLocalResultPage(committed, index, resultSet);
  const db = outputDb;
  if (!db || !Number.isSafeInteger(index) || index < 0)
    throw new Error('Result page is unavailable.');
  if (!['affiliations', 'locations', 'aliases'].includes(resultSet)) throw new Error('Unknown related result set.');
  const start = index * 100 + 1;
  if (!Number.isSafeInteger(start))
    throw new Error('Result page is out of range.');
  return await new Promise<TypedValue[][]>((resolve, reject) => {
    const related = resultSet !== 'affiliations';
    const transaction = db.transaction(related ? 'relatedRows' : 'rows', 'readonly');
    const request = transaction.objectStore(related ? 'relatedRows' : 'rows').getAll(related ? IDBKeyRange.bound([resultSet, start - 1], [resultSet, start + 98]) : IDBKeyRange.bound(start, start + 99));
    request.onsuccess = () => {
      if (related) { resolve(request.result.map((row) => row.rows) as TypedValue[][]); return; }
      const values = request.result as Array<TypedValue[] | { nativeData: Readonly<Record<string, unknown>> }>;
      const columns = nativeColumns;
      if (values.some((value) => !Array.isArray(value)) && !columns) {
        reject(new Error('The streamed result columns are not final yet.'));
        return;
      }
      resolve(values.map((value) => Array.isArray(value) ? value : ovdbStreamRow(value.nativeData, columns ?? [])));
    };
    request.onerror = () =>
      reject(request.error ?? new Error('Cannot read result page.'));
  });
}

async function commitGraph(result: FederatedQueryResult, rows: TypedValue[][]): Promise<FederatedQueryResult> {
  if (!executedDefinition) throw new Error('The executed graph definition is unavailable.');
  const session = runtimeSession;
  const db = await openOutput();
  replacementController = new AbortController();
  if (closing) replacementController.abort();
  try {
    const descriptor = await replaceGraphOutput(db, executedDefinition, result, rows, (committed?.generation ?? 0) + 1, replacementController.signal, session?.reserveOutputMetadata, session?.reserveOutputStorage);
    // The disk transaction is the sole publication point. Registration can be
    // reconciled from its committed ownership marker after a crash.
    session?.commitOutput?.();
    committed = descriptor;
    rowsStored = descriptor.counts.affiliations;
    relatedStored.clear();
    relatedStored.set('locations', descriptor.counts.locations);
    relatedStored.set('aliases', descriptor.counts.aliases);
    try { await registerLocalResult(descriptor); }
    catch (error) { self.postMessage({ type: 'history-error', message: `The result is retained locally, but catalog registration failed: ${error instanceof Error ? error.message : String(error)}` }); }
    return { ...result, localResult: { id: descriptor.id, generation: descriptor.generation }, totalRows: rowsStored,
      recordset: { ...result.recordset, rows: rows.slice(0, 100) },
      relatedRecordsets: result.relatedRecordsets?.map((set) => ({ ...set, recordset: { ...set.recordset, rows: set.recordset.rows.slice(0, 100) } })) };
  } catch (error) { session?.rollbackOutput?.(); throw error; }
  finally { replacementController = undefined; }
}

async function storeRelated(result: FederatedQueryResult): Promise<FederatedQueryResult> {
  if (!result.relatedRecordsets) return result;
  const db = await openOutput();
  const related = result.relatedRecordsets;
  if (new Set(related.map((set) => set.id)).size !== related.length || related.some((set) => !['locations', 'aliases'].includes(set.id)) || rowsStored + related.reduce((n, set) => n + set.totalRows, 0) > 5000) throw new Error('Invalid or overbound related results.');
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('relatedRows', 'readwrite');
    const store = transaction.objectStore('relatedRows'); store.clear();
    for (const set of related) {
      if (set.recordset.rows.length !== set.totalRows) { transaction.abort(); reject(new Error('The related result is not fully materialized.')); return; }
      relatedStored.set(set.id, set.totalRows);
      set.recordset.rows.forEach((rows, index) => store.put({ set: set.id, index, rows }));
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(queryStorageError(transaction.error));
    transaction.onabort = () => reject(queryStorageError(transaction.error));
  });
  return { ...result, relatedRecordsets: related.map((set) => ({ ...set, recordset: { ...set.recordset, rows: set.recordset.rows.slice(0, 100) } })) };
}
async function closeOutput(): Promise<void> {
  outputDb?.close();
  outputDb = undefined;
  relatedStored.clear();
  if (!outputName) return;
  const name = outputName;
  if (!committed) await deleteQueryDatabase(name);
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
    | { type: 'page'; index: number; requestId: number; resultSet?: string; localResult?: { id: string; generation: number } }
    | {
        type: 'source-page';
        sourceId: string;
        limit: number;
        offset: number;
        requestId: number;
      }
    | { type: 'associate-local'; requestId: number; projectRef: import('../core/project-context').IProjectRef; queryId: string; localResult: { id: string; generation: number } }
    | { type: 'expire-runtime' }
    | { type: 'close' }
  >,
): void => {
  const message = event.data;
  if (message.type === 'associate-local') {
    if (activeRun || closing || !committed || committed.id !== message.localResult.id || committed.generation !== message.localResult.generation) {
      self.postMessage({ type: 'association-error', requestId: message.requestId, message: 'The local result generation changed or is busy.' }); return;
    }
    const session = runtimeSession;
    replacementController = new AbortController();
    activeRun = (async () => {
      try {
        await associateLocalResult(message.projectRef, message.queryId, message.localResult, session?.reserveOutputMetadata ? {
          reserve: session.reserveOutputMetadata, commit: session.commitOutputMetadata ?? (() => undefined), rollback: session.rollbackOutputMetadata ?? (() => undefined), signal: replacementController?.signal,
        } : undefined);
        if (!closing) self.postMessage({ type: 'associated', requestId: message.requestId });
      } catch (error) { self.postMessage({ type: 'association-error', requestId: message.requestId, message: error instanceof Error ? error.message : 'Cannot associate local result.' }); }
      finally { replacementController = undefined; activeRun = undefined; }
    })(); return;
  }
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
        let published: FederatedQueryResult;
        if (executedDefinition?.federation?.nativeGraph) published = await commitGraph(result, rows);
        else {
          await closeOutput(); rowsStored = 0; await storeRows(rows);
          published = { ...await storeRelated(result), totalRows: rowsStored };
        }
        if (!closing)
          self.postMessage({
            type: 'source-result',
            requestId: message.requestId,
            result: published,
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
    if ((message.resultSet === undefined || message.resultSet === 'affiliations') && visibleMode && message.index * 100 >= rowsStored && activeRun) {
      pendingPage = { index: message.index, requestId: message.requestId };
      resumePage?.();
      resumePage = undefined;
      return;
    }
    const expected = message.localResult;
    const page = expected ? readLocalResultPage(expected, message.index, message.resultSet) : readPage(message.index, message.resultSet);
    void page
      .then((rows) =>
        self.postMessage({ type: 'page', requestId: message.requestId, rows, ...(expected ? { localResult: expected } : {}) }),
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
    replacementController?.abort();
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
  storageId = message.storageId ?? (message.definition.federation?.nativeGraph ? `${Date.now()}-${crypto.randomUUID()}` : undefined);
  executedDefinition = message.definition;
  visibleMode = message.mode === 'visible';
  rowsStored = 0;
  resultReady = false;
  nativeColumns = undefined;
  nativePending = [];
  nativePendingBytes = 0;
  controller = new AbortController();
  const runController = controller;
  activeRun = (async () => {
    try {
      await closeOutput();
      committed = undefined;
      if (message.definition.federation?.nativeGraph) stagedRows = [];
      if (
        (message.definition.federation?.bounds?.driver ||
          message.definition.federation?.bounds?.runtime) &&
        message.staticSource
      )
        throw new Error(
          'A declared driver cannot replace its public targets with a static fallback.',
        );
      const rawResult = await runFederatedQuery(
        message.definition,
        (progress) => self.postMessage({ type: 'progress', progress }),
        message.token,
        storeRows,
        runController.signal,
        message.mode ?? 'full',
        (first: FederatedQueryResult) => {
          if (!message.definition.federation?.nativeGraph && !resultReady && !closing) {
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
            if (message.definition.federation?.nativeGraph) session.prepareOutputMetadata?.((fallback) => {
              const name = `datatug-output-${storageId}`;
              const descriptor = buildLocalResultDescriptor(name, message.definition, fallback, fallback.recordset.rows, 1);
              return localResultBytes(descriptor) + localResultBytes({ committed: true, associations: [] });
            });
          },
          onStorageOwned: (name) => self.postMessage({ type: 'storage', name }),
          ...(message.staticSource
            ? { fetch: createStaticOvdbFetch(message.staticSource), disableNativeStream: true }
            : {}),
          onSourceLoaded: (event) =>
            self.postMessage({ type: 'source', event }),
          onNativeRecord: async (data) => {
            const bytes = localResultBytes(data);
            if (nativePending.length && nativePendingBytes + bytes > nativeBatchBytes) {
              const page = nativePending;
              nativePending = [];
              nativePendingBytes = 0;
              await storeNativeRows(page, runController.signal);
            }
            nativePending.push(data);
            nativePendingBytes += bytes;
            if (nativePending.length >= 100 || nativePendingBytes >= nativeBatchBytes) {
              const page = nativePending;
              nativePending = [];
              nativePendingBytes = 0;
              await storeNativeRows(page, runController.signal);
            }
          },
        },
      );
      if (nativePending.length) {
        await storeNativeRows(nativePending, runController.signal);
        nativePending = [];
        nativePendingBytes = 0;
      }
      if (rawResult.nativeStream) {
        if (rawResult.totalRows !== rowsStored)
          throw new Error('The streamed result row count differs from staged output.');
        nativeColumns = rawResult.recordset.columns;
      }
      const result = message.definition.federation?.nativeGraph
        ? await commitGraph(rawResult, stagedRows ?? [])
        : await storeRelated(rawResult);
      stagedRows = undefined;
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
      nativePending = [];
      nativePendingBytes = 0;
      nativeColumns = undefined;
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
