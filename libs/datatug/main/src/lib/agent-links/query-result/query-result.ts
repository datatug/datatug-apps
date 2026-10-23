import type { ProjectRouterCommand } from '../../nav/project-page-href';
import type { RunQueryRequest, TypedValue } from '@sneat/datatug-semantic';
import { projectPageCommands } from '../link-route';

/**
 * A query result stored by `datatug query run --result-id` and served by the agent's `GET /datatug/results/<id>`
 * (datatug-cli `pkg/queryresults` and `pkg/server/endpoints/results.go`): `{meta, recordset}`. This file holds the
 * pure parts of the result page: decoding the answer, the view and row of the address, the lists of the Columns,
 * Sources and Related views, the table links of their names, and the "Run again" request.
 *
 * Only what is listed here is read from the metadata; an unknown field is ignored (the metadata is versioned and
 * new fields within a version are additive).
 */

/** The result id grammar of the CLI (`queryresults.ValidID`). */
const RESULT_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function validResultId(id: string | null | undefined): id is string {
  return !!id && RESULT_ID.test(id);
}

export const RESULT_META_FORMAT = 'datatug.query-result.meta';
export const RESULT_META_VERSION = 1;

/** The views of a result page, in the order they are offered. */
export const RESULT_VIEWS = [
  'table',
  'record',
  'columns',
  'sources',
  'related',
] as const;
export type ResultView = (typeof RESULT_VIEWS)[number];

export const VIEW_QUERY_PARAM = 'view';
/** The query editor's query parameter that names the stored result to open it from. */
export const RESULT_QUERY_PARAM = 'result';
export const ROW_QUERY_PARAM = 'row';

/** The `view` query parameter: one of {@link RESULT_VIEWS}, `table` for anything else. */
export function resultView(param: string | null | undefined): ResultView {
  return (RESULT_VIEWS as readonly string[]).includes(param ?? '')
    ? (param as ResultView)
    : 'table';
}

/** The `row` query parameter: a 1-based position (never a key), 1 for anything that is not a whole number from 1. */
export function resultRow(param: string | null | undefined): number {
  if (!param || !/^\d{1,6}$/.test(param)) return 1;
  const n = Number(param);
  return n >= 1 ? n : 1;
}

export interface ResultDb {
  readonly ref: string | null;
  readonly project: string | null;
  readonly env: string | null;
  readonly source: string | null;
  readonly driver: string;
}

export interface ResultQuery {
  readonly kind: string;
  readonly tugql?: string;
  readonly from?: string;
  readonly savedQueryId?: string;
  readonly savedQueryType?: string;
  /** Each value is a TypedValue or a set `{type: 'set', values: TypedValue[]}`. */
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface ResultColumnSource {
  readonly instance: string;
  readonly schema: string;
  readonly relation: string;
  readonly column: string;
}

export interface ResultColumnFk {
  readonly refSchema: string;
  readonly refRelation: string;
  readonly refColumn: string;
}

export interface ResultColumn {
  readonly name: string;
  readonly type: string;
  readonly declaredType: string | null;
  readonly nullable: boolean | null;
  readonly pk: number | null;
  readonly source: ResultColumnSource | null;
  readonly foreignKeys: readonly ResultColumnFk[];
  readonly encoding?: string;
  readonly cutCells?: number;
}

export interface ResultJoin {
  readonly type: string;
  readonly on: readonly { readonly left: string; readonly right: string }[];
}

export interface ResultParticipant {
  readonly instance: string;
  readonly schema: string;
  readonly relation: string;
  readonly alias: string;
  /** The participant's own `datatug://` reference, on a query over several databases only. */
  readonly db?: string;
  readonly kind: string;
  readonly role: string;
  readonly join?: ResultJoin;
}

export interface ResultRelated {
  readonly candidateId: string;
  readonly fromInstance: string;
  readonly target: {
    readonly schema: string;
    readonly relation: string;
    readonly kind: string;
  };
  readonly constraintId: string;
  readonly direction: string;
  readonly cardinality: string;
  readonly fields: readonly {
    readonly sourceField: string;
    readonly targetField: string;
  }[];
}

export interface ResultUnavailable {
  readonly query?: string;
  /** `too-large`: the editor-ready members (`query.text`, `query.params`) were dropped for size. */
  readonly editor?: string;
  readonly columns?: string;
  readonly participants?: string;
  readonly related?: string;
  readonly declaredTypes?: string;
}

export interface ResultMeta {
  readonly id: string;
  readonly createdAt: string;
  readonly db: ResultDb;
  readonly query: ResultQuery;
  readonly rows: {
    readonly kept: number;
    readonly hasMore: boolean;
    readonly truncatedBy: string;
  };
  readonly columns: readonly ResultColumn[];
  readonly participants: readonly ResultParticipant[];
  readonly related: readonly ResultRelated[];
  readonly unavailable: ResultUnavailable;
}

export interface ResultRecordset {
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  readonly rows: readonly (readonly TypedValue[])[];
}

/** What the query editor needs to open the result's query (CLI `query.text`, `language`, `dbRef`, `params`). */
export interface ResultEditor {
  /** The canonical query text; absent in an older result, a saved HTTP query, or when it was too large. */
  readonly text?: string;
  readonly language?: 'tugql' | 'sql' | 'http';
  /** The `datatug://<project>/<db>?env=<env>` reference of the database. */
  readonly dbRef?: string;
  /** Each value is a TypedValue or a set `{type: 'set', values: TypedValue[]}`. */
  readonly params: readonly { readonly name: string; readonly value: unknown }[];
}

/** The request that produced the result (CLI `query results annotate`), plain text. */
export interface ResultPrompt {
  readonly text: string;
  readonly truncated: boolean;
}

export interface StoredResult {
  readonly meta: ResultMeta;
  readonly recordset: ResultRecordset;
  /** Absent fields are an older agent's or result's: the page then shows the rows and the saved metadata only. */
  readonly editor: ResultEditor;
  readonly prompt?: ResultPrompt;
}

/** The answer is not a result this page can read: a metadata format or version it does not know. */
export class ResultVersionError extends Error {
  constructor() {
    super('version-unsupported');
    this.name = 'ResultVersionError';
  }
}

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null =>
  typeof v === 'string' ? v : null;
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);

/**
 * Decodes the answer of `GET /datatug/results/<id>`. Throws {@link ResultVersionError} for metadata of another
 * format or version, so the page names it instead of drawing a guess.
 */
export function decodeStoredResult(response: unknown): StoredResult {
  const r = obj(response);
  const m = obj(r['meta']);
  if (
    m['format'] !== RESULT_META_FORMAT ||
    m['version'] !== RESULT_META_VERSION
  ) {
    throw new ResultVersionError();
  }
  const db = obj(m['db']);
  const q = obj(m['query']);
  const rows = obj(m['rows']);
  const unavailable = obj(m['unavailable']);
  const parameters = obj(q['parameters']);
  const meta: ResultMeta = {
    id: str(m['id']),
    createdAt: str(m['createdAt']),
    db: {
      ref: strOrNull(db['ref']),
      project: strOrNull(db['project']),
      env: strOrNull(db['env']),
      source: strOrNull(db['source']),
      driver: str(db['driver']),
    },
    query: {
      kind: str(q['kind']),
      ...(typeof q['tugql'] === 'string' ? { tugql: q['tugql'] } : {}),
      ...(typeof q['from'] === 'string' ? { from: q['from'] } : {}),
      ...(typeof q['savedQueryId'] === 'string'
        ? { savedQueryId: q['savedQueryId'] }
        : {}),
      ...(typeof q['savedQueryType'] === 'string'
        ? { savedQueryType: q['savedQueryType'] }
        : {}),
      ...(Object.keys(parameters).length ? { parameters } : {}),
    },
    rows: {
      kept: typeof rows['kept'] === 'number' ? rows['kept'] : 0,
      hasMore: rows['hasMore'] === true,
      truncatedBy: str(rows['truncatedBy']),
    },
    columns: list(m['columns']).map((c) => {
      const source = c['source'] ? obj(c['source']) : null;
      return {
        name: str(c['name']),
        type: str(c['type']),
        declaredType: strOrNull(c['declaredType']),
        nullable: typeof c['nullable'] === 'boolean' ? c['nullable'] : null,
        pk: typeof c['pk'] === 'number' ? c['pk'] : null,
        source: source
          ? {
              instance: str(source['instance']),
              schema: str(source['schema']),
              relation: str(source['relation']),
              column: str(source['column']),
            }
          : null,
        foreignKeys: list(c['foreignKeys']).map((fk) => ({
          refSchema: str(fk['refSchema']),
          refRelation: str(fk['refRelation']),
          refColumn: str(fk['refColumn']),
        })),
        ...(typeof c['encoding'] === 'string'
          ? { encoding: c['encoding'] }
          : {}),
        ...(typeof c['cutCells'] === 'number'
          ? { cutCells: c['cutCells'] }
          : {}),
      };
    }),
    participants: list(m['participants']).map((p) => {
      const join = p['join'] ? obj(p['join']) : undefined;
      return {
        instance: str(p['instance']),
        schema: str(p['schema']),
        relation: str(p['relation']),
        alias: str(p['alias']),
        ...(typeof p['db'] === 'string' ? { db: p['db'] } : {}),
        kind: str(p['kind']),
        role: str(p['role']),
        ...(join
          ? {
              join: {
                type: str(join['type']),
                on: list(join['on']).map((pair) => ({
                  left: str(pair['left']),
                  right: str(pair['right']),
                })),
              },
            }
          : {}),
      };
    }),
    related: list(m['related']).map((rel) => {
      const target = obj(rel['target']);
      return {
        candidateId: str(rel['candidateId']),
        fromInstance: str(rel['fromInstance']),
        target: {
          schema: str(target['schema']),
          relation: str(target['relation']),
          kind: str(target['kind']),
        },
        constraintId: str(rel['constraintId']),
        direction: str(rel['direction']),
        cardinality: str(rel['cardinality']),
        fields: list(rel['fields']).map((f) => ({
          sourceField: str(f['sourceField']),
          targetField: str(f['targetField']),
        })),
      };
    }),
    unavailable: {
      ...(typeof unavailable['query'] === 'string'
        ? { query: unavailable['query'] }
        : {}),
      ...(typeof unavailable['editor'] === 'string'
        ? { editor: unavailable['editor'] }
        : {}),
      ...(typeof unavailable['columns'] === 'string'
        ? { columns: unavailable['columns'] }
        : {}),
      ...(typeof unavailable['participants'] === 'string'
        ? { participants: unavailable['participants'] }
        : {}),
      ...(typeof unavailable['related'] === 'string'
        ? { related: unavailable['related'] }
        : {}),
      ...(typeof unavailable['declaredTypes'] === 'string'
        ? { declaredTypes: unavailable['declaredTypes'] }
        : {}),
    },
  };
  return {
    meta,
    recordset: decodeRecordset(r['recordset']),
    editor: decodeEditor(r['query'], q),
    ...decodePrompt(r['prompt'], m['prompt']),
  };
}

/** The editor-ready members of the answer's top-level `query` (else of `meta.query`, which holds the same). */
function decodeEditor(top: unknown, fromMeta: Obj): ResultEditor {
  const q = top && typeof top === 'object' && !Array.isArray(top) ? obj(top) : fromMeta;
  const language = q['language'];
  return {
    ...(typeof q['text'] === 'string' && q['text'] ? { text: q['text'] } : {}),
    ...(language === 'tugql' || language === 'sql' || language === 'http'
      ? { language }
      : {}),
    ...(typeof q['dbRef'] === 'string' && q['dbRef'] ? { dbRef: q['dbRef'] } : {}),
    params: list(q['params'])
      .filter((p) => typeof p['name'] === 'string' && p['name'] !== '')
      .map((p) => ({ name: p['name'] as string, value: p['value'] })),
  };
}

/** The prompt as plain text (top-level `prompt`) and whether it was cut (`meta.prompt.truncated`). */
function decodePrompt(top: unknown, fromMeta: unknown): { prompt?: ResultPrompt } {
  const meta = obj(fromMeta);
  const text = typeof top === 'string' ? top : str(meta['text']);
  return text
    ? { prompt: { text, truncated: meta['truncated'] === true } }
    : {};
}

/** A contract recordset `{columns: [{name, type}], rows: [[TypedValue]]}`; a cell that is not one is shown empty. */
export function decodeRecordset(value: unknown): ResultRecordset {
  const rs = obj(value);
  const columns = list(rs['columns']).map((c) => ({
    name: str(c['name']),
    type: str(c['type']),
  }));
  const rows = Array.isArray(rs['rows'])
    ? (rs['rows'] as unknown[]).map((row) =>
        Array.isArray(row) ? row.map((cell) => typedCell(cell)) : [],
      )
    : [];
  return { columns, rows };
}

function typedCell(cell: unknown): TypedValue {
  const c = obj(cell);
  return typeof c['type'] === 'string' && 'value' in c
    ? (c as unknown as TypedValue)
    : { type: 'null', value: null };
}

/** A cell as display text: an integer keeps every digit (it is a string on the wire), null is empty. */
export function cellText(value: TypedValue | undefined): string {
  if (!value || value.type === 'null' || value.value === null) return '';
  return String(value.value);
}

// ---- Table links of the names in the lists ----

/** The project, environment and source a name of the lists is in. */
export interface DbIds {
  readonly project: string;
  readonly env: string;
  readonly source: string;
}

/** The ids of a `datatug://<project>/<db>?env=<env>` reference, or undefined for anything else. */
export function parseDatatugRef(
  ref: string | null | undefined,
): DbIds | undefined {
  const m = /^datatug:\/\/([^/?#]+)\/([^/?#]+)\?env=([^&#]+)$/.exec(ref ?? '');
  if (!m) return undefined;
  try {
    return {
      project: decodeURIComponent(m[1]),
      env: decodeURIComponent(m[3]),
      source: decodeURIComponent(m[2]),
    };
  } catch {
    return undefined;
  }
}

/**
 * The order of the result's columns with the primary key columns first (by their position in the key), when the
 * saved metadata exposes them for exactly the columns of the recordset. Undefined when nothing needs to move: no
 * primary key, no match between metadata and recordset, a key spread over several tables (a join), or the key
 * columns already first. The recordset's own order is otherwise kept.
 */
export function pkFirstOrder(
  meta: ResultMeta,
  recordsetColumns: readonly { readonly name: string }[],
): number[] | undefined {
  const cols = meta.columns;
  if (
    cols.length !== recordsetColumns.length ||
    cols.some((c, i) => c.name !== recordsetColumns[i].name)
  ) {
    return undefined;
  }
  const keyed = cols
    .map((c, i) => ({ i, pk: c.pk, instance: c.source?.instance ?? '' }))
    .filter((c) => c.pk !== null && c.pk > 0);
  if (!keyed.length) return undefined;
  if (new Set(keyed.map((c) => c.instance)).size > 1) return undefined;
  keyed.sort((a, b) => (a.pk as number) - (b.pk as number) || a.i - b.i);
  const first = keyed.map((c) => c.i);
  const order = [
    ...first,
    ...cols.map((_, i) => i).filter((i) => !first.includes(i)),
  ];
  return order.every((v, i) => v === i) ? undefined : order;
}

/** The database of the result, when it is a source of a registered project. */
export function resultDbIds(meta: ResultMeta): DbIds | undefined {
  const { ref, project, env, source } = meta.db;
  return ref && project && env && source ? { project, env, source } : undefined;
}

/** A name in a list that opens the table metadata page (and its records page) of the agent's table routes. */
export interface TableLink {
  readonly commands: readonly ProjectRouterCommand[];
  readonly recordsCommands: readonly ProjectRouterCommand[];
  readonly queryParams: { readonly schema: string };
}

export function tableLink(
  storeId: string,
  ids: DbIds | undefined,
  schema: string,
  relation: string,
  kind: string,
): TableLink | undefined {
  if (!ids || !relation) return undefined;
  const page = [
    'env',
    ids.env,
    'db',
    ids.source,
    kind === 'view' ? 'view' : 'table',
    relation,
  ];
  const project = { storeId, projectId: ids.project };
  const commands = projectPageCommands(project, page);
  const recordsCommands = projectPageCommands(project, [...page, 'records']);
  if (!commands || !recordsCommands) return undefined;
  return {
    commands,
    recordsCommands,
    queryParams: { schema },
  };
}

/**
 * The schema a table link names: SQLite's `main` is the schemaless `''` the agent's table routes take (a link printed
 * by `datatug daemon url` for a SQLite table has `?schema=`); any other schema is kept as it is.
 */
function linkSchema(meta: ResultMeta, schema: string): string {
  return schema === 'main' && meta.db.driver.startsWith('sqlite') ? '' : schema;
}

/** The database of a participant: its own reference on a query over several databases, else the result's. */
function participantIds(
  meta: ResultMeta,
  p: ResultParticipant | undefined,
): DbIds | undefined {
  return p?.db ? parseDatatugRef(p.db) : resultDbIds(meta);
}

const qualified = (schema: string, name: string): string =>
  schema && schema !== 'main' ? `${schema}.${name}` : name;

// ---- The lists ----

export interface ColumnRow {
  readonly name: string;
  readonly type: string;
  readonly declaredType: string;
  readonly nullable: string;
  readonly pk: string;
  readonly notes: string;
  /** The source field, `relation.column`, and its table link. */
  readonly source?: { readonly label: string; readonly link?: TableLink };
  readonly foreignKeys: readonly {
    readonly label: string;
    readonly link?: TableLink;
  }[];
}

export function columnRows(meta: ResultMeta, storeId: string): ColumnRow[] {
  const byInstance = new Map(meta.participants.map((p) => [p.instance, p]));
  return meta.columns.map((c) => {
    const participant = c.source
      ? byInstance.get(c.source.instance)
      : undefined;
    const ids = participantIds(meta, participant);
    const notes = [
      c.encoding === 'binary-placeholder'
        ? 'binary values shown as their size'
        : '',
      c.encoding === 'json-text' ? 'nested values shown as JSON text' : '',
      c.cutCells ? `${c.cutCells} long values cut` : '',
    ].filter(Boolean);
    return {
      name: c.name,
      type: c.type,
      declaredType: c.declaredType ?? '',
      nullable: c.nullable === null ? '' : c.nullable ? 'yes' : 'no',
      pk: c.pk === null ? '' : String(c.pk),
      notes: notes.join('; '),
      ...(c.source
        ? {
            source: {
              label: `${qualified(c.source.schema, c.source.relation)}.${c.source.column}`,
              link: tableLink(
                storeId,
                ids,
                linkSchema(meta, c.source.schema),
                c.source.relation,
                participant?.kind ?? 'table',
              ),
            },
          }
        : {}),
      foreignKeys: c.foreignKeys.map((fk) => ({
        label: `${qualified(fk.refSchema, fk.refRelation)}.${fk.refColumn}`,
        link: tableLink(
          storeId,
          ids,
          linkSchema(meta, fk.refSchema),
          fk.refRelation,
          'table',
        ),
      })),
    };
  });
}

export interface SourceRow {
  readonly name: string;
  readonly alias: string;
  readonly kind: string;
  readonly role: string;
  /** `inner join on a.x = b.y and …`, for a joined participant. */
  readonly join: string;
  /** The participant's own database, on a query over several databases. */
  readonly database: string;
  readonly link?: TableLink;
}

export function sourceRows(meta: ResultMeta, storeId: string): SourceRow[] {
  return meta.participants.map((p) => {
    const ids = participantIds(meta, p);
    return {
      name: qualified(p.schema, p.relation),
      alias: p.alias && p.alias !== p.relation ? p.alias : '',
      kind: p.kind,
      role: p.role,
      join: p.join
        ? `${p.join.type || 'join'} on ${p.join.on.map((pair) => `${pair.left} = ${pair.right}`).join(' and ')}`
        : '',
      database: p.db
        ? ids
          ? `${ids.project}/${ids.source} (${ids.env})`
          : p.db
        : '',
      link: tableLink(
        storeId,
        ids,
        p.db ? p.schema : linkSchema(meta, p.schema),
        p.relation,
        p.kind,
      ),
    };
  });
}

export interface RelatedRow {
  readonly key: string;
  readonly name: string;
  /** The participant the candidate joins to, by its alias (or name). */
  readonly from: string;
  readonly direction: string;
  readonly cardinality: string;
  /** `Invoice.CustomerId = Customer.CustomerId`, one pair per field of the key. */
  readonly joinColumns: string;
  readonly constraint: string;
  readonly link?: TableLink;
}

/** Every related table the metadata reports, as it reports them: no filter by permission or policy. */
export function relatedRows(meta: ResultMeta, storeId: string): RelatedRow[] {
  const byInstance = new Map(meta.participants.map((p) => [p.instance, p]));
  return meta.related.map((r, index) => {
    const participant = byInstance.get(r.fromInstance);
    const fromName = participant
      ? participant.alias || participant.relation
      : r.fromInstance;
    const targetName = r.target.relation;
    return {
      key: r.candidateId || String(index),
      name: qualified(r.target.schema, r.target.relation),
      from: fromName,
      direction: r.direction,
      cardinality: r.cardinality,
      joinColumns: r.fields
        .map(
          (f) =>
            `${fromName}.${f.sourceField} = ${targetName}.${f.targetField}`,
        )
        .join(', '),
      constraint: r.constraintId,
      link: tableLink(
        storeId,
        participantIds(meta, participant),
        participant?.db ? r.target.schema : linkSchema(meta, r.target.schema),
        r.target.relation,
        r.target.kind,
      ),
    };
  });
}

/** Why a part of the metadata is missing, in words. */
export function unavailableText(
  reason: string | undefined,
  what: string,
): string {
  switch (reason) {
    case undefined:
    case '':
      return '';
    case 'native-sql':
      return `The ${what} of a native SQL query are not known: DataTug does not read them from SQL text.`;
    case 'no-relationship-metadata':
      return 'This database reports no relationship metadata.';
    case 'schema-unreadable':
      return `The ${what} could not be read from the database schema.`;
    case 'too-many':
      return `Only the first ${what} are shown.`;
    default:
      return `The ${what} are not available (${reason}).`;
  }
}

// ---- Run again ----

/** The rows the agent is asked for on a re-run; its own maximum. */
export const RERUN_LIMIT = 500;

/** Why the result cannot be run again here, or undefined when it can. */
export function rerunBlocker(meta: ResultMeta): string | undefined {
  if (!resultDbIds(meta)) {
    return 'This database is not in a DataTug project, so the agent cannot run the query again. Add it to a project, then run the query again in Claude Code.';
  }
  if (meta.unavailable.query === 'too-large') {
    return 'The query was too large to keep with these results.';
  }
  const saved = meta.query.kind === 'saved';
  if (saved) {
    if (!meta.query.savedQueryId)
      return 'The saved query was not kept with these results.';
    if (meta.participants.some((p) => !!p.db)) {
      return 'A saved query over several databases cannot be run again here.';
    }
    return undefined;
  }
  if (!meta.query.tugql) return 'The query was not kept with these results.';
  if (
    Object.values(meta.query.parameters ?? {}).some(
      (v) => obj(v)['type'] === 'set',
    )
  ) {
    return 'An ad-hoc query with a list parameter cannot be run again here.';
  }
  return undefined;
}

/**
 * The `exec/run_query` request of "Run again", the one the query page sends: the project, environment and source of
 * the result, its parameters with one `manual` binding origin each, `mode: 'live'` and {@link RERUN_LIMIT} rows, and
 * either the saved query's id or the ad-hoc query's TugQL text. Undefined when {@link rerunBlocker} names a reason.
 */
export function rerunRequest(
  meta: ResultMeta,
  securityContextId: string,
): RunQueryRequest | undefined {
  const ids = resultDbIds(meta);
  if (!ids || rerunBlocker(meta)) return undefined;
  const parameters = (meta.query.parameters ?? {}) as Readonly<
    Record<string, TypedValue>
  >;
  return {
    project: ids.project,
    environment: ids.env,
    securityContextId,
    source: ids.source,
    ...(meta.query.kind === 'saved'
      ? { queryId: meta.query.savedQueryId }
      : { tugql: meta.query.tugql }),
    parameters,
    bindingOrigins: Object.keys(parameters).map((parameterId) => ({
      parameterId,
      origin: 'manual' as const,
    })),
    mode: 'live',
    limit: RERUN_LIMIT,
  };
}
