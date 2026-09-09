import type { Locator, Page } from '@playwright/test';

/**
 * S104 — Ionic's `RouteReuseStrategy` (`IonicRouteStrategy`,
 * `apps/datatug-app/src/main.ts`) DETACHES a previously-visited sibling route's
 * page component rather than destroying it, to support its own page-transition
 * animations and back-navigation state — a documented Ionic behavior, not a
 * defect, and never to be changed here (it drives every page transition in this
 * app). Confirmed live via a standalone DOM probe (S104): a detached sibling
 * page carries `class="ion-page ion-page-hidden"`, `aria-hidden="true"` and
 * `display:none` on its own host element (e.g. `<sneat-datatug-env-db-table
 * class="ion-page ion-page-hidden" aria-hidden="true">`), while the active page
 * carries only `class="ion-page ..."` (no `-hidden`) — so BOTH pages' own copies
 * of any component that exists on more than one page (this app has exactly one
 * `<ion-router-outlet>` for the whole `project/:projectId` route subtree —
 * confirmed live, S104) remain simultaneously present in the DOM. A raw
 * `page.locator('sneat-datatug-limitation-header')` (or any other locator
 * targeting a component more than one project page can render) therefore
 * resolves to one match per page that has ever rendered one and not yet been
 * destroyed, tripping Playwright's strict-mode "resolved to N elements" the
 * moment a second sibling page joins the mix (journey.spec.ts:514, first hit by
 * lane S103 once PR #81 gave the limitation header a second consumer).
 *
 * `activePage(page)` scopes a locator to only the currently active page's own
 * subtree — `.locator(...)`/`.getByText(...)`/etc. chained off its return value
 * search only inside that one page, exactly mirroring what a real user actually
 * sees. Use it for any assertion that targets a category of element more than
 * one project page can render: the limitation header, grid rows/cells
 * (`.tabulator-row`, `[tabulator-field=...]`), panels (context panel, "Run
 * query"/"Clear this binding" controls, parameter-binding text), or anything
 * else discovered later that a second page also renders.
 *
 * Does NOT need to be used for `sneat-datatug-investigation-context-bar` —
 * that component is rendered once, by `ProjectMenuTopComponent`, in the app's
 * persistent side-menu tree, not inside `<ion-router-outlet>` at all (confirmed
 * live, S104: only one instance exists in the DOM regardless of which project
 * page is active), so it is never duplicated by page detachment.
 */
export function activePage(page: Page): Locator {
  return page.locator('ion-router-outlet > .ion-page:not(.ion-page-hidden)');
}
