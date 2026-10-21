// Prints the host names that CI must never reach, one per line (used by .github/actions/block-demodb): the DemoDB apex, www,
// ovdb and one sub-domain per dataset of the catalog (so a dataset added to the catalog is blocked too), and the public
// OpenVaultDB API (openvaultdb.com, www, cloud). The live PostgreSQL workflow (e2e-postgres-ovdb.yml) does not use the block.
// /etc/hosts has no wildcards; the Chromium wildcard (helpers/demodb-config.ts) and the guard's route are the other layers.
const catalogUrl = new URL('../libs/datatug/main/src/lib/queries/demo-sqlite-catalog.ts', import.meta.url);
const { demoSqliteDatasetIds } = await import(catalogUrl.href);
const extra = ['www', 'ovdb', 'api', 'cloud', 'data', 'embed', 'static', 'compare'];
const hosts = new Set(['demodb.dev', ...extra.map((s) => `${s}.demodb.dev`), ...demoSqliteDatasetIds.map((id) => `${id}.demodb.dev`)]);
// every hosted flavour of a dataset (<id>-postgresql etc.) is served below the same sub-domains; list the common ones
for (const id of demoSqliteDatasetIds) for (const flavour of ['postgresql', 'mysql', 'bigquery', 'ingitdb']) hosts.add(`${id}-${flavour}.demodb.dev`);
for (const host of ['openvaultdb.com', 'www.openvaultdb.com', 'cloud.openvaultdb.com']) hosts.add(host);
for (const host of [...hosts].sort()) console.log(host);
