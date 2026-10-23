import { expect, test } from './helpers/demodb-guard';

const endpoint = process.env['DATATUG_WATCH_REAL_ENDPOINT'];
const agent = process.env['DATATUG_WATCH_REAL_AGENT'];
const project = process.env['DATATUG_WATCH_REAL_PROJECT'];
const token = process.env['DATATUG_WATCH_REAL_TOKEN'];

test('real coordinator: existing Check creates a Watch with consent, observes and opens inbox', async ({
  page,
}, testInfo) => {
  if (!endpoint || !agent || !project || !token) {
    test.skip(
      true,
      'Owned native fixture process supplies endpoints and an ephemeral credential.',
    );
    return;
  }
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const projectPath = `/store/http-${new URL(agent).host}/project/${project}`;
  await page.goto(
    projectPath +
      '/checks/shipping-carrier-assignment#code=' +
      process.env['DATATUG_WATCH_REAL_AGENT_CODE'],
  );
  await expect(
    page.getByRole('button', { name: 'Create Watch', exact: true }),
  ).toBeVisible();
  const rejectAnalytics = page.getByRole('button', {
    name: /^(Reject|Reject analytics)$/,
    exact: true,
  });
  if (await rejectAnalytics.isVisible()) await rejectAnalytics.click();
  await page.getByRole('button', { name: 'Create Watch', exact: true }).click();
  await expect(page.getByText(endpoint, { exact: true })).toBeVisible();
  await page.getByLabel('Coordinator user credential').fill(token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Create Watch', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Title', { exact: true })
    .fill('Order 11045 · carrier assignment failure');
  await page.getByLabel('order_id (required)').fill('11045');
  await page.getByLabel('Evaluate every (seconds)').fill('10');
  await page.locator('ion-select[label="First observation"]').click();
  await page.getByRole('radio', { name: 'Notify if already matching' }).click();
  const confirm = page.getByRole('button', { name: 'OK', exact: true });
  if (await confirm.isVisible()) await confirm.click();
  await expect(page.locator('ion-popover')).toBeHidden();
  const email = page.getByRole('checkbox', {
    name: 'Email · free',
    exact: true,
  });
  await email.click();
  await expect(email).toBeChecked();
  await page.screenshot({
    path: testInfo.outputPath('watch-create-real-desktop.png'),
  });
  await page.getByRole('button', { name: 'Save Watch', exact: true }).click();
  await expect(page).toHaveURL(/\/watch\/watch-[A-Za-z0-9-]+$/);
  await expect(
    page.getByRole('heading', { name: 'Create Watch', exact: true }),
  ).toBeHidden();
  const detailURL = page.url();
  await expect(
    page.getByRole('heading', {
      name: 'Order 11045 · carrier assignment failure',
      exact: true,
    }),
  ).toBeVisible();
  await expect(async () => {
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.locator('.watch-summary')).toContainText('Failing');
  }).toPass({ timeout: 30000 });
  await expect(
    page.getByRole('heading', { name: 'Evaluation history', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Inbox', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      level: 3,
      name: /^Order 11045 · carrier assignment failure/,
    }),
  ).toBeVisible();
  await page.reload();
  await page.getByLabel('Coordinator user credential').fill(token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page).toHaveURL(detailURL);
  await expect(page.locator('.watch-summary')).toContainText('Failing');
  await expect(
    page.getByRole('checkbox', { name: 'Email · free', exact: true }),
  ).toBeChecked();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`watch-detail-real-${width}.png`),
    });
  }
  await page
    .getByRole('heading', { name: 'Inbox', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('watch-inbox-real-narrow.png'),
  });
  await page
    .getByRole('heading', {
      level: 3,
      name: /^Order 11045 · carrier assignment failure/,
    })
    .click();
  await expect(page).toHaveURL(detailURL);
  expect(errors).toEqual([]);
});
