import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import initSqlJs from 'sql.js';
import { vi } from 'vitest';
import { chartEvidenceError, prepareBarRace, transformOrdersMonthlyCountryCount, type BrowserSqliteChartRecordset } from '@sneat/datatug-semantic';
import { QueryType, type IQueryDef, type ISqlQueryRequest } from '../models/definition/query-def';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { DetectiveClientService } from '../detective/detective-client.service';
import type { QueryConnectionDescriptor } from './query-dispatch';
import { QueryDispatchService } from './query-dispatch.service';
import { executeBrowserSqlite, type BrowserSqliteWorkerRequest } from './browser-sqlite-query.worker';

const directory = resolve(process.cwd(), 'libs/datatug/main/src/lib/queries/test-fixtures/browser-sqlite');
const read = (file: string) => readFileSync(resolve(directory, file));
const definition = (id: string): IQueryDef => {
  const metadata = JSON.parse(read(`${id}.query.json`).toString());
  return { ...metadata, request: { queryType: QueryType.SQL, text: read(`${id}.query.sql`).toString() } };
};
const catalog = { connections: ['northwind', 'chinook'].map((dataset) => {
  const rights = read(`${dataset}-source-rights.json`);
  const provider = JSON.parse(rights.toString()).sourceRights[0].pins[0];
  return { id: `${dataset}-sqlite`, storage: 'sqlite', environments: ['dev'], fixtureSha256: provider.sha256,
    browserFixture: { url: `/assets/showcase/${dataset}.sqlite`, bytes: provider.bytes,
      sourceRights: { url: `/assets/showcase/${dataset}-source-rights.json`, bytes: rights.length,
        sha256: createHash('sha256').update(rights).digest('hex') } } };
}) };

describe('generic saved SQL dispatcher with pinned browser fixtures', () => {
  let dispatcher: QueryDispatchService;
  let reads: string[];
  let activeCatalog: { connections: QueryConnectionDescriptor[] };
  beforeEach(async () => {
    reads = [];
    activeCatalog = structuredClone(catalog);
    const SQL = await initSqlJs();
    TestBed.configureTestingModule({ providers: [provideHttpClient(),
      { provide: ProjectQueryApiService, useValue: {} },
      { provide: GithubProjectReaderService, useValue: { getRawJson: () => of(activeCatalog) } },
      { provide: DetectiveClientService, useValue: {} },
    ] });
    dispatcher = TestBed.inject(QueryDispatchService);
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input);
      reads.push(url.pathname);
      const bytes = readFileSync(resolve(process.cwd(), 'apps/datatug-app/src', url.pathname.slice(1)));
      return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
    }));
    vi.stubGlobal('Worker', class {
      onmessage?: (event: MessageEvent) => void;
      postMessage(request: BrowserSqliteWorkerRequest): void {
        void executeBrowserSqlite(request, async () => SQL).then(
          (result) => this.onmessage?.({ data: { ok: true, result } } as MessageEvent),
          (error: Error) => this.onmessage?.({ data: { ok: false, error: error.message } } as MessageEvent));
      }
      terminate(): void { this.onmessage = undefined; }
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  const ref = { storeId: 'github.com', projectId: 'datatug-demo-project@datatug@demo-project-1' };
  const execute = async (dispatcher: QueryDispatchService, saved: IQueryDef): Promise<BrowserSqliteChartRecordset> =>
    await dispatcher.execute({ projectRef: ref, definition: saved, queryId: `demodb/${saved.id}` }) as BrowserSqliteChartRecordset;

  it('runs all three saved chart and inspector projections through the ordinary dispatcher and real WASM', async () => {
    const orders = await execute(dispatcher, definition('northwind-orders-browser-sqlite'));
    expect(orders.runtime).toBe('browser-sqlite');
    expect(orders.provenance.mode).toBe('snapshot');
    expect('publicApiReceipt' in orders).toBe(false);
    expect(orders.recordset.rows).toHaveLength(830);
    expect(orders.recordset.columns).toHaveLength(14);
    expect(orders.recordset.rows[0][0]).toEqual({ type: 'integer', value: '10248' });
    expect(chartEvidenceError(orders)).toBeUndefined();
    const transformed = transformOrdersMonthlyCountryCount(orders, { name: 'orders-monthly-country-count',
      orderIdColumn: 'OrderID', dateColumn: 'OrderDate', countryColumn: 'ShipCountry' });
    expect(transformed.ok && transformed.data).toMatchObject({ orderCount: 830, months: 23, countries: 21 });
    if (!transformed.ok) throw new Error(transformed.message);
    const race = prepareBarRace(transformed.data.recordset, { kind: 'bar-race', periodColumn: 'period', categoryColumn: 'category',
      measureColumn: 'value', onDuplicate: 'reject', mode: 'cumulative', topN: 21 });
    expect(race.ok && race.data.runtime).toBe('browser-sqlite');
    expect(race.ok && race.data.frames.at(-1)?.entries.reduce((total, entry) => total + entry.value, 0)).toBe(830);
    const countries = await execute(dispatcher, definition('northwind-country-counts-browser-sqlite'));
    expect(countries.recordset.rows).toHaveLength(21);
    expect(countries.recordset.rows.reduce((total, row) => total + Number(row[1].value), 0)).toBe(830);
    const billing = await execute(dispatcher, definition('chinook-billing-browser-sqlite'));
    expect(billing.recordset.rows).toHaveLength(10);
    expect(billing.recordset.rows[0][1]).toEqual({ type: 'string', value: 'Helena Holý' });
    expect(billing.recordset.rows[0][4]).toEqual({ type: 'integer', value: '4962' });
    expect(reads).toEqual(['/assets/showcase/northwind-source-rights.json', '/assets/showcase/northwind.sqlite',
      '/assets/showcase/northwind-source-rights.json', '/assets/showcase/northwind.sqlite',
      '/assets/showcase/chinook-source-rights.json', '/assets/showcase/chinook.sqlite']);
  });

  it('executes a different saved SQL ID, projection and row count with the same connection metadata', async () => {
    const report: IQueryDef = { id: 'my-team/invoice-totals', title: 'My invoice totals', connectionId: 'chinook-sqlite',
      request: { queryType: QueryType.SQL, text: 'SELECT InvoiceId, Total FROM Invoice ORDER BY InvoiceId LIMIT 3' } as ISqlQueryRequest,
      recordsets: [{ name: 'invoice totals', columns: [{ name: 'InvoiceId', type: 'integer' }, { name: 'Total', type: 'number' }] }] };
    const result = await execute(dispatcher, report);
    expect(result.recordset.rows).toHaveLength(3);
    expect(result.recordset.columns).toEqual(report.recordsets?.[0].columns);
    expect(chartEvidenceError(result)).toBeUndefined();
    const wrong = { ...report, recordsets: [{ name: 'bad', columns: [{ name: 'InvoiceId', type: 'string' as const }, { name: 'Total', type: 'number' as const }] }] };
    await expect(execute(dispatcher, wrong)).rejects.toThrow(/column types/);
    await expect(execute(dispatcher, { ...report, request: { queryType: QueryType.SQL, text: 'SELECT Total, InvoiceId FROM Invoice LIMIT 3' } as ISqlQueryRequest })).rejects.toThrow(/columns differ/);
  });

  it('decodes declared semantic types from real SQLite values without losing precision', async () => {
    const saved: IQueryDef = { id: 'typed-values', title: 'Typed values', connectionId: 'chinook-sqlite',
      request: { queryType: QueryType.SQL, text: "SELECT 1 AS enabled, 0 AS disabled, '2024-02-29' AS day, '2024-02-29T12:34:56.123456Z' AS instant, '12345678901234567890.00100' AS exact, 9223372036854775807 AS large, 7 AS count, NULL AS missing" } as ISqlQueryRequest,
      recordsets: [{ name: 'Typed values', columns: [
        { name: 'enabled', type: 'boolean' }, { name: 'disabled', type: 'bit' },
        { name: 'day', type: 'date' }, { name: 'instant', type: 'datetime' },
        { name: 'exact', type: 'decimal' }, { name: 'large', type: 'integer' },
        { name: 'count', type: 'number' }, { name: 'missing', type: 'boolean' },
      ] }] };
    const result = await execute(dispatcher, saved);
    expect(result.recordset.columns.map(({ type }) => type)).toEqual(['boolean', 'boolean', 'date', 'datetime', 'decimal', 'integer', 'number', 'boolean']);
    expect(result.recordset.rows[0]).toEqual([
      { type: 'boolean', value: true }, { type: 'boolean', value: false },
      { type: 'date', value: '2024-02-29' }, { type: 'datetime', value: '2024-02-29T12:34:56.123456Z' },
      { type: 'decimal', value: '12345678901234567890.00100' }, { type: 'integer', value: '9223372036854775807' },
      { type: 'number', value: 7 }, { type: 'null', value: null },
    ]);
  });

  it.each([
    ['boolean', '2'], ['bit', "'true'"], ['date', "'not-a-date'"], ['date', "'2023-02-29'"],
    ['datetime', "'2024-02-29 12:34:56'"], ['datetime', "'2024-02-30T12:34:56Z'"], ['datetime', "'2024-02-29T24:00:00Z'"],
    ['decimal', '0.1'], ['decimal', "'1e-5'"], ['integer', '0.1'], ['number', '9223372036854775807'],
  ] as const)('rejects incompatible %s values from the real worker: %s', async (type, expression) => {
    const saved: IQueryDef = { id: 'invalid-value', title: 'Invalid value', connectionId: 'chinook-sqlite',
      request: { queryType: QueryType.SQL, text: `SELECT ${expression} AS value` } as ISqlQueryRequest,
      recordsets: [{ name: 'Invalid value', columns: [{ name: 'value', type }] }] };
    await expect(execute(dispatcher, saved)).rejects.toThrow(/column types/);
  });

  it('keeps ordinary SQL usable without publisher rights but denies chart evidence', async () => {
    const connection = activeCatalog.connections[1];
    const fixture = connection.browserFixture;
    if (!fixture) throw new Error('Expected a browser fixture declaration.');
    activeCatalog.connections[1] = { ...connection, browserFixture: { url: fixture.url, bytes: fixture.bytes } };
    const result = await execute(dispatcher, definition('chinook-billing-browser-sqlite'));
    expect(result.recordset.rows).toHaveLength(10);
    expect(chartEvidenceError(result)).toMatch(/source-rights evidence/);
  });

  it.each([
    'https://attacker.example/forged-chinook-rights.json',
    '/assets/showcase/chinook-source-rights.json',
  ])('does not grant chart rights to a catalog-pinned forgery at %s', async (url) => {
    const forged = JSON.parse(read('chinook-source-rights.json').toString());
    forged.sourceRights[0].declaration = { spdx: 'CC0-1.0', url: 'https://attacker.example/fake-license' };
    forged.sourceRights[0].pins[0].revision = '0'.repeat(40);
    const bytes = Buffer.from(JSON.stringify(forged));
    const connection = activeCatalog.connections[1];
    activeCatalog.connections[1] = { ...connection, browserFixture: { ...connection.browserFixture,
      sourceRights: { url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } };
    const result = await execute(dispatcher, definition('chinook-billing-browser-sqlite'));
    expect(result.recordset.rows).toHaveLength(10);
    expect(result.sourceRights).toBeUndefined();
    expect(result.usedSourceIds).toBeUndefined();
    expect(chartEvidenceError(result)).toMatch(/source-rights evidence/);
    expect(result.limitations[0].policy).toMatch(/reviewed SQLite registry/);
    expect(reads).toEqual(['/assets/showcase/chinook.sqlite']);
  });

  it('does not transfer a shipped publication’s authority to a changed fixture pin', async () => {
    const connection = activeCatalog.connections[1];
    activeCatalog.connections[1] = { ...connection, fixtureSha256: '0'.repeat(64) };
    await expect(execute(dispatcher, definition('chinook-billing-browser-sqlite'))).rejects.toThrow(/fixture hash differs/);
    expect(reads).toEqual(['/assets/showcase/chinook.sqlite']);
  });

  it('rejects changed publication bytes, also when an environment the fixture does not serve was requested', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(1348))));
    await expect(execute(dispatcher, definition('chinook-billing-browser-sqlite'))).rejects.toThrow(/hash differs/);
    // Demo walk item 2: an incompatible environment falls back to the fixture's own one; the pin is still verified.
    await expect(dispatcher.execute({ projectRef: ref, definition: definition('chinook-billing-browser-sqlite'), environment: 'QA' })).rejects.toThrow(/hash differs/);
  });
});
