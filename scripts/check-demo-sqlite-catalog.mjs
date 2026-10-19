// Checks libs/datatug/main/src/lib/queries/demo-sqlite-catalog.ts.
//
//   node scripts/check-demo-sqlite-catalog.mjs           offline: shape of every pin
//   node scripts/check-demo-sqlite-catalog.mjs --online  also downloads every dataset and compares
//                                                        HTTP status, decoded size and SHA-256
//                                                        (a `chunked` dataset: its manifest, then each
//                                                        part in turn, checked as the app checks them)
//
// The catalog is TypeScript; Node 24 strips its types on import.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const catalogUrl = new URL('../libs/datatug/main/src/lib/queries/demo-sqlite-catalog.ts', import.meta.url);
const { demoSqliteCatalog, demoSqliteDatasetIds } = await import(catalogUrl.href);

let failures = 0;
for (const id of demoSqliteDatasetIds) {
  const entry = demoSqliteCatalog[id];
  try {
    assert.equal(entry.dataset, id);
    assert.ok(entry.source === 'file' || entry.source === 'chunked', 'source');
    assert.equal(
      entry.url,
      `https://${id}.demodb.dev/data/${id}.sqlite${entry.source === 'chunked' ? '.parts.json' : ''}`,
    );
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes > 0);
    console.log(`ok   ${id} pin`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${id} pin: ${error.message}`);
  }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Downloads a chunked dataset as the app does: manifest, then parts one at a time, each verified. */
async function checkChunked(entry) {
  const response = await fetch(entry.url);
  assert.equal(response.status, 200, 'manifest HTTP status');
  const manifest = await response.json();
  assert.equal(manifest.format, 'demodb-chunked-export/v1', 'manifest format');
  assert.equal(manifest.compression, 'gzip', 'manifest compression');
  const parts = [];
  for (const [index, part] of manifest.parts.entries()) {
    const partResponse = await fetch(new URL(part.path, entry.url));
    assert.equal(partResponse.status, 200, `part ${index + 1} HTTP status`);
    const bytes = Buffer.from(await partResponse.arrayBuffer());
    assert.equal(bytes.byteLength, part.bytes, `part ${index + 1} bytes`);
    assert.equal(sha256(bytes), part.sha256, `part ${index + 1} sha256`);
    parts.push(bytes);
  }
  const joined = Buffer.concat(parts);
  assert.equal(joined.byteLength, manifest.bytes, 'joined gzip bytes');
  assert.equal(sha256(joined), manifest.sha256, 'joined gzip sha256');
  const decoded = gunzipSync(joined);
  assert.equal(decoded.byteLength, entry.bytes, 'decoded bytes');
  assert.equal(sha256(decoded), entry.sha256, 'sha256');
  console.log(`ok   ${entry.dataset} live ${entry.url} (${manifest.parts.length} parts, ${joined.byteLength} gzip bytes)`);
}

if (process.argv.includes('--online')) {
  for (const id of demoSqliteDatasetIds) {
    const entry = demoSqliteCatalog[id];
    try {
      if (entry.source === 'chunked') {
        await checkChunked(entry);
        continue;
      }
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
