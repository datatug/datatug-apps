// Checks libs/datatug/main/src/lib/demo-postgresql/demo-postgresql-catalog.ts.
//
//   node scripts/check-demo-postgresql-catalog.mjs           offline: shape of every entry
//   node scripts/check-demo-postgresql-catalog.mjs --online  (MANUAL ONLY, never in CI) also compares the catalog with
//     - DemoDB's live registry and PostgreSQL activation switch (demo-db/websites, config/databases.json and
//       config/postgresql-api.json on main), so a dataset added or a switch turned off there fails here;
//     - the live descriptor of every edition on cloud.openvaultdb.com: PostgreSQL engine, the table count and
//       sample table of the catalog, and nothing writable (read-only is a server fact, not a UI choice).
//
// The catalog is TypeScript with no imports; Node 24 strips its types on import.
import assert from 'node:assert/strict';
import { exitOnRateLimit, fetchOnce } from './demodb-http.mjs';

const catalogUrl = new URL('../libs/datatug/main/src/lib/demo-postgresql/demo-postgresql-catalog.ts', import.meta.url);
const { demoPostgresqlCatalog, demoPostgresqlDatasetIds, DEMO_POSTGRESQL_BASE_URL } = await import(catalogUrl.href);
const WEBSITES = 'https://raw.githubusercontent.com/demo-db/websites/main/config';

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    exitOnRateLimit(error); // HTTP 429 stops the whole script at once; nothing is retried
    failures += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
};

for (const id of demoPostgresqlDatasetIds) {
  await check(`${id} entry`, () => {
    const entry = demoPostgresqlCatalog[id];
    assert.equal(entry.dataset, id);
    assert.equal(entry.databaseId, `${id}-postgresql`);
    assert.equal(entry.baseUrl, 'https://cloud.openvaultdb.com');
    assert.equal(entry.descriptorUrl, `https://cloud.openvaultdb.com/v1/databases/${id}-postgresql`);
    assert.equal(entry.route, `/demo/ovdb/${id}-postgresql`);
    assert.ok(Number.isSafeInteger(entry.tableCount) && entry.tableCount > 0);
    assert.ok(entry.sampleTable);
  });
}

if (process.argv.includes('--online')) {
  const getJson = async (url) => {
    const response = await fetchOnce(url);
    assert.equal(response.status, 200, `${url}: HTTP status`);
    return response.json();
  };
  await check('DemoDB registry lists the same datasets', async () => {
    const registry = await getJson(`${WEBSITES}/databases.json`);
    assert.deepEqual(registry.databases.map((d) => d.id).sort(), [...demoPostgresqlDatasetIds].sort());
  });
  await check('DemoDB PostgreSQL activation switch is on', async () => {
    const switchFile = await getJson(`${WEBSITES}/postgresql-api.json`);
    assert.equal(switchFile.format, 'demodb-postgresql-api/v1');
    assert.equal(switchFile.publicApiVerified, true);
    assert.ok(switchFile.copies.includes(new URL(DEMO_POSTGRESQL_BASE_URL).host));
  });
  for (const id of demoPostgresqlDatasetIds) {
    const entry = demoPostgresqlCatalog[id];
    await check(`${id} live descriptor ${entry.descriptorUrl}`, async () => {
      // A cold start takes up to ~6 s and a mount may answer 503 database_unavailable for a moment.
      let descriptor;
      for (let attempt = 0; attempt < 3 && !descriptor; attempt++) {
        const response = await fetchOnce(entry.descriptorUrl);
        if (response.status === 503) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
        else {
          assert.equal(response.status, 200, 'HTTP status');
          descriptor = await response.json();
        }
      }
      assert.ok(descriptor, 'descriptor (503 database_unavailable on every attempt)');
      assert.equal(descriptor.id, entry.databaseId);
      assert.equal(descriptor.engine, 'postgres');
      assert.equal(descriptor.collections.length, entry.tableCount, 'table count');
      const names = Object.values(descriptor.schemas.collections).map((c) => c.source.name);
      assert.ok(names.includes(entry.sampleTable), `sample table ${entry.sampleTable}`);
      for (const capability of ['write', 'delete', 'reset']) assert.equal(descriptor.capabilities[capability], false, capability);
      assert.equal(descriptor.capabilities.tugql, true, 'tugql');
    });
  }
}

process.exitCode = failures === 0 ? 0 : 1;
