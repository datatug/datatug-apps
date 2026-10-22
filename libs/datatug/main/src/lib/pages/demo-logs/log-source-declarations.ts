// Declared log sources (`datatug-log-sources/v1`): which collections of which OVDB database hold
// log entries, which field plays which presentation role, which identifiers filter them and which
// records they explain. Contract: datatug/backstage spec/features/log-viewer/project-log-sources.md.
// The viewer never infers any of this from engine, collection or field names.
import { currentDemoDbOvdbUrl, DEMODB_OVDB_BASE_URL } from '../../queries/demodb-ovdb';
import { findDemoSqliteDataset } from '../../queries/demo-sqlite-catalog';

export type LogRole =
  | 'timestamp' | 'message' | 'severity' | 'service' | 'correlation' | 'sequence'
  | 'reference' | 'raw' | 'origin' | 'parseStatus' | 'parser' | 'structured';
export type LogFields = Readonly<Partial<Record<LogRole, string>>> & { readonly timestamp: string; readonly message: string };

export interface LogIdentifier {
  readonly field: string;
  readonly label: string;
  readonly param: string;
  readonly type: 'integer' | 'string';
}
export interface LogCollection {
  readonly id: string;
  readonly title: string;
  /** The source's roles with this collection's overrides merged over them. */
  readonly fields: LogFields;
}
export interface LogRecordMapping {
  /** Normalised OVDB database URL of the records. */
  readonly database: string;
  readonly collection: string;
  readonly field: string;
  readonly param: string;
}
export interface LogSource {
  readonly id: string;
  readonly title: string;
  readonly baseUrl: string;
  readonly databaseId: string;
  readonly synthetic: boolean;
  readonly collections: readonly LogCollection[];
  readonly identifiers: readonly LogIdentifier[];
  readonly window: { readonly from: string; readonly to: string };
  readonly records: readonly LogRecordMapping[];
}

export const LOG_SOURCES_FILE = 'connections/log-sources.json';
export const RESERVED_LOG_PARAMS: readonly string[] = ['source', 'collection', 'from', 'to'];
const ROLES: readonly LogRole[] = ['timestamp', 'message', 'severity', 'service', 'correlation', 'sequence', 'reference', 'raw', 'origin', 'parseStatus', 'parser', 'structured'];
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const COLLECTION_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const FIELD = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const PARAM = /^[a-z][a-z0-9_-]{0,31}$/;
const DATABASE_URL = /^(https?:\/\/[^/@?#]+(?:\/[^?#]*)?)\/v1\/databases\/([A-Za-z0-9_.-]+)$/;
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
export const RFC3339_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;

/** The dalgo2logs file-source field names: ad hoc mode and the declared loopback source. */
export const DEFAULT_LOG_FIELDS: LogFields = {
  timestamp: 'timestamp', severity: 'severity', service: 'service', origin: 'source', message: 'message',
  correlation: 'correlation_id', reference: 'source_ref', raw: 'raw', parser: 'parser',
  parseStatus: 'parse_status', structured: 'fields_json',
};
export const DEFAULT_LOG_IDENTIFIERS: readonly LogIdentifier[] = [
  { field: 'order_id', label: 'Order ID', param: 'order', type: 'string' },
];

export class LogSourceError extends Error {}

/** `<base>/v1/databases/<id>` split into the OVDB base URL and database id; https, or http on loopback only. */
export function splitOvdbDatabaseUrl(value: unknown): { readonly baseUrl: string; readonly databaseId: string } | undefined {
  if (typeof value !== 'string') return undefined;
  const match = DATABASE_URL.exec(value);
  if (!match) return undefined;
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (url.username || url.password) return undefined;
  if (url.protocol === 'http:' ? !LOOPBACK_HOSTS.includes(url.hostname) : url.protocol !== 'https:') return undefined;
  return { baseUrl: match[1], databaseId: match[2] };
}

/** One spelling per database: the current DemoDB host for a legacy base, no trailing slash. */
export function normalizeOvdbDatabaseUrl(value: string): string {
  return currentDemoDbOvdbUrl(value.trim()).replace(/\/+$/, '');
}

const text = (value: unknown, max = 200): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new LogSourceError('A title or label is missing or too long.');
  return value;
};
const object = (value: unknown, what: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LogSourceError(`${what} is not an object.`);
  return value as Record<string, unknown>;
};
function fields(raw: unknown, required: boolean): Partial<Record<LogRole, string>> {
  const input = object(raw ?? {}, 'fields');
  const out: Partial<Record<LogRole, string>> = {};
  for (const [role, field] of Object.entries(input)) {
    if (!ROLES.includes(role as LogRole)) throw new LogSourceError(`Unknown field role "${role}".`);
    if (typeof field !== 'string' || !FIELD.test(field)) throw new LogSourceError(`Role "${role}" names no valid field.`);
    out[role as LogRole] = field;
  }
  if (required && (!out.timestamp || !out.message)) throw new LogSourceError('The timestamp and message roles are required.');
  return out;
}

function source(raw: unknown, seen: Set<string>): LogSource {
  const entry = object(raw, 'A source');
  const id = entry['id'];
  if (typeof id !== 'string' || !ID.test(id) || seen.has(id)) throw new LogSourceError('A source id is missing, invalid or repeated.');
  seen.add(id);
  const database = splitOvdbDatabaseUrl(entry['database']);
  if (!database) throw new LogSourceError(`Source "${id}" names no valid OVDB database URL.`);
  const base = fields(entry['fields'], true) as LogFields;
  if (!Array.isArray(entry['collections']) || !entry['collections'].length) throw new LogSourceError(`Source "${id}" declares no collections.`);
  const collectionIds = new Set<string>();
  const collections = entry['collections'].map((item): LogCollection => {
    const collection = object(item, 'A collection');
    const cid = collection['id'];
    if (typeof cid !== 'string' || !COLLECTION_ID.test(cid) || collectionIds.has(cid)) throw new LogSourceError(`Source "${id}" has an invalid or repeated collection id.`);
    collectionIds.add(cid);
    return { id: cid, title: text(collection['title']), fields: { ...base, ...fields(collection['fields'], false) } as LogFields };
  });
  const params = new Set<string>();
  const identifiers = (Array.isArray(entry['identifiers']) ? entry['identifiers'] : []).map((item): LogIdentifier => {
    const identifier = object(item, 'An identifier');
    const { field, param, type } = identifier;
    if (typeof field !== 'string' || !FIELD.test(field)) throw new LogSourceError(`Source "${id}" has an identifier without a valid field.`);
    if (typeof param !== 'string' || !PARAM.test(param) || RESERVED_LOG_PARAMS.includes(param) || params.has(param)) throw new LogSourceError(`Source "${id}" has an invalid, reserved or repeated identifier param.`);
    if (type !== 'integer' && type !== 'string') throw new LogSourceError(`Source "${id}" has an identifier of unknown type.`);
    params.add(param);
    return { field, param, type, label: text(identifier['label'], 80) };
  });
  const window = object(entry['window'], `The window of source "${id}"`);
  const from = window['from'], to = window['to'];
  if (typeof from !== 'string' || typeof to !== 'string' || !RFC3339_UTC.test(from) || !RFC3339_UTC.test(to) || Date.parse(to) < Date.parse(from)) {
    throw new LogSourceError(`Source "${id}" has no valid RFC3339 UTC window.`);
  }
  const records = (Array.isArray(entry['records']) ? entry['records'] : []).map((item): LogRecordMapping => {
    const record = object(item, 'A record mapping');
    const { database: recordDatabase, collection, field, param } = record;
    if (typeof recordDatabase !== 'string' || !splitOvdbDatabaseUrl(recordDatabase)) throw new LogSourceError(`Source "${id}" maps records of an invalid database URL.`);
    if (typeof collection !== 'string' || !COLLECTION_ID.test(collection) || typeof field !== 'string' || !FIELD.test(field)) throw new LogSourceError(`Source "${id}" has an invalid record mapping.`);
    if (typeof param !== 'string' || !params.has(param)) throw new LogSourceError(`Source "${id}" maps records to an undeclared identifier.`);
    return { database: normalizeOvdbDatabaseUrl(recordDatabase), collection, field, param };
  });
  return {
    id, title: text(entry['title']), ...database, synthetic: entry['synthetic'] === true,
    collections, identifiers, window: { from, to }, records,
  };
}

/** Validates a whole `datatug-log-sources/v1` file; any invalid part refuses the file. */
export function parseLogSources(raw: unknown): readonly LogSource[] {
  const file = object(raw, 'The log sources file');
  if (file['format'] !== 'datatug-log-sources/v1' || !Array.isArray(file['sources'])) throw new LogSourceError('The log sources file has an unknown format.');
  const seen = new Set<string>();
  return file['sources'].map((entry) => source(entry, seen));
}

/** A URL identifier value as it is sent; undefined for an integer that does not parse. */
export function identifierValue(identifier: LogIdentifier, value: string): string | number | undefined {
  if (identifier.type === 'string') return value;
  return /^-?\d{1,15}$/.test(value) ? Number(value) : undefined;
}

export interface RelatedLogEvidenceLink {
  readonly collection: string;
  readonly field: string;
  readonly path: string;
  readonly queryParam: string;
  readonly queryParams?: Readonly<Record<string, string>>;
  readonly label?: string;
}

/** Record → logs: links for rows of `collection` in the database identified by `databaseUrl`. */
export function relatedLogEvidenceLinks(sources: readonly LogSource[], databaseUrl: string | undefined, collection: string | undefined): readonly RelatedLogEvidenceLink[] {
  if (!databaseUrl || !collection) return [];
  const database = normalizeOvdbDatabaseUrl(databaseUrl);
  return sources.flatMap((source) => source.records
    .filter((record) => record.database === database && record.collection === collection)
    .map((record) => ({
      collection, field: record.field, path: '/demo/logs', queryParam: record.param,
      queryParams: { source: source.id }, label: `Related log evidence · ${source.title}`,
    })));
}

/** Logs → record: the app page of a declared record, when the app has one (a DemoDB browser copy). */
export function recordRoute(record: LogRecordMapping, value: string): { readonly commands: readonly string[]; readonly queryParams: Readonly<Record<string, string>> } | undefined {
  const prefix = `${DEMODB_OVDB_BASE_URL}/v1/databases/`;
  if (!value || !record.database.startsWith(prefix)) return undefined;
  const dataset = findDemoSqliteDataset(record.database.slice(prefix.length));
  return dataset ? { commands: ['/demo', 'sqlite', dataset.dataset, 'table', record.collection], queryParams: { record: value } } : undefined;
}
