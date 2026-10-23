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

test('a project address is served the SPA shell as typed, so its %2F is never decoded by the assets (founder 2026-10-23)', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.main, './apps/datatug-app/worker/project-shell.mjs');
  assert.equal(config.assets.binding, 'ASSETS');
  assert.deepEqual(config.assets.run_worker_first, ['/project/*']);
  assert.equal(config.assets.not_found_handling, 'single-page-application');

  const { default: worker } = await import('../apps/datatug-app/worker/project-shell.mjs');
  const asked = [];
  const env = {
    ASSETS: {
      fetch: async (request) => {
        asked.push(request.method + ' ' + request.url);
        return new Response('<!doctype html>shell', { status: 200, headers: { 'content-type': 'text/html' } });
      },
    },
  };
  for (const path of [
    '/project/github.com/o/r@feature%2Fx/demo-project-1',
    '/project/github.com/o/r/d/-/query/a%2Fb?id=a%2Fb',
  ]) {
    asked.length = 0;
    const response = await worker.fetch(new Request('https://datatug.app' + path), env);
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), '<!doctype html>shell');
    // The shell is asked for, never the typed path, so nothing is normalised or redirected.
    assert.deepEqual(asked, ['GET https://datatug.app/']);
  }
  asked.length = 0;
  await worker.fetch(new Request('https://datatug.app/project/x', { method: 'POST', body: 'x' }), env);
  assert.deepEqual(asked, ['POST https://datatug.app/project/x']);
});
