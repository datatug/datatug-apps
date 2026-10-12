import { expect, test, type Page } from '@playwright/test';

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
  const email = `checkout-new-${crypto.randomUUID()}@example.test`;
  await page.locator('ion-input[name="email"] input').fill(email);
  await page.locator('ion-input[name="first_name"] input').fill('New');
  await page.locator('ion-input[name="last_name"] input').fill('Customer');
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await expect(
    page.getByText(`Signed in as ${email}`, { exact: true }),
  ).toBeVisible({ timeout: 20000 });
}
async function signIn(page: Page, email: string) {
  await page.locator('ion-segment-button[value="in"]').click();
  await page.locator('ion-input[name="email"] input').fill(email);
  await page.locator('ion-input[type="password"] input').fill(password);
  await page.getByRole('button', { name: /Sign in.*with password/ }).click();
  await expect(
    page.getByText(`Signed in as ${email}`, { exact: true }),
  ).toBeVisible({ timeout: 20000 });
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
    setupFailure = false;
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
    const plan =
      typeof body.plan === 'string'
        ? body.plan
        : 'datatug-business-usage-monthly';
    const business = plan.includes('business'),
      annual = plan.endsWith('annual');
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
    else if (url.pathname.endsWith('/session-status'))
      data = {
        mode: 'test',
        plan: 'datatug-business-usage-monthly',
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
      await expect(
        page.getByText('2 months free', { exact: false }),
      ).toBeVisible();
      const purchaseId = new URL(page.url()).searchParams.get('purchaseId');
      if (plan === 'business') expect(purchaseId).toBeTruthy();
      if (unsigned) {
        expect(
          fake.seen.filter((x) => x.path.endsWith('/session')),
        ).toHaveLength(0);
        await signUp(page);
      } else await signIn(page, email);
      await expect(
        page.getByText(plan === 'pro' ? '€13.30' : '€69.30', { exact: false }),
      ).toBeVisible();
      await expect(page.locator('#business-destination')).toHaveCount(0);
      await page.getByRole('button', { name: 'Yearly', exact: true }).click();
      await expect(
        page.getByText(plan === 'pro' ? '€133.00' : '€693.00', {
          exact: false,
        }),
      ).toBeVisible();
      expect(new URL(page.url()).searchParams.get('checkout')).toBe('test');
      if (plan === 'business')
        expect(new URL(page.url()).searchParams.get('purchaseId')).toBe(
          purchaseId,
        );
      await page.goBack();
      await expect(
        page.getByText(plan === 'pro' ? '€13.30' : '€69.30', { exact: false }),
      ).toBeVisible();
      await page.goForward();
      await page.reload();
      await expect(
        page.getByText(plan === 'pro' ? '€133.00' : '€693.00', {
          exact: false,
        }),
      ).toBeVisible();
      expect(
        fake.seen
          .filter((x) => x.path.includes('/checkout/'))
          .every((x) => x.origin.includes('datatug-checkout-test')),
      ).toBe(true);
      expect(fake.seen.some((x) => x.path.includes('project'))).toBe(false);
      if (plan === 'business') {
        fake.confirm();
        await page.goto('/pricing/return?mode=test&session_id=cs_test_fixture');
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
          await page
            .locator('#business-destination')
            .selectOption({ label: 'Existing Business' });
        else
          await page
            .getByLabel('Business name', { exact: true })
            .fill('New Business');
        await page
          .getByRole('button', { name: 'Activate Business for this space' })
          .click();
        await expect(
          page.getByRole('heading', { name: 'Your Business space is ready' }),
        ).toBeVisible();
        await page.reload();
        await expect(
          page.getByRole('heading', { name: 'Your Business space is ready' }),
        ).toBeVisible();
        expect(
          fake.seen.filter((x) => x.path.endsWith('/purchase-setup')),
        ).toHaveLength(1);
      }
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
  await signIn(page, email);
  await expect(
    page.getByText('Checkout completed.', { exact: false }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#business-destination')).toHaveCount(0);
  expect(fake.seen.some((x) => x.path.endsWith('/session'))).toBe(false);
  fake.confirm();
  await page.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(page.locator('#business-destination')).toBeVisible();
  await page
    .locator('#business-destination')
    .selectOption({ label: 'Existing Business' });
  fake.rejectSetupOnce();
  await page
    .getByRole('button', { name: 'Activate Business for this space' })
    .click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.locator('#business-destination').selectOption('');
  await page
    .getByLabel('Business name', { exact: true })
    .fill('Alternative business');
  await page
    .getByRole('button', { name: 'Activate Business for this space' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Your Business space is ready' }),
  ).toBeVisible();
  const cancellation = page.getByLabel(
    'Cancel Pro renewal at the end of its paid period',
  );
  await expect(cancellation).not.toBeChecked();
  expect(fake.seen.some((x) => x.body.cancelPersonalAtPeriodEnd)).toBe(false);
  await cancellation.check();
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
