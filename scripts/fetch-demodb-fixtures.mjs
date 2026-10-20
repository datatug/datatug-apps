// Fills the local DemoDB fixture directory that the Playwright lanes serve instead of the live demodb.dev hosts.
//
//   node scripts/fetch-demodb-fixtures.mjs
//
// Only the pinned SQLite files are fetched, into $DEMODB_FIXTURE_DIR/data (default <repo>/tmp/demodb-fixtures, git-ignored).
// They come from the public demo-db/<dataset> GitHub repositories at a PINNED COMMIT (raw.githubusercontent.com) and are
// accepted only when size and SHA-256 equal the pin in demo-sqlite-catalog.ts (or below). This script makes NO request to
// demodb.dev. The chunked AdventureWorks download (manifest + gzip parts, 35.4 MB) is fetched ONLY on request, because only
// one lane needs it: DEMODB_FIXTURE_ADVENTUREWORKS=1 adds it to the default set, =only fetches nothing else (see
// fetchAdventureWorks below). corpus.json and the dataset pages are committed in apps/datatug-app/e2e/fixtures/demodb (see
// provenance.json there).
//
// Request budget: a file that is already present and valid is NOT requested again, so a warm cache makes 0 requests and a
// cold cache one request per distinct file (5 datasets + the comparison candidate). No retries. A rate-limit answer from
// the source stops the script with exit code 3.
//
// On success (0 failures) it writes $DEMODB_FIXTURE_DIR/.complete; CI saves its cache only when that marker exists, so a
// partial set is never cached under the real key. It removes the marker first.
//
// DEMODB_FIXTURE_MIRROR=http://127.0.0.1:<port> fetches https://<host><path> from <mirror>/<host><path> instead. It exists
// to test this script without any network; SHA-256 pins are still enforced.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { exitOnRateLimit, fetchOnce, requestCount } from './demodb-http.mjs';

const adventureWorks = process.env['DEMODB_FIXTURE_ADVENTUREWORKS'] ?? '';
const adventureWorksOnly = adventureWorks === 'only';
const catalogUrl = new URL('../libs/datatug/main/src/lib/queries/demo-sqlite-catalog.ts', import.meta.url);
const { demoSqliteCatalog, demoSqliteDatasetIds, isLargeDemoSqliteDataset } = await import(catalogUrl.href);

const root = resolve(process.env['DEMODB_FIXTURE_DIR'] || new URL('../tmp/demodb-fixtures', import.meta.url).pathname);
const mirror = process.env['DEMODB_FIXTURE_MIRROR']?.replace(/\/$/, '');
const marker = join(root, '.complete');
rmSync(marker, { force: true });

/** Where each dataset's SQLite lives: demo-db/<repo> at the commit that last changed the file, and the path in the repo. */
const githubSources = {
  chinook: { commit: '184f9ee22101f8f56016c7963d18a406beffa013', path: 'artifacts/data/chinook.sqlite' },
  northwind: { commit: '8e9755ae30bb99f15601a7dd3833199f59d37035', path: 'artifacts/northwind.sqlite' },
  pubs: { commit: '34501946b0478b7e2ae13c15b4c57019109b5edc', path: 'artifacts/pubs.sqlite' },
  sakila: { commit: '0cb13fd76b2ce590f68efa99a6fbf7effcf6e4ce', path: 'artifacts/sakila.sqlite' },
  employees: { commit: '4759bc2b7936626c9ac1ad1e92fd6128365e11ac', path: 'artifacts/employees.sqlite' },
};
const githubUrl = (repo, { commit, path }) => `https://raw.githubusercontent.com/demo-db/${repo}/${commit}/${path}`;

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
    // https://chinook.demodb.dev/data/compare/<sha256>.sqlite, the comparison candidate of public-sqlite-comparison.ts
    path: 'compare/3369d25729dea9e21facc7226aee3d5247fa0f3d8d4be4678aa9247fd064845f.sqlite',
    url: githubUrl('chinook', {
      commit: '50e68f41b81d18798078aa17e5ee98eca01c4013',
      path: 'fixtures/compare/chinook-candidate-3369d25729dea9e21facc7226aee3d5247fa0f3d8d4be4678aa9247fd064845f.sqlite',
    }),
    sha256: '3369d25729dea9e21facc7226aee3d5247fa0f3d8d4be4678aa9247fd064845f',
    bytes: 1007616,
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
  if (adventureWorksOnly) continue;
  if (isLargeDemoSqliteDataset(entry) || entry.source === 'chunked') {
    console.log(`skipped data/${id}.sqlite (${entry.source}; served as gzip parts, see DEMODB_FIXTURE_ADVENTUREWORKS)`);
    continue;
  }
  await fill(`data/${id}.sqlite`, join(root, 'data', `${id}.sqlite`), githubUrl(id, githubSources[id]), (body) => {
    if (body.length !== entry.bytes) throw new Error(`${body.length} bytes, pinned ${entry.bytes}`);
    if (sha256(body) !== entry.sha256) throw new Error('SHA-256 differs from the catalog pin');
  });
}
for (const file of adventureWorksOnly ? [] : extraFiles) {
  await fill(`data/${file.path}`, join(root, 'data', file.path), file.url, (body) => {
    if (body.length !== file.bytes) throw new Error(`${body.length} bytes, pinned ${file.bytes}`);
    if (sha256(body) !== file.sha256) throw new Error('SHA-256 differs from the pin');
  });
}

/**
 * AdventureWorks, as the live site serves it: demo-db/websites scripts/build-hosts.mjs re-publishes the provider's gzip chunks
 * (artifacts/adventureworks.sqlite.gz.part-000N) as content-addressed parts plus a `demodb-chunked-export/v1` manifest. This builds
 * the same manifest from the same provider bytes, with the same naming (`<file>.gz.<sha256[:16]>.part-<n>`). Accepted only when
 * every part is the size and SHA-256 the provider's published corpus.json lists, the joined gzip equals the corpus pin, and the
 * UNPACKED file equals the catalog pin (size and SHA-256). Skipped when the manifest and parts on disk already verify.
 */
const adventureWorksProvider = {
  commit: '5028a27189b487d6fd8025fafc1307aada707fd2',
  parts: ['artifacts/adventureworks.sqlite.gz.part-0001', 'artifacts/adventureworks.sqlite.gz.part-0002'],
};
async function fetchAdventureWorks() {
  const entry = demoSqliteCatalog.adventureworks;
  const corpus = JSON.parse(readFileSync(new URL('../apps/datatug-app/e2e/fixtures/demodb/corpus.json', import.meta.url), 'utf8'));
  const pin = corpus.databases.find((db) => db.localId === 'adventureworks').exports.find((item) => item.format === 'sqlite' && !item.table);
  if (pin.decodedSha256 !== entry.sha256 || pin.decodedBytes !== entry.bytes || pin.bytes !== entry.transferBytes) {
    throw new Error('corpus.json and the catalog disagree about the AdventureWorks pins');
  }
  const dataDir = join(root, 'data');
  const manifestPath = join(dataDir, 'adventureworks.sqlite.parts.json');
  const verify = (pieces) => {
    const joined = Buffer.concat(pieces);
    if (joined.length !== pin.bytes) throw new Error(`gzip is ${joined.length} bytes, pinned ${pin.bytes}`);
    if (sha256(joined) !== pin.sha256) throw new Error('joined gzip SHA-256 differs from the corpus pin');
    const decoded = gunzipSync(joined);
    if (decoded.length !== entry.bytes) throw new Error(`unpacked file is ${decoded.length} bytes, pinned ${entry.bytes}`);
    if (sha256(decoded) !== entry.sha256) throw new Error('unpacked SHA-256 differs from the catalog pin');
    return joined;
  };
  const partName = (bytes, n) => `adventureworks.sqlite.gz.${sha256(bytes).slice(0, 16)}.part-${n + 1}`;
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      verify(manifest.parts.map((part) => readFileSync(join(dataDir, part.path))));
      console.log('cached  data/adventureworks.sqlite.parts.json (+ parts)');
      return;
    } catch {
      console.log('stale   data/adventureworks.sqlite.parts.json: refetching once');
    }
  }
  const pieces = [];
  for (const path of adventureWorksProvider.parts) {
    pieces.push(await download(githubUrl('adventureworks', { commit: adventureWorksProvider.commit, path })));
  }
  verify(pieces);
  const parts = pieces.map((bytes, n) => ({ path: partName(bytes, n), bytes: bytes.length, sha256: sha256(bytes) }));
  pieces.forEach((bytes, n) => write(join(dataDir, parts[n].path), bytes));
  const manifest = {
    format: 'demodb-chunked-export/v1',
    file: 'adventureworks.sqlite',
    compression: 'gzip',
    bytes: pin.bytes,
    sha256: pin.sha256,
    uncompressedSha256: entry.sha256,
    parts,
  };
  write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`fetched data/adventureworks.sqlite.parts.json (${parts.length} parts, ${pin.bytes} gzip bytes, unpacked SHA-256 verified) from raw.githubusercontent.com`);
}
if (adventureWorks === '1' || adventureWorksOnly) {
  try {
    await fetchAdventureWorks();
  } catch (error) {
    exitOnRateLimit(error);
    failures += 1;
    console.error(`FAIL    AdventureWorks gzip parts: ${error.message}`);
  }
}

console.log(`demodb fixtures: ${root}`);
console.log(`demodb fixtures: ${requestCount()} network request(s) (none to demodb.dev), ${failures} failure(s)`);
if (failures === 0) write(marker, 'ok\n');
process.exitCode = failures === 0 ? 0 : 1;
