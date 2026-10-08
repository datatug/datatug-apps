import { preflightSourceRights, type FederatedSourceRights } from './federated-source-rights';
import {
  executeJoinedDTQLQuery,
  executeJoinedDTQLQueryPages,
  executeRecordLookupPages,
  executeRecordLookups,
  isJoinedDTQLQuery,
  key,
  parseDTQL,
  type DTQLExpression,
  type JoinedQueryExecutionOptions,
  type JoinedQueryProgress,
  type QueryExecutor,
  type QueryPage,
  type QueryRelation,
  type StructuredQuery,
} from '@dalgo/core';
import { IndexedDbDatabase } from '@dalgo/indexeddb';
import type { RunQueryResponse, TypedValue } from '@sneat/datatug-semantic';
import type {
  IQueryDef,
  ITextQueryRequest,
} from '../models/definition/query-def';
import { OVDB_ERROR_STREAM_MIME, readOvdbEarlyError, readOvdbJsonRecordStream } from './ovdb-json-record-stream';
import { consumeOvdbOrdinaryQuery } from './ovdb-ordinary-execution';
import { ovdbResultColumns, ovdbStreamRow } from './ovdb-stream-values';
import { localResultBytes } from './local-result-bytes';
import { strictJson } from './public-data/strict-json';
import {
  deleteQueryDatabase,
  queryStorageError,
} from './federated-query-storage';
import { createBoundedFederationFetch, validateBoundedAdmission } from './public-data/bounded-federation';
import { BoundedRunBudget } from './public-data/bounded-run-budget';
import type { ImmutableReadReceipt } from './public-data/immutable-federation';
import { NATIVE_GRAPH_PUBLICATION_BLOCKER } from './public-data/native-graph-contract';
import type {
  GraphRelatedRecordset,
  NativeGraphResult,
} from './public-data/native-graph-executor';
import {
  publicDataExceptions,
  SAVED_SCENARIO_PUBLICATION_BLOCKER,
  type PublicDataExceptions,
} from './public-data/public-data-scenario';

type Data = Record<string, unknown>;
interface OvdbRecord {
  readonly key: string;
  readonly data: Data;
}
interface OvdbPage {
  readonly records: readonly OvdbRecord[];
  readonly nextPageToken?: string;
  readonly snapshotToken?: string;
  readonly snapshotExpiresAt?: string;
}

function containsAggregate(expression: DTQLExpression): boolean {
  return (
    expression.kind === 'aggregate' ||
    (expression.kind === 'binary' &&
      (containsAggregate(expression.left) ||
        containsAggregate(expression.right)))
  );
}

export function federatedVisibleMode(definition: IQueryDef): {
  supported: boolean;
  defaultMode: FederatedQueryMode;
  reason?: string;
} {
  const config = definition.federation;
  if (!config) return { supported: false, defaultMode: 'full' };
  try {
    if (nativeDatabase(definition))
      return { supported: false, defaultMode: 'full', reason: 'A whole-database query streams its complete result.' };
    const parsed = parseDTQL((definition.request as ITextQueryRequest).text, {
      tables: config.tables,
    });
    if (!isJoinedDTQLQuery(parsed))
      return {
        supported: false,
        defaultMode: 'full',
        reason: 'Visible rows requires a cross-source detail query.',
      };
    const global =
      parsed.groupBy !== undefined ||
      parsed.having !== undefined ||
      parsed.orders.length > 0 ||
      (parsed.columns ?? []).some(
        (column) =>
          column.expression !== undefined &&
          containsAggregate(column.expression),
      );
    if (global)
      return {
        supported: false,
        defaultMode: 'full',
        reason: 'Aggregates and global ordering require Full result.',
      };
    const lookup =
      parsed.from.joins.length === 0 &&
      (config.lookups?.length ?? 0) > 0 &&
      parsed.filters.length === 0 &&
      parsed.columns === undefined &&
      parsed.offset === undefined;
    const flatJoin =
      parsed.from.joins.length === 1 &&
      parsed.from.joins[0].from.joins.length === 0;
    if (!lookup && !flatJoin)
      return {
        supported: false,
        defaultMode: 'full',
        reason: 'Visible rows supports direct lookups or one flat join.',
      };
    return {
      supported: true,
      defaultMode:
        lookup || parsed.from.joins[0]?.type === 'left' ? 'visible' : 'full',
    };
  } catch {
    return {
      supported: false,
      defaultMode: 'full',
      reason: 'Visible rows is unavailable until this query can be parsed.',
    };
  }
}

export interface FederatedQueryProgress {
  readonly stage:
    | 'preparing'
    | 'loading'
    | 'streaming'
    | 'processing'
    | 'lookup'
    | 'complete';
  readonly rowsLoaded: number;
  readonly rowsProcessed: number;
  readonly requestsCompleted: number;
  readonly requestsInFlight: number;
  readonly requestsPending: number;
}

type Lookup = NonNullable<
  NonNullable<IQueryDef['federation']>['lookups']
>[number];

/** One source scan that finished: what this run actually read from it. */
export interface FederatedSourceLoaded {
  readonly database: string;
  readonly name: string;
  readonly rows: number;
  readonly requests: number;
  readonly elapsedMs: number;
}

/** Optional seams: where HTTP goes (a static data adapter) and what the run reports about each source. */
export interface FederatedQueryObserver {
  readonly deadline?: number;
  readonly onStorageOwned?: (name: string) => void;
  readonly storageId?: string;
  readonly onRuntimeSession?: (session: FederatedRuntimeSession) => void;
  readonly fetch?: typeof fetch;
  readonly onSourceLoaded?: (event: FederatedSourceLoaded) => void;
  /** Called once when the executor decodes its first query output record. */
  readonly onFirstRecord?: () => void;
  /** Raw JSON rows are staged before the server's final column union exists. */
  readonly onNativeRecord?: (data: Readonly<Record<string, unknown>>, signal?: AbortSignal) => Promise<void>;
  readonly disableNativeStream?: boolean;
}
export interface FederatedRuntimeSession {
  readonly reserveOutputStorage?: (bytes: number) => void;
  readonly commitOutputMetadata?: () => void;
  readonly rollbackOutputMetadata?: () => void;
  readonly prepareOutputMetadata?: (
    sizer: (response: FederatedQueryResult) => number,
  ) => void;
  readonly reserveOutputMetadata?: (bytes: number) => void;
  readonly commitOutput?: () => void;
  readonly rollbackOutput?: () => void;
  readonly readPage: (
    sourceId: string,
    page: import('./public-data/immutable-federation').OrdinaryPage,
  ) => Promise<FederatedQueryResult>;
  readonly close: () => void;
}

export type FederatedQueryResult = RunQueryResponse & {
  readonly localResult?: { readonly id: string; readonly generation: number };
  readonly relatedRecordsets?: readonly GraphRelatedRecordset[];
  readonly nativeGraph?: Pick<
    NativeGraphResult,
    | 'coverage'
    | 'edges'
    | 'ledger'
    | 'planIdentity'
    | 'stageActions'
    | 'stopped'
  >;
  readonly totalRows?: number;
  readonly hasMore?: boolean;
  readonly publicDataExceptions?: PublicDataExceptions;
  readonly publicDataBytes?: number;
  readonly runtimeRead?: import('./public-data/immutable-federation').RuntimeReadReport;
  readonly providerReads?: unknown;
  readonly nativeStream?: true;
  /** Worker staging marker for a complete ordinary /dtql response. */
  readonly nativeDirect?: true;
};
export type FederatedOutputPage = (
  rows: readonly (readonly TypedValue[])[],
) => Promise<void>;
export type FederatedQueryMode = 'full' | 'visible';

function typed(value: unknown): TypedValue {
  if (value === null || value === undefined)
    return { type: 'null', value: null };
  if (typeof value === 'string') return { type: 'string', value };
  if (typeof value === 'boolean') return { type: 'boolean', value };
  if (typeof value === 'number' && Number.isFinite(value))
    return { type: 'number', value };
  throw new Error('OVDB returned a value that cannot be shown in this result.');
}

function ovdbBaseUrl(raw: string): string {
  const url = new URL(raw);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ))
  ) {
    throw new Error(
      'The OVDB base URL must use HTTPS or local HTTP and contain no credentials or query parameters.',
    );
  }
  return url.href.replace(/\/$/, '');
}

function nativeDatabase(definition: IQueryDef): { database: string; sources: PlannedNativeSource[] } | undefined {
  const config = definition.federation;
  if (!config || config.lookups?.length || config.bounds || definition.request.queryType !== 'DTQL') return undefined;
  const parsed = parseDTQL((definition.request as ITextQueryRequest).text, { tables: config.tables });
  const configured = new Set(config.tables.map((table) => table.database).filter((database): database is string => !!database));
  const implicit = configured.size === 1 && config.tables.every((table) => table.database)
    ? [...configured][0] : undefined;
  if (!isJoinedDTQLQuery(parsed)) {
    if (parsed.source.kind !== 'collection') return undefined;
    const matches = config.tables.filter((table) => table.name === parsed.source.name && table.database);
    return matches.length === 1 && implicit && matches[0].database === implicit
      ? { database: implicit, sources: [{ database: implicit, name: matches[0].name }] }
      : undefined;
  }
  const sources: PlannedNativeSource[] = [];
  let fullyQualified = true;
  const visit = (relation: QueryRelation): void => {
    const database = relation.database ?? implicit;
    if (!database) fullyQualified = false;
    else sources.push({ database, name: relation.name });
    relation.joins.forEach((join) => visit(join.from));
  };
  visit(parsed.from);
  if (!fullyQualified || !sources.length || new Set(sources.map((source) => source.database)).size !== 1) return undefined;
  return { database: sources[0].database, sources };
}

interface PlannedNativeSource { readonly database: string; readonly name: string }
interface NativeQueryCapability {
  readonly streaming: boolean;
  readonly ordinary: boolean;
  readonly mappedErrors: boolean;
}

async function streamCapability(base: string, database: string, fetcher: typeof fetch,
  authHeaders: Record<string, string>, expectedServerId: string | undefined, effective: AbortSignal): Promise<NativeQueryCapability> {
  const response = await fetcher(`${base}/v1/databases/${encodeURIComponent(database)}`, {
    headers: { Accept: 'application/json', ...authHeaders }, redirect: 'error', signal: effective,
  });
  if (response.redirected || !response.ok || !response.body)
    throw new Error('OVDB database capability discovery is unavailable.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      effective.throwIfAborted();
      const part = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        const abort = (): void => {
          reject(effective.reason);
          void reader.cancel(effective.reason).catch(() => undefined);
        };
        effective.addEventListener('abort', abort, { once: true });
        if (effective.aborted) abort();
        reader.read().then(resolve, reject).finally(() => effective.removeEventListener('abort', abort));
      });
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1024 * 1024) throw new Error('OVDB capability discovery exceeds the browser limit.');
      chunks.push(part.value);
    }
  } finally { void reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const metadata: unknown = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    throw new Error('OVDB returned invalid database capabilities.');
  const document = metadata as Record<string, unknown>;
  const capabilities = document['capabilities'];
  if (capabilities === undefined) return { streaming: false, ordinary: false, mappedErrors: false }; // Legacy route.
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities))
    throw new Error('OVDB returned invalid database capabilities.');
  const flags = capabilities as Record<string, unknown>;
  if (document['id'] !== database || (expectedServerId && document['serverId'] !== expectedServerId))
    throw new Error('OVDB query capability identity differs from the selected database.');
  if (flags['dtqlStreaming'] === true && flags['dtql'] !== true)
    throw new Error('OVDB advertises a query stream without DTQL capability.');
  return {
    streaming: flags['dtqlStreaming'] === true,
    ordinary: flags['dtql'] === true && flags['dtqlStreaming'] !== true,
    mappedErrors: flags['dtqlStreaming'] === true && flags['dtqlStreamingErrors'] === true,
  };
}

async function runNativeOrdinary(
  definition: IQueryDef,
  database: string,
  sources: readonly PlannedNativeSource[],
  base: string,
  token: string,
  onProgress?: (progress: FederatedQueryProgress) => void,
  onOutputPage?: FederatedOutputPage,
  signal?: AbortSignal,
  observer?: FederatedQueryObserver,
): Promise<FederatedQueryResult> {
  const fetcher: typeof fetch =
    observer?.fetch ?? ((input, init) => fetch(input, init));
  const authHeaders: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};
  const config = definition.federation;
  if (!config) throw new Error('This query has no direct OVDB configuration.');
  const rights = await preflightSourceRights(
    base,
    sources,
    fetcher,
    authHeaders,
    signal,
    undefined,
    config.expectedSourceRights,
    admittedServerId(config, base),
  );
  signal?.throwIfAborted();
  const response = await fetcher(
    `${base}/v1/databases/${encodeURIComponent(database)}/dtql`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/yaml',
        Accept: 'application/json',
        ...authHeaders,
      },
      body: (definition.request as ITextQueryRequest).text,
      redirect: 'error',
      signal,
    },
  );
  if (response.redirected || !response.ok) {
    const mapped = response.redirected ? undefined : await readOvdbEarlyError(response, signal);
    throw new Error(mapped ?? `OVDB ${database} whole-query execution failed (${response.status}).`);
  }
  return consumeOvdbOrdinaryQuery(
    response,
    definition,
    base,
    database,
    rights,
    signal,
    onProgress,
    onOutputPage,
    observer,
  );
}

async function runNativeStream(
  definition: IQueryDef, database: string, sources: readonly PlannedNativeSource[],
  base: string, token: string, onProgress?: (progress: FederatedQueryProgress) => void,
  onOutputPage?: FederatedOutputPage, signal?: AbortSignal, observer?: FederatedQueryObserver,
  mappedErrors = false,
): Promise<FederatedQueryResult> {
  const fetcher: typeof fetch = observer?.fetch ?? ((input, init) => fetch(input, init));
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const config = definition.federation;
  if (!config) throw new Error('This query has no direct OVDB configuration.');
  const expectedServerId = admittedServerId(config, base);
  const rights = await preflightSourceRights(base, sources, fetcher, authHeaders, signal, undefined,
    config.expectedSourceRights, expectedServerId);
  signal?.throwIfAborted();
  const response = await fetcher(`${base}/v1/databases/${encodeURIComponent(database)}/dtql`, {
    method: 'POST', headers: { 'Content-Type': 'application/yaml',
      Accept: mappedErrors ? OVDB_ERROR_STREAM_MIME : 'application/json', ...authHeaders },
    body: (definition.request as ITextQueryRequest).text, redirect: 'error', signal,
  });
  if (response.redirected || !response.ok) {
    const mapped = response.redirected ? undefined : await readOvdbEarlyError(response, signal);
    throw new Error(mapped ?? `OVDB ${database} whole-query execution failed (${response.status}).`);
  }
  const first: Readonly<Record<string, unknown>>[] = [];
  let previewBytes = 0;
  let count = 0;
  const stream = await readOvdbJsonRecordStream(response, async (record) => {
    signal?.throwIfAborted();
    observer?.onFirstRecord?.();
    count++;
    if (!observer?.onNativeRecord) {
      const bytes = localResultBytes(record.data);
      if (count > 100 || previewBytes + bytes > 1024 * 1024)
        throw new Error('The streamed query needs a paged result sink beyond the direct preview limit.');
      first.push(record.data);
      previewBytes += bytes;
    }
    await observer?.onNativeRecord?.(record.data, signal);
    signal?.throwIfAborted();
    if (count === 1 || count % 100 === 0)
      onProgress?.({ stage: 'streaming', rowsLoaded: count, rowsProcessed: count,
        requestsCompleted: 0, requestsInFlight: 1, requestsPending: 0 });
  }, signal, undefined, mappedErrors);
  signal?.throwIfAborted();
  rights.acceptWholeQuery(stream.footer as unknown as Record<string, unknown>);
  const columns = ovdbResultColumns(stream.footer.columns, definition);
  const rows = first.map((record) => ovdbStreamRow(record, columns));
  if (onOutputPage && !observer?.onNativeRecord) await onOutputPage(rows);
  onProgress?.({ stage: 'complete', rowsLoaded: count, rowsProcessed: count,
    requestsCompleted: 1, requestsInFlight: 0, requestsPending: 0 });
  return {
    ...rights.evidence(),
    ...(stream.footer.providerReads === undefined ? {} : { providerReads: stream.footer.providerReads }),
    recordset: { columns, rows }, totalRows: count, hasMore: false, nativeStream: true,
    limitations: [], bindingsApplied: [], truncated: false,
    provenance: { source: `${base}/v1/databases/${database} (direct OVDB)`, queryId: definition.id,
      mode: 'live', observedAt: new Date().toISOString(), executionProfile: 'protected' },
  };
}

/** Capture one selected origin/identity pair before any I/O; never adopt it from a response. */
function admittedServerId(config: NonNullable<IQueryDef['federation']>, base: string): string | undefined {
  const selected = config.expectedServerIdentity;
  if (selected === undefined) return undefined;
  if (!selected || typeof selected !== 'object' || Array.isArray(selected) ||
    Object.keys(selected).some((key) => !['baseUrl', 'serverId'].includes(key)) ||
    ovdbBaseUrl(selected.baseUrl) !== base || typeof selected.serverId !== 'string' ||
    !selected.serverId.trim() || new TextEncoder().encode(selected.serverId).length > 4096 ||
    Array.from(selected.serverId).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    throw new Error('The expected OVDB server identity is not bound to this admitted base.');
  return selected.serverId;
}

function retryDelay(attempt: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(done, 200 * (attempt + 1));
    function done(): void {
      signal?.removeEventListener('abort', abort);
      resolve();
    }
    function abort(): void {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Runs each leaf against OVDB directly and merges/aggregates in this runtime. */
export async function runFederatedQuery(
  definition: IQueryDef,
  onProgress?: (progress: FederatedQueryProgress) => void,
  token = '',
  onOutputPage?: FederatedOutputPage,
  signal?: AbortSignal,
  mode: FederatedQueryMode = 'full',
  onPageReady?: (result: FederatedQueryResult) => void,
  waitForNextPage?: () => Promise<void>,
  observer?: FederatedQueryObserver,
): Promise<FederatedQueryResult> {
  let firstRecordReported = false;
  const runObserver: FederatedQueryObserver = {
    ...observer,
    onFirstRecord: () => {
      if (firstRecordReported) return;
      firstRecordReported = true;
      observer?.onFirstRecord?.();
    },
  };
  if (definition.federation?.nativeGraph)
    throw new Error(NATIVE_GRAPH_PUBLICATION_BLOCKER);
  if (definition.publicData)
    throw new Error(SAVED_SCENARIO_PUBLICATION_BLOCKER);
  const bounds = definition.federation?.bounds;
  if (!bounds) {
    const native = runObserver.disableNativeStream ? undefined : nativeDatabase(definition);
    if (native) {
      const config = definition.federation;
      if (!config) throw new Error('This query has no direct OVDB configuration.');
      const base = ovdbBaseUrl(config.ovdbBaseUrl);
      const fetcher: typeof fetch = runObserver.fetch ?? ((input, init) => fetch(input, init));
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const remaining = Math.min(60_000, (runObserver.deadline ?? Date.now() + 60_000) - Date.now());
      if (!Number.isFinite(remaining) || remaining <= 0)
        throw new Error('The OVDB query deadline has expired.');
      const timeout = AbortSignal.timeout(remaining);
      const nativeSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const capability = await streamCapability(base, native.database, fetcher, headers,
        admittedServerId(config, base), nativeSignal);
      if (capability.streaming)
        return runNativeStream(definition, native.database, native.sources, base, token,
          onProgress, onOutputPage, nativeSignal, runObserver, capability.mappedErrors);
      if (capability.ordinary)
        return runNativeOrdinary(definition, native.database, native.sources, base, token,
          onProgress, onOutputPage, nativeSignal, runObserver);
    }
    return runFederatedQueryInternal(
      definition,
      onProgress,
      token,
      onOutputPage,
      signal,
      mode,
      onPageReady,
      waitForNextPage,
      runObserver,
    );
  }
  if (mode !== 'full')
    throw new Error(
      'Bounded public-data runs calculate one selected page. Browse result pages after it finishes.',
    );
  const config = definition.federation;
  if (!config) throw new Error('This query has no direct OVDB configuration.');
  const base = ovdbBaseUrl(config.ovdbBaseUrl);
  validateBoundedAdmission(base, bounds);
  const expectedServerId = admittedServerId(config, base);
  const deadline = new AbortController();
  const timer = bounds.runtime
    ? undefined
    : setTimeout(
        () =>
          deadline.abort(
            new Error('The bounded lookup exceeded its deadline.'),
          ),
        bounds.timeoutMs,
      );
  const combined = signal
    ? AbortSignal.any([signal, deadline.signal])
    : deadline.signal;
  const budget = bounds.runtime
    ? new BoundedRunBudget(
        bounds.bytes,
        bounds.timeoutMs,
        signal,
        observer?.deadline,
      )
    : undefined;
  const runSignal = budget?.signal ?? combined;
  let retained = false;
  try {
    let preflightBytes = 0;
    const rights = await preflightSourceRights(base,
      bounds.sources.filter((source) => !bounds.driver || source.database !== bounds.driver.database || source.name !== bounds.driver.name),
      runObserver.fetch ?? fetch, token ? { Authorization: `Bearer ${token}` } : {}, runSignal,
      (count) => { preflightBytes += count; if (budget) budget.consumeNetwork(count); else if (preflightBytes > bounds.bytes) throw new Error('Source terms preflight exceeds run byte budget.'); }, definition.federation?.expectedSourceRights, expectedServerId);
    const transport = createBoundedFederationFetch(
      base,
      budget ? bounds : { ...bounds, bytes: bounds.bytes - preflightBytes },
      runObserver.fetch ?? fetch,
      runSignal,
      budget,
      rights,
    );
    const execute = async (): Promise<FederatedQueryResult> => {
      budget?.beginOutput();
      // Reserve the bounded evidence ceiling before first rows, including ids
      // disclosed by undeclared inputs; actual storage bytes remain charged.
      budget?.consumeOutput(" ".repeat(262144));
      let outputRows = 0;
      const collected: TypedValue[][] = [];
      const result = await runFederatedQueryInternal(
        definition,
        onProgress,
        token,
        async (rows) => {
          budget?.check();
          runSignal.throwIfAborted();
          outputRows += rows.length;
          if (outputRows > bounds.resultRows)
            throw new Error(
              'The lookup exceeds the result-row bound; ambiguous or multiplied matches require a narrower query.',
            );
          budget?.consumeOutput(rows);
          if (onOutputPage) await onOutputPage(rows);
          else collected.push(...rows.map((row) => [...row]));
        },
        runSignal,
        'full',
        undefined,
        undefined,
        { ...runObserver, fetch: transport.fetch },
        rights,
        true,
      );
      budget?.check();
      runSignal.throwIfAborted();
      if (result.recordset.rows.length > bounds.resultRows)
        throw new Error('The lookup exceeds the result-row bound.');
      if (!outputRows) budget?.consumeOutput(result.recordset);
      // Nested joins use DALgo's batch result rather than the flat join callback.
      if (!outputRows && result.recordset.rows.length) {
        runObserver.onFirstRecord?.();
        if (onOutputPage) await onOutputPage(result.recordset.rows);
      }
      const runtime: ImmutableReadReceipt | undefined =
        transport.receipt.runtime;
      return {
        ...result,
        ...(!onOutputPage && outputRows
          ? { recordset: { ...result.recordset, rows: collected } }
          : {}),
        publicDataExceptions: publicDataExceptions(
          bounds,
          transport.receipt.sources,
          runtime?.pages,
        ),
        publicDataBytes: transport.receipt.bytes() + (budget ? 0 : preflightBytes),
        ...(runtime
          ? {
              runtimeRead: {
                pins: Object.fromEntries(runtime.pins),
                pages: Object.fromEntries(runtime.pages),
                history: Object.fromEntries(runtime.history),
              },
            }
          : {}),
        limitations: [
          ...result.limitations,
          {
            rowsFiltered: false,
            hiddenColumns: [],
            policy: `Selected user page: at most ${bounds.userRows} rows from offset ${bounds.userOffset}; ${bounds.identifierLimit} identifiers, ${bounds.resultRows} results, ${bounds.bytes} network bytes, ${bounds.timeoutMs}ms.${runtime && [...runtime.pages.values()].some((page) => page.possiblyMore) ? ' A full source page may have more rows; matches and cardinalities depending on it are unresolved. Further reads require explicit action before the original deadline.' : ''}`,
          },
        ],
      };
    };
    const result = await execute();
    const readPage = transport.readPage;
    if (
      budget &&
      readPage &&
      runObserver.onRuntimeSession &&
      [...(transport.receipt.runtime?.pages.values() ?? [])].some(
        (page) => !page.complete,
      )
    ) {
      const sessionBudget = budget;
      runObserver.onRuntimeSession({
        readPage: async (sourceId, page) => {
          sessionBudget.check();
          await readPage(sourceId, page);
          return execute();
        },
        close: () => {
          sessionBudget.controller.abort(new Error('The query was cancelled.'));
          sessionBudget.close();
        },
      });
      retained = true;
    }
    return result;
  } finally {
    clearTimeout(timer);
    if (!retained) budget?.close();
  }
}

async function runFederatedQueryInternal(
  definition: IQueryDef,
  onProgress?: (progress: FederatedQueryProgress) => void,
  token = '',
  onOutputPage?: FederatedOutputPage,
  signal?: AbortSignal,
  mode: FederatedQueryMode = 'full',
  onPageReady?: (result: FederatedQueryResult) => void,
  waitForNextPage?: () => Promise<void>,
  observer?: FederatedQueryObserver,
  capturedRights?: FederatedSourceRights,
  rightsHandledByTransport = false,
): Promise<FederatedQueryResult> {
  // Late-bound so a stubbed global fetch is honoured; an observer's fetch replaces it for this run only.
  const httpFetch: typeof fetch =
    observer?.fetch ?? ((input, init) => fetch(input, init));
  const config = definition.federation;
  if (!config) throw new Error('This query has no direct OVDB configuration.');
  const baseUrl = ovdbBaseUrl(config.ovdbBaseUrl);
  const expectedServerId = admittedServerId(config, baseUrl);
  const authHeaders: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};
  const parsed = parseDTQL((definition.request as ITextQueryRequest).text, {
    tables: config.tables,
  });
  if (!isJoinedDTQLQuery(parsed))
    throw new Error('The direct OVDB query must contain a join.');
  const relations: QueryRelation[] = [];
  const visit = (relation: QueryRelation): void => {
    if (!relation.database)
      throw new Error(`The source ${relation.name} has no database.`);
    relations.push(relation);
    for (const joined of relation.joins) visit(joined.from);
  };
  visit(parsed.from);
  const rights = capturedRights ?? await preflightSourceRights(baseUrl,
    [...relations.map((relation) => ({ database: relation.database as string, name: relation.name })),
      ...(config.lookups ?? []).map((lookup) => ({ database: lookup.database, name: lookup.collection }))],
    httpFetch, authHeaders, signal, undefined, config.expectedSourceRights, expectedServerId);
  const storeName = `datatug-federated-${observer?.storageId ?? `${Date.now()}-${crypto.randomUUID()}`}`;
  observer?.onStorageOwned?.(storeName);
  const cache = new IndexedDbDatabase({
    name: storeName,
    version: 1,
    collections: relations.map((relation) => ({
      name: `${relation.database}.${relation.name}`,
      storeName: `${relation.database}_${relation.name}`,
    })),
  });
  try {
    let rowsLoaded = 0;
    let rowsProcessed = 0;
    let lookupCompleted = 0;
    let lookupInFlight = 0;
    let lookupPending = 0;
    let stage: FederatedQueryProgress['stage'] = 'loading';
    const report = (): void =>
      onProgress?.({
        stage,
        rowsLoaded,
        rowsProcessed,
        requestsCompleted: lookupCompleted,
        requestsInFlight: lookupInFlight,
        requestsPending: lookupPending,
      });
    const lookupOptions = (lookup: Lookup) => {
      if (
        !/^[A-Za-z0-9_-]+$/.test(lookup.database) ||
        !/^[A-Za-z0-9_-]+$/.test(lookup.collection)
      )
        throw new Error(
          'Lookup database and collection names must be simple identifiers.',
        );
      const cache = new Map<string, Promise<Data>>();
      const pendingKeys = new Set<string>();
      const keyOf = (
        row: QueryPage<Data>['records'][number],
      ): string | number => {
        const value = row.data[lookup.fromColumn];
        if (
          (typeof value !== 'number' || !Number.isSafeInteger(value)) &&
          typeof value !== 'string'
        )
          throw new Error(
            `Lookup column ${lookup.fromColumn} needs a string or safe integer.`,
          );
        return value;
      };
      const schedule = (rows: QueryPage<Data>['records']): void => {
        for (const row of rows) {
          const value = String(keyOf(row));
          if (cache.has(value) || pendingKeys.has(value)) continue;
          pendingKeys.add(value);
          lookupPending++;
        }
        report();
      };
      const options = {
        ...(lookup.concurrency === undefined
          ? {}
          : { concurrency: lookup.concurrency }),
        keyOf,
        fetch: async (value: string | number): Promise<Data> => {
          stage = 'lookup';
          const cacheKey = String(value);
          let promise = cache.get(cacheKey);
          if (!promise) {
            if (pendingKeys.delete(cacheKey)) lookupPending--;
            lookupInFlight++;
            report();
            promise = fetchLookup(lookup, cacheKey).finally(() => {
              lookupInFlight--;
              lookupCompleted++;
              report();
            });
            cache.set(cacheKey, promise);
            if (cache.size > 1000) {
              const oldest = cache.keys().next().value;
              if (oldest !== undefined) cache.delete(oldest);
            }
            promise.catch(() => cache.delete(cacheKey));
          }
          return promise;
        },
        merge: (row: QueryPage<Data>['records'][number], data: Data): Data => {
          const merged = { ...row.data };
          for (const field of lookup.fields)
            merged[field.target] = data[field.source] ?? null;
          return merged;
        },
      };
      return { options, schedule };
    };
    const applyLookups = (
      source: AsyncIterable<QueryPage<Data>>,
    ): AsyncIterable<QueryPage<Data>> => {
      let pages = source;
      for (const lookup of config.lookups ?? []) {
        const handler = lookupOptions(lookup);
        const prepared = (async function* (
          input: AsyncIterable<QueryPage<Data>>,
        ) {
          for await (const page of input) {
            handler.schedule(page.records);
            yield page;
          }
        })(pages);
        pages = executeRecordLookupPages(prepared, handler.options);
      }
      return pages;
    };
    const fetchLookup = async (
      lookup: Lookup,
      value: string,
    ): Promise<Data> => {
      const url = `${baseUrl}/v1/databases/${lookup.database}/records/${lookup.collection}/${encodeURIComponent(value)}`;
      for (let attempt = 0; attempt < 3; attempt++) {
        signal?.throwIfAborted();
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(), 15000);
        try {
          const response = await httpFetch(url, {
            headers: { Accept: 'application/json', ...authHeaders },
            redirect: 'error',
            signal: signal
              ? AbortSignal.any([signal, timeout.signal])
              : timeout.signal,
          });
          if (!response.ok) {
            if (
              [408, 429, 502, 503, 504].includes(response.status) &&
              attempt < 2
            ) {
              await retryDelay(attempt, signal);
              continue;
            }
            throw new Error(
              `OVDB lookup ${lookup.database}/${lookup.collection} failed (${response.status}).`,
            );
          }
          const record = (await response.json()) as OvdbRecord;
          if (!rightsHandledByTransport) rights.accept({ database: lookup.database, name: lookup.collection }, record as unknown as Record<string, unknown>);
          if (
            !record.data ||
            typeof record.data !== 'object' ||
            Array.isArray(record.data)
          )
            throw new Error('OVDB lookup returned invalid JSON data.');
          return record.data;
        } catch (error) {
          signal?.throwIfAborted();
          if (attempt === 2) throw error;
          if (!timeout.signal.aborted && !(error instanceof TypeError))
            throw error;
          await retryDelay(attempt, signal);
        } finally {
          clearTimeout(timer);
        }
      }
      throw new Error('OVDB lookup retries exhausted.');
    };

    let outputNames: string[] | undefined;
    let totalOutputRows = 0;
    const firstOutputRows: TypedValue[][] = [];
    const emitOutput = async (
      rows: QueryPage<Data>['records'],
    ): Promise<void> => {
      signal?.throwIfAborted();
      if (!outputNames && rows.length) outputNames = Object.keys(rows[0].data);
      const names = outputNames ?? [];
      const converted = rows.map((row) =>
        names.map((name) => typed(row.data[name])),
      );
      if (converted.length) observer?.onFirstRecord?.();
      for (const row of converted)
        if (firstOutputRows.length < 100) firstOutputRows.push(row);
      totalOutputRows += converted.length;
      await onOutputPage?.(converted);
      if (mode === 'visible') {
        onPageReady?.(pagedResponse());
        if (rows.length === 100) await waitForNextPage?.();
      }
    };
    const pagedResponse = (): FederatedQueryResult => ({
      ...rights.evidence(),
      recordset: {
        columns: (
          outputNames ??
          definition.recordsets?.[0]?.columns.map((column) => column.name) ??
          []
        ).map((name) => ({ name, type: 'unknown' })),
        rows: firstOutputRows,
      },
      ...(mode === 'visible'
        ? { hasMore: true }
        : { totalRows: totalOutputRows }),
      limitations: [],
      bindingsApplied: [],
      truncated: false,
      provenance: {
        source: `${baseUrl} (direct OVDB)`,
        queryId: definition.id,
        mode: 'live',
        observedAt: new Date().toISOString(),
        executionProfile: 'protected',
      },
    });
    const fetchPages = async function* (
      relation: QueryRelation,
      query: StructuredQuery<Data>,
    ): AsyncIterable<OvdbPage> {
      const ordered = query.orders;
      let remaining = query.limit;
      if (remaining === 0) return;
      const pageSize = Math.min(
        remaining ?? (mode === 'visible' ? 100 : 500),
        mode === 'visible' ? 100 : 500,
      );
      let pageToken: string | undefined;
      let snapshotToken: string | undefined;
      let sourceRows = 0;
      let sourceRequests = 0;
      const sourceStarted = performance.now();
      const body = JSON.stringify({
        from: {
          name: relation.name,
          ...(relation.schema ? { schema: relation.schema } : {}),
        },
        ...(ordered.length
          ? {
              orderBy: ordered.map((item) => ({
                field: item.field,
                ...(item.direction === 'desc' ? { desc: true } : {}),
              })),
            }
          : {}),
      });
      try {
        for (;;) {
          signal?.throwIfAborted();
          if (pageToken === undefined) {
            stage = 'preparing';
            report();
          }
          const response = await httpFetch(
            `${baseUrl}/v1/databases/${encodeURIComponent(relation.database || '')}/dtql`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/yaml',
                Accept: 'application/json',
                'OVDB-Page-Size': String(pageSize),
                ...(pageToken ? { 'OVDB-Page-Token': pageToken } : {}),
                ...authHeaders,
              },
              body,
              redirect: 'error',
              signal,
            },
          );
          if (response.status === 410)
            throw new Error(
              `OVDB ${relation.database} source snapshot expired. Run the query again.`,
            );
          if (response.status === 413)
            throw new Error(
              `OVDB ${relation.database} source snapshot exceeds the server limit.`,
            );
          if (response.status === 503)
            throw new Error(
              `OVDB ${relation.database} cannot prepare a source snapshot right now.`,
            );
          if (response.status === 422)
            throw new Error(
              `OVDB ${relation.database} does not support this snapshot query.`,
            );
          if (!response.ok)
            throw new Error(
              `OVDB ${relation.database} query failed (${response.status}).`,
            );
          sourceRequests++;
          const page = (await response.json()) as OvdbPage;
          if (!rightsHandledByTransport) rights.accept({ database: relation.database as string, name: relation.name }, page as unknown as Record<string, unknown>);
          if (
            !Array.isArray(page.records) ||
            page.records.length > pageSize ||
            (page.nextPageToken !== undefined &&
              (!page.nextPageToken ||
                typeof page.nextPageToken !== 'string')) ||
            (page.snapshotToken !== undefined &&
              (!page.snapshotToken || typeof page.snapshotToken !== 'string'))
          )
            throw new Error(
              `OVDB ${relation.database} returned an invalid page.`,
            );
          if (page.snapshotToken) snapshotToken = page.snapshotToken;
          const records =
            remaining === undefined
              ? page.records
              : page.records.slice(0, remaining);
          rowsLoaded += records.length;
          sourceRows += records.length;
          stage = 'loading';
          report();
          yield { records };
          remaining =
            remaining === undefined ? undefined : remaining - records.length;
          if (remaining === 0 || !page.nextPageToken) {
            observer?.onSourceLoaded?.({
              database: relation.database || '',
              name: relation.name,
              rows: sourceRows,
              requests: sourceRequests,
              elapsedMs: performance.now() - sourceStarted,
            });
            break;
          }
          if (page.nextPageToken === pageToken)
            throw new Error(
              `OVDB ${relation.database} did not advance its snapshot page token.`,
            );
          pageToken = page.nextPageToken;
        }
      } finally {
        if (snapshotToken) {
          // A completed snapshot still occupies server capacity until explicitly released.
          // Use a fresh signal because cancellation must not abort the release request.
          try {
            await httpFetch(
              `${baseUrl}/v1/databases/${encodeURIComponent(relation.database || '')}/dtql`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/yaml',
                  Accept: 'application/json',
                  'OVDB-Page-Size': String(pageSize),
                  'OVDB-Page-Token': snapshotToken,
                  'OVDB-Page-Close': 'true',
                  ...authHeaders,
                },
                body,
                redirect: 'error',
                signal: AbortSignal.timeout(5000),
              },
            );
          } catch {
            /* The server also expires abandoned snapshots. */
          }
        }
      }
    };
    const executorFor = (relation: QueryRelation): QueryExecutor => ({
      query: async <T>(query: StructuredQuery<T>) => {
        const sourceName = `${relation.database}.${relation.name}`;
        if (query.source.name !== sourceName)
          throw new Error(`Unexpected scan source ${query.source.name}.`);
        for await (const page of fetchPages(
          relation,
          query as StructuredQuery<Data>,
        )) {
          await cache.runReadwriteTransaction(async (transaction) => {
            for (const row of page.records) {
              if (
                typeof row.key !== 'string' ||
                !row.data ||
                typeof row.data !== 'object' ||
                Array.isArray(row.data)
              ) {
                throw new Error(
                  `OVDB ${relation.database} returned an invalid row.`,
                );
              }
              await transaction.set(key(sourceName, row.key), row.data);
            }
          });
        }
        return (await cache.query(
          query as StructuredQuery<Data>,
        )) as QueryPage<T>;
      },
    });
    const streamedLookup =
      parsed.from.joins.length === 0 &&
      (config.lookups?.length ?? 0) > 0 &&
      parsed.filters.length === 0 &&
      parsed.orders.length === 0 &&
      parsed.columns === undefined &&
      parsed.groupBy === undefined &&
      parsed.having === undefined &&
      parsed.offset === undefined;
    const pagedJoin =
      parsed.from.joins.length === 1 &&
      parsed.groupBy === undefined &&
      parsed.having === undefined &&
      parsed.orders.length === 0 &&
      !(parsed.columns ?? []).some(
        (column) =>
          column.expression !== undefined &&
          containsAggregate(column.expression),
      );
    if (mode === 'visible' && !federatedVisibleMode(definition).supported) {
      throw new Error(
        federatedVisibleMode(definition).reason ??
          'Visible rows is unavailable for this query. Choose Full result.',
      );
    }
    if (streamedLookup) {
      let pages: AsyncIterable<QueryPage<Data>> = (async function* () {
        const relation = parsed.from;
        const scanLimit = relation.scan?.limit;
        const queryLimit = parsed.limit;
        const limit =
          scanLimit === undefined
            ? queryLimit
            : queryLimit === undefined
              ? scanLimit
              : Math.min(scanLimit, queryLimit);
        const source: StructuredQuery<Data> = {
          source: {
            kind: 'collection',
            name: `${relation.database}.${relation.name}`,
          },
          filters: [],
          orders: relation.scan?.orderBy ?? [],
          ...(limit === undefined ? {} : { limit }),
        };
        for await (const page of fetchPages(relation, source)) {
          yield {
            records: page.records.map((row) => ({
              key: key(`${relation.database}.${relation.name}`, row.key),
              exists: true as const,
              data: row.data,
            })),
          };
        }
      })();
      pages = applyLookups(pages);
      const records: QueryPage<Data>['records'][number][] = [];
      for await (const page of pages) {
        if (onOutputPage) await emitOutput(page.records);
        else records.push(...page.records);
        rowsProcessed += page.records.length;
        report();
      }
      stage = 'complete';
      report();
      if (onOutputPage) return pagedResponse();
      const names = records.length
        ? Object.keys(records[0].data)
        : (definition.recordsets?.[0]?.columns.map((column) => column.name) ??
          []);
      return {
        ...rights.evidence(),
        recordset: {
          columns: names.map((name) => ({ name, type: 'unknown' })),
          rows: records.map((row) =>
            names.map((name) => typed(row.data[name])),
          ),
        },
        limitations: [],
        bindingsApplied: [],
        truncated: false,
        provenance: {
          source: `${baseUrl} (direct OVDB)`,
          queryId: definition.id,
          mode: 'live',
          observedAt: new Date().toISOString(),
          executionProfile: 'protected',
        },
      };
    }
    const executionOptions: JoinedQueryExecutionOptions = {
      ...(config.bounds?.runtime
        ? {
            maxFetchedRows: 5000,
            maxResultRows: config.bounds.resultRows,
            maxRetainedBytes: 5 * 1024 * 1024,
            // Keep approved inputs; no invented smaller candidate quota.
            maxCandidateEvaluations: Number.MAX_SAFE_INTEGER,
          }
        : {}),
      schema: { tables: config.tables },
      resolveSource: (relation) => ({
        kind: 'collection',
        name: `${relation.database}.${relation.name}`,
      }),
      resolveExecutor: executorFor,
      scanPages: async function* (relation, query) {
        const sourceName = `${relation.database}.${relation.name}`;
        for await (const page of fetchPages(relation, query)) {
          await cache.runReadwriteTransaction(async (transaction) => {
            for (const row of page.records) {
              if (
                typeof row.key !== 'string' ||
                !row.data ||
                typeof row.data !== 'object' ||
                Array.isArray(row.data)
              )
                throw new Error(
                  `OVDB ${relation.database} returned an invalid row.`,
                );
              await transaction.set(key(sourceName, row.key), row.data);
            }
          });
          yield {
            records: page.records.map((row) => ({
              key: key(sourceName, row.key),
              exists: true as const,
              data: row.data,
            })),
          };
        }
      },
      ...(onProgress
        ? {
            onProgress: (item: JoinedQueryProgress) => {
              if (item.phase === 'process') {
                rowsProcessed = item.rows;
                stage = 'processing';
              }
              report();
            },
          }
        : {}),
    };
    let records: QueryPage<Data>['records'];
    if (pagedJoin && !config.bounds?.runtime) {
      if (onOutputPage) {
        let pages: AsyncIterable<QueryPage<Data>> = executeJoinedDTQLQueryPages(
          parsed,
          mode === 'visible'
            ? ({
                ...executionOptions,
                pageSize: 100,
              } as JoinedQueryExecutionOptions)
            : executionOptions,
        );
        pages = applyLookups(pages);
        for await (const page of pages) await emitOutput(page.records);
        stage = 'complete';
        report();
        return pagedResponse();
      }
      const paged: QueryPage<Data>['records'][number][] = [];
      for await (const page of executeJoinedDTQLQueryPages(
        parsed,
        executionOptions,
      ))
        paged.push(...page.records);
      records = paged;
    } else {
      records = (
        await executeJoinedDTQLQuery(
          executorFor(parsed.from),
          parsed,
          executionOptions,
        )
      ).records;
    }
    for (const lookup of config.lookups ?? []) {
      const handler = lookupOptions(lookup);
      handler.schedule(records);
      records = await executeRecordLookups(records, handler.options);
    }
    stage = 'complete';
    report();
    const names = records.length
      ? Object.keys(records[0].data)
      : (definition.recordsets?.[0]?.columns.map((column) => column.name) ??
        []);
    if (records.length) observer?.onFirstRecord?.();
    return {
      ...rights.evidence(),
      recordset: {
        columns: names.map((name) => ({ name, type: 'unknown' })),
        rows: records.map((row) => names.map((name) => typed(row.data[name]))),
      },
      limitations: [],
      bindingsApplied: [],
      truncated: false,
      provenance: {
        source: `${baseUrl} (direct OVDB)`,
        queryId: definition.id,
        mode: 'live',
        observedAt: new Date().toISOString(),
        executionProfile: 'protected',
      },
    };
  } catch (error) {
    throw queryStorageError(error);
  } finally {
    await cache.close();
    await deleteQueryDatabase(storeName);
  }
}
