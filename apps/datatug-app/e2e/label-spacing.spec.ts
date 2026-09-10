import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { activePage } from './journey/helpers/active-page';

/**
 * S159 — founder ruling 2026-09-10, verbatim, with a screenshot of the
 * project page on datatug.app reading "Storegithub.com" with no gap:
 * "There is a systematic styling issue with ion item labels. Notice how
 * there is no margin/padding between Store and github.com on the
 * screenshot. Usually it is fine in standard Ionic apps. We must have
 * override something and break it."
 *
 * Root cause (measured live, in Chromium, against `node_modules/@ionic/core`
 * 9.0.0): NOT an app override. `apps/datatug-app/src/styles.scss` carried no
 * `ion-label`/`ion-item` spacing rule before this task. `ion-item`'s own
 * "md" mode shadow stylesheet gives a slotted `<ion-label>` only
 * `margin-top/bottom: 10px` — zero horizontal margin
 * (`margin-left:0; margin-right:0`) — while its "ios" mode stylesheet gives
 * the same label `margin-inline-end: 8px`
 * (`@ionic/core/dist/esm/ion-item_8.entry.js`, `itemMdCss()` vs
 * `itemIosCss()`). This app runs in "md" mode (the default outside an
 * Apple/iOS user agent), so every `<ion-item><ion-label>…</ion-label
 * ><ion-input | ion-select | ion-buttons | plain text>…</ion-item>` pattern
 * rendered with zero gap — this suite's own two rows below both measured a
 * literal `0` before the fix (`apps/datatug-app/src/styles.scss`'s new
 * `ion-item > ion-label:not([slot]):has(+ *)` rule).
 *
 * These two rows are the ones this suite can reach through real app
 * navigation, covering the two value shapes the fix's own selector has to
 * handle (a form control, and a plain slot-less value element). A third
 * reported instance — the dbserver page's "Host"/"Port" rows
 * (`pages/signed-in/dbserver/dbserver-page.component.html`) — carries the
 * identical markup shape and was confirmed fixed by the same rule via a
 * live, temporary, reverted-before-commit measurement (see this task's PR
 * body for the before/after numbers), but is NOT exercised here:
 * `servers-routing.module.ts`'s own `db/:driver/:dbServerId` child route is
 * dead code — never wired into `datatug-routing-proj.ts`'s `'servers'`
 * entry (that entry is a bare `loadComponent`, not `loadChildren`) — so
 * `ServersPageComponent.goDbServer()` 404s with `NG04002` for every store
 * today. Pre-existing, unrelated to spacing, out of this task's scope;
 * flagged separately rather than fixed here.
 *
 * (A third shape was tried and dropped: `environment-page.component.html`'s
 * "Servers" card pairs a label with a `slot="end"` button, which already
 * gets its own `margin-inline-start` from a *different*, never-broken Ionic
 * rule — confirmed live, its gap measured >8px even with this task's own
 * fix reverted — so it would not have failed before the fix and is not a
 * real regression guard for this bug.)
 */
test.skip(
  process.env['DATATUG_E2E_OFFLINE'] === '1',
  'requires network access to github.com/api.github.com/raw.githubusercontent.com — set DATATUG_E2E_OFFLINE=1 to skip',
);

const PROJECT_ID = 'datatug-demo-projects@datatug@demo-project-1';
const PROJECT_URL = `/store/github.com/project/${PROJECT_ID}`;

/** Ionic's own "ios" mode gives a slotted label `margin-inline-end: 8px` —
 * the floor this app's "md" mode should never fall below again. */
const MIN_GAP_PX = 8;

/** Bounding-box gap between an item's `<ion-label>` and the first element
 * matching `valueSelector` inside the same item — mirrors the measurement
 * this task's own live diagnosis used (`getBoundingClientRect()` on both,
 * `value.left - label.right`), not a computed-style read, so it reflects
 * what actually renders regardless of which CSS property ends up
 * responsible. */
function measureLabelValueGap(
  item: Locator,
  valueSelector: string,
): Promise<number> {
  return item.evaluate((el, selector) => {
    const label = el.querySelector('ion-label');
    const value = el.querySelector(selector);
    if (!label) {
      throw new Error('no <ion-label> found in item');
    }
    if (!value) {
      throw new Error(`no element matching "${selector}" found in item`);
    }
    const labelRect = label.getBoundingClientRect();
    const valueRect = value.getBoundingClientRect();
    return valueRect.left - labelRect.right;
  }, valueSelector);
}

test.describe('ion-item label spacing (S159)', () => {
  test('project page: the Store label has a visible gap from its value', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(PROJECT_URL);
    // Scoped to `ion-input`, not just text "Store": `sneat-datatug-project-menu-top`
    // (the persistent side menu, outside `<ion-router-outlet>` — see
    // `activePage()`'s own doc comment) renders its OWN "Store" row (an
    // `ion-select`, the store switcher) — a second, independent instance of
    // this exact bug, but not the one under test here.
    const storeItem = activePage(page)
      .locator('ion-item')
      .filter({ hasText: 'Store' })
      .filter({ has: page.locator('ion-input') });
    await expect(storeItem).toBeVisible({ timeout: 20_000 });
    const gap = await measureLabelValueGap(storeItem, 'ion-input');
    expect(gap).toBeGreaterThanOrEqual(MIN_GAP_PX);
  });

  test('entity page: a field label has a visible gap from its type badge', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(PROJECT_URL);
    await page
      .locator('sneat-datatug-project-menu-top ion-item', { hasText: 'Entities' })
      .click();
    await activePage(page).getByText('Album', { exact: true }).click();
    // `entity-page.component.html`'s "Fields" card:
    // `<ion-item><ion-label>{{field.id}}…</ion-label><ion-badge
    // color="light">{{field.type}}</ion-badge><ion-buttons
    // slot="end">…</ion-buttons></ion-item>` — same bare-label-then-value
    // shape as the Store row, a different value kind (a plain, slot-less
    // `<ion-badge>`, not a form control).
    const idFieldItem = activePage(page)
      .locator('ion-item')
      .filter({ has: page.locator('ion-badge', { hasText: 'integer' }) })
      .first();
    await expect(idFieldItem).toBeVisible({ timeout: 15_000 });
    const gap = await measureLabelValueGap(idFieldItem, 'ion-badge');
    expect(gap).toBeGreaterThanOrEqual(MIN_GAP_PX);
  });
});
