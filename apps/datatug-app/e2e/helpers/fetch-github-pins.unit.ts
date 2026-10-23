import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

// scripts/fetch-github-pins.mjs against a local repository instead of GitHub. GITHUB_PINS_DIR is read per call, so each test
// points it at its own directory.
const script = join(import.meta.dirname, '../../../../scripts/fetch-github-pins.mjs');
const { fetchPins } = (await import(script)) as {
  fetchPins: (
    ids: string[] | undefined,
    options: { pins: Pin[]; remoteUrl: (repo: string) => string },
  ) => Promise<{ results: { pin: Pin; dir: string; how: string }[]; checkouts: number }>;
};
type Pin = { id: string; repo: string; sha: string };

const scratch = mkdtempSync(join(tmpdir(), 'github-pins-unit-'));
const origin = join(scratch, 'origin');
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
let shaA = '';
let shaB = '';
const remoteUrl = () => `file://${origin}`;
const pin = (id: string, sha: string): Pin => ({ id, repo: 'acme/demo', sha });
const pinsDir = (name: string) => {
  const dir = join(scratch, name);
  process.env['GITHUB_PINS_DIR'] = dir;
  return dir;
};

before(() => {
  mkdirSync(origin);
  git(origin, 'init', '--quiet');
  git(origin, 'config', 'user.email', 't@example.com');
  git(origin, 'config', 'user.name', 'T');
  git(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  writeFileSync(join(origin, 'a.txt'), 'a');
  git(origin, 'add', '.');
  git(origin, 'commit', '--quiet', '-m', 'a');
  shaA = git(origin, 'rev-parse', 'HEAD');
  writeFileSync(join(origin, 'a.txt'), 'b');
  git(origin, 'commit', '--quiet', '-am', 'b');
  shaB = git(origin, 'rev-parse', 'HEAD');
});
after(() => rmSync(scratch, { recursive: true, force: true }));

test('three pins on one SHA share a single checkout, fetched once, with no leftovers', async () => {
  const dir = pinsDir('one-sha');
  const pins = [pin('p1', shaA), pin('p2', shaA), pin('p3', shaA)];
  const { results, checkouts } = await fetchPins(undefined, { pins, remoteUrl });
  assert.equal(checkouts, 1);
  assert.equal(results.length, 3);
  assert.deepEqual(new Set(results.map((r) => r.dir)), new Set([join(dir, 'acme', 'demo', shaA)]));
  assert.ok(results.every((r) => r.how === 'fetched'));
  assert.equal(git(results[0].dir, 'rev-parse', 'HEAD'), shaA);
  assert.deepEqual(readdirSync(join(dir, 'acme', 'demo')), [shaA], 'no scratch directory is left behind');
  const again = await fetchPins(undefined, { pins, remoteUrl });
  assert.ok(again.results.every((r) => r.how === 'cached'));
});

test('two pins on different SHAs get their own checkout each', async () => {
  const dir = pinsDir('two-shas');
  const { results, checkouts } = await fetchPins(undefined, { pins: [pin('p1', shaA), pin('p2', shaB)], remoteUrl });
  assert.equal(checkouts, 2);
  assert.equal(git(join(dir, 'acme', 'demo', shaA), 'rev-parse', 'HEAD'), shaA);
  assert.equal(git(join(dir, 'acme', 'demo', shaB), 'rev-parse', 'HEAD'), shaB);
  assert.notEqual(results[0].dir, results[1].dir);
});

test('--only style selection fetches just the named pin and rejects unknown ids', async () => {
  const dir = pinsDir('only');
  const pins = [pin('p1', shaA), pin('p2', shaB)];
  const { results } = await fetchPins(['p2'], { pins, remoteUrl });
  assert.deepEqual(results.map((r) => r.pin.id), ['p2']);
  assert.ok(!existsSync(join(dir, 'acme', 'demo', shaA)));
  await assert.rejects(fetchPins(['nope'], { pins, remoteUrl }), /Unknown GitHub pin nope/);
});

test('concurrent runs on the same SHA both succeed (no "File exists")', async () => {
  const dir = pinsDir('concurrent');
  const pins = [pin('p1', shaA), pin('p2', shaA)];
  await Promise.all([fetchPins(undefined, { pins, remoteUrl }), fetchPins(undefined, { pins, remoteUrl })]);
  assert.equal(git(join(dir, 'acme', 'demo', shaA), 'rev-parse', 'HEAD'), shaA);
  assert.deepEqual(readdirSync(join(dir, 'acme', 'demo')), [shaA]);
});

test('a half-written checkout (no marker) is replaced', async () => {
  const dir = pinsDir('stale');
  mkdirSync(join(dir, 'acme', 'demo', shaA), { recursive: true });
  const { results } = await fetchPins(undefined, { pins: [pin('p1', shaA)], remoteUrl });
  assert.equal(results[0].how, 'fetched');
  assert.equal(git(results[0].dir, 'rev-parse', 'HEAD'), shaA);
});
