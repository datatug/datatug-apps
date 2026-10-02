import { createStaticOvdbFetch, type StaticOvdbSource } from './static-ovdb-fetch';

export interface OvdbRecord { readonly key: string; readonly data: Readonly<Record<string, unknown>> }

export interface CollectionSource {
  readonly baseUrl: string;
  readonly staticSource?: StaticOvdbSource;
}

/**
 * Read every record of one collection through the same OVDB wire protocol the federated executor uses.
 *
 * This exists only for the trace's data checks (how many countries, how they are named). The answer
 * itself is never computed from these reads: the join and the arithmetic run in `runFederatedQuery`.
 */
export async function readCollection(
  source: CollectionSource, database: string, name: string,
  httpFetch: typeof fetch = (input, init) => fetch(input, init), signal?: AbortSignal,
): Promise<readonly OvdbRecord[]> {
  const send = source.staticSource ? createStaticOvdbFetch(source.staticSource, httpFetch) : httpFetch;
  const url = `${source.baseUrl.replace(/\/$/, '')}/v1/databases/${encodeURIComponent(database)}/dtql`;
  const body = JSON.stringify({ from: { name } });
  const records: OvdbRecord[] = [];
  let token: string | undefined;
  let snapshot: string | undefined;
  try {
    for (;;) {
      const response = await send(url, {
        method: 'POST', redirect: 'error', body, ...(signal ? { signal } : {}),
        headers: { 'Content-Type': 'application/yaml', Accept: 'application/json', 'OVDB-Page-Size': '500', ...(token ? { 'OVDB-Page-Token': token } : {}) },
      });
      if (!response.ok) throw new Error(`OVDB ${database}/${name} read failed (${response.status}).`);
      const page = await response.json() as { records?: OvdbRecord[]; nextPageToken?: string; snapshotToken?: string };
      if (!Array.isArray(page.records)) throw new Error(`OVDB ${database}/${name} returned an invalid page.`);
      records.push(...page.records);
      snapshot = page.snapshotToken ?? snapshot;
      if (!page.nextPageToken || page.nextPageToken === token) break;
      token = page.nextPageToken;
    }
  } finally {
    if (snapshot) {
      try {
        await send(url, {
          method: 'POST', redirect: 'error', body, signal: AbortSignal.timeout(5000),
          headers: { 'Content-Type': 'application/yaml', Accept: 'application/json', 'OVDB-Page-Size': '500', 'OVDB-Page-Token': snapshot, 'OVDB-Page-Close': 'true' },
        });
      } catch { /* The server expires abandoned snapshots itself. */ }
    }
  }
  return records;
}
