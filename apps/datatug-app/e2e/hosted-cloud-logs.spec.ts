import { expect, test } from '@playwright/test';

const email = `cloud-logs-${crypto.randomUUID()}@example.test`;
const password = 'local-cloud-logs-fixture-password';
const projectID = 'demo-local-sneat-app';

test('signed-in user connects, queries, removes a view and revokes the Google grant', async ({
  page,
}) => {
  const seededUser = await page.request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=e2e',
    { data: { email, password, returnSecureToken: true } },
  );
  expect(seededUser.ok()).toBe(true);
  const { localId } = (await seededUser.json()) as { localId: string };
  const personalID = `personal_${localId}`;
  const userDocument = await page.request.patch(
    `http://127.0.0.1:8180/v1/projects/${projectID}/databases/(default)/documents/users/${localId}`,
    {
      data: {
        fields: {
          title: { stringValue: 'Cloud Logs Fixture' },
          email: { stringValue: email },
          emailIsVerified: { booleanValue: true },
          spaces: {
            mapValue: {
              fields: {
                [personalID]: {
                  mapValue: {
                    fields: {
                      title: { stringValue: 'Personal' },
                      type: { stringValue: 'personal' },
                      roles: {
                        arrayValue: {
                          values: [{ stringValue: 'owner' }],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          spaceIDs: {
            arrayValue: { values: [{ stringValue: personalID }] },
          },
        },
      },
    },
  );
  expect(userDocument.ok()).toBe(true);
  const personalSpace = await page.request.patch(
    `http://127.0.0.1:8180/v1/projects/${projectID}/databases/(default)/documents/spaces/${personalID}`,
    {
      data: {
        fields: {
          title: { stringValue: 'Personal' },
          type: { stringValue: 'personal' },
          userIDs: {
            arrayValue: { values: [{ stringValue: localId }] },
          },
        },
      },
    },
  );
  expect(personalSpace.ok()).toBe(true);
  await page.goto('/checkout/sign-in?plan=pro&period=monthly&checkout=test');
  const checkout = page.locator(
    'datatug-checkout-page.ion-page:not(.ion-page-hidden):not(.ion-page-invisible):has([data-checkout-page="authentication"])',
  );
  await expect(checkout).toHaveCount(1);
  // Ionic routes pointer events through the segment-button host rather than
  // the nested button with role=tab (Playwright would be intercepted there).
  await checkout.locator('ion-segment-button[value="in"]').click();
  await expect(checkout.getByRole('tab', { name: 'Sign in' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.locator('ion-input[name="email"] input').fill(email);
  const passwordInput = page.locator(
    'ion-input[type="password"] input:not(.cloned-input)',
  );
  await expect(passwordInput).toBeVisible();
  await passwordInput.fill(password);
  await page.getByRole('button', { name: /Sign in.*with password/ }).click();
  await expect(
    page.getByText(`Signed in as ${email}`, { exact: true }),
  ).toBeVisible({ timeout: 20_000 });

  const calls: Array<{
    method: string;
    path: string;
    body?: Record<string, unknown>;
  }> = [];
  let connected = false;
  let disconnected = false;
  let finished = false;
  await page.route('**/v0/datatug/me/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body =
      request.method() === 'POST'
        ? (request.postDataJSON() as Record<string, unknown>)
        : undefined;
    calls.push({ method: request.method(), path: url.pathname, body });
    if (!request.headers()['authorization']?.startsWith('Bearer ')) {
      await route.fulfill({ status: 401, json: { error: 'unauthorized' } });
      return;
    }
    if (
      request.method() === 'GET' &&
      url.pathname.endsWith('/me/log-connections')
    ) {
      await route.fulfill({
        status: 200,
        json: {
          grants: [
            {
              id: 'grant-1',
              email: 'investigator@example.test',
              state: disconnected ? 'revocation_pending' : 'active',
            },
            ...(finished
              ? [
                  {
                    id: 'grant-finished',
                    email: 'new-owner@example.test',
                    state: 'active',
                    previousRevocationUnconfirmed: true,
                  },
                ]
              : []),
          ],
          connections:
            connected && !disconnected
              ? [
                  {
                    id: 'view-1',
                    grantId: 'grant-1',
                    projectId: 'billing-prod',
                    logViewId:
                      'projects/billing-prod/locations/global/buckets/_Default/views/hosted',
                    active: true,
                  },
                ]
              : [],
        },
      });
      return;
    }
    if (
      request.method() === 'POST' &&
      url.pathname.endsWith('/me/google-log-grants/oauth/finish')
    ) {
      finished = true;
      await route.fulfill({
        status: 200,
        json: {
          id: 'grant-finished',
          email: 'new-owner@example.test',
          state: 'active',
          previousRevocationUnconfirmed: true,
        },
      });
      return;
    }
    if (
      request.method() === 'POST' &&
      url.pathname.endsWith('/me/log-connections') &&
      !url.pathname.endsWith('/query')
    ) {
      connected = true;
      await route.fulfill({
        status: 200,
        json: {
          id: 'view-1',
          grantId: 'grant-1',
          projectId: 'billing-prod',
          logViewId:
            'projects/billing-prod/locations/global/buckets/_Default/views/hosted',
          active: true,
        },
      });
      return;
    }
    if (
      request.method() === 'POST' &&
      url.pathname.endsWith('/me/log-connections/query')
    ) {
      await route.fulfill({
        status: 200,
        json: {
          entries: [
            {
              timestamp: '2026-10-19T10:00:00Z',
              severity: 'ERROR',
              source: 'projects/billing-prod',
              message: 'Invoice request failed',
              orderId: 'order-4',
              correlationId: 'corr-9',
              service: 'billing-api',
              fields: { order_id: 'order-4' },
              raw: {
                jsonPayload: {
                  order_id: 'order-4',
                  detail: 'Synthetic failure evidence',
                },
              },
              sourceRef: 'versioned:fixture:entry-1',
            },
          ],
          capped: true,
          morePossible: true,
        },
      });
      return;
    }
    if (
      request.method() === 'POST' &&
      url.pathname.endsWith('/me/log-connections/remove')
    ) {
      connected = false;
      await route.fulfill({ status: 200, json: { removed: true } });
      return;
    }
    if (
      request.method() === 'POST' &&
      url.pathname.endsWith('/me/google-log-grants/disconnect')
    ) {
      disconnected = true;
      await route.fulfill({
        status: 200,
        json: { state: 'revocation_pending' },
      });
      return;
    }
    await route.fulfill({ status: 404, json: { error: 'not_found' } });
  });

  await page.evaluate(() =>
    sessionStorage.setItem('datatug:google-cloud-logs:finish-key', 'tab-key'),
  );
  await page.goto('/my/cloud-logs?googleLogs=complete&receipt=opaque-receipt');
  await expect(page).toHaveURL(/\/my\/cloud-logs$/);
  await expect(
    page
      .locator('article.account')
      .filter({ hasText: 'new-owner@example.test' })
      .getByText('new-owner@example.test', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Review Google Account access controls/),
  ).toBeVisible();
  expect(
    calls.find((call) =>
      call.path.endsWith('/me/google-log-grants/oauth/finish'),
    )?.body,
  ).toEqual({ receipt: 'opaque-receipt', finishKey: 'tab-key' });
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('datatug:google-cloud-logs:finish-key'),
    ),
  ).toBeNull();

  await page.goto('/my/cloud-logs');
  await expect(
    page.getByText(/Review Google Account access controls/),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Personal Google Cloud log views' }),
  ).toBeVisible();
  await expect(page.getByText('investigator@example.test')).toBeVisible();
  await page
    .getByLabel('Google Cloud project ID')
    .locator('input')
    .fill('billing-prod');
  await page
    .getByLabel('Full log view resource name')
    .locator('input')
    .fill(
      'projects/billing-prod/locations/global/buckets/_Default/views/hosted',
    );
  await page.getByRole('button', { name: 'Probe and connect view' }).click();
  await expect(
    page.getByText(
      'projects/billing-prod/locations/global/buckets/_Default/views/hosted',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'View logs' }).click();
  await page.getByLabel('Order ID').locator('input').fill('order-4');
  await page.getByLabel('Correlation ID').locator('input').fill('corr-9');
  await page.getByLabel('Service').locator('input').fill('billing-api');
  await page.getByRole('button', { name: 'Find evidence' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'result cap reached' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Invoice request failed/ }).click();
  await expect(page.getByText('Synthetic failure evidence')).toBeVisible();
  await expect(
    page.getByText(/Record navigation requires a destination/),
  ).toBeVisible();
  const query = calls.find((call) =>
    call.path.endsWith('/me/log-connections/query'),
  )?.body;
  expect(query).toMatchObject({
    connectionId: 'view-1',
    orderId: 'order-4',
    correlationId: 'corr-9',
    service: 'billing-api',
  });
  expect(Object.keys(query ?? {}).sort()).toEqual([
    'connectionId',
    'correlationId',
    'from',
    'orderId',
    'service',
    'to',
  ]);

  await page.getByRole('button', { name: 'Remove view' }).click();
  await expect(page.getByText('No log views connected.')).toBeVisible();
  await page
    .locator('article.account')
    .filter({ hasText: 'investigator@example.test' })
    .getByRole('button', { name: 'Disconnect Google account' })
    .click();
  await expect(
    page.getByText(/asks Google to revoke this integration grant/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Confirm disconnect' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'revocation is being completed' }),
  ).toBeVisible();
  expect(calls.map((call) => call.path)).toContain(
    '/v0/datatug/me/log-connections',
  );
});
