import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/agent-server';
import { activePage } from './helpers/active-page';

/**
 * S120 (Phase 1 plan, direct-nav defects follow-up to S112's epilogues work) —
 * proves the two datatug-apps DI/NG0201 defects epilogues.spec.ts's own header
 * comments named (S112's report, ~/.wb/reports/s112-epilogue-journeys.md) are
 * now fixed, directly, rather than continuing to route around them:
 *
 * 1. `EnvDbPageComponent` (`libs/datatug/main/src/lib/pages/signed-in/env-db/
 *    env-db-page.component.ts`) threw `NG0201: No provider found for
 *    ProjectService` on direct navigation to its own bare route
 *    (`env/:envId/db/:catalogId`, no `/table/` suffix) — the same missing
 *    `providers`/`imports` bug class as `EnvDbTablePageComponent`,
 *    `DatatugStorePageComponent` and `QueryPageComponent`. Fixed by adding
 *    `DatatugServicesProjectModule` to the component's own `imports`.
 * 2. `QueriesTabComponent` (rendered inside `QueriesPageComponent`'s own
 *    template, `libs/datatug/main/src/lib/queries/queries/queries-
 *    {page,tab}.component.ts`) threw the identical `NG0201` for
 *    `QueriesService` on navigation to `queries` — direct or in-app — because
 *    neither component declared the modules providing `QueriesService`/
 *    `DatatugNavContextService`/`AppContextService`. Fixed by adding
 *    `DatatugCoreModule`, `DatatugServicesNavModule` and
 *    `DatatugQueriesServicesModule` to the PARENT `QueriesPageComponent`'s
 *    own `imports` (mirroring `ProjectPageComponent` supplying
 *    `DatatugServicesUnsortedModule` for its own child
 *    `DatatugFolderComponent`).
 *
 * Both tests below assert the MECHANISM the brief asked for: no NG0201 (or
 * any other Angular DI) console error, and the page's own chrome actually
 * mounts and renders past the point that used to crash — the literal
 * observable difference between "the component's `inject()` field
 * initializers throw before anything renders" and "the component
 * constructs and its template paints."
 *
 * Neither test asserts real DATA content (table rows / a populated
 * saved-query list) for these two specific routes, and that is a deliberate,
 * evidence-based scope boundary, not an oversight or a cut — see each test's
 * own comment for why, confirmed live (not just by reading) against a real
 * `datatug serve` agent before writing either assertion:
 *
 * - `EnvDbPageComponent` has NEVER had any way to populate `this.envDb`
 *   except `history.state.db`, which nothing in this codebase ever pushes
 *   (confirmed: no `routerLink`/`.navigate()` call anywhere targets this
 *   route with `state: { db: ... }`, and no agent endpoint returns an
 *   `IDatabaseFull`-shaped tables+views list — `getServerDatabases()`
 *   (`services/unsorted/db-server.service.ts`) only returns catalog NAMES).
 *   This page has been unreachable via any in-app UI action and, once
 *   reached by URL, has never been able to show its own table list — a
 *   separate, pre-existing datatug-apps data-fetch gap, not the NG0201 bug
 *   this stream fixed and not addressed here (flagged separately).
 * - `QueriesTabComponent.loadQueries()` already calls the right thing
 *   (`queriesService.getQueriesFolder()`, which now runs at all once the
 *   project resolves) but the agent endpoint it depends on,
 *   `GET /datatug/queries/all_queries`, is commented out server-side in
 *   `datatug-cli` (`pkg/server/endpoints/routes.go` — the route registration
 *   AND the `GetQueries` handler are both commented out /removed;
 *   `query_endpoints.go` has no live handler left to re-enable it against).
 *   Confirmed live: the request IS now sent, correctly scoped to the
 *   resolved project/folder (proving this stream's DI fix works end to end),
 *   and 404s — a separate, cross-repo (`datatug/datatug-cli`) backend gap,
 *   out of this repo's landing scope, not addressed here.
 */

const DEMO_PROJECT_ID = 'datatug-demo-project'; // datatug-demo-projects/demo-project-1/datatug-project.json #id
const DEMO_ENV_ID = 'local'; // .../demo-project-1/environments/local
const DEMO_DB_CATALOG_ID = 'chinook-local'; // .../environments/local/catalogs/chinook-local

/** Matches an Angular DI failure specifically (NG0201/NullInjectorError/"No
 * provider for") — the exact class of console/page error both fixes below
 * eliminate. Deliberately narrower than root-and-login.spec.ts's own
 * `clientErrorPatterns` (which also flags unrelated icon/URL errors this
 * suite doesn't care about) since this file is only about the DI defects. */
const diErrorPatterns = [/NG0201/, /NullInjectorError/, /No provider for/];

function installDiErrorChecks(page: Page): string[] {
  const diErrors: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (
      message.type() === 'error' &&
      diErrorPatterns.some((pattern) => pattern.test(text))
    ) {
      diErrors.push(text);
    }
  });
  page.on('pageerror', (error) => {
    const text = error.message;
    if (diErrorPatterns.some((pattern) => pattern.test(text))) {
      diErrors.push(text);
    }
  });
  return diErrors;
}

test.describe('Direct navigation — EnvDbPageComponent (env/:envId/db/:catalogId)', () => {
  test('a fresh page opening the DB overview URL directly renders its own chrome with no NG0201', async ({
    agentServer,
    page,
  }) => {
    const diErrors = installDiErrorChecks(page);
    const dbOverviewUrl =
      `/store/${agentServer.storeId}/project/${DEMO_PROJECT_ID}` +
      `/env/${DEMO_ENV_ID}/db/${DEMO_DB_CATALOG_ID}`;

    await page.goto(dbOverviewUrl);

    // The page's own chrome — filter input and the Tables/Views segment —
    // is what used to never paint at all: the whole component crashed in
    // its `inject()` field initializers before Angular ever rendered its
    // template. Scoped via activePage() per this suite's own convention
    // (helpers/active-page.ts) since ion-segment-button/labels are not
    // unique to this one page.
    await expect(
      activePage(page).locator('ion-segment-button', { hasText: 'Tables' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      activePage(page).locator('ion-segment-button', { hasText: 'Views' }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      activePage(page).locator('ion-input[placeholder="Filter"]'),
    ).toBeVisible({ timeout: 10_000 });

    expect(diErrors).toEqual([]);
  });
});

test.describe('Direct navigation — QueriesPageComponent/QueriesTabComponent (queries)', () => {
  test('a fresh page opening the queries-list URL directly renders its own chrome, with no NG0201, and resolves the project into its outgoing request', async ({
    agentServer,
    page,
  }) => {
    const diErrors = installDiErrorChecks(page);
    const queriesListUrl =
      `/store/${agentServer.storeId}/project/${DEMO_PROJECT_ID}` +
      `/queries?folder=customers`;

    // Observed the same way store-id-scheme.spec.ts proves its own DI/nav
    // fix: watch the REAL, unintercepted outgoing request rather than only
    // the rendered outcome, since the rendered outcome here is a 404 (see
    // this file's header) that would look identical whether or not the
    // request was even scoped to the right project.
    const queriesRequestPromise = page.waitForRequest(
      (req) => req.url().includes('/datatug/queries/all_queries'),
      { timeout: 15_000 },
    );

    await page.goto(queriesListUrl);

    // The page's own chrome — the SQL/HTTP query-type filter buttons
    // (queries-tab.component.html) — is what used to never paint at all:
    // `QueriesTabComponent`'s own `inject(QueriesService)` crashed before
    // Angular rendered anything past `QueriesPageComponent`'s header.
    await expect(
      activePage(page).locator('ion-button', { hasText: 'SQL' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      activePage(page).locator('ion-button', { hasText: 'HTTP' }),
    ).toBeVisible({ timeout: 10_000 });

    // "resolves the project from the URL" — the request this stream's fix
    // now lets `DatatugNavContextService`/`QueriesTabComponent.loadQueries()`
    // actually send is scoped to the SAME project this URL names, not left
    // undefined/never-sent the way it was before (the pre-fix behaviour:
    // no request at all, per S112's report).
    const queriesRequest = await queriesRequestPromise;
    const requestUrl = new URL(queriesRequest.url());
    expect(requestUrl.searchParams.get('project')).toBe(DEMO_PROJECT_ID);
    expect(requestUrl.searchParams.get('folder')).toBe('~/customers');

    expect(diErrors).toEqual([]);
  });
});
