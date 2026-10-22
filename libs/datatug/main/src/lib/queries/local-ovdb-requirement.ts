// A query whose federation reads an OVDB server on the visitor's own computer (a loopback base such as
// http://127.0.0.1:50501) cannot run from a hosted page unless that server is running there. When such a
// run fails to connect, the page states what is needed instead of a raw "Failed to fetch".
import type { IQueryDef } from '../models/definition/query-def';

export interface LocalOvdbRequirement {
  readonly baseUrl: string;
  readonly databases: readonly string[];
  /** A starting command; the project names the manifest of each database. */
  readonly command: string;
}

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];
const CONNECTION_FAILURE = /failed to fetch|networkerror|load failed|network request failed|err_connection/i;

/** The local server a failed run needed, or undefined when the failure is anything else. */
export function localOvdbRequirement(
  definition: Pick<IQueryDef, 'federation'> | undefined,
  error: string | undefined,
  pageOrigin: string,
  /** The failure was classified as a lost connection (e.g. friendlyError kind 'offline') before its text was reworded. */
  connectionFailure = false,
): LocalOvdbRequirement | undefined {
  const base = definition?.federation?.ovdbBaseUrl;
  if (!base || !error || !(connectionFailure || CONNECTION_FAILURE.test(error))) return undefined;
  let url: URL;
  try { url = new URL(base); } catch { return undefined; }
  if (url.protocol !== 'http:' || !LOOPBACK.includes(url.hostname)) return undefined;
  const databases = [...new Set((definition.federation?.tables ?? []).map((table) => table.database).filter((db): db is string => !!db))];
  const command = [
    `ovdb serve --addr ${url.host}`,
    ...databases.map((db) => `--manifest <${db}.ovdb.yaml>`),
    `--cors ${pageOrigin}`,
  ].join(' \\\n  ');
  return { baseUrl: url.origin, databases, command };
}
