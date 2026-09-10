import { expect, test } from '@playwright/test';

// Smoke test for the side-menu build-info footer — the shared
// @sneat/components AppVersionComponent (<sneat-app-version />,
// datatug-menu.component.html), fed this app's own stamped build info via
// the shared @sneat/core-public runtime contract (provideBuildInfo() in
// apps/datatug-app/src/main.ts) — see apps/datatug-app/README.md "Build
// info". Runs against the shared dev server like every other spec in this
// (chromium) project; datatug-app:serve depends on the `stamp-build-info`
// Nx target (apps/datatug-app/project.json), so by the time this test runs
// the dev server has already been stamped with a real local git hash,
// version, and UTC build timestamp — not the placeholders committed to
// build-info.ts (stamping never touches that file; it stamps a gitignored
// build-info.generated.ts that an Angular fileReplacements config swaps in
// instead).
//
// Locators are scoped under the `sneat-app-version` element (rather than a
// bare `[data-testid=...]` on the page) so they target this shared
// component structurally and can't accidentally match a same-named
// data-testid elsewhere on the page. AppVersionComponent's own template
// (node_modules/@sneat/components/esm2022/lib/app-version/app-version.component.js)
// keeps the same `build-info-toggle` / `build-info-chevron` /
// `build-info-version` / `build-info-hash` test ids the previous local
// MenuBuildInfoComponent used.

test('side menu shows a real (non-placeholder) short git hash once expanded', async ({
  page,
}) => {
  await page.goto('/');

  const appVersion = page.locator('sneat-app-version');

  // Collapsed by default — the version/hash lines aren't in the DOM at all
  // until the footer row is tapped.
  const versionLine = appVersion.locator('[data-testid="build-info-version"]');
  const hashLine = appVersion.locator('[data-testid="build-info-hash"]');
  await expect(versionLine).toBeHidden();
  await expect(hashLine).toBeHidden();

  // Click the chevron, not the row's default (center) click point: the row's
  // own copyright text wraps a "Sneat.Work" link (opens sneat.work in a
  // new tab without toggling — see onLinkClick in AppVersionComponent), and
  // that link sits directly under the row's horizontal center, so
  // Playwright's default click-the-center behavior would hit the link
  // instead of toggling. Same reason a plain `footerRow.click()` must never
  // be reintroduced here.
  const footerRow = appVersion.locator('ion-item[button]');
  const chevron = appVersion.locator('[data-testid="build-info-chevron"]');
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

  const appVersion = page.locator('sneat-app-version');

  // See the sibling test above for why the chevron (not the row's default
  // center click point, which lands on the "Sneat.Work" link) is the
  // click target.
  const chevron = appVersion.locator('[data-testid="build-info-chevron"]');
  await chevron.click();

  const hashLine = appVersion.locator('[data-testid="build-info-hash"]');
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
