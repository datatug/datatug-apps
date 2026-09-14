import { expect, test } from '@playwright/test';

// Hub `product-profiles` (spec/features/product-profiles/README.md) and
// `incidents` (spec/features/incidents/README.md) — plan Task 9 scaffold
// slice. Production selects Incidentius on `app.incidentius.com`; this local
// dev-server exercise uses `?profile=incidentius`, which is deliberately inert
// outside local development. Screenshots go to Playwright's per-test output
// directory for review.

test('?profile=incidentius lands on the incident list with the "Houston" entry point (AC:incidentius-profile-home)', async ({
  page,
}, testInfo) => {
  await page.goto('/?profile=incidentius');

  // profile-home-redirect.guard.ts sends the empty root route to the
  // profile's own homePath — no query string carries over because
  // PRODUCT_PROFILE is already resolved (from the initial location.search)
  // before that navigation happens.
  await expect(page).toHaveURL('/incidents');

  await expect(
    page.getByRole('link', { name: 'Incidentius home' }),
  ).toBeVisible();
  // Hub REQ:brand-and-domain-honesty: once the approved app hostname ships,
  // the live profile must not retain the old planned marker.
  await expect(page.getByText('Planned', { exact: true })).toHaveCount(0);

  await expect(
    page.getByText("Houston, we've got a problem", { exact: true }),
  ).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath('incidentius-home.png'),
    fullPage: true,
  });
});

test('the datatug profile always shows an Incidents item in the side menu, with no project open (AC:incidents-always-in-datatug-menu)', async ({
  page,
}, testInfo) => {
  await page.goto('/');

  await expect(
    page.getByRole('link', { name: 'DataTug.app home' }),
  ).toBeVisible();
  const incidentsItem = page.getByTestId('incidents-menu-item');
  await expect(incidentsItem).toBeVisible();
  await expect(incidentsItem).toContainText('Incidents');

  await page.screenshot({
    path: testInfo.outputPath('datatug-menu-incidents-item.png'),
    fullPage: true,
  });

  await incidentsItem.click();
  await expect(page).toHaveURL('/incidents');
  await expect(
    page.getByText("Houston, we've got a problem", { exact: true }),
  ).toBeVisible();
});

test('build info is visible under the datatug profile (hub REQ:brand-and-domain-honesty)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('sneat-app-version')).toBeVisible();
});

test('build info is visible under the incidentius profile too — same shared component, no per-profile implementation', async ({
  page,
}) => {
  await page.goto('/?profile=incidentius');
  await expect(page).toHaveURL('/incidents');
  await expect(page.locator('sneat-app-version')).toBeVisible();
});

test('a cold incident detail deep link stays on the same route family under both profiles', async ({
  page,
}) => {
  const detail =
    '/incidents/datatug-demo-project/INC-1?agent=demo&storeId=datatug-demo-project&project=datatug-demo-project&environment=local';
  const record = `${detail.replace('/INC-1?', '/INC-1/record?')}`;

  await page.goto(`${detail}&profile=incidentius`);
  await expect(page).toHaveURL(/\/incidents\/datatug-demo-project\/INC-1/);
  await expect(page).not.toHaveURL(/\/incidents$/);

  await page.goto(`${record}&profile=incidentius`);
  await expect(page).toHaveURL(
    /\/incidents\/datatug-demo-project\/INC-1\/record/,
  );

  await page.goto(detail);
  await expect(page).toHaveURL(/\/incidents\/datatug-demo-project\/INC-1/);
  await page.goto(record);
  await expect(page).toHaveURL(
    /\/incidents\/datatug-demo-project\/INC-1\/record/,
  );
});
