import {
  executeJoinedDTQLQuery, executeJoinedDTQLQueryPages, executeRecordLookupPages, executeRecordLookups, isJoinedDTQLQuery, key, parseDTQL,
  type DTQLExpression, type JoinedQueryExecutionOptions, type JoinedQueryProgress, type QueryExecutor, type QueryPage, type QueryRelation, type StructuredQuery,
} from '@dalgo/core';
import { IndexedDbDatabase } from '@dalgo/indexeddb';
import type { RunQueryResponse, TypedValue } from '@sneat/datatug-semantic';
import type { IQueryDef, ITextQueryRequest } from '../models/definition/query-def';
import { deleteQueryDatabase, queryStorageError } from './federated-query-storage';

type Data = Record<string, unknown>;
interface OvdbRecord { readonly key: string; readonly data: Data }
interface OvdbPage { readonly records: readonly OvdbRecord[]; readonly nextPageToken?: string; readonly snapshotToken?: string; readonly snapshotExpiresAt?: string }

function containsAggregate(expression: DTQLExpression): boolean {
  return expression.kind === 'aggregate' || (expression.kind === 'binary' && (containsAggregate(expression.left) || containsAggregate(expression.right)));
}

export function federatedVisibleMode(definition: IQueryDef): { supported: boolean; defaultMode: FederatedQueryMode; reason?: string } {
  const config = definition.federation;
  if (!config) return { supported: false, defaultMode: 'full' };
  try {
    const parsed = parseDTQL((definition.request as ITextQueryRequest).text, { tables: config.tables });
    if (!isJoinedDTQLQuery(parsed)) return { supported: false, defaultMode: 'full', reason: 'Visible rows requires a cross-source detail query.' };
    const global = parsed.groupBy !== undefined || parsed.having !== undefined || parsed.orders.length > 0 ||
      (parsed.columns ?? []).some((column) => column.expression !== undefined && containsAggregate(column.expression));
    if (global) return { supported: false, defaultMode: 'full', reason: 'Aggregates and global ordering require Full result.' };
    const lookup = parsed.from.joins.length === 0 && (config.lookups?.length ?? 0) > 0 &&
      parsed.filters.length === 0 && parsed.columns === undefined && parsed.offset === undefined;
    const flatJoin = parsed.from.joins.length === 1 && parsed.from.joins[0].from.joins.length === 0;
    if (!lookup && !flatJoin) return { supported: false, defaultMode: 'full', reason: 'Visible rows supports direct lookups or one flat join.' };
    return { supported: true, defaultMode: lookup || parsed.from.joins[0]?.type === 'left' ? 'visible' : 'full' };
  } catch {
    return { supported: false, defaultMode: 'full', reason: 'Visible rows is unavailable until this query can be parsed.' };
  }
}

export interface FederatedQueryProgress {
  readonly stage: 'preparing' | 'loading' | 'processing' | 'lookup' | 'complete';
  readonly rowsLoaded: number;
  readonly rowsProcessed: number;
  readonly requestsCompleted: number;
  readonly requestsInFlight: number;
  readonly requestsPending: number;
}

type Lookup = NonNullable<NonNullable<IQueryDef['federation']>['lookups']>[number];

export type FederatedQueryResult = RunQueryResponse & { readonly totalRows?: number; readonly hasMore?: boolean };
export type FederatedOutputPage = (rows: readonly (readonly TypedValue[])[]) => Promise<void>;
export type FederatedQueryMode = 'full' | 'visible';

function typed(value: unknown): TypedValue {
  if (value === null || value === undefined) return { type: 'null', value: null };
  if (typeof value === 'string') return { type: 'string', value };
  if (typeof value === 'boolean') return { type: 'boolean', value };
  if (typeof value === 'number' && Number.isFinite(value)) return { type: 'number', value };
  throw new Error('OVDB returned a value that cannot be shown in this result.');
}

function ovdbBaseUrl(raw: string): string {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('The OVDB base URL must use HTTPS or local HTTP and contain no credentials or query parameters.');
  }
  return url.href.replace(/\/$/, '');
}

function retryDelay(attempt: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(done, 200 * (attempt + 1));
    function done(): void { signal?.removeEventListener('abort', abort); resolve(); }
    function abort(): void { clearTimeout(timer); reject(signal?.reason); }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Runs each leaf against OVDB directly and merges/aggregates in this runtime. */
export async function runFederatedQuery(definition: IQueryDef, onProgress?: (progress: FederatedQueryProgress) => void, token = '', onOutputPage?: FederatedOutputPage, signal?: AbortSignal, mode: FederatedQueryMode = 'full', onPageReady?: (result: FederatedQueryResult) => void, waitForNextPage?: () => Promise<void>): Promise<FederatedQueryResult> {
    const config = definition.federation;
    if (!config) throw new Error('This query has no direct OVDB configuration.');
    const baseUrl = ovdbBaseUrl(config.ovdbBaseUrl);
    const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const parsed = parseDTQL((definition.request as ITextQueryRequest).text, { tables: config.tables });
    if (!isJoinedDTQLQuery(parsed)) throw new Error('The direct OVDB query must contain a join.');
    const relations: QueryRelation[] = [];
    const visit = (relation: QueryRelation): void => {
      if (!relation.database) throw new Error(`The source ${relation.name} has no database.`);
      relations.push(relation);
      for (const joined of relation.joins) visit(joined.from);
    };
    visit(parsed.from);
    const storeName = `datatug-federated-${Date.now()}-${crypto.randomUUID()}`;
    const cache = new IndexedDbDatabase({ name: storeName, version: 1, collections: relations.map((relation) => ({
      name: `${relation.database}.${relation.name}`, storeName: `${relation.database}_${relation.name}`,
    })) });
    try {
      let rowsLoaded = 0;
      let rowsProcessed = 0;
      let lookupCompleted = 0;
      let lookupInFlight = 0;
      let lookupPending = 0;
      let stage: FederatedQueryProgress['stage'] = 'loading';
      const report = (): void => onProgress?.({ stage, rowsLoaded, rowsProcessed, requestsCompleted: lookupCompleted, requestsInFlight: lookupInFlight, requestsPending: lookupPending });
      const lookupOptions = (lookup: Lookup) => {
        if (!/^[A-Za-z0-9_-]+$/.test(lookup.database) || !/^[A-Za-z0-9_-]+$/.test(lookup.collection)) throw new Error('Lookup database and collection names must be simple identifiers.');
        let stageCompleted = 0;
        const cache = new Map<string, Promise<Data>>();
        return {
          ...(lookup.concurrency === undefined ? {} : { concurrency: lookup.concurrency }),
          keyOf: (row: QueryPage<Data>['records'][number]) => {
            const value = row.data[lookup.fromColumn];
            if ((typeof value !== 'number' || !Number.isSafeInteger(value)) && typeof value !== 'string') throw new Error(`Lookup column ${lookup.fromColumn} needs a string or safe integer.`);
            return value;
          },
          fetch: async (value: string | number): Promise<Data> => {
            stage = 'lookup';
            const cacheKey = String(value);
            let promise = cache.get(cacheKey);
            if (!promise) {
              promise = fetchLookup(lookup, cacheKey);
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
            for (const field of lookup.fields) merged[field.target] = data[field.source] ?? null;
            return merged;
          },
          onProgress: (item: { requestsCompleted: number; requestsInFlight: number; requestsPending: number }): void => {
            stage = 'lookup';
            lookupCompleted += item.requestsCompleted - stageCompleted;
            stageCompleted = item.requestsCompleted;
            lookupInFlight = item.requestsInFlight;
            lookupPending = item.requestsPending;
            report();
          },
        };
      };
      const fetchLookup = async (lookup: Lookup, value: string): Promise<Data> => {
        const url = `${baseUrl}/v1/databases/${lookup.database}/records/${lookup.collection}/${encodeURIComponent(value)}`;
        for (let attempt = 0; attempt < 3; attempt++) {
          signal?.throwIfAborted();
          const timeout = new AbortController();
          const timer = setTimeout(() => timeout.abort(), 15000);
          try {
            const response = await fetch(url, { headers: { Accept: 'application/json', ...authHeaders }, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal });
            if (!response.ok) {
              if ([408, 429, 502, 503, 504].includes(response.status) && attempt < 2) { await retryDelay(attempt, signal); continue; }
              throw new Error(`OVDB lookup ${lookup.database}/${lookup.collection} failed (${response.status}).`);
            }
            const record = await response.json() as OvdbRecord;
            if (!record.data || typeof record.data !== 'object' || Array.isArray(record.data)) throw new Error('OVDB lookup returned invalid JSON data.');
            return record.data;
          } catch (error) {
            signal?.throwIfAborted();
            if (attempt === 2) throw error;
            if (!timeout.signal.aborted && !(error instanceof TypeError)) throw error;
            await retryDelay(attempt, signal);
          } finally { clearTimeout(timer); }
        }
        throw new Error('OVDB lookup retries exhausted.');
      };

      let outputNames: string[] | undefined;
      let totalOutputRows = 0;
      const firstOutputRows: TypedValue[][] = [];
      const emitOutput = async (rows: QueryPage<Data>['records']): Promise<void> => {
        signal?.throwIfAborted();
        if (!outputNames && rows.length) outputNames = Object.keys(rows[0].data);
        const names = outputNames ?? [];
        const converted = rows.map((row) => names.map((name) => typed(row.data[name])));
        for (const row of converted) if (firstOutputRows.length < 100) firstOutputRows.push(row);
        totalOutputRows += converted.length;
        await onOutputPage?.(converted);
        if (mode === 'visible') {
          onPageReady?.(pagedResponse());
          if (rows.length === 100) await waitForNextPage?.();
        }
      };
      const pagedResponse = (): FederatedQueryResult => ({
        recordset: {
          columns: (outputNames ?? definition.recordsets?.[0]?.columns.map((column) => column.name) ?? []).map((name) => ({ name, type: 'unknown' })),
          rows: firstOutputRows,
        },
        ...(mode === 'visible' ? { hasMore: true } : { totalRows: totalOutputRows }),
        limitations: [], bindingsApplied: [], truncated: false,
        provenance: { source: `${baseUrl} (direct OVDB)`, queryId: definition.id, mode: 'live', observedAt: new Date().toISOString(), executionProfile: 'protected' },
      });
      const fetchPages = async function* (relation: QueryRelation, query: StructuredQuery<Data>): AsyncIterable<OvdbPage> {
        const ordered = query.orders;
        let remaining = query.limit;
        if (remaining === 0) return;
        const pageSize = Math.min(remaining ?? (mode === 'visible' ? 100 : 500), mode === 'visible' ? 100 : 500);
        let pageToken: string | undefined;
        let snapshotToken: string | undefined;
        const body = JSON.stringify({
          from: { name: relation.name, ...(relation.schema ? { schema: relation.schema } : {}) },
          ...(ordered.length ? { orderBy: ordered.map((item) => ({ field: item.field, ...(item.direction === 'desc' ? { desc: true } : {}) })) } : {}),
        });
        try {
        for (;;) {
          signal?.throwIfAborted();
          if (pageToken === undefined) { stage = 'preparing'; report(); }
          const response = await fetch(`${baseUrl}/v1/databases/${encodeURIComponent(relation.database || '')}/dtql`, {
            method: 'POST', headers: { 'Content-Type': 'application/yaml', Accept: 'application/json', 'OVDB-Page-Size': String(pageSize), ...(pageToken ? { 'OVDB-Page-Token': pageToken } : {}), ...authHeaders }, body, redirect: 'error', signal,
          });
          if (response.status === 410) throw new Error(`OVDB ${relation.database} source snapshot expired. Run the query again.`);
          if (response.status === 413) throw new Error(`OVDB ${relation.database} source snapshot exceeds the server limit.`);
          if (response.status === 503) throw new Error(`OVDB ${relation.database} cannot prepare a source snapshot right now.`);
          if (response.status === 422) throw new Error(`OVDB ${relation.database} does not support this snapshot query.`);
          if (!response.ok) throw new Error(`OVDB ${relation.database} query failed (${response.status}).`);
          const page = await response.json() as OvdbPage;
          if (!Array.isArray(page.records) || page.records.length > pageSize || (page.nextPageToken !== undefined && (!page.nextPageToken || typeof page.nextPageToken !== 'string')) ||
            (page.snapshotToken !== undefined && (!page.snapshotToken || typeof page.snapshotToken !== 'string'))) throw new Error(`OVDB ${relation.database} returned an invalid page.`);
          if (page.snapshotToken) snapshotToken = page.snapshotToken;
          const records = remaining === undefined ? page.records : page.records.slice(0, remaining);
          rowsLoaded += records.length;
          stage = 'loading';
          report();
          yield { records };
          remaining = remaining === undefined ? undefined : remaining - records.length;
          if (remaining === 0 || !page.nextPageToken) break;
          if (page.nextPageToken === pageToken) throw new Error(`OVDB ${relation.database} did not advance its snapshot page token.`);
          pageToken = page.nextPageToken;
        }
        } finally {
          if (snapshotToken) {
            // A completed snapshot still occupies server capacity until explicitly released.
            // Use a fresh signal because cancellation must not abort the release request.
            try {
              await fetch(`${baseUrl}/v1/databases/${encodeURIComponent(relation.database || '')}/dtql`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/yaml', Accept: 'application/json', 'OVDB-Page-Size': String(pageSize),
                  'OVDB-Page-Token': snapshotToken, 'OVDB-Page-Close': 'true', ...authHeaders },
                body, redirect: 'error', signal: AbortSignal.timeout(5000),
              });
            } catch { /* The server also expires abandoned snapshots. */ }
          }
        }
      };
      const executorFor = (relation: QueryRelation): QueryExecutor => ({
        query: async <T>(query: StructuredQuery<T>) => {
          const sourceName = `${relation.database}.${relation.name}`;
          if (query.source.name !== sourceName) throw new Error(`Unexpected scan source ${query.source.name}.`);
          for await (const page of fetchPages(relation, query as StructuredQuery<Data>)) {
            await cache.runReadwriteTransaction(async (transaction) => {
              for (const row of page.records) {
                if (typeof row.key !== 'string' || !row.data || typeof row.data !== 'object' || Array.isArray(row.data)) {
                  throw new Error(`OVDB ${relation.database} returned an invalid row.`);
                }
                await transaction.set(key(sourceName, row.key), row.data);
              }
            });
          }
          return await cache.query(query as StructuredQuery<Data>) as QueryPage<T>;
        },
      });
      const streamedLookup = parsed.from.joins.length === 0 && (config.lookups?.length ?? 0) > 0 &&
        parsed.filters.length === 0 && parsed.orders.length === 0 && parsed.columns === undefined && parsed.groupBy === undefined &&
        parsed.having === undefined && parsed.offset === undefined;
      const pagedJoin = parsed.from.joins.length === 1 && parsed.groupBy === undefined && parsed.having === undefined && parsed.orders.length === 0 &&
        !(parsed.columns ?? []).some((column) => column.expression !== undefined && containsAggregate(column.expression));
      if (mode === 'visible' && !federatedVisibleMode(definition).supported) {
        throw new Error(federatedVisibleMode(definition).reason ?? 'Visible rows is unavailable for this query. Choose Full result.');
      }
      if (streamedLookup) {
        let pages: AsyncIterable<QueryPage<Data>> = (async function* () {
          const relation = parsed.from;
          const scanLimit = relation.scan?.limit;
          const queryLimit = parsed.limit;
          const limit = scanLimit === undefined ? queryLimit : queryLimit === undefined ? scanLimit : Math.min(scanLimit, queryLimit);
          const source: StructuredQuery<Data> = {
            source: { kind: 'collection', name: `${relation.database}.${relation.name}` },
            filters: [], orders: relation.scan?.orderBy ?? [],
            ...(limit === undefined ? {} : { limit }),
          };
          for await (const page of fetchPages(relation, source)) {
            yield { records: page.records.map((row) => ({ key: key(`${relation.database}.${relation.name}`, row.key), exists: true as const, data: row.data })) };
          }
        })();
        for (const lookup of config.lookups ?? []) pages = executeRecordLookupPages(pages, lookupOptions(lookup));
        const records: QueryPage<Data>['records'][number][] = [];
        for await (const page of pages) {
          if (onOutputPage) await emitOutput(page.records);
          else records.push(...page.records);
          rowsProcessed += page.records.length;
          report();
        }
        stage = 'complete'; report();
        if (onOutputPage) return pagedResponse();
        const names = records.length ? Object.keys(records[0].data) : (definition.recordsets?.[0]?.columns.map((column) => column.name) ?? []);
        return {
          recordset: { columns: names.map((name) => ({ name, type: 'unknown' })), rows: records.map((row) => names.map((name) => typed(row.data[name]))) },
          limitations: [], bindingsApplied: [], truncated: false,
          provenance: { source: `${baseUrl} (direct OVDB)`, queryId: definition.id, mode: 'live', observedAt: new Date().toISOString(), executionProfile: 'protected' },
        };
      }
      const executionOptions: JoinedQueryExecutionOptions = {
        schema: { tables: config.tables },
        resolveSource: (relation) => ({ kind: 'collection', name: `${relation.database}.${relation.name}` }),
        resolveExecutor: executorFor,
        scanPages: async function* (relation, query) {
          const sourceName = `${relation.database}.${relation.name}`;
          for await (const page of fetchPages(relation, query)) {
            await cache.runReadwriteTransaction(async (transaction) => {
              for (const row of page.records) {
                if (typeof row.key !== 'string' || !row.data || typeof row.data !== 'object' || Array.isArray(row.data)) throw new Error(`OVDB ${relation.database} returned an invalid row.`);
                await transaction.set(key(sourceName, row.key), row.data);
              }
            });
            yield { records: page.records.map((row) => ({ key: key(sourceName, row.key), exists: true as const, data: row.data })) };
          }
        },
        ...(onProgress ? { onProgress: (item: JoinedQueryProgress) => {
          if (item.phase === 'process') { rowsProcessed = item.rows; stage = 'processing'; }
          report();
        } } : {}),
      };
      let records: QueryPage<Data>['records'];
      if (pagedJoin) {
        if (onOutputPage) {
          let pages: AsyncIterable<QueryPage<Data>> = executeJoinedDTQLQueryPages(parsed,
            mode === 'visible' ? { ...executionOptions, pageSize: 100 } as JoinedQueryExecutionOptions : executionOptions);
          for (const lookup of config.lookups ?? []) pages = executeRecordLookupPages(pages, lookupOptions(lookup));
          for await (const page of pages) await emitOutput(page.records);
          stage = 'complete'; report();
          return pagedResponse();
        }
        const paged: QueryPage<Data>['records'][number][] = [];
        for await (const page of executeJoinedDTQLQueryPages(parsed, executionOptions)) paged.push(...page.records);
        records = paged;
      } else {
        records = (await executeJoinedDTQLQuery(executorFor(parsed.from), parsed, executionOptions)).records;
      }
      for (const lookup of config.lookups ?? []) records = await executeRecordLookups(records, lookupOptions(lookup));
      stage = 'complete'; report();
      const names = records.length ? Object.keys(records[0].data) : (definition.recordsets?.[0]?.columns.map((column) => column.name) ?? []);
      return {
        recordset: {
          columns: names.map((name) => ({ name, type: 'unknown' })),
          rows: records.map((row) => names.map((name) => typed(row.data[name]))),
        },
        limitations: [], bindingsApplied: [], truncated: false,
        provenance: { source: `${baseUrl} (direct OVDB)`, queryId: definition.id, mode: 'live', observedAt: new Date().toISOString(), executionProfile: 'protected' },
      };
    } catch (error) {
      throw queryStorageError(error);
    } finally {
      await cache.close();
      await deleteQueryDatabase(storeName);
    }
  }
