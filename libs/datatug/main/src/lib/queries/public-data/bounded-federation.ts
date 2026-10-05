import {
  readJsonDriver,
  validateJsonDriver,
  type BoundedJsonDriver,
} from './bounded-https-json-driver';
import { strictJson } from './strict-json';
import { parseDTQL } from '@dalgo/core';
import { validNativeRorUrl } from './public-data-scenario';
import { boundedResponseText } from './bounded-response';
import {
  createImmutableFederationFetch,
  validateImmutableRuntime,
  type BoundedRuntime,
} from './immutable-federation';
import type { BoundedRunBudget } from './bounded-run-budget';
export { boundedResponseBytes, boundedResponseText } from './bounded-response';

export interface BoundedSource {
  readonly database: string;
  readonly name: string;
  readonly keyField: string;
  readonly parent?: {
    readonly database: string;
    readonly name: string;
    readonly field: string;
  };
}

/** Execution constraints, not a semantic acceptance mechanism. */
export interface BoundedFederation {
  /** Transport configuration only; never canonical source/semantic admission. */
  readonly runtime?: BoundedRuntime;
  readonly sources: readonly BoundedSource[];
  readonly driver?: BoundedJsonDriver;
  readonly userRows: number;
  readonly userOffset: number;
  readonly identifierKind: 'place' | 'ror';
  readonly nativeNamespace?: 'ROR:URL';
  readonly identifierLimit: number;
  readonly resultRows: number;
  readonly bytes: number;
  readonly timeoutMs: number;
}

export interface BoundedRecord {
  readonly key: string;
  readonly data: Record<string, unknown>;
}
export interface BoundedReadReceipt {
  readonly sources: ReadonlyMap<string, readonly BoundedRecord[]>;
  readonly bytes: () => number;
  readonly runtime?: import('./immutable-federation').ImmutableReadReceipt;
}

export const PUBLIC_DATA_OVDB_BASES = [
  'https://demodb.dev/ovdb',
  'https://cloud.openvaultdb.com',
] as const;
const namePattern = /^[A-Za-z][A-Za-z0-9_]*$/;
const sourceId = (source: Pick<BoundedSource, 'database' | 'name'>): string =>
  `${source.database}.${source.name}`;

export function validateBounds(bounds: BoundedFederation): void {
  if (bounds.runtime) validateImmutableRuntime(bounds);
  if (
    !['place', 'ror'].includes(bounds.identifierKind) ||
    (bounds.identifierKind === 'ror' && bounds.nativeNamespace !== 'ROR:URL')
  )
    throw new Error(
      'A native ROR lookup requires the explicit reviewed ROR:URL syntax namespace.',
    );
  const cap = bounds.identifierKind === 'ror' ? 50 : 100;
  for (const [name, value, maximum, minimum] of [
    ['user rows', bounds.userRows, 1000, 1],
    ['user offset', bounds.userOffset, 1_000_000, 0],
    ['identifiers', bounds.identifierLimit, cap, 1],
    ['results', bounds.resultRows, 5000, 1],
    ['bytes', bounds.bytes, 5 * 1024 * 1024, 1],
    ['deadline', bounds.timeoutMs, 10000, 1],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
      throw new Error(`The ${name} bound must be ${minimum}–${maximum}.`);
  }
  if (bounds.sources.length < 2 || bounds.sources.length > 4)
    throw new Error(
      'A bounded lookup needs two to four explicit source stages.',
    );
  if (bounds.driver) {
    validateJsonDriver(bounds.driver);
    if (
      sourceId(bounds.driver) !== sourceId(bounds.sources[0]) ||
      !bounds.driver.fields.some(
        (field) => field.name === bounds.sources[0].keyField,
      )
    )
      throw new Error(
        'The declared JSON driver must map exactly the first source relation.',
      );
  }
  const known = new Set<string>();
  for (const [index, source] of bounds.sources.entries()) {
    if (
      ![source.database, source.name, source.keyField].every((name) =>
        namePattern.test(name),
      )
    )
      throw new Error('Source fields must be explicit simple identifiers.');
    const id = sourceId(source);
    if (known.has(id) || (index === 0) !== (source.parent === undefined))
      throw new Error(
        'The source stages must have one driver and distinct dependent references.',
      );
    if (
      source.parent &&
      (sourceId(bounds.sources[index - 1]) !== sourceId(source.parent) ||
        !namePattern.test(source.parent.field))
    )
      throw new Error(
        'Each lookup must reference the immediately preceding source field.',
      );
    known.add(id);
  }
}

/**
 * Loads the driver first, then sends bounded native equality filters for each
 * dependent source. DALgo sees only these verified pages. No data is fetched by
 * construction; the first request occurs inside the user's run action.
 */
export function createBoundedFederationFetch(
  base: string,
  bounds: BoundedFederation,
  httpFetch: typeof fetch,
  signal: AbortSignal,
  budget?: BoundedRunBudget,
): { fetch: typeof fetch; receipt: BoundedReadReceipt; readPage?: (sourceId: string, page: import('./immutable-federation').OrdinaryPage) => Promise<readonly BoundedRecord[]> } {
  validateBounds(bounds);
  if (!(PUBLIC_DATA_OVDB_BASES as readonly string[]).includes(base))
    throw new Error('This OVDB route is outside the public-data allowlist.');
  if (bounds.runtime) {
    if (!budget)
      throw new Error('Immutable transport requires the shared run budget.');
    return createImmutableFederationFetch(base, bounds, httpFetch, budget);
  }
  if (base !== 'https://demodb.dev/ovdb')
    throw new Error('This route requires the explicit immutable read profile.');
  const loaded = new Map<string, readonly BoundedRecord[]>();
  const pending = new Map<string, Promise<readonly BoundedRecord[]>>();
  let bytes = 0;
  const stages = new Map(
    bounds.sources.map((source) => [sourceId(source), source]),
  );
  const load = (
    source: BoundedSource,
    headers: Headers,
  ): Promise<readonly BoundedRecord[]> => {
    const id = sourceId(source);
    const existing = pending.get(id);
    if (existing) return existing;
    const request = (async () => {
      if (bounds.driver && id === sourceId(bounds.driver)) {
        const page = await readJsonDriver(
          bounds.driver,
          bounds.userRows,
          bounds.userOffset,
          bounds.bytes - bytes,
          httpFetch,
          signal,
        );
        bytes += page.bytes;
        loaded.set(id, page.records);
        return page.records;
      }
      let values: string[] | undefined;
      if (source.parent) {
        const parent = stages.get(sourceId(source.parent));
        if (!parent) throw new Error('The parent source is unavailable.');
        const rows = await load(parent, headers);
        const unique = new Set<string>();
        for (const row of rows) {
          const value = row.data[source.parent.field];
          if (value === null || value === undefined || value === '') continue;
          if (
            bounds.nativeNamespace === 'ROR:URL' &&
            (typeof value !== 'string' || !validNativeRorUrl(value))
          )
            continue;
          if (typeof value !== 'string')
            throw new Error(
              'A bounded native key must retain its declared string representation.',
            );
          unique.add(value);
          if (unique.size > bounds.identifierLimit)
            throw new Error(
              'The selected rows exceed the distinct identifier bound. Narrow the user page.',
            );
        }
        values = [...unique];
        if (!values.length) {
          loaded.set(id, []);
          return [];
        }
      }
      const maximum = source.parent ? bounds.resultRows : bounds.userRows;
      const query = {
        from: { name: source.name },
        limit: maximum,
        ...(source.parent
          ? {
              where: {
                left: { field: source.keyField },
                op: 'In',
                right: { values },
              },
            }
          : { offset: bounds.userOffset }),
      };
      // Verify the exact installed DALgo dialect before trusting this request.
      parseDTQL(
        query,
        { tables: [{ name: source.name, fields: [source.keyField] }] },
        { maxLimit: 5000 },
      );
      const body = JSON.stringify(query);
      let pageToken: string | undefined;
      let snapshot: string | undefined;
      const seenTokens = new Set<string>();
      const records: BoundedRecord[] = [];
      try {
        for (;;) {
          signal.throwIfAborted();
          const pageSize = Math.min(100, maximum - records.length);
          const requestHeaders = new Headers(headers);
          requestHeaders.set('Content-Type', 'application/yaml');
          requestHeaders.set('Accept', 'application/json');
          requestHeaders.set('OVDB-Page-Size', String(pageSize));
          requestHeaders.delete('OVDB-Page-Close');
          requestHeaders.delete('OVDB-Page-Token');
          if (pageToken) requestHeaders.set('OVDB-Page-Token', pageToken);
          const response = await httpFetch(
            `${base}/v1/databases/${source.database}/dtql`,
            {
              method: 'POST',
              headers: requestHeaders,
              body,
              signal,
              redirect: 'error',
            },
          );
          const read = await boundedResponseText(
            response,
            bounds.bytes - bytes,
            signal,
          );
          bytes += read.bytes;
          if (response.status === 410)
            throw new Error(
              'The selected public-data snapshot expired. Run explicitly again.',
            );
          if (!response.ok)
            throw new Error(
              `The bounded source ${id} is unavailable or unsupported (${response.status}).`,
            );
          const page = strictJson(read.text) as {
            records?: BoundedRecord[];
            nextPageToken?: string;
            snapshotToken?: string;
            snapshotExpiresAt?: string;
          };
          if (!Array.isArray(page.records) || page.records.length > pageSize)
            throw new Error(
              'The bounded source returned too many rows or an invalid page.',
            );
          if (
            page.snapshotToken !== undefined &&
            (typeof page.snapshotToken !== 'string' ||
              !page.snapshotToken ||
              (snapshot && page.snapshotToken !== snapshot))
          )
            throw new Error('The source changed snapshot during this lookup.');
          if (
            page.snapshotExpiresAt !== undefined &&
            (!Number.isFinite(Date.parse(page.snapshotExpiresAt)) ||
              Date.parse(page.snapshotExpiresAt) <= Date.now())
          )
            throw new Error('The selected source snapshot is stale.');
          snapshot = page.snapshotToken ?? snapshot;
          for (const row of page.records) {
            if (
              !row ||
              typeof row.key !== 'string' ||
              !row.data ||
              typeof row.data !== 'object' ||
              Array.isArray(row.data)
            )
              throw new Error('The source returned a malformed raw row.');
            if (
              values &&
              (typeof row.data[source.keyField] !== 'string' ||
                !values.includes(row.data[source.keyField] as string))
            )
              throw new Error(
                'The runtime did not enforce the exact native-key filter.',
              );
            records.push(row);
          }
          if (!page.nextPageToken) break;
          if (records.length >= maximum)
            throw new Error(
              'The source exceeds the selected row bound. Choose another explicit page.',
            );
          if (
            typeof page.nextPageToken !== 'string' ||
            seenTokens.has(page.nextPageToken) ||
            page.records.length === 0
          )
            throw new Error('The source did not advance its bounded page.');
          seenTokens.add(page.nextPageToken);
          pageToken = page.nextPageToken;
        }
      } finally {
        if (snapshot) {
          const close = new Headers(headers);
          close.set('Content-Type', 'application/yaml');
          close.set('OVDB-Page-Token', snapshot);
          close.set('OVDB-Page-Close', 'true');
          close.set('OVDB-Page-Size', '100');
          // Cancellation must also release the owned server snapshot. It does not fetch rows.
          await httpFetch(`${base}/v1/databases/${source.database}/dtql`, {
            method: 'POST',
            headers: close,
            body,
            redirect: 'error',
            signal: AbortSignal.timeout(1000),
          })
            .then((response) => response.body?.cancel())
            .catch(() => undefined);
        }
      }
      loaded.set(id, records);
      return records;
    })();
    pending.set(id, request);
    return request;
  };
  return {
    receipt: { sources: loaded, bytes: () => bytes },
    fetch: async (input, init) => {
      signal.throwIfAborted();
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (
        init?.method !== 'POST' ||
        !url.startsWith(`${base}/v1/databases/`) ||
        !url.endsWith('/dtql')
      )
        throw new Error(
          'Only the declared bounded DTQL sources may be requested.',
        );
      const headers = new Headers(init.headers);
      if (headers.get('OVDB-Page-Close') === 'true')
        return new Response(null, { status: 204 });
      const document = strictJson(String(init.body)) as {
        from: { name: string };
      };
      const database = url.slice(
        `${base}/v1/databases/`.length,
        -'/dtql'.length,
      );
      const source = stages.get(`${database}.${document.from?.name}`);
      if (!source)
        throw new Error(
          'An undeclared source is ineligible for this bounded run.',
        );
      const records = await load(source, headers);
      const token = headers.get('OVDB-Page-Token');
      if (token !== null && !/^bounded:\d+$/.test(token))
        throw new Error('Invalid bounded page token.');
      const offset = token === null ? 0 : Number(token.slice(8));
      const size = Number(headers.get('OVDB-Page-Size') ?? 100);
      if (
        !Number.isSafeInteger(size) ||
        size < 1 ||
        size > 500 ||
        !Number.isSafeInteger(offset) ||
        offset < 0
      )
        throw new Error('Invalid bounded page request.');
      const end = Math.min(offset + size, records.length);
      return new Response(
        JSON.stringify({
          records: records.slice(offset, end),
          ...(end < records.length ? { nextPageToken: `bounded:${end}` } : {}),
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    },
  };
}
