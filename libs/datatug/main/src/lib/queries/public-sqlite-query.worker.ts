import initSqlJs from 'sql.js';
import type { TugQLResolved } from '@dalgo/core';
import {
  compilePublicSqliteTugQL,
  type PublicSqliteAuthorProof,
} from './public-sqlite-tugql';

const FIXTURE_URL = 'https://chinook.demodb.dev/data/chinook.sqlite';
const FIXTURE_SHA256 =
  '7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15';
const FIXTURE_BYTES = 1007616;
const MAX_ROWS = 1000;
const MAX_COLUMNS = 40;
const MAX_RESULT_BYTES = 1 << 20;
const MAX_SQL_BYTES = 64 << 10;

type Cell = string | number | null;
interface WorkerRelationship {
  readonly id: string;
  readonly version: string;
  readonly fromSource: string;
  readonly toSource: string;
  readonly joinType: 'inner';
  readonly pairs: readonly {
    readonly fromField: string;
    readonly toField: string;
  }[];
}
interface WorkerOutputColumn {
  readonly name: string;
  readonly type: 'integer' | 'string';
  readonly lineage: readonly {
    readonly source: string;
    readonly field: string;
  }[];
}
interface RunMessage {
  readonly sql: string;
  readonly bindings?: readonly (string | number | null)[];
  readonly bindingNames?: readonly string[];
  readonly fixtureSha256?: string;
  readonly schemaVersion?: string;
  readonly draftRevision?: number;
  readonly authorProfile?: boolean;
  readonly authorProfileKind?: 'customer-count-cte';
  readonly relationship?: WorkerRelationship;
  readonly outputColumns?: readonly WorkerOutputColumn[];
  readonly authorProof?: PublicSqliteAuthorProof;
}
interface WorkerExecutionReceipt {
  readonly executionId: string;
  readonly sql: string;
  readonly bindings: readonly (string | number | null)[];
  readonly bindingNames: readonly string[];
  readonly fixtureSha256: string;
  readonly schemaVersion: string;
  readonly draftRevision: number;
  readonly schemaFingerprint: string;
  readonly relationship?: WorkerRelationship;
  readonly outputColumns?: readonly WorkerOutputColumn[];
}
interface ResultMessage {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly Cell[])[];
  readonly schemaFingerprint?: string;
}

function bindParameterCount(sql: string): number {
  let quote = '';
  let count = 0;
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
    ) {
      if (ch !== '?') return -1;
      count++;
    }
  }
  return count;
}

function verifyPinnedInvoiceSchema(
  db: import('sql.js').Database,
  joined: boolean,
): string {
  const result = db.exec('PRAGMA table_info("Invoice")')[0];
  const actual = new Map(
    (result?.values ?? []).map(
      (row) => [String(row[1]), String(row[2]).toUpperCase()] as const,
    ),
  );
  const expected = new Map([
    ['CustomerId', 'INTEGER'],
    ['InvoiceId', 'INTEGER'],
    ['InvoiceDate', 'DATETIME'],
  ]);
  for (const [name, type] of expected) {
    if (actual.get(name) !== type)
      throw new Error(`Pinned Chinook Invoice schema mismatch at ${name}.`);
  }
  const invoiceFingerprint = [...expected]
    .map(([name, type]) => `${name}:${type}`)
    .join('|');
  if (!joined) return invoiceFingerprint;
  const customer = db.exec('PRAGMA table_info("Customer")')[0];
  const customerColumns = customer?.values ?? [];
  const customerId = customerColumns.filter(
    (row) => String(row[1]) === 'CustomerId',
  );
  if (
    customerId.length !== 1 ||
    String(customerId[0]?.[2]).toUpperCase() !== 'INTEGER' ||
    Number(customerId[0]?.[5]) !== 1
  )
    throw new Error('Pinned Chinook Customer primary key mismatch.');
  const fk = db.exec('PRAGMA foreign_key_list("Invoice")')[0]?.values ?? [];
  const customerFks = fk.filter((row) => String(row[2]) === 'Customer');
  if (
    customerFks.length !== 1 ||
    String(customerFks[0]?.[3]) !== 'CustomerId' ||
    String(customerFks[0]?.[4]) !== 'CustomerId'
  )
    throw new Error('Pinned Chinook Invoice foreign key mismatch.');
  for (const name of ['FirstName', 'LastName', 'Email']) {
    const matches = customerColumns.filter((row) => String(row[1]) === name);
    if (
      matches.length !== 1 ||
      !/^(?:N?VARCHAR|N?CHAR|TEXT|CLOB)(?:\b|\()/iu.test(
        String(matches[0]?.[2]).trim(),
      )
    )
      throw new Error(`Pinned Chinook Customer schema mismatch at ${name}.`);
  }
  return `${invoiceFingerprint}|CustomerId:INTEGER:PK|FirstName:STRING|LastName:STRING|Email:STRING|FK_Invoice_Customer_CustomerId:Invoice.CustomerId->Customer.CustomerId`;
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
  bindings: readonly (string | number | null)[] = [],
  authorProfile = false,
  joined = false,
  expectedOutputColumnNames?: readonly string[],
  authorProof?: PublicSqliteAuthorProof,
  bindingNames?: readonly string[],
  schemaVersion?: string,
  draftRevision?: number,
  authorProfileKind?: 'customer-count-cte',
  fixtureSha256?: string,
): Promise<ResultMessage> {
  if (
    typeof sql !== 'string' ||
    new TextEncoder().encode(sql).byteLength > MAX_SQL_BYTES ||
    !/^\s*(?:select|with)\b/i.test(sql)
  ) {
    throw new Error('Use one read-only SELECT statement of at most 64 KiB.');
  }
  if (
    (authorProfileKind === 'customer-count-cte' && !authorProof) ||
    (authorProof && authorProfileKind !== 'customer-count-cte') ||
    (authorProof && authorProof.profile !== 'customer-count-cte') ||
    (authorProfileKind === 'customer-count-cte' && fixtureSha256 !== FIXTURE_SHA256) ||
    (authorProfile && fixtureSha256 !== undefined && fixtureSha256 !== FIXTURE_SHA256) ||
    (authorProfile && /\bFROM\s*\(\s*SELECT[\s\S]*\bFROM\s+"Invoice"/iu.test(sql) &&
      /\bINNER\s+JOIN\s+"Customer"/iu.test(sql) && !authorProof)
  )
    throw new Error('The Author CTE proof or pinned fixture identity is missing or invalid.');
  if (authorProof) {
    const resolved = {
      query: authorProof.resolvedQuery,
      columns: [],
      schemaVersion: schemaVersion ?? '',
      dependencies: [],
      relationships: [],
    } as unknown as TugQLResolved;
    const derived = compilePublicSqliteTugQL(resolved, {
      fixtureSha256: FIXTURE_SHA256,
      schemaVersion: schemaVersion ?? '',
      draftRevision: draftRevision ?? -1,
    });
    const bindingsMatch = bindings.length === 1 + derived.fixedBindings.length &&
      Number.isSafeInteger(bindings[0]) &&
      JSON.stringify(bindings.slice(1)) === JSON.stringify(derived.fixedBindings);
    if (
      !authorProfile ||
      sql !== derived.sql ||
      JSON.stringify(bindingNames) !== JSON.stringify(derived.bindingNames) ||
      JSON.stringify(expectedOutputColumnNames) !==
        JSON.stringify(derived.outputColumns?.map((column) => column.name)) ||
      !bindingsMatch
    )
      throw new Error('The Author CTE execution request differs from the independently compiled profile.');
    joined = true;
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
    const schemaFingerprint = authorProfile
      ? verifyPinnedInvoiceSchema(db, joined)
      : undefined;
    db.run('PRAGMA query_only = ON');
    db.run('PRAGMA trusted_schema = OFF');
    const columns: string[] = [];
    const rows: Cell[][] = [];
    let statements = 0;
    for (const statement of db.iterateStatements(sql)) {
      if (++statements !== 1)
        throw new Error('Use one read-only SELECT statement.');
      const statementSql = statement.getSQL();
      const expectedBindings = bindParameterCount(statementSql);
      if (
        expectedBindings < 0 ||
        expectedBindings !== bindings.length ||
        bindings.some(
          (value) =>
            value !== null &&
            typeof value !== 'string' &&
            (typeof value !== 'number' || !Number.isSafeInteger(value)),
        )
      )
        throw new Error('The browser SQLite query bindings are invalid.');
      if (bindings.length && !statement.bind([...bindings]))
        throw new Error('The browser SQLite query bindings are invalid.');
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
    if (
      expectedOutputColumnNames &&
      (expectedOutputColumnNames.length !== columns.length ||
        expectedOutputColumnNames.some(
          (name, index) => columns[index] !== name,
        ))
    ) {
      throw new Error(
        'The SQLite result columns differ from the prepared output lineage.',
      );
    }
    return {
      columns,
      rows,
      ...(schemaFingerprint ? { schemaFingerprint } : {}),
    };
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
    void executePinnedSql(
      event.data.sql,
      undefined,
      event.data.bindings ?? [],
      event.data.authorProfile === true,
      event.data.relationship !== undefined || event.data.authorProof !== undefined,
      event.data.outputColumns?.map((column) => column.name),
      event.data.authorProof,
      event.data.bindingNames,
      event.data.schemaVersion,
      event.data.draftRevision,
      event.data.authorProfileKind,
      event.data.fixtureSha256,
    )
      .then((result) => {
        if (
          !event.data.authorProfile ||
          !event.data.fixtureSha256 ||
          !event.data.schemaVersion ||
          typeof event.data.draftRevision !== 'number' ||
          !Number.isSafeInteger(event.data.draftRevision) ||
          !event.data.bindingNames?.length
        ) {
          self.postMessage({ ok: true, result });
          return;
        }
        const receipt: WorkerExecutionReceipt = {
          executionId: crypto.randomUUID(),
          sql: event.data.sql,
          bindings: event.data.bindings ?? [],
          bindingNames: event.data.bindingNames,
          fixtureSha256: event.data.fixtureSha256,
          schemaVersion: event.data.schemaVersion,
          draftRevision: event.data.draftRevision,
          schemaFingerprint: result.schemaFingerprint ?? '',
          ...(event.data.relationship
            ? { relationship: event.data.relationship }
            : {}),
          ...(event.data.authorProof
            ? {
                outputColumns: compilePublicSqliteTugQL(
                  {
                    query: event.data.authorProof.resolvedQuery,
                    columns: [],
                    schemaVersion: event.data.schemaVersion ?? '',
                    dependencies: [],
                    relationships: [],
                  } as unknown as TugQLResolved,
                  {
                    fixtureSha256: FIXTURE_SHA256,
                    schemaVersion: event.data.schemaVersion ?? '',
                    draftRevision: event.data.draftRevision ?? -1,
                  },
                ).outputColumns,
              }
            : event.data.outputColumns
              ? { outputColumns: event.data.outputColumns }
              : {}),
        };
        self.postMessage({ ok: true, result, receipt });
      })
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
