// Fills the local DemoDB fixture directory that the demo-sqlite Playwright lane serves instead of the live hosts.
//
//   node scripts/fetch-demodb-fixtures.mjs [--include-large]
//
// Layout of $DEMODB_FIXTURE_DIR (default <repo>/tmp/demodb-fixtures, git-ignored):
//   data/<dataset>.sqlite   pinned files; kept only when their SHA-256 and size match the catalog pin
//   corpus.json             the DemoDB registry (https://demodb.dev/corpus.json)
//   pages/<dataset>.html    the dataset home page (https://<dataset>.demodb.dev/), used by the cross-site journey
//
// Request budget: a file that is already present and valid is NOT requested again, so a warm cache makes 0 requests
// and a cold cache makes exactly one request per distinct file (5 SQLite files + 1 registry + 6 pages = 12; the
// 126.8 MB AdventureWorks file only with --include-large). No retries. HTTP 429 stops the script with exit code 3.
//
// DEMODB_FIXTURE_MIRROR=http://127.0.0.1:<port> fetches https://<host><path> from <mirror>/<host><path> instead.
// It exists to test this script without touching the live hosts; SHA-256 pins are still enforced.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { exitOnRateLimit, fetchOnce, requestCount } from './demodb-http.mjs';

const catalogUrl = new URL('../libs/datatug/main/src/lib/queries/demo-sqlite-catalog.ts', import.meta.url);
const { demoSqliteCatalog, demoSqliteDatasetIds, isLargeDemoSqliteDataset } = await import(catalogUrl.href);

const root = resolve(process.env['DEMODB_FIXTURE_DIR'] || new URL('../tmp/demodb-fixtures', import.meta.url).pathname);
const includeLarge = process.argv.includes('--include-large') || !!process.env['DATATUG_E2E_ADVENTUREWORKS'];
const mirror = process.env['DEMODB_FIXTURE_MIRROR']?.replace(/\/$/, '');

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
    console.log(`fetched ${label} (${body.length} bytes) from ${url}`);
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
  await fill(`data/${id}.sqlite`, join(root, 'data', `${id}.sqlite`), entry.url, (body) => {
    if (body.length !== entry.bytes) throw new Error(`${body.length} bytes, pinned ${entry.bytes}`);
    if (sha256(body) !== entry.sha256) throw new Error('SHA-256 differs from the catalog pin');
  });
}
await fill('corpus.json', join(root, 'corpus.json'), 'https://demodb.dev/corpus.json', (body) => {
  if (!Array.isArray(JSON.parse(body.toString('utf8')).databases)) throw new Error('no databases[]');
});
for (const id of demoSqliteDatasetIds) {
  await fill(`pages/${id}.html`, join(root, 'pages', `${id}.html`), `https://${id}.demodb.dev/`, (body) => {
    if (!/hero-actions/.test(body.toString('utf8'))) throw new Error('not a DemoDB dataset page (no .hero-actions)');
  });
}

console.log(`demodb fixtures: ${root}`);
console.log(`demodb fixtures: ${requestCount()} request(s) to the live hosts, ${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
