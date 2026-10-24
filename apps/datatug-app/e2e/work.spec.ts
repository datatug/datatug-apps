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
  const { idToken } = await auth.json();
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
async function stableScreenshot(page: Page, name: string, scrollTop = true) {
  if (scrollTop)
    await page
      .locator('ion-content:visible')
      .last()
      .evaluate((element) =>
        (
          element as HTMLElement & {
            scrollToTop(duration: number): Promise<void>;
          }
        ).scrollToTop(0),
      );
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
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
  await expect(
    page.getByRole('textbox', { name: 'Context value', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Add value', exact: true }),
  ).toBeFocused();
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
  await expect(
    page.locator(
      'sneat-work-page.ion-page:not(.ion-page-hidden):not(.ion-page-invisible)',
    ),
  ).toHaveCount(1);
  await expect(
    page
      .locator('ion-item-divider:visible')
      .filter({ hasText: /^Context Bag$/ }),
  ).toBeVisible();
  return new URL(page.url()).pathname;
}

test('real Work HTTP: Incident, delegated Case, context isolation and remediation Task', async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  const diagnostics: { kind: string; message: string }[] = [];
  const observe = (p: Page) => {
    p.on('pageerror', (error) => errors.push(error.message));
    p.on('console', (message) => {
      if (message.type() === 'error')
        diagnostics.push({ kind: 'console', message: message.text() });
    });
    p.on('requestfailed', (request) =>
      diagnostics.push({
        kind: 'request-failed',
        message:
          new URL(request.url()).origin +
          new URL(request.url()).pathname +
          ': ' +
          request.failure()?.errorText,
      }),
    );
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
  await page
    .getByRole('textbox', { name: 'Closure criteria (optional)', exact: true })
    .fill('Retain a completed shipment Check run and link a remediation task.');
  await page
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill(
      'Inspect shipment receipt evidence in UAT, keep findings local, and propose reviewed changes to the incident owner.',
    );
  await page.locator('ion-select[formControlName="assigneeIds"]').click();
  await page
    .getByRole('checkbox', {
      name:
        catalog.members.find((m: { id: string }) => m.id === 'alice')?.title ||
        'alice',
      exact: true,
    })
    .click();
  await page
    .getByRole('checkbox', {
      name:
        catalog.members.find((m: { id: string }) => m.id === 'bob')?.title ||
        'bob',
      exact: true,
    })
    .click();
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
  await bob.setViewportSize({ width: 390, height: 844 });
  await bob.locator('sneat-work-context').scrollIntoViewIfNeeded();
  await stableScreenshot(bob, 'case-context-mobile', false);
  await bob.setViewportSize({ width: 1280, height: 900 });
  await bob
    .getByRole('list', { name: 'Context Bag entries' })
    .getByRole('checkbox')
    .first()
    .click();
  await expect(
    bob
      .getByRole('list', { name: 'Context Bag entries' })
      .getByRole('checkbox')
      .first(),
  ).toBeChecked();
  const applied = bob.waitForResponse(
    (response) =>
      response.url().endsWith('/work/actions') &&
      response.request().method() === 'POST',
  );
  await bob
    .getByRole('button', { name: 'Apply selected context', exact: true })
    .click();
  expect((await applied).status()).toBe(200);
  await expect(
    bob.getByRole('button', {
      name: 'Investigate selected context',
      exact: true,
    }),
  ).toBeEnabled();
  await bob
    .getByRole('button', { name: 'Investigate selected context', exact: true })
    .click();
  await expect(bob).toHaveURL(/\/sessions\/[^/]+\/overview/);
  await bob.getByRole('button', { name: /Context · 0 applied/ }).click();
  await expect(
    bob.getByText('Context Bag', { exact: true }).first(),
  ).toBeVisible();
  await expect(bob.locator('ion-modal:visible')).toContainText('11045');
  await expect(bob.locator('ion-modal:visible')).toContainText(
    'Copied values are not applied automatically.',
  );
  await stableScreenshot(bob, 'private-execution-context-desktop');
  await bob.goto(casePath);
  await bob
    .getByRole('link', {
      name: 'Open Detective tools and evidence',
      exact: true,
    })
    .click();
  await expect(bob).toHaveURL(/\/detective\/[^/?]+(?:\?.*)?$/);
  const specialistCasePath = new URL(bob.url()).pathname;
  await bob
    .locator('ion-item[href*="/checks/shipping-request-received"]')
    .click();
  await expect(
    bob.getByRole('textbox', { name: 'Order ID', exact: true }),
  ).toBeVisible();
  await bob.locator('.check-detail-run-field ion-select').first().click();
  await bob.getByRole('radio').filter({ hasText: /uat/i }).click();
  await bob.getByRole('button', { name: 'OK', exact: true }).click();
  await bob
    .getByRole('textbox', { name: 'Order ID', exact: true })
    .fill('11045');
  const runResponse = bob.waitForResponse(
    (response) =>
      response.url().includes('/datatug/detective/action') &&
      response.request().method() === 'POST',
  );
  await bob.getByTestId('run-check-action').click();
  const run = await runResponse;
  expect(run.status()).toBe(200);
  await expect(bob.getByText(/^completed ·/).first()).toBeVisible();
  await bob.goto(specialistCasePath);
  await expect(
    bob.getByRole('heading', {
      name: 'Check run · shipping-request-received',
      exact: true,
    }),
  ).toBeVisible();
  await bob
    .getByRole('heading', { name: 'Evidence & Check runs', exact: true })
    .scrollIntoViewIfNeeded();
  await stableScreenshot(bob, 'case-evidence-desktop', false);
  await bob.goto(casePath);
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
  const selectedEntries = bob
    .getByRole('list', { name: 'Context Bag entries' })
    .getByRole('checkbox');
  for (const checkbox of await selectedEntries.all())
    if (await checkbox.isChecked()) await checkbox.click();
  await selectedEntries.last().click();
  await bob
    .getByRole('button', { name: 'Propose to parent', exact: true })
    .click();
  await expect(
    bob.getByText('Awaiting parent review', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('list', { name: 'Context Bag entries' }),
  ).not.toContainText(extraSubject === orderSubject ? '11046' : '7201');
  await page
    .getByRole('button', { name: 'Review proposal', exact: true })
    .click();
  await expect(page.locator('ion-modal:visible')).toContainText(
    extraSubject === orderSubject ? '11046' : '7201',
  );
  await stableScreenshot(page, 'parent-context-proposal-review');
  await page
    .getByRole('button', { name: 'Accept proposed context', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Review proposal', exact: true }),
  ).toHaveCount(0);
  const acceptedContext = await (
    await page.request.get(
      `${api}/context?spaceID=space&projectID=project&id=${incidentPath.split('/').pop()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
  ).json();
  expect(
    acceptedContext.revisions.some(
      (revision: { value: { scalar?: { value: string } } }) =>
        revision.value.scalar?.value ===
        (extraSubject === orderSubject ? '11046' : '7201'),
    ),
  ).toBe(true);
  await bob
    .getByRole('link', { name: 'Create linked Task', exact: true })
    .click();
  await bob
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Repair shipment allocation for order 11045');
  await bob.setViewportSize({ width: 390, height: 844 });
  await stableScreenshot(bob, 'task-form-mobile');
  await bob.setViewportSize({ width: 1280, height: 900 });
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
  await bob
    .locator('ion-item[href*="/checks/shipping-request-received"]')
    .click();
  await expect(
    bob.getByRole('list', { name: 'Work referencing this artefact' }),
  ).toContainText('Repair shipment allocation for order 11045');
  await stableScreenshot(bob, 'check-work-backlinks-desktop');
  await bob.goto(taskPath);
  await bob
    .getByRole('button', { name: 'Link work or artefact', exact: true })
    .click();
  await choose(bob, 'ion-select[label="Reference type"]', 'Query');
  await bob
    .getByRole('textbox', { name: 'Existing reference ID', exact: true })
    .fill('order-receipt');
  await bob
    .getByRole('textbox', { name: 'Query folder (optional)', exact: true })
    .fill('shipping');
  await bob.locator('ion-select[label="Environment"]').click();
  await bob.getByRole('radio').filter({ hasText: /uat/i }).first().click();
  await bob.getByRole('button', { name: 'Add link', exact: true }).click();
  await bob.locator('ion-item[href*="/query/"]').click();
  await expect(bob).toHaveURL(/id=shipping%2Forder-receipt/);
  await expect(
    bob.getByRole('list', { name: 'Work referencing this artefact' }),
  ).toContainText('Repair shipment allocation for order 11045');
  await bob
    .getByRole('list', { name: 'Work referencing this artefact' })
    .scrollIntoViewIfNeeded();
  await stableScreenshot(bob, 'query-work-backlinks-desktop', false);
  await bob.goto(casePath);
  await bob.getByRole('button', { name: 'Change status', exact: true }).click();
  await choose(bob, 'ion-select[label="Next status"]', 'Closed');
  await bob
    .getByRole('textbox', { name: 'Reason or resolution summary', exact: true })
    .fill('Investigation evidence is recorded and remediation is assigned.');
  await expect(
    bob
      .getByText(
        'Retain a completed shipment Check run and link a remediation task.',
        { exact: true },
      )
      .last(),
  ).toBeVisible();
  await bob
    .getByRole('checkbox', {
      name: 'I verified the closure criteria',
      exact: true,
    })
    .click();
  await bob.setViewportSize({ width: 390, height: 844 });
  await stableScreenshot(bob, 'case-status-mobile');

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
  await testInfo.attach('work-browser-diagnostics', {
    body: JSON.stringify(
      { errors, diagnostics, incidentPath, casePath, taskPath },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

test('independent Context Bags, accountability edits, stale writes and viewer denial', async ({
  page,
}, testInfo) => {
  const token = await login(page, 'alice');
  const catalog = await (
    await page.request.get(`${api}/items?spaceID=space&projectID=project`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const environment = catalog.environments.find(
    (e: { identityDomain: string }) => /shipping/i.test(e.identityDomain),
  );
  const subject = environment.subjects.find((s: { label: string }) =>
    /order.*id/i.test(s.label),
  );
  const independent: string[] = [];
  for (const type of ['case', 'task']) {
    await page.goto(`${base}/new?type=${type}`);
    await page
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill(
        type === 'case'
          ? 'Independent shipment investigation'
          : 'Independent receipt verification',
      );
    const option = page
      .locator('ion-select[formControlName="environment"] ion-select-option')
      .filter({ hasText: environment.title })
      .first();
    await choose(
      page,
      'ion-select[formControlName="environment"]',
      (await option.textContent())!.trim(),
    );
    const path = await created(page);
    independent.push(path);
    await addContext(page, subject.label, '11045');
    await page.reload();
    await expect(
      page.getByRole('list', { name: 'Context Bag entries' }),
    ).toContainText('11045');
  }
  const taskPath = independent[1];
  await page.getByRole('button', { name: 'Edit work', exact: true }).click();
  await page
    .locator('ion-input[type="datetime-local"] input')
    .fill('2026-11-02T09:00');
  await page.locator('ion-select[formControlName="assigneeIds"]').click();
  for (const id of ['alice', 'bob'])
    await page
      .getByRole('checkbox', {
        name:
          catalog.members.find((m: { id: string }) => m.id === id)?.title || id,
        exact: true,
      })
      .click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page.getByText('Due date: None → 2026-11-02T09:00:00Z', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Assignees: alice → bob', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit work', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Stale draft must not overwrite a concurrent update.');
  const other = await page.context().newPage();
  await other.goto(taskPath);
  await other.getByRole('button', { name: 'Edit work', exact: true }).click();
  await other
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Concurrent verified update.');
  await other
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await expect(
    other.getByText('Concurrent verified update.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page.getByText(
      'This work changed elsewhere. Reload and review the latest version before submitting again.',
      { exact: true },
    ),
  ).toBeVisible();
  await stableScreenshot(page, 'stale-write-review-desktop');
  await page
    .getByRole('button', { name: 'Reload latest', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Description', exact: true }),
  ).toHaveValue('Concurrent verified update.');
  await other.close();
  const viewerAuth = await page.request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=e2e',
    {
      data: {
        email: 'viewer@work.example.test',
        password,
        returnSecureToken: true,
      },
    },
  );
  const viewerToken = (await viewerAuth.json()).idToken;
  const id = taskPath.split('/').pop();
  const current = await (
    await page.request.get(
      `${api}/item?spaceID=space&projectID=project&id=${id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
  ).json();
  const denied = await page.request.post(`${api}/actions`, {
    headers: { Authorization: `Bearer ${viewerToken}` },
    data: {
      spaceID: 'space',
      projectID: 'project',
      itemId: id,
      expectedVersion: current.item.version,
      operationId: crypto.randomUUID(),
      action: 'comment',
      comment: 'Viewer must not mutate this work.',
    },
  });
  expect(denied.status()).toBe(403);
  const reloaded = await (
    await page.request.get(
      `${api}/item?spaceID=space&projectID=project&id=${id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
  ).json();
  expect(reloaded.item.version).toBe(current.item.version);
  await testInfo.attach('work-isolation-evidence', {
    body: JSON.stringify({
      independent,
      viewerMutationStatus: denied.status(),
      versionPreserved: reloaded.item.version === current.item.version,
    }),
    contentType: 'application/json',
  });
});
