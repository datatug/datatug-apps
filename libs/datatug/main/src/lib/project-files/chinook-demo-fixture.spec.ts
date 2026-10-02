// The recorded demo project in the new formats (fixtures/chinook-demo.README.md). The later tasks that read it
// (G-A3b, G-A4a to G-A4c, G-R2, G-R3) depend on three things this spec pins: the files are exactly the recorded
// ones; the two new files pass the schemas and the validators; and the saved query's golden result can be
// computed from the fixture alone.
import Ajv2020 from 'ajv/dist/2020';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  validateHttpsJsonCatalog,
  parseHttpsJsonCatalog,
} from './https-json-catalog';
import { expandUrlTemplate } from './project-address-rules';
import { parsePreparedQuestions } from './prepared-questions';
import catalogSchema from './schemas/https-json-catalog.schema.json';
import questionsSchema from './schemas/prepared-questions.schema.json';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, 'fixtures', 'chinook-demo');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const json = <T = unknown>(path: string): T => JSON.parse(read(path)) as T;

const walk = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [relative(root, path)];
  });

interface ManifestEntry {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly origin: string;
}
const manifest = JSON.parse(
  readFileSync(join(here, 'fixtures', 'chinook-demo.manifest.json'), 'utf8'),
) as {
  fixture: string;
  files: ManifestEntry[];
};

const INVOICE_PATH = 'external/chinookdb.com/data/json/chinook.Invoice.json';
const INVOICE_SHA256 =
  '88eb7faede360988e9c0f8f8d107e5093db5e712141de14d868f8947b43c373c';
const MIRROR_COMMIT = '0b6bb6ba22f680c9fb2fea9ec8107a8638dd8dc4';

describe('the manifest', () => {
  it('lists every file of the fixture, and nothing else', () => {
    expect(walk(root).sort()).toEqual(manifest.files.map((file) => file.path));
  });

  it.each(manifest.files)('$path is as recorded', (entry) => {
    const bytes = readFileSync(join(root, entry.path));
    expect({
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }).toEqual({
      bytes: entry.bytes,
      sha256: entry.sha256,
    });
    expect(entry.origin).not.toBe('');
  });

  it('holds the 22 files of design 4.3, rows 1 to 22 (row 23 is the GitHub API call)', () => {
    // 1 project, 1 prepared questions, 2 query, 3 web, 11 columns, 1 entity, 2 geo tables, 1 Invoice file.
    expect(manifest.files).toHaveLength(22);
    const dbmodels = manifest.files.filter((file) =>
      file.path.startsWith('dbmodels/chinook/main/tables/'),
    );
    expect(dbmodels).toHaveLength(11);
  });

  it('records the Invoice file the project declares', () => {
    const entry = manifest.files.find((file) => file.path === INVOICE_PATH);
    expect(entry).toMatchObject({ bytes: 115781, sha256: INVOICE_SHA256 });
    expect(entry?.origin).toContain(MIRROR_COMMIT);
  });
});

describe('ai/prepared-questions.json', () => {
  const text = read('ai/prepared-questions.json');
  const queryIds = new Set(
    walk(root)
      .filter((path) => /^queries\/.+\.query\.json$/.test(path))
      .map((path) =>
        path.replace(/^queries\//, '').replace(/\.query\.json$/, ''),
      ),
  );

  it('passes the validator, and its query is a saved query of the fixture', () => {
    expect([...queryIds]).toContain('sales/chinook-sales-per-capita');
    const result = parsePreparedQuestions(text, { knownQueryIds: queryIds });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.questions).toHaveLength(1);
      expect(result.value.questions[0]).toMatchObject({
        id: 'sales-per-capita',
        followUps: ['insight'],
      });
      expect(Object.keys(result.value.questions[0].question)).toEqual([
        'en',
        'ru',
      ]);
    }
  });

  it('passes the JSON Schema', () => {
    const validate = new Ajv2020({ strict: true }).compile(questionsSchema);
    expect(validate(JSON.parse(text))).toBe(true);
  });

  it('names a query whose id matches the file the project holds', () => {
    expect(
      json<{ id: string }>('queries/sales/chinook-sales-per-capita.query.json')
        .id,
    ).toBe('chinook-sales-per-capita');
  });
});

describe('the web environment', () => {
  it('names the two catalogs the saved query reads, and each has its file', () => {
    const environment = json<{
      id: string;
      dbServers: { driver: string; catalogs: string[] }[];
    }>('web/web.env.json');
    expect(environment.id).toBe('web');
    expect(environment.dbServers).toEqual([
      { driver: 'https-json', catalogs: ['chinook'] },
      { driver: 'ingitdb', catalogs: ['geo'] },
    ]);
    const query = json<{ federation: { tables: { database: string }[] } }>(
      'queries/sales/chinook-sales-per-capita.query.json',
    );
    const databases = [
      ...new Set(query.federation.tables.map((table) => table.database)),
    ].sort();
    expect(databases).toEqual(
      environment.dbServers.flatMap((server) => server.catalogs).sort(),
    );
    for (const catalog of databases)
      expect(walk(root)).toContain(
        `web/catalogs/${catalog}/${catalog}.db.json`,
      );
  });

  it("keeps the geo catalog the same as the local environment's", () => {
    expect(json('web/catalogs/geo/geo.db.json')).toEqual({
      driver: 'ingitdb',
      path: 'data/geo',
    });
  });

  it('lists no `web` environment in datatug-project.json, which the CLI finds by directory, not by that list', () => {
    const project = json<{ id: string; environments: { id: string }[] }>(
      'datatug-project.json',
    );
    expect(project.id).toBe('datatug-demo-project');
    expect(
      project.environments.map((environment) => environment.id),
    ).not.toContain('web');
  });
});

describe('web/catalogs/chinook/chinook.db.json, the https-json catalog', () => {
  const text = read('web/catalogs/chinook/chinook.db.json');

  it('passes the validator as a trusted project', () => {
    const result = parseHttpsJsonCatalog(text, { trust: 'trusted' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.label).toBe('Chinook (chinookdb.com)');
      expect(result.value.homepage).toBe('https://chinookdb.com');
      expect(result.value.keys).toEqual({ Invoice: 'InvoiceId' });
      expect(result.value.fallbackUrlTemplate).toContain(`@${MIRROR_COMMIT}/`);
      expect(expandUrlTemplate(result.value.urlTemplate, 'Invoice')).toBe(
        'https://chinookdb.com/data/json/chinook.Invoice.json',
      );
    }
  });

  it('passes the JSON Schema', () => {
    expect(
      new Ajv2020({ strict: true }).compile(catalogSchema)(JSON.parse(text)),
    ).toBe(true);
  });

  it("would be refused for any address outside the app's prefixes, if the project were trusted", () => {
    const document = {
      ...(JSON.parse(text) as object),
      urlTemplate: 'https://example.org/{table}.json',
    };
    expect(validateHttpsJsonCatalog(document, { trust: 'trusted' }).ok).toBe(
      false,
    );
  });

  it('declares the checksum of the Invoice file recorded beside it', () => {
    const result = parseHttpsJsonCatalog(text, { trust: 'trusted' });
    const bytes = readFileSync(join(root, INVOICE_PATH));
    expect(result.ok && result.value.sha256['Invoice']).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
  });
});

describe('the data the saved query reads', () => {
  interface Row {
    key: string;
    data: Record<string, unknown>;
  }
  const invoices =
    json<{ InvoiceId: number; BillingCountry: string; Total: number }[]>(
      INVOICE_PATH,
    );
  const aliases = json<Row[]>('data/geo/.web/country_aliases.json');
  const populations = json<Row[]>('data/geo/.web/population_wb.json');

  it('has 412 invoices keyed by the declared column, 24 aliases and 216 populations, each as { key, data }', () => {
    expect(invoices).toHaveLength(412);
    expect(new Set(invoices.map((invoice) => invoice.InvoiceId)).size).toBe(
      412,
    );
    expect(aliases).toHaveLength(24);
    expect(populations).toHaveLength(216);
    for (const row of [...aliases, ...populations])
      expect(Object.keys(row)).toEqual(['key', 'data']);
    expect(aliases.map((row) => row.key)).toEqual(
      [...aliases.map((row) => row.key)].sort(),
    );
  });

  it('gives the golden result of design 4.8: 24 countries, Ireland 8.32 first, USA 1.53 at rank 17', () => {
    const population = new Map(
      populations.map((row) => [row.data['country'], row.data]),
    );
    const countryOf = new Map(
      aliases.map((row) => [row.data['alias'], row.data['country']]),
    );
    const totals = new Map<string, number>();
    for (const invoice of invoices) {
      if (!countryOf.has(invoice.BillingCountry)) continue;
      totals.set(
        invoice.BillingCountry,
        (totals.get(invoice.BillingCountry) ?? 0) + invoice.Total,
      );
    }
    const ranked = [...totals]
      .map(([country, total]) => {
        const people = population.get(countryOf.get(country))?.[
          'population'
        ] as number;
        return { country, total, perMillion: (total / people) * 1_000_000 };
      })
      .sort((a, b) => b.perMillion - a.perMillion);

    expect(ranked).toHaveLength(24);
    expect(ranked[0]).toMatchObject({ country: 'Ireland' });
    expect(ranked[0].total).toBeCloseTo(45.62, 2);
    expect(ranked[0].perMillion).toBeCloseTo(8.32, 2);
    expect(ranked[1].country).toBe('Czech Republic');
    expect(ranked[1].perMillion).toBeCloseTo(8.29, 2);
    expect(ranked[2].perMillion).toBeCloseTo(7.37, 2);
    expect(ranked[16]).toMatchObject({ country: 'USA' });
    expect(ranked[16].perMillion).toBeCloseTo(1.53, 2);
    expect(
      invoices.filter((invoice) => countryOf.has(invoice.BillingCountry)),
    ).toHaveLength(412);
  });
});
