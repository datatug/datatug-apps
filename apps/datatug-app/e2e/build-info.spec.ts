import { expect, test } from '@playwright/test';

// Smoke test for the side-menu build-info footer (deliverable of the
// feat/build-info-menu branch, collapsed into a single tappable row by
// feat/collapsible-version-footer — see apps/datatug-app/README.md "Build
// info"). Runs against the shared dev server like every other spec in this
// (chromium) project; datatug-app:serve depends on the `stamp-build-info`
// Nx target (apps/datatug-app/project.json), so by the time this test runs
// the dev server has already been stamped with a real local git hash,
// version, and UTC build timestamp — not the placeholders committed to
// build-info.ts.

test('side menu shows a real (non-placeholder) short git hash once expanded', async ({
  page,
}) => {
  await page.goto('/');

  // Collapsed by default — the version/hash lines aren't in the DOM at all
  // until the footer row is tapped.
  const versionLine = page.locator('[data-testid="build-info-version"]');
  const hashLine = page.locator('[data-testid="build-info-hash"]');
  await expect(versionLine).toBeHidden();
  await expect(hashLine).toBeHidden();

  // Click the chevron, not the row's default (center) click point: the row's
  // own copyright text wraps a "Sneat.Work" link (opens sneat.work in a
  // new tab without toggling — see onLinkClick in
  // menu-build-info.component.ts), and that link sits directly under the
  // row's horizontal center, so Playwright's default click-the-center
  // behavior would hit the link instead of toggling. Same reason a plain
  // `footerRow.click()` must never be reintroduced here.
  const footerRow = page.locator('[data-testid="build-info-toggle"]');
  const chevron = page.locator('[data-testid="build-info-chevron"]');
  await expect(footerRow).toHaveAttribute('aria-expanded', 'false');
  await chevron.click();
  await expect(footerRow).toHaveAttribute('aria-expanded', 'true');

  await expect(hashLine).toBeVisible();
  const hashText = (await hashLine.textContent()) ?? '';
  // "Build <short hash> @ <timestamp>".
  const shortHash = hashText.replace(/^Build\s+/, '').split(' @ ')[0];
  // 7 lowercase hex chars. A short hash of 'gitHash' (substring(0, 7) of
  // the un-stamped placeholder 'gitHash t0be$et') is also 7 characters but
  // not hex, so this also proves stamping actually ran rather than just
  // that some 7-character string is present.
  expect(shortHash).toMatch(/^[0-9a-f]{7}$/);

  await expect(versionLine).toHaveText(/^Version v.+/);
});

test('/build-info.json is served by the built app and matches the menu', async ({
  page,
  request,
}) => {
  await page.goto('/');

  // See the sibling test above for why the chevron (not the row's default
  // center click point, which lands on the "Sneat.Work" link) is the
  // click target.
  const chevron = page.locator('[data-testid="build-info-chevron"]');
  await chevron.click();

  const hashLine = page.locator('[data-testid="build-info-hash"]');
  const hashText = (await hashLine.textContent()) ?? '';
  const shortHash = hashText.replace(/^Build\s+/, '').split(' @ ')[0];

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
