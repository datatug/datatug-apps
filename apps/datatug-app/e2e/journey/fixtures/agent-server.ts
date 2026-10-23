import { test as base, expect } from '../../helpers/demodb-guard';
import type { APIRequestContext, BrowserContext } from '@playwright/test';
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
 * `agentServer` and `supportAgentServer` (S100) are both worker-scoped
 * fixtures: one agent process each is started per Playwright worker and
 * shared by every journey test in that worker, then torn down when the
 * worker finishes. They are deliberately TWO SEPARATE `datatug serve`
 * processes on two separate ports, not one process reused with a changed
 * principal — `--as`/`--role` are fixed at agent startup (REQ:principal-
 * selection: "the browser displays but cannot change it"), and Investigation
 * Context is scoped by agent URL among other things (api-contract.md
 * "Context is isolated by agent URL/project/environment/securityContextId"),
 * so a single shared agent could never actually exercise J4's own restricted
 * principal in isolation from J1–J3's admin one.
 */
export interface AgentServer {
  readonly host: string;
  readonly port: number;
  /** `http-<host>:<port>`, usable directly as a DataTug web-app storeId (`/store/<storeId>/...`). The app sends the
   * session token only to an explicit `http-` loopback store (agent-access.interceptor.ts), so the bare `host:port`
   * form of earlier agents no longer authenticates. */
  readonly storeId: string;
  readonly demoDir: string;
  /** Absolute path to the captured stdout+stderr log file (kept as a CI artifact). */
  readonly logFile: string;
  /** In-memory snapshot of everything the agent has printed so far. */
  readLog(): string;
  /** The session token this agent issued for the harness's one-time code (datatug-cli v0.85.0+ session exchange).
   * `restart()` re-exchanges, so call this at use time rather than caching the value. */
  sessionToken(): string;
  /** `Authorization: Bearer <session token>` for a direct request (APIRequestContext, node fetch, page fetch). */
  authHeaders(): Record<string, string>;
  /** Restart the same real agent on the same URL and repository. A restart
   * rotates datatug-cli's server-issued securityContextId, so journeys can
   * exercise STALE_CONTEXT recovery without intercepting a request. */
  restart(): Promise<void>;
  /** S174 — set only for `agentServer` (the one fixture seeded with
   * `PERSONAL_QUERY_ID`/`PERSONAL_QUERY_TITLE`, below): the `$DATATUG_PERSONAL_DIR`
   * this agent process was started with. Exposed for debugging a failed run, not
   * read by any spec today. */
  readonly personalDir?: string;
}

/**
 * S174 (datatug-cli v0.24.0, api-contract.md PR #55) — the ONE seeded personal
 * query `agentServer` starts with (see `StartAgentOptions.personalQuery` and its
 * use in the `agentServer` fixture registration below), for the Personal-tab
 * journey coverage in `journey.spec.ts`. Exported (rather than each spec
 * re-declaring its own copy — contrast `DEMO_PROJECT_ID`, which every spec file
 * DOES re-declare, matching a constant that already lives on the public
 * datatug-demo-projects fixture repo, not one this file itself invents) because
 * this exact id/title only exists because this fixture wrote it — the single
 * source of truth has to be here.
 */
export const PERSONAL_QUERY_ID = 'personal-scratchpad';
export const PERSONAL_QUERY_TITLE = 'My personal scratchpad query';

/**
 * Writes one `.query.json` file under datatug-cli's own on-disk personal-queries
 * convention (`pkg/personalqueries.ResolveProjectDir` — `$DATATUG_PERSONAL_DIR/
 * <projectID>/queries/<id>.query.json`), mirroring that repo's own
 * `query_endpoints_personal_queries_test.go` `writePersonalQuery()` fixture
 * writer exactly (flat `{id,title,type}`, no sibling `.sql`/`.tugql`/`.http` body
 * file needed — `all_queries` never reads a query's text, same reason
 * `queries.service.ts`'s own `IWireQueryItem` doc comment gives). `projectId` is
 * read out of the demo project's own `datatug-project.json` rather than
 * hardcoded a third time in this file (every other journey spec file already
 * duplicates `DEMO_PROJECT_ID` as a literal, per its own header comment) — this
 * is the one place close enough to the source of truth to just read it.
 */
function seedPersonalQuery(
  personalDir: string,
  projectId: string,
  id: string,
  title: string,
): void {
  const queriesDir = path.join(personalDir, projectId, 'queries');
  fs.mkdirSync(queriesDir, { recursive: true });
  fs.writeFileSync(
    path.join(queriesDir, `${id}.query.json`),
    JSON.stringify({ id, title, type: 'SQL' }, null, 2),
  );
}

interface JourneyWorkerFixtures {
  agentServer: AgentServer;
  /** An admin agent whose project repository is a worker-owned temporary
   * copy. Incident journeys may persist and restart it without changing the
   * shared datatug-demo-projects checkout. */
  incidentAgentServer: AgentServer;
  supportAgentServer: AgentServer;
  /** Phase 1 Task 14 (J2b) — an admin agent started with `--http-offline`, so every
   * HTTP-typed saved query's live fetch fails `SOURCE_UNAVAILABLE` deterministically in
   * CI without depending on the real, actually-reachable countriesnow.space/
   * frankfurter.dev endpoints being unreachable — see cmd_serve.go's own doc comment on
   * why this is a real operator-facing switch, not a test-only hook. */
  offlineAgentServer: AgentServer;
}

const PING_TIMEOUT_MS = 20_000;

/**
 * datatug-cli v0.85.0+ refuses every route (ping included) without a session token. `datatug serve` prints a one-time
 * `#code=` link; the harness exchanges that code once (`POST /datatug/session/exchange`, the call the app makes itself
 * in AgentAccessService) and keeps the token. The browser gets the same token in localStorage under the key the app
 * reads (`datatug.agent-session:<origin>`), and direct APIRequestContext calls get it as a Bearer header, so specs
 * keep addressing the agent as they always did.
 */
const SESSION_TOKEN_KEY_PREFIX = 'datatug.agent-session:';
const agentTokens = new Map<string, () => string>();
const liveContexts = new Set<BrowserContext>();

function tokenSnapshot(): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [origin, token] of agentTokens) tokens[origin] = token();
  return tokens;
}

async function installTokens(
  context: BrowserContext,
  tokens: Record<string, string>,
): Promise<void> {
  if (Object.keys(tokens).length === 0) return;
  await context.addInitScript(
    ({ prefix, entries }) => {
      try {
        for (const [origin, token] of Object.entries(entries)) {
          localStorage.setItem(prefix + origin, token);
        }
      } catch {
        /* storage unavailable on this origin (about:blank) */
      }
    },
    { prefix: SESSION_TOKEN_KEY_PREFIX, entries: tokens },
  );
}

async function exchangeCode(origin: string, code: string): Promise<string> {
  const response = await fetch(`${origin}/datatug/session/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) {
    throw new Error(
      `POST ${origin}/datatug/session/exchange answered HTTP ${response.status}`,
    );
  }
  const body = (await response.json()) as { token?: unknown };
  if (typeof body.token !== 'string' || !body.token) {
    throw new Error(`${origin} session exchange returned no token`);
  }
  return body.token;
}
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

  // Default: "../datatug-demo-project/demo-project-1" relative to the repo.
  // Try the plain sibling-checkout layout CI is expected to use first (repos
  // checked out side by side), then one and two levels further up, which
  // covers a nested worktree checkout (<repo>/.worktrees/<task>/...) — the
  // layout this harness was itself developed in.
  const candidates = ['datatug-demo-project', 'datatug-demo-projects'].flatMap((checkoutName) =>
    [1, 2, 3].map((up) => path.resolve(
      repoRoot,
      ...Array<string>(up).fill('..'),
      checkoutName,
      'demo-project-1',
    )));
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    return {
      ok: false,
      skipReason:
        'Could not find the demo project. Set DATATUG_DEMO_DIR to a ' +
        'datatug-demo-project/demo-project-1 checkout, or check one out as ' +
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
  const outBin = path.join(
    outDir,
    process.platform === 'win32' ? 'datatug.exe' : 'datatug',
  );
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

// resolveDemoDir()/resolveBinary() are shared by both agentServer and
// supportAgentServer, which each run as their own independent worker-scoped
// fixture setup — memoized here (a worker is a single Node process) so
// requesting both fixtures in one worker never resolves the demo dir twice
// or (worse, when DATATUG_CLI_DIR is set without DATATUG_BIN) runs `go
// build` twice.
let cachedDemoDir: Resolved<string> | undefined;
function resolveDemoDirCached(): Resolved<string> {
  if (!cachedDemoDir) {
    cachedDemoDir = resolveDemoDir();
  }
  return cachedDemoDir;
}
let cachedBinary: Resolved<string> | undefined;
function resolveBinaryCached(): Resolved<string> {
  if (!cachedBinary) {
    cachedBinary = resolveBinary();
  }
  return cachedBinary;
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
      // A session-protected agent (v0.85.0+) answers 401 until the code is exchanged: alive is enough here.
      if (res.ok || res.status === 401) {
        return;
      }
      lastError = new Error(`HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${url}: ${String(lastError)}`,
  );
}

interface StartAgentOptions {
  /** `--as` — the request's principal id only (see the `--role` comment below). */
  readonly as: string;
  /** `--role` — what the dalgo access policy engine actually checks bindings against. */
  readonly role: string;
  /** Distinguishes this agent's log file from any other started in the same worker
   * (e.g. `"admin"`, `"support"`) — without this, `agentServer` and `supportAgentServer`
   * in the same worker would both write `agent-worker-<N>.log` and clobber each other. */
  readonly label: string;
  readonly workerIndex: number;
  /** Extra `datatug serve` flags appended verbatim after `--role` — e.g. `['--http-offline']`
   * for {@link offlineAgentServer}. Empty/undefined for every other agent. */
  readonly extraArgs?: readonly string[];
  /** Copy the demo project to a fresh worker-owned repository before serving.
   * The copy excludes source `.git` metadata and any source `incidents/`
   * directory, making persisted incident assertions deterministic. */
  readonly isolateProject?: boolean;
  /** S174 — when set, `startAgent()` creates a fresh `t.TempDir()`-equivalent
   * directory, seeds it with one `<id>.query.json` for the demo project (via
   * {@link seedPersonalQuery}), and starts the child process with
   * `$DATATUG_PERSONAL_DIR` pointed at it — datatug-cli v0.24.0's own override for
   * where `GET /datatug/queries/all_queries?root=personal` reads a principal's
   * personal queries from (`pkg/personalqueries.ResolveProjectDir`). Only
   * `agentServer` (below) sets this today. */
  readonly personalQuery?: { readonly id: string; readonly title: string };
}

interface StartedAgent {
  readonly server: AgentServer;
  readonly stop: () => Promise<void>;
}

/**
 * S100 — the spawn/ping-wait/log-capture/teardown logic `agentServer` (J1–J3, `--as
 * admin --role admin`) already had, extracted so `supportAgentServer` (J4, `--as
 * support --role support`) can reuse it verbatim rather than duplicating it. Each
 * caller still owns its own fixture registration/`test.skip()` (a `Resolved` return
 * for the "prerequisites missing" case — demo dir or binary — mirrors
 * resolveDemoDir()/resolveBinary()'s own convention) and its own teardown call; only
 * a "the agent process never answered its own ping" failure still throws directly
 * (unchanged from the pre-refactor behavior — this is a real defect, e.g. a broken
 * binary, not a missing prerequisite to skip past).
 */
async function startAgent(
  opts: StartAgentOptions,
): Promise<Resolved<StartedAgent>> {
  const demoDirResult = resolveDemoDirCached();
  if (!demoDirResult.ok) {
    return demoDirResult;
  }
  const binResult = resolveBinaryCached();
  if (!binResult.ok) {
    return binResult;
  }

  let demoDir = demoDirResult.value;
  let isolatedProjectRoot: string | undefined;
  if (opts.isolateProject) {
    isolatedProjectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'datatug-journey-project-'),
    );
    demoDir = path.join(isolatedProjectRoot, 'demo-project-1');
    const sourceIncidentsDir = path.join(demoDirResult.value, 'incidents');
    fs.cpSync(demoDirResult.value, demoDir, {
      recursive: true,
      filter: (source) =>
        path.basename(source) !== '.git' && source !== sourceIncidentsDir,
    });
  }

  // S174: seed `$DATATUG_PERSONAL_DIR` BEFORE spawning — the env var is read
  // once, at `datatug serve` startup (`personalqueries.ResolveProjectDir`),
  // so the file must already exist on disk by the time the child process is
  // spawned below, not merely by the time a test later requests it.
  let personalDir: string | undefined;
  if (opts.personalQuery) {
    const projectFile = JSON.parse(
      fs.readFileSync(path.join(demoDir, 'datatug-project.json'), 'utf8'),
    ) as { id: string };
    personalDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'datatug-journey-personal-'),
    );
    seedPersonalQuery(
      personalDir,
      projectFile.id,
      opts.personalQuery.id,
      opts.personalQuery.title,
    );
  }

  const host = '127.0.0.1';
  const port = await getFreePort();

  const logDir = path.join(
    repoRoot,
    'coverage',
    'apps',
    'datatug-app-e2e',
    'journey',
  );
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(
    logDir,
    `agent-${opts.label}-worker-${opts.workerIndex}.log`,
  );
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
    demoDir,
    '--host',
    host,
    '--port',
    String(port),
    '--as',
    opts.as,
    // `--as` sets the request's principal id only; `--role` (a separate,
    // repeatable flag — `datatug serve --help`) is what the dalgo access
    // policy engine actually checks bindings against. Without it, every
    // exec/select and exec/run_query the journey pages send gets a real
    // `403` — "dalgo access denied ... no binding applies to principal
    // 'admin'" — even though the demo project's own
    // policies/customers.yaml binds role "admin" to principal "admin"
    // (bindings.roles.admin: [admin]) and grants it opaque-SQL query
    // access. Found while diagnosing why the row-fetch request (fixed
    // above, EnvDbTablePageComponent) still never produced visible rows
    // (lane S89) — confirmed via curl A/B: identical exec/select 403s
    // with `--as admin` alone, 200s with real rows once `--role admin`
    // is added too. The same binding exists for `support` in the demo
    // project's own policies/customers.yaml (`bindings.roles.support:
    // [support]`) — S100.
    '--role',
    opts.role,
    ...(opts.extraArgs ?? []),
  ];
  let exited:
    | { code: number | null; signal: NodeJS.Signals | null }
    | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let childExitPromise: Promise<void> | undefined;
  let stopChildPromise: Promise<void> | undefined;
  const pingUrl = `http://${host}:${port}/datatug/ping`;
  const origin = `http://${host}:${port}`;
  let sessionToken = '';
  agentTokens.set(origin, () => sessionToken);
  /** Waits for the one-time code this launch printed, exchanges it, and hands the token to open browser contexts. */
  const authenticate = async (logStart: number): Promise<void> => {
    const deadline = Date.now() + PING_TIMEOUT_MS;
    let code: string | undefined;
    while (!code && Date.now() < deadline) {
      const printed = logBuffer
        .slice(logStart)
        .replaceAll(String.fromCharCode(27), ' ');
      code = printed.match(/#code=([A-Za-z0-9._~-]+)/)?.[1];
      if (!code) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!code) {
      throw new Error(
        `datatug serve printed no one-time #code= link within ${PING_TIMEOUT_MS}ms.\n` +
          `--- captured log (${logFile}) ---\n${logBuffer || '(empty)'}`,
      );
    }
    sessionToken = await exchangeCode(origin, code);
    await Promise.all(
      [...liveContexts].map(async (context) => {
        await installTokens(context, { [origin]: sessionToken }).catch(
          () => undefined,
        );
        // A restart ends the old session: pages that are already open must not keep sending the dead token.
        await Promise.all(
          context.pages().map((page) =>
            page
              .evaluate(
                ({ key, token }) => {
                  try {
                    localStorage.setItem(key, token);
                  } catch {
                    /* about:blank */
                  }
                },
                { key: SESSION_TOKEN_KEY_PREFIX + origin, token: sessionToken },
              )
              .catch(() => undefined),
          ),
        );
      }),
    );
  };
  const launch = async (): Promise<void> => {
    const logStart = logBuffer.length;
    exited = undefined;
    stopChildPromise = undefined;
    const launched = spawn(binResult.value, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Omitting `env` entirely (the pre-S174 behavior for every other agent)
      // inherits the parent process's full environment, unchanged. Only when
      // `personalDir` was seeded above do we need to layer `DATATUG_PERSONAL_DIR`
      // on top of that same inherited environment, not replace it.
      ...(personalDir
        ? { env: { ...process.env, DATATUG_PERSONAL_DIR: personalDir } }
        : {}),
    });
    child = launched;
    launched.stdout.on('data', appendLog);
    launched.stderr.on('data', appendLog);
    childExitPromise = new Promise<void>((resolve) => {
      let resolved = false;
      const resolveOnce = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      launched.once('exit', (code, signal) => {
        if (child === launched) {
          exited = { code, signal };
        }
        resolveOnce();
      });
      // A spawn failure emits `error` then `close`, but may never emit `exit`.
      launched.once('close', resolveOnce);
    });
    const spawnError = new Promise<never>((_, reject) => {
      launched.once('error', reject);
    });
    try {
      await Promise.race([waitForPing(pingUrl, PING_TIMEOUT_MS), spawnError]);
      await Promise.race([authenticate(logStart), spawnError]);
    } catch (err) {
      if (!exited) {
        launched.kill('SIGKILL');
      }
      await childExitPromise;
      const exitNote = launched.exitCode !== null || launched.signalCode !== null
        ? ` The process already exited (code=${launched.exitCode}, signal=${launched.signalCode}).`
        : '';
      throw new Error(
        `datatug serve (${binResult.value} ${args.join(' ')}) never answered ` +
          `${pingUrl}: ${String(err)}.${exitNote}\n` +
          `--- captured log (${logFile}) ---\n${logBuffer || '(empty)'}`,
        { cause: err },
      );
    }
  };

  const stopChild = async (): Promise<void> => {
    const running = child;
    const runningExit = childExitPromise;
    if (!running || !runningExit) {
      return;
    }
    if (stopChildPromise) {
      await stopChildPromise;
      return;
    }
    const stopping = (async () => {
      if (exited || running.exitCode !== null || running.signalCode !== null) {
        await runningExit;
        return;
      }
      running.kill('SIGTERM');
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const forced = new Promise<'forced'>((resolve) => {
        timeout = setTimeout(() => {
          running.kill('SIGKILL');
          resolve('forced');
        }, SHUTDOWN_TIMEOUT_MS);
      });
      const outcome = await Promise.race([
        runningExit.then(() => 'exited' as const),
        forced,
      ]);
      if (timeout) {
        clearTimeout(timeout);
      }
      if (outcome === 'forced') {
        // The listener was installed at launch, so an exit cannot race past
        // this await. Do not delete worker temp data while the child may still
        // hold files open.
        await runningExit;
      }
    })();
    stopChildPromise = stopping;
    try {
      await stopping;
    } finally {
      if (stopChildPromise === stopping) {
        stopChildPromise = undefined;
      }
    }
  };

  try {
    await launch();
  } catch (err) {
    logStream.end();
    if (isolatedProjectRoot) {
      fs.rmSync(isolatedProjectRoot, { recursive: true, force: true });
    }
    throw err;
  }

  const server: AgentServer = {
    host,
    port,
    storeId: `http-${host}:${port}`,
    demoDir,
    logFile,
    readLog: () => logBuffer,
    sessionToken: () => sessionToken,
    authHeaders: () => ({ authorization: `Bearer ${sessionToken}` }),
    restart: async () => {
      await stopChild();
      appendLog('\n--- restarting real datatug agent on the same URL ---\n');
      await launch();
    },
    personalDir,
  };

  const stop = async (): Promise<void> => {
    try {
      await stopChild();
      agentTokens.delete(origin);
    } finally {
      logStream.end();
      if (isolatedProjectRoot) {
        fs.rmSync(isolatedProjectRoot, { recursive: true, force: true });
      }
    }
  };

  return { ok: true, value: { server, stop } };
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- matches Playwright's own TestType<{}, W> shape
export const test = base.extend<{}, JourneyWorkerFixtures>({
  // This lane only talks to a local agent: count and detect DemoDB requests but install no route, for the tests of THIS fixture
  // only (see `demodbPassive` in helpers/demodb-guard.ts).
  demodbPassive: [true, { option: true }] as never,
  // Every browser context of this lane starts with the session tokens of the agents that are up, and gets the token of
  // an agent that starts (or restarts) later through `liveContexts`.
  context: async ({ context }, use) => {
    await installTokens(context, tokenSnapshot());
    liveContexts.add(context);
    try {
      await use(context);
    } finally {
      liveContexts.delete(context);
    }
  },
  // Direct `request.get/post(...)` calls to an agent carry that agent's session token, like the browser's do.
  request: async ({ request }, use) => {
    const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch']);
    const authenticated = new Proxy(request, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, target) as unknown;
        if (typeof property !== 'string' || !methods.has(property) || typeof value !== 'function') {
          return typeof value === 'function' ? value.bind(target) : Reflect.get(target, property, receiver);
        }
        return (url: string, options: { headers?: Record<string, string> } = {}) => {
          let origin = '';
          try { origin = new URL(url).origin; } catch { /* a Request object: pass through */ }
          const token = agentTokens.get(origin)?.();
          const call = value as (u: string, o: object) => Promise<unknown>;
          return call.call(
            target,
            url,
            token ? { ...options, headers: { authorization: `Bearer ${token}`, ...options.headers } } : options,
          );
        };
      },
    }) as APIRequestContext;
    await use(authenticated);
  },
  agentServer: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const started = await startAgent({
        as: 'admin',
        role: 'admin',
        label: 'admin',
        workerIndex: workerInfo.workerIndex,
        // S174: seeds this SAME admin agent's own `$DATATUG_PERSONAL_DIR`
        // with one query, so `root=personal` resolves to `user:admin` and
        // lists exactly this — see journey.spec.ts's "Personal queries tab"
        // describe block for the coverage this enables.
        personalQuery: { id: PERSONAL_QUERY_ID, title: PERSONAL_QUERY_TITLE },
      });
      if (!started.ok) {
        test.skip(true, started.skipReason);
        return;
      }
      await use(started.value.server);
      await started.value.stop();
    },
    { scope: 'worker' },
  ],
  incidentAgentServer: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const started = await startAgent({
        as: 'admin',
        role: 'admin',
        label: 'incidents',
        workerIndex: workerInfo.workerIndex,
        isolateProject: true,
        // Incident create is a real server mutation and datatug-cli fails
        // every mutation closed unless the operator opts the process in.
        extraArgs: ['--allow-writes'],
      });
      if (!started.ok) {
        test.skip(true, started.skipReason);
        return;
      }
      await use(started.value.server);
      await started.value.stop();
    },
    { scope: 'worker' },
  ],
  // S100 (J4, Feature core-investigation-loop "Restricted investigator") — its own
  // agent, restarted with `--as support --role support` rather than reusing
  // `agentServer`'s admin one. See this file's header for why one shared agent could
  // never do both: `--as`/`--role` are fixed at agent startup, and Investigation
  // Context is scoped by agent URL among other things.
  supportAgentServer: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const started = await startAgent({
        as: 'support',
        role: 'support',
        label: 'support',
        workerIndex: workerInfo.workerIndex,
      });
      if (!started.ok) {
        test.skip(true, started.skipReason);
        return;
      }
      await use(started.value.server);
      await started.value.stop();
    },
    { scope: 'worker' },
  ],
  // Phase 1 Task 14 (J2b) — admin principal, same as `agentServer`, but started with
  // `--http-offline` so the HTTP reference source's live fetch fails deterministically
  // (JourneyWorkerFixtures' own doc comment on why).
  offlineAgentServer: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const started = await startAgent({
        as: 'admin',
        role: 'admin',
        label: 'offline',
        workerIndex: workerInfo.workerIndex,
        extraArgs: ['--http-offline'],
      });
      if (!started.ok) {
        test.skip(true, started.skipReason);
        return;
      }
      await use(started.value.server);
      await started.value.stop();
    },
    { scope: 'worker' },
  ],
});

export { expect };
