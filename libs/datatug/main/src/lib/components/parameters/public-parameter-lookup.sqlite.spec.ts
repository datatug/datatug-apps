import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { vi } from 'vitest';
import { ProjectQueryApiService } from '../../services/project/project-query-api.service';
import { GithubProjectReaderService } from '../../services/repo/github/github-project-reader.service';
import { ProjectAssetsReadService } from '../../services/project/project-assets-read.service';
import { DetectiveClientService } from '../../detective/detective-client.service';
import { executeBrowserSqlite, type BrowserSqliteWorkerRequest } from '../../queries/browser-sqlite-query.worker';
import { prepareDeclaredSqlBindings } from '../../queries/sql-bindings';
import type { IParameterDef } from '../../models/definition/parameter';
import { PublicParameterLookupService } from './public-parameter-lookup.service';
import { LOOKUP_SCHEMA_SQL, lookupRowsSql } from './parameter-lookup-model';

/**
 * The public browser lookup path against real SQLite (sql.js), end to end
 * through the ordinary query dispatcher: the schema probe, the generated
 * bounded SELECT, the bound @filter with LIKE … ESCAPE, LIMIT 51, and one
 * fixture download and one worker per dialog.
 */
const fixtures = resolve(process.cwd(), 'libs/datatug/main/src/lib/queries/test-fixtures/browser-sqlite');
const rights = readFileSync(resolve(fixtures, 'northwind-source-rights.json'));
const pin = JSON.parse(rights.toString()).sourceRights[0].pins[0];
const catalog = {
  connections: [{
    id: 'northwind-sqlite', dataset: 'northwind', storage: 'sqlite', environments: ['dev'], fixtureSha256: pin.sha256,
    browserFixture: {
      url: '/assets/showcase/northwind.sqlite', bytes: pin.bytes,
      sourceRights: { url: '/assets/showcase/northwind-source-rights.json', bytes: rights.length, sha256: createHash('sha256').update(rights).digest('hex') },
    },
  }],
};
const customer = {
  id: 'Customer',
  display: ['CompanyName'],
  fields: [
    { id: 'ID', type: 'string', mappings: [{ source: 'northwind', collection: 'Customers', column: 'CustomerID' }] },
    { id: 'CompanyName', type: 'string', mappings: [{ source: 'northwind', collection: 'Customers', column: 'CompanyName' }] },
  ],
};
const param: IParameterDef = { id: 'CustomerID', type: 'string', meta: { entity: 'Customer', field: 'ID' } };
const ref = { storeId: 'github.com', projectId: 'datatug-demo-project@datatug@demo-project-1' };

describe('public parameter lookup on real SQLite', () => {
  let SQL: SqlJsStatic;
  let reads: string[];
  let workers: number;
  let terminated: number;
  let statements: string[];

  beforeAll(async () => {
    SQL = await initSqlJs();
  });

  beforeEach(() => {
    reads = [];
    workers = 0;
    terminated = 0;
    statements = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        { provide: ProjectQueryApiService, useValue: {} },
        { provide: GithubProjectReaderService, useValue: { getRawJson: () => of(catalog) } },
        { provide: DetectiveClientService, useValue: {} },
        { provide: ProjectAssetsReadService, useValue: { entity: () => of(customer), entities: () => of([{ id: 'Customer' }]) } },
      ],
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input);
      reads.push(url.pathname);
      const bytes = readFileSync(resolve(process.cwd(), 'apps/datatug-app/src', url.pathname.slice(1)));
      return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
    }));
    vi.stubGlobal('Worker', class {
      onmessage?: (event: MessageEvent) => void;
      constructor() { workers++; }
      postMessage(request: BrowserSqliteWorkerRequest & { id?: number }): void {
        statements.push(request.sql);
        void executeBrowserSqlite(request, async () => SQL).then(
          (result) => this.onmessage?.({ data: { ok: true, result, id: request.id } } as MessageEvent),
          (error: Error) => this.onmessage?.({ data: { ok: false, error: error.message, id: request.id } } as MessageEvent));
      }
      terminate(): void { terminated++; this.onmessage = undefined; }
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('probes the key, lists 50 of 91 customers by key, filters at the source, and reuses one fixture and one worker', async () => {
    const service = TestBed.inject(PublicParameterLookupService);
    const context = { projectRef: ref, environment: 'dev', hostConnectionId: 'northwind-sqlite' };
    const sources = await service.sources(param, context);
    expect(sources).toHaveLength(1);
    const provider = service.provider(param, context, sources, customer);
    const signal = () => new AbortController().signal;

    const all = await provider.search(sources[0].id, '', signal());
    expect(all.unavailable).toBeUndefined();
    expect(all.rows).toHaveLength(50);
    expect(all.limited).toBe(true);
    expect(all.rows[0].map((cell) => cell.value)).toEqual(['ALFKI', 'Alfreds Futterkiste']);
    expect(statements[0]).toBe(LOOKUP_SCHEMA_SQL.replace('@collection', '?'));
    expect(statements[1]).toBe('SELECT "CustomerID", "CompanyName" FROM "Customers" ORDER BY "CustomerID" LIMIT 51');

    const bott = await provider.search(sources[0].id, 'bott', signal());
    expect(bott.rows.map((row) => row[0].value)).toEqual(['BOTTM']);
    expect(bott.limited).toBe(false);
    expect(statements[2]).toContain(`WHERE CAST("CustomerID" AS TEXT) LIKE ? ESCAPE '\\' OR CAST("CompanyName" AS TEXT) LIKE ? ESCAPE '\\'`);
    expect(statements[2]).not.toContain('bott');

    // "%" is matched literally: no Northwind customer contains one.
    const percent = await provider.search(sources[0].id, '%', signal());
    expect(percent.rows).toEqual([]);
    expect(percent.unavailable).toBeUndefined();

    expect(reads.filter((path) => path.endsWith('.sqlite'))).toEqual(['/assets/showcase/northwind.sqlite']);
    expect(reads.filter((path) => path.endsWith('.json'))).toEqual(['/assets/showcase/northwind-source-rights.json']);
    expect(workers).toBe(1);
    provider.dispose?.();
    expect(terminated).toBe(1);
    await expect(provider.search(sources[0].id, 'x', signal())).rejects.toThrow(/session is closed/u);
  });

  it('binds % and _ as literal characters, never as LIKE wildcards', async () => {
    const db = new SQL.Database();
    db.run('CREATE TABLE "Codes" ("Code" TEXT PRIMARY KEY, "Label" TEXT)');
    for (const [code, label] of [['A1', 'a%b'], ['A2', 'axb'], ['A3', 'a_b'], ['A4', 'ab'], ['A5', 'back\\slash']])
      db.run('INSERT INTO "Codes" VALUES (?, ?)', [code, label]);
    const fixture = db.export();
    db.close();
    const run = async (filter: string) => {
      const { sql, parameters, values } = lookupRowsSql('Codes', 'Code', ['Label'], filter);
      const named = new Map(parameters.map((p) => [p.id, String(values[p.id].value)] as const));
      const prepared = parameters.length
        ? prepareDeclaredSqlBindings(sql, parameters, named, parameters.map((p) => named.get(p.id) ?? null))
        : { sql, bindings: [] };
      const result = await executeBrowserSqlite({ sql: prepared.sql, fixture: fixture.slice(), bindings: prepared.bindings }, async () => SQL);
      return result?.rows.map((row) => row[0]);
    };
    expect(await run('%')).toEqual(['A1']);
    expect(await run('_')).toEqual(['A3']);
    expect(await run('\\')).toEqual(['A5']);
    expect(await run('A')).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
    expect(await run('')).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
  });
});
