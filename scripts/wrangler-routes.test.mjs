import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.nx', '.angular', 'coverage']);
const CROSS_ORIGIN_ISOLATION = /cross-origin-(opener|embedder)-policy/i;

async function findHeaderFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        found.push(...(await findHeaderFiles(new URL(`${entry.name}/`, directory))));
      }
    } else if (entry.name === '_headers') {
      found.push(new URL(entry.name, directory));
    }
  }
  return found;
}

// Parses a Cloudflare _headers file into [{ pattern, headers: Map<lowercase name, value> }].
function parseHeaderRules(source) {
  const rules = [];
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), headers: new Map() });
    } else {
      const separator = line.indexOf(':');
      const rule = rules.at(-1);
      if (rule && separator > 0) {
        rule.headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
      }
    }
  }
  return rules;
}

function patternMatches(pattern, path) {
  const expression = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${expression}$`).test(path);
}

const headerFiles = await findHeaderFiles(new URL('../', import.meta.url));

test('the app worker preserves DataTug and serves the Incidentius app hostname', async () => {
  const source = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(source);

  assert.deepEqual(config.routes, [
    { pattern: 'datatug.app', custom_domain: true },
    { pattern: 'app.incidentius.com', custom_domain: true },
  ]);
});

// demo.datatug.app is a zone redirect rule of datatug.app (datatug/websites, apps/app/scripts/zone-rules.mjs, group `demo`), not a Worker:
// the account is at the Free plan's 100 Workers. The app Worker's routes above leave it out; this keeps a redirect Worker from coming back.
test('demo.datatug.app has no Worker of its own (it is the zone rule demo:redirect)', async () => {
  const gone = (path) => readFile(new URL(path, import.meta.url)).then(() => false, (e) => e.code === 'ENOENT');
  assert.ok(await gone('../workers/demo-redirect/wrangler.jsonc'), 'workers/demo-redirect is retired');
  assert.ok(await gone('../.github/workflows/deploy-demo-redirect.yml'), 'deploy-demo-redirect.yml is retired');
});

test('the app serves no cross-origin isolation headers (opfs-sahpool needs neither COOP nor COEP)', async () => {
  const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.doesNotMatch(wrangler, CROSS_ORIGIN_ISOLATION);

  for (const file of headerFiles) {
    assert.doesNotMatch(
      await readFile(file, 'utf8'),
      CROSS_ORIGIN_ISOLATION,
      `${file.pathname} must not set COOP or COEP`,
    );
  }
});

test('.wasm assets are never given a Content-Type other than application/wasm', async () => {
  for (const file of headerFiles) {
    for (const rule of parseHeaderRules(await readFile(file, 'utf8'))) {
      const contentType = rule.headers.get('content-type');
      if (contentType === undefined || !patternMatches(rule.pattern, '/engine/sql-wasm.wasm')) continue;
      assert.equal(
        contentType,
        'application/wasm',
        `${file.pathname}: rule "${rule.pattern}" serves .wasm as ${contentType}`,
      );
    }
  }
});
