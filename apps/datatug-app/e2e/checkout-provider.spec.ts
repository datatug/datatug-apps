import { expect, test } from './fixtures/checkout-test-buyer';
import { TEST_CHECKOUT_ORIGIN } from '../src/app/checkout/checkout-config.mjs';

const origin = 'http://datatug.localhost:4328';

test.skip(
  process.env.DATATUG_CHECKOUT_PROVIDER_TEST !== '1',
  'Deployed-provider checks require the explicit isolated TEST opt-in.',
);

test('deployed TEST catalog and shared purchase preflights accept the approved local origin', async ({
  request,
}) => {
  const response = await request.get(
    `${TEST_CHECKOUT_ORIGIN}/v0/checkout/config?site=datatug&mode=test`,
    { headers: { Origin: origin } },
  );
  expect(response.status()).toBe(200);
  expect(response.headers()['access-control-allow-origin']).toBe(origin);
  const config = await response.json();
  expect(config.site).toBe('datatug');
  expect(config.mode).toBe('test');
  expect(config.publishableKey?.startsWith('pk_test_')).toBe(true);
  for (const id of [
    'datatug-pro-monthly',
    'datatug-pro-annual',
    'datatug-business-usage-monthly',
    'datatug-business-usage-annual',
  ])
    expect(config.plans).toContainEqual(
      expect.objectContaining({
        id,
        accountKind: id.includes('business') ? 'organisation' : 'personal',
      }),
    );
  for (const path of ['session', 'purchase-setup', 'purchase-options']) {
    const preflight = await request.fetch(
      `${TEST_CHECKOUT_ORIGIN}/v0/checkout/${path}`,
      {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      },
    );
    expect(preflight.ok(), `TEST preflight for ${path}`).toBe(true);
    expect(preflight.headers()['access-control-allow-origin']).toBe(origin);
  }
});

for (const kind of ['pro', 'business'])
  test(`${kind}: real TEST quote mounts the provider form without submitting payment`, async ({
    page,
    signedInTestBuyer,
  }) => {
    void signedInTestBuyer;
    const checkoutRequests: string[] = [];
    await page.route('**/v0/checkout/**', async (route) => {
      const url = new URL(route.request().url());
      checkoutRequests.push(url.pathname);
      // Fail closed before forwarding any checkout request to a live host.
      if (url.origin !== TEST_CHECKOUT_ORIGIN) {
        await route.abort();
        return;
      }
      await route.continue();
    });
    const session = page.waitForResponse(
      (response) =>
        response.url() === `${TEST_CHECKOUT_ORIGIN}/v0/checkout/session` &&
        response.request().method() === 'POST',
    );
    await page.goto(
      kind === 'pro'
        ? '/subscribe?plan=pro&period=monthly&checkout=test'
        : `/business/checkout?planID=datatug-business-usage-monthly&checkout=test&purchaseId=${crypto.randomUUID()}`,
    );
    const quoteResponse = await session;
    expect(quoteResponse.status()).toBe(200);
    const quote = await quoteResponse.json();
    expect(quote.mode).toBe('test');
    expect(quote.sessionId?.startsWith('cs_test_')).toBe(true);
    expect(quote.accountKind).toBe(
      kind === 'business' ? 'organisation' : 'personal',
    );
    await expect(page.locator('sneat-auth-panel')).toBeHidden();
    await expect(page.locator('ion-menu')).toBeHidden();
    await expect(page.locator('#business-destination')).toHaveCount(0);
    await page
      .getByLabel(
        'I understand this is early access and my subscription starts now.',
      )
      .check();
    await page
      .getByRole('button', { name: 'Continue to payment', exact: true })
      .click();
    await expect(
      page.getByText('Enter payment details in the secure form.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.locator('section[aria-label="Payment"] iframe'),
    ).toBeVisible();
    const payment = page.frameLocator('section[aria-label="Payment"] iframe');
    await expect(payment.getByText('Test Mode', { exact: true })).toBeVisible();
    await expect(
      payment.getByRole('heading', {
        name: `Subscribe to DataTug ${kind === 'pro' ? 'Pro' : 'Business'}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      payment.getByRole('button', { name: 'Pay and subscribe', exact: true }),
    ).toBeVisible();
    expect(
      checkoutRequests.some((path) => path.endsWith('/purchase-setup')),
    ).toBe(false);
    // Deliberately stop at the real unpaid form. No card entry, Pay click,
    // subscription activation, cancellation or permission change occurs here.
  });

test('an existing paid TEST return reconciles without creating another session or changing its space', async ({
  page,
  signedInTestBuyer,
}) => {
  test.setTimeout(120000);
  void signedInTestBuyer;
  const sessionId = process.env.DATATUG_CHECKOUT_TEST_RETURN_SESSION;
  test.skip(
    !sessionId,
    'Requires designated buyer auth state and an existing paid TEST session; this test never creates a payment.',
  );
  if (!sessionId) throw new Error('Missing existing paid TEST session');
  expect(/^cs_test_[A-Za-z0-9]+$/.test(sessionId)).toBe(true);
  const writes: string[] = [];
  await page.route('**/v0/checkout/**', async (route) => {
    const request = route.request();
    if (
      new URL(request.url()).origin !== TEST_CHECKOUT_ORIGIN ||
      request.method() !== 'GET'
    ) {
      writes.push(request.method());
      await route.abort();
      return;
    }
    await route.continue();
  });
  const statusResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/v0/checkout/session-status' &&
      response.request().method() === 'GET',
  );
  await page.goto(
    `/pricing/return?mode=test&session_id=${encodeURIComponent(sessionId)}`,
  );
  const response = await statusResponse;
  expect(response.status()).toBe(200);
  let status = await response.json();
  expect(status.mode).toBe('test');
  expect(status.status).toBe('complete');
  // A paid provider return can precede webhook projection. Exercise the
  // user's read-only recovery action instead of freezing the first response.
  await expect
    .poll(
      async () => {
        if (status.ready) return true;
        const retry = page.getByRole('button', {
          name: 'Check again',
          exact: true,
        });
        if (!(await retry.isVisible()) || !(await retry.isEnabled()))
          return false;
        const nextStatus = page.waitForResponse(
          (response) =>
            new URL(response.url()).origin === TEST_CHECKOUT_ORIGIN &&
            new URL(response.url()).pathname ===
              '/v0/checkout/session-status' &&
            response.request().method() === 'GET',
        );
        await retry.click();
        const response = await nextStatus;
        expect(response.status()).toBe(200);
        status = await response.json();
        expect(status.mode).toBe('test');
        expect(status.status).toBe('complete');
        return status.ready;
      },
      { timeout: 90000, intervals: [1000, 2000, 5000] },
    )
    .toBe(true);
  if (status.plan?.includes('business')) {
    expect(status.purchase?.paid).toBe(true);
    await expect(
      page.getByRole('heading', {
        name: status.purchase.setupRequired
          ? 'Your Business subscription is paid. Choose its space.'
          : 'Your Business space is ready',
      }),
    ).toBeVisible();
  } else {
    expect(['datatug-pro-monthly', 'datatug-pro-annual']).toContain(
      status.plan,
    );
    await expect(
      page.getByText('Test checkout complete.', { exact: false }),
    ).toBeVisible();
  }
  await expect(page.locator('ion-menu')).toBeHidden();
  expect(writes).toEqual([]);
});
