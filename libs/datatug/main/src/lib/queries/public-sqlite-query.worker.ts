import initSqlJs from 'sql.js';

const FIXTURE_URL = 'https://chinook.demodb.dev/data/chinook.sqlite';
const FIXTURE_SHA256 =
  '7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15';
const FIXTURE_BYTES = 1007616;
const MAX_ROWS = 1000;
const MAX_COLUMNS = 40;
const MAX_RESULT_BYTES = 1 << 20;
const MAX_SQL_BYTES = 64 << 10;

type Cell = string | number | null;
interface RunMessage {
  readonly sql: string;
}
interface ResultMessage {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly Cell[])[];
}

function hasBindParameter(sql: string): boolean {
  let quote = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (quote) {
      if (ch === quote) {
        if (next === quote && quote !== ']') i++;
        else quote = '';
      }
      continue;
    }
    if (ch === '-' && next === '-') {
      i = sql.indexOf('\n', i + 2);
      if (i < 0) break;
      continue;
    }
    if (ch === '/' && next === '*') {
      i = sql.indexOf('*/', i + 2);
      if (i < 0) break;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      quote = ch === '[' ? ']' : ch;
      continue;
    }
    if (
      ch === '?' ||
      ((ch === ':' || ch === '@' || ch === '$') && /[A-Za-z_]/.test(next ?? ''))
    )
      return true;
  }
  return false;
}

export async function readPinnedFixture(): Promise<Uint8Array> {
  const response = await fetch(FIXTURE_URL, {
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!response.ok || !response.body)
    throw new Error('The public Chinook fixture is unavailable.');
  if (Number(response.headers.get('content-length')) > FIXTURE_BYTES)
    throw new Error('The public Chinook fixture exceeds its pinned size.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > FIXTURE_BYTES) {
      await reader.cancel();
      throw new Error('The public Chinook fixture exceeds its pinned size.');
    }
    chunks.push(value);
  }
  if (length !== FIXTURE_BYTES)
    throw new Error('The public Chinook fixture size differs from its pin.');
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actual = [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
  if (actual !== FIXTURE_SHA256)
    throw new Error('The public Chinook fixture hash differs from its pin.');
  return bytes;
}

export async function executePinnedSql(
  sql: string,
  fixture?: Uint8Array,
): Promise<ResultMessage> {
  if (
    typeof sql !== 'string' ||
    new TextEncoder().encode(sql).byteLength > MAX_SQL_BYTES ||
    !/^\s*(?:select|with)\b/i.test(sql)
  ) {
    throw new Error('Use one read-only SELECT statement of at most 64 KiB.');
  }
  const SQL = await initSqlJs(
    fixture
      ? undefined
      : {
          locateFile: () =>
            new URL('/assets/sql-wasm.wasm', self.location.origin).href,
        },
  );
  const db = new SQL.Database(fixture ?? (await readPinnedFixture()));
  try {
    db.run('PRAGMA query_only = ON');
    db.run('PRAGMA trusted_schema = OFF');
    const columns: string[] = [];
    const rows: Cell[][] = [];
    let statements = 0;
    for (const statement of db.iterateStatements(sql)) {
      if (++statements !== 1)
        throw new Error('Use one read-only SELECT statement.');
      if (hasBindParameter(statement.getSQL()))
        throw new Error(
          'Browser SQLite queries do not accept unbound parameters.',
        );
      columns.push(...statement.getColumnNames());
      if (!columns.length || columns.length > MAX_COLUMNS)
        throw new Error('The query must return 1 to 40 columns.');
      let resultBytes = 0;
      while (statement.step()) {
        if (rows.length >= MAX_ROWS)
          throw new Error('The query exceeds the 1,000-row browser limit.');
        const raw = statement.get();
        const row = raw.map((cell): Cell => {
          if (
            cell === null ||
            typeof cell === 'number' ||
            typeof cell === 'string'
          )
            return cell;
          throw new Error(
            'Blob columns are unavailable in the browser result grid.',
          );
        });
        resultBytes += new TextEncoder().encode(JSON.stringify(row)).byteLength;
        if (resultBytes > MAX_RESULT_BYTES)
          throw new Error('The query exceeds the 1 MiB browser result limit.');
        rows.push(row);
      }
    }
    if (statements !== 1)
      throw new Error('Use one read-only SELECT statement.');
    return { columns, rows };
  } finally {
    db.close();
  }
}

if (
  typeof self !== 'undefined' &&
  'postMessage' in self &&
  typeof Window === 'undefined'
) {
  self.onmessage = (event: MessageEvent<RunMessage>) => {
    void executePinnedSql(event.data.sql)
      .then((result) => self.postMessage({ ok: true, result }))
      .catch((error: unknown) =>
        self.postMessage({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'The browser SQLite query failed.',
        }),
      );
  };
}
