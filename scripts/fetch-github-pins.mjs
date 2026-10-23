#!/usr/bin/env node
// Shallow checkouts of the GitHub commits the e2e suites read (apps/datatug-app/e2e/github-pins.json), one directory per
// commit: <GITHUB_PINS_DIR or <repo>/tmp/github-checkouts>/<owner>/<repo>/<sha>. A checkout already present (its HEAD is
// the pinned commit and its completion marker is written) is reused with no network at all; CI restores the directory
// from actions/cache, keyed on the manifest, so most runs fetch nothing. Pins sharing a repo and SHA share one checkout,
// fetched once into a private scratch directory and renamed into place, so concurrent runs never trip over each other.
//
// Each missing commit costs ONE fetch of exactly that commit (`git fetch --depth 1 origin <sha>`): no history, no other
// branch. Lazy blobs (`--filter=blob:none`) are not used: the fake serves every file of the tree, so a checkout would
// fetch them all anyway in a second round trip (measured slower, see apps/datatug-app/e2e/README.md "GitHub checkouts").
//
// Usage: node scripts/fetch-github-pins.mjs [--only <id>[,<id>]] [--print <id>]
//   --print <id>   prints the checkout directory of that pin (fetching it first if needed) and nothing else on stdout.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

const githubUrl = (repo) => `https://github.com/${repo}.git`;

/** Fetches one commit into a private scratch directory next to `dir`, then renames it into place. */
async function fetchInto(dir, pin, remoteUrl) {
  mkdirSync(dirname(dir), { recursive: true });
  // The scratch directory is private to this process, so concurrent runs (another globalSetup, a CI step) never share it.
  const tmp = `${dir}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    mkdirSync(tmp);
    await git(tmp, 'init', '--quiet');
    await git(tmp, 'remote', 'add', 'origin', remoteUrl(pin.repo));
    // GitHub serves any reachable commit by its full SHA (uploadpack.allowReachableSHA1InWant), including PR-only commits.
    await git(tmp, 'fetch', '--quiet', '--depth', '1', '--no-tags', 'origin', pin.sha);
    await git(tmp, 'checkout', '--quiet', '--detach', 'FETCH_HEAD');
    const head = (await git(tmp, 'rev-parse', 'HEAD')).stdout.trim();
    if (head !== pin.sha) throw new Error(`${pin.id}: fetched ${head}, expected ${pin.sha}`);
    writeFileSync(join(tmp, MARKER), `${pin.repo}@${pin.sha}\n`);
    // Keep the marker out of `git status` / `git ls-files --others` of the checkout.
    writeFileSync(join(tmp, '.git/info/exclude'), `${MARKER}\n`, { flag: 'a' });
    // Publish atomically: a reader sees the whole checkout or none of it. A stale or half-written `dir` (no marker, or
    // dirty) is removed first; if another process publishes between that removal and our rename, its checkout wins.
    rmSync(dir, { recursive: true, force: true });
    try {
      renameSync(tmp, dir);
    } catch (error) {
      if (!(await isComplete(dir, pin.sha))) throw error;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Ensures one checkout (a distinct repo + SHA). Returns how it was obtained and how long it took. */
async function ensure(pin, remoteUrl) {
  const dir = checkoutDir(pin);
  const started = performance.now();
  if (await isComplete(dir, pin.sha)) return { dir, how: 'cached', ms: performance.now() - started };
  await fetchInto(dir, pin, remoteUrl);
  return { dir, how: 'fetched', ms: performance.now() - started };
}

/**
 * Ensures the checkout of every pin named by `ids` (all pins when omitted). Pins that point at the same repo and SHA share
 * ONE checkout, fetched once: the result has one entry per pin, sharing `dir`, `how` and `ms` with its siblings.
 * `options.pins` and `options.remoteUrl` exist for tests (a local repository instead of GitHub).
 */
export async function fetchPins(ids, options = {}) {
  const { pins: manifest = readPins(), remoteUrl = githubUrl } = options;
  const pins = manifest.filter((pin) => !ids || ids.includes(pin.id));
  if (ids) for (const id of ids) if (!pins.some((pin) => pin.id === id)) throw new Error(`Unknown GitHub pin ${id}`);
  const started = performance.now();
  const byDir = new Map();
  for (const pin of pins) if (!byDir.has(checkoutDir(pin))) byDir.set(checkoutDir(pin), pin);
  const outcomes = new Map(await Promise.all([...byDir].map(async ([dir, pin]) => [dir, await ensure(pin, remoteUrl)])));
  const results = pins.map((pin) => ({ pin, ...outcomes.get(checkoutDir(pin)) }));
  return { results, checkouts: byDir.size, ms: performance.now() - started };
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
    const { results, checkouts, ms } = await fetchPins(only);
    const log = print ? console.error : console.log;
    for (const r of results) log(`[github-pins] ${r.pin.id} ${r.pin.repo}@${r.pin.sha.slice(0, 8)}: ${r.how} in ${(r.ms / 1000).toFixed(2)}s`);
    log(`[github-pins] ${results.length} pin(s) on ${checkouts} checkout(s) ready in ${(ms / 1000).toFixed(2)}s (${new Set(results.filter((r) => r.how === 'fetched').map((r) => r.dir)).size} fetched) under ${pinsDir()}`);
    if (print) console.log(results[0].dir);
  } catch (error) {
    console.error(`[github-pins] ${error.stderr || error.message}`);
    process.exit(1);
  }
}
