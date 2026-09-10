import { expect, test } from './fixtures/agent-server';
import { activePage } from './helpers/active-page';

/**
 * Epilogue e2e against the REAL `datatug serve` agent — same no-interception rule
 * as ./journey.spec.ts (see that file's own header and ../README.md). S112 (Phase
 * 1 plan Task 17 prep) — proves both epilogues Feature core-investigation-loop
 * names (datatug/datatug spec/features/core-investigation-loop/README.md,
 * verbatim):
 *
 * > Epilogue A — close/reopen. Closing a tab does not stop the agent. Reopen its
 * > project URL to resume browsing; a new browser session starts with empty
 * > context. Persisted project assets remain, but unsaved context is not
 * > promised durable.
 *
 * > Epilogue B — share/replay. Copy a navigation link containing only authorized
 * > project/screen identifiers by default. A colleague opens it under their own
 * > agent or authenticated access, supplies/reselects needed values and
 * > re-executes. Good result: no credentials, hidden values or prior authorized
 * > results travel in the URL. Optional value sharing requires explicit
 * > preview/consent and recipient reauthorization.
 *
 * This is a NEW file, per this stream's brief — journey.spec.ts and
 * fixtures/agent-server.ts are owned by lane S111 (worktree phase1-task14-http)
 * concurrently; both are reused here unmodified (worker-scoped `agentServer`/
 * `supportAgentServer`, `activePage(page)`).
 *
 * Brief guard, addressed before writing Epilogue B (query-page.component.ts
 * lines 640–670/795–815): `trackQueryParams()` only ever READS `env`/`id` from
 * the URL, and the only method that WRITES query params, `updateUrl()`
 * (line 798), sets exactly `{ id, editor, env }` — no parameter value, no
 * `securityContextId`, no principal. So the "no parameter value in the URL"
 * half of Epilogue B already holds today; nothing was found that needed a STOP
 * on that specific point.
 *
 * A DIFFERENT, real gap surfaced while designing Epilogue B's "the user
 * selects/enters ... and runs" step: query-page.component.html has no manual
 * parameter-entry control anywhere (confirmed directly — its only per-binding
 * controls are "Use selection" and "Clear this binding"; an unbound required
 * parameter just renders "required — no value supplied", no input). This is
 * the exact same gap journey.spec.ts's own J4 comment already documents. Rather
 * than fabricate a UI action that cannot really happen (the alternative J4's own
 * comment already rejects as "a worse fiction"), Epilogue B below reads the
 * Feature text's own "supplies/**reselects**" wording literally: the colleague
 * browses back into the Customer table and clicks the value, the same
 * REQ:parameter-auto-binding path J2 already proves — not a different UI, and
 * not a workaround. That path is only blocked once, for the Brazilian customer
 * under the support principal (Country/BillingCountry ACL filters that row out
 * of the grid entirely — the identical, already-documented reason
 * journey.spec.ts's own J4 test uses a direct, unintercepted request instead of
 * a UI click for that one customer). This file reuses that same established
 * technique, for the same reason, rather than inventing a new one — see that
 * request below for the full comment.
 */

const DEMO_PROJECT_ID = 'datatug-demo-project'; // datatug-demo-projects/demo-project-1/datatug-project.json #id
const DEMO_ENV_ID = 'local'; // .../demo-project-1/environments/local
const DEMO_DB_CATALOG_ID = 'chinook-local'; // .../environments/local/catalogs/chinook-local
const CUSTOMER_TABLE_TYPE = 'main.Customer';

test.describe('Epilogue A — close/reopen', () => {
  test('closing a tab does not stop the agent; a new page/context starts with empty Investigation Context, but project assets persist', async ({
    agentServer,
    page,
    browser,
    request,
  }) => {
    const agentOrigin = `http://${agentServer.host}:${agentServer.port}`;
    const projectUrl = `/store/${agentServer.storeId}/project/${DEMO_PROJECT_ID}`;
    const customerTableUrl =
      `${projectUrl}/env/${DEMO_ENV_ID}/db/${DEMO_DB_CATALOG_ID}` +
      `/table/${CUSTOMER_TABLE_TYPE}`;
    // "Album/Customer tables ... still present" — via the SAME `/table/<type>`
    // route J1–J4 already prove works on direct navigation (customerTableUrl
    // above IS this route for Customer). Deliberately NOT the DB overview page
    // (env-db-page.component, bare `env/:envId/db/:catalogId`, no `/table/`
    // suffix): its `NG0201: No provider found for ProjectService` crash on
    // direct navigation (found while building this test) is now FIXED — see
    // `direct-nav.spec.ts`, which asserts that route's own chrome renders
    // with no NG0201, direct-nav.spec.ts's own header, and this stream's
    // report (lane S120).
    // UPDATE (Task 17 items A.2/B.1, S121/S121b): the data-fetch gap this
    // paragraph originally documented is now RESOLVED — `EnvDbPageComponent`
    // fetches its table list from `GET /datatug/catalog-tables`, and
    // `direct-nav.spec.ts`'s own test for this route now asserts the real
    // table list renders, not just the chrome. Kept here anyway, unchanged:
    // this epilogue's own point is "Album is still present after
    // close/reopen", and the deeper `/table/<type>` route remains the more
    // direct, already-proven way to assert that one table specifically —
    // not a workaround for a gap anymore, just the more precise route.
    const albumTableUrl =
      `${projectUrl}/env/${DEMO_ENV_ID}/db/${DEMO_DB_CATALOG_ID}` +
      `/table/main.Album`;
    // "saved queries list ... still present" — via direct navigation to each
    // query's OWN page, the exact pattern J3 already proves works
    // (journey.spec.ts's `page.goto(`${projectUrl}/query/<id>?id=<id>`)`).
    // Deliberately NOT the queries LIST page (`/queries?folder=customers`,
    // QueriesTabComponent): its `NG0201: No provider found for
    // QueriesService` crash on navigation to this route — direct or in-app —
    // (found while building this test) is now FIXED — see
    // `direct-nav.spec.ts`, which asserts this route's own chrome renders
    // with no NG0201 and that the project resolves correctly into its
    // outgoing request; and this stream's report (lane S120).
    // UPDATE (Task 17 item A.1, S121/S121b): `GET /datatug/queries/all_queries`
    // is no longer commented out server-side — restored in datatug-cli, and
    // `direct-nav.spec.ts`'s own test for this route now asserts the real
    // query list renders (each saved query by its title), not just the
    // chrome. Kept here anyway, unchanged: this epilogue's own point is that
    // customer-invoices/customer-purchases-by-genre SPECIFICALLY are still
    // present and still correctly parameter-bound after close/reopen, and
    // navigating to each query's own page remains the more direct,
    // already-proven way to assert exactly that — not a workaround for a
    // gap anymore, just the more precise route.
    const customerInvoicesUrl = `${projectUrl}/query/customer-invoices?id=customer-invoices`;
    const customerPurchasesUrl = `${projectUrl}/query/customer-purchases-by-genre?id=customer-purchases-by-genre`;

    // --- Add Customer.ID = 5 to the Investigation Context, the way J3 does ---
    await page.goto(customerTableUrl);
    await expect(activePage(page).locator('.tabulator-row').first()).toBeVisible({
      timeout: 15_000,
    });
    const customerId5Cell = activePage(page)
      .locator('.tabulator-row')
      .locator('[tabulator-field="CustomerId"]')
      .filter({ hasText: /^5$/ });
    await expect(customerId5Cell).toBeVisible({ timeout: 10_000 });
    await customerId5Cell.click();
    await expect(activePage(page).locator('sneat-datatug-context-panel')).toBeVisible({
      timeout: 15_000,
    });
    await activePage(page).getByText('Add to context', { exact: false }).click();
    // Not scoped to activePage() — the context bar lives in the app's
    // persistent side-menu tree, outside <ion-router-outlet> (active-page.ts's
    // own doc comment; J3 asserts it the same way). `meaning` (context-panel
    // .component.ts) formats the label as "Customer.ID = 5" exactly.
    await expect(page.locator('sneat-datatug-investigation-context-bar')).toContainText(
      'Customer.ID = 5',
      { timeout: 10_000 },
    );

    // --- Close the tab. The agent is a separate OS process; nothing about a
    // browser tab closing should reach it. ---
    await page.close();

    // "agent still up, agent-info still answers" — a real, unintercepted
    // request, independent of any page (this stream's brief sanctions a
    // `request` call here as an alternative to polling the agent's own log).
    const agentInfoAfterClose = await request.get(`${agentOrigin}/datatug/agent-info`);
    expect(agentInfoAfterClose.ok()).toBe(true);

    // --- Open a NEW page in the SAME browser context at the project URL ---
    const context = page.context();
    const reopenedPage = await context.newPage();
    await reopenedPage.goto(projectUrl);
    // "the project appears" — same mechanism J1 uses: the Title input's VALUE,
    // not merely some text existing (proves a real load, not a stale/loading
    // shell).
    await expect(
      reopenedPage
        .locator('ion-item', { hasText: 'Title' })
        .first()
        .getByRole('textbox'),
    ).toHaveValue('DataTug Demo Project 1', { timeout: 15_000 });
    // The empty state must be the REAL empty-context rendering: the assertion
    // above already forced a wait for real content before this check runs, so
    // an absent chip here cannot be "still loading".
    await expect(
      reopenedPage.locator('sneat-datatug-investigation-context-bar'),
    ).not.toContainText('Customer.ID', { timeout: 5_000 });

    // "persisted project assets remain" — tables (Album/Customer) and saved
    // queries (customer-invoices/customer-purchases-by-genre) still load from
    // the agent. Wait for the grid/list itself before asserting content, same
    // discipline as above.
    await reopenedPage.goto(albumTableUrl);
    await expect(activePage(reopenedPage).locator('.tabulator-row').first()).toBeVisible({
      timeout: 15_000,
    });
    await reopenedPage.goto(customerTableUrl);
    await expect(activePage(reopenedPage).locator('.tabulator-row').first()).toBeVisible({
      timeout: 15_000,
    });

    await reopenedPage.goto(customerInvoicesUrl);
    await expect(
      activePage(reopenedPage).locator('ion-card-title', { hasText: 'Parameters' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      activePage(reopenedPage).getByText('Customer.ID', { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
    await reopenedPage.goto(customerPurchasesUrl);
    await expect(
      activePage(reopenedPage).locator('ion-card-title', { hasText: 'Parameters' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      activePage(reopenedPage).getByText('Customer.ID', { exact: false }),
    ).toBeVisible({ timeout: 10_000 });

    // --- Open a NEW browser context (a genuinely separate browser session,
    // not just a new tab) at the same project URL ---
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    await freshPage.goto(projectUrl);
    await expect(
      freshPage
        .locator('ion-item', { hasText: 'Title' })
        .first()
        .getByRole('textbox'),
    ).toHaveValue('DataTug Demo Project 1', { timeout: 15_000 });
    await expect(
      freshPage.locator('sneat-datatug-investigation-context-bar'),
    ).not.toContainText('Customer.ID', { timeout: 5_000 });

    await freshPage.goto(albumTableUrl);
    await expect(activePage(freshPage).locator('.tabulator-row').first()).toBeVisible({
      timeout: 15_000,
    });
    await freshPage.goto(customerTableUrl);
    await expect(activePage(freshPage).locator('.tabulator-row').first()).toBeVisible({
      timeout: 15_000,
    });

    await freshPage.goto(customerInvoicesUrl);
    await expect(
      activePage(freshPage).locator('ion-card-title', { hasText: 'Parameters' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      activePage(freshPage).getByText('Customer.ID', { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
    await freshPage.goto(customerPurchasesUrl);
    await expect(
      activePage(freshPage).locator('ion-card-title', { hasText: 'Parameters' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      activePage(freshPage).getByText('Customer.ID', { exact: false }),
    ).toBeVisible({ timeout: 10_000 });

    await freshContext.close();
  });
});

test.describe('Epilogue B — share/replay', () => {
  test('a captured query-page link carries only identifiers; a colleague on the same agent reselects and runs; a colleague on the support agent gets its own ACL', async ({
    agentServer,
    supportAgentServer,
    page,
    browser,
    request,
  }) => {
    // The real scheme `datatug serve` prints (store-id-scheme.spec.ts's own
    // header/PR #198), used here rather than J1–J3's bare `host:port` because
    // this test is specifically about a real, shareable navigation link — the
    // brief names this scheme explicitly for this test.
    const adminStoreId = `http-${agentServer.host}:${agentServer.port}`;
    const projectUrl = `/store/${adminStoreId}/project/${DEMO_PROJECT_ID}`;
    const customerTableUrl =
      `${projectUrl}/env/${DEMO_ENV_ID}/db/${DEMO_DB_CATALOG_ID}` +
      `/table/${CUSTOMER_TABLE_TYPE}`;

    // --- Reach customers/customer-invoices with Customer.ID bound "from
    // selection" — J2's own path, verbatim, on any row (the identity of the
    // row is irrelevant to this test; only the URL that results matters). ---
    await page.goto(customerTableUrl);
    await expect(activePage(page).locator('.tabulator-row').first()).toBeVisible({
      timeout: 15_000,
    });
    const firstCustomerCell = activePage(page)
      .locator('.tabulator-row')
      .first()
      .locator('[tabulator-field="CustomerId"]');
    await expect(firstCustomerCell).toBeVisible({ timeout: 10_000 });
    await firstCustomerCell.click();
    await expect(activePage(page).locator('sneat-datatug-context-panel')).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      activePage(page).getByText('customer-invoices', { exact: false }),
    ).toBeVisible({ timeout: 15_000 });
    await activePage(page).getByText('customer-invoices', { exact: false }).click();
    await expect(
      activePage(page)
        .getByText('Customer.ID', { exact: false })
        .getByText('from selection', { exact: false }),
    ).toBeVisible({ timeout: 10_000 });

    // `updateUrl()` (query-page.component.ts:798) only runs from
    // `ionViewDidEnter()`/`envChanged()`/`editorTabChanged()` — an Ionic
    // lifecycle callback and two user-driven handlers this page's own
    // template never wires to any control (query-page.component.html has no
    // environment selector at all — confirmed live). `onOpenQuery()`
    // (env-db-table.page.ts:591-633, the context panel's own navigation
    // handler this test's own click above triggers) forwards only
    // `queryParams: { id: request.queryId }` — no `env`. So `env=` reliably
    // never lands in a URL reached this way (confirmed live: still absent
    // after a 10s poll); `editor=` DOES (ionViewDidEnter's updateUrl() runs
    // once, with `queryState.activeEnv` still unset at that point). This is a
    // real, confirmed product behavior, not a timing flake — poll for
    // `editor=` (the one param `updateUrl()` always writes) to capture the
    // STABLE post-transition URL, and only assert `env=` IF present (it is
    // never a leak either way — DEMO_ENV_ID is not a secret — but the brief's
    // own text names it, so assert it when the app does supply it).
    await expect
      .poll(() => new URL(page.url()).search, { timeout: 10_000 })
      .toContain('editor=');
    const sharedUrl = page.url();

    // --- The URL is safe to share: only store/project/environment/query
    // identifiers, never a value, a securityContextId, a principal, or rows. ---
    const parsed = new URL(sharedUrl);
    const decodedPath = decodeURIComponent(parsed.pathname);
    const decodedSearch = decodeURIComponent(parsed.search);
    expect(decodedPath).toContain(`/store/${adminStoreId}/project/${DEMO_PROJECT_ID}`);
    expect(decodedPath).toContain('/query/');
    expect(decodedPath).toContain('customer-invoices');
    expect(decodedSearch).toContain('customer-invoices'); // ?id=...
    if (decodedSearch.includes('env=')) {
      expect(decodedSearch).toContain(`env=${DEMO_ENV_ID}`);
    }
    // Forbidden content — see this file's header finding on updateUrl().
    const lowerUrl = sharedUrl.toLowerCase();
    expect(lowerUrl).not.toContain('securitycontextid');
    expect(lowerUrl).not.toContain('principal');
    expect(lowerUrl).not.toContain('customerid');
    expect(lowerUrl).not.toMatch(/[?&]value=/);
    expect(lowerUrl).not.toContain('rows');

    // --- A colleague opens that URL under a FRESH browser context pointed at
    // the SAME agent (their own session, same agent as the sharer) ---
    const colleagueContext = await browser.newContext();
    const colleaguePage = await colleagueContext.newPage();
    await colleaguePage.goto(sharedUrl);
    // "renders with the parameter unbound/needs-input" — a fresh tab has fresh
    // sessionStorage, so InvestigationContextService's basket for this scope is
    // empty (Epilogue A above already proves that mechanism); CustomerId
    // (isRequired) shows the same blocked state J3 already covers.
    await expect(
      activePage(colleaguePage)
        .getByText('Customer.ID', { exact: false })
        .getByText('required', { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
    const colleagueRunButton = activePage(colleaguePage).locator('ion-button', {
      hasText: 'Run query',
    });
    await expect(colleagueRunButton).toHaveAttribute('disabled', '');

    // "supplies/reselects needed values" — see this file's header: no manual
    // entry control exists, so the colleague browses back into the data and
    // clicks the value, exactly REQ:parameter-auto-binding/J2's own path.
    await colleaguePage.goto(customerTableUrl);
    await expect(activePage(colleaguePage).locator('.tabulator-row').first()).toBeVisible({
      timeout: 15_000,
    });
    const colleagueCell5 = activePage(colleaguePage)
      .locator('.tabulator-row')
      .locator('[tabulator-field="CustomerId"]')
      .filter({ hasText: /^5$/ });
    await expect(colleagueCell5).toBeVisible({ timeout: 10_000 });
    await colleagueCell5.click();
    await expect(activePage(colleaguePage).locator('sneat-datatug-context-panel')).toBeVisible({
      timeout: 15_000,
    });
    const colleagueRunResponsePromise = colleaguePage.waitForResponse(
      (res) =>
        res.url().includes('/datatug/exec/run_query') && res.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await activePage(colleaguePage).getByText('customer-invoices', { exact: false }).click();
    await expect(
      activePage(colleaguePage)
        .getByText('Customer.ID', { exact: false })
        .getByText('from selection', { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
    await activePage(colleaguePage).getByText('Run query', { exact: false }).click();
    const colleagueRunBody = (await (await colleagueRunResponsePromise).json()) as {
      recordset?: { rows: unknown[] };
    };
    // "rows appear" — the exact row count is irrelevant here (no ACL is in
    // play under the admin agent); only that a real run against a re-selected
    // value succeeded.
    expect(colleagueRunBody.recordset?.rows?.length).toBeGreaterThan(0);
    await colleagueContext.close();

    // --- Rewrite the store id to the SUPPORT agent's host:port (the
    // colleague's OWN agent) and open it in another fresh context ---
    const supportStoreId = `http-${supportAgentServer.host}:${supportAgentServer.port}`;
    const rewrittenUrl = sharedUrl.replace(
      `/store/${adminStoreId}/`,
      `/store/${supportStoreId}/`,
    );
    expect(rewrittenUrl).not.toBe(sharedUrl);

    const supportColleagueContext = await browser.newContext();
    const supportColleaguePage = await supportColleagueContext.newPage();
    // "renders under the support principal" — mechanism: the page's own first
    // request actually reaches the REWRITTEN origin (store-id-scheme.spec.ts's
    // own pattern), not the admin agent this link was originally captured
    // from.
    const firstSupportRequest = supportColleaguePage.waitForRequest(
      (req) =>
        req
          .url()
          .startsWith(`http://${supportAgentServer.host}:${supportAgentServer.port}/datatug/`),
      { timeout: 15_000 },
    );
    await supportColleaguePage.goto(rewrittenUrl);
    await firstSupportRequest;
    await expect(
      activePage(supportColleaguePage)
        .getByText('Customer.ID', { exact: false })
        .getByText('required', { exact: false }),
    ).toBeVisible({ timeout: 10_000 });

    // Customer 3 (Canadian) is visible under `--as support`'s own ACL (same
    // fixture/policy J4 already proves) — reselect it the same real way.
    const supportCustomerTableUrl = customerTableUrl.replace(
      `/store/${adminStoreId}/`,
      `/store/${supportStoreId}/`,
    );
    await supportColleaguePage.goto(supportCustomerTableUrl);
    await expect(
      activePage(supportColleaguePage).locator('.tabulator-row').first(),
    ).toBeVisible({ timeout: 15_000 });
    const canadianCell = activePage(supportColleaguePage)
      .locator('.tabulator-row')
      .locator('[tabulator-field="CustomerId"]')
      .filter({ hasText: /^3$/ });
    await expect(canadianCell).toBeVisible({ timeout: 10_000 });
    await canadianCell.click();
    await expect(
      activePage(supportColleaguePage).locator('sneat-datatug-context-panel'),
    ).toBeVisible({ timeout: 15_000 });
    const canadianRunResponsePromise = supportColleaguePage.waitForResponse(
      (res) =>
        res.url().includes('/datatug/exec/run_query') && res.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await activePage(supportColleaguePage)
      .getByText('customer-invoices', { exact: false })
      .click();
    await expect(
      activePage(supportColleaguePage)
        .getByText('Customer.ID', { exact: false })
        .getByText('from selection', { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
    await activePage(supportColleaguePage).getByText('Run query', { exact: false }).click();
    const canadianRunBody = (await (await canadianRunResponsePromise).json()) as {
      recordset?: { rows: unknown[] };
      limitations?: { rowsFiltered: boolean }[];
      provenance?: { executionProfile: string };
    };
    expect(canadianRunBody.recordset?.rows?.length).toBe(7);
    expect(canadianRunBody.limitations).toEqual(
      expect.arrayContaining([expect.objectContaining({ rowsFiltered: true })]),
    );
    expect(canadianRunBody.provenance?.executionProfile).toBe('protected');
    await expect(
      activePage(supportColleaguePage).locator('sneat-datatug-limitation-header'),
    ).toBeVisible({ timeout: 10_000 });

    // Customer 1 (Brazilian) can never appear in this grid under `--as
    // support` (Country/BillingCountry ACL filter — same journey.spec.ts J4
    // finding), so there is no row to click, hence no UI path to reselect it.
    // A direct, unintercepted request against this SAME running support
    // agent, reusing journey.spec.ts's own J4 technique for the identical
    // reason (see that test's comment on its equivalent request): not a
    // fabricated workaround, the established pattern this suite already uses
    // when the real UI cannot reach a row the ACL itself filters out.
    const supportOrigin = `http://${supportAgentServer.host}:${supportAgentServer.port}`;
    const supportAgentInfo = (await (
      await request.get(`${supportOrigin}/datatug/agent-info`)
    ).json()) as { securityContextId: string };
    const brazilianRunBody = (await (
      await request.post(`${supportOrigin}/datatug/exec/run_query`, {
        data: {
          project: DEMO_PROJECT_ID,
          environment: DEMO_ENV_ID,
          securityContextId: supportAgentInfo.securityContextId,
          queryId: 'customers/customer-invoices',
          parameters: { CustomerId: { type: 'integer', value: '1' } },
          bindingOrigins: [{ parameterId: 'CustomerId', origin: 'manual' }],
          mode: 'live',
        },
      })
    ).json()) as {
      recordset?: { rows: unknown[] };
      limitations?: { rowsFiltered: boolean }[];
    };
    expect(brazilianRunBody.recordset?.rows).toEqual([]);
    expect(brazilianRunBody.limitations).toEqual(
      expect.arrayContaining([expect.objectContaining({ rowsFiltered: true })]),
    );

    await supportColleagueContext.close();
  });
});
