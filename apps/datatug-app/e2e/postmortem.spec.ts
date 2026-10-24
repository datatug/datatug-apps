import { expect, test } from './helpers/demodb-guard';
import { SIGN_IN_BUTTON } from './helpers/sign-in-button';
import type { WorkDetail, WorkPage } from '@sneat/datatug-main';
const api = 'http://127.0.0.1:8090/v0/datatug';
const scope = { spaceID: 'space', projectID: 'project' };
/** Test-only provider/email adapters belong to Backend TestWorkBrowserHost; no application writes are intercepted. */
test('Northwind persisted Case → Postmortem → reviewed immutable publication', async ({
  page,
  browser,
}, testInfo) => {
  const auth = await page.request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=e2e',
    {
      data: {
        email: 'alice@work.example.test',
        password: 'work-emulator-only-2026',
        returnSecureToken: true,
      },
    },
  );
  expect(auth.ok()).toBe(true);
  const { idToken } = await auth.json();
  const headers = { Authorization: `Bearer ${idToken}` };
  const list = await page.request.get(`${api}/work/items`, {
    headers,
    params: scope,
  });
  expect(list.ok()).toBe(true);
  const catalog = (await list.json()) as WorkPage;
  const create = await page.request.post(`${api}/work/actions`, {
    headers,
    data: {
      ...scope,
      operationId: crypto.randomUUID(),
      action: 'create',
      draft: {
        type: 'case',
        title: 'Northwind 11045 postmortem investigation',
        priority: 'normal',
        criteria: 'Record the limits of available evidence.',
      },
      contextScope: {
        environmentId: catalog.environments[0].environmentId,
        identityDomain: catalog.environments[0].identityDomain,
      },
    },
  });
  expect(create.ok(), await create.text()).toBe(true);
  const parent = (await create.json()) as WorkDetail;
  const nativeCaseId = parent.item.case?.legacyCaseId;
  if (!nativeCaseId)
    throw new Error('Missing canonical Case evidence association');
  const run = await page.request.post(`${api}/detective/action`, {
    headers,
    data: {
      storage: 'firestore',
      spaceID: 'space',
      project: 'project',
      operationId: crypto.randomUUID(),
      type: 'run-check',
      checkId: 'shipping-request-received',
      caseId: nativeCaseId,
      environment: 'uat',
      inputs: { order_id: { type: 'integer', value: '11045' } },
    },
  });
  expect(run.ok(), await run.text()).toBe(true);
  const completedRun = await run.json();
  expect(completedRun.run.outcome).toBe('pass');
  expect(completedRun.caseLinkStatus).toMatch(/linked/);
  const close = await page.request.post(`${api}/work/actions`, {
    headers,
    data: {
      ...scope,
      itemId: parent.item.id,
      expectedVersion: parent.item.version,
      operationId: crypto.randomUUID(),
      action: 'transition',
      status: 'closed',
      summary:
        'Investigation complete. Business root cause remains unverified.',
      criteriaAccepted: true,
    },
  });
  expect(close.ok(), await close.text()).toBe(true);
  await page.goto('/checkout/sign-in?plan=pro&period=monthly&checkout=test');
  await page.locator('ion-segment-button[value="in"]').click();
  await page
    .locator('ion-input[name="email"] input')
    .fill('alice@work.example.test');
  await page
    .locator('ion-input[type="password"] input:not(.cloned-input)')
    .fill('work-emulator-only-2026');
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
  await expect(
    page.getByText('Signed in as alice@work.example.test', { exact: true }),
  ).toBeVisible();
  const workBase = '/space/space/store/firestore/project/project/work';
  await page.goto(`${workBase}/${parent.item.id}`);
  await page
    .getByRole('link', { name: 'Create Postmortem', exact: true })
    .click();
  await page
    .locator('ion-input[formControlName="title"] input')
    .fill('Northwind 11045 evidence review');
  await page.getByRole('button', { name: 'Create work', exact: true }).click();
  await expect(page).toHaveURL(/\/work\/(?!new$)[A-Za-z0-9_-]+$/);
  const path = new URL(page.url()).pathname;
  const report = page.locator('sneat-postmortem');
  await expect(
    report.getByText('Postmortem report', { exact: true }),
  ).toBeVisible();
  await report
    .locator('ion-textarea')
    .filter({ has: page.locator('textarea') })
    .first()
    .locator('textarea')
    .fill('Order 11045 investigation is recorded. Root cause remains unknown.');
  await report
    .getByRole('button', { name: 'Save report', exact: true })
    .click();
  await expect(
    report.getByText('Change saved.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(report.locator('textarea').first()).toHaveValue(
    'Order 11045 investigation is recorded. Root cause remains unknown.',
  );
  await report
    .getByRole('button', { name: 'Generate AI draft', exact: true })
    .click();
  await expect(
    report.getByText('AI draft preview', { exact: true }),
  ).toBeVisible();
  await report
    .getByRole('button', { name: 'Apply reviewed AI draft', exact: true })
    .click();
  await expect(
    report.getByText('AI draft preview', { exact: true }),
  ).toHaveCount(0);
  await expect(
    report.locator('[id^="evidence-"]').filter({ hasText: 'check-run' }),
  ).toContainText('shipping-request-received');
  const citation = report.locator('a[href^="#evidence-"]').first();
  await expect(citation).toBeVisible();
  await citation.click();
  const queryProposal = report.locator('[data-proposal-id="query-review"]');
  const checkProposal = report.locator('[data-proposal-id="check-review"]');
  const watchProposal = report.locator('[data-proposal-id="watch-review"]');
  await expect(queryProposal).toContainText('proposed');
  await expect(checkProposal).toContainText('proposed');
  await expect(watchProposal).toContainText('proposed');
  await queryProposal
    .getByRole('button', { name: 'Adjust', exact: true })
    .click();
  const editor = report
    .locator('details')
    .filter({ has: report.locator('ion-input[label="Recommendation title"]') })
    .first();
  await editor.evaluate(
    (element) => ((element as HTMLDetailsElement).open = true),
  );
  await report
    .locator('ion-input[label="Recommendation title"] input')
    .fill('Review receipt evidence before recurrence');
  await report
    .getByRole('button', { name: 'Save proposed adjustment', exact: true })
    .click();
  await expect(queryProposal).toContainText(
    'Review receipt evidence before recurrence',
  );
  await expect(queryProposal).toContainText('proposed');
  await checkProposal
    .getByRole('button', { name: 'Reject', exact: true })
    .click();
  await expect(checkProposal).toContainText('rejected');
  await watchProposal
    .getByRole('button', { name: 'Ignore', exact: true })
    .click();
  await expect(watchProposal).toContainText('ignored');
  await queryProposal
    .getByRole('button', { name: 'Approve proposal', exact: true })
    .click();
  await expect(queryProposal).toContainText('approved');
  await expect(
    queryProposal.getByRole('link', { name: 'Open saved query' }),
  ).toHaveCount(0);
  await queryProposal
    .getByRole('button', { name: 'Save to project', exact: true })
    .click();
  await expect(
    queryProposal.getByRole('link', { name: 'Open saved query' }),
  ).toBeVisible();
  await checkProposal
    .getByRole('button', { name: 'Adjust', exact: true })
    .click();
  await report
    .getByRole('button', { name: 'Save proposed adjustment', exact: true })
    .click();
  await expect(checkProposal).toContainText('proposed');
  await checkProposal
    .getByRole('button', { name: 'Approve proposal', exact: true })
    .click();
  await expect(checkProposal).toContainText('approved');
  await checkProposal
    .getByRole('button', { name: 'Save to project', exact: true })
    .click();
  await expect(
    checkProposal.getByRole('link', { name: 'Open saved check' }),
  ).toBeVisible();
  await watchProposal
    .getByRole('button', { name: 'Adjust', exact: true })
    .click();
  await report
    .getByRole('button', { name: 'Save proposed adjustment', exact: true })
    .click();
  await expect(watchProposal).toContainText('proposed');
  await watchProposal
    .getByRole('button', { name: 'Approve proposal', exact: true })
    .click();
  await expect(watchProposal).toContainText('approved');
  await watchProposal
    .getByRole('button', { name: 'Save to project', exact: true })
    .click();
  await expect(
    watchProposal.getByRole('link', { name: 'Open saved watch' }),
  ).toBeVisible();
  await report
    .getByRole('button', { name: 'Submit for review', exact: true })
    .click();
  await expect(
    report.getByText('Change saved.', { exact: true }),
  ).toBeVisible();
  await report
    .getByRole('button', { name: 'Approve this revision', exact: true })
    .click();
  await expect(
    report.getByText('Change saved.', { exact: true }),
  ).toBeVisible();
  await report
    .getByRole('button', { name: 'Prepare publication preview', exact: true })
    .click();
  await report
    .getByRole('checkbox', {
      name: 'I reviewed this exact public text for disclosure',
    })
    .click();
  await report
    .getByRole('button', { name: 'Publish approved snapshot', exact: true })
    .click();
  const select = report.locator('ion-select[label="Published snapshot"]');
  await select.click();
  await page.getByRole('radio').last().click();
  await report
    .getByRole('button', { name: 'Create expiring link', exact: true })
    .click();
  const shared = report.locator('a[target="_blank"]');
  await expect(shared).toBeVisible();
  const url = await shared.getAttribute('href');
  if (!url) throw new Error('Server did not issue a share link');
  expect(url).toContain('/postmortems/shared#token=');
  const external = await browser.newContext();
  const recipient = await external.newPage();
  await recipient.goto(url);
  await expect(
    recipient.getByRole('heading', { name: 'Shared postmortem', exact: true }),
  ).toBeVisible();
  await expect(recipient.locator('main')).not.toContainText('Context Bag');
  await expect(recipient.locator('sneat-work-page')).toHaveCount(0);
  await report
    .locator('ion-input[label="Email recipients"] input')
    .fill('recipient@example.test');
  await report
    .getByRole('checkbox', {
      name: 'I confirm these recipients may receive the approved report',
    })
    .click();
  await report
    .getByRole('button', { name: 'Send approved report', exact: true })
    .click();
  await expect(report.getByRole('status')).toContainText('Email sent.');
  const mailbox = await page.request.get(
    'http://127.0.0.1:8090/__postmortem-test/mail',
    { headers },
  );
  expect(mailbox.ok()).toBe(true);
  const messages = Object.values(await mailbox.json()) as {
    To: string;
    Subject: string;
    Body: string;
  }[];
  const message = messages.find(
    (item) =>
      item.To === 'recipient@example.test' &&
      item.Body.includes(new URL(url).hash),
  );
  expect(message).toBeDefined();
  expect(message?.Body).not.toContain('Context Bag');
  expect(message?.Subject).toContain('Approved');

  const publicBefore = await recipient.locator('main').innerText();
  await report
    .locator('textarea')
    .first()
    .fill('Later private amendment. Published snapshot remains unchanged.');
  await report
    .getByRole('button', { name: 'Save report', exact: true })
    .click();
  await expect(
    report.getByText('Change saved.', { exact: true }),
  ).toBeVisible();
  await recipient.goto(url);
  await expect(recipient.locator('main')).toHaveText(publicBefore);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: 'coverage/apps/datatug-postmortem/review-mobile.png',
    fullPage: true,
    mask: [shared],
  });
  await testInfo.attach('screenshot-expectation', {
    body: 'Expected: shared Work controls and report review remain readable at 390px, with no horizontal document overflow. Observed: captured review-mobile.png after overflow assertion.',
    contentType: 'text/plain',
  });
  await report
    .getByRole('button', { name: 'Revoke link', exact: true })
    .last()
    .click();
  await recipient.goto(url);
  await expect(recipient.getByRole('alert')).toContainText('unavailable');
  await external.close();
  await page.goto(path);
  await expect(
    report.getByText('Postmortem report', { exact: true }),
  ).toBeVisible();
});
