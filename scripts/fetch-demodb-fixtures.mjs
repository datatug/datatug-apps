// Fills the local DemoDB fixture directory that the Playwright lanes serve instead of the live demodb.dev hosts.
//
//   node scripts/fetch-demodb-fixtures.mjs [--include-large]
//
// Only the pinned SQLite files are fetched, into $DEMODB_FIXTURE_DIR/data (default <repo>/tmp/demodb-fixtures, git-ignored). They
// come from the public demo-db/<dataset> GitHub repositories (raw.githubusercontent.com, branch main) and are accepted only when
// size and SHA-256 equal the pin in demo-sqlite-catalog.ts. This script makes NO request to demodb.dev. (corpus.json and the dataset
// pages are committed in apps/datatug-app/e2e/fixtures/demodb, see provenance.json there.)
//
// Request budget: a file that is already present and valid is NOT requested again, so a warm cache makes 0 requests and a cold cache
// one request per distinct file (5; the 126.8 MB AdventureWorks file only with --include-large). No retries. HTTP 429 stops the
// script with exit code 3.
//
// DEMODB_FIXTURE_MIRROR=http://127.0.0.1:<port> fetches https://<host><path> from <mirror>/<host><path> instead. It exists to test
// this script without any network; SHA-256 pins are still enforced.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { exitOnRateLimit, fetchOnce, requestCount } from './demodb-http.mjs';

const catalogUrl = new URL('../libs/datatug/main/src/lib/queries/demo-sqlite-catalog.ts', import.meta.url);
const { demoSqliteCatalog, demoSqliteDatasetIds, isLargeDemoSqliteDataset } = await import(catalogUrl.href);

const root = resolve(process.env['DEMODB_FIXTURE_DIR'] || new URL('../tmp/demodb-fixtures', import.meta.url).pathname);
const includeLarge = process.argv.includes('--include-large') || !!process.env['DATATUG_E2E_ADVENTUREWORKS'];
const mirror = process.env['DEMODB_FIXTURE_MIRROR']?.replace(/\/$/, '');

/** Where the pinned file of a dataset lives in its public GitHub repository (demo-db/<dataset>, branch main). */
const githubSource = (id) =>
  `https://raw.githubusercontent.com/demo-db/${id}/main/artifacts/${id === 'chinook' ? 'data/' : ''}${id}.sqlite`;
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const source = (url) => {
  if (!mirror) return url;
  const parsed = new URL(url);
  return `${mirror}/${parsed.host}${parsed.pathname}`;
};

function write(path, body) {
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.partial`;
  writeFileSync(partial, body);
  renameSync(partial, path);
}

async function download(url) {
  const response = await fetchOnce(source(url));
  if (response.status !== 200) throw new Error(`${url}: HTTP ${response.status}`);
  // Node's fetch decodes Content-Encoding: gzip, as browsers do.
  return Buffer.from(await response.arrayBuffer());
}

/** Other pinned files the app lanes download (not part of the catalog): path under data/, source, SHA-256 (also the file's identity). */
const extraFiles = [
  {
    path: 'compare/3369d25729dea9e21facc7226aee3d5247fa0f3d8d4be4678aa9247fd064845f.sqlite',
    url: 'https://raw.githubusercontent.com/demo-db/chinook/main/fixtures/compare/chinook-candidate-3369d25729dea9e21facc7226aee3d5247fa0f3d8d4be4678aa9247fd064845f.sqlite',
    sha256: '3369d25729dea9e21facc7226aee3d5247fa0f3d8d4be4678aa9247fd064845f',
    bytes: 1007616, // https://chinook.demodb.dev/data/compare/<sha256>.sqlite, the comparison candidate of public-sqlite-comparison.ts
  },
];

let failures = 0;
const fill = async (label, path, url, check) => {
  if (existsSync(path)) {
    try {
      check(readFileSync(path));
      console.log(`cached  ${label}`);
      return;
    } catch {
      console.log(`stale   ${label}: refetching once`);
    }
  }
  try {
    const body = await download(url);
    check(body);
    write(path, body);
    console.log(`fetched ${label} (${body.length} bytes) from ${new URL(url).host}`);
  } catch (error) {
    exitOnRateLimit(error);
    failures += 1;
    console.error(`FAIL    ${label}: ${error.message}`);
  }
};

for (const id of demoSqliteDatasetIds) {
  const entry = demoSqliteCatalog[id];
  if (isLargeDemoSqliteDataset(entry) && !includeLarge) {
    console.log(`skipped data/${id}.sqlite (large; --include-large or DATATUG_E2E_ADVENTUREWORKS=1)`);
    continue;
  }
  await fill(`data/${id}.sqlite`, join(root, 'data', `${id}.sqlite`), githubSource(id), (body) => {
    if (body.length !== entry.bytes) throw new Error(`${body.length} bytes, pinned ${entry.bytes}`);
    if (sha256(body) !== entry.sha256) throw new Error('SHA-256 differs from the catalog pin');
  });
}
for (const file of extraFiles) {
  await fill(`data/${file.path}`, join(root, 'data', file.path), file.url, (body) => {
    if (body.length !== file.bytes) throw new Error(`${body.length} bytes, pinned ${file.bytes}`);
    if (sha256(body) !== file.sha256) throw new Error('SHA-256 differs from the pin');
  });
}

console.log(`demodb fixtures: ${root}`);
console.log(`demodb fixtures: ${requestCount()} network request(s), ${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
