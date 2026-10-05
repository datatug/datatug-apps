// @vitest-environment node
import 'fake-indexeddb/auto';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deriveChatJoin, discoverChatJoinCandidates } from './chat-joins';
import { chatSQLite } from './chat-query-format';
import { CHINOOK_SCHEMA } from './chat.types';
import { CHINOOK_FIXTURE_VERSION, ChinookChatDataService } from './chinook-chat-data.service';

/**
 * One fixture, three engines. The single-source adapter, the join-aware engine and SQLite (which runs the
 * SQL the Chat previews) must all agree on which rows a filter keeps, null rows included, so that:
 *  - a join derived from a result returns exactly the rows of that result, joined, and
 *  - the SQL preview is what runs.
 * `Company` holds a string, null, an empty string, the text "null" and a number, which is where they differ.
 */
const tables: Record<string, Record<string, unknown>[]> = {
  Artist: [], Album: [], Track: [], Genre: [], MediaType: [], Playlist: [], PlaylistTrack: [], InvoiceLine: [], Employee: [],
  Customer: [
    { CustomerId: 1, FirstName: 'Embraer', Company: 'Embraer', SupportRepId: 1 },
    { CustomerId: 2, FirstName: 'Nobody', Company: null, SupportRepId: 2 },
    { CustomerId: 3, FirstName: 'Nobody', Company: null, SupportRepId: null },
    { CustomerId: 4, FirstName: 'Other', Company: 'Telenor', SupportRepId: 2 },
    { CustomerId: 5, FirstName: 'Empty', Company: '', SupportRepId: 1 },
    { CustomerId: 6, FirstName: 'Text', Company: 'null', SupportRepId: 1 },
    { CustomerId: 7, FirstName: 'Zero', Company: 0, SupportRepId: 1 },
  ],
  // Customer 7 has no invoice, so a join must also drop it.
  Invoice: [1, 2, 3, 4, 5, 6].map((id) => ({ InvoiceId: id, CustomerId: id, BillingCountry: id % 2 ? 'A' : null, Total: id })),
};
const withInvoices = [1, 2, 3, 4, 5, 6];
const scope = 'store:datatug-demo-project';
const schema = CHINOOK_SCHEMA as never;

function sqliteDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const table of CHINOOK_SCHEMA.tables) {
    db.exec(`CREATE TABLE "${table.name}" (${table.fields.map((field) => `"${field}"`).join(', ')})`);
    for (const row of tables[table.name] ?? []) {
      db.prepare(`INSERT INTO "${table.name}" (${table.fields.map((field) => `"${field}"`).join(', ')}) VALUES (${table.fields.map(() => '?').join(', ')})`)
        .run(...table.fields.map((field) => (row[field] ?? null) as never));
    }
  }
  return db;
}

describe('null rows across the single-source adapter, the join-aware engine and the SQL preview', () => {
  const service = new ChinookChatDataService();
  let db: DatabaseSync;

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: CHINOOK_FIXTURE_VERSION, tables }), { status: 200 })));
    await service.ensureSeed('store', 'datatug-demo-project');
    db = sqliteDatabase();
  });
  afterAll(() => vi.unstubAllGlobals());

  const distinct = (rows: readonly Record<string, unknown>[], key = 'CustomerId'): unknown[] =>
    [...new Set(rows.map((row) => row[key]))].sort();

  /** What the engine returns, and what the SQL the Chat previews returns in SQLite. */
  async function run(dtql: string, key = 'CustomerId'): Promise<{ engine: unknown[]; preview: unknown[]; rows: number; previewRows: number; sql: string }> {
    const { rows, query } = await service.query(scope, dtql);
    const sql = chatSQLite(query);
    const previewRows = db.prepare(sql.replace(/;$/, '')).all() as Record<string, unknown>[];
    return { engine: distinct(rows, key), preview: distinct(previewRows, key), rows: rows.length, previewRows: previewRows.length, sql };
  }

  const single = (where: unknown): string => JSON.stringify({ from: { schema: 'main', name: 'Customer' }, where, orderBy: [{ field: 'CustomerId' }], limit: 100 });
  const company = { field: 'Company' };
  const cmp = (op: string, value: unknown): unknown => ({ op, left: company, right: { value } });
  const list = (op: string, values: unknown[]): unknown => ({ op, left: company, right: { values } });

  /** [label, single-source where, the Customer ids the adapter keeps]. */
  const parents: readonly (readonly [string, unknown, number[]])[] = [
    ['== "Embraer"', cmp('==', 'Embraer'), [1]],
    ['== null', cmp('==', null), [2, 3]],
    ['== ""', cmp('==', ''), [5]],
    ['== 0', cmp('==', 0), [7]],
    ['!= "Embraer"', cmp('!=', 'Embraer'), [2, 3, 4, 5, 6, 7]],
    ['!= null', cmp('!=', null), [1, 4, 5, 6, 7]],
    ['!= ""', cmp('!=', ''), [1, 2, 3, 4, 6, 7]],
    ['!= 0', cmp('!=', 0), [1, 2, 3, 4, 5, 6]],
    ['< "Embraer"', cmp('<', 'Embraer'), [2, 3, 5, 7]],
    ['< null', cmp('<', null), []],
    ['< ""', cmp('<', ''), [2, 3, 7]],
    ['< 0', cmp('<', 0), [2, 3]],
    ['<= "Embraer"', cmp('<=', 'Embraer'), [1, 2, 3, 5, 7]],
    ['<= null', cmp('<=', null), [2, 3]],
    ['<= ""', cmp('<=', ''), [2, 3, 5, 7]],
    ['<= 0', cmp('<=', 0), [2, 3, 7]],
    ['> "Embraer"', cmp('>', 'Embraer'), [4, 6]],
    ['> null', cmp('>', null), [1, 4, 5, 6, 7]],
    ['> ""', cmp('>', ''), [1, 4, 6]],
    ['> 0', cmp('>', 0), [1, 4, 5, 6]],
    ['>= "Embraer"', cmp('>=', 'Embraer'), [1, 4, 6]],
    ['>= null', cmp('>=', null), [1, 2, 3, 4, 5, 6, 7]],
    ['>= ""', cmp('>=', ''), [1, 4, 5, 6]],
    ['>= 0', cmp('>=', 0), [1, 4, 5, 6, 7]],
    ['In [Embraer, Telenor]', list('In', ['Embraer', 'Telenor']), [1, 4]],
    ['In [Embraer, null]', list('In', ['Embraer', null]), [1, 2, 3]],
    ['In [null]', list('In', [null]), [2, 3]],
    ['In ["", 0, "null"]', list('In', ['', 0, 'null']), [5, 6, 7]],
    ['NotIn [Embraer, Telenor]', list('NotIn', ['Embraer', 'Telenor']), [2, 3, 5, 6, 7]],
    ['NotIn [Embraer, null]', list('NotIn', ['Embraer', null]), [4, 5, 6, 7]],
    ['NotIn [null]', list('NotIn', [null]), [1, 4, 5, 6, 7]],
    ['NotIn ["", 0, "null"]', list('NotIn', ['', 0, 'null']), [1, 2, 3, 4]],
  ];

  describe('a join derived from a single-source result returns exactly that result, joined', () => {
    it.each(parents)('%s', async (_label, where, expected) => {
      const parent = await service.query(scope, single(where));
      expect(distinct(parent.rows)).toEqual(expected);
      const edge = discoverChatJoinCandidates(parent.query).find((item) => item.targetTable === 'Invoice' && item.direction === 'reverse');
      const derived = deriveChatJoin(parent.query, edge?.id ?? '', schema);
      const child = await run(derived.dtql);
      expect(child.engine).toEqual(expected.filter((id) => withInvoices.includes(id)));
      // The join's own SQL preview is what runs, too.
      expect(child.preview).toEqual(child.engine);
      expect(child.previewRows).toBe(child.rows);
    });

    it('stays the same through a second derived join', async () => {
      const parent = await service.query(scope, single(cmp('<', 'Embraer')));
      const first = deriveChatJoin(parent.query, discoverChatJoinCandidates(parent.query).find((item) => item.targetTable === 'Invoice')?.id ?? '', schema);
      const joined = await service.query(scope, first.dtql);
      const next = discoverChatJoinCandidates(joined.query).find((item) => item.sourceAlias === 'Customer' && item.targetTable === 'Employee');
      const second = deriveChatJoin(joined.query, next?.id ?? '', schema);
      // Employee is empty in the fixture, so the inner join keeps nothing, and the filter is still the carried one.
      expect(second.query.filters).toEqual(first.query.filters);
    });
  });

  describe('the single-source SQL preview returns the rows the adapter returns', () => {
    it.each(parents)('%s', async (_label, where, expected) => {
      const result = await run(single(where));
      expect(result.engine).toEqual(expected);
      expect(result.preview).toEqual(expected);
      expect(result.previewRows).toBe(result.rows);
    });
  });

  describe('the join-aware SQL preview returns the rows the join-aware engine returns', () => {
    const aliased = (where: unknown): string => JSON.stringify({
      from: { schema: 'main', name: 'Customer', alias: 'c' }, where, orderBy: [{ field: 'CustomerId', source: 'c' }], limit: 100,
    });
    const f = (name: string): unknown => ({ field: name, source: 'c' });
    const operands: readonly (readonly [string, unknown])[] = [['"Embraer"', 'Embraer'], ['null', null], ['""', ''], ['0', 0]];
    const comparisons = ['==', '!=', '<', '<=', '>', '>='].flatMap((op) => operands.flatMap(([label, value]) => [
      [`Company ${op} ${label}`, { op, left: f('Company'), right: { value } }],
      [`${label} ${op} Company`, { op, left: { value }, right: f('Company') }],
    ] as const));
    const others: readonly (readonly [string, unknown])[] = [
      ['In [Embraer, Telenor]', { op: 'In', left: f('Company'), right: { values: ['Embraer', 'Telenor'] } }],
      ['In [Embraer, null]', { op: 'In', left: f('Company'), right: { values: ['Embraer', null] } }],
      ['In [null]', { op: 'In', left: f('Company'), right: { values: [null] } }],
      ['NotIn [Embraer, Telenor]', { op: 'NotIn', left: f('Company'), right: { values: ['Embraer', 'Telenor'] } }],
      ['NotIn [Embraer, null]', { op: 'NotIn', left: f('Company'), right: { values: ['Embraer', null] } }],
      ['NotIn [null]', { op: 'NotIn', left: f('Company'), right: { values: [null] } }],
      ['Company == FirstName', { op: '==', left: f('Company'), right: f('FirstName') }],
      ['Company != FirstName', { op: '!=', left: f('Company'), right: f('FirstName') }],
      ['Company != SupportRepId', { op: '!=', left: f('Company'), right: f('SupportRepId') }],
      ['isNull Company', { isNull: f('Company') }],
      ['isNotNull Company', { isNotNull: f('Company') }],
      ['isNull SupportRepId + 1', { isNull: { binary: { op: '+', left: f('SupportRepId'), right: { value: 1 } } } }],
      ['and/or of null tests and comparisons', { and: [{ or: [{ isNull: f('Company') }, { op: '!=', left: f('Company'), right: { value: 'Embraer' } }] }, { op: '<', left: f('CustomerId'), right: { value: 7 } }] }],
    ];

    it.each([...comparisons, ...others])('WHERE %s', async (_label, where) => {
      const result = await run(aliased(where));
      expect(result.preview, result.sql).toEqual(result.engine);
      expect(result.previewRows, result.sql).toBe(result.rows);
    });

    describe('HAVING over the groups of Company', () => {
      const grouped = (having: unknown): string => JSON.stringify({
        from: {
          schema: 'main', name: 'Customer', alias: 'c',
          joins: [{ from: { schema: 'main', name: 'Invoice', alias: 'i' }, on: [{ left: f('CustomerId'), op: '==', right: { field: 'CustomerId', source: 'i' } }] }],
        },
        columns: [{ field: 'Company', source: 'c', as: 'company' }, { aggregate: { function: 'count', args: [{ star: true }] }, as: 'n' }],
        groupBy: [f('Company')], having,
      });
      const having: readonly (readonly [string, unknown])[] = [
        ['company == null', { op: '==', left: { field: 'company' }, right: { value: null } }],
        ['company != null', { op: '!=', left: { field: 'company' }, right: { value: null } }],
        ['null == company', { op: '==', left: { value: null }, right: { field: 'company' } }],
        ['company == "Embraer"', { op: '==', left: { field: 'company' }, right: { value: 'Embraer' } }],
        ['company != "Embraer"', { op: '!=', left: { field: 'company' }, right: { value: 'Embraer' } }],
        ['company < "Embraer"', { op: '<', left: { field: 'company' }, right: { value: 'Embraer' } }],
        ['isNull company', { isNull: { field: 'company' } }],
        ['n >= 1 and company == null', { and: [{ op: '>=', left: { field: 'n' }, right: { value: 1 } }, { op: '==', left: { field: 'company' }, right: { value: null } }] }],
      ];

      it.each(having)('%s', async (_label, condition) => {
        const { rows, query } = await service.query(scope, grouped(condition));
        const sql = chatSQLite(query);
        const previewRows = db.prepare(sql.replace(/;$/, '')).all() as Record<string, unknown>[];
        const key = (row: Record<string, unknown>): string => JSON.stringify([row['company'], row['n']]);
        expect(previewRows.map(key).sort(), sql).toEqual(rows.map(key).sort());
      });
    });
  });
});
