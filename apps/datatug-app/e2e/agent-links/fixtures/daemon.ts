import { test as base, expect } from '../../helpers/demodb-guard';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * A real `datatug daemon start` for the card-link e2e (Feature claude-mod-web-links), isolated from the person's
 * own DataTug setup: it runs with a temporary HOME whose `.datatug.yaml` registers only the demo project, and its
 * state (record, log, access key) lives in that HOME. Owner: the Playwright worker; teardown: `datatug daemon stop`
 * in the worker's teardown, then the temporary HOME is removed.
 *
 * Env: DATATUG_BIN (a built datatug binary) or DATATUG_CLI_DIR (a datatug-cli checkout to `go build`);
 * DATATUG_DEMO_DIR (a datatug-demo-project/demo-project-1 checkout; default: a sibling checkout); the Chinook
 * SQLite fixture at ~/datatug/dbs/chinook-local.sqlite (see e2e/journey/README.md for how CI fetches it).
 * Without them every test is skipped, with the reason.
 */

export const DEMO_PROJECT = 'datatug-demo-project';
export const DEMO_ENV = 'local';
export const DEMO_DB = 'chinook-local';

export interface LinkRequest {
  readonly table: string;
  /**
   * Link to a table the project does not have. `daemon url` checks `--table` against the scanned metadata and
   * refuses a missing table (exit 3, REQ url-validates-metadata), so the link is minted for `table` (which must
   * exist) and its table path segment is then replaced by this name, as a hand-edited or stale link would be.
   */
  readonly missingTable?: string;
  readonly schema?: string;
  readonly view?: boolean;
  readonly records?: boolean;
  readonly limit?: number;
  /** The primary key, as the JSON object `daemon url --record` takes. */
  readonly record?: string;
  readonly project?: string;
  readonly env?: string;
  readonly db?: string;
}

export interface LinkDaemon {
  readonly port: number;
  /** A fresh link (with a fresh one-time code) as a path for `page.goto`, minted by `datatug daemon url`. */
  link(req: LinkRequest): string;
  /** The version of the datatug binary, e.g. `0.102.1`; empty when `datatug version` did not print one. */
  readonly cliVersion: string;
  /** Whether the binary is at least `min` (a `major.minor.patch` string); false when its version is unknown. */
  cliAtLeast(min: string): boolean;
  /** Whether the binary stores query results (`query run --result-id`, `daemon url --result`). */
  readonly supportsResults: boolean;
  /** Stores a query result under `id` with `datatug query run <args> --result-id <id>` (no row reaches stdout). */
  writeResult(id: string, args: readonly string[]): void;
  /** Whether the binary records a prompt on a stored result (the `annotate` verb of `results`, datatug-cli#431). */
  readonly supportsPrompt: boolean;
  /** Records `text` as the prompt of the stored result `id` (the text goes in on stdin, never in an argument). */
  annotate(id: string, text: string): void;
  /** A fresh link to a stored result, minted by `datatug daemon url --result`. */
  resultLink(id: string, view?: string, row?: number): string;
  /** Stops the daemon (for the agent-unreachable state); `start()` starts it again. */
  stop(): void;
  start(): void;
}

/** Whether the version `version` (`1.2.3`, a `v` prefix and a suffix are ignored) is at least `min`. */
export function versionAtLeast(version: string, min: string): boolean {
  const parse = (v: string) =>
    (/(\d+)\.(\d+)\.(\d+)/.exec(v) ?? []).slice(1).map(Number);
  const a = parse(version);
  const b = parse(min);
  if (a.length !== 3 || b.length !== 3) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

type Resolved<T> = { ok: true; value: T } | { ok: false; skipReason: string };

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (!fs.existsSync(path.join(dir, 'nx.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
  return dir;
}

function resolveDemoDir(): Resolved<string> {
  const explicit = process.env['DATATUG_DEMO_DIR'];
  const root = findRepoRoot(__dirname);
  const candidates = explicit
    ? [path.resolve(explicit)]
    : ['datatug-demo-project', 'datatug-demo-projects'].flatMap((name) =>
        [1, 2, 3, 4, 5, 6].map((up) =>
          path.resolve(root, ...Array<string>(up).fill('..'), name, 'demo-project-1'),
        ),
      );
  const found = candidates.find((c) => fs.existsSync(path.join(c, 'datatug-project.json')));
  return found
    ? { ok: true, value: found }
    : { ok: false, skipReason: 'No demo project: set DATATUG_DEMO_DIR.' };
}

function resolveBinary(): Resolved<string> {
  const bin = process.env['DATATUG_BIN'];
  if (bin) {
    return fs.existsSync(bin)
      ? { ok: true, value: path.resolve(bin) }
      : { ok: false, skipReason: `DATATUG_BIN=${bin} does not exist.` };
  }
  const cliDir = process.env['DATATUG_CLI_DIR'];
  if (!cliDir) {
    return { ok: false, skipReason: 'Card-link e2e needs DATATUG_BIN or DATATUG_CLI_DIR.' };
  }
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'datatug-links-bin-')), 'datatug');
  const build = spawnSync('go', ['build', '-o', out, '.'], { cwd: cliDir, encoding: 'utf8' });
  return build.status === 0
    ? { ok: true, value: out }
    : { ok: false, skipReason: `go build failed in ${cliDir}: ${build.stderr}` };
}

const chinook = path.join(os.homedir(), 'datatug', 'dbs', 'chinook-local.sqlite');

export const test = base.extend<object, { linkDaemon: LinkDaemon }>({
  // This lane only talks to a local agent: count and detect DemoDB requests but install no route, for the tests of THIS fixture
  // only (see `demodbPassive` in helpers/demodb-guard.ts).
  demodbPassive: [true, { option: true }] as never,
  linkDaemon: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const demo = resolveDemoDir();
      const bin = resolveBinary();
      const skip = !demo.ok
        ? demo.skipReason
        : !bin.ok
          ? bin.skipReason
          : !fs.existsSync(chinook)
            ? `No Chinook fixture at ${chinook}.`
            : '';
      if (skip || !demo.ok || !bin.ok) {
        test.skip(true, skip);
        return;
      }
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'datatug-links-home-'));
      fs.mkdirSync(path.join(home, 'datatug', 'dbs'), { recursive: true });
      fs.symlinkSync(chinook, path.join(home, 'datatug', 'dbs', 'chinook-local.sqlite'));
      fs.writeFileSync(
        path.join(home, '.datatug.yaml'),
        `projects:\n  - id: ${DEMO_PROJECT}\n    path: ${JSON.stringify(demo.value)}\n`,
      );
      const baseURL = String(workerInfo.project.use.baseURL);
      const env = {
        ...process.env,
        HOME: home,
        DATATUG_TELEMETRY: '0',
        // The links name the app under test instead of https://datatug.app.
        DATATUG_UI_BASE: baseURL,
      };
      // The CLI resolves `--project <id>` as a directory relative to its working directory before it consults the
      // registry. CI checks the demo repository out as `./datatug-demo-project` in the workspace root, so a CLI run
      // from there would take that checkout (a repository root, no queries) for the project and fail with
      // `query not found`. Every CLI call therefore runs from the temporary HOME, which holds no such directory.
      const cwd = home;
      const run = (args: string[]) => {
        const r = spawnSync(bin.value, args, { env, cwd, encoding: 'utf8' });
        if (r.status !== 0) {
          throw new Error(`datatug ${args.join(' ')} exited ${r.status}: ${r.stderr}`);
        }
        return JSON.parse(r.stdout) as Record<string, unknown>;
      };
      const start = () => {
        const st = run(['daemon', 'start', '--format', 'json']);
        if (st['startedBy'] !== 'cli') {
          // An API already on the preferred port was adopted: it is not ours, so it has none of our keys.
          run(['daemon', 'stop', '--format', 'json']);
          throw new Error('Another DataTug API listens on the daemon port; stop it to run the card-link e2e.');
        }
        return Number(st['port']);
      };
      const port = start();
      const help = spawnSync(bin.value, ['daemon', 'url', '--help'], { env, cwd, encoding: 'utf8' });
      const storeHelp = spawnSync(bin.value, ['query', 'results', '--help'], { env, cwd, encoding: 'utf8' });
      // `datatug version` prints `datatug 0.102.1 (<commit>) <date>`.
      const versionOut = spawnSync(bin.value, ['version'], { env, cwd, encoding: 'utf8' });
      const cliVersion = /(\d+\.\d+\.\d+)/.exec(versionOut.stdout)?.[1] ?? '';
      const daemon: LinkDaemon = {
        port,
        cliVersion,
        cliAtLeast: (min) => versionAtLeast(cliVersion, min),
        supportsResults: `${help.stdout}${help.stderr}`.includes('--result'),
        supportsPrompt: `${storeHelp.stdout}${storeHelp.stderr}`.includes('annotate'),
        annotate: (id, text) => {
          const r = spawnSync(
            bin.value,
            ['query', 'results', 'annotate', '--id', id, '--prompt-stdin'],
            { env, cwd, input: text, encoding: 'utf8' },
          );
          // Neither the text nor the CLI's output is put in the message.
          if (r.status !== 0) throw new Error(`annotating a result exited ${r.status}`);
        },
        writeResult: (id, args) => {
          const out = run(['query', 'run', ...args, '--result-id', id, '--format', 'json']);
          expect(out['resultFiles']).toBeDefined();
        },
        resultLink: (id, view, row) => {
          const args = ['daemon', 'url', '--format', 'json', '--result', id];
          if (view) args.push(`--view=${view}`);
          if (row) args.push('--row', String(row));
          const url = String(run(args)['url']);
          expect(url.startsWith(baseURL + '/store/http-127.0.0.1:')).toBe(true);
          return url.slice(baseURL.length);
        },
        link: (req) => {
          const args = [
            'daemon', 'url', '--format', 'json',
            '--project', req.project ?? DEMO_PROJECT,
            '--env', req.env ?? DEMO_ENV,
            '--db', req.db ?? DEMO_DB,
            '--table', req.table,
          ];
          if (req.schema) args.push('--schema', req.schema);
          if (req.view) args.push('--view');
          if (req.records) args.push('--records');
          if (req.limit) args.push('--limit', String(req.limit));
          if (req.record) args.push('--record', req.record);
          let url = String(run(args)['url']);
          expect(url.startsWith(baseURL + '/store/http-127.0.0.1:')).toBe(true);
          if (req.missingTable) {
            const segment = `/table/${encodeURIComponent(req.table)}`;
            expect(url).toContain(segment);
            url = url.replace(segment, `/table/${encodeURIComponent(req.missingTable)}`);
          }
          return url.slice(baseURL.length);
        },
        stop: () => {
          run(['daemon', 'stop', '--format', 'json']);
        },
        start: () => {
          start();
        },
      };
      try {
        await use(daemon);
      } finally {
        spawnSync(bin.value, ['daemon', 'stop'], { env, cwd });
        fs.rmSync(home, { recursive: true, force: true });
      }
    },
    { scope: 'worker' },
  ],
});

export { expect };
