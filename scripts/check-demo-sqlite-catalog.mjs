// Checks libs/datatug/main/src/lib/queries/demo-sqlite-catalog.ts.
//
//   node scripts/check-demo-sqlite-catalog.mjs           offline: shape of every pin
//   node scripts/check-demo-sqlite-catalog.mjs --online  also downloads every file and compares
//                                                        HTTP status, decoded size and SHA-256
//
// The catalog is TypeScript; Node 24 strips its types on import.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const catalogUrl = new URL('../libs/datatug/main/src/lib/queries/demo-sqlite-catalog.ts', import.meta.url);
const { demoSqliteCatalog, demoSqliteDatasetIds } = await import(catalogUrl.href);

let failures = 0;
for (const id of demoSqliteDatasetIds) {
  const entry = demoSqliteCatalog[id];
  try {
    assert.equal(entry.dataset, id);
    assert.equal(entry.url, `https://${id}.demodb.dev/data/${id}.sqlite`);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes > 0);
    console.log(`ok   ${id} pin`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${id} pin: ${error.message}`);
  }
}

if (process.argv.includes('--online')) {
  for (const id of demoSqliteDatasetIds) {
    const entry = demoSqliteCatalog[id];
    try {
      // Node's fetch decodes Content-Encoding: gzip, as browsers do.
      const response = await fetch(entry.url);
      assert.equal(response.status, 200, 'HTTP status');
      const hash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of response.body) {
        hash.update(chunk);
        bytes += chunk.byteLength;
      }
      assert.equal(bytes, entry.bytes, 'decoded bytes');
      assert.equal(hash.digest('hex'), entry.sha256, 'sha256');
      console.log(`ok   ${id} live ${entry.url} (${bytes} bytes, ${response.headers.get('content-encoding') ?? 'identity'})`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${id} live ${entry.url}: ${error.message}`);
    }
  }
}

process.exitCode = failures === 0 ? 0 : 1;
