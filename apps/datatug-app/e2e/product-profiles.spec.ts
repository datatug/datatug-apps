import { expect, test } from '@playwright/test';

// Hub `product-profiles` (spec/features/product-profiles/README.md) and
// `incidents` (spec/features/incidents/README.md) — plan Task 9 scaffold
// slice. No Incidentius hostname is registered yet (REQ:brand-and-domain-honesty),
// so `?profile=incidentius` (honored only in a local development
// configuration, which this dev-server run is) is the only way to reach it
// today. Screenshots go to Playwright's per-test output directory for review.

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
  // Hub REQ:brand-and-domain-honesty (founder: "keep with planned label") —
  // no Incidentius domain is claimed; the brand carries the planned label.
  await expect(page.getByText('Planned')).toBeVisible();

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
