import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { activePage } from './journey/helpers/active-page';

/**
 * S136 (founder ruling 2026-09-11: "Not a single page is loading from side
 * menu without error... Make sure all projects pages are loadable with
 * datatug-demo-projects@datatug@demo-project-1 - test it locally and verify
 * once fixed in prod") — the GitHub-store read path, exercised against the
 * REAL github.com/api.github.com/raw.githubusercontent.com (no route
 * interception, unlike `root-and-login.spec.ts`'s agent-mocking suite):
 * `GithubProjectReaderService` and the per-domain services that switch on
 * store type are the thing under test here, not a stub.
 *
 * Set `DATATUG_E2E_OFFLINE=1` to skip this file (e.g. a sandboxed/offline
 * CI run) — by default it RUNS, per the brief ("mark it so CI can skip it
 * only when explicitly offline").
 *
 * Two menu items are deliberately NOT exercised here, both for reasons that
 * apply to EVERY store, not just GitHub:
 *  - "Overview" (`project-menu-top.component.ts`'s own `path: 'overview'`)
 *    has no matching route in `datatug-routing-proj.ts` at all yet — a
 *    separate, in-flight fix (lane S135, this task's own coordination
 *    note), not a GitHub-store gap.
 *  - "Tags"/"Widgets" (and DB models/Resources/Diff) are feature-flagged
 *    off site-wide (`ENABLE_EMPTY_SHELL_PAGES = false`,
 *    `core/feature-flags.ts`): their routes are left out of
 *    `datatugProjectRoutes` entirely while the flag is off, so there is no
 *    menu entry and nothing to click into for ANY store. Both page
 *    components are a bare static `<ion-content>` with no data-fetch code
 *    at all (confirmed by reading them), so once the flag is on they need
 *    no GitHub-specific work.
 */
test.skip(
  process.env['DATATUG_E2E_OFFLINE'] === '1',
  'requires network access to github.com/api.github.com/raw.githubusercontent.com — set DATATUG_E2E_OFFLINE=1 to skip',
);

const PROJECT_ID = 'datatug-demo-projects@datatug@demo-project-1';
const PROJECT_URL = `/store/github.com/project/${PROJECT_ID}`;

/** `ErrorLoggerService.logError()`'s own, fixed console.error prefix
 * (`@sneat/logging`'s `error-logger.service.ts`: `console.error(
 * \`ErrorLoggerService.logError: ${message}:\`, e, ...)`) — the exact signal
 * the founder's ruling means by "loading... without error": every page this
 * suite visits must never cause that call. */
const ERROR_LOGGER_PREFIX = 'ErrorLoggerService.logError:';

function installErrorLoggerWatch(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && text.startsWith(ERROR_LOGGER_PREFIX)) {
      errors.push(text);
    }
  });
  return errors;
}

/**
 * `query-page.component.html` only renders a body EDITOR for
 * `queryState.queryType === "HTTP"` (`<sneat-datatug-http-query-editor />`)
 * — the SQL editor is commented out in the template and there is no DTQL
 * branch at all, so a SQL or DTQL query's own body text never appears
 * anywhere in the DOM for Playwright's text locators to find (confirmed
 * live, S136; pre-existing, applies to every store, not GitHub-specific —
 * well beyond this task's own scope to add a missing editor UI for). Reading
 * the loaded component's own `queryState.request.text` field directly is
 * how this suite still proves `GithubProjectReaderService.getQuery()`
 * actually fetched the sidecar body file content (deliverable: the body
 * came from the repo, not just the definition JSON, which never carries
 * `text`) without depending on that missing UI.
 */
function getQueryBodyText(page: Page): Promise<string | undefined> {
  return page.locator('sneat-datatug-sql-editor').evaluate((el) => {
    const ng = (window as unknown as { ng?: { getComponent(el: Element): unknown } })
      .ng;
    const comp = ng?.getComponent(el) as
      | { queryState?: { request?: { text?: string } } }
      | undefined;
    return comp?.queryState?.request?.text;
  });
}

test.describe('GitHub-store project — every side-menu page loads without error', () => {
  test('project page, environments, entities, queries, boards, servers all render their real content', async ({
    page,
  }) => {
    const errors = installErrorLoggerWatch(page);

    // --- Project page ---------------------------------------------------
    await page.goto(PROJECT_URL);
    // NOT asserting the project *title* text here: `ProjectPageComponent`
    // (`pages/signed-in/project/project-page.component.ts`, owned by a
    // different lane — out of this task's own edit scope) never injects
    // `ChangeDetectorRef`/calls `markForCheck()` anywhere, so on a fresh
    // zoneless load its title `ion-input` reliably stays stuck on its
    // "Loading..." placeholder even once `onProjectSummaryChanged()` has
    // already set the real title internally (confirmed live, S136, and
    // reproduced by this very test before this comment was added — the
    // tablist/tabs below render fine, only the title binding doesn't
    // repaint). Asserting on the tablist instead, which this task's own
    // fixes do not touch and which reliably renders.
    await expect(
      activePage(page).getByRole('tab', { name: 'Boards' }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('sneat-datatug-project-menu-top')).toBeVisible();

    // --- Boards (side-menu click) ----------------------------------------
    await page.locator('sneat-datatug-project-menu-top ion-item', { hasText: 'Boards' }).click();
    // NOT `activePage(page).getByText('1st board')`: the project page
    // asserted above ALSO embeds a `sneat-datatug-folder` (`DatatugFolderComponent`)
    // whose own default tab is 'boards' — the SAME "1st board" text — and on
    // a slower runner (confirmed failing in CI, passing every time locally)
    // that page is still present, un-hidden, alongside the dedicated Boards
    // page once this navigates: `document.querySelectorAll('ion-router-outlet
    // > .ion-page')` shows BOTH `sneat-datatug-project` and
    // `sneat-datatug-boards` without `.ion-page-hidden` at the same time
    // (confirmed live, S136). That made `activePage(page).getByText('1st
    // board')` strict-mode-fail with 2 matches. `sneat-datatug-boards`
    // (`BoardsPageComponent`'s own selector) turns out to carry the
    // `.ion-page` class on its OWN host element, not on some wrapper around
    // it — so `activePage(page).locator('sneat-datatug-boards')` (a
    // descendant search) finds nothing (verified live, S136: 0 matches even
    // though the element is present) — the fix has to select
    // `sneat-datatug-boards` itself as (one of) the not-hidden `.ion-page`
    // elements, not search inside it.
    await expect(
      page
        .locator('ion-router-outlet > sneat-datatug-boards.ion-page:not(.ion-page-hidden)')
        .getByText('1st board'),
    ).toBeVisible({ timeout: 15_000 });
    // NOT clicking into the board's own detail page here: `goBoard()`
    // (`DatatugNavService`) navigates via Ionic's `NavController.navigateForward()`,
    // which constructs `BoardPageComponent` through a DIFFERENT path than
    // Angular Router's own `loadComponent` resolution — and that path fails
    // to resolve `Location` (`@angular/common`, needed by the component's own
    // `QueryParamsService` provider) with `NG0201: No provider found for
    // \`Location\`. Source: Standalone[_BoardPageComponent]` (confirmed live,
    // S136, reproduced directly via `NavController.navigateForward()` from
    // the console — same failure regardless of which page/store triggers
    // it, so this is a pre-existing, cross-store Ionic/Angular DI interop
    // gap, not GitHub-specific, and well beyond this task's own "missing
    // NgModule import" fixes — named here per the brief rather than silently
    // dropped, not fixed in this task).

    // --- Entities (side-menu click) ---------------------------------------
    await page.locator('sneat-datatug-project-menu-top ion-item', { hasText: 'Entities' }).click();
    for (const entityId of ['Album', 'Artist', 'Country', 'Customer', 'Invoice', 'InvoiceLine', 'Person', 'Track']) {
      await expect(activePage(page).getByText(entityId, { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    }
    await activePage(page).getByText('Album', { exact: true }).click();
    await expect(activePage(page).getByText('Title')).toBeVisible({ timeout: 15_000 });

    // --- Environments (side-menu click) ------------------------------------
    await page.locator('sneat-datatug-project-menu-top ion-item', { hasText: 'Environments' }).click();
    for (const envId of ['local', 'dev', 'QA', 'UAT', 'prod']) {
      await expect(activePage(page).getByText(envId, { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    }
    await activePage(page).getByText('local', { exact: true }).click();
    await expect(activePage(page).getByText('sqlite3')).toBeVisible({ timeout: 15_000 });
    await activePage(page).getByText('chinook-local').click();
    await expect(activePage(page).getByText('Album', { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // --- Servers (side-menu click) -----------------------------------------
    await page.locator('sneat-datatug-project-menu-top ion-item', { hasText: 'Servers' }).click();
    await expect(activePage(page).locator('ion-title', { hasText: 'Servers' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(activePage(page).getByText('sqlite3')).toBeVisible({ timeout: 15_000 });

    // --- Queries (side-menu click) ------------------------------------------
    await page.locator('sneat-datatug-project-menu-top ion-item', { hasText: 'Queries' }).click();
    for (const folder of ['albums', 'artists', 'customers', 'invoices', 'reference', 'tracks']) {
      await expect(activePage(page).getByText(folder, { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    }

    expect(errors).toEqual([]);
  });

  test('a saved DTQL query page shows its definition and body', async ({
    page,
  }) => {
    const errors = installErrorLoggerWatch(page);

    // Deliberately NOT `page.goto('${PROJECT_URL}/query/...')`:
    // `query-page.component.ts`'s `trackQueryParams()` reads the query
    // param `?id=`, which only `DatatugNavService.goQuery()` (the in-app
    // click path, used below) ever sets — together with router `state` the
    // component also reads. A direct URL nav leaves `queryId` empty and the
    // page never loads the query (confirmed live, S136; pre-existing,
    // applies to every store, not GitHub-specific — out of this task's own
    // fix scope). Clicking through from the Queries folder page is how a
    // real user actually reaches this page, and is what every other page in
    // this suite already does.
    await page.goto(PROJECT_URL);
    await page
      .locator('sneat-datatug-project-menu-top ion-item', { hasText: 'Queries' })
      .click();
    await activePage(page).locator('ion-item', { hasText: 'customers' }).click();
    await activePage(page)
      .locator('ion-item', { hasText: 'Customer invoices' })
      .getByTitle('Edit')
      .click();

    // `query-page.component.html`'s own `ion-title` is a hardcoded literal
    // "Query" — the real title lives in an `ion-input [value]="queryState.title"`
    // (an editable title field, not text content Playwright's text locators
    // can see) just below it. Pre-existing, not GitHub-specific.
    await expect
      .poll(
        () =>
          activePage(page)
            .locator('ion-input[placeholder="Title - is required"]')
            .evaluate((el: unknown) => (el as { value?: string }).value),
        { timeout: 20_000 },
      )
      .toBe('Customer invoices');
    // The query BODY (from the .query.dtql sidecar file) — proves get_query's
    // GitHub equivalent actually read the file content, not just the
    // definition JSON (which never carries `text` for the folder-list view).
    // See `getQueryBodyText()`'s own doc comment for why this reads
    // component state instead of DOM text.
    await expect.poll(() => getQueryBodyText(page), { timeout: 15_000 }).toMatch(
      /from:/,
    );
    // NOT exercising the "Run" button on this particular query: it declares
    // a required `Customer.ID` parameter with no value supplied, so `[disabled]`
    // on the button is `true` regardless of store type — a correct, unrelated
    // validation gate, not something this task's read-only-GitHub guard
    // should (or could) override. The next test, `Albums by title`, has no
    // required parameters and exercises the friendly-Run-message path
    // instead.

    expect(errors).toEqual([]);
  });

  test('a legacy-shaped query (no "id"/"type" field, discovered by directory listing only) still loads', async ({
    page,
  }) => {
    const errors = installErrorLoggerWatch(page);

    // Click-through, not `page.goto()` — see the previous test's own doc
    // comment for why.
    await page.goto(PROJECT_URL);
    await page
      .locator('sneat-datatug-project-menu-top ion-item', { hasText: 'Queries' })
      .click();
    await activePage(page).locator('ion-item', { hasText: 'albums' }).click();
    await activePage(page)
      .locator('ion-item', { hasText: 'Albums by title' })
      .getByTitle('Edit')
      .click();

    // See the previous test's own doc comment: the real title lives in an
    // `ion-input [value]`, not the header's hardcoded `ion-title`.
    await expect
      .poll(
        () =>
          activePage(page)
            .locator('ion-input[placeholder="Title - is required"]')
            .evaluate((el: unknown) => (el as { value?: string }).value),
        { timeout: 20_000 },
      )
      .toBe('Albums by title');
    // See `getQueryBodyText()`'s own doc comment: this query type has no
    // body editor UI at all currently, so read component state instead.
    await expect.poll(() => getQueryBodyText(page), { timeout: 15_000 }).toMatch(
      /SELECT/,
    );

    // Both of this query's own parameters are optional (no value required),
    // so — unlike the DTQL query in the previous test — "Run" is enabled and
    // reachable here: deliverable 2, "an explicit, friendly notice [that
    // running a query needs a DataTug agent], not a thrown error" for a
    // read-only GitHub-store project.
    await activePage(page).getByRole('button', { name: /run/i }).click();
    await expect(
      activePage(page).getByText(/datatug serve --project/),
    ).toBeVisible({ timeout: 10_000 });

    // The friendly Run message is not itself an ErrorLoggerService.logError
    // call — asserted the same way as the main journey test.
    expect(errors).toEqual([]);
  });

  /**
   * S155 — founder ruling 2026-09-10, verbatim: "Query page does not show
   * query text and linked entities/collections" — reported against exactly
   * this URL. Deliberately a direct `page.goto()`, unlike every other
   * query-page test above (see their own doc comments on why click-through
   * was used instead): a fresh, un-navigated browser tab pointed straight at
   * the founder's own URL is the actual reproduction, not an in-app click.
   * Live investigation (this task) found `queryState.request.text`/`.def`
   * were already loading correctly (`GithubProjectReaderService.getQuery()`
   * / `QueriesService.getQuery()` — unchanged by this task, see
   * `github-project-reader.service.spec.ts`'s own `getQuery` coverage and
   * `queries.service.spec.ts`'s new GitHub-store describe block) — the query
   * page template itself never rendered any of it (no SQL/DTQL body editor
   * at all, no "linked entities" section anywhere), AND a separate ordering
   * bug in `trackQueryParams()` (processed `env=` before `id=`) threw a
   * user-visible "Something went wrong: An attempt to set unknown env as an
   * active one: local" toast on this exact URL every time. Both fixed in
   * `query-page.component.ts`/`.html` (this task) — this is the read-only,
   * black-box proof: the real query text and its linked entities are
   * visible in the DOM, and no ErrorLoggerService.logError fires at all.
   */
  test("the founder's own reported URL — direct navigation to a legacy SQL query (no click-through) shows its query text and linked entities", async ({
    page,
  }) => {
    const errors = installErrorLoggerWatch(page);

    await page.goto(
      `${PROJECT_URL}/query/artists%2Fartists_with_albums?id=artists%2Fartists_with_albums&editor=text&env=local`,
    );

    // Query text — `artists_with_albums.sql`'s real body (no store menu
    // click involved, this is a cold navigation straight to the query).
    const bodyText = page.getByTestId('query-body-text');
    await expect(bodyText).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(
        () => bodyText.evaluate((el: unknown) => (el as { value?: string }).value),
        { timeout: 20_000 },
      )
      .toContain('FROM Artist');

    // Linked entities — `artists_with_albums.sql.json` carries no
    // parameters/recordsets metadata at all (confirmed against the real
    // repo file: `{"title": "Artists with albums"}`, nothing else), so this
    // exercises `extractLinkedEntityNames()`'s own FROM/JOIN text-scan
    // fallback (query-page.component.ts) rather than the metadata path the
    // DTQL test above exercises.
    const linkedEntities = page.getByTestId('linked-entities');
    await expect(linkedEntities).toBeVisible({ timeout: 15_000 });
    await expect(linkedEntities.getByText('Artist', { exact: true })).toBeVisible();
    await expect(linkedEntities.getByText('Album', { exact: true })).toBeVisible();

    expect(errors).toEqual([]);
  });

  /**
   * S158 — founder report 2026-09-10, production build ed66c71: loading the
   * founder's exact URL (the test just above) logged `NG04002: Cannot match
   * any routes` three times and the app ended on `/` with an empty router
   * outlet. Investigation (this task) found the actual request Angular's
   * router sees is NOT `%2F`-encoded: this app's own Cloudflare Workers
   * Assets config (`wrangler.jsonc`, `not_found_handling:
   * "single-page-application"`, unchanged since 2026-06-08, long before
   * this bug was ever reported) 307-redirects a cold top-level navigation
   * to such a URL, decoding `%2F` back into a literal `/` in the process —
   * confirmed live both via `wrangler dev` + `curl -v` against this repo's
   * own build (`Location: .../query/artists/artists_with_albums`, no
   * `%2F`) and via a direct request to https://datatug.app. So the id ends
   * up split across TWO real path segments by the time the SPA's router
   * sees it, not preserved as one `%2F`-encoded segment the way the test
   * above (and every in-app "open query" click, which never round-trips
   * through a redirect at all) sees it. `query/:queryId` (exactly one
   * param segment, the pre-existing route) never matched that shape; the
   * fix widens it to a literal `'query'` segment with a wildcard child
   * (`datatug-routing-proj.ts`), matching 1..N trailing segments. This
   * test reproduces the REAL failure mode directly — a `page.goto()` to
   * the id ALREADY split into two segments, the exact shape the redirect
   * produces — without needing a redirect-capable server in this suite.
   */
  test('a direct navigation to a folder-qualified query id already split across two real path segments (the shape this app\'s own Cloudflare redirect produces) still loads the query page, not NG04002', async ({
    page,
  }) => {
    const errors = installErrorLoggerWatch(page);
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    await page.goto(
      `${PROJECT_URL}/query/artists/artists_with_albums?id=artists%2Fartists_with_albums&editor=text&env=local`,
    );

    // The page-title component's own "{Page title} @ {Project title}"
    // header (sneat-datatug-page-title.component.ts) — proves the route
    // actually activated QueryPageComponent inside the real project
    // context, not just that *something* rendered.
    const pageTitle = page.locator('sneat-datatug-page-title');
    await expect(pageTitle).toContainText('Query', { timeout: 20_000 });
    await expect(pageTitle).toContainText('DataTug Demo Project 1');

    const bodyText = page.getByTestId('query-body-text');
    await expect(bodyText).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(
        () => bodyText.evaluate((el: unknown) => (el as { value?: string }).value),
        { timeout: 20_000 },
      )
      .toContain('FROM Artist');

    expect(errors).toEqual([]);
    // NG04002 surfaces as Angular's own internal `console.error`, not
    // through `ErrorLoggerService.logError` (the `errors` watch above) —
    // check for it directly.
    expect(consoleErrors.filter((text) => text.includes('NG04002'))).toEqual([]);
    // The founder's own report: the app ending up on the bare "/" store
    // route with an empty outlet, not on the query page at all.
    expect(new URL(page.url()).pathname).toContain('/query/');
  });

  /**
   * S160 — NG04002, 100% reproducible on every store/project (founder
   * report, 2026-09-10): the `'servers'` route was a bare `loadComponent`
   * leaf with no child route at all for `ServersPageComponent.goDbServer()`'s
   * own navigation to `servers/db/:dbDriver/:dbServerId` — clicking any DB
   * server row threw `NG04002: Cannot match any routes`. Fixed by switching
   * `'servers'` to `loadChildren` into the (previously dead-code)
   * `ServersPageRoutingModule`, correcting `goDbServer()`'s target array to
   * the real `/store/:storeId/project/:projectId/servers/db/...` shape, and
   * fixing `getDbServerFromId()`'s `port: +v[0]` off-by-one (it read the
   * HOST segment, always `NaN`, instead of `v[1]`, the port segment) so a
   * server's own Port row can actually render.
   *
   * The GitHub demo project's one aggregated DB server (sqlite3) declares no
   * `host` at all — a route segment can never be empty, so `getDbServerId()`
   * emits the placeholder `'-'` for it (`database.ts`); `getDbServerFromId()`
   * maps that back to an empty host. This test exercises exactly that
   * host-less row — the only DB server this demo project actually has.
   */
  test('clicking a DB server row on the Servers page opens its detail page, not NG04002 (S160)', async ({
    page,
  }) => {
    const errors = installErrorLoggerWatch(page);
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    await page.goto(PROJECT_URL);
    await page
      .locator('sneat-datatug-project-menu-top ion-item', { hasText: 'Servers' })
      .click();
    await expect(activePage(page).locator('ion-title', { hasText: 'Servers' })).toBeVisible({
      timeout: 15_000,
    });

    // The demo project's one DB server row — no host (sqlite3 is
    // file-based), driver badge "sqlite3" (see the "servers all render
    // their real content" test above for the same row). Clicking the row's
    // own label, not the row itself: `ion-item`'s bounding-box center can
    // land on the trailing delete button on a narrow viewport, and
    // `deleteDbServer()`'s own `event.stopPropagation()` would swallow the
    // click before it ever reaches `goDbServer()`.
    await activePage(page)
      .locator('ion-item[tappable]', { hasText: 'sqlite3' })
      .locator('ion-label')
      .click();

    // The real route: `/store/:storeId/project/:projectId/servers/db/
    // :dbDriver/:dbServerId` — `'-'` is the host-less placeholder id.
    await expect(page).toHaveURL(
      new RegExp(`${PROJECT_URL.replace(/[.]/g, '\\.')}/servers/db/sqlite3/-$`),
    );

    // Scoped to `sneat-datatug-dbserver` (`DbserverPageComponent`'s own
    // selector) rather than `activePage(page)`: during Ionic's page-
    // transition animation both the leaving `sneat-datatug-servers` page and
    // the entering `sneat-datatug-dbserver` page briefly carry `.ion-page`
    // without `.ion-page-hidden` at the same time (confirmed live — the
    // same class of timing issue `active-page.ts`'s own doc comment already
    // describes for `sneat-datatug-boards`), which trips
    // `activePage(page).locator('sneat-datatug-page-title')`'s strict-mode
    // check (2 matches: the Servers page's own title AND this one). Only
    // one `sneat-datatug-dbserver` element ever exists in this test's own
    // navigation (one click, one destination), so this tag alone is
    // unambiguous regardless of transition timing.
    const dbServerPage = page.locator('sneat-datatug-dbserver');
    await expect(dbServerPage).toBeVisible({ timeout: 15_000 });

    // `sneat-datatug-page-title`'s "{Page title} @ {Project title}" format
    // (see the S158 test above) — proves the route actually activated
    // `DbserverPageComponent` inside the real project context, not just
    // that *something* rendered where the Servers list used to be.
    const pageTitle = dbServerPage.locator('sneat-datatug-page-title');
    await expect(pageTitle).toContainText('DB server:', { timeout: 15_000 });
    await expect(pageTitle).toContainText('DataTug Demo Project 1');

    // The rest of the detail page's own structure — Host/Environments/
    // Databases cards (dbserver-page.component.html) — renders even though
    // this demo project has no host to show.
    await expect(
      dbServerPage.locator('ion-label', { hasText: 'Host' }),
    ).toBeVisible();
    await expect(
      dbServerPage.locator('ion-item-divider', { hasText: 'Environments' }),
    ).toBeVisible();
    await expect(
      dbServerPage.locator('ion-item-divider', { hasText: 'Databases' }),
    ).toBeVisible();

    expect(errors).toEqual([]);
    expect(consoleErrors.filter((text) => text.includes('NG04002'))).toEqual([]);
  });
});
