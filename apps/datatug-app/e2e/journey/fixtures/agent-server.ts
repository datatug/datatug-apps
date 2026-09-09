import { test as base, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Journey e2e harness (Phase 1 plan task 3, Feature core-investigation-loop
 * AC:journey-harness / REQ:journey-e2e) — boots the REAL `datatug serve`
 * agent against the real demo project, on a free port, with no HTTP route
 * interception. See ../README.md for the env vars this fixture reads and
 * what CI must provide.
 *
 * `agentServer` is a worker-scoped fixture: one agent process is started per
 * Playwright worker and shared by every journey test in that worker, then
 * torn down when the worker finishes.
 */
export interface AgentServer {
  readonly host: string;
  readonly port: number;
  /** `host:port`, usable directly as a DataTug web-app storeId (`/store/<storeId>/...`). */
  readonly storeId: string;
  readonly demoDir: string;
  /** Absolute path to the captured stdout+stderr log file (kept as a CI artifact). */
  readonly logFile: string;
  /** In-memory snapshot of everything the agent has printed so far. */
  readLog(): string;
}

interface JourneyWorkerFixtures {
  agentServer: AgentServer;
}

const PING_TIMEOUT_MS = 20_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

/** Walk up from `startDir` to the nearest ancestor holding `nx.json` (the datatug-apps repo/worktree root). */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'nx.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return startDir; // couldn't find it; fall back to the start dir
    }
    dir = parent;
  }
}

const repoRoot = findRepoRoot(__dirname);

type Resolved<T> = { ok: true; value: T } | { ok: false; skipReason: string };

function resolveDemoDir(): Resolved<string> {
  const explicit = process.env['DATATUG_DEMO_DIR'];
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!fs.existsSync(resolved)) {
      return {
        ok: false,
        skipReason: `DATATUG_DEMO_DIR=${explicit} does not exist (resolved to ${resolved}).`,
      };
    }
    return { ok: true, value: resolved };
  }

  // Default: "../datatug-demo-projects/demo-project-1" relative to the repo.
  // Try the plain sibling-checkout layout CI is expected to use first (repos
  // checked out side by side), then one and two levels further up, which
  // covers a nested worktree checkout (<repo>/.worktrees/<task>/...) — the
  // layout this harness was itself developed in.
  const candidates = [1, 2, 3].map((up) =>
    path.resolve(
      repoRoot,
      ...Array<string>(up).fill('..'),
      'datatug-demo-projects',
      'demo-project-1',
    ),
  );
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    return {
      ok: false,
      skipReason:
        'Could not find the demo project. Set DATATUG_DEMO_DIR to a ' +
        'datatug-demo-projects/demo-project-1 checkout, or check one out as ' +
        'a sibling of datatug-apps. Tried:\n' +
        candidates.map((candidate) => `  - ${candidate}`).join('\n'),
    };
  }
  return { ok: true, value: found };
}

function resolveBinary(): Resolved<string> {
  const explicitBin = process.env['DATATUG_BIN'];
  if (explicitBin) {
    const resolved = path.resolve(explicitBin);
    if (!fs.existsSync(resolved)) {
      return {
        ok: false,
        skipReason: `DATATUG_BIN=${explicitBin} does not exist (resolved to ${resolved}).`,
      };
    }
    return { ok: true, value: resolved };
  }

  const cliDir = process.env['DATATUG_CLI_DIR'];
  if (!cliDir) {
    return {
      ok: false,
      skipReason:
        'Journey e2e needs a datatug binary. Set DATATUG_BIN to a built ' +
        'binary (CI: the datatug-cli repo publishes release binaries; the ' +
        'Homebrew cask is "datatug" — see ../README.md), or set ' +
        'DATATUG_CLI_DIR to a datatug-cli checkout so this fixture can ' +
        '`go build` one on demand. Neither was provided; skipping the ' +
        'journey project.',
    };
  }
  const resolvedCliDir = path.resolve(cliDir);
  if (!fs.existsSync(resolvedCliDir)) {
    return {
      ok: false,
      skipReason: `DATATUG_CLI_DIR=${cliDir} does not exist (resolved to ${resolvedCliDir}).`,
    };
  }

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'datatug-journey-e2e-'));
  const outBin = path.join(outDir, process.platform === 'win32' ? 'datatug.exe' : 'datatug');
  const build = spawnSync('go', ['build', '-o', outBin, '.'], {
    cwd: resolvedCliDir,
    encoding: 'utf8',
  });
  if (build.error) {
    return {
      ok: false,
      skipReason:
        `Could not run \`go build\` in DATATUG_CLI_DIR=${resolvedCliDir}: ` +
        `${build.error.message}. Is Go installed and on PATH?`,
    };
  }
  if (build.status !== 0) {
    return {
      ok: false,
      skipReason:
        `\`go build -o ${outBin} .\` failed in ${resolvedCliDir} (exit ${build.status}).\n` +
        `${(build.stderr || build.stdout || '').trim()}`,
    };
  }
  return { ok: true, value: outBin };
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (!address || typeof address === 'string') {
        srv.close();
        reject(new Error('failed to allocate a free TCP port'));
        return;
      }
      const { port } = address;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForPing(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (res.ok) {
        return;
      }
      lastError = new Error(`HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${url}: ${String(lastError)}`);
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- matches Playwright's own TestType<{}, W> shape
export const test = base.extend<{}, JourneyWorkerFixtures>({
  agentServer: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const demoDirResult = resolveDemoDir();
      if (!demoDirResult.ok) {
        test.skip(true, demoDirResult.skipReason);
        return;
      }
      const binResult = resolveBinary();
      if (!binResult.ok) {
        test.skip(true, binResult.skipReason);
        return;
      }

      const host = '127.0.0.1';
      const port = await getFreePort();

      const logDir = path.join(repoRoot, 'coverage', 'apps', 'datatug-app-e2e', 'journey');
      fs.mkdirSync(logDir, { recursive: true });
      const logFile = path.join(logDir, `agent-worker-${workerInfo.workerIndex}.log`);
      const logStream = fs.createWriteStream(logFile, { flags: 'w' });

      let logBuffer = '';
      const appendLog = (chunk: Buffer | string) => {
        const text = chunk.toString();
        logBuffer += text;
        logStream.write(text);
      };

      const args = [
        'serve',
        '--project',
        demoDirResult.value,
        '--host',
        host,
        '--port',
        String(port),
        '--as',
        'admin',
      ];
      const child = spawn(binResult.value, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', appendLog);
      child.stderr.on('data', appendLog);

      let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
      child.once('exit', (code, signal) => {
        exited = { code, signal };
      });
      const spawnError = new Promise<never>((_, reject) => {
        child.once('error', reject);
      });

      const pingUrl = `http://${host}:${port}/datatug/ping`;
      try {
        await Promise.race([waitForPing(pingUrl, PING_TIMEOUT_MS), spawnError]);
      } catch (err) {
        logStream.end();
        if (!exited) {
          child.kill('SIGKILL');
        }
        const exitNote = exited
          ? ` The process already exited (code=${exited.code}, signal=${exited.signal}).`
          : '';
        throw new Error(
          `datatug serve (${binResult.value} ${args.join(' ')}) never answered ` +
            `${pingUrl}: ${String(err)}.${exitNote}\n` +
            `--- captured log (${logFile}) ---\n${logBuffer || '(empty)'}`,
        );
      }

      await use({
        host,
        port,
        storeId: `${host}:${port}`,
        demoDir: demoDirResult.value,
        logFile,
        readLog: () => logBuffer,
      });

      await new Promise<void>((resolve) => {
        if (exited) {
          resolve();
          return;
        }
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
        }, SHUTDOWN_TIMEOUT_MS);
        child.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
        child.kill('SIGTERM');
      });
      logStream.end();
    },
    { scope: 'worker' },
  ],
});

export { expect };
