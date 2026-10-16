// Opens a hosted PostgreSQL DemoDB edition as an OVDB connection: one `GET /v1/databases/<db>-postgresql` on the
// public OpenVaultDB server (the descriptor), through a fetch that waits out a database that is still mounting.
// The browser holds no credentials and never learns where the data is stored: every later read is a
// `POST …/dtql` on the same server.
import {
  fetchOvdbDescriptor,
  type OvdbConnection,
} from '../ovdb/ovdb-connection';
import {
  retryingOvdbFetch,
  type OvdbRetryOptions,
} from '../ovdb/ovdb-retrying-fetch';
import {
  DEMO_POSTGRESQL_LABEL,
  type DemoPostgresqlCatalogEntry,
} from './demo-postgresql-catalog';

export interface DemoPostgresqlOpenOptions extends OvdbRetryOptions {
  readonly fetch?: typeof globalThis.fetch;
}

export async function openDemoPostgresql(
  entry: DemoPostgresqlCatalogEntry,
  options: DemoPostgresqlOpenOptions = {},
): Promise<OvdbConnection> {
  const base =
    options.fetch ??
    ((input: RequestInfo | URL, init?: RequestInit) =>
      globalThis.fetch(input, init));
  const fetch = retryingOvdbFetch(base, options);
  const descriptor = await fetchOvdbDescriptor(
    fetch,
    entry.baseUrl,
    entry.databaseId,
  );
  if (descriptor.id !== entry.databaseId || descriptor.engine !== 'postgres') {
    throw new Error(
      `${entry.baseUrl} did not describe the PostgreSQL database ${entry.databaseId}.`,
    );
  }
  return {
    id: entry.databaseId,
    title: `${entry.title} · ${DEMO_POSTGRESQL_LABEL}`,
    baseUrl: entry.baseUrl,
    databaseId: entry.databaseId,
    fetch,
    descriptor,
  };
}
