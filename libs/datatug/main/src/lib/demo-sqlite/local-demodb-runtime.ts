// The main-thread side of a local DemoDB copy. Loaded with a dynamic import by
// LocalDemoDbService, so neither @dalgo/sqlite-wasm/opfs nor @openvaultdb/inprocess
// is in the main bundle; SQLite WASM itself loads only in the dataset worker.
//
//   openDemoDb (leader election over Web Locks + BroadcastChannel; the leader starts
//   local-demodb.worker.ts and opens the OPFS copy)
//     └─ leader's serve.port: serveFetchOverPort(createLocalOvdbFetch(...))  (in-process OVDB)
//   session.connect() in every tab ── fetchOverPort ──▶ the `fetch` DataTug uses
import { openDemoDb } from '@dalgo/sqlite-wasm/opfs';
import { createOvdbFetch, fetchOverPort, serveFetchOverPort, type FetchPort } from '@openvaultdb/inprocess';
import {
  createLocalOvdbFetch,
  LOCAL_OVDB_BASE_URL,
  storageModifiedFlag,
  type CreateOvdbFetch,
  type LocalSqliteDatabase,
  type ModifiedFlag,
} from './local-demodb-host';
import { isDemoDbProgressMessage } from './local-demodb-progress';
import { asFetchPort, type MessageOnlyPort } from './local-demodb-port';
import type { LocalDemoDbOpenReport, LocalDemoDbRuntime, OpenLocalDemoDbRuntime } from './local-demodb.types';

const requestType = 'openvaultdb/fetch-request';
const responseType = 'openvaultdb/fetch-response';

/** Which bridge messages are requests and answers, so a leader change fails in-flight requests instead of hanging. */
export const fetchPortProtocol = {
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

/** The parts of a `DemoDbSession` the runtime uses. */
export interface DemoDbSessionLike {
  readonly role: string;
  ready(): Promise<{
    readonly persistent: boolean;
    readonly replacedPreviousVersion: boolean;
    readonly imported: boolean;
    readonly canonical: { readonly sha256: string };
    readonly fallback?: { readonly reason: string; readonly message: string };
  }>;
  connect(protocol: typeof fetchPortProtocol): MessageOnlyPort;
  subscribe(listener: (event: { readonly type: string; readonly role?: string }) => void): () => void;
  close(): void;
}

/** What `openDemoDb` is given, as far as this runtime sets it. */
export interface DemoDbSessionOptions {
  readonly pin: { readonly dataset: string; readonly url: string; readonly sha256: string; readonly bytes: number };
  readonly createWorker: () => Worker;
  readonly serve: {
    port(port: MessageOnlyPort, context: { readonly database: unknown }): (() => void) | undefined;
  };
}

export interface LocalDemoDbRuntimeDeps {
  readonly openDemoDb: (options: DemoDbSessionOptions) => DemoDbSessionLike;
  readonly createOvdbFetch: CreateOvdbFetch;
  readonly fetchOverPort: (port: FetchPort) => typeof globalThis.fetch & { dispose(): void };
  readonly serveFetchOverPort: (fetch: typeof globalThis.fetch, port: FetchPort) => () => void;
  readonly createWorker: () => Worker;
  readonly modifiedFlag: (dataset: string, sha256: string) => ModifiedFlag;
}

function localStorageOrUndefined(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The runtime over injected dependencies (tests pass fakes; production binds the real packages below). */
export function createLocalDemoDbRuntime(
  deps: LocalDemoDbRuntimeDeps,
  { entry, onProgress }: Parameters<OpenLocalDemoDbRuntime>[0],
): LocalDemoDbRuntime {
  const canonical = { url: entry.url, sha256: entry.sha256, bytes: entry.bytes };
  const session = deps.openDemoDb({
    pin: { dataset: entry.dataset, ...canonical },
    createWorker: () => {
      const worker = deps.createWorker();
      worker.addEventListener('message', (event: MessageEvent) => {
        if (isDemoDbProgressMessage(event.data)) onProgress(event.data);
      });
      return worker;
    },
    serve: {
      port: (served, { database }) =>
        deps.serveFetchOverPort(
          createLocalOvdbFetch({
            createOvdbFetch: deps.createOvdbFetch,
            dataset: entry.dataset,
            database: database as LocalSqliteDatabase,
            canonical,
            modified: deps.modifiedFlag(entry.dataset, entry.sha256),
          }),
          asFetchPort(served) as FetchPort,
        ),
    },
  });
  const port = asFetchPort(session.connect(fetchPortProtocol));
  const fetch = deps.fetchOverPort(port as FetchPort);
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
        if (event.type === 'role' && event.role) listener(event.role);
      }),
    close: () => {
      fetch.dispose();
      port.close();
      session.close();
    },
  };
}

export const openLocalDemoDbRuntime: OpenLocalDemoDbRuntime = (options) =>
  createLocalDemoDbRuntime(
    {
      openDemoDb: openDemoDb as unknown as LocalDemoDbRuntimeDeps['openDemoDb'],
      createOvdbFetch: createOvdbFetch as unknown as CreateOvdbFetch,
      fetchOverPort,
      serveFetchOverPort,
      createWorker: () => new Worker(new URL('./local-demodb.worker.ts', import.meta.url), { type: 'module' }),
      modifiedFlag: (dataset, sha256) => storageModifiedFlag(dataset, sha256, localStorageOrUndefined()),
    },
    options,
  );
