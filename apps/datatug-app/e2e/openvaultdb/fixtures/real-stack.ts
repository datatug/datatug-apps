import { expect, test as base } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

interface RealStack {
  readonly launchPath: string;
  readonly agentOrigin: string;
  readonly logFiles: readonly string[];
}
interface WorkerFixtures {
  realStack: RealStack;
}
const START_TIMEOUT = 45_000;

function repositoryRoot(start: string): string {
  let current = start;
  while (!fs.existsSync(path.join(current, 'nx.json'))) {
    const parent = path.dirname(current);
    if (parent === current)
      throw new Error('could not locate the DataTug apps repository');
    current = parent;
  }
  return current;
}
const repoRoot = repositoryRoot(__dirname);

function executable(
  envName: string,
  sourceEnv: string,
  buildDir: string,
): string {
  const configured = process.env[envName];
  if (configured) return path.resolve(configured);
  const source = process.env[sourceEnv];
  if (!source)
    throw new Error(
      `set ${envName} to a binary or ${sourceEnv} to its source checkout`,
    );
  fs.mkdirSync(buildDir, { recursive: true, mode: 0o700 });
  const output = path.join(buildDir, envName.toLowerCase());
  const args =
    envName === 'OVDB_E2E_BIN'
      ? ['build', '-o', output, './examples/layered-acl']
      : ['build', '-o', output, '.'];
  const built = spawnSync('go', args, {
    cwd: path.resolve(source),
    encoding: 'utf8',
  });
  if (built.status !== 0)
    throw new Error(
      `${envName} build failed (exit ${built.status ?? 'unknown'})`,
    );
  return output;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string')
        return reject(new Error('port allocation failed'));
      server.close(() => resolve(address.port));
    });
  });
}

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.status < 500) return;
    } catch {
      /* startup race */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(
    `local service did not become ready at ${new URL(url).origin}`,
  );
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
function capture(child: ChildProcess, file: string): void {
  const stream = fs.createWriteStream(file, { flags: 'w', mode: 0o600 });
  child.stdout?.pipe(stream);
  child.stderr?.pipe(stream);
}

function earlyExit(child: ChildProcess, name: string): Promise<never> {
  return new Promise((_, reject) => {
    child.once('error', () => reject(new Error(`${name} could not start`)));
    child.once('exit', (code, signal) =>
      reject(
        new Error(
          `${name} exited before readiness (code ${code ?? 'none'}, signal ${signal ?? 'none'})`,
        ),
      ),
    );
  });
}

export const test = base.extend<{}, WorkerFixtures>({
  realStack: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'datatug-ovdb-e2e-'));
      fs.chmodSync(root, 0o700);
      const buildDir = path.join(root, 'built');
      const cli = executable('DATATUG_E2E_BIN', 'DATATUG_CLI_DIR', buildDir);
      const ovdb = executable('OVDB_E2E_BIN', 'OVDB_SOURCE_DIR', buildDir);
      const logs = path.join(
        repoRoot,
        'coverage',
        'apps',
        'datatug-app-e2e',
        'openvaultdb',
      );
      fs.mkdirSync(logs, { recursive: true });
      const ovdbLog = path.join(
        logs,
        `ovdb-worker-${workerInfo.workerIndex}.log`,
      );
      const agentLog = path.join(
        logs,
        `agent-worker-${workerInfo.workerIndex}.log`,
      );
      const queryToken = randomBytes(32).toString('base64url');
      const ownerToken = randomBytes(32).toString('base64url');
      const ovdbPort = await freePort();
      const agentPort = await freePort();
      const appOrigin =
        process.env['DATATUG_E2E_APP_ORIGIN'] ?? 'http://127.0.0.1:4200';
      const ovdbOrigin = `http://127.0.0.1:${ovdbPort}`;
      const agentOrigin = `http://127.0.0.1:${agentPort}`;
      const ovdbProcess = spawn(
        ovdb,
        [
          '-dir',
          path.join(root, 'fixtures'),
          '-listen',
          `127.0.0.1:${ovdbPort}`,
        ],
        {
          env: {
            ...process.env,
            OVDB_OWNER_TOKEN: ownerToken,
            OVDB_QUERY_TOKEN: queryToken,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      capture(ovdbProcess, ovdbLog);
      let agentProcess: ChildProcess | undefined;
      try {
        const binDir = path.join(root, 'bin');
        const handoff = path.join(root, 'handoff.txt');
        fs.mkdirSync(binDir, { mode: 0o700 });
        const configFile = path.join(root, 'datatug.yaml');
        fs.writeFileSync(
          configFile,
          `webui:\n  origin: ${appOrigin}\nopenvaultdb:\n  targets:\n    sqlite:\n      baseUrl: ${ovdbOrigin}\n      databaseId: sqlite\n      tokenEnv: OVDB_QUERY_TOKEN\n    ingitdb:\n      baseUrl: ${ovdbOrigin}\n      databaseId: ingitdb\n      tokenEnv: OVDB_QUERY_TOKEN\n`,
          { mode: 0o600 },
        );
        const opener = path.join(binDir, 'xdg-open');
        fs.writeFileSync(
          opener,
          '#!/bin/sh\numask 077\nprintf "%s" "$1" > "$DATATUG_E2E_HANDOFF"\n',
          { mode: 0o700 },
        );
        await Promise.race([
          waitFor(`${ovdbOrigin}/v1/status`),
          earlyExit(ovdbProcess, 'OpenVaultDB'),
        ]);
        agentProcess = spawn(
          cli,
          [
            'serve',
            '--config',
            configFile,
            '--host',
            '127.0.0.1',
            '--port',
            String(agentPort),
          ],
          {
            env: {
              ...process.env,
              PATH: `${binDir}${path.delimiter}${process.env['PATH'] ?? ''}`,
              OVDB_QUERY_TOKEN: queryToken,
              DATATUG_E2E_HANDOFF: handoff,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        capture(agentProcess, agentLog);
        await Promise.race([
          waitFor(`${agentOrigin}/datatug/ping`),
          earlyExit(agentProcess, 'DataTug'),
        ]);
        const deadline = Date.now() + START_TIMEOUT;
        while (!fs.existsSync(handoff) && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 50));
        if (!fs.existsSync(handoff))
          throw new Error('DataTug did not create its browser handoff');
        const parsed = new URL(fs.readFileSync(handoff, 'utf8'));
        if (
          parsed.origin !== appOrigin ||
          !parsed.hash.startsWith('#agentToken=')
        )
          throw new Error('DataTug produced an invalid browser handoff');
        await use({
          launchPath: `${parsed.pathname}${parsed.search}${parsed.hash}`,
          agentOrigin,
          logFiles: [agentLog, ovdbLog],
        });
      } finally {
        await Promise.all([
          ...(agentProcess ? [stop(agentProcess)] : []),
          stop(ovdbProcess),
        ]);
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    { scope: 'worker', timeout: 120_000 },
  ],
});
export { expect };
