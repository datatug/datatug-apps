import { Injectable } from '@angular/core';
import { decodeTypedValue, type TypedValue } from '@sneat/datatug-semantic';
import type { FederatedQueryResult } from './federated-query-executor';
import type { ITextQueryRequest } from '../models/definition/query-def';
import { QueryType } from '../models/definition/query-def';
import { QueryDispatchError, type QueryDispatchPlan, type QueryDispatchRequest } from './query-dispatch';
import { prepareDeclaredSqlBindings, type SqliteScalar } from './sql-bindings';
const MAX_FIXTURE_BYTES = 10 * 1024 * 1024;
const FIXTURE_READ_TIMEOUT_MS = 10_000;
const WORKER_TIMEOUT_MS = 10_000;
const SAFE_WORKER_ERRORS = new Set([
  'Use one read-only SELECT statement of at most 64 KiB.',
  'Use one read-only SELECT statement.',
  'The pinned browser SQLite fixture is required.',
  'The browser SQLite bindings are invalid.',
  'The SQL placeholder count does not match the supplied values.',
  'The query must return 1 to 40 columns.',
  'The browser SQLite bindings do not match the query.',
  'The query exceeds the 1,000-row browser limit.',
  'Blob or non-finite values are unavailable in browser query results.',
  'The query exceeds the 1 MiB browser result limit.',
]);

interface NormalizedFixture {
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface WorkerReply {
  readonly ok: boolean;
  readonly result?: { readonly columns: readonly string[]; readonly rows: readonly (readonly (string | number | null)[])[] };
  readonly error?: string;
}

function abortError(): Error {
  const error = new Error('The browser SQLite query was cancelled.');
  error.name = 'AbortError';
  return error;
}

function normalizeFixture(connection: NonNullable<QueryDispatchPlan['connection']>): NormalizedFixture {
  const declared = connection.browserFixture;
  const fixture = declared && typeof declared.url === 'string' && typeof declared.bytes === 'number'
    ? { url: declared.url, bytes: declared.bytes, sha256: connection.fixtureSha256 ?? '' }
    : undefined;
  if (!fixture || !/^https:\/\//u.test(fixture.url) || fixture.bytes < 1 || !Number.isSafeInteger(fixture.bytes) ||
    fixture.bytes > MAX_FIXTURE_BYTES || !/^[a-f0-9]{64}$/u.test(fixture.sha256)) {
    if (fixture && fixture.bytes > MAX_FIXTURE_BYTES)
      throw new QueryDispatchError('This SQLite fixture exceeds the 10 MiB browser limit. Choose a runtime that supports this dataset size.');
    throw new QueryDispatchError('This connection does not declare a valid, bounded browser SQLite fixture.');
  }
  const url = new URL(fixture.url);
  const host = url.hostname.toLowerCase();
  const publicHostname = host.includes('.') && !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host) &&
    !host.startsWith('[') && !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/u.test(host);
  if (url.protocol !== 'https:' || !publicHostname || url.username || url.password || url.hash || url.search || (url.port && url.port !== '443'))
    throw new QueryDispatchError('The browser SQLite fixture URL is not an allowed public HTTPS URL.');
  return Object.freeze(fixture);
}

async function readFixture(target: NormalizedFixture, signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  signal?.addEventListener('abort', relayAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), FIXTURE_READ_TIMEOUT_MS);
  try {
    const response = await fetch(target.url, {
      redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new QueryDispatchError('The pinned browser SQLite fixture is unavailable.');
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null && !response.headers.has('content-encoding') && Number(contentLength) !== target.bytes)
      throw new QueryDispatchError('The browser SQLite fixture size differs from its pin.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > target.bytes || length > MAX_FIXTURE_BYTES) {
          await reader.cancel();
          throw new QueryDispatchError('The browser SQLite fixture exceeds its pinned size.');
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (length !== target.bytes) throw new QueryDispatchError('The browser SQLite fixture size differs from its pin.');
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const actual = [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
    if (actual !== target.sha256) throw new QueryDispatchError('The browser SQLite fixture hash differs from its pin.');
    return bytes;
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (controller.signal.aborted) throw new QueryDispatchError('The browser SQLite fixture download exceeded 10 seconds.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relayAbort);
  }
}

function scalar(value: TypedValue): SqliteScalar {
  const decoded = decodeTypedValue(value);
  if (decoded.type === 'null') return null;
  if (decoded.type === 'integer') {
    const integer = Number(decoded.value);
    if (!Number.isSafeInteger(integer) || BigInt(decoded.value) !== BigInt(integer))
      throw new QueryDispatchError('This browser SQLite input cannot represent the integer losslessly.');
    return integer;
  }
  if (decoded.type === 'number') {
    if (!Number.isFinite(decoded.value)) throw new QueryDispatchError('This browser SQLite number input is invalid.');
    return decoded.value;
  }
  if (decoded.type === 'boolean') return decoded.value ? 1 : 0;
  if (decoded.type === 'string' || decoded.type === 'date' || decoded.type === 'datetime') return decoded.value;
  throw new QueryDispatchError('This browser SQLite adapter supports only lossless scalar inputs.');
}

function resultValue(value: string | number | bigint | null): TypedValue {
  if (value === null) return { type: 'null', value: null };
  if (typeof value === 'bigint') return { type: 'integer', value: value.toString() };
  if (typeof value === 'string') return { type: 'string', value };
  if (Number.isSafeInteger(value)) return { type: 'integer', value: String(value) };
  return { type: 'number', value };
}

@Injectable({ providedIn: 'root' })
export class BrowserSqliteQueryService {
  async execute(plan: QueryDispatchPlan, request: QueryDispatchRequest): Promise<FederatedQueryResult> {
    const definition = request.definition;
    if (plan.target.kind !== 'browser-sqlite' || !plan.connection || definition.federation || definition.request.queryType !== QueryType.SQL)
      throw new QueryDispatchError('The selected query is not supported by browser SQLite.');
    if (request.environment && plan.connection.environments && !plan.connection.environments.includes(request.environment))
      throw new QueryDispatchError('The selected SQLite connection is unavailable in this environment.');
    const target = normalizeFixture(plan.connection);
    const declared = definition.parameters ?? [];
    const values = request.parameters ?? {};
    const declaredIds = new Set(declared.map((parameter) => parameter.id));
    if (Object.keys(values).some((id) => !declaredIds.has(id)) ||
      declared.some((parameter) => parameter.isRequired !== false && values[parameter.id] === undefined))
      throw new QueryDispatchError('This browser SQLite source has missing required or undeclared parameters.');
    if (declared.some((parameter) => parameter.isMultiValue))
      throw new QueryDispatchError('This browser SQLite source supports scalar parameters only.');
    const sql = (definition.request as ITextQueryRequest).text;
    // SQL binds an omitted optional input as NULL. It is not reported as a manual binding.
    const scalarValues = new Map(declared.map((parameter) => [
      parameter.id, values[parameter.id] === undefined ? null : scalar(values[parameter.id]),
    ] as const));
    const prepared = declared.length
      ? prepareDeclaredSqlBindings(sql, declared, scalarValues, declared.map((parameter) => scalarValues.get(parameter.id) ?? null))
      : { sql, bindings: [] as SqliteScalar[] };
    const fixture = await readFixture(target, request.signal);
    if (request.signal?.aborted) throw abortError();
    if (typeof Worker === 'undefined') throw new QueryDispatchError('This browser does not support SQLite query workers.');
    const worker = new Worker(new URL('./browser-sqlite-query.worker.ts', import.meta.url), { type: 'module' });
    try {
      const reply = await new Promise<WorkerReply>((resolve, reject) => {
        let settled = false;
        const clear = () => {
          clearTimeout(timer);
          request.signal?.removeEventListener('abort', onAbort);
        };
        const succeed = (value: WorkerReply) => {
          if (settled) return;
          settled = true;
          clear();
          resolve(value);
        };
        const fail = (reason: Error) => {
          if (settled) return;
          settled = true;
          clear();
          reject(reason);
        };
        const onAbort = () => fail(abortError());
        const timer = setTimeout(() => fail(new QueryDispatchError('The browser SQLite query exceeded 10 seconds.')), WORKER_TIMEOUT_MS);
        request.signal?.addEventListener('abort', onAbort, { once: true });
        worker.onmessage = (event: MessageEvent<WorkerReply>) => succeed(event.data);
        worker.onerror = () => fail(new QueryDispatchError('The browser SQLite worker failed.'));
        worker.postMessage({ sql: prepared.sql, bindings: prepared.bindings, fixture }, [fixture.buffer]);
        request.onDispatched?.();
      });
      if (!reply.ok || !reply.result)
        throw new QueryDispatchError(reply.error && SAFE_WORKER_ERRORS.has(reply.error)
          ? reply.error
          : 'The browser SQLite query failed. Check its read-only SQL and declared inputs.');
      const bindingsApplied = declared.filter((parameter) => values[parameter.id] !== undefined).map((parameter) => ({
        parameterId: parameter.id,
        value: values[parameter.id],
        origin: 'manual' as const,
        originEvidence: 'client-reported' as const,
      }));
      return {
        recordset: {
          columns: reply.result.columns.map((name) => ({ name, type: 'unknown' })),
          rows: reply.result.rows.map((row) => row.map(resultValue)),
        },
        limitations: [],
        bindingsApplied,
        truncated: false,
        provenance: {
          source: `Browser SQLite snapshot (${plan.connection.title || plan.connection.id})`,
          queryId: request.queryId,
          mode: 'snapshot' as const,
          observedAt: new Date().toISOString(),
        },
        browserExecution: { runtime: 'sqlite-fixture', fixtureSha256: target.sha256 },
      };
    } finally { worker.terminate(); }
  }

}
