import { type Page } from '@playwright/test';
import { expect, test } from './helpers/demodb-guard';

// Local Firebase identity and Sneat record; payment/reconciliation HTTP is a
// contract fake. No provider payment or deployed permission mutation is made.
const project = 'demo-local-sneat-app';
const password = 'local-checkout-fixture-password';
const situations = [
  { name: 'project and business space', company: true, project: true },
  { name: 'business space without project', company: true, project: false },
  { name: 'project without business space', company: false, project: true },
  {
    name: 'neither project nor business space',
    company: false,
    project: false,
  },
  { name: 'new unsigned user', company: false, project: false },
];

async function readyCheckout(page: Page, kind: 'authentication' | 'purchase') {
  const checkout = page.locator(
    `datatug-checkout-page.ion-page:not(.ion-page-hidden):not(.ion-page-invisible):has([data-checkout-page="${kind}"])`,
  );
  await expect(checkout).toHaveCount(1);
  // Ionic disables interaction while its incoming/outgoing pages animate.
  // Visibility alone can expose controls on the still-outgoing page.
  await expect(checkout).toHaveCSS('pointer-events', 'auto');
  return checkout;
}

async function seed(page: Page, company: boolean, hasProject = false) {
  const email = `checkout-${crypto.randomUUID()}@example.test`;
  const response = await page.request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=e2e',
    { data: { email, password, returnSecureToken: true } },
  );
  expect(response.ok()).toBe(true);
  const { localId } = await response.json();
  await seedRecord(page, localId, email, company, hasProject);
  return email;
}
async function seedRecord(
  page: Page,
  localId: string,
  email: string,
  company: boolean,
  hasProject: boolean,
) {
  const personalID = `personal_${localId}`,
    companyID = `business_${localId}`;
  const companyBrief = {
    mapValue: {
      fields: {
        title: { stringValue: 'Existing Business' },
        type: { stringValue: 'company' },
        roles: { arrayValue: { values: [{ stringValue: 'owner' }] } },
      },
    },
  };
  const personalBrief = {
    mapValue: {
      fields: {
        title: { stringValue: 'Personal' },
        type: { stringValue: 'personal' },
        roles: { arrayValue: { values: [{ stringValue: 'owner' }] } },
      },
    },
  };
  const user = await page.request.patch(
    `http://127.0.0.1:8180/v1/projects/${project}/databases/(default)/documents/users/${localId}`,
    {
      data: {
        fields: {
          title: { stringValue: 'Checkout Fixture' },
          email: { stringValue: email },
          emailIsVerified: { booleanValue: true },
          spaces: {
            mapValue: {
              fields: {
                [personalID]: personalBrief,
                ...(company ? { [companyID]: companyBrief } : {}),
              },
            },
          },
          spaceIDs: {
            arrayValue: {
              values: [
                { stringValue: personalID },
                ...(company ? [{ stringValue: companyID }] : []),
              ],
            },
          },
        },
      },
    },
  );
  expect(user.ok()).toBe(true);
  for (const [id, type] of [
    [personalID, 'personal'],
    ...(company ? [[companyID, 'company']] : []),
  ]) {
    const result = await page.request.patch(
      `http://127.0.0.1:8180/v1/projects/${project}/databases/(default)/documents/spaces/${id}`,
      {
        data: {
          fields: {
            title: { stringValue: type },
            type: { stringValue: type },
            userIDs: { arrayValue: { values: [{ stringValue: localId }] } },
          },
        },
      },
    );
    expect(result.ok()).toBe(true);
  }
  const projectURL = `http://127.0.0.1:8180/v1/projects/${project}/databases/(default)/documents/spaces/${personalID}/ext/datatug/projects/fixture_project`;
  if (hasProject) {
    const result = await page.request.patch(projectURL, {
      data: {
        fields: {
          title: { stringValue: 'Existing project' },
          createdBy: { stringValue: localId },
        },
      },
    });
    expect(result.ok()).toBe(true);
  }
  expect((await page.request.get(projectURL)).status()).toBe(
    hasProject ? 200 : 404,
  );
}
async function signUp(page: Page) {
  await readyCheckout(page, 'authentication');
  const email = `checkout-new-${crypto.randomUUID()}@example.test`;
  await page.locator('ion-input[name="email"] input').fill(email);
  await page.locator('ion-input[name="first_name"] input').fill('New');
  await page.locator('ion-input[name="last_name"] input').fill('Customer');
  await expect(
    page.locator('ion-button').filter({ hasText: /^Sign up$/ }),
  ).toHaveJSProperty('disabled', false);
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await expect(
    page.getByText(`Signed in as ${email}`, { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await readyCheckout(page, 'purchase');
}
async function signIn(page: Page, email: string) {
  await readyCheckout(page, 'authentication');
  await page.locator('ion-segment-button[value="in"]').click();
  await page.locator('ion-input[name="email"] input').fill(email);
  const passwordInput = page.locator(
    'ion-input[type="password"] input:not(.cloned-input)',
  );
  await passwordInput.fill(password);
  // Finish the field's blur/update and focus scrolling before the mobile
  // WebKit click, just as the Business activation helper does below.
  await passwordInput.blur();
  await expect(
    page.locator('ion-input[type="password"] input.cloned-input'),
  ).toHaveCount(0);
  await expect(page.locator('ion-input[type="password"]')).toHaveJSProperty(
    'value',
    password,
  );
  const signInButton = page.getByRole('button', {
    name: /Sign in.*with password/,
  });
  await signInButton.scrollIntoViewIfNeeded();
  // Wait for Ionic's host property as well as Playwright's native actionability.
  await expect(
    page.locator('ion-button').filter({ hasText: /Sign in.*with password/s }),
  ).toHaveJSProperty('disabled', false);
  await expect(signInButton).toBeEnabled();
  await signInButton.click();
  await expect(
    page.getByText(`Signed in as ${email}`, { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await readyCheckout(page, 'purchase');
}
async function expectDue(page: Page, amount: string) {
  const checkout = await readyCheckout(page, 'purchase');
  await expect(
    checkout.locator('datatug-checkout-price-summary .final'),
  ).toContainText(amount);
}

async function chooseBusinessSpace(page: Page, label: string) {
  await readyCheckout(page, 'purchase');
  await page.locator('#business-destination').click();
  await page.getByRole('radio', { name: label, exact: true }).click();
  await expect(page.locator('ion-popover')).toBeHidden();
}

async function activateBusiness(page: Page) {
  const checkout = await readyCheckout(page, 'purchase');
  const button = checkout.getByRole('button', {
    name: 'Activate Business for this space',
  });
  // Finish input/select focus scrolling and keep the emulator banner clear.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  await button.evaluate((element) =>
    element.scrollIntoView({ block: 'center' }),
  );
  await expect(checkout).toHaveCSS('pointer-events', 'auto');
  await button.click();
}

async function paymentFake(page: Page) {
  const seen: {
    path: string;
    body: Record<string, unknown>;
    origin: string;
  }[] = [];
  let ready = false,
    spaceID = '',
    cancelled = false,
    setupFailure = false,
    selectedPlan = 'datatug-business-usage-monthly';
  let statusOverride: Record<string, unknown> = {};
  let sessionFailure: { code: string; status: number } | undefined;
  await page.route('**/v0/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    let body: Record<string, unknown> = {};
    try {
      body = request.postDataJSON() ?? {};
    } catch {
      /* GET */
    }
    seen.push({ path: url.pathname, body, origin: url.origin });
    if (url.pathname.endsWith('/session') && sessionFailure) {
      await route.fulfill({
        status: sessionFailure.status,
        contentType: 'application/json',
        body: JSON.stringify({ code: sessionFailure.code }),
      });
      return;
    }
    const plan =
      typeof body.plan === 'string'
        ? body.plan
        : 'datatug-business-usage-monthly';
    const business = plan.includes('business'),
      annual = plan.endsWith('annual');
    if (url.pathname.endsWith('/session')) selectedPlan = plan;
    const list = (business ? 9900 : 1900) * (annual ? 10 : 1);
    let data: unknown;
    if (url.pathname.endsWith('/users/init_user_record')) {
      const token =
        request.headers()['authorization']?.replace(/^Bearer /, '') ?? '';
      const claims = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString(),
      );
      await seedRecord(
        page,
        claims.user_id ?? claims.sub,
        String(body.email ?? claims.email),
        false,
        false,
      );
      data = {};
    } else if (url.pathname.endsWith('/config'))
      data = {
        site: 'datatug',
        mode: 'test',
        publishableKey: 'pk_test_fixture',
        plans: [
          'datatug-pro-monthly',
          'datatug-pro-annual',
          'datatug-business-usage-monthly',
          'datatug-business-usage-annual',
        ].map((id) => ({
          id,
          accountRequired: true,
          accountKind: id.includes('business') ? 'organisation' : 'personal',
          taxIncluded: true,
        })),
      };
    else if (url.pathname.endsWith('/session'))
      data = {
        mode: 'test',
        sessionId: 'cs_test_fixture',
        clientSecret: 'cs_test_fixture_secret_local',
        accountId: 'billing_fixture',
        accountKind: business ? 'organisation' : 'personal',
        amount: { currency: 'eur', list, due: list * 0.7, taxIncluded: true },
        appliedDiscount: {
          kind: 'launch',
          percentOff: 30,
          duration: 'forever',
        },
        offer: {
          applied: true,
          reserved: false,
          duration: 'forever',
          percentOff: 30,
        },
      };
    else if (url.pathname.endsWith('/purchases'))
      data = {
        items:
          ready && !spaceID
            ? [
                {
                  accountId: 'billing_fixture',
                  sessionId: 'cs_test_fixture',
                  planId: selectedPlan,
                  state: 'setup_required',
                  purchasedAtUTC: '2026-10-13T09:00:00Z',
                  currency: 'eur',
                  amountPaidMinor: 6930,
                  spaceReference: 'intended_business',
                },
              ]
            : [],
      };
    else if (url.pathname.endsWith('/session-status'))
      data = {
        mode: 'test',
        plan: selectedPlan,
        status: 'complete',
        ready,
        purchase: ready
          ? {
              accountId: 'billing_fixture',
              paid: true,
              setupRequired: !spaceID,
              spaceID: spaceID || undefined,
            }
          : undefined,
        ...statusOverride,
      };
    else if (url.pathname.endsWith('/purchase-setup')) {
      if (setupFailure) {
        setupFailure = false;
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'space_admin_required' }),
        });
        return;
      }
      spaceID = String(body.spaceID || 'new_business_fixture');
      data = {
        accountId: 'billing_fixture',
        paid: true,
        setupRequired: false,
        spaceID,
      };
    } else if (url.pathname.endsWith('/purchase-options')) {
      if (request.method() === 'POST') cancelled = true;
      data = {
        canCancelPersonal: !cancelled,
        cancellationScheduled: cancelled,
        personalPaidThroughUTC: '2027-10-12T00:00:00Z',
      };
    } else data = {};
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  });
  return {
    seen,
    rejectSetupOnce: () => {
      setupFailure = true;
    },
    confirm: () => {
      ready = true;
    },
    status: (value: Record<string, unknown>) => {
      statusOverride = value;
    },
    rejectSession: (code: string, status: number) => {
      sessionFailure = { code, status };
    },
  };
}
for (const plan of ['pro', 'business'])
  for (const situation of situations) {
    test(`${plan}: ${situation.name}`, async ({ page }, testInfo) => {
      const fake = await paymentFake(page);
      const unsigned = situation.name === 'new unsigned user';
      const email = unsigned
        ? ''
        : await seed(page, situation.company, situation.project);
      await page.goto(
        plan === 'pro'
          ? '/subscribe?plan=pro&period=monthly&checkout=test'
          : '/business/checkout?planID=datatug-business-usage-monthly&checkout=test',
      );
      await expect(page.locator('sneat-auth-panel')).toBeVisible();
      await expect(page.locator('ion-menu')).toBeHidden();
      await expect(page).toHaveURL(/\/checkout\/sign-in\?/);
      await expect(page).toHaveTitle(
        `Complete your DataTug ${plan === 'pro' ? 'Pro' : 'Business'} subscription`,
      );
      await expect(
        page
          .locator('[data-checkout-page=authentication]')
          .getByRole('heading', {
            name: `Complete your DataTug ${plan === 'pro' ? 'Pro' : 'Business'} subscription`,
            exact: true,
          }),
      ).toBeVisible();
      await expect(page.locator('datatug-checkout-price-summary')).toHaveCount(
        0,
      );
      await expect(
        page.getByRole('tab', { name: 'Monthly', exact: true }),
      ).toHaveCount(0);
      await expect(page.locator('.checkout-art')).toHaveCount(0);
      // Measure the incoming page in one frame: Ionic animates both pages on
      // mobile, so separate boundingBox calls can observe different offsets.
      await expect
        .poll(() =>
          page
            .locator('[data-checkout-page=authentication]')
            .evaluate((root) => {
              const card = root
                .querySelector('.checkout-auth ion-card')
                ?.getBoundingClientRect();
              if (!card?.width) return Infinity;
              return Math.max(
                ...Array.from(
                  root.querySelectorAll(
                    '.checkout-auth ion-card, #checkout-auth-heading, .checkout-footer',
                  ),
                  (element) => {
                    const box = element.getBoundingClientRect();
                    return Math.max(
                      Math.abs(box.x - card.x),
                      Math.abs(box.width - card.width),
                    );
                  },
                ),
              );
            }),
        )
        .toBeLessThanOrEqual(1);
      if (unsigned) {
        await page.reload();
        await expect(page.locator('sneat-auth-panel')).toBeVisible();
        await expect(
          page.getByLabel(
            'Test mode — no live payment or live plan activation',
          ),
        ).toBeVisible();
        await expect(
          page.locator('datatug-checkout-page.ion-page:not(.ion-page-hidden)'),
        ).toHaveCount(1);
        await page.screenshot({
          path: testInfo.outputPath('checkout-sign-in.png'),
          fullPage: true,
        });
      }
      const purchaseId = new URL(page.url()).searchParams.get('purchaseId');
      if (plan === 'business') expect(purchaseId).toBeTruthy();
      if (unsigned) {
        expect(
          fake.seen.filter((x) => x.path.endsWith('/session')),
        ).toHaveLength(0);
        await signUp(page);
      } else await signIn(page, email);
      await expectDue(page, plan === 'pro' ? '€13.30' : '€69.30');
      expect(new URL(page.url()).pathname).toBe(
        plan === 'pro' ? '/subscribe' : '/business/checkout',
      );
      await expect(page).toHaveTitle(
        `Complete your DataTug ${plan === 'pro' ? 'Pro' : 'Business'} subscription`,
      );
      await expect(page.locator('sneat-auth-panel')).toBeHidden();
      await expect(
        page
          .locator('datatug-checkout-price-summary ion-card')
          .getByRole('button', { name: 'Continue to payment' }),
      ).toBeVisible();
      for (const art of await page.locator('.checkout-art img').all()) {
        await expect
          .poll(() => art.evaluate((img: HTMLImageElement) => img.naturalWidth))
          .toBeGreaterThan(0);
      }
      await expect(page.locator('#business-destination')).toHaveCount(0);
      if (unsigned)
        await page.getByRole('button', { name: /Switch to yearly/ }).click();
      else await page.getByRole('tab', { name: /Yearly/ }).click();
      await expectDue(page, plan === 'pro' ? '€133.00' : '€693.00');
      expect(new URL(page.url()).searchParams.get('checkout')).toBe('test');
      if (plan === 'business')
        expect(new URL(page.url()).searchParams.get('purchaseId')).toBe(
          purchaseId,
        );
      await page.goBack();
      await expectDue(page, plan === 'pro' ? '€13.30' : '€69.30');
      await page.goForward();
      await page.reload();
      await expectDue(page, plan === 'pro' ? '€133.00' : '€693.00');
      expect(
        fake.seen
          .filter((x) => x.path.includes('/checkout/'))
          .every((x) => x.origin.includes('datatug-checkout-test')),
      ).toBe(true);
      expect(fake.seen.some((x) => x.path.includes('project'))).toBe(false);
      fake.confirm();
      await page.goto('/pricing/return?mode=test&session_id=cs_test_fixture');
      if (plan === 'business') {
        await readyCheckout(page, 'purchase');
        await expect(
          page.getByRole('heading', {
            name: 'Your Business subscription is paid. Choose its space.',
          }),
        ).toBeVisible();
        await expect(page.locator('ion-menu')).toBeHidden();
        expect(
          fake.seen.some(
            (x) =>
              x.path.endsWith('/purchase-options') &&
              x.body.cancelPersonalAtPeriodEnd,
          ),
        ).toBe(false);
        if (situation.company)
          await chooseBusinessSpace(page, 'Existing Business');
        else
          await page
            .getByLabel('Business name', { exact: true })
            .fill('New Business');
        await activateBusiness(page);
        const readyBusinessCheckout = await readyCheckout(page, 'purchase');
        await expect(
          readyBusinessCheckout.getByRole('heading', {
            name: 'Your Business space is ready',
          }),
        ).toBeVisible();
        await page.reload();
        const reloadedBusinessCheckout = await readyCheckout(page, 'purchase');
        await expect(
          reloadedBusinessCheckout.getByRole('heading', {
            name: 'Your Business space is ready',
          }),
        ).toBeVisible();
        expect(
          fake.seen.filter((x) => x.path.endsWith('/purchase-setup')),
        ).toHaveLength(1);
      } else {
        const checkout = await readyCheckout(page, 'purchase');
        await expect(
          checkout.getByText('Test checkout complete.', { exact: false }),
        ).toBeVisible();
        await expect(
          checkout.getByRole('link', {
            name: 'Continue to DataTug',
            exact: true,
          }),
        ).toBeVisible();
        await page.reload();
        await readyCheckout(page, 'purchase');
        await expect(
          checkout.getByText('Test checkout complete.', { exact: false }),
        ).toBeVisible();
        expect(fake.seen.some((x) => x.path.endsWith('/purchase-setup'))).toBe(
          false,
        );
      }
      await expect(page.locator('sneat-auth-panel')).toBeHidden();
      await expect(
        page.locator('datatug-checkout-page.ion-page:not(.ion-page-hidden)'),
      ).toHaveCount(1);
      await page.screenshot({
        path: testInfo.outputPath('checkout-completion.png'),
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    });
  }

test('Business recovery: delayed reconciliation and permission retry never repay; Pro cancellation stays optional', async ({
  page,
}) => {
  const fake = await paymentFake(page),
    email = await seed(page, true);
  await page.goto('/pricing/return?mode=test&session_id=cs_test_fixture');
  await expect(page).toHaveURL(/\/checkout\/sign-in\?/);
  await expect(page).toHaveTitle('Complete your DataTug subscription');
  await expect(
    page.getByRole('heading', {
      name: 'Complete your DataTug subscription',
      exact: true,
    }),
  ).toBeVisible();
  await signIn(page, email);
  await expect(
    page.getByText('Checkout completed.', { exact: false }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#business-destination')).toHaveCount(0);
  expect(fake.seen.some((x) => x.path.endsWith('/session'))).toBe(false);
  fake.confirm();
  await page.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(page.locator('#business-destination')).toBeVisible();
  await expect(page).toHaveTitle('Complete your DataTug Business subscription');
  await chooseBusinessSpace(page, 'Existing Business');
  fake.rejectSetupOnce();
  await activateBusiness(page);
  await expect(page.getByRole('alert')).toBeVisible();
  await chooseBusinessSpace(page, 'Create a new business space');
  await page
    .getByLabel('Business name', { exact: true })
    .fill('Alternative business');
  await activateBusiness(page);
  await expect(
    page.getByRole('heading', { name: 'Your Business space is ready' }),
  ).toBeVisible();
  const cancellation = page.getByRole('checkbox', {
    name: 'Cancel Pro renewal at the end of its paid period',
    exact: true,
  });
  await expect(cancellation).not.toBeChecked();
  expect(fake.seen.some((x) => x.body.cancelPersonalAtPeriodEnd)).toBe(false);
  await cancellation.click();
  await expect(cancellation).toBeChecked();
  await page
    .getByRole('button', { name: 'Confirm Pro renewal cancellation' })
    .click();
  await expect(
    page.getByText('Pro renewal cancellation is scheduled.', { exact: false }),
  ).toBeVisible();
  expect(
    fake.seen.filter((x) => x.body.cancelPersonalAtPeriodEnd),
  ).toHaveLength(1);
  expect(fake.seen.some((x) => x.path.endsWith('/session'))).toBe(false);
  expect(
    fake.seen.filter((x) => x.path.endsWith('/purchase-setup')),
  ).toHaveLength(2);
});

for (const plan of ['pro', 'business']) {
  test(`${plan}: payment form failure remains retryable and keeps the TEST selection`, async ({
    page,
  }) => {
    const fake = await paymentFake(page);
    const email = await seed(page, false);
    // Exercise the actual app adapter's loader failure; never load or submit a
    // provider form with a fake key. Successful provider mounting has a separate
    // opt-in suite that uses the real isolated TEST service.
    await page.route('https://js.stripe.com/**', (route) => route.abort());
    await page.goto(
      plan === 'pro'
        ? '/subscribe?plan=pro&period=monthly&checkout=test'
        : '/business/checkout?planID=datatug-business-usage-monthly&checkout=test',
    );
    await signIn(page, email);
    const purchaseId = new URL(page.url()).searchParams.get('purchaseId');
    await page
      .getByLabel(
        'I understand this is early access and my subscription starts now.',
      )
      .check();
    await page
      .getByRole('button', { name: 'Continue to payment', exact: true })
      .click();
    await expect(
      page.getByText(
        'The payment form could not load. Retry this same selection.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator('ion-menu')).toBeHidden();
    await page
      .getByRole('button', { name: 'Retry this selection', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Continue to payment', exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get('checkout')).toBe('test');
    expect(new URL(page.url()).searchParams.get('purchaseId')).toBe(purchaseId);
    const attempts = fake.seen.filter((x) => x.path.endsWith('/session'));
    expect(attempts).toHaveLength(2);
    expect(attempts[0].body).toEqual(attempts[1].body);
    expect(
      attempts.every((x) => x.origin.includes('datatug-checkout-test')),
    ).toBe(true);
    expect(fake.seen.some((x) => x.path.endsWith('/purchase-setup'))).toBe(
      false,
    );
  });
}

test('expired payment return checks status without creating another payment or business space', async ({
  page,
}) => {
  const fake = await paymentFake(page);
  fake.status({ status: 'expired' });
  const email = await seed(page, false);
  await page.goto('/pricing/return?mode=test&session_id=cs_test_fixture');
  await signIn(page, email);
  await expect(
    page.getByText(
      'This payment session expired. Check your plan or return to pricing.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(
    page.getByText(
      'This payment session expired. Check your plan or return to pricing.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    fake.seen.some((x) => /\/(session|purchase-setup)$/.test(x.path)),
  ).toBe(false);
  await expect(page.locator('ion-menu')).toBeHidden();
});

test('a mismatched TEST session and LIVE return is rejected before authentication or payment HTTP', async ({
  page,
}) => {
  const fake = await paymentFake(page);
  await page.goto('/pricing/return?mode=live&session_id=cs_test_fixture');
  await expect(
    page.getByText(
      'Checkout is not available for this selection. Choose a plan on the pricing page.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator('sneat-auth-panel')).toHaveCount(0);
  expect(fake.seen.some((x) => x.path.includes('/checkout/'))).toBe(false);
});

test('Business existing subscription explains the destination conflict and cannot mount another payment', async ({
  page,
}) => {
  const fake = await paymentFake(page);
  fake.rejectSession('already_subscribed', 409);
  const email = await seed(page, true);
  await page.goto(
    '/business/checkout?planID=datatug-business-usage-monthly&checkout=test&spaceID=existing_company',
  );
  await signIn(page, email);
  await expect(
    page.getByText(
      'This business space already has a DataTug subscription or a checkout in progress.',
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    page.getByText('You already have Pro', { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Continue to payment', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Retry this selection', exact: true }),
  ).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('spaceID')).toBe(
    'existing_company',
  );
  expect(fake.seen.filter((x) => x.path.endsWith('/session'))).toHaveLength(1);
});

test('Business permission denial explains the required role and retains the optional destination', async ({
  page,
}) => {
  const fake = await paymentFake(page);
  fake.rejectSession('not_account_admin', 403);
  const email = await seed(page, true);
  await page.goto(
    '/business/checkout?planID=datatug-business-usage-monthly&checkout=test&spaceID=referenced_company',
  );
  await signIn(page, email);
  await expect(
    page.getByText(
      'You need an owner or admin role for this Space to continue.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Continue to payment', exact: true }),
  ).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('spaceID')).toBe(
    'referenced_company',
  );
  await expect(page.locator('ion-menu')).toBeHidden();
  expect(fake.seen.some((x) => x.path.endsWith('/purchase-setup'))).toBe(false);
});

test('paid Business setup is recoverable from the account after leaving and refreshing, without another checkout', async ({
  page,
}) => {
  const fake = await paymentFake(page);
  const email = await seed(page, false);
  await page.goto(
    '/business/checkout?planID=datatug-business-usage-monthly&checkout=test',
  );
  await signIn(page, email);
  fake.confirm();
  await page.goto('/pricing/return?mode=test&session_id=cs_test_fixture');
  await readyCheckout(page, 'purchase');
  await page
    .getByRole('link', { name: 'Finish later from my account' })
    .click();
  await expect(page).toHaveURL(/\/my\?checkout=test$/);
  await expect(page).not.toHaveTitle(/Complete your DataTug/);
  await page.reload();
  const recovery = page.locator('sneat-subscription-recovery');
  await expect(
    recovery.getByText('DataTug Business · Monthly', { exact: true }),
  ).toBeVisible();
  const sessionsBefore = fake.seen.filter((x) =>
    x.path.endsWith('/session'),
  ).length;
  await recovery.getByRole('link').click();
  await readyCheckout(page, 'purchase');
  await expect(page).toHaveURL(/mode=test&session_id=cs_test_fixture/);
  await page
    .getByLabel('Business name', { exact: true })
    .fill('Recovered Business');
  await activateBusiness(page);
  await expect(
    page.getByRole('heading', { name: 'Your Business space is ready' }),
  ).toBeVisible();
  expect(fake.seen.filter((x) => x.path.endsWith('/session')).length).toBe(
    sessionsBefore,
  );
  expect(
    fake.seen.filter((x) => x.path.endsWith('/purchase-setup')),
  ).toHaveLength(1);
  await page.goto('/my?checkout=test');
  await expect(recovery.locator('ion-card')).toHaveCount(0);
});

test('shared subscriptions preserve independent plans, confirm cancellation and transfer only paid access', async ({
  page,
}, testInfo) => {
  const fake = await paymentFake(page);
  const email = await seed(page, true, true);
  const identity = await page.request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=e2e',
    { data: { email, password, returnSecureToken: true } },
  );
  const { localId } = await identity.json();
  const personal = `personal_${localId}`,
    source = `business_${localId}`,
    target = `target_${localId}`;
  const userPath = `http://127.0.0.1:8180/v1/projects/${project}/databases/(default)/documents/users/${localId}`;
  const user = await (await page.request.get(userPath)).json();
  user.fields.spaces.mapValue.fields[target] = {
    mapValue: {
      fields: {
        title: { stringValue: 'Northwind' },
        type: { stringValue: 'company' },
        roles: { arrayValue: { values: [{ stringValue: 'owner' }] } },
      },
    },
  };
  user.fields.spaceIDs.arrayValue.values.push({ stringValue: target });
  expect(
    (
      await page.request.patch(userPath, { data: { fields: user.fields } })
    ).ok(),
  ).toBe(true);
  const originalProjectPath = `http://127.0.0.1:8180/v1/projects/${project}/databases/(default)/documents/spaces/${personal}/ext/datatug/projects/fixture_project`;
  const originalProject = await (
    await page.request.get(originalProjectPath)
  ).json();
  const common = {
    status: 'active',
    paidThroughUTC: '2026-11-13T10:00:00Z',
    scheduledEndUTC: '0001-01-01T00:00:00Z',
    firstPaidUTC: '2026-10-13T10:00:00Z',
    currency: 'eur',
    regularMinor: 9900,
    renewalMinor: 6930,
    discountPercent: 30,
    priceConfirmed: true,
    launchDiscount: true,
    bindingRevision: 1,
    canCancel: true,
    canTransfer: true,
  };
  const subscriptions = [
    {
      ...common,
      accountId: personal,
      planId: 'datatug-pro-monthly',
      kind: 'personal',
      spaceID: personal,
      regularMinor: 1900,
      renewalMinor: 1330,
      canTransfer: false,
    },
    {
      ...common,
      accountId: 'business_one',
      planId: 'datatug-business-usage-monthly',
      kind: 'organisation',
      spaceID: source,
    },
    {
      ...common,
      accountId: 'business_two',
      planId: 'datatug-business-usage-annual',
      kind: 'organisation',
      spaceID: 'third_business',
      regularMinor: 99000,
      renewalMinor: 69300,
    },
  ];
  const mutations: { path: string; body: Record<string, unknown> }[] = [];
  await page.route('**/v0/checkout/subscription**', async (route) => {
    const url = new URL(route.request().url());
    expect(url.origin).toBe(
      'https://datatug-checkout-test-354fvnqbaa-ey.a.run.app',
    );
    expect(!!route.request().headers()['authorization']).toBe(true);
    let data: unknown;
    if (route.request().method() === 'GET') {
      expect(url.searchParams.get('mode')).toBe('test');
      data = url.pathname.endsWith('/subscriptions')
        ? { items: subscriptions }
        : subscriptions.find(
            (s) => s.accountId === url.searchParams.get('account_id'),
          );
    } else {
      const body = route.request().postDataJSON();
      expect(body.mode).toBe('test');
      mutations.push({ path: url.pathname, body });
      const selected = subscriptions.find(
        (s) => s.accountId === body.accountId,
      );
      expect(selected).toBeTruthy();
      if (!selected) throw new Error('Missing fixture subscription');
      if (url.pathname.endsWith('/cancel')) {
        expect(body.confirm).toBe(true);
        selected.status = 'cancellation_scheduled';
        selected.scheduledEndUTC = selected.paidThroughUTC;
        selected.canCancel = false;
        data = selected;
      } else {
        expect(body.fromSpaceID).toBe(source);
        expect(body.spaceID).toBe(target);
        expect(body.expectedRevision).toBe(1);
        selected.spaceID = target;
        selected.bindingRevision = 2;
        data = {
          accountId: selected.accountId,
          fromSpaceID: source,
          spaceID: target,
          bindingRevision: 2,
          effectiveAtUTC: '2026-10-13T10:05:00Z',
        };
      }
    }
    await route.fulfill({ json: data });
  });
  await page.goto('/subscriptions?checkout=test');
  await expect(page.locator('sneat-auth-panel')).toBeVisible();
  await page.locator('ion-segment-button[value="in"]').click();
  await page.locator('ion-input[name="email"] input').fill(email);
  await page.locator('ion-input[type="password"] input').fill(password);
  await page.getByRole('button', { name: /Sign in.*with password/ }).click();
  const settings = page.locator(
    'datatug-subscription-settings-page.ion-page:not(.ion-page-hidden):not(.ion-page-invisible) sneat-subscription-settings',
  );
  await expect(settings.getByRole('link')).toHaveCount(3);
  await expect(
    settings.getByText('DataTug Pro · Personal', { exact: true }),
  ).toBeVisible();
  await settings
    .getByText('DataTug Business · Existing Business', { exact: true })
    .click();
  await expect(page).toHaveURL(/\/subscriptions\/business_one\?checkout=test$/);
  await expect(
    settings.getByText('Receiving space: Existing Business'),
  ).toBeVisible();
  await expect(
    settings.getByText('Regular price: €99.00 / month', { exact: true }),
  ).toBeVisible();
  await settings
    .getByRole('button', { name: 'Cancel renewal', exact: true })
    .click();
  await expect(
    settings.getByText(/Your other subscriptions stay active/),
  ).toBeVisible();
  expect(mutations).toHaveLength(0);
  await settings
    .getByRole('button', { name: 'Keep subscription', exact: true })
    .click();
  await settings
    .getByRole('button', { name: 'Cancel renewal', exact: true })
    .click();
  await settings
    .getByRole('button', {
      name: 'Confirm cancellation at period end',
      exact: true,
    })
    .click();
  await expect(settings.getByText(/Renewal cancelled/)).toBeVisible();
  expect(subscriptions[0].status).toBe('active');
  expect(subscriptions[2].status).toBe('active');
  await settings
    .getByRole('link', { name: 'Transfer paid access', exact: true })
    .click();
  await expect(page).toHaveURL(
    /\/subscriptions\/business_one\/transfer\?checkout=test&requestId=/,
  );
  const transferURL = page.url();
  await page.reload();
  expect(page.url()).toBe(transferURL);
  await expect(
    settings.getByText(/Projects stay in Existing Business/),
  ).toBeVisible();
  // Ionic's accessible shadow button is covered by its visible select control.
  await settings.locator('ion-select').click();
  await page.getByRole('radio', { name: 'Northwind', exact: true }).click();
  await settings
    .getByRole('button', {
      name: 'Confirm transfer of paid access',
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/subscriptions\/business_one\?checkout=test$/);
  await expect(settings.getByText('Receiving space: Northwind')).toBeVisible();
  await expect(settings).toHaveCount(1);
  await expect(settings.locator('..')).toHaveCSS('pointer-events', 'auto');
  await expect(settings.getByRole('status')).toHaveCount(0);
  await expect(
    settings.getByRole('heading', {
      name: 'Transfer paid access',
      exact: true,
    }),
  ).toHaveCount(0);
  expect(mutations).toHaveLength(2);
  expect(subscriptions[1].renewalMinor).toBe(6930);
  expect(subscriptions[1].paidThroughUTC).toBe(common.paidThroughUTC);
  expect(
    (await (await page.request.get(originalProjectPath)).json()).fields,
  ).toEqual(originalProject.fields);
  expect(fake.seen.filter((x) => x.path.endsWith('/session'))).toHaveLength(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('subscription-settings.png'),
    fullPage: true,
  });
});
