#!/usr/bin/env node
// Exercise the delivered browser reader against a pinned local Git snapshot.
// This transport cannot publish a catalog or execute a database query.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const usage =
  'node tools/verify-meaninggraph-snapshot.mjs --catalog /absolute/registry/catalog.json --source-sha <40 lowercase hex> --catalog-sha256 <64 lowercase hex>';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const repository = 'https://github.com/meaninggraph/registry';
const readerPath =
  'libs/datatug/main/src/lib/logical-models/native-data-models-reader.ts';
const limit = 5 * 1024 * 1024;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  assert(
    Number(process.versions.node.split('.')[0]) >= 24,
    'Node 24 or newer is required.',
  );
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    assert(
      ['--catalog', '--source-sha', '--catalog-sha256'].includes(key) &&
        value &&
        !options.has(key),
      usage,
    );
    options.set(key, value);
  }
  const catalogPath = options.get('--catalog');
  const sourceSha = options.get('--source-sha');
  const catalogSha = options.get('--catalog-sha256');
  assert(
    options.size === 3 &&
      isAbsolute(catalogPath) &&
      basename(catalogPath) === 'catalog.json',
    usage,
  );
  assert(
    /^[0-9a-f]{40}$/.test(sourceSha),
    'An exact full source Git SHA is required.',
  );
  assert(
    /^[0-9a-f]{64}$/.test(catalogSha),
    'An explicit catalog byte SHA256 is required.',
  );

  // Disable caller Git overrides, replace objects and lazy object fetching.
  const gitEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toUpperCase().startsWith('GIT_'),
    ),
  );
  Object.assign(gitEnv, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_NO_LAZY_FETCH: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
  });
  const root = realpathSync(dirname(catalogPath));
  const git = (...argv) =>
    execFileSync('git', ['--no-replace-objects', '-C', root, ...argv], {
      env: gitEnv,
      maxBuffer: limit + 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const version = /^git version (\d+)\.(\d+)/.exec(git('--version').toString());
  assert(
    version &&
      (Number(version[1]) > 2 ||
        (Number(version[1]) === 2 && Number(version[2]) >= 45)),
    'Git >=2.45 is required to prevent lazy network fetching.',
  );
  assert.equal(
    git('rev-parse', '--show-toplevel').toString().trim(),
    root,
    'catalog.json must be at the repository root.',
  );
  assert.equal(
    git('cat-file', '-t', sourceSha).toString().trim(),
    'commit',
    'The source SHA must name a commit object.',
  );
  assert.equal(
    git('rev-parse', 'HEAD').toString().trim(),
    sourceSha,
    'The local checkout must be at the supplied source SHA.',
  );

  function safePath(path) {
    assert(
      typeof path === 'string' &&
        path.length <= 1024 &&
        /^[A-Za-z0-9_.$/-]+$/.test(path),
      'Unsafe declared snapshot path.',
    );
    assert(
      path
        .split('/')
        .every(
          (part) =>
            part &&
            part !== '.' &&
            part !== '..' &&
            part.toLowerCase() !== '.git',
        ),
      'Unsafe declared snapshot path.',
    );
    return path;
  }
  const checked = new Map();
  function readPinned(path) {
    safePath(path);
    if (checked.has(path)) return checked.get(path);
    let target = root;
    const parts = path.split('/');
    for (const [index, part] of parts.entries()) {
      target = join(target, part);
      const stat = lstatSync(target);
      assert(
        !stat.isSymbolicLink(),
        `Symlinks are not snapshot files: ${path}`,
      );
      assert(
        index === parts.length - 1 ? stat.isFile() : stat.isDirectory(),
        `Not a regular snapshot file: ${path}`,
      );
    }
    const actual = realpathSync(target);
    assert.equal(
      actual,
      target,
      `Snapshot path changed through a symlink: ${path}`,
    );
    assert(
      !relative(root, actual).startsWith(`..${sep}`) &&
        !isAbsolute(relative(root, actual)),
      'Snapshot path escapes its root.',
    );
    const fd = openSync(
      target,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    let bytes;
    try {
      const stat = fstatSync(fd);
      assert(
        stat.isFile() && stat.size <= limit,
        `Snapshot file is not a bounded regular file: ${path}`,
      );
      bytes = readFileSync(fd);
    } finally {
      closeSync(fd);
    }
    const entry = git('ls-tree', '-z', sourceSha, '--', path).toString();
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t([^\0]+)\0$/.exec(
      entry,
    );
    assert(
      match && match[3] === path,
      `Not a tracked regular file of the exact source commit: ${path}`,
    );
    assert(
      bytes.equals(git('cat-file', 'blob', match[2])),
      `Local bytes differ from the supplied source commit: ${path}`,
    );
    checked.set(path, bytes);
    return bytes;
  }

  const catalogBytes = readPinned('catalog.json');
  assert.equal(
    hash(catalogBytes),
    catalogSha,
    'Catalog pin SHA256 differs from exact local bytes.',
  );
  const catalog = JSON.parse(catalogBytes);
  assert.equal(catalog.revision_index?.path, 'revisions/index.json');
  const index = JSON.parse(readPinned('revisions/index.json'));
  const semanticReceipts = new Set(
    index.revisions
      .filter((row) => row.kind === 'meaning')
      .map((row) => row.path),
  );
  const semanticDefinitions = new Set(
    catalog.graphs.map((row) => row.definition.path),
  );
  const modelReceipts = new Set(
    index.revisions
      .filter((row) => row.kind === 'model')
      .map((row) => row.path),
  );
  const declared = new Set([
    'catalog.json',
    'revisions/index.json',
    ...modelReceipts,
  ]);
  const prefix = `https://raw.githubusercontent.com/meaninggraph/registry/${sourceSha}/`;
  let requests = 0,
    transportBytes = 0,
    semanticReceiptReads = 0;
  const fetched = new Set();
  const localFetch = async (input, init) => {
    init?.signal?.throwIfAborted();
    const url =
      typeof input === 'string' ? input : (input.url ?? String(input));
    assert(
      url.startsWith(prefix),
      'Only the fixed immutable shared-registry URL is supported.',
    );
    const path = safePath(url.slice(prefix.length));
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.credentials, 'omit');
    if (semanticReceipts.has(path)) semanticReceiptReads++;
    assert(
      !semanticReceipts.has(path) && !semanticDefinitions.has(path),
      'Logical model browsing attempted to read semantic evidence.',
    );
    assert(
      declared.has(path),
      `Reader requested an undeclared snapshot path: ${path}`,
    );
    const bytes = readPinned(path);
    if (modelReceipts.has(path)) {
      // These are only transport declarations; the delivered reader still
      // verifies identities, byte digests, original ASTs and module closure.
      const receipt = JSON.parse(bytes);
      for (const ref of [
        receipt.definition,
        receipt.source_record,
        receipt.acquisition_record,
        ...receipt.files,
      ]) {
        if (ref) declared.add(safePath(ref.artifactPath ?? ref.path));
      }
    }
    requests++;
    transportBytes += bytes.length;
    fetched.add(path);
    return new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });
  };

  const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const cache = mkdtempSync(join(tmpdir(), 'meaninggraph-snapshot-'));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error(
      'Network fetch is disabled for this local acceptance check.',
    );
  };
  let server;
  try {
    const { createServer } = await import('vite');
    server = await createServer({
      root: appRoot,
      configFile: false,
      envFile: false,
      appType: 'custom',
      cacheDir: cache,
      logLevel: 'error',
      server: { middlewareMode: true, hmr: false, watch: null },
    });
    const { listNativeDataModels, readNativeDataModel } =
      await server.ssrLoadModule(`/${readerPath}`);
    const pin = {
      repository,
      revision: sourceSha,
      path: 'catalog.json',
      sha256: catalogSha,
    };
    const signal = new AbortController().signal;
    const selected = await listNativeDataModels(pin, localFetch, signal);
    assert.equal(
      selected.length,
      catalog.models.length,
      'Not every selected catalog model was listed.',
    );
    const results = [];
    for (const model of selected) {
      const detail = await readNativeDataModel(
        pin,
        model.id,
        model.commit,
        localFetch,
        signal,
      );
      assert.equal(detail.revisionId, model.revisionId);
      assert.equal(detail.commit, model.commit);
      if (model.id === 'chinook') {
        assert.deepEqual(detail.records.map((record) => record.name).sort(), [
          'Album',
          'Artist',
          'Customer',
          'Employee',
          'Genre',
          'Invoice',
          'InvoiceLine',
          'MediaType',
          'Playlist',
          'PlaylistTrack',
          'Track',
        ]);
        const artistId = detail.records
          .find((record) => record.name === 'Album')
          ?.fields.find((field) => field.name === 'ArtistId');
        assert.equal(
          artistId?.type,
          'record Artist',
          'Chinook Album.ArtistId must reference Artist.',
        );
        assert(
          artistId.origin?.includes(
            `record Artist => ${detail.address}@${detail.commit}`,
          ),
          'Chinook Artist reference lost its exact source identity.',
        );
      }
      results.push({
        id: detail.id,
        source_sha: detail.commit,
        revision_id: detail.revisionId,
        records: detail.records.length,
        fields: detail.records.reduce(
          (sum, record) => sum + record.fields.length,
          0,
        ),
        components: detail.components.length,
        enums: detail.enums.length,
      });
    }
    assert.equal(semanticReceiptReads, 0);
    console.log(
      JSON.stringify(
        {
          status: 'PASS',
          transport: 'LOCAL_FIXED_URL_MOCK_FETCH',
          publication:
            'NOT_CHECKED; this does not establish a published catalog pin',
          source_git_sha: sourceSha,
          catalog_sha256: catalogSha,
          reader_sha256: hash(readFileSync(join(appRoot, readerPath))),
          selected_models: results.length,
          models: results,
          transport_requests: requests,
          transport_bytes: transportBytes,
          unique_files: fetched.size,
          semantic_receipt_reads: semanticReceiptReads,
          network_fetches: 0,
          database_queries: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await server?.close();
    } finally {
      globalThis.fetch = previousFetch;
      rmSync(cache, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(
    `MeaningGraph LOCAL snapshot verification failed: ${error.message}`,
  );
  process.exitCode = 1;
});
