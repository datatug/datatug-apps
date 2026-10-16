// Where the hosted DemoDB OVDB API lives.
//
// Since 2026-10-16 the API is served from its own host, `https://ovdb.demodb.dev/v1/...`.
// The old base `https://demodb.dev/ovdb` (same paths after it) only answers with a 308
// redirect, and browsers do not follow a redirect on a preflighted request such as
// `POST .../dtql`. DataTug therefore never requests the old base: every request URL goes
// through `currentDemoDbOvdbUrl`.
//
// The old base is still *accepted when reading* data published before the move: the demo
// project's `connections/demo-db.json`, queries users saved, and SHA-pinned publisher
// evidence whose `serverId`/`endpoint` name the API as it was when it was published.

export const DEMODB_OVDB_BASE_URL = 'https://ovdb.demodb.dev';

/** The pre-2026-10-16 base. Recognised in published or saved data, never requested. */
export const LEGACY_DEMODB_OVDB_BASE_URL = 'https://demodb.dev/ovdb';

/** The same URL on the current OVDB host when it is under the legacy base; any other URL unchanged. */
export function currentDemoDbOvdbUrl(url: string): string {
  return url === LEGACY_DEMODB_OVDB_BASE_URL || url.startsWith(`${LEGACY_DEMODB_OVDB_BASE_URL}/`)
    ? `${DEMODB_OVDB_BASE_URL}${url.slice(LEGACY_DEMODB_OVDB_BASE_URL.length)}`
    : url;
}

/** The OVDB API URL of a DemoDB dataset on the current host. */
export function demoDbOvdbDatabaseUrl(dataset: string): string {
  return `${DEMODB_OVDB_BASE_URL}/v1/databases/${dataset}`;
}

/** Whether a published `source` names the dataset's OVDB API, on the current or the legacy base. */
export function isDemoDbOvdbDatabaseUrl(url: unknown, dataset: string): boolean {
  return typeof url === 'string' && currentDemoDbOvdbUrl(url) === demoDbOvdbDatabaseUrl(dataset);
}
