import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';
import { buildAgentUrl } from '../services/repo/agent-url';
import { KeyValue } from './record-key';
import { TableIdentity, qualifiedTableName } from './table-identity';

/**
 * The one client of the read-only agent routes the pages a card's link opens use (Feature claude-mod-web-links;
 * datatug-cli `pkg/server/endpoints/records_lookup.go`). Every request shape and every answer shape of those routes
 * is known only here, so a change of the agent's contract is an edit of this file.
 *
 * Nothing here builds a `where` or SQL text, sends a connection string, or logs a request or an answer: identifiers
 * travel in a POST body, never in the address.
 */

/** Which table of which registered source: the body of `records/schema` and the part of a lookup before its key. */
export interface AgentTableRef {
  /** The store id of the agent, e.g. `http-127.0.0.1:8989`. */
  readonly storeId: string;
  readonly project: string;
  readonly env: string;
  /** The source (database catalog) id. */
  readonly source: string;
  readonly table: TableIdentity;
}

export interface AgentColumn {
  readonly name: string;
  readonly type: string;
}

/** The live schema of a table of a registered source (read from the source, not from a scan). */
export interface AgentTableSchema {
  readonly columns: readonly AgentColumn[];
  readonly primaryKey: readonly string[];
  /** Names of the tables whose foreign keys reference this table. */
  readonly referencedBy: readonly string[];
}

/**
 * Rows read through the agent, every value as display text. A `records/lookup` integer keeps all its digits (the
 * agent sends it as a string); an `exec/select` row arrives as plain JSON numbers, so an integer above 2^53 - 1 is
 * shown rounded there. The records view links to no record, so no key is taken from that display.
 */
export interface AgentRows {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** A cell as display text: null and undefined are empty, objects are JSON. */
function displayText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Why a page cannot show what its link asks for (REQ:ui-unresolved-states). `bad-key` is decided by the page itself
 * before any lookup; `read-failed` is an agent failure that is none of the named states.
 */
export type LinkProblem =
  | 'agent-unreachable'
  | 'link-expired'
  | 'project-not-found'
  | 'database-not-found'
  | 'table-not-found'
  | 'record-not-found'
  | 'bad-key'
  | 'read-failed';

/** An agent request that failed, classified; the agent's own message is never kept. */
export class LinkProblemError extends Error {
  constructor(readonly problem: LinkProblem) {
    super(problem);
    this.name = 'LinkProblemError';
  }
}

/**
 * Classifies a failed agent request by its status and the `field` of the contract error envelope only:
 *
 * - no answer (status 0: not running, blocked by the browser, or refused by the agent's origin check, which sends
 *   no CORS header) and 403 (ACCESS_DENIED, the same answer for every principal the policy refuses): agent-unreachable;
 * - 401: link-expired (no valid session token: the code was used or expired, or the agent restarted);
 * - 404 with field project / source (or env) / table or schema / key: project-, database-, table-, record-not-found;
 * - 400 with field key: bad-key;
 * - anything else: read-failed.
 */
export function classifyAgentError(err: unknown): LinkProblem {
  if (err instanceof LinkProblemError) {
    return err.problem;
  }
  if (!(err instanceof HttpErrorResponse)) {
    return 'read-failed';
  }
  if (err.status === 0 || err.status === 403) {
    return 'agent-unreachable';
  }
  if (err.status === 401) {
    return 'link-expired';
  }
  const body = err.error as { error?: { field?: unknown } } | null;
  const field =
    body && typeof body === 'object' && typeof body.error?.field === 'string'
      ? body.error.field
      : '';
  if (err.status === 404) {
    switch (field) {
      case 'project':
        return 'project-not-found';
      case 'env':
      case 'source':
        return 'database-not-found';
      case 'schema':
      case 'table':
        return 'table-not-found';
      case 'key':
        return 'record-not-found';
    }
  }
  if (err.status === 400 && field === 'key') {
    return 'bad-key';
  }
  return 'read-failed';
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

@Injectable({ providedIn: 'root' })
export class AgentLinkApiService {
  private readonly http = inject(HttpClient);

  /** `POST /datatug/records/schema`: the live columns, primary key and referencing tables of the table. */
  tableSchema(ref: AgentTableRef): Observable<AgentTableSchema> {
    return this.http
      .post<unknown>(
        buildAgentUrl(ref.storeId, '/records/schema'),
        tableBody(ref),
      )
      .pipe(
        map((response) => {
          const r = (response ?? {}) as Record<string, unknown>;
          const columns = Array.isArray(r['columns'])
            ? (r['columns'] as unknown[])
                .map((c) => (c ?? {}) as Record<string, unknown>)
                .filter((c) => typeof c['name'] === 'string')
                .map((c) => ({
                  name: c['name'] as string,
                  type: typeof c['type'] === 'string' ? c['type'] : '',
                }))
            : [];
          return {
            columns,
            primaryKey: stringList(r['primaryKey']),
            referencedBy: stringList(r['referencedBy']),
          };
        }),
        catchError(rethrowClassified),
      );
  }

  /**
   * `POST /datatug/records/lookup`: the one record of the table whose declared primary key is `key` (values bound as
   * parameters by the agent; see `lookupKey()` for how they are typed). No key ever goes in an address.
   */
  lookupRecord(
    ref: AgentTableRef,
    key: Readonly<Record<string, KeyValue>>,
  ): Observable<AgentRows> {
    return this.http
      .post<unknown>(buildAgentUrl(ref.storeId, '/records/lookup'), {
        ...tableBody(ref),
        key,
      })
      .pipe(
        map((response) => {
          const rows = contractRows(response);
          if (rows.rows.length !== 1) {
            throw new LinkProblemError('record-not-found');
          }
          return rows;
        }),
        catchError(rethrowClassified),
      );
  }

  /**
   * `GET /datatug/exec/select` with `from` and `limit` only: the first `limit` rows of the table, read-only. No
   * `where`, `sql` or other filter is ever sent.
   */
  selectRows(ref: AgentTableRef, limit: number): Observable<AgentRows> {
    const params = new HttpParams()
      .set('proj', ref.project)
      .set('env', ref.env)
      .set('db', ref.source)
      .set('from', qualifiedTableName(ref.table))
      .set('limit', String(limit));
    return this.http
      .get<unknown>(buildAgentUrl(ref.storeId, '/exec/select'), { params })
      .pipe(
        map((response) => {
          const r = (response ?? {}) as Record<string, unknown>;
          const columns = stringList(r['columns']);
          const rows = Array.isArray(r['rows'])
            ? (r['rows'] as unknown[])
                .slice(0, limit)
                .map((row) =>
                  columns.map((c) =>
                    displayText((row as Record<string, unknown> | null)?.[c]),
                  ),
                )
            : [];
          return { columns, rows };
        }),
        catchError(rethrowClassified),
      );
  }
}

function rethrowClassified(err: unknown): Observable<never> {
  return throwError(() => new LinkProblemError(classifyAgentError(err)));
}

/** `records/lookup` answers the contract Result: `recordset.columns[{name}]`, `rows[[{type, value}]]`. */
function contractRows(response: unknown): AgentRows {
  const recordset = ((response ?? {}) as Record<string, unknown>)['recordset'] as
    | Record<string, unknown>
    | undefined;
  const columns = Array.isArray(recordset?.['columns'])
    ? (recordset['columns'] as unknown[]).map((c) =>
        displayText((c as Record<string, unknown> | null)?.['name']),
      )
    : [];
  const rows = Array.isArray(recordset?.['rows'])
    ? (recordset['rows'] as unknown[]).map((row) =>
        Array.isArray(row)
          ? row.map((cell) =>
              displayText((cell as Record<string, unknown> | null)?.['value']),
            )
          : [],
      )
    : [];
  return { columns, rows };
}

/** The JSON body naming the table: `{project, env, source, schema, table}`. */
function tableBody(ref: AgentTableRef): Record<string, string> {
  return {
    project: ref.project,
    env: ref.env,
    source: ref.source,
    schema: ref.table.schema,
    table: ref.table.name,
  };
}
