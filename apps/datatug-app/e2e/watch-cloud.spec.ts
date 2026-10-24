import { expect, test } from './helpers/demodb-guard';
import { SIGN_IN_BUTTON } from './helpers/sign-in-button';

test('hosted Watch uses real Firebase sign-in, scoped API, environment links and operator consent (mock contract)', async ({
  page,
}, testInfo) => {
  const email = `watch-${crypto.randomUUID()}@example.test`,
    password = 'local-watch-fixture-password';
  const signup = await page.request.post(
    'http://127.0.0.1:18288/identitytoolkit.googleapis.com/v1/accounts:signUp?key=e2e',
    { data: { email, password, returnSecureToken: true } },
  );
  expect(signup.ok()).toBe(true);
  const { localId } = await signup.json();
  const spaceID = `personal_${localId}`,
    project = 'watch-fixture';
  const documents =
    'http://127.0.0.1:18289/v1/projects/demo-local-sneat-app/databases/(default)/documents';
  const str = (value: string) => ({ stringValue: value }),
    arr = (values: string[]) => ({ arrayValue: { values: values.map(str) } });
  const seed = async (path: string, fields: Record<string, unknown>) =>
    expect(
      (
        await page.request.patch(`${documents}/${path}`, { data: { fields } })
      ).ok(),
    ).toBe(true);
  await seed(`users/${localId}`, {
    title: str('Watch fixture'),
    email: str(email),
    emailIsVerified: { booleanValue: true },
    spaceIDs: arr([spaceID]),
    spaces: {
      mapValue: {
        fields: {
          [spaceID]: {
            mapValue: {
              fields: {
                title: str('Personal'),
                type: str('personal'),
                roles: arr(['owner']),
              },
            },
          },
        },
      },
    },
  });
  await seed(`spaces/${spaceID}`, {
    title: str('Personal'),
    type: str('personal'),
    userIDs: arr([localId]),
  });
  await seed(`spaces/${spaceID}/ext/datatug/projects/${project}`, {
    title: str('Watch fixture'),
    access: str('protected'),
    createdBy: str(localId),
  });
  const base = `/space/${spaceID}/store/firestore/project/${project}`,
    scope = { namespace: spaceID, project, environment: 'dev' };
  let watch: Record<string, unknown> | undefined;
  let enrollment: Record<string, unknown> | undefined;
  let subscribed = false;
  let read = false;
  const writes: string[] = [];
  await page.route('http://127.0.0.1:8090/v0/**', (route) =>
    route.fulfill({ json: {} }),
  );
  await page.route('http://127.0.0.1:18290/v0/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    expect(request.headers()['authorization']).toMatch(/^Bearer /);
    const path = url.pathname,
      body = request.method() === 'POST' ? request.postDataJSON() : {};
    if (path.endsWith('/environments/state'))
      return route.fulfill({
        json: {
          contract: 'environment-state/1',
          scope: {
            storeId: 'firestore',
            spaceID,
            projectId: project,
            authorityId: 'fixture',
          },
          scopeBinding: 'a'.repeat(64),
          revision: '1',
          environments: [
            { id: 'dev', title: 'Development' },
            { id: 'prod', title: 'Production' },
          ],
          savedOrder: null,
          order: ['dev', 'prod'],
          needsRepair: false,
          capabilities: {
            canReadOrder: true,
            canWriteOrder: true,
            canCreateEnvironment: true,
          },
        },
      });
    if (path.endsWith('/detective/state'))
      return route.fulfill({
        json: {
          checks: [
            {
              id: 'health',
              title: 'Source health',
              version: 1,
              inputs: [],
              steps: [],
            },
          ],
          cases: [],
          runs: [],
          validators: [],
          queryValidators: [],
          scenarios: [],
          environments: ['dev', 'prod'],
          capabilities: { canRead: true, canWrite: true, canRun: true },
        },
      });
    if (!path.includes('/v1/watch/')) return route.fulfill({ json: {} });
    expect(path).toContain(
      `/datatug/watch/${spaceID}/${project}/dev/v1/watch/`,
    );
    expect(url.searchParams.has('namespace')).toBe(false);
    const endpoint = path.split('/v1/watch/')[1];
    if (request.method() === 'POST') writes.push(endpoint);
    if (endpoint === 'identity')
      return route.fulfill({
        json: {
          ...scope,
          id: localId,
          spaceID,
          hosted: true,
          sharedEditor: true,
          canManageRunners: true,
          tier: 'free',
          channels: { in_app: true, email: true, sms: false, telegram: false },
          limits: {
            emailPerDay: 50,
            emailPerMinute: 5,
            smsPerDay: 10,
            smsPerMinute: 2,
            minIntervalSeconds: 5,
          },
        },
      });
    if (endpoint === 'definitions')
      return route.fulfill({ json: { definitions: watch ? [watch] : [] } });
    if (endpoint === 'definition' && request.method() === 'POST') {
      expect(body.definition.lifecycle).toBe('paused');
      watch = { ...body.definition, id: 'returned-watch', version: 1 };
      return route.fulfill({ json: { definition: watch } });
    }
    if (endpoint === 'definition')
      return route.fulfill({ json: { definition: watch } });
    if (endpoint === 'subscription') {
      subscribed = !body.unsubscribed;
      return route.fulfill({ json: { ok: true } });
    }
    if (endpoint === 'subscriptions')
      return route.fulfill({
        json: {
          subscription: {
            watchId: 'returned-watch',
            channels: ['in_app', 'email'],
            unsubscribed: !subscribed,
          },
        },
      });
    if (endpoint === 'lifecycle') {
      expect(subscribed).toBe(true);
      watch = {
        ...watch,
        lifecycle: body.lifecycle,
        enabled: body.lifecycle === 'enabled',
        version: Number(watch?.version) + 1,
      };
      return route.fulfill({ json: { definition: watch } });
    }
    if (endpoint === 'status')
      return route.fulfill({
        json: { coordinator: 'online', runners: [], observations: [] },
      });
    if (endpoint === 'runs') return route.fulfill({ json: { runs: [] } });
    if (endpoint === 'deliveries')
      return route.fulfill({ json: { deliveries: [] } });
    if (endpoint === 'inbox')
      return route.fulfill({
        json: {
          notifications: watch
            ? [
                {
                  id: 'event-one',
                  watchId: 'returned-watch',
                  title: 'Source health update',
                  event: 'recovery',
                  createdAt: new Date().toISOString(),
                  ...(read ? { readAt: new Date().toISOString() } : {}),
                  link: '',
                },
              ]
            : [],
        },
      });
    if (endpoint === 'read') {
      read = true;
      return route.fulfill({ json: { ok: true } });
    }
    if (endpoint === 'sources')
      return route.fulfill({
        json: {
          sources: [
            { id: 'a'.repeat(64), kind: 'native', database: 'Local source' },
          ],
        },
      });
    if (endpoint === 'enrollments' && request.method() === 'POST') {
      expect(body.sourceIDs).toEqual(['a'.repeat(64)]);
      enrollment = {
        id: 'runner-fixture',
        scope,
        ownerId: localId,
        sourceIDs: body.sourceIDs,
        capabilities: [],
        revision: 1,
        revoked: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: '2030-01-01T00:00:00Z',
      };
      return route.fulfill({
        json: { enrollment, token: 'mock-one-time-runner-credential' },
      });
    }
    if (endpoint === 'enrollments')
      return route.fulfill({
        json: { enrollments: enrollment ? [enrollment] : [] },
      });
    if (endpoint === 'enrollments/revoke') {
      expect(body.expectedRevision).toBe(1);
      enrollment = { ...enrollment, revoked: true, revision: 2 };
      return route.fulfill({ json: { enrollment } });
    }
    return route.fulfill({
      status: 404,
      json: {
        error: { message: `Unhandled Watch fixture endpoint ${endpoint}` },
      },
    });
  });
  await page.goto(`${base}/watch?env=dev`);
  await expect(
    page.getByRole('heading', { name: 'Sign in to Watch' }),
  ).toBeVisible();
  await page.goto('/checkout/sign-in?plan=pro&period=monthly&checkout=test');
  await page.locator('ion-segment-button[value="in"]').click();
  await page.locator('ion-input[name="email"] input').fill(email);
  await page
    .locator('ion-input[type="password"] input:not(.cloned-input)')
    .fill(password);
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
  await expect(
    page.getByText(`Signed in as ${email}`, { exact: true }),
  ).toBeVisible();
  await page.goto(`${base}/watch/new?env=dev&checkId=health`);
  await expect(
    page.getByRole('heading', { name: 'Create Watch', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Coordinator user credential', { exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Save Watch', exact: true }).click();
  await expect(page).toHaveURL(`${base}/watch/returned-watch?env=dev`);
  expect(writes.indexOf('subscription')).toBeLessThan(
    writes.indexOf('lifecycle'),
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Source health Watch', exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('a').filter({ hasText: 'Source health' }),
  ).toHaveAttribute('href', `${base}/checks/health?env=dev`);
  await page
    .getByRole('button', { name: 'Enroll runner', exact: true })
    .click();
  await page.locator('ion-select[label="Allowed sources"]').click();
  await page
    .getByRole('checkbox', { name: 'native · Local source', exact: true })
    .click();
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Create enrollment', exact: true })
    .click();
  await expect(page.getByLabel('One-time runner credential')).toHaveValue(
    'mock-one-time-runner-credential',
  );
  await page.getByRole('button', { name: 'Dismiss credential' }).click();
  await expect(page.getByLabel('One-time runner credential')).toHaveCount(0);
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await page
    .getByRole('button', { name: 'Revoke enrollment', exact: true })
    .click();
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole('heading', { name: 'Source health Watch', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .locator('sneat-datatug-watch-page ion-content')
      .evaluate((element) =>
        (
          element as HTMLElement & { scrollToTop: () => Promise<void> }
        ).scrollToTop(),
      );
    await page.screenshot({
      path: testInfo.outputPath(`hosted-watch-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByText('Source health update', { exact: false }).click();
  await expect(page).toHaveURL(`${base}/watch/returned-watch?env=dev`);
  expect(read).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('ion-button[title="Sign-out"]').click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to Watch' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Source health Watch', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('runner-fixture', { exact: true })).toHaveCount(
    0,
  );
});
