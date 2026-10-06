import type { FederatedSourceRights } from '../federated-source-rights';
import { parseDTQL } from '@dalgo/core';
import type {
  BoundedFederation,
  BoundedReadReceipt,
  BoundedRecord,
  BoundedSource,
} from './bounded-federation';
import { readJsonDriver } from './bounded-https-json-driver';
import { boundedResponseText } from './bounded-response';
import {
  NetworkBudgetExhaustedError,
  type BoundedRunBudget,
} from './bounded-run-budget';
import { strictJson } from './strict-json';
import { validNativeRorUrl } from './public-data-scenario';
import {
  checkedResponsePins,
  runtimePinHeaders,
  validateRuntimePins,
  type CompleteRuntimeReadPins,
  type RuntimeReadPins,
} from './runtime-read-pins';

export interface OrdinaryPage {
  readonly limit: number;
  readonly offset: number;
}
/** Describes checked transport inputs; this type grants no publication eligibility. */
export interface BoundedRuntime {
  readonly readProfile: 'bounded-immutable/1';
  readonly databases: Readonly<Record<string, RuntimeReadPins>>;
  readonly pages?: Readonly<Record<string, OrdinaryPage>>;
}
export interface OrdinaryPageReceipt extends OrdinaryPage {
  readonly rows: number;
  readonly possiblyMore: boolean;
  readonly complete: boolean;
}
export interface ImmutableReadReceipt {
  readonly pins: ReadonlyMap<string, CompleteRuntimeReadPins>;
  readonly pages: ReadonlyMap<string, OrdinaryPageReceipt>;
  readonly history: ReadonlyMap<string, readonly OrdinaryPageReceipt[]>;
}
export interface RuntimeReadReport {
  readonly pins: Readonly<Record<string, CompleteRuntimeReadPins>>;
  readonly pages: Readonly<Record<string, OrdinaryPageReceipt>>;
  readonly history?: Readonly<Record<string, readonly OrdinaryPageReceipt[]>>;
}
const idOf = (source: Pick<BoundedSource, 'database' | 'name'>): string =>
  `${source.database}.${source.name}`;
const closed = (value: object, names: readonly string[]): boolean =>
  Object.keys(value).every((name) => names.includes(name));

export function validateImmutableRuntime(bounds: BoundedFederation): void {
  const runtime = bounds.runtime;
  if (
    !runtime ||
    !closed(runtime, ['readProfile', 'databases', 'pages']) ||
    runtime.readProfile !== 'bounded-immutable/1' ||
    !runtime.databases ||
    typeof runtime.databases !== 'object' ||
    Array.isArray(runtime.databases)
  )
    throw new Error('Invalid closed immutable read configuration.');
  const databases = new Set(
    bounds.sources
      .filter(
        (source) => !bounds.driver || idOf(source) !== idOf(bounds.driver),
      )
      .map((source) => source.database),
  );
  if (
    Object.keys(runtime.databases).length !== databases.size ||
    Object.keys(runtime.databases).some((database) => !databases.has(database))
  )
    throw new Error(
      'Every declared runtime database requires its exact immutable pins.',
    );
  for (const database of databases)
    validateRuntimePins(runtime.databases[database]);
  if (
    runtime.pages !== undefined &&
    (!runtime.pages ||
      typeof runtime.pages !== 'object' ||
      Array.isArray(runtime.pages))
  )
    throw new Error('Invalid explicit ordinary pages.');
  for (const [id, page] of Object.entries(runtime.pages ?? {})) {
    const source = bounds.sources.find((source) => idOf(source) === id);
    if (
      !source ||
      (bounds.driver && idOf(bounds.driver) === id) ||
      !page ||
      !closed(page, ['limit', 'offset']) ||
      !Number.isSafeInteger(page.limit) ||
      page.limit < 1 ||
      page.limit >
        Math.min(1000, source.parent ? bounds.resultRows : bounds.userRows) ||
      !Number.isSafeInteger(page.offset) ||
      page.offset < 0
    )
      throw new Error(
        'An explicit ordinary page needs a declared source, limit 1–1000 and nonnegative offset.',
      );
  }
}

/** One action reads one ordinary page per stage. DALgo only pages the local cache. */
export function createImmutableFederationFetch(
  base: string,
  bounds: BoundedFederation,
  http: typeof fetch,
  budget: BoundedRunBudget,
  rights?: FederatedSourceRights,
): {
  fetch: typeof fetch;
  receipt: BoundedReadReceipt;
  /** Call only for an explicit continuation action; retains the original deadline/accounting. */
  readPage: (
    sourceId: string,
    page: OrdinaryPage,
  ) => Promise<readonly BoundedRecord[]>;
} {
  validateImmutableRuntime(bounds);
  const configured = bounds.runtime;
  if (!configured)
    throw new Error('The immutable runtime configuration is missing.');
  const sources = new Map(
    bounds.sources.map((source) => [idOf(source), source]),
  );
  const loaded = new Map<string, readonly BoundedRecord[]>();
  const pending = new Map<string, Promise<readonly BoundedRecord[]>>();
  const pins = new Map<string, CompleteRuntimeReadPins>();
  const pages = new Map<string, OrdinaryPageReceipt>();
  const history = new Map<string, readonly OrdinaryPageReceipt[]>();
  const databaseReads = new Map<string, Promise<unknown>>();
  const coverage = new Map<
    string,
    { nextOffset: number; contiguous: boolean; filter: string }
  >();
  let fetchedRows = 0;
  let userRows = 0;
  const invalidateDependents = (parentId: string): void => {
    for (const source of bounds.sources)
      if (source.parent && idOf(source.parent) === parentId) {
        const id = idOf(source),
          page = pages.get(id);
        if (page) pages.set(id, { ...page, complete: false });
        invalidateDependents(id);
      }
  };

  const load = (source: BoundedSource): Promise<readonly BoundedRecord[]> => {
    const id = idOf(source);
    const cached = loaded.get(id);
    if (cached) return Promise.resolve(cached);
    const existing = pending.get(id);
    if (existing) return existing;
    const promise = (async () => {
      budget.check();
      if (bounds.driver && id === idOf(bounds.driver)) {
        budget.admitNetwork();
        const page = await readJsonDriver(
          bounds.driver,
          bounds.userRows,
          bounds.userOffset,
          budget.remaining,
          http,
          budget.signal,
          (bytes) => budget.consumeNetwork(bytes),
        );
        loaded.set(id, page.records);
        pages.set(id, {
          offset: bounds.userOffset,
          limit: bounds.userRows,
          rows: page.records.length,
          possiblyMore: false,
          complete: true,
        });
        history.set(id, [pages.get(id) as OrdinaryPageReceipt]);
        return page.records;
      }
      const page = configured.pages?.[id] ?? {
        limit: Math.min(
          1000,
          source.parent ? bounds.resultRows : bounds.userRows,
        ),
        offset: source.parent ? 0 : bounds.userOffset,
      };
      return readPage(id, page);
    })();
    pending.set(id, promise);
    return promise;
  };

  const readPage = async (
    id: string,
    page: OrdinaryPage,
  ): Promise<readonly BoundedRecord[]> => {
    budget.check();
    const source = sources.get(id);
    if (!source || (bounds.driver && id === idOf(bounds.driver)))
      throw new Error('An undeclared source cannot be requested.');
    validateImmutableRuntime({
      ...bounds,
      runtime: { ...configured, pages: { [id]: page } },
    });
    let values: string[] | undefined;
    if (source.parent) {
      const parent = sources.get(idOf(source.parent));
      if (!parent) throw new Error('The declared parent is unavailable.');
      const parentRows = await load(parent);
      const unique = new Set<string>();
      for (const row of parentRows) {
        const value = row.data[source.parent.field];
        if (value === null || value === undefined || value === '') continue;
        // Namespace validity applies only to the user ROR member, never location/place keys.
        if (
          bounds.identifierKind === 'ror' &&
          idOf(parent) === idOf(bounds.sources[0]) &&
          (typeof value !== 'string' || !validNativeRorUrl(value))
        )
          continue;
        if (typeof value !== 'string')
          throw new Error(
            'A bounded native key must retain its declared string representation.',
          );
        unique.add(value);
        const cap =
          idOf(parent) === idOf(bounds.sources[0])
            ? bounds.identifierLimit
            : 100;
        if (unique.size > cap)
          throw new Error(
            'The selected rows exceed the distinct identifier bound. Choose an explicit narrower page.',
          );
      }
      values = [...unique];
      if (!values.length) {
        loaded.set(id, []);
        pages.set(id, {
          ...page,
          rows: 0,
          possiblyMore: false,
          complete: true,
        });
        history.set(id, [pages.get(id) as OrdinaryPageReceipt]);
        return [];
      }
    }
    // Serialize the first reads of the same DB so every collection uses one captured mount.
    const preceding = databaseReads.get(source.database) ?? Promise.resolve();
    const request = preceding.then(async () => {
      budget.check();
      const filter = JSON.stringify(values ?? null);
      const previousCoverage = coverage.get(id);
      if (previousCoverage && previousCoverage.filter !== filter)
        throw new Error(
          'The parent filter changed after this source page. Run the changed selection explicitly again.',
        );
      const allowance = 5000 - fetchedRows;
      if (allowance <= 0)
        throw new Error('The run exhausted its intermediate-row bound.');
      const userAllowance = source.parent
        ? allowance
        : bounds.userRows - userRows;
      if (userAllowance <= 0)
        throw new Error('The run exhausted its user-row bound.');
      const limit = Math.min(page.limit, allowance, userAllowance);
      const query = {
        from: { name: source.name },
        limit,
        offset: page.offset,
        ...(values
          ? {
              where: {
                left: { field: source.keyField },
                op: 'In',
                right: { values },
              },
            }
          : {}),
      };
      parseDTQL(
        query,
        { tables: [{ name: source.name, fields: [source.keyField] }] },
        { maxLimit: 1000 },
      );
      const expected =
        pins.get(source.database) ?? configured.databases[source.database];
      const headers = runtimePinHeaders(expected);
      headers.set('Content-Type', 'application/yaml');
      headers.set('Accept', 'application/json');
      budget.admitNetwork();
      const response = await http(
        `${base}/v1/databases/${source.database}/dtql`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(query),
          signal: budget.signal,
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
        },
      );
      // Failures count against the same byte budget; never parse error bodies as rows.
      if (response.status !== 200) {
        await boundedResponseText(
          response,
          budget.remaining,
          budget.signal,
          (bytes) => budget.consumeNetwork(bytes),
        );
        if (response.status === 409)
          throw new Error(
            'The immutable runtime deployment changed. Acknowledge new pins and run explicitly again.',
          );
        throw new Error(
          `The bounded source ${id} is unavailable or unsupported (${response.status}).`,
        );
      }
      if (response.redirected || response.type === 'opaqueredirect') {
        await response.body?.cancel();
        throw new Error('A public-data redirect is refused.');
      }
      let checked: CompleteRuntimeReadPins;
      try {
        checked = checkedResponsePins(response, expected);
      } catch (error) {
        await response.body?.cancel();
        throw error;
      }
      const read = await boundedResponseText(
        response,
        budget.remaining,
        budget.signal,
        (bytes) => budget.consumeNetwork(bytes),
      );
      budget.check();
      const document = strictJson(read.text) as {
        records?: BoundedRecord[];
        nextPageToken?: unknown;
        snapshotToken?: unknown;
        snapshotExpiresAt?: unknown;
      };
      if (
        !document ||
        !Array.isArray(document.records) ||
        document.records.length > limit ||
        document.nextPageToken !== undefined ||
        document.snapshotToken !== undefined ||
        document.snapshotExpiresAt !== undefined
      )
        throw new Error(
          'The immutable source returned an invalid ordinary page or a snapshot token.',
        );
      rights?.accept(source, document as unknown as Record<string, unknown>);
      const keys = new Set<string>();
      for (const row of document.records) {
        if (
          !row ||
          typeof row.key !== 'string' ||
          keys.has(row.key) ||
          !row.data ||
          typeof row.data !== 'object' ||
          Array.isArray(row.data)
        )
          throw new Error(
            'The source returned a malformed or duplicate raw row.',
          );
        keys.add(row.key);
        if (
          values &&
          (typeof row.data[source.keyField] !== 'string' ||
            !values.includes(row.data[source.keyField] as string))
        )
          throw new Error(
            'The runtime did not enforce the exact native-key filter.',
          );
      }
      pins.set(source.database, checked);
      fetchedRows += document.records.length;
      if (!source.parent) userRows += document.records.length;
      const previous = loaded.get(id) ?? [];
      const previousKeys = new Set(previous.map((row) => row.key));
      if (document.records.some((row) => previousKeys.has(row.key)))
        throw new Error(
          'The explicit source page overlaps previously accepted record keys.',
        );
      loaded.set(id, [...previous, ...document.records]);
      if (previous.length && document.records.length) invalidateDependents(id);
      const contiguous = previousCoverage
        ? previousCoverage.contiguous &&
          previousCoverage.nextOffset === page.offset
        : page.offset === 0;
      coverage.set(id, {
        contiguous,
        filter,
        nextOffset: page.offset + document.records.length,
      });
      pages.set(id, {
        ...page,
        limit,
        rows: document.records.length,
        possiblyMore: document.records.length === limit,
        complete: contiguous && document.records.length < limit,
      });
      history.set(id, [
        ...(history.get(id) ?? []),
        pages.get(id) as OrdinaryPageReceipt,
      ]);
      return document.records;
    });
    const checked = request.catch((error: unknown) => {
      if (!(error instanceof NetworkBudgetExhaustedError))
        budget.controller.abort(error);
      throw error;
    });
    databaseReads.set(source.database, checked);
    return checked;
  };

  return {
    readPage,
    receipt: {
      sources: loaded,
      bytes: () => budget.bytes,
      runtime: { pins, pages, history },
    },
    fetch: async (input, init) => {
      budget.check();
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const prefix = `${base}/v1/databases/`;
      if (
        init?.method !== 'POST' ||
        !url.startsWith(prefix) ||
        !url.endsWith('/dtql')
      )
        throw new Error('Only declared bounded DTQL sources may be requested.');
      const headers = new Headers(init.headers);
      // These are DALgo's local-cache pages, never forwarded to the network.
      if (headers.get('OVDB-Page-Close') === 'true')
        return new Response(null, { status: 204 });
      const query = strictJson(String(init.body)) as {
        from?: { name?: string };
      };
      const database = url.slice(prefix.length, -'/dtql'.length);
      const source = sources.get(`${database}.${query.from?.name}`);
      if (!source)
        throw new Error(
          'An undeclared source is ineligible for this bounded run.',
        );
      const records = await load(source);
      const token = headers.get('OVDB-Page-Token');
      if (token !== null && !/^bounded:\d+$/.test(token))
        throw new Error('Invalid local bounded page token.');
      const offset = token === null ? 0 : Number(token.slice(8));
      const size = Number(headers.get('OVDB-Page-Size') ?? 100);
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(size) ||
        size < 1 ||
        size > 1000
      )
        throw new Error('Invalid local bounded page request.');
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
