import {
  executeJoinedDTQLQuery, executeJoinedDTQLQueryPages, executeRecordLookupPages, executeRecordLookups, isJoinedDTQLQuery, key, parseDTQL,
  type DTQLExpression, type JoinedQueryExecutionOptions, type JoinedQueryProgress, type QueryExecutor, type QueryPage, type QueryRelation, type StructuredQuery,
} from '@dalgo/core';
import { IndexedDbDatabase } from '@dalgo/indexeddb';
import type { RunQueryResponse, TypedValue } from '@sneat/datatug-semantic';
import type { IQueryDef, ITextQueryRequest } from '../models/definition/query-def';

type Data = Record<string, unknown>;
interface OvdbRecord { readonly key: string; readonly data: Data }
interface OvdbPage { readonly records: readonly OvdbRecord[]; readonly nextCursor?: unknown }

function containsAggregate(expression: DTQLExpression): boolean {
  return expression.kind === 'aggregate' || (expression.kind === 'binary' && (containsAggregate(expression.left) || containsAggregate(expression.right)));
}

export interface FederatedQueryProgress {
  readonly rowsLoaded: number;
  readonly rowsProcessed: number;
  readonly requestsCompleted: number;
  readonly requestsInFlight: number;
  readonly requestsPending: number;
}

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

/** Runs each leaf against OVDB directly and merges/aggregates in this runtime. */
export async function runFederatedQuery(definition: IQueryDef, onProgress?: (progress: FederatedQueryProgress) => void, token = ''): Promise<RunQueryResponse> {
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
    const storeName = `datatug-federated-${crypto.randomUUID()}`;
    const cache = new IndexedDbDatabase({ name: storeName, version: 1, collections: relations.map((relation) => ({
      name: `${relation.database}.${relation.name}`, storeName: `${relation.database}_${relation.name}`,
    })) });
    try {
      let rowsLoaded = 0;
      let rowsProcessed = 0;
      const fetchPages = async function* (relation: QueryRelation, query: StructuredQuery<Data>): AsyncIterable<OvdbPage> {
        const ordered = query.orders;
        const bounded = query.limit !== undefined && query.limit <= 500;
        if (!bounded && ordered.length > 0 && (ordered.length !== 1 || ordered[0]?.field !== 'id' || ordered[0]?.direction !== 'asc')) {
          throw new Error(`Large OVDB scans of ${relation.name} require ascending id order.`);
        }
        let lastId: string | number | undefined;
        let remaining = query.limit;
        for (;;) {
          const limit = Math.min(remaining ?? 500, 500);
          const order = bounded ? ordered : [{ field: 'id', direction: 'asc' as const }];
          const body = JSON.stringify({
            from: { name: relation.name, ...(relation.schema ? { schema: relation.schema } : {}) },
            orderBy: order.map((item) => ({ field: item.field, ...(item.direction === 'desc' ? { desc: true } : {}) })),
            limit,
            ...(lastId === undefined ? {} : { where: { op: '>', left: { field: 'id' }, right: { value: lastId } } }),
          });
          const response = await fetch(`${baseUrl}/v1/databases/${encodeURIComponent(relation.database || '')}/dtql`, {
            method: 'POST', headers: { 'Content-Type': 'application/yaml', Accept: 'application/json', ...authHeaders }, body, redirect: 'error',
          });
          if (!response.ok) throw new Error(`OVDB ${relation.database} query failed (${response.status}).`);
          const page = await response.json() as OvdbPage;
          if (!Array.isArray(page.records) || page.records.length > limit || page.nextCursor !== undefined) throw new Error(`OVDB ${relation.database} returned an invalid page.`);
          rowsLoaded += page.records.length;
          onProgress?.({ rowsLoaded, rowsProcessed, requestsCompleted: 0, requestsInFlight: 0, requestsPending: 0 });
          yield page;
          if (page.records.length < limit || bounded) break;
          remaining = remaining === undefined ? undefined : remaining - page.records.length;
          if (remaining === 0) break;
          const id = page.records.at(-1)?.data.id;
          if ((typeof id !== 'number' || !Number.isSafeInteger(id)) && typeof id !== 'string') throw new Error(`OVDB ${relation.database} needs a stable id field for paging.`);
          if (lastId !== undefined && (typeof id !== typeof lastId || (typeof id === 'number' && typeof lastId === 'number' && id <= lastId) || (typeof id === 'string' && typeof lastId === 'string' && id <= lastId))) {
            throw new Error(`OVDB ${relation.database} did not advance its id cursor.`);
          }
          lastId = id;
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
        for (const lookup of config.lookups ?? []) {
          if (!/^[A-Za-z0-9_-]+$/.test(lookup.database) || !/^[A-Za-z0-9_-]+$/.test(lookup.collection)) throw new Error('Lookup database and collection names must be simple identifiers.');
          pages = executeRecordLookupPages(pages, {
            ...(lookup.concurrency === undefined ? {} : { concurrency: lookup.concurrency }),
            keyOf: (row) => {
              const value = row.data[lookup.fromColumn];
              if ((typeof value !== 'number' || !Number.isSafeInteger(value)) && typeof value !== 'string') throw new Error(`Lookup column ${lookup.fromColumn} needs a string or safe integer.`);
              return value;
            },
            fetch: async (value) => {
              const response = await fetch(`${baseUrl}/v1/databases/${lookup.database}/records/${lookup.collection}/${encodeURIComponent(String(value))}`, { headers: { Accept: 'application/json', ...authHeaders }, redirect: 'error' });
              if (!response.ok) throw new Error(`OVDB lookup ${lookup.database}/${lookup.collection} failed (${response.status}).`);
              const record = await response.json() as OvdbRecord;
              if (!record.data || typeof record.data !== 'object' || Array.isArray(record.data)) throw new Error('OVDB lookup returned invalid JSON data.');
              return record.data;
            },
            merge: (row, data) => {
              const merged = { ...row.data };
              for (const field of lookup.fields) merged[field.target] = data[field.source] ?? null;
              return merged;
            },
            onProgress: (item) => onProgress?.({ rowsLoaded, rowsProcessed, requestsCompleted: item.requestsCompleted, requestsInFlight: item.requestsInFlight, requestsPending: item.requestsPending }),
          });
        }
        const records: QueryPage<Data>['records'][number][] = [];
        for await (const page of pages) {
          records.push(...page.records);
          rowsProcessed += page.records.length;
          onProgress?.({ rowsLoaded, rowsProcessed, requestsCompleted: rowsProcessed, requestsInFlight: 0, requestsPending: 0 });
        }
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
          if (item.phase === 'process') rowsProcessed = item.rows;
          onProgress({ rowsLoaded, rowsProcessed, requestsCompleted: 0, requestsInFlight: 0, requestsPending: 0 });
        } } : {}),
      };
      let records: QueryPage<Data>['records'];
      if (parsed.from.joins.length === 1 && parsed.groupBy === undefined && parsed.having === undefined && parsed.orders.length === 0 &&
          !(parsed.columns ?? []).some((column) => column.expression !== undefined && containsAggregate(column.expression))) {
        const paged: QueryPage<Data>['records'][number][] = [];
        for await (const page of executeJoinedDTQLQueryPages(parsed, executionOptions)) paged.push(...page.records);
        records = paged;
      } else {
        records = (await executeJoinedDTQLQuery(executorFor(parsed.from), parsed, executionOptions)).records;
      }
      for (const lookup of config.lookups ?? []) {
        if (!/^[A-Za-z0-9_-]+$/.test(lookup.database) || !/^[A-Za-z0-9_-]+$/.test(lookup.collection)) throw new Error('Lookup database and collection names must be simple identifiers.');
        records = await executeRecordLookups(records, {
          ...(lookup.concurrency === undefined ? {} : { concurrency: lookup.concurrency }),
          keyOf: (row) => {
            const value = row.data[lookup.fromColumn];
            if ((typeof value !== 'number' || !Number.isSafeInteger(value)) && typeof value !== 'string') throw new Error(`Lookup column ${lookup.fromColumn} needs a string or safe integer.`);
            return value;
          },
          fetch: async (value) => {
            const response = await fetch(`${baseUrl}/v1/databases/${lookup.database}/records/${lookup.collection}/${encodeURIComponent(String(value))}`, { headers: { Accept: 'application/json', ...authHeaders }, redirect: 'error' });
            if (!response.ok) throw new Error(`OVDB lookup ${lookup.database}/${lookup.collection} failed (${response.status}).`);
            const record = await response.json() as OvdbRecord;
            if (!record.data || typeof record.data !== 'object' || Array.isArray(record.data)) throw new Error('OVDB lookup returned invalid JSON data.');
            return record.data;
          },
          merge: (row, data) => {
            const merged = { ...row.data };
            for (const field of lookup.fields) merged[field.target] = data[field.source] ?? null;
            return merged;
          },
          onProgress: (item) => onProgress?.({ rowsLoaded, rowsProcessed, requestsCompleted: item.requestsCompleted, requestsInFlight: item.requestsInFlight, requestsPending: item.requestsPending }),
        });
      }
      const names = records.length ? Object.keys(records[0].data) : (definition.recordsets?.[0]?.columns.map((column) => column.name) ?? []);
      return {
        recordset: {
          columns: names.map((name) => ({ name, type: 'unknown' })),
          rows: records.map((row) => names.map((name) => typed(row.data[name]))),
        },
        limitations: [], bindingsApplied: [], truncated: false,
        provenance: { source: `${baseUrl} (direct OVDB)`, queryId: definition.id, mode: 'live', observedAt: new Date().toISOString(), executionProfile: 'protected' },
      };
    } finally {
      await cache.close();
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(storeName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error('Cannot remove the temporary query table.'));
        request.onblocked = () => reject(new Error('The temporary query table is still open.'));
      });
    }
  }
