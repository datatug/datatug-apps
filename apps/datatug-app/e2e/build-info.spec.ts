import { expect, test } from '@playwright/test';

// Smoke test for the side-menu build-info panel (deliverable of the
// feat/build-info-menu branch — see apps/datatug-app/README.md "Build
// info"). Runs against the shared dev server like every other spec in this
// (chromium) project; datatug-app:serve depends on the `stamp-build-info`
// Nx target (apps/datatug-app/project.json), so by the time this test runs
// the dev server has already been stamped with a real local git hash,
// version, and UTC build timestamp — not the placeholders committed to
// build-info.ts.

test('side menu shows a real (non-placeholder) short git hash', async ({
  page,
}) => {
  await page.goto('/');

  const hashInput = page.locator('[data-testid="build-info-hash"]');
  await expect(hashInput).toBeVisible();

  const hashValue = await hashInput.inputValue();
  const shortHash = hashValue.split(' @ ')[0];
  // 7 lowercase hex chars. A short hash of 'gitHash' (substring(0, 7) of
  // the un-stamped placeholder 'gitHash t0be$et') is also 7 characters but
  // not hex, so this also proves stamping actually ran rather than just
  // that some 7-character string is present.
  expect(shortHash).toMatch(/^[0-9a-f]{7}$/);

  const versionNote = page.locator('[data-testid="build-info-version"]');
  await expect(versionNote).toHaveText(/.+/);
});

test('/build-info.json is served by the built app and matches the menu', async ({
  page,
  request,
}) => {
  await page.goto('/');
  const hashValue = await page
    .locator('[data-testid="build-info-hash"]')
    .inputValue();
  const shortHash = hashValue.split(' @ ')[0];

  const response = await request.get('/build-info.json');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('application/json');

  const body = (await response.json()) as {
    version?: unknown;
    gitHash?: unknown;
    buildTimestamp?: unknown;
  };
  expect(typeof body.version).toBe('string');
  expect(typeof body.gitHash).toBe('string');
  expect(typeof body.buildTimestamp).toBe('string');
  // Same stamp run, so the menu's short hash must be a prefix of the full
  // hash in build-info.json.
  expect((body.gitHash as string).startsWith(shortHash)).toBe(true);
});
