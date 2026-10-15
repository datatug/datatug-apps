import { test as base, expect } from '@playwright/test';
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
  /** Stops the daemon (for the agent-unreachable state); `start()` starts it again. */
  stop(): void;
  start(): void;
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
      const run = (args: string[]) => {
        const r = spawnSync(bin.value, args, { env, encoding: 'utf8' });
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
      const daemon: LinkDaemon = {
        port,
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
          const url = String(run(args)['url']);
          expect(url.startsWith(baseURL + '/store/http-127.0.0.1:')).toBe(true);
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
        spawnSync(bin.value, ['daemon', 'stop'], { env });
        fs.rmSync(home, { recursive: true, force: true });
      }
    },
    { scope: 'worker' },
  ],
});

export { expect };
