import initSqlJs from 'sql.js';
import { countSqlitePlaceholders } from './sql-bindings';

const MAX_ROWS = 1000;
const MAX_COLUMNS = 40;
const MAX_RESULT_BYTES = 1 << 20;
const MAX_SQL_BYTES = 64 << 10;

export interface BrowserSqliteWorkerRequest {
  readonly sql: string;
  readonly fixture: Uint8Array;
  readonly bindings: readonly (string | number | null)[];
}

export interface BrowserSqliteWorkerReply {
  readonly ok: boolean;
  readonly result?: {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly (string | number | bigint | null)[])[];
  };
  readonly error?: string;
}

function statementStart(sql: string): string {
  let remaining = sql.trimStart();
  while (remaining.startsWith('--') || remaining.startsWith('/*')) {
    if (remaining.startsWith('--')) {
      const end = remaining.indexOf('\n');
      if (end < 0) return '';
      remaining = remaining.slice(end + 1).trimStart();
    } else {
      const end = remaining.indexOf('*/', 2);
      if (end < 0) return '';
      remaining = remaining.slice(end + 2).trimStart();
    }
  }
  return remaining;
}

export async function executeBrowserSqlite(
  request: BrowserSqliteWorkerRequest,
  loadSql: () => Promise<import('sql.js').SqlJsStatic> = () => initSqlJs({
    locateFile: () => new URL('/assets/sql-wasm.wasm', self.location.origin).href,
  }),
): Promise<BrowserSqliteWorkerReply['result']> {
  const { sql, fixture, bindings } = request;
  if (
    !sql.trim() ||
    new TextEncoder().encode(sql).byteLength > MAX_SQL_BYTES ||
    !/^(?:select|with)\b/i.test(statementStart(sql))
  ) throw new Error('Use one read-only SELECT statement of at most 64 KiB.');
  if (!(fixture instanceof Uint8Array) || fixture.byteLength === 0)
    throw new Error('The pinned browser SQLite fixture is required.');
  if (!Array.isArray(bindings) || bindings.some((value) =>
    value !== null && typeof value !== 'string' &&
    (typeof value !== 'number' || !Number.isFinite(value))))
    throw new Error('The browser SQLite bindings are invalid.');
  if (countSqlitePlaceholders(sql) !== bindings.length)
    throw new Error('The SQL placeholder count does not match the supplied values.');

  const SQL = await loadSql();
  const db = new SQL.Database(fixture);
  let statement: import('sql.js').Statement | undefined;
  try {
    db.run('PRAGMA query_only = ON');
    db.run('PRAGMA trusted_schema = OFF');
    let count = 0;
    let columns: string[] = [];
    const rows: (string | number | bigint | null)[][] = [];
    let resultBytes = 0;
    for (const current of db.iterateStatements(sql)) {
      if (++count !== 1) throw new Error('Use one read-only SELECT statement.');
      statement = current;
      const names = statement.getColumnNames();
      if (names.length < 1 || names.length > MAX_COLUMNS)
        throw new Error('The query must return 1 to 40 columns.');
      columns = names;
      if (bindings.length && !statement.bind([...bindings]))
        throw new Error('The browser SQLite bindings do not match the query.');
      while (statement.step()) {
        if (rows.length >= MAX_ROWS) throw new Error('The query exceeds the 1,000-row browser limit.');
        const row = (statement as unknown as { get(params: null, config: { useBigInt: true }): unknown[] })
          .get(null, { useBigInt: true }).map((cell): string | number | bigint | null => {
          if (cell === null || typeof cell === 'string') return cell;
          if (typeof cell === 'bigint') return cell;
          if (typeof cell === 'number' && Number.isFinite(cell)) return cell;
          throw new Error('Blob or non-finite values are unavailable in browser query results.');
        });
        resultBytes += new TextEncoder().encode(JSON.stringify(row, (_key, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value)).byteLength;
        if (resultBytes > MAX_RESULT_BYTES) throw new Error('The query exceeds the 1 MiB browser result limit.');
        rows.push(row);
      }
      statement.free();
      statement = undefined;
    }
    if (count !== 1) throw new Error('Use one read-only SELECT statement.');
    return { columns, rows };
  } finally {
    statement?.free();
    db.close();
  }
}

if (typeof self !== 'undefined' && 'postMessage' in self && typeof Window === 'undefined') {
  self.onmessage = (event: MessageEvent<BrowserSqliteWorkerRequest>) => {
    void executeBrowserSqlite(event.data).then(
      (result) => self.postMessage({ ok: true, result } satisfies BrowserSqliteWorkerReply),
      (error: unknown) => self.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : 'The browser SQLite query failed.',
      } satisfies BrowserSqliteWorkerReply),
    );
  };
}
