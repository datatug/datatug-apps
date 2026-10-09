import { expect, test } from '@playwright/test';

// The start page has an address of its own, `/home`. A full page load of `/`
// on datatug.app is answered by the DataTug.app landing page, not by this app,
// so the start page cannot live at `/` (hub `product-profiles`; the approved
// design is `spec/ideas/datatug-domain-roles.md` in datatug/websites). Each
// product profile declares where `/` goes (`homePath`): `home` for datatug,
// `incidents` for incidentius. The dev server answers every path with the app,
// as datatug.app does for every path the landing does not take.
//
// The incidentius profile is selected with `?profile=incidentius`, which is
// honoured only on a local-development hostname (resolve-product-profile.ts).

const startPageHeading = { name: 'Your data workbench' };

test('/home opens the start page directly', async ({ page }) => {
  await page.goto('/home');

  await expect(page).toHaveURL('/home');
  await expect(page.getByRole('heading', startPageHeading)).toBeVisible();
  await expect(page.locator('sneat-datatug-home')).toBeVisible();
});

test('/ ends on /home under the datatug profile', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveURL('/home');
  await expect(page.getByRole('heading', startPageHeading)).toBeVisible();
});

test('a reload on /home stays on /home and shows the start page', async ({
  page,
}) => {
  await page.goto('/home');
  await expect(page.getByRole('heading', startPageHeading)).toBeVisible();

  await page.reload();

  await expect(page).toHaveURL('/home');
  await expect(page.getByRole('heading', startPageHeading)).toBeVisible();
});

test('/ does not carry its query string or fragment to /home', async ({
  page,
}) => {
  await page.goto('/?ref=e2e#frag');

  await expect(page).toHaveURL('/home');
  await expect(page.getByRole('heading', startPageHeading)).toBeVisible();
});

test('in-app navigation to / ends on /home', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Login @ DataTug.app')).toBeVisible();

  await page.getByRole('link', { name: 'DataTug.app home' }).click();

  await expect(page).toHaveURL('/home');
  await expect(page.getByRole('heading', startPageHeading)).toBeVisible();
});

test('under the incidentius profile / still ends on /incidents', async ({
  page,
}) => {
  await page.goto('/?profile=incidentius');

  await expect(page).toHaveURL('/incidents');
  await expect(
    page.getByText("Houston, we've got a problem", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', startPageHeading)).toHaveCount(0);
});

test('under the incidentius profile /home goes to /incidents and never shows the DataTug start page', async ({
  page,
}) => {
  await page.goto('/home?profile=incidentius');

  await expect(page).toHaveURL('/incidents');
  await expect(
    page.getByText("Houston, we've got a problem", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', startPageHeading)).toHaveCount(0);
  await expect(page.locator('sneat-datatug-home')).toHaveCount(0);
});
