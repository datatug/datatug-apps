import type { TypedValue } from '@sneat/datatug-semantic';
import type { FederatedQueryResult } from '../../queries/federated-query-executor';
import type { DataType } from '../../models/definition/types';
import { IQueryDef, QueryType } from '../../models/definition/query-def';
import type { IParameterDef } from '../../models/definition/parameter';
import {
  DbIds,
  StoredResult,
  parseDatatugRef,
  resultDbIds,
} from './query-result';

/**
 * How a stored query result opens in the query editor (`store/:storeId/project/:projectId/query?result=<id>`).
 * Pure: decides what the editor is filled with from the answer of `GET results/<id>`. Nothing here reads an address,
 * runs a query or writes anything; the prompt is only ever carried as text.
 */

/** The parameter a query result carried: a scalar the editor can bind, or a list it cannot. */
export interface PlannedParameter {
  readonly id: string;
  readonly def: IParameterDef;
  /** Undefined for a list parameter, whose values the editor's single-value binding cannot hold. */
  readonly value?: TypedValue;
}

export type ResultEditorMode =
  /** The query text fills a new draft; the editor saves it before it runs. */
  | 'draft'
  /** A saved query of the project: opened by id and environment, as the editor already does. */
  | 'saved'
  /** No editable query: the editor stays empty, the rows and the saved metadata are shown. */
  | 'rows-only';

export interface ResultEditorPlan {
  readonly mode: ResultEditorMode;
  /** The new draft (`mode: 'draft'` only). */
  readonly definition?: IQueryDef;
  readonly savedQueryId?: string;
  readonly ids?: DbIds;
  readonly parameters: readonly PlannedParameter[];
  /** The saved rows, shaped as the editor shows any result (a snapshot recorded when the result was saved). */
  readonly displayed: FederatedQueryResult;
  /** Why the editor has no query to edit, in words; undefined when it has one. */
  readonly notice?: string;
  /** Read-only lines about the saved query (kind, saved query, database, parameter names, rows). */
  readonly summary: readonly string[];
  readonly savedAt: string;
  readonly rowsKept: number;
  readonly hasMore: boolean;
}

const TYPED_KINDS = new Set([
  'string',
  'number',
  'integer',
  'decimal',
  'boolean',
  'date',
  'datetime',
  'null',
]);

function isTypedValue(v: unknown): v is TypedValue {
  if (!v || typeof v !== 'object') return false;
  const t = v as { type?: unknown; value?: unknown };
  return typeof t.type === 'string' && TYPED_KINDS.has(t.type) && 'value' in t;
}

const DATA_TYPE: Record<string, DataType> = {
  string: 'string',
  number: 'float',
  integer: 'integer',
  decimal: 'decimal',
  boolean: 'boolean',
  date: 'date',
  datetime: 'datetime',
  null: 'string',
};

function planParameter(
  name: string,
  raw: unknown,
): PlannedParameter | undefined {
  if (isTypedValue(raw)) {
    return {
      id: name,
      def: { id: name, type: DATA_TYPE[raw.type] },
      value: raw,
    };
  }
  const set = raw as { type?: unknown; values?: unknown } | null;
  if (set && set.type === 'set' && Array.isArray(set.values)) {
    const first = set.values.find(isTypedValue);
    return {
      id: name,
      def: {
        id: name,
        type: first ? DATA_TYPE[first.type] : 'string',
        isMultiValue: true,
      },
    };
  }
  return undefined;
}

/** The saved rows as the result the editor shows: a snapshot recorded when the result was stored. */
export function savedRowsAsResult(
  result: StoredResult,
  ids: DbIds | undefined,
): FederatedQueryResult {
  return {
    recordset: {
      columns: result.recordset.columns.map((c) => ({
        name: c.name,
        type: c.type,
      })),
      rows: result.recordset.rows,
    },
    limitations: [],
    bindingsApplied: [],
    provenance: {
      source: ids?.source ?? result.meta.db.source ?? 'saved result',
      mode: 'snapshot',
      observedAt: result.meta.createdAt,
    },
    truncated: false,
  };
}

function noticeFor(result: StoredResult): string {
  const { editor, meta } = result;
  if (
    meta.unavailable.editor === 'too-large' ||
    meta.unavailable.query === 'too-large'
  ) {
    return 'The query was too large to keep with this result, so the editor has no query text. The saved rows are shown below.';
  }
  if (editor.language === 'http') {
    return 'This result is from a saved HTTP query, which has no query text to edit here. The saved rows are shown below.';
  }
  if (editor.language === undefined && editor.text === undefined) {
    return 'This result was saved by an older DataTug that did not keep the query text for the editor. The saved rows are shown below.';
  }
  return 'The query text was not kept with this result, so the editor has no query to edit. The saved rows are shown below.';
}

function summaryOf(result: StoredResult, ids: DbIds | undefined): string[] {
  const { meta, editor } = result;
  const lines = [`Kind: ${meta.query.kind || 'unknown'}`];
  if (meta.query.savedQueryId)
    lines.push(`Saved query: ${meta.query.savedQueryId}`);
  if (ids) lines.push(`Database: ${ids.source} in environment ${ids.env}`);
  else lines.push('Database: not a source of a DataTug project');
  const names = editor.params.length
    ? editor.params.map((p) => p.name)
    : Object.keys(meta.query.parameters ?? {}).sort();
  if (names.length) lines.push(`Parameters: ${names.join(', ')}`);
  lines.push(
    `Rows: ${meta.rows.kept} saved${meta.rows.hasMore ? ', more rows exist' : ''}`,
  );
  return lines;
}

/**
 * What the editor is filled with for a result. A saved query opens by its id; an ad-hoc TugQL or SQL query fills a
 * new draft with `draftId`; anything else (an older result, a saved HTTP query, text dropped for size) leaves the
 * editor empty with a named notice. The rows are shown in every case.
 */
export function resultEditorPlan(
  result: StoredResult,
  draftId: string,
): ResultEditorPlan {
  const { editor, meta } = result;
  const ids = parseDatatugRef(editor.dbRef) ?? resultDbIds(meta);
  const parameters = editor.params.flatMap((p) => {
    const planned = planParameter(p.name, p.value);
    return planned ? [planned] : [];
  });
  const common = {
    ids,
    parameters,
    displayed: savedRowsAsResult(result, ids),
    summary: summaryOf(result, ids),
    savedAt: meta.createdAt,
    rowsKept: meta.rows.kept,
    hasMore: meta.rows.hasMore,
  };
  if (meta.query.kind === 'saved' && meta.query.savedQueryId) {
    return { ...common, mode: 'saved', savedQueryId: meta.query.savedQueryId };
  }
  const queryType =
    editor.language === 'tugql'
      ? QueryType.TugQL
      : editor.language === 'sql'
        ? QueryType.SQL
        : undefined;
  if (editor.text && queryType) {
    const definition: IQueryDef = {
      id: draftId,
      title: 'Query from a saved result',
      request: { queryType, text: editor.text } as IQueryDef['request'],
      ...(parameters.length
        ? { parameters: parameters.map((p) => p.def) }
        : {}),
    };
    return { ...common, mode: 'draft', definition };
  }
  return { ...common, mode: 'rows-only', notice: noticeFor(result) };
}
