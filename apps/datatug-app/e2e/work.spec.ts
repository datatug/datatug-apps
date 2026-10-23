import { Page } from '@playwright/test';
import { expect, test } from './helpers/demodb-guard';
import { SIGN_IN_BUTTON } from './helpers/sign-in-button';

const password = 'work-emulator-only-2026';
const base = '/space/space/store/firestore/project/project/work';
const api = 'http://127.0.0.1:8090/v0/datatug/work';
async function login(page: Page, id: 'alice' | 'bob') {
  const email = `${id}@work.example.test`;
  const auth = await page.request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=e2e',
    { data: { email, password, returnSecureToken: true } },
  );
  expect(auth.ok()).toBe(true);
  const { localId, idToken } = await auth.json();
  const firestore =
    'http://127.0.0.1:8180/v1/projects/demo-local-sneat-app/databases/(default)/documents';
  // UI profile only; project admission, contacts and datasource grants are owned by the real backend fixture.
  expect(
    (
      await page.request.patch(`${firestore}/users/${localId}`, {
        data: {
          fields: {
            title: { stringValue: id === 'alice' ? 'Team Lead' : 'Developer' },
            email: { stringValue: email },
            emailIsVerified: { booleanValue: true },
            spaces: {
              mapValue: {
                fields: {
                  space: {
                    mapValue: {
                      fields: {
                        title: { stringValue: 'Work team' },
                        type: { stringValue: 'team' },
                        roles: {
                          arrayValue: {
                            values: [
                              {
                                stringValue:
                                  id === 'alice' ? 'owner' : 'contributor',
                              },
                            ],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            spaceIDs: { arrayValue: { values: [{ stringValue: 'space' }] } },
          },
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/checkout/sign-in?plan=pro&period=monthly&checkout=test');
  const checkout = page.locator(
    'datatug-checkout-page.ion-page:not(.ion-page-hidden):has([data-checkout-page="authentication"])',
  );
  await checkout.locator('ion-segment-button[value="in"]').click();
  await page.locator('ion-input[name="email"] input').fill(email);
  await page
    .locator('ion-input[type="password"] input:not(.cloned-input)')
    .fill(password);
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
  await expect(
    page.getByText(`Signed in as ${email}`, { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  return idToken as string;
}
async function stableScreenshot(page: Page, name: string) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  await page.screenshot({
    path: `coverage/apps/datatug-work/${name}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}
async function choose(page: Page, selector: string, name: string | RegExp) {
  await page.locator(selector).click();
  await page
    .getByRole('radio', { name, exact: typeof name === 'string' })
    .click();
}
async function addContext(page: Page, label: string | RegExp, value: string) {
  await page.getByRole('button', { name: 'Add value', exact: true }).click();
  await choose(page, 'ion-select[label="Mapped entity field"]', label);
  await page
    .getByRole('textbox', { name: 'Context value', exact: true })
    .fill(value);
  await page.getByRole('button', { name: 'Save value', exact: true }).click();
  await expect(
    page.getByRole('list', { name: 'Context Bag entries' }),
  ).toContainText(value);
}
async function created(page: Page) {
  await page.getByRole('button', { name: 'Create work', exact: true }).click();
  await expect(page).toHaveURL(/\/work\/(?!new$)[A-Za-z0-9_-]+$/);
  await expect(page.getByText('Context Bag', { exact: true })).toBeVisible();
  return new URL(page.url()).pathname;
}

test('real Work HTTP: Incident, delegated Case, context isolation and remediation Task', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  const observe = (p: Page) => {
    p.on('pageerror', (error) => errors.push(error.message));
    p.on('response', (response) => {
      if (response.url().includes('/datatug/work/') && response.status() >= 400)
        errors.push(`${response.status()} ${response.url()}`);
    });
  };
  observe(page);
  const token = await login(page, 'alice');
  await page.goto(base);
  await expect(page.getByText('Project Work', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Create work', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Delayed shipment · order 11045');
  await choose(page, 'ion-select[formControlName="type"]', 'Incident');
  await page
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Order 11045 needs shipment investigation and evidence.');
  // Select from the actual admitted source catalog, including domains sharing an environment ID.
  const catalog = await (
    await page.request.get(`${api}/items?spaceID=space&projectID=project`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const environment =
    catalog.environments.find((e: { identityDomain: string }) =>
      /shipping/i.test(e.identityDomain),
    ) || catalog.environments[0];
  const scopeOption = page
    .locator('ion-select[formControlName="environment"] ion-select-option')
    .filter({ hasText: environment.title });
  const optionLabel = (await scopeOption.first().textContent())!.trim();
  await choose(page, 'ion-select[formControlName="environment"]', optionLabel);
  const incidentPath = await created(page);
  const orderSubject = environment.subjects.find((s: { label: string }) =>
    /order.*id/i.test(s.label),
  );
  expect(orderSubject).toBeTruthy();
  await addContext(page, orderSubject.label, '11045');
  await stableScreenshot(page, 'incident-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await stableScreenshot(page, 'incident-mobile');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByText('Accountable owner', { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByRole('link', { name: 'Delegate investigation', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Investigate delayed order 11045');
  await page.locator('ion-select[formControlName="assigneeIds"]').click();
  await page.getByRole('checkbox', { name: 'alice', exact: true }).click();
  await page.getByRole('checkbox', { name: 'bob', exact: true }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page
    .locator('ion-input[type="datetime-local"] input')
    .fill('2026-10-30T17:00');
  const casePath = await created(page);
  await expect(
    page.getByText('Independent snapshot copied from parent.'),
  ).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Context Bag entries' }),
  ).toContainText('11045');
  const developer = await browser.newContext({
    baseURL: 'http://127.0.0.1:4201',
  });
  const bob = await developer.newPage();
  observe(bob);
  await login(bob, 'bob');
  await bob.goto('/my/work');
  await expect(bob.locator(`ion-item[href="${casePath}"]`)).toBeVisible();
  await bob.locator(`ion-item[href="${casePath}"]`).click();
  await expect(
    bob.getByRole('list', { name: 'Context Bag entries' }),
  ).toContainText('11045');
  const extraSubject =
    environment.subjects.find((s: { label: string }) =>
      /shipment.*id/i.test(s.label),
    ) || orderSubject;
  await addContext(
    bob,
    extraSubject.label,
    extraSubject === orderSubject ? '11046' : '7201',
  );
  await page.goto(incidentPath);
  await expect(
    page.getByRole('list', { name: 'Context Bag entries' }),
  ).toContainText('11045');
  await expect(
    page.getByRole('list', { name: 'Context Bag entries' }),
  ).not.toContainText(extraSubject === orderSubject ? '11046' : '7201');
  await bob
    .getByRole('link', { name: 'Create linked Task', exact: true })
    .click();
  await bob
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Repair shipment allocation for order 11045');
  const taskPath = await created(bob);
  await bob
    .getByRole('button', { name: 'Link work or artefact', exact: true })
    .click();
  await choose(bob, 'ion-select[label="Reference type"]', 'Check');
  await bob
    .getByRole('textbox', { name: 'Existing reference ID', exact: true })
    .fill('shipping-request-received');
  await bob.locator('ion-select[label="Environment"]').click();
  await bob.getByRole('radio').filter({ hasText: /uat/i }).first().click();
  await bob.getByRole('button', { name: 'Add link', exact: true }).click();
  await expect(
    bob.getByText('shipping-request-received', { exact: true }),
  ).toBeVisible();
  await bob
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Remediation linked to the existing shipment Check.');
  await bob.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(
    bob.getByText('Remediation linked to the existing shipment Check.', {
      exact: true,
    }),
  ).toBeVisible();
  await bob.goto(casePath);
  await bob.getByRole('button', { name: 'Change status', exact: true }).click();
  await choose(bob, 'ion-select[label="Next status"]', 'Closed');
  await bob
    .getByRole('textbox', { name: 'Reason or resolution summary', exact: true })
    .fill('Investigation evidence is recorded and remediation is assigned.');
  await bob.getByRole('button', { name: 'Save status', exact: true }).click();
  await expect(bob.locator('.badges')).toContainText('Closed');
  await bob.getByRole('button', { name: 'Change status', exact: true }).click();
  await choose(bob, 'ion-select[label="Next status"]', 'Active');
  await bob
    .getByRole('textbox', { name: 'Reason or resolution summary', exact: true })
    .fill('Reopened to verify the remediation outcome.');
  await bob.getByRole('button', { name: 'Save status', exact: true }).click();
  await expect(bob.locator('.badges')).toContainText('Active');
  await bob.goto(taskPath);

  await bob.reload();
  await expect(
    bob.getByRole('heading', {
      name: 'Repair shipment allocation for order 11045',
    }),
  ).toBeVisible();
  await page.goto(base);
  for (const path of [incidentPath, casePath, taskPath])
    await expect(page.locator(`ion-item[href="${path}"]`)).toBeVisible();
  await stableScreenshot(page, 'project-work-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await stableScreenshot(page, 'project-work-mobile');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await developer.close();
  expect(errors).toEqual([]);
});
