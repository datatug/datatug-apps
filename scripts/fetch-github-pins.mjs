#!/usr/bin/env node
// Shallow checkouts of the GitHub commits the e2e suites read (apps/datatug-app/e2e/github-pins.json), one directory per
// commit: <GITHUB_PINS_DIR or <repo>/tmp/github-checkouts>/<owner>/<repo>/<sha>. A checkout already present (its HEAD is
// the pinned commit and its completion marker is written) is reused with no network at all; CI restores the directory
// from actions/cache, keyed on the manifest, so most runs fetch nothing.
//
// Each missing commit costs ONE fetch of exactly that commit (`git fetch --depth 1 origin <sha>`): no history, no other
// branch. Lazy blobs (`--filter=blob:none`) are not used: the fake serves every file of the tree, so a checkout would
// fetch them all anyway in a second round trip (measured slower, see apps/datatug-app/e2e/README.md "GitHub checkouts").
//
// Usage: node scripts/fetch-github-pins.mjs [--only <id>[,<id>]] [--print <id>]
//   --print <id>   prints the checkout directory of that pin (fetching it first if needed) and nothing else on stdout.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'apps/datatug-app/e2e/github-pins.json');
const MARKER = '.datatug-pin-complete';

export const pinsDir = () => resolve(process.env.GITHUB_PINS_DIR || join(root, 'tmp/github-checkouts'));
export const readPins = () => JSON.parse(readFileSync(manifestPath, 'utf8')).pins;
export const checkoutDir = (pin) => join(pinsDir(), ...pin.repo.split('/'), pin.sha);

const git = (dir, ...args) => run('git', ['-C', dir, '-c', 'advice.detachedHead=false', ...args], { maxBuffer: 64 * 1024 * 1024 });

async function isComplete(dir, sha) {
  if (!existsSync(join(dir, MARKER))) return false;
  try {
    // A checkout is read-only: one that was written to (or is mid-fetch) is fetched again rather than served.
    if ((await git(dir, 'rev-parse', 'HEAD')).stdout.trim() !== sha) return false;
    return (await git(dir, 'status', '--porcelain', '--untracked-files=all')).stdout.trim() === '';
  } catch {
    return false;
  }
}

/** Ensures one pin is checked out. Returns how it was obtained and how long it took. */
async function ensure(pin) {
  const dir = checkoutDir(pin);
  const started = performance.now();
  if (await isComplete(dir, pin.sha)) return { pin, dir, how: 'cached', ms: performance.now() - started };
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await git(dir, 'init', '--quiet');
  await git(dir, 'remote', 'add', 'origin', `https://github.com/${pin.repo}.git`);
  // GitHub serves any reachable commit by its full SHA (uploadpack.allowReachableSHA1InWant), including PR-only commits.
  await git(dir, 'fetch', '--quiet', '--depth', '1', '--no-tags', 'origin', pin.sha);
  await git(dir, 'checkout', '--quiet', '--detach', 'FETCH_HEAD');
  const head = (await git(dir, 'rev-parse', 'HEAD')).stdout.trim();
  if (head !== pin.sha) throw new Error(`${pin.id}: fetched ${head}, expected ${pin.sha}`);
  writeFileSync(join(dir, MARKER), `${pin.repo}@${pin.sha}\n`);
  // Keep the marker out of `git status` / `git ls-files --others` of the checkout.
  writeFileSync(join(dir, '.git/info/exclude'), `${MARKER}\n`, { flag: 'a' });
  return { pin, dir, how: 'fetched', ms: performance.now() - started };
}

export async function fetchPins(ids) {
  const pins = readPins().filter((pin) => !ids || ids.includes(pin.id));
  if (ids) for (const id of ids) if (!pins.some((pin) => pin.id === id)) throw new Error(`Unknown GitHub pin ${id}`);
  const started = performance.now();
  const results = await Promise.all(pins.map(ensure));
  return { results, ms: performance.now() - started };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const print = option('--print');
  const only = print ? [print] : option('--only')?.split(',').filter(Boolean);
  try {
    const { results, ms } = await fetchPins(only);
    const log = print ? console.error : console.log;
    for (const r of results) log(`[github-pins] ${r.pin.id} ${r.pin.repo}@${r.pin.sha.slice(0, 8)}: ${r.how} in ${(r.ms / 1000).toFixed(2)}s`);
    log(`[github-pins] ${results.length} pin(s) ready in ${(ms / 1000).toFixed(2)}s (${results.filter((r) => r.how === 'fetched').length} fetched) under ${pinsDir()}`);
    if (print) console.log(results[0].dir);
  } catch (error) {
    console.error(`[github-pins] ${error.stderr || error.message}`);
    process.exit(1);
  }
}
