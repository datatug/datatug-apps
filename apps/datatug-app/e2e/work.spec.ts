import { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
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
  if ((page.viewportSize()?.width || 1280) <= 600)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
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
  if (scrollTop)
    await page.locator('ion-content:visible').evaluateAll(async (elements) => {
      await Promise.all(
        elements.map((element) =>
          (
            element as HTMLElement & {
              scrollToTop(duration: number): Promise<void>;
            }
          ).scrollToTop(0),
        ),
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
        diagnostics.push({
          kind: 'console',
          message:
            message.text() + ' @ ' + message.location().url.split('?')[0],
        });
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
      if (response.status() >= 400)
        diagnostics.push({
          kind: 'http-error',
          message: `${response.status()} ${new URL(response.url()).origin}${new URL(response.url()).pathname}`,
        });
      if (response.url().includes('/datatug/work/') && response.status() >= 400)
        errors.push(`${response.status()} ${response.url()}`);
    });
  };
  observe(page);
  const token = await login(page, 'alice');
  const integrated = process.env['DATATUG_WORK_WATCH_E2E'] === '1';
  const catalog = await (
    await page.request.get(`${api}/items?spaceID=space&projectID=project`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const environment =
    catalog.environments.find((e: { identityDomain: string }) =>
      /shipping/i.test(e.identityDomain),
    ) || catalog.environments[0];
  let incidentPath: string;
  const orderSubject = environment.subjects.find((s: { label: string }) =>
    /order.*id/i.test(s.label),
  );
  expect(orderSubject).toBeTruthy();
  if (integrated) {
    const watchPath = base.replace(/\/work$/, '/watch/order-11045-shared');
    await page.goto(watchPath);
    const watchPanel = page.locator('sneat-work-watch');
    await expect(
      watchPanel.getByRole('list', { name: 'Watch events', exact: true }),
    ).toContainText('Watch triggered');
    await expect(
      watchPanel.getByRole('list', {
        name: 'Watch notifications',
        exact: true,
      }),
    ).toContainText('In-app notification');
    await expect(
      watchPanel.getByRole('list', {
        name: 'Watch notification delivery',
        exact: true,
      }),
    ).toContainText('email');
    await stableScreenshot(page, 'watch-trigger-desktop');
    await watchPanel
      .getByRole('button', { name: 'Create Incident', exact: true })
      .first()
      .click();
    await expect(
      watchPanel.getByText('Review Watch handoff', { exact: true }),
    ).toBeVisible();
    await expect(watchPanel).toContainText('11045');
    await page
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill('Delayed shipment · order 11045');
    await expect(
      page.getByRole('textbox', { name: 'Description', exact: true }),
    ).toHaveValue(/Watch order-11045-shared/);
    await page.setViewportSize({ width: 390, height: 844 });
    await watchPanel
      .getByRole('heading', { name: 'Review Watch handoff', exact: true })
      .scrollIntoViewIfNeeded();
    await stableScreenshot(page, 'watch-handoff-mobile', false);
    await page.setViewportSize({ width: 1280, height: 900 });
    incidentPath = await created(page);
    await expect(
      page.getByRole('list', { name: 'Context Bag entries', exact: true }),
    ).toContainText('11045');
    await expect(
      page.getByRole('list', { name: 'Retained Watch evidence', exact: true }),
    ).toContainText('Watch triggered');
  } else {
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
    const scopeOption = page
      .locator('ion-select[formControlName="environment"] ion-select-option')
      .filter({ hasText: environment.title });
    const optionLabel = (await scopeOption.first().textContent())!.trim();
    await choose(
      page,
      'ion-select[formControlName="environment"]',
      optionLabel,
    );
    incidentPath = await created(page);
    await addContext(page, orderSubject.label, '11045');
  }
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
  const executionSessionId = new URL(bob.url()).pathname.match(
    /\/sessions\/([^/]+)\/overview$/,
  )?.[1];
  expect(executionSessionId).toBeTruthy();
  await bob.getByRole('button', { name: /Context · 0 applied/ }).click();
  await expect(
    bob
      .locator('ion-modal:visible')
      .getByText('Context Bag', { exact: true })
      .first(),
  ).toBeVisible();
  await expect(bob.locator('ion-modal:visible')).toContainText('11045');
  await expect(bob.locator('ion-modal:visible')).toContainText(
    'Copied values are not applied automatically.',
  );
  await stableScreenshot(bob, 'private-execution-context-desktop');
  await bob.getByRole('checkbox', { name: /^Use / }).first().click();
  await bob.getByRole('button', { name: 'Apply Context', exact: true }).click();
  await expect(
    bob
      .locator('ion-modal:visible')
      .getByText('Applied selection is current', { exact: true }),
  ).toBeVisible();
  await bob
    .locator('ion-modal:visible')
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await expect(
    bob.getByRole('button', { name: /Context · 1 applied/ }),
  ).toBeVisible();
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
  if (integrated) {
    await bob
      .getByRole('button', {
        name: 'Choose Incident for evidence',
        exact: true,
      })
      .click();
    await choose(
      bob,
      'ion-select[label="Evidence Incident"]',
      /Delayed shipment · order 11045/,
    );
    await bob.getByRole('button', { name: 'OK', exact: true }).click();
    await bob
      .getByRole('button', { name: 'Choose applied context', exact: true })
      .click();
    const options = bob.locator(
      'ion-select[label="Native Session"] ion-select-option',
    );
    await expect
      .poll(() =>
        options.evaluateAll(
          (elements, id) =>
            elements.some(
              (element) =>
                (element as HTMLElement & { value?: string }).value === id,
            ),
          executionSessionId,
        ),
      )
      .toBe(true);
    const title = await options.evaluateAll(
      (elements, id) =>
        elements
          .find(
            (element) =>
              (element as HTMLElement & { value?: string }).value === id,
          )
          ?.textContent?.trim(),
      executionSessionId,
    );
    expect(title).toBeTruthy();
    await choose(bob, 'ion-select[label="Native Session"]', title || '');
    await bob.getByRole('button', { name: 'OK', exact: true }).click();
    await choose(
      bob,
      'ion-select[label="Applied scalar revision"]',
      /order_id.*11045/,
    );
    await bob.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(bob.getByTestId('run-check-action')).toHaveAttribute(
      'aria-label',
      'Run Check and attach to Incident',
    );
    await stableScreenshot(bob, 'watch-inherited-context-check-binding', false);
  }
  const runResponse = bob.waitForResponse(
    (response) =>
      response.url().includes('/datatug/detective/action') &&
      response.request().method() === 'POST',
  );
  await bob.getByTestId('run-check-action').click();
  const run = await runResponse;
  expect(run.status()).toBe(200);
  if (integrated) {
    const request = run.request().postDataJSON();
    expect(request.evidence.retention).toBe('project-pinned');
    expect(request.evidence.context.sessionId).toBe(executionSessionId);
    expect(request.evidence.context.bindings[0].inputName).toBe('order_id');
    expect(request.evidence.context.scope).toEqual({
      environmentId: environment.environmentId,
      identityDomain: environment.identityDomain,
    });
  }
  await expect(bob.getByText(/completed · pass/).first()).toBeVisible();
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
  await bob
    .getByRole('list', { name: 'Context Bag entries' })
    .getByRole('listitem')
    .filter({ hasText: extraSubject === orderSubject ? '11046' : '7201' })
    .getByRole('checkbox')
    .click();
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
  const acceptanceResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/work/actions') &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Accept proposed context', exact: true })
    .click();
  expect((await acceptanceResponse).status()).toBe(200);
  await expect(page.locator('ion-modal:visible')).toHaveCount(0);
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
  await bob.getByRole('textbox', { name: 'Title', exact: true }).focus();
  await bob.keyboard.press('Tab');
  await expect(
    bob.getByRole('textbox', { name: 'Description', exact: true }),
  ).toBeFocused();
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
  await bob.locator('a[href*="/checks/shipping-request-received"]').click();
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
  await bob.locator('a[href*="/query/"]').click();
  await expect(bob).toHaveURL(/id=shipping%2Forder-receipt/);
  await expect(
    bob.getByRole('list', { name: 'Work referencing this artefact' }),
  ).toContainText('Repair shipment allocation for order 11045');
  await bob
    .getByRole('list', { name: 'Work referencing this artefact' })
    .scrollIntoViewIfNeeded();
  await stableScreenshot(bob, 'query-work-backlinks-desktop', false);
  await bob.goto(casePath);
  await expect(
    bob
      .locator('ion-item')
      .filter({ has: bob.locator(`a[href="${incidentPath}"]`) }),
  ).toContainText('Parent · Incident');
  const statusTrigger = bob.getByRole('button', {
    name: 'Change status',
    exact: true,
  });
  await statusTrigger.click();
  await expect
    .poll(() =>
      bob
        .locator('ion-modal:visible')
        .evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);
  await bob.keyboard.press('Escape');
  await expect(bob.locator('ion-modal:visible')).toHaveCount(0);
  await expect(statusTrigger).toBeFocused();
  await statusTrigger.click();
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
  await page.goto(incidentPath);
  if (integrated) {
    // Correct/replay only the authoritative hosted revision; the test host exports
    // its exact accepted bytes for the real native runners.
    const shipping = 'http://127.0.0.1:8090/v0/datatug/shipping';
    const shippingScope =
      '?storage=firestore&spaceID=space&project=project&sourceId=shipping-working-copy';
    let revision = await (
      await page.request.get(shipping + '/revision' + shippingScope, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    for (const action of ['correct', 'replay']) {
      const response = await page.request.post(shipping + '/action', {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          spaceID: 'space',
          projectId: 'project',
          sourceId: 'shipping-working-copy',
          operationId: `watch-browser-${action}-${crypto.randomUUID()}`,
          action,
          expected: {
            generation: revision.generation,
            revision: revision.revision,
            sha256: revision.sha256,
          },
          ...(action === 'replay' ? { orderId: 11045 } : {}),
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      revision = (await response.json()).current;
    }
    const activeWatch = page.locator('sneat-work-watch').first();
    await expect(async () => {
      await activeWatch
        .getByRole('button', { name: 'Refresh evidence', exact: true })
        .click();
      await expect(
        activeWatch.getByRole('list', { name: 'Watch events', exact: true }),
      ).toContainText('Recovered');
    }).toPass({ timeout: 45_000 });
    await expect(page.locator('.badges')).toContainText('Open');
    await activeWatch
      .getByRole('button', {
        name: 'Record latest Watch evidence',
        exact: true,
      })
      .click();
    await activeWatch
      .getByRole('button', { name: 'Confirm evidence import', exact: true })
      .click();
    await expect(
      page.getByRole('list', { name: 'Retained Watch evidence', exact: true }),
    ).toContainText('Recovered');
    await expect(page.locator('.badges')).toContainText('Open');
    await stableScreenshot(page, 'watch-recovery-human-resolution');
  }
  for (const status of ['Investigating', 'Recovering', 'Resolved', 'Closed']) {
    await page
      .getByRole('button', { name: 'Change status', exact: true })
      .click();
    await choose(page, 'ion-select[label="Next status"]', status);
    await page
      .getByRole('textbox', {
        name: 'Reason or resolution summary',
        exact: true,
      })
      .fill(
        `Shipment evidence reviewed; incident ${status.toLowerCase()} with linked investigation and remediation retained.`,
      );
    await page
      .getByRole('button', { name: 'Save status', exact: true })
      .click();
    await expect(page.locator('.badges')).toContainText(status);
  }
  await expect(page.locator(`a[href="${casePath}"]`)).toBeVisible();
  await expect(
    page
      .locator('ion-item')
      .filter({ has: page.locator(`a[href="${casePath}"]`) }),
  ).toContainText('Child · Detective Case');
  await stableScreenshot(page, 'incident-closed-desktop');
  await page
    .getByText('Open Incident evidence and resolution', { exact: true })
    .click();
  await expect(page).toHaveURL(/\/incidents\/[^/]+\/[^/?]+\?environment=uat$/);
  await expect(
    page.locator(
      'sneat-datatug-hosted-incidents-page.ion-page:not(.ion-page-hidden)',
    ),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator(
      'sneat-datatug-hosted-incidents-page.ion-page:not(.ion-page-hidden)',
    ),
  ).toBeVisible();
  await expect(
    page
      .getByRole('heading')
      .filter({ hasText: 'Delayed shipment · order 11045' }),
  ).toBeVisible();
  await expect(
    page.getByText('Invalid Incident projection', { exact: false }),
  ).toHaveCount(0);
  await expect(
    page
      .locator('sneat-datatug-hosted-incidents-page')
      .getByText('closed', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Linked Detective Cases' }),
  ).toContainText('Investigate delayed order 11045');
  await stableScreenshot(page, 'incident-native-evidence-desktop');
  await writeFile(
    'coverage/apps/datatug-work/primary-diagnostics.json',
    JSON.stringify(
      { errors, diagnostics, incidentPath, casePath, taskPath },
      null,
      2,
    ),
  );
  await page.goto(base);
  for (const path of [incidentPath, casePath, taskPath]) {
    const item = page.locator(`ion-item[href="${path}"]`);
    await expect(page.locator('.work-row').first()).toBeVisible();
    for (let next = 0; next < 10 && !(await item.count()); next++) {
      const more = page.getByRole('button', {
        name: 'Load more work',
        exact: true,
      });
      if (!(await more.count())) break;
      await more.click();
      await expect(page.locator('ion-spinner:visible')).toHaveCount(0);
    }
    await expect(item).toBeVisible();
  }
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
  await writeFile(
    'coverage/apps/datatug-work/primary-diagnostics.json',
    JSON.stringify(
      { errors, diagnostics, incidentPath, casePath, taskPath },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
});

test('independent Context Bags, accountability edits, stale writes and viewer denial', async ({
  page,
}, testInfo) => {
  const diagnostics: { kind: string; message: string }[] = [];
  page.on('pageerror', (error) =>
    diagnostics.push({ kind: 'pageerror', message: error.message }),
  );
  page.on('console', (message) => {
    if (message.type() === 'error')
      diagnostics.push({
        kind: 'console',
        message: message.text() + ' @ ' + message.location().url.split('?')[0],
      });
  });
  page.on('requestfailed', (request) =>
    diagnostics.push({
      kind: 'request-failed',
      message:
        new URL(request.url()).origin +
        new URL(request.url()).pathname +
        ': ' +
        request.failure()?.errorText,
    }),
  );
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
  const independentCaseID = independent[0].split('/').pop();
  const caseBefore = await (
    await page.request.get(
      `${api}/item?spaceID=space&projectID=project&id=${independentCaseID}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
  ).json();
  const invalidTransition = await page.request.post(`${api}/actions`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      spaceID: 'space',
      projectID: 'project',
      itemId: independentCaseID,
      expectedVersion: caseBefore.item.version,
      operationId: crypto.randomUUID(),
      action: 'transition',
      status: 'open',
      summary: 'Deliberately invalid Case transition test.',
    },
  });
  expect(invalidTransition.status()).toBe(409);
  const caseAfter = await (
    await page.request.get(
      `${api}/item?spaceID=space&projectID=project&id=${independentCaseID}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
  ).json();
  expect(caseAfter.item.version).toBe(caseBefore.item.version);
  expect(caseAfter.item.status).toBe(caseBefore.item.status);
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
  const staleResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/work/actions') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await staleResponse).status()).toBe(409);
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
  await writeFile(
    'coverage/apps/datatug-work/isolation-diagnostics.json',
    JSON.stringify(
      {
        independent,
        diagnostics,
        invalidTransitionStatus: invalidTransition.status(),
        staleWriteStatus: 409,
        viewerMutationStatus: denied.status(),
        versionPreserved: reloaded.item.version === current.item.version,
      },
      null,
      2,
    ),
  );
  expect(diagnostics.filter((entry) => entry.kind === 'pageerror')).toEqual([]);
  await testInfo.attach('work-isolation-evidence', {
    body: JSON.stringify({
      independent,
      viewerMutationStatus: denied.status(),
      versionPreserved: reloaded.item.version === current.item.version,
    }),
    contentType: 'application/json',
  });
});

test('Watch events create each canonical type, link existing work and correlate another actor', async ({
  page,
  browser,
}) => {
  test.skip(
    process.env['DATATUG_WORK_WATCH_E2E'] !== '1',
    'Requires the owned real Coordinator/Runner integration fixture.',
  );
  const token = await login(page, 'alice');
  const headers = { Authorization: `Bearer ${token}` };
  const watchPath = base.replace(/\/work$/, '/watch/order-11045-shared');
  const view = await (
    await page.request.get(
      `${api}/watch-events?spaceID=space&projectID=project&watchId=order-11045-shared`,
      { headers },
    )
  ).json();
  const incident = view.linkedItems.find(
    (item: { type: string }) => item.type === 'incident',
  );
  expect(incident).toBeTruthy();
  for (const [action, title] of [
    ['Create Detective Case', 'Watch-linked Detective Case 11045'],
    ['Create Task', 'Watch-linked Task 11045'],
  ]) {
    await page.goto(watchPath);
    await page
      .locator('sneat-work-watch')
      .getByRole('button', { name: action, exact: true })
      .first()
      .click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
    await created(page);
    await expect(
      page.getByRole('list', { name: 'Context Bag entries', exact: true }),
    ).toContainText('11045');
    await expect(
      page.getByRole('list', { name: 'Retained Watch evidence', exact: true }),
    ).toContainText('Watch triggered');
  }
  const work = await (
    await page.request.get(`${api}/items?spaceID=space&projectID=project`, {
      headers,
    })
  ).json();
  const remediation = work.items.find(
    (item: { title: string }) =>
      item.title === 'Repair shipment allocation for order 11045',
  );
  expect(remediation).toBeTruthy();
  const contextUrl = `${api}/context?spaceID=space&projectID=project&id=${remediation.id}`;
  const before = await (await page.request.get(contextUrl, { headers })).json();
  await page.goto(watchPath);
  await page
    .locator('sneat-work-watch')
    .getByRole('button', { name: 'Link existing work', exact: true })
    .first()
    .click();
  await choose(
    page,
    'ion-select[label="Existing work item"]',
    /Repair shipment allocation for order 11045/,
  );
  await page.getByRole('button', { name: 'Confirm link', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/work/${remediation.id}$`));
  const after = await (await page.request.get(contextUrl, { headers })).json();
  for (const entry of before.entries)
    expect(after.entries).toContainEqual(entry);
  for (const revision of before.revisions)
    expect(after.revisions).toContainEqual(revision);
  await expect(
    page.getByRole('list', { name: 'Retained Watch evidence', exact: true }),
  ).toContainText('Watch triggered');
  await stableScreenshot(page, 'watch-existing-link-preserves-context');
  await page.goto(base.replace(/\/work$/, '/watch/order-11045-one-shot'));
  const personalPanel = page.locator('sneat-work-watch');
  await expect(personalPanel).toContainText('completed');
  await personalPanel
    .getByRole('button', { name: 'Create Task', exact: true })
    .first()
    .click();
  await page
    .getByRole('checkbox', {
      name: 'I agree to share this personal Watch event and selected context with the project.',
      exact: true,
    })
    .check();
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Follow up completed one-shot order 11045');
  await created(page);
  await expect(
    page.getByRole('list', { name: 'Retained Watch evidence', exact: true }),
  ).toContainText('Recovered');
  const oneShot = await (
    await page.request.get(
      `${api}/watch-events?spaceID=space&projectID=project&watchId=order-11045-one-shot`,
      { headers },
    )
  ).json();
  expect(oneShot.watches[0].lifecycle).toBe('completed');
  const recurring = await (
    await page.request.get(
      `${api}/watch-events?spaceID=space&projectID=project&watchId=order-11045-shared`,
      { headers },
    )
  ).json();
  expect(recurring.watches[0].lifecycle).toBe('enabled');
  await stableScreenshot(page, 'one-shot-followup-context-consent');
  const bobContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:4201',
  });
  const bob = await bobContext.newPage();
  await login(bob, 'bob');
  await bob.goto(watchPath);
  await bob
    .locator('sneat-work-watch')
    .getByRole('button', { name: 'Create Incident', exact: true })
    .first()
    .click();
  await bob
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Duplicate confirmation must preserve canonical Incident');
  await created(bob);
  await expect(bob).toHaveURL(new RegExp(`/work/${incident.id}$`));
  const current = await (
    await page.request.get(
      `${api}/item?spaceID=space&projectID=project&id=${incident.id}`,
      { headers },
    )
  ).json();
  expect(current.item.title).toBe(incident.title);
  expect(current.item.version).toBe(incident.version);
  expect(current.item.status).toBe('closed');
  await bobContext.close();
});
