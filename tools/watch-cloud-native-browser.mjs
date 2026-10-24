// Opt-in acceptance against an already owned real backend/Firestore/CLI fixture.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const { values } = parseArgs({
  options: {
    'ready-file': { type: 'string' },
    'output-dir': { type: 'string' },
    case: { type: 'string', default: 'healthy' },
  },
});
const workspace = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
process.chdir(workspace);
const readyFile =
  values['ready-file'] || process.env.DATATUG_WATCH_NATIVE_READY;
if (!readyFile || fs.statSync(readyFile).size > 65536)
  throw Error('A bounded owned fixture ready file is required.');
const ready = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
function loopback(value, allowPath = false) {
  const url = new URL(value.includes('://') ? value : 'http://' + value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (!allowPath && url.pathname !== '/')
  )
    throw Error('Only explicit loopback fixture URLs are permitted.');
  return url;
}
const api = loopback(ready.apiBase),
  auth = loopback(ready.authEmulator),
  firestore = loopback(ready.firestoreEmulator);
if (
  !/^demo-[a-z0-9-]+$/.test(ready.projectID) ||
  ![ready.spaceID, ready.project, ready.environment, ready.checkID].every(
    (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v),
  )
)
  throw Error(
    'An isolated demo project and explicit fixture scope are required.',
  );
const email = process.env.DATATUG_WATCH_BROWSER_EMAIL,
  password = process.env.DATATUG_WATCH_BROWSER_PASSWORD;
if (!email || !password)
  throw Error(
    'Supply the emulator account email/password through the private environment.',
  );
if (!['healthy', 'partial-setup'].includes(values.case))
  throw Error('Unknown acceptance case.');
const out = path.resolve(
  values['output-dir'] ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'datatug-watch-native-browser-')),
);
if (
  !['/private/tmp/', '/tmp/', os.tmpdir() + path.sep].some((prefix) =>
    out.startsWith(prefix),
  )
)
  throw Error(
    'Browser artifacts must remain in a private temporary directory.',
  );
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
fs.chmodSync(out, 0o700);
const host = 'http://127.0.0.1:18848',
  base = `/space/${ready.spaceID}/store/firestore/project/${ready.project}`;
const watchAPI =
  api.origin +
  `/v0/datatug/watch/${ready.spaceID}/${ready.project}/${ready.environment}/v1/watch/`;
const generated = path.join(
  workspace,
  'apps/datatug-app/src/environments/environment.watch-native.generated.ts',
);
let preview, browser, build;
let ownsGenerated = false;
function child(command, args, env, logFile) {
  const log = fs.openSync(logFile, 'a', 0o600);
  const process = spawn(command, args, {
    cwd: workspace,
    env,
    stdio: ['ignore', log, log],
  });
  process.on('error', () => {
    process.watchSpawnFailed = true;
  });
  process.once('close', () => fs.closeSync(log));
  return process;
}
async function stop(process) {
  if (!process?.pid || process.exitCode !== null || process.signalCode !== null)
    return;
  const exited = once(process, 'close');
  const timer = setTimeout(() => process.kill('SIGKILL'), 5000);
  process.kill('SIGTERM');
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
async function portFree() {
  return new Promise((resolve, reject) => {
    const socket = net.connect(18848, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      reject(Error('Preview port 18848 is already owned; leave it untouched.'));
    });
    socket.once('error', (e) => {
      socket.destroy();
      e.code === 'ECONNREFUSED' ? resolve() : reject(e);
    });
  });
}
async function prepare() {
  const dirty = spawnSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    { encoding: 'utf8' },
  );
  if (dirty.status !== 0 || dirty.stdout.trim())
    throw Error(
      'Use a clean published checkpoint so HEAD identifies the tested UI source.',
    );
  await portFree();
  const guard = spawnSync('wb', ['worktree', 'guard', workspace], {
    stdio: 'inherit',
  });
  if (guard.status !== 0) throw Error('Use an authorized WB worktree.');
  const source = `export * from './environment.sso-e2e';\nimport { datatugAppEnvironmentConfig as base } from './environment.sso-e2e';\nimport { DatatugApiBaseUrl } from '@sneat/datatug-semantic';\nexport const datatugAppEnvironmentConfig={...base,firebaseConfig:{...base.firebaseConfig,projectId:${JSON.stringify(ready.projectID)},emulator:{authHost:${JSON.stringify(auth.hostname)},authPort:${auth.port},firestoreHost:${JSON.stringify(firestore.hostname)},firestorePort:${firestore.port}}}};\nexport const datatugEnvironmentProviders=[{provide:DatatugApiBaseUrl,useValue:${JSON.stringify(api.origin + '/v0/')}}];\n`;
  fs.writeFileSync(generated, source, { flag: 'wx', mode: 0o600 });
  ownsGenerated = true;
  try {
    const env = {
      ...process.env,
      NX_DAEMON: 'false',
      NX_ISOLATE_PLUGINS: 'false',
    };
    if (!env.GH_TOKEN) {
      const token = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
      if (token.status === 0) env.GH_TOKEN = token.stdout.trim();
    }
    build = child(
      'pnpm',
      [
        'nx',
        'run',
        'datatug-app:build',
        '--configuration=watch-native-e2e',
        '--skip-nx-cache',
        '--output-style=static',
      ],
      env,
      path.join(out, 'build.log'),
    );
    if ((await once(build, 'close'))[0] !== 0)
      throw Error('Fixture build failed; inspect private build.log.');
  } finally {
    if (ownsGenerated) {
      fs.unlinkSync(generated);
      ownsGenerated = false;
    }
  }
  preview = child(
    process.execPath,
    ['tools/serve-watch-preview.mjs'],
    { ...process.env, DATATUG_WATCH_UI_PORT: '18848' },
    path.join(out, 'preview.log'),
  );
  await expect
    .poll(
      async () => {
        try {
          if (preview.watchSpawnFailed) throw Error('Preview could not start.');
          return (await fetch(host)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 15000, intervals: [100, 250, 500] },
    )
    .toBe(200);
}
const candidate = spawnSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).stdout.trim();

(async () => {
  await prepare();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const watchPage = page.locator('sneat-datatug-watch-page:visible');
  page.setDefaultTimeout(10000);
  const starts = new Map(),
    snapshots = new Map(),
    requests = [],
    mutations = [];
  page.on('request', (r) => {
    if (r.url().startsWith(ready.apiBase))
      console.log('REQUEST', r.method(), new URL(r.url()).pathname);
  });
  page.on('requestfailed', (r) =>
    console.log(
      'REQUEST_FAILED',
      new URL(r.url()).pathname,
      r.failure()?.errorText,
    ),
  );
  let phase = 'sign-in',
    watchID,
    creationMS,
    enrollmentID;
  page.on('request', (r) => starts.set(r, Date.now()));
  page.on('response', async (r) => {
    const q = r.request();
    if (!q.url().startsWith(ready.apiBase)) return;
    const path = new URL(q.url()).pathname;
    try {
      await r.finished();
    } catch {
      return;
    }
    const receipt = {
      method: q.method(),
      path,
      status: r.status(),
      durationMS: Date.now() - starts.get(q),
    };
    requests.push(receipt);
    if (q.method() === 'POST') mutations.push(receipt);
    if (q.method() === 'GET' && /\/(runs|status|definition)$/.test(path)) {
      try {
        const body = await r.json();
        snapshots.set(path.split('/').pop(), body);
        fs.writeFileSync(
          out + '/' + path.split('/').pop() + '-last.json',
          JSON.stringify(body, null, 2),
        );
      } catch {}
    }
  });
  const settle = () =>
    page.evaluate(() =>
      Promise.all(
        document
          .getAnimations({ subtree: true })
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      ),
    );
  async function top() {
    await expect(watchPage).toHaveCount(1);
    await watchPage
      .locator(':scope > ion-content')
      .evaluate((e) => e.scrollToTop());
    await settle();
  }
  async function shot(name) {
    await settle();
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw Error('Horizontal overflow');
    await page.screenshot({ path: out + '/' + name + '.png', fullPage: true });
  }
  async function select(label, text) {
    await watchPage.locator(`ion-select[label="${label}"]`).click();
    await page.getByRole('radio', { name: text, exact: true }).click();
  }
  try {
    await page.goto(
      host + '/checkout/sign-in?plan=pro&period=monthly&checkout=test',
    );
    await page.locator('ion-segment-button[value="in"]').click();
    await page.locator('ion-input[name="email"] input').fill(email);
    await page
      .locator('ion-input[type="password"] input:not(.cloned-input)')
      .fill(password);
    await page
      .getByRole('button', { name: /^Sign in(?:\s+with password)?$/ })
      .click();
    await expect(
      page.getByText('Signed in as ' + email, { exact: true }),
    ).toBeVisible();
    phase = 'create form';
    await page.goto(
      host +
        base +
        '/watch/new?env=' +
        ready.environment +
        '&checkId=' +
        ready.checkID,
    );
    await expect(
      page.getByRole('heading', { name: 'Create Watch', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Coordinator user credential', { exact: true }),
    ).toHaveCount(0);
    await page
      .locator('ion-input[label="Title"] input:not(.cloned-input)')
      .fill('Browser carrier assignment');
    await page
      .getByRole('textbox', { name: 'order_id (required)', exact: true })
      .fill('11045');
    await page
      .locator(
        'ion-input[label="Evaluate every (seconds)"] input:not(.cloned-input)',
      )
      .fill('5');
    await select('Notify when', 'The Check passes');
    await select('First observation', 'Notify if already matching');
    await select('Mode', 'Once');
    await page
      .getByRole('checkbox', { name: 'Email · free', exact: true })
      .click();
    await expect(
      page.getByRole('checkbox', { name: 'Email · free', exact: true }),
    ).toBeChecked();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await top();
      await shot('create-' + width);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    phase = 'create subscription enable';
    const started = Date.now();
    if (values.case === 'partial-setup') {
      const marker = ready.subscriptionTimeoutFile;
      if (
        !marker ||
        path.resolve(marker) !==
          path.join(
            path.dirname(path.resolve(readyFile)),
            'timeout-next-subscription',
          )
      )
        throw Error(
          'This fixture does not expose the approved one-use transaction fault marker.',
        );
      fs.writeFileSync(marker, '1', { flag: 'wx', mode: 0o600 });
    }
    await page.getByRole('button', { name: 'Save Watch', exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp('/watch/[^/?]+\\?env=' + ready.environment + '$'),
      {
        timeout: 30000,
      },
    );
    creationMS = Date.now() - started;
    watchID = new URL(page.url()).pathname.split('/').pop();
    await page
      .getByText('Loading Watch…', { exact: true })
      .waitFor({ state: 'hidden', timeout: 30000 });
    await expect(
      page.getByRole('heading', {
        name: 'Browser carrier assignment',
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    await expect(watchPage).toHaveCount(1);
    if (values.case === 'partial-setup') {
      phase = 'fault-injected partial setup';
      await expect(page.getByRole('alert')).toContainText(
        'Notification setup or enabling was not confirmed',
      );
      await expect(
        page.getByRole('region', { name: 'Watch status and evaluations' }),
      ).toContainText('Paused');
      await expect
        .poll(() =>
          mutations.some(
            (r) => r.path.endsWith('/subscription') && r.status === 503,
          ),
        )
        .toBe(true);
      if (mutations.some((r) => r.path.endsWith('/lifecycle')))
        throw Error('Failed consent must not enable the Watch.');
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await top();
        await shot('partial-setup-' + width);
      }
      await page.reload();
      await page
        .getByText('Loading Watch…', { exact: true })
        .waitFor({ state: 'hidden', timeout: 30000 });
      await expect(
        page.getByRole('heading', {
          name: 'Browser carrier assignment',
          exact: true,
          level: 1,
        }),
      ).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(
        page.getByRole('region', { name: 'Watch status and evaluations' }),
      ).toContainText('Paused');
      await expect
        .poll(
          () =>
            snapshots.get('definition')?.definition?.id === watchID &&
            snapshots.get('definition')?.definition?.lifecycle === 'paused' &&
            snapshots.get('runs')?.runs?.length === 0,
        )
        .toBe(true);
      phase = 'pass';
      console.log('ACTUAL_HOST_PARTIAL_SETUP_PASS', watchID);
      return;
    }
    await expect(page.getByRole('alert')).toHaveCount(0);
    phase = 'real evaluation';
    await expect
      .poll(
        async () => {
          await watchPage
            .locator('ion-header')
            .getByRole('button', { name: 'Refresh', exact: true })
            .click();
          await expect(
            watchPage
              .locator('ion-header')
              .getByRole('button', { name: 'Refresh', exact: true }),
          ).toBeEnabled({ timeout: 15000 });
          return await watchPage.innerText();
        },
        { timeout: 60000, intervals: [2500] },
      )
      .toContain('Completed');
    await expect(
      page.getByRole('heading', { name: 'Evaluation history', exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        () =>
          snapshots.get('definition')?.definition?.id === watchID &&
          snapshots.get('definition')?.definition?.lifecycle === 'completed' &&
          snapshots
            .get('runs')
            ?.runs?.some(
              (run) =>
                run.watchId === watchID &&
                run.state === 'completed' &&
                run.outcome === 'pass' &&
                run.runnerId &&
                run.checkRunRef,
            ),
      )
      .toBe(true);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await top();
      await shot('detail-' + width);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    phase = 'cold detail and inbox';
    await page.reload();
    await expect(
      page.getByRole('heading', {
        name: 'Browser carrier assignment',
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    await expect(
      page.locator('a').filter({ hasText: 'Carrier assignment' }).first(),
    ).toHaveAttribute(
      'href',
      base + '/checks/' + ready.checkID + '?env=' + ready.environment,
    );
    const inbox = watchPage.locator('ion-card').filter({
      has: page.getByRole('heading', { name: 'Inbox', exact: true }),
    });
    const notification = inbox
      .getByRole('button', { name: /Browser carrier assignment/ })
      .first();
    await expect(notification).toBeVisible();
    const readResponse = page.waitForResponse(
      (r) => r.url() === watchAPI + 'read' && r.request().method() === 'POST',
    );
    await notification.click();
    expect((await readResponse).status()).toBe(200);
    await expect(page).toHaveURL(
      host + base + '/watch/' + watchID + '?env=' + ready.environment,
    );
    phase = 'runner enrollment setup';
    await page
      .getByRole('button', { name: 'Enroll runner', exact: true })
      .click();
    await watchPage.locator('ion-select[label="Allowed sources"]').click();
    await page.getByRole('checkbox', { name: /^native · / }).click();
    await page.keyboard.press('Escape');
    const grantResponse = page.waitForResponse(
      (r) =>
        r.url() === watchAPI + 'enrollments' && r.request().method() === 'POST',
    );
    await page
      .getByRole('button', { name: 'Create enrollment', exact: true })
      .click();
    const grant = await (await grantResponse).json();
    enrollmentID = grant.enrollment.id;
    await expect(page.getByLabel('One-time runner credential')).toHaveValue(
      /.{32,}/,
    );
    await expect(page.getByLabel('Trusted coordinator endpoint')).toHaveValue(
      watchAPI.replace(/\/v1\/watch\/$/, ''),
    );
    const setup = watchPage.locator('.setup-config');
    await expect(setup).toContainText('"allowOpaqueSQL": false');
    await expect(setup).not.toContainText(grant.token);
    await page.getByRole('button', { name: 'Dismiss credential' }).click();
    await expect(page.getByLabel('One-time runner credential')).toHaveCount(0);
    await page
      .getByRole('checkbox', {
        name: 'Allow this runner to execute native SQL',
        exact: true,
      })
      .click();
    await expect(setup).toContainText('"allowOpaqueSQL": true');
    await expect(
      page.getByRole('checkbox', {
        name: 'Allow this runner to execute native SQL',
        exact: true,
      }),
    ).toBeChecked();
    await page.keyboard.press('Tab');
    await page.mouse.move(0, 0);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page
        .getByText('Configure runner', { exact: true })
        .evaluate((e) => e.scrollIntoView({ block: 'start' }));
      await shot('setup-' + width);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const row = page.locator('ion-item').filter({
      has: page.getByRole('heading', { name: enrollmentID, exact: true }),
    });
    await row.getByRole('button', { name: 'Revoke', exact: true }).click();
    await page
      .getByRole('button', { name: 'Revoke enrollment', exact: true })
      .click();
    await expect(row.getByText('Revoked', { exact: true })).toBeVisible();
    phase = 'signout';
    await page.locator('ion-button[title="Sign-out"]').click();
    await expect(
      page.getByRole('heading', { name: 'Sign in to Watch' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Browser carrier assignment',
        exact: true,
        level: 1,
      }),
    ).toHaveCount(0);
    phase = 'pass';
    console.log('ACTUAL_HOST_BROWSER_PASS', watchID);
  } catch (e) {
    console.error('Diagnostic:', String(e?.message || e).split('\n')[0]);
    console.error(
      'Actual Watch acceptance failed during ' +
        phase +
        '. Inspect private receipt.',
    );
    if (await page.getByLabel('One-time runner credential').count())
      await page.getByRole('button', { name: 'Dismiss credential' }).click();
    if (!(await page.getByLabel('One-time runner credential').count()))
      await shot('failure');
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(
      out + '/receipt.json',
      JSON.stringify(
        {
          candidate,
          sourceClean: true,
          fixtureSourceHead: ready.sourceGitSHA,
          apiBase: ready.apiBase,
          phase,
          case: values.case,
          watchID,
          enrollmentID,
          creationMS,
          mutations,
          noMocks: true,
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(out + '/api.json', JSON.stringify(requests, null, 2));
    await context.close();
    await browser.close();
    await stop(preview);
  }
})().catch(async () => {
  await browser?.close();
  await stop(preview);
  if (ownsGenerated) fs.unlinkSync(generated);
  console.error('Actual Watch fixture setup failed; inspect private output.');
  process.exitCode = 1;
});

for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, async () => {
    await stop(build);
    await browser?.close();
    await stop(preview);
    if (ownsGenerated) fs.unlinkSync(generated);
    process.exit(130);
  });
