// The main-thread side of a local DemoDB copy. Loaded with a dynamic import by
// LocalDemoDbService, so neither @dalgo/sqlite-wasm/opfs nor @openvaultdb/inprocess
// is in the main bundle; SQLite WASM itself loads only in the dataset worker.
//
//   openDemoDb (leader election over Web Locks + BroadcastChannel; the leader starts
//   local-demodb.worker.ts and opens the OPFS copy)
//     └─ leader's serve.port: serveFetchOverPort(createLocalOvdbFetch(...))  (in-process OVDB)
//   session.connect() in every tab ── fetchOverPort ──▶ the `fetch` DataTug uses
import { openDemoDb, type BridgePort } from '@dalgo/sqlite-wasm/opfs';
import { createOvdbFetch, fetchOverPort, serveFetchOverPort, type FetchPort } from '@openvaultdb/inprocess';
import {
  createLocalOvdbFetch,
  LOCAL_OVDB_BASE_URL,
  storageModifiedFlag,
  type CreateOvdbFetch,
  type LocalSqliteDatabase,
} from './local-demodb-host';
import { isDemoDbProgressMessage } from './local-demodb-progress';
import type { LocalDemoDbOpenReport, LocalDemoDbRuntime, OpenLocalDemoDbRuntime } from './local-demodb.types';

const requestType = 'openvaultdb/fetch-request';
const responseType = 'openvaultdb/fetch-response';

/** Which bridge messages are requests and answers, so a leader change fails in-flight requests instead of hanging. */
const fetchPortProtocol = {
  requestId: (message: unknown) =>
    (message as { type?: unknown }).type === requestType ? (message as { id: number }).id : undefined,
  responseId: (message: unknown) =>
    (message as { type?: unknown }).type === responseType ? (message as { id: number }).id : undefined,
  failure: (message: unknown, error: Error) => ({
    type: responseType,
    id: (message as { id: number }).id,
    ok: false,
    name: error.name,
    message: error.message,
  }),
};

function localStorageOrUndefined(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export const openLocalDemoDbRuntime: OpenLocalDemoDbRuntime = ({ entry, onProgress }) => {
  const canonical = { url: entry.url, sha256: entry.sha256, bytes: entry.bytes };
  const session = openDemoDb({
    pin: { dataset: entry.dataset, ...canonical },
    createWorker: () => {
      const worker = new Worker(new URL('./local-demodb.worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', (event: MessageEvent) => {
        if (isDemoDbProgressMessage(event.data)) onProgress(event.data);
      });
      return worker;
    },
    serve: {
      port: (port, { database }) =>
        serveFetchOverPort(
          createLocalOvdbFetch({
            createOvdbFetch: createOvdbFetch as unknown as CreateOvdbFetch,
            dataset: entry.dataset,
            database: database as unknown as LocalSqliteDatabase,
            canonical,
            modified: storageModifiedFlag(entry.dataset, entry.sha256, localStorageOrUndefined()),
          }),
          port as unknown as FetchPort,
        ),
    },
  });
  const port: BridgePort = session.connect(fetchPortProtocol);
  const fetch = fetchOverPort(port as unknown as FetchPort);
  return {
    baseUrl: LOCAL_OVDB_BASE_URL,
    fetch,
    ready: async (): Promise<LocalDemoDbOpenReport> => {
      const report = await session.ready();
      return {
        persistent: report.persistent,
        replacedPreviousVersion: report.replacedPreviousVersion,
        imported: report.imported,
        canonicalSha256: report.canonical.sha256,
        ...(report.fallback ? { fallback: { reason: report.fallback.reason, message: report.fallback.message } } : {}),
      };
    },
    role: () => session.role,
    onRoleChange: (listener) =>
      session.subscribe((event) => {
        if (event.type === 'role') listener(event.role);
      }),
    close: () => {
      fetch.dispose();
      session.close();
    },
  } satisfies LocalDemoDbRuntime;
};
