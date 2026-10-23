import type { Page } from '@playwright/test';
import { expect, test } from './helpers/demodb-guard';

const projectPath = '/store/http-localhost:19889/project/watch-demo';
const endpoint = 'http://localhost:19888';
const check = {
  id: 'shipping-carrier-assignment',
  title: 'Carrier assignment',
  version: 1,
  inputs: [
    {
      name: 'order_id',
      type: 'integer',
      cardinality: 'scalar',
      required: true,
    },
  ],
  steps: [],
};
const metadata = {
  id: 'watch-demo',
  title: 'Watch demo',
  access: 'public',
  environments: [{ id: 'training' }],
  coordination: { endpoint, namespace: 'northwind' },
};

async function install(page: Page) {
  let definition: Record<string, unknown> | undefined;
  let subscription = {
    watchId: '',
    channels: [] as string[],
    unsubscribed: true,
  };
  let read = false;
  const stages: string[] = [];
  await page.route('http://localhost:19889/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/agent-info'))
      return route.fulfill({
        json: {
          version: '0.100.0',
          securityContextId: 'watch-demo-context',
          principal: { id: 'alice', roles: ['admin'], groups: [] },
          projects: [{ id: 'watch-demo' }],
          capabilities: { protectedQueries: true, opaqueReadOnly: true },
        },
      });
    if (
      path.endsWith('/projects/project_summary') ||
      path.endsWith('/projects/project_full')
    )
      return route.fulfill({ json: metadata });
    if (path.endsWith('/projects/projects_summary'))
      return route.fulfill({ json: [metadata] });
    if (path.endsWith('/environments/all_environments'))
      return route.fulfill({ json: [{ id: 'training', dbServers: [] }] });
    if (path.endsWith('/environments/state'))
      return route.fulfill({
        status: 404,
        contentType: 'text/plain',
        body: '404 page not found\n',
      });
    if (path.endsWith('/detective/state'))
      return route.fulfill({
        json: {
          checks: [check],
          cases: [],
          runs: [],
          validators: [],
          queryValidators: [],
          scenarios: [],
          environments: ['training'],
          capabilities: {
            localOnly: true,
            canRead: true,
            canWrite: true,
            canRun: true,
            maxRows: 1000,
            maxFanout: 100,
          },
        },
      });
    return route.fulfill({ json: [] });
  });
  await page.route(`${endpoint}/v1/watch/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.split('/v1/watch/')[1];
    expect(route.request().headers()['authorization']).toBe(
      'Bearer browser-test-user',
    );
    const body =
      route.request().method() === 'POST' ? route.request().postDataJSON() : {};
    if (path === 'identity')
      return route.fulfill({
        json: {
          id: 'alice',
          namespace: 'northwind',
          project: 'watch-demo',
          environment: 'training',
          sharedEditor: true,
          tier: 'free',
          channels: { in_app: true, email: true, sms: false, telegram: true },
          telegramConnected: false,
          limits: {
            emailPerDay: 50,
            emailPerMinute: 5,
            smsPerDay: 10,
            smsPerMinute: 2,
            telegramPerDay: 100,
            telegramPerMinute: 5,
            minIntervalSeconds: 5,
            watchesPerUser: 100,
          },
        },
      });
    if (path === 'definitions')
      return route.fulfill({
        json: { definitions: definition ? [definition] : [] },
      });
    if (path === 'definition' && route.request().method() === 'POST') {
      stages.push('definition:' + body.definition.lifecycle);
      definition = { ...body.definition, version: 1 };
      return route.fulfill({ json: { definition } });
    }
    if (path === 'definition') return route.fulfill({ json: { definition } });
    if (path === 'subscription') {
      stages.push('subscription');
      subscription = { ...body };
      return route.fulfill({ json: { ok: true } });
    }
    if (path === 'subscriptions')
      return route.fulfill({ json: { subscription } });
    if (path === 'lifecycle') {
      stages.push('lifecycle:' + body.lifecycle);
      definition = {
        ...definition,
        lifecycle: body.lifecycle,
        enabled: body.lifecycle === 'enabled',
        version: Number(definition?.version) + 1,
      };
      return route.fulfill({ json: { definition } });
    }
    if (path === 'status')
      return route.fulfill({
        json: {
          coordinator: 'available',
          runners: [
            {
              id: 'runner-one',
              environment: 'training',
              lastSeen: new Date().toISOString(),
            },
          ],
          observations: definition
            ? [
                {
                  watchId: definition.id,
                  value: 'unknown',
                  availability: 'no_runner',
                  nextEvaluation: new Date().toISOString(),
                },
              ]
            : [],
        },
      });
    if (path === 'runs') return route.fulfill({ json: { runs: [] } });
    if (path === 'deliveries')
      return route.fulfill({ json: { deliveries: [] } });
    if (path === 'inbox')
      return route.fulfill({
        json: {
          notifications: definition
            ? [
                {
                  id: 'notification-one',
                  watchId: definition.id,
                  title: 'Watch update',
                  event: 'recovery',
                  createdAt: new Date().toISOString(),
                  readAt: read ? new Date().toISOString() : undefined,
                  link: '/untrusted-ignored',
                },
              ]
            : [],
        },
      });
    if (path === 'read') {
      read = true;
      return route.fulfill({ json: { ok: true } });
    }
    if (path === 'telegram/status')
      return route.fulfill({
        json: { connected: false, botUsername: 'ShippingWatchBot' },
      });
    if (path === 'telegram/connect')
      return route.fulfill({
        json: {
          url: 'https://t.me/ShippingWatchBot?start=watch-browsernonce',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      });
    return route.fulfill({
      status: 404,
      json: {
        error: { code: 'NOT_FOUND', message: 'Unsupported fixture route' },
      },
    });
  });
  return { stages, subscribedChannels: () => subscription.channels };
}

async function connect(page: Page) {
  await page
    .getByLabel('Coordinator user credential')
    .fill('browser-test-user');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('.connection-bar strong')).toBeVisible();
}

test('project Watch menu, paused creation consent, cold details and narrow inbox links', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const fixture = await install(page);
  await page.goto(`${projectPath}/checks/${check.id}`);
  const view = page.locator('sneat-datatug-checks-page');
  await expect(
    page.getByRole('heading', { name: 'Carrier assignment', exact: true }),
  ).toBeVisible();
  const rejectAnalytics = page.getByRole('button', {
    name: /^(Reject|Reject analytics)$/,
    exact: true,
  });
  if (await rejectAnalytics.isVisible()) await rejectAnalytics.click();
  await page.getByRole('button', { name: 'Create Watch', exact: true }).click();
  await expect(page).toHaveURL(
    /\/watch\/new\?checkId=shipping-carrier-assignment$/,
  );
  await expect(page.getByText(endpoint, { exact: true })).toBeVisible();
  await connect(page);
  await expect(
    page.getByRole('heading', { name: 'Create Watch', exact: true }),
  ).toBeVisible();
  await page.getByLabel('order_id (required)').fill('11045');
  await page
    .getByRole('checkbox', { name: 'Email · free', exact: true })
    .click();
  await expect(
    page.getByRole('checkbox', { name: 'Email · free', exact: true }),
  ).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('watch-create-1440.png') });
  await page.setViewportSize({ width: 390, height: 900 });
  await page
    .getByRole('heading', { name: 'Your notification channels', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('watch-create-channels-390.png'),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Save Watch', exact: true }).click();
  await expect(page).toHaveURL(/\/watch\/watch-[A-Za-z0-9-]+$/);
  await expect(
    page.getByRole('heading', { name: 'Create Watch', exact: true }),
  ).toBeHidden();
  expect(fixture.subscribedChannels()).toEqual(['in_app', 'email']);
  expect(fixture.stages).toEqual([
    'definition:paused',
    'subscription',
    'lifecycle:enabled',
  ]);
  await expect(
    page.getByText('Last observation:', { exact: false }),
  ).toContainText('Unknown');
  await expect(page.getByText('Email · free', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'SMS · paid accounts', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Connect Telegram', exact: true }),
  ).toBeVisible();
  await page.reload();
  await connect(page);
  await expect(
    page.getByRole('heading', {
      name: 'Carrier assignment Watch',
      exact: true,
    }),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole('heading', {
        name: 'Carrier assignment Watch',
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`watch-detail-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .locator('sneat-datatug-project-menu-top ion-item')
    .filter({ hasText: /^Watch$/ })
    .click();
  await expect(page).toHaveURL(projectPath + '/watch');
  await expect(
    page.getByRole('heading', { name: 'Watches', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Carrier assignment Watch',
      exact: true,
      level: 1,
    }),
  ).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('watch-list-1440.png') });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('watch-list-390.png') });
  await page
    .getByText('Watch update', { exact: false })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/watch\/watch-[A-Za-z0-9-]+$/);
  const details = page.locator('sneat-datatug-watch-page');
  await details.getByRole('link', { name: check.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/checks/' + check.id + '$'));
  await expect(view).toBeVisible();
  expect(errors).toEqual([]);
});
