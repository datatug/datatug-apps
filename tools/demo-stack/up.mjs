#!/usr/bin/env node
/**
 * The local demo stack: everything the DataTug.app /demo route needs, brought up with one command.
 *
 *   pnpm demo:up      start (or attach to) the processes below, print a status table and the demo URL
 *   pnpm demo:down    stop exactly the processes `demo:up` started
 *   pnpm demo:e2e     demo:up, run the Playwright `demo` project against it, demo:down if it started them
 *   pnpm demo:status  show the table without starting anything
 *
 * Processes (this slice):
 *   1. OVDB, serving the demo project's `chinook` and `geo` databases   127.0.0.1:50511  always its own
 *   2. a CORS shim in front of it, 127.0.0.1:50501, the port the saved query names (a busy port is an error,
 *      never a silent move). ovdb 0.19.0 refuses the browser's OVDB-Page-* request headers in the CORS
 *      preflight; see cors-proxy.mjs. Drop the shim when OVDB allows them.
 *   3. DataTug web dev server                                            localhost:DEMO_WEB_PORT (4200)
 *      attached to when the process on that port serves THIS checkout, else started; any other process
 *      on the port is an error that names DEMO_WEB_PORT
 *
 * Environment:
 *   DEMO_WEB_PORT                web port (default 4200). Playwright reads DATATUG_E2E_PORT: demo:e2e sets it.
 *   DATATUG_DEMO_PROJECTS_DIR    a checkout of datatug/datatug-demo-projects, used only as a git object store
 *                                for the pinned commit (default: found beside this repository's ancestors).
 *   CHINOOK_SQLITE               the pinned Chinook SQLite file (default: a sibling chinook-database checkout).
 *   OVDB                         the ovdb binary (default: from PATH). Needs python3 and git too.
 *
 * Nothing in the demo-projects checkout is written: the pinned files are extracted with `git archive` into
 * tmp/demo-stack, along with the derived Chinook SQLite. Everything started is recorded in
 * tmp/demo-stack/state.json, so `demo:down` kills only what this script started.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const work = join(root, 'tmp', 'demo-stack');
const statePath = join(work, 'state.json');
const pin = JSON.parse(readFileSync(join(root, 'tools/demo-bundle/pin.json'), 'utf8')).demoProjects;
const ovdbPort = 50501; // what the app and the saved query use (the CORS shim)
const ovdbUpstreamPort = 50511; // ovdb itself
const webPort = Number(process.env['DEMO_WEB_PORT'] || process.env['DATATUG_E2E_PORT'] || 4200);
const ovdbBin = process.env['OVDB'] || 'ovdb';

const die = (message) => { console.error(`demo-stack: ${message}`); process.exit(1); };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function readState() {
  try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return { started: [] }; }
}
function writeState(state) {
  mkdirSync(work, { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function commandOf(pid) {
  try { return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim(); } catch { return ''; }
}

async function http(url, options = {}) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500), ...options });
    return response;
  } catch { return undefined; }
}

function listener(port) {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const pid = /^p(\d+)/m.exec(out)?.[1];
    return pid ? Number(pid) : undefined;
  } catch { return undefined; }
}

function findDemoRepo() {
  if (process.env['DATATUG_DEMO_PROJECTS_DIR']) return process.env['DATATUG_DEMO_PROJECTS_DIR'];
  for (let dir = root; ; dir = dirname(dir)) {
    for (const candidate of [join(dir, 'datatug-demo-projects'), join(dir, 'datatug', 'datatug-demo-projects')]) {
      if (existsSync(join(candidate, '.git'))) return candidate;
    }
    if (dirname(dir) === dir) break;
  }
  return die('no datatug-demo-projects checkout found; set DATATUG_DEMO_PROJECTS_DIR');
}

function findChinook(demoDir) {
  if (process.env['CHINOOK_SQLITE']) return process.env['CHINOOK_SQLITE'];
  for (let dir = root; ; dir = dirname(dir)) {
    for (const base of [join(dir, 'chinook-database'), join(dir, 'datatug', 'chinook-database'), join(demoDir, '..', 'chinook-database')]) {
      const candidate = join(base, 'ChinookDatabase/DataSources/Chinook_Sqlite.sqlite');
      if (existsSync(candidate)) return candidate;
    }
    if (dirname(dir) === dir) break;
  }
  return die('the pinned Chinook SQLite file was not found; set CHINOOK_SQLITE (see demo-bundle/generate.mjs)');
}

/** The pinned demo project files, extracted once per commit, plus the derived Chinook SQLite OVDB reads. */
function prepareData() {
  const dir = join(work, `demo-projects-${pin.commit.slice(0, 10)}`);
  const marker = join(dir, '.prepared');
  if (existsSync(marker)) return dir;
  const repo = findDemoRepo();
  try { execFileSync('git', ['-C', repo, 'cat-file', '-e', `${pin.commit}^{commit}`]); }
  catch { die(`commit ${pin.commit} is not in ${repo}; run: git -C ${repo} fetch origin`); }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const archive = execFileSync('git', ['-C', repo, 'archive', pin.commit, 'scripts/prepare_chinook.py', `${pin.project}/fixtures`, `${pin.project}/data/geo`], { maxBuffer: 256 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', dir], { input: archive });
  const output = join(dir, pin.project, '.demo-data', 'chinook.sqlite');
  try {
    execFileSync('python3', [join(dir, 'scripts/prepare_chinook.py'), findChinook(repo), output], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) { die(`deriving the Chinook SQLite failed: ${error.stderr?.toString() || error.message}`); }
  writeFileSync(marker, `${pin.commit}\n`);
  return dir;
}

function spawnLogged(name, command, args, extraEnv = {}) {
  mkdirSync(work, { recursive: true });
  const log = openSync(join(work, `${name}.log`), 'w');
  const child = spawn(command, args, { cwd: root, detached: true, stdio: ['ignore', log, log], env: { ...process.env, ...extraEnv } });
  child.unref();
  return child.pid;
}

async function waitFor(label, check, seconds = 120) {
  for (let i = 0; i < seconds * 2; i++) {
    if (await check()) return;
    await sleep(500);
  }
  die(`${label} did not become healthy in ${seconds}s; see ${join(work, '*.log')}`);
}

const ovdbHealthy = async () => {
  const meta = await http(`http://127.0.0.1:${ovdbPort}/.well-known/openvaultdb`);
  const record = await http(`http://127.0.0.1:${ovdbPort}/v1/databases/geo/records/population_wb/ie`);
  return !!meta?.ok && !!record?.ok;
};
const webHealthy = async () => {
  const page = await http(`http://localhost:${webPort}/demo`);
  const data = await http(`http://localhost:${webPort}/assets/demo-data/ovdb/geo/population_wb.json`);
  return !!page?.ok && !!data?.ok;
};

function ownedByState(state, name, port) {
  const entry = state.started.find((item) => item.name === name && item.port === port);
  const pid = listener(port);
  return entry && pid && (entry.pid === pid || alive(entry.pid)) ? entry : undefined;
}

async function startOvdb(state) {
  if (ownedByState(state, 'ovdb-cors', ovdbPort) && ownedByState(state, 'ovdb', ovdbUpstreamPort) && (await ovdbHealthy())) return { mode: 'attached (started earlier by demo:up)' };
  for (const port of [ovdbUpstreamPort, ovdbPort]) {
    const busy = listener(port);
    if (busy) die(`port ${port} is in use by pid ${busy} (${commandOf(busy).slice(0, 60)}). ${port === ovdbPort ? 'The saved query names this port, so it cannot move: ' : ''}stop that process, then re-run.`);
  }
  const data = prepareData();
  const manifests = ['chinook', 'geo'].flatMap((name) => ['--manifest', join(data, pin.project, 'fixtures/ovdb', `${name}.ovdb.yaml`)]);
  const pid = spawnLogged('ovdb', ovdbBin, ['serve', '--addr', `127.0.0.1:${ovdbUpstreamPort}`, ...manifests]);
  state.started.push({ name: 'ovdb', pid, port: ovdbUpstreamPort });
  writeState(state);
  await waitFor('ovdb', async () => !!(await http(`http://127.0.0.1:${ovdbUpstreamPort}/.well-known/openvaultdb`))?.ok, 30);
  const proxy = spawnLogged('ovdb-cors', process.execPath, [join(root, 'tools/demo-stack/cors-proxy.mjs'), '--listen', String(ovdbPort), '--upstream', String(ovdbUpstreamPort), '--origin', `http://localhost:${webPort}`]);
  state.started.push({ name: 'ovdb-cors', pid: proxy, port: ovdbPort });
  writeState(state);
  await waitFor('the OVDB CORS shim', ovdbHealthy, 30);
  return { mode: 'started' };
}

async function startWeb(state) {
  const busy = listener(webPort);
  if (busy) {
    if (ownedByState(state, 'web', webPort) && (await webHealthy())) return { mode: 'attached (started earlier by demo:up)' };
    // Another process: attach only if it is serving this checkout's build.
    const served = await http(`http://localhost:${webPort}/build-info.json`);
    const mine = existsSync(join(root, 'apps/datatug-app/src/build-info.json')) ? readFileSync(join(root, 'apps/datatug-app/src/build-info.json'), 'utf8') : '';
    if (served?.ok && mine && (await served.text()).trim() === mine.trim() && (await webHealthy())) return { mode: 'attached (serves this checkout)' };
    die(`port ${webPort} is in use by pid ${busy} (${commandOf(busy).slice(0, 60)}) and is not this checkout's dev server. Free it, or choose another port with DEMO_WEB_PORT=<port>.`);
  }
  const pid = spawnLogged('web', 'pnpm', ['nx', 'run', 'datatug-app:serve:development', '--host', 'localhost', '--port', String(webPort)]);
  state.started.push({ name: 'web', pid, port: webPort });
  writeState(state);
  await waitFor('the web dev server', webHealthy, 240);
  return { mode: 'started' };
}

function demoUrl() {
  const q = 'Which countries buy the most music relative to their population?';
  return `http://localhost:${webPort}/demo?scenario=countries-music-per-capita&q=${encodeURIComponent(q)}&lang=en`;
}

function printTable(rows) {
  console.log('\nprocess        port   mode');
  for (const [name, port, mode] of rows) console.log(`${name.padEnd(14)} ${String(port).padEnd(6)} ${mode}`);
  console.log(`\nDemo:  ${demoUrl()}`);
  console.log(`Logs:  ${work}/*.log     Stop:  pnpm demo:down\n`);
}

async function up() {
  const state = readState();
  state.started = state.started.filter((item) => alive(item.pid));
  const ovdb = await startOvdb(state);
  const web = await startWeb(state);
  printTable([['ovdb', ovdbUpstreamPort, ovdb.mode], ['ovdb cors shim', ovdbPort, ovdb.mode], ['web', webPort, web.mode]]);
  return state;
}

/** Stop these recorded processes (and only these) and forget them. */
function stop(items) {
  if (!items.length) { console.log('demo-stack: nothing was started by demo:up'); return; }
  for (const item of items) {
    if (!alive(item.pid)) continue;
    try { process.kill(-item.pid, 'SIGTERM'); } catch { try { process.kill(item.pid, 'SIGTERM'); } catch { /* already gone */ } }
    console.log(`demo-stack: stopped ${item.name} (pid ${item.pid}, port ${item.port})`);
  }
  const state = readState();
  writeState({ started: state.started.filter((item) => !items.some((gone) => gone.pid === item.pid)) });
}

function down() { stop(readState().started); }

async function status() {
  const state = readState();
  console.log(`ovdb ${ovdbPort}: ${(await ovdbHealthy()) ? 'healthy' : 'down'}   web ${webPort}: ${(await webHealthy()) ? 'healthy' : 'down'}   started by demo:up: ${state.started.filter((s) => alive(s.pid)).map((s) => s.name).join(', ') || 'nothing'}`);
}

const command = process.argv[2] || 'up';
if (command === 'up') await up();
else if (command === 'down') down();
else if (command === 'status') await status();
else if (command === 'e2e') {
  const before = readState().started.filter((item) => alive(item.pid)).map((item) => item.name);
  await up();
  const started = readState().started.filter((item) => alive(item.pid) && !before.includes(item.name));
  const args = ['exec', 'playwright', 'test', '-c', 'apps/datatug-app/playwright.config.ts', '--project=demo', ...process.argv.slice(3)];
  const code = await new Promise((done) => spawn('pnpm', args, { cwd: root, stdio: 'inherit', env: { ...process.env, DATATUG_E2E_PORT: String(webPort), DEMO_STACK: '1' } }).on('exit', (c) => done(c ?? 1)));
  stop(started);
  process.exit(code);
} else die(`unknown command ${command} (up | down | status | e2e)`);
