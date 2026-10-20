import { test as base, expect } from '../../helpers/demodb-guard';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

/** One real writable CLI, private storage and a dynamic port per test. No AI provider. */
export const test = base.extend<{ continuityLink: string }>({
  // This lane only talks to a local agent: count and detect DemoDB requests but install no route, for the tests of THIS fixture
  // only (see `demodbPassive` in helpers/demodb-guard.ts).
  demodbPassive: [true, { option: true }] as never,
  continuityLink: async ({ baseURL }, use, testInfo) => {
    const external = process.env['DATATUG_SESSION_CONTINUITY_LINK_FILE'];
    if (external) {
      await use((await readFile(external, 'utf8')).trim());
      return;
    }
    const binary = process.env['DATATUG_BIN'];
    testInfo.skip(!binary, 'Set DATATUG_BIN to a released CLI for the real Session journey.');
    const root = await mkdtemp(join(tmpdir(), 'datatug-session-continuity-'));
    const project = join(root, 'project');
    await Promise.all(['daemon', 'policies', 'results', 'personal', 'evidence'].map(name => mkdir(join(root, name), { mode: 0o700 })));
    await mkdir(join(project, 'environments', 'local'), { recursive: true, mode: 0o700 });
    await mkdir(join(project, 'connections'), { mode: 0o700 });
    await writeFile(join(project, 'datatug-project.json'), JSON.stringify({ id: 'context-native-fixture', title: 'Session continuity', access: 'private', created: { at: '2026-01-01T00:00:00Z' }, environments: [{ id: 'local' }] }));
    await writeFile(join(project, 'environments/local/local.env.json'), JSON.stringify({ id: 'local', title: 'Local', dbServers: [{ driver: 'sqlite3', catalogs: ['chinook'] }] }));
    await writeFile(join(project, 'connections/demo-db.json'), JSON.stringify({ format: 'datatug-demo-connections/v1', connections: [{ id: 'chinook-sqlite', dataset: 'chinook', storage: 'sqlite', readiness: 'public-api', source: 'https://demodb.dev/ovdb/v1/databases/chinook', fixtureSha256: '7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15', browserFixture: { url: 'https://chinook.demodb.dev/data/chinook.sqlite', bytes: 1007616 } }] }));
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') { server.close(); reject(new Error('Unable to allocate CLI test port')); return; }
        server.close(error => error ? reject(error) : resolve(address.port));
      });
    });
    let output = '';
    let exited = false;
    const child = spawn(binary as string, ['serve', '--project', project, '--host', '127.0.0.1', '--port', String(port), '--allow-writes', '--as', 'session-continuity-test', '--evidence-dir', join(root, 'evidence')], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DATATUG_DAEMON_DIR: join(root, 'daemon'), DATATUG_POLICIES_DIR: join(root, 'policies'), DATATUG_SESSION_RESULTS_DIR: join(root, 'results'), DATATUG_PERSONAL_DIR: join(root, 'personal'), DATATUG_TELEMETRY: '0', DO_NOT_TRACK: '1' },
    });
    // Bootstrap codes stay only in bounded memory, never agent logs or test artifacts.
    child.stdout.on('data', chunk => { output = (output + String(chunk)).slice(-64 * 1024); });
    child.stderr.on('data', () => { /* Never publish process output that may contain access codes. */ });
    const exit = new Promise<void>(resolve => {
      child.once('exit', () => { exited = true; resolve(); });
      child.once('error', () => { exited = true; resolve(); });
    });
    try {
      await expect.poll(async () => {
        if (exited) throw new Error('The isolated Session CLI failed to start.');
        try {
          const response = await fetch(`http://127.0.0.1:${port}/datatug/ping`);
          return [200, 401].includes(response.status) && output.includes(`/store/http-127.0.0.1:${port}`);
        } catch { return false; }
      }, { timeout: 20_000 }).toBe(true);
      const terminalSafeOutput = output.replaceAll(String.fromCharCode(27), ' ');
      const issued = terminalSafeOutput.match(/https?:\/\/[^\s]+\/store\/http-127\.0\.0\.1:[0-9]+(?:#code=[A-Za-z0-9._~-]+)?/);
      const link = new URL(issued?.[0] ?? `https://datatug.app/store/http-127.0.0.1:${port}`);
      const origin = new URL(baseURL ?? 'http://localhost:4200');
      link.protocol = origin.protocol; link.host = origin.host;
      await use(link.toString());
    } finally {
      output = '';
      if (!exited) child.kill('SIGTERM');
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([exit, new Promise<void>(resolve => { timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5_000); })]);
      if (timer) clearTimeout(timer);
      await exit;
      await rm(root, { recursive: true, force: true });
    }
  },
});
export { expect };
