import { expect, test } from './fixtures/agent-server';

/**
 * Journey e2e against the REAL `datatug serve` agent — no HTTP route
 * interception (contrast with e2e/root-and-login.spec.ts, which stubs
 * `localhost:8989` on purpose; see hub lesson "an e2e that intercepts the
 * backend never proves the contract").
 *
 * Walks user journeys J1–J4 from Feature core-investigation-loop
 * (datatug/datatug spec/features/core-investigation-loop/README.md). J1
 * (Phase 1 plan task 3, AC:journey-harness), J2 and J3 (plan task 10) are
 * all filled in below and all currently FAIL against a `datatug-cli` main
 * build — deliberately left un-skipped per this stream's brief ("keep them
 * un-skipped and report the exact failure, do not hide it"). Two blockers,
 * both outside `datatug-apps` (nothing in this repo can fix them):
 *
 * 1. (found while fixing this suite's own host mismatch, and now fixed here)
 *    `datatug-cli`'s CORS origin check
 *    (github.com/sneat-co/sneat-go-core/security.VerifyOrigin, vendored via
 *    apicore.Execute) allow-lists literal "localhost" but not "127.0.0.1" —
 *    this suite's dev server and agent both used to bind 127.0.0.1
 *    (ERR wasn't a 404, it was "Http failure response ... 0 Unknown Error",
 *    i.e. the browser's own CORS block). Fixed in
 *    ../../playwright.config.ts (dev server now serves from
 *    "http://localhost:4200"); see that file's comment for the repro.
 * 2. (NOT fixable here — a datatug-cli/sneat-go-core defect) Even from an
 *    allowed origin, every request that reaches
 *    `apicore.Execute`/`VerifyRequest` (e.g. `GET /datatug/projects/
 *    project_summary`, which the project page needs just to render its
 *    title — this is what J1 waits on first) panics server-side with
 *    "GetAuthTokenFromHttpRequest is nil" and the connection closes with no
 *    response (reproduced directly: `curl -H "Origin: http://localhost:4200"
 *    ".../datatug/projects/project_summary?id=..."` → "Empty reply from
 *    server"; the agent's own log shows `http: panic serving ...:
 *    GetAuthTokenFromHttpRequest is nil` at sneat-go-core's
 *    apicore/request_validation.go:121). `apicore.GetAuthTokenFromHttpRequest`
 *    is a package-level function var every consumer must set at startup
 *    (see sneat-go-core/apicore/request_validation.go:105) —
 *    `grep -rn GetAuthTokenFromHttpRequest` in datatug-cli finds no call
 *    setting it, so this panics unconditionally, for any client, on any
 *    endpoint that funnels through `handle()`/`apicore.Execute`
 *    (`/datatug/exec/select` and `/datatug/exec/run_query` bypass it and
 *    are unaffected — they call their `api.*` functions directly — but
 *    `/datatug/projects/project_summary` does not). This blocks J1 before
 *    it can even confirm the project loaded, so it also blocks J2/J3
 *    (which navigate to the same project first). Needs a datatug-cli fix
 *    (wire `apicore.GetAuthTokenFromHttpRequest`, e.g. to a no-auth-required
 *    passthrough for the local `serve` command) before ANY journey test can
 *    pass; re-run this suite once that lands.
 *    UPDATE 2026-09-09: landed as datatug/datatug-cli#205. Against a
 *    datatug-cli main build J1 now passes its title assertion (locator
 *    corrected in datatug/datatug-apps#69). It then failed at the Album grid
 *    with `NG0201: No provider found for DatatugNavContextService. Source:
 *    Standalone[EnvDbTablePageComponent]` — this repo's own defect, fixed by
 *    giving that page the service modules it never declared.
 * 3. (NOT fixable here — a datatug-cli contract defect) The Album grid still
 *    does not render, and this is now the first blocker. The table page loads
 *    its environment before it can select rows, and
 *    `GET /datatug/environment-summary?proj=<id>&env=local` answers 400:
 *    `validation error: invalid request: bad value for field [projID]:
 *    missing required field` (reproduce with `datatug serve --project
 *    datatug-demo-projects/demo-project-1 --as admin` and curl that path).
 *    Two mismatches, both server-side of the contract: this client sends the
 *    project as `proj=` (environment.service.ts `getEnvSummary`) while
 *    `fillProjectRef` reads `urlParamProjectID = "project"`; and
 *    `getEnvironmentSummary` calls `fillProjectItemRef(ref, q, "")`, so the
 *    environment id is read from an empty parameter name and is always blank
 *    even once the project id arrives. datatug-cli is itself inconsistent
 *    here — `dbserver_databases.go` and `execute_endpoints.go` read `proj` —
 *    so which spelling is canonical is that repo's call, not this one's.
 *    With the page fixed, the agent log now shows this page reaching
 *    `/datatug/environment-summary` and `/datatug/projects/project_full` at
 *    all, which it never did before; no `/datatug/exec/select` follows
 *    because the environment never resolves.
 *
 * J2 additionally needs `GET /datatug/semantic/columns`, `POST
 * /datatug/semantic/related` and `POST /datatug/queries/applicable` (plan Task 12
 * moved `semantic/related` from GET to POST — the appendix requires semantic values
 * never be copied into a URL/browser history — see this stream's contract cut-over),
 * none of which exist on datatug-cli main yet (`grep -rn semantic pkg/server
 * pkg/api` in that repo finds nothing) — see its own test comment. J3's
 * remainder (Investigation Context bar/service, binding "from context") is
 * pure client-side state once blocker 2 is cleared — no further server
 * contract needed for it specifically.
 *
 * J4 stays `test.fixme` — it depends on plan task 6 (`--as support` policy
 * enforcement), out of this stream's scope.
 *
 * See ./README.md for the env vars this suite reads and what CI must
 * provide to run it instead of skipping it.
 */

const DEMO_PROJECT_ID = 'datatug-demo-project'; // datatug-demo-projects/demo-project-1/datatug-project.json #id
const DEMO_ENV_ID = 'local'; // .../demo-project-1/environments/local
const DEMO_DB_CATALOG_ID = 'chinook-local'; // .../environments/local/catalogs/chinook-local
// Chinook's sqlite3 catalog uses schema "main" — see
// datatug-demo-projects/demo-project-1/dbmodels/chinook/main/tables/Album.
const ALBUM_TABLE_TYPE = 'main.Album';
const CUSTOMER_TABLE_TYPE = 'main.Customer';

test.describe('J1 — first useful result (the null-action path)', () => {
  test('open the demo project, open Album, rows render and the agent log shows the request', async ({
    agentServer,
    page,
  }) => {
    const projectUrl = `/store/${agentServer.storeId}/project/${DEMO_PROJECT_ID}`;

    // "the browser opens the demo project" — real navigation, no interception.
    await page.goto(projectUrl);
    // "the project appears with nobody doing anything else": the title comes
    // from `GET /datatug/projects/project_summary` and is bound to the VALUE
    // of the read-only Title `ion-input` (project-page.component.html) — so
    // assert that textbox's value. `getByText` can never see an input's value
    // and stayed at 0 matches even once the page rendered, so it failed the
    // same way for a rendered and an unrendered page. Needs the agent side's
    // auth-hook fix (datatug/datatug-cli#205, merged). The title renders
    // with or without datatug/datatug-apps#69; what #69 removes is the
    // uncaught `unknown store: <host:port>` the page's folder child threw
    // out of ngOnChanges on every visit (console ERROR, Boards card stuck
    // loading).
    await expect(
      page
        .locator('ion-item', { hasText: 'Title' })
        .first()
        .getByRole('textbox'),
    ).toHaveValue('DataTug Demo Project 1', { timeout: 15_000 });

    // "the user clicks Album": EnvDbPageComponent's row-click handler
    // (libs/datatug/main/src/lib/pages/signed-in/env-db/env-db-page.component.ts)
    // and the `goTable()` URL it drove (services/nav/datatug-nav.service.ts)
    // were both fixed by this stream (S9b deliverable 3 — see
    // env-db-page.component.spec.ts / datatug-nav.service.spec.ts for the
    // unit coverage), so a real click-through would work now. This test
    // still navigates to the table URL directly rather than switching to a
    // click, to keep proving the grid-render/agent-contract mechanism below
    // independent of that page's own (now separately covered) navigation
    // behaviour.
    const albumTableUrl =
      `${projectUrl}/env/${DEMO_ENV_ID}/db/${DEMO_DB_CATALOG_ID}` +
      `/table/${ALBUM_TABLE_TYPE}`;
    await page.goto(albumTableUrl);

    // "rows render in the grid" — @sneat/datagrid renders rows as Tabulator
    // does, via the stable `.tabulator-row` class.
    await expect(page.locator('.tabulator-row').first()).toBeVisible({
      timeout: 15_000,
    });
    expect(await page.locator('.tabulator-row').count()).toBeGreaterThan(0);

    // "the agent log shows the select request under /datatug/" — mechanism,
    // not just outcome (AC:first-result-two-clicks, REQ:agent-path-contract).
    // pkg/server/http_server.go's logWrapper prints `<Method> <Len> <RequestURI>`
    // for every request except /agent-info.
    await expect
      .poll(() => agentServer.readLog(), { timeout: 15_000 })
      .toMatch(/\/datatug\//);
  });
});

test.describe('J2 — from a value to related knowledge', () => {
  test('clicking a CustomerId cell shows related records and applicable queries, running one binds the parameter', async ({
    agentServer,
    page,
  }) => {
    const projectUrl = `/store/${agentServer.storeId}/project/${DEMO_PROJECT_ID}`;
    const customerTableUrl =
      `${projectUrl}/env/${DEMO_ENV_ID}/db/${DEMO_DB_CATALOG_ID}` +
      `/table/${CUSTOMER_TABLE_TYPE}`;

    // "the user opens the Customer table" — same already-correct contract
    // route J1 uses (see its comment on why: EnvDbPageComponent's row-click
    // -> table-page navigation is exercised separately, not by this test).
    await page.goto(customerTableUrl);
    // EXPECTED TO FAIL here right now (file header, blocker 2): this page's
    // EnvDbTablePageComponent.loadData() needs `this.project`, populated
    // from DatatugNavContextService's project tracking, which itself needs a
    // project-loading call that panics server-side on datatug-cli main — so
    // the grid never renders any row to click. Once blocker 2 is fixed, this
    // gates on blocker 1 below instead.
    await expect(page.locator('.tabulator-row').first()).toBeVisible({
      timeout: 15_000,
    });

    // "the user clicks a CustomerId cell" — EnvDbTablePageComponent.onGridRowClick
    // (this stream) recovers the clicked column via Tabulator's
    // `tabulator-field` attribute and looks it up in `semanticColumns()`, which
    // is populated only from `GET /datatug/semantic/columns`
    // (loadSemanticColumns()). That route does not exist on datatug-cli main
    // yet, so the lookup never finds a mapping and `selection` never gets set
    // — the context panel never opens, blocking here once the row above
    // renders. Once /datatug/semantic/columns exists, everything below is
    // the real, unmocked check of this stream's wiring.
    const cell = page
      .locator('.tabulator-row')
      .first()
      .locator('[tabulator-field="CustomerId"]');
    await expect(cell).toBeVisible({ timeout: 15_000 });
    const customerId = (await cell.textContent())?.trim();
    await cell.click();

    await expect(page.locator('sneat-datatug-context-panel')).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText(`Customer.ID = ${customerId}`, { exact: false }),
    ).toBeVisible({ timeout: 10_000 });

    // "related records" and "applicable queries" — POST /datatug/semantic/related
    // and POST /datatug/queries/applicable (ContextPanelComponent.load()); also
    // not implemented server-side yet. Candidate items render by
    // `queryId`, not title (context-panel.component.html), so this looks for
    // the saved-query ids under datatug-demo-projects/.../queries/customers/.
    await expect(
      page.getByText('customer-invoices', { exact: false }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText('customer-purchases-by-genre', { exact: false }),
    ).toBeVisible({ timeout: 10_000 });

    // "running one binds the parameter" — click through to the query page
    // (EnvDbTablePageComponent.onOpenQuery) and run it.
    await page.getByText('customer-invoices', { exact: false }).click();
    await expect(
      page
        .getByText('Customer.ID', { exact: false })
        .getByText('from selection', {
          exact: false,
        }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByText('Run query', { exact: false }).click();
    await expect
      .poll(() => agentServer.readLog(), { timeout: 15_000 })
      .toMatch(/\/datatug\/exec\/run_query/);
  });
});

test.describe('J3 — carrying context', () => {
  test('adding a value to the Investigation Context binds it on another query; disabling the chip clears it', async ({
    agentServer,
    page,
  }) => {
    const projectUrl = `/store/${agentServer.storeId}/project/${DEMO_PROJECT_ID}`;
    const customerTableUrl =
      `${projectUrl}/env/${DEMO_ENV_ID}/db/${DEMO_DB_CATALOG_ID}` +
      `/table/${CUSTOMER_TABLE_TYPE}`;

    await page.goto(customerTableUrl);
    // EXPECTED TO FAIL here right now — same blocker 2 as J2 (file header):
    // the grid never renders a row to click. Once that's fixed, this gates
    // on the same GET /datatug/semantic/columns gap J2 hits next.
    await expect(page.locator('.tabulator-row').first()).toBeVisible({
      timeout: 15_000,
    });

    // "select Customer.ID = 5, click Add to context" — same
    // /datatug/semantic/columns blocker as J2 (its own comment above).
    // Unlike J2, everything *after* this point (the Investigation Context
    // bar/service, and a query page binding a parameter "from context") is
    // pure client-side state — no further server contract is needed once
    // semantic/columns exists.
    const cell = page
      .locator('.tabulator-row')
      .first()
      .locator('[tabulator-field="CustomerId"]');
    await expect(cell).toBeVisible({ timeout: 15_000 });
    await cell.click();
    await expect(page.locator('sneat-datatug-context-panel')).toBeVisible({
      timeout: 15_000,
    });
    await page.getByText('Add to context', { exact: false }).click();

    // REQ:context-basket — visible on every project screen via
    // ProjectMenuTopComponent -> InvestigationContextBarComponent.
    await expect(
      page.locator('sneat-datatug-investigation-context-bar'),
    ).toContainText(/Customer\.ID/, { timeout: 10_000 });

    // Open the saved query "Customer purchases by genre" and assert its
    // Customer.ID parameter is bound "from context" (INTEGRATION.md §6 —
    // InvestigationContextService.bindingsFor(), no server call).
    await page.goto(
      `${projectUrl}/query/customer-purchases-by-genre?id=customer-purchases-by-genre`,
    );
    await expect(
      page
        .getByText('Customer.ID', { exact: false })
        .getByText('from context', {
          exact: false,
        }),
    ).toBeVisible({ timeout: 10_000 });

    // S96 — api-contract.md "Binding and context behavior": "The user can clear a
    // value; a cleared required value blocks Run until supplied." `CustomerId` is
    // `isRequired: true` on this query
    // (datatug-demo-projects/demo-project-1/queries/customers/customer-purchases-by-genre.query.json),
    // so emptying its binding must NOT read as "No parameters bound from selection or
    // context" — that wording is only correct for an optional parameter or an empty
    // parameter list (query-page.component.html: the "required — no value supplied"
    // branch is a *member* of `visibleBindings()`, not absent from it). The original
    // version of this test asserted the optional-parameter wording against this
    // required parameter and would have stayed green even if Run were left silently
    // enabled with no value — checking `runButton` state directly closes that gap.
    // `ion-button`'s own [disabled] Input reflects to a boolean `disabled` attribute
    // on the host element, but the host is not a native form control — Playwright's
    // toBeDisabled()/toBeEnabled() match `:disabled`, which only native form elements
    // ever satisfy, so they misreport an `ion-button` regardless of its actual state.
    // The `disabled` attribute's presence/absence on the host is the reliable signal.
    const runButton = page.locator('ion-button', { hasText: 'Run query' });
    await expect(runButton).not.toHaveAttribute('disabled');

    // AC:context-carries's own wording — "disabling the chip empties it" — names the
    // Investigation Context bar's chip (InvestigationContextBarComponent, reachable
    // from every project screen via the persistent project menu, REQ:context-basket:
    // "Temporarily enables/disables a value without removing it"), a *different*,
    // global mechanism from the query page's own page-local "Clear this binding"
    // button exercised below (REQ:parameter-auto-binding). Clicking the chip's label
    // (not its "×" remove icon) toggles InvestigationContextService.setEnabled(id,
    // false); the query page's own binding effect (constructor, reads
    // investigationContext.items()) picks that up reactively with no server call.
    const contextChip = page
      .locator('sneat-datatug-investigation-context-bar')
      .getByText('Customer.ID', { exact: false });
    await contextChip.click();
    await expect(
      page
        .getByText('Customer.ID', { exact: false })
        .getByText('required', { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(runButton).toHaveAttribute('disabled', '');

    // Disabling is not removing (REQ:context-basket) — re-enabling the same chip
    // restores the "from context" binding.
    await contextChip.click();
    await expect(
      page
        .getByText('Customer.ID', { exact: false })
        .getByText('from context', { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(runButton).not.toHaveAttribute('disabled');

    // The query page's own "Clear this binding" button (REQ:parameter-auto-binding:
    // "The user MUST be able to clear or override a bound value before running") —
    // a page-local override, independent of the global context chip above.
    await page.getByTitle('Clear this binding').click();
    await expect(
      page
        .getByText('Customer.ID', { exact: false })
        .getByText('required', { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(runButton).toHaveAttribute('disabled', '');
  });
});

test.describe('J4 — restricted principal', () => {
  test.fixme('`datatug serve --as support` filters rows, hides Email, and states the limitation', async () => {
    // TODO (plan task 10, after task 6 lands). Needs its own agentServer
    // started with `--as support` rather than `--as admin` — not simply
    // reusable from the shared worker-scoped fixture above — see AC
    // restricted-rows-and-columns, hidden-column-refused.
    // 1. Run "Customer invoices" for a Brazilian customer (Customer.ID
    //    outside Canada) -> 0 rows, limitation header states
    //    "customers-support: rows filtered".
    // 2. Run it for a Canadian customer -> rows render without the Email
    //    column; header states "1 column hidden".
    // 3. A hand-crafted request selecting Email is refused with
    //    ACCESS_DENIED naming policy customers-support, no row data.
  });
});
