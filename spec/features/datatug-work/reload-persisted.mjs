// Run from the apps worktree after the operator exports/restarts/imports the
// real emulator profile and restarts Backend8090. No HTTP interception/writes.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
const root = 'coverage/apps/datatug-work';
const main = JSON.parse(
  await readFile(`${root}/primary-diagnostics.json`, 'utf8'),
);
const independent = JSON.parse(
  await readFile(`${root}/isolation-diagnostics.json`, 'utf8'),
);
const preview = spawn(process.execPath, ['tools/serve-watch-preview.mjs'], {
  env: { ...process.env, DATATUG_WATCH_UI_PORT: '4201' },
  stdio: 'inherit',
});
for (let attempt = 0; attempt < 50; attempt++) {
  try {
    if ((await fetch('http://127.0.0.1:4201')).ok) break;
  } catch {}
  if (attempt === 49) {
    preview.kill('SIGTERM');
    throw new Error('Preview did not start');
  }
  await setTimeout(100);
}
const browser = await chromium.launch({
  args: [
    '--host-resolver-rules=MAP demodb.dev ~NOTFOUND, MAP *.demodb.dev ~NOTFOUND, MAP api.github.com ~NOTFOUND',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const observations = [];
const httpErrors = [];
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('response', (response) => {
  if (response.status() >= 400)
    httpErrors.push({
      status: response.status(),
      url: new URL(response.url()).origin + new URL(response.url()).pathname,
    });
});
try {
  await page.goto(
    'http://127.0.0.1:4201/checkout/sign-in?plan=pro&period=monthly&checkout=test',
  );
  await page
    .locator(
      'datatug-checkout-page.ion-page:not(.ion-page-hidden):has([data-checkout-page="authentication"]) ion-segment-button[value="in"]',
    )
    .click();
  await page
    .locator('ion-input[name="email"] input')
    .fill('alice@work.example.test');
  await page
    .locator('ion-input[type="password"] input:not(.cloned-input)')
    .fill('work-emulator-only-2026');
  await page
    .getByRole('button', { name: /^Sign in(?:\s+with password)?$/ })
    .click();
  await expect(
    page.getByText('Signed in as alice@work.example.test', { exact: true }),
  ).toBeVisible();
  for (const [path, status] of [
    [main.incidentPath, 'Closed'],
    [main.casePath, 'Active'],
    [main.taskPath, 'Open'],
    [independent.independent[0], 'Active'],
    [independent.independent[1], 'Open'],
  ]) {
    await page.goto(`http://127.0.0.1:4201${path}`);
    await expect(page.locator('.badges')).toContainText(status);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.locator('.badges')).toContainText(status);
    observations.push({ path, status, reloaded: true });
  }
  await page.goto(`http://127.0.0.1:4201${main.casePath}`);
  await page
    .getByText('Open Detective tools and evidence', { exact: true })
    .click();
  await expect(page).toHaveURL(/\/detective\/[^/]+$/);
  await expect(
    page.getByRole('heading', {
      name: 'Check run · shipping-request-received',
      exact: true,
    }),
  ).toBeVisible();
  observations.push({ retainedCaseCheckEvidence: true });
  await page.goto(`http://127.0.0.1:4201${main.taskPath}`);
  const activity = page.waitForResponse((response) =>
    response.url().includes('/projects/query_activity_context'),
  );
  await page.locator('a[href*="/query/"]').click();
  await expect(page).toHaveURL(/id=shipping%2Forder-receipt/);
  const attribution = await activity;
  expect(attribution.status()).toBe(503);
  const response = await attribution.json();
  expect(JSON.stringify(response)).toContain('activity_unavailable');
  await expect(
    page.getByRole('list', { name: 'Work referencing this artefact' }),
  ).toContainText('Repair shipment allocation for order 11045');
  observations.push({
    optionalBusinessAttributionStatus: attribution.status(),
    optionalBusinessAttributionCode: 'activity_unavailable',
    queryBacklinkPreserved: true,
  });
  await page
    .getByRole('list', { name: 'Work referencing this artefact' })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${root}/query-after-service-restart.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await page.goto(`http://127.0.0.1:4201${main.incidentPath}`);
  await expect(
    page
      .locator('ion-item')
      .filter({ has: page.locator(`a[href="${main.casePath}"]`) }),
  ).toContainText('Child · Detective Case');
  await page
    .getByText('Open Incident evidence and resolution', { exact: true })
    .click();
  await expect(page).toHaveURL(/\/incidents\/[^/]+\/[^/?]+\?environment=uat$/);
  await page.reload();
  await expect(
    page
      .locator('sneat-datatug-hosted-incidents-page')
      .getByText('closed', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Linked Detective Cases' }),
  ).toContainText('Investigate delayed order 11045');
  observations.push({
    nativeIncidentEnvironment: 'uat',
    nativeIncidentStatus: 'closed',
    nativeInvestigationLinkPreserved: true,
  });
  await page.screenshot({
    path: `${root}/incident-after-service-restart.png`,
    fullPage: true,
    animations: 'disabled',
  });
  expect(pageErrors).toEqual([]);
  expect(
    httpErrors.filter(
      (error) =>
        error.url.startsWith('http://127.0.0.1:8090/') &&
        !(
          error.status === 503 &&
          error.url.endsWith('/projects/query_activity_context')
        ),
    ),
  ).toEqual([]);
  await writeFile(
    `${root}/restart-browser-observation.json`,
    JSON.stringify(
      { result: 'PASS', observations, pageErrors, httpErrors },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      result: 'PASS',
      retainedWorkItems: 5,
      retainedCheckEvidence: true,
      nativeIncidentColdRead: true,
      queryBacklink: true,
      optionalActivityStatus: 503,
    }),
  );
} finally {
  await browser.close();
  preview.kill('SIGTERM');
}
