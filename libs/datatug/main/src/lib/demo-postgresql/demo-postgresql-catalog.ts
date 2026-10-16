// The hosted, read-only PostgreSQL editions of the DemoDB datasets, opened in DataTug through the public
// OpenVaultDB server (never Neon directly): https://cloud.openvaultdb.com/v1/databases/<dataset>-postgresql.
//
// One source of truth for the PostgreSQL editions: the dataset list and the per-edition facts below (table count
// and a sample table, verified live on 2026-10-16); every entry is derived from them. Consumers:
//   - the DataTug route `/demo/ovdb/<dataset>-postgresql` (DemoOvdbPageComponent);
//   - the DemoDB.dev "Explore PostgreSQL in DataTug" link, which opens `route`;
//   - the demo project's connection catalogue (`datatug-demo-project`, demo-project-1/connections/demo-db.json),
//     whose `<dataset>-postgresql` entries point at `descriptorUrl`.
//
// `demo-postgresql-catalog.spec.ts` checks this file against vendored copies of DemoDB's registry
// (`config/databases.json`) and PostgreSQL activation switch (`config/postgresql-api.json`) of demo-db/websites;
// `scripts/check-demo-postgresql-catalog.mjs --online` compares them with the live files and the live API.
//
// Self-contained on purpose (no imports), so `scripts/check-demo-postgresql-catalog.mjs` can load it with Node's
// type stripping; the spec asserts it lists the same datasets and titles as demo-sqlite-catalog.ts.

export const DEMO_POSTGRESQL_BASE_URL = 'https://cloud.openvaultdb.com';
/** What the UI calls this way of opening a dataset. */
export const DEMO_POSTGRESQL_LABEL =
  'Hosted PostgreSQL (read-only via OpenVaultDB)';

export type DemoPostgresqlDatabaseId = `${DemoDatasetId}-postgresql`;

export interface DemoPostgresqlCatalogEntry {
  readonly dataset: DemoDatasetId;
  readonly title: string;
  /** The OVDB database id (`chinook-postgresql`) and the last segment of the DataTug route. */
  readonly databaseId: DemoPostgresqlDatabaseId;
  readonly baseUrl: typeof DEMO_POSTGRESQL_BASE_URL;
  /** `GET` it for the descriptor (tables, columns, capabilities). */
  readonly descriptorUrl: string;
  /** The DataTug route that opens the edition (a path on datatug.app). */
  readonly route: string;
  /** Tables and views the descriptor lists. */
  readonly tableCount: number;
  /** A small table with rows, to open in the table view. */
  readonly sampleTable: string;
}

const editions: Readonly<
  Record<
    DemoDatasetId,
    { readonly tableCount: number; readonly sampleTable: string }
  >
> = {
  chinook: { tableCount: 11, sampleTable: 'Artist' },
  northwind: { tableCount: 30, sampleTable: 'Categories' },
  pubs: { tableCount: 12, sampleTable: 'jobs' },
  sakila: { tableCount: 23, sampleTable: 'actor' },
  adventureworks: { tableCount: 82, sampleTable: 'Production.Culture' },
  employees: { tableCount: 8, sampleTable: 'departments' },
};

export const demoPostgresqlDatasetIds = ['chinook', 'northwind', 'pubs', 'sakila', 'adventureworks', 'employees'] as const;

export type DemoDatasetId = (typeof demoPostgresqlDatasetIds)[number];

const titles: Readonly<Record<DemoDatasetId, string>> = {
  chinook: 'Chinook',
  northwind: 'Northwind',
  pubs: 'Pubs',
  sakila: 'Sakila',
  adventureworks: 'AdventureWorks',
  employees: 'Employees',
};

export const demoPostgresqlCatalog: Readonly<
  Record<DemoDatasetId, DemoPostgresqlCatalogEntry>
> = Object.fromEntries(
  demoPostgresqlDatasetIds.map((dataset) => {
    const databaseId: DemoPostgresqlDatabaseId = `${dataset}-postgresql`;
    const entry: DemoPostgresqlCatalogEntry = {
      dataset,
      title: titles[dataset],
      databaseId,
      baseUrl: DEMO_POSTGRESQL_BASE_URL,
      descriptorUrl: `${DEMO_POSTGRESQL_BASE_URL}/v1/databases/${databaseId}`,
      route: `/demo/ovdb/${databaseId}`,
      ...editions[dataset],
    };
    return [dataset, entry];
  }),
) as Record<DemoDatasetId, DemoPostgresqlCatalogEntry>;

/** The edition a route segment names (case-insensitive, `<dataset>-postgresql`), if any. */
export function findDemoPostgresqlEdition(
  databaseId: string,
): DemoPostgresqlCatalogEntry | undefined {
  const id = databaseId.toLowerCase();
  return Object.values(demoPostgresqlCatalog).find(
    (entry) => entry.databaseId === id,
  );
}
