import { expect, test } from './fixtures/agent-server';

/**
 * Journey e2e against the REAL `datatug serve` agent — no HTTP route
 * interception (contrast with e2e/root-and-login.spec.ts, which stubs
 * `localhost:8989` on purpose; see hub lesson "an e2e that intercepts the
 * backend never proves the contract").
 *
 * Walks user journeys J1–J4 from Feature core-investigation-loop
 * (datatug/datatug spec/features/core-investigation-loop/README.md). Only
 * J1 is implemented here (Phase 1 plan task 3, AC:journey-harness); J2–J4
 * are `test.fixme` skeletons for plan task 10, which lands after tasks
 * 7–9 (related lookups, applicable queries, context panel, auto-binding)
 * are in.
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

test.describe('J1 — first useful result (the null-action path)', () => {
  test('open the demo project, open Album, rows render and the agent log shows the request', async ({
    agentServer,
    page,
  }) => {
    const projectUrl = `/store/${agentServer.storeId}/project/${DEMO_PROJECT_ID}`;

    // "the browser opens the demo project" — real navigation, no interception.
    await page.goto(projectUrl);
    await expect(
      page.getByText('DataTug Demo Project 1', { exact: false }),
    ).toBeVisible({ timeout: 15_000 });

    // "the user clicks Album": the UI's own click path from here (tables
    // list -> row click -> table page) is currently broken independently of
    // this stream — EnvDbPageComponent's rowClick handler
    // (libs/datatug/main/src/lib/pages/signed-in/env-db/env-db-page.component.ts)
    // builds `['project', '<id>@<storeId>', 'env', ...]`, a URL with no
    // leading "store" segment, so it never matches datatugRoutes
    // (`store/:storeId/project/:projectId/...`). datatug-apps Phase 1 plan
    // task 2 ("make the EnvDbPageComponent route resolve") owns that fix;
    // S2 owns libs/datatug/main for this stream, so it is out of scope
    // here. Until task 2 lands, this test navigates to the equivalent,
    // already-correct contract route directly, so the harness mechanics —
    // and the mechanism assertions below — are provable independently of
    // that unrelated, already-tracked bug. Swap this `goto` for a real
    // click once task 2 lands.
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
  test.fixme(
    'clicking a CustomerId cell shows related records and applicable queries, running one binds the parameter',
    async () => {
      // TODO (plan task 10, after tasks 7-9 land):
      // 1. Open the Customer table, click a CustomerId=5 cell.
      // 2. Assert the context panel shows "Customer.ID = 5" and related
      //    lookups: Invoices (chinook, count 7), Support notes
      //    (support-notes / inGitDB, count 2), Country facts (REST Countries,
      //    HTTP). Assert the rows come from the server (agent log), not a
      //    browser-built query.
      // 3. Assert applicable queries list "Customer invoices" and
      //    "Customer purchases by genre" with resolution chain
      //    "CustomerId -> Customer.ID (declared) -> requires Customer.ID",
      //    and "Invoice lines" under "not yet applicable — needs Invoice.ID".
      // 4. Click "Customer invoices"; assert the query page shows
      //    "Customer.ID · from selection", and a run returns invoices for
      //    customer 5 (mechanism: agent log for the run_query request).
    },
  );
});

test.describe('J3 — carrying context', () => {
  test.fixme(
    'adding a value to the Investigation Context binds it on another query; disabling the chip clears it',
    async () => {
      // TODO (plan task 10, after task 9 lands):
      // 1. Select Customer.ID = 5, click "Add to context".
      // 2. Open the saved query "Customer purchases by genre" from the
      //    queries list; assert its Customer.ID parameter shows a chip
      //    bound "from context".
      // 3. Disable the chip; assert the parameter empties and the run
      //    button requires a value before running (REQ:no-hidden-filters —
      //    a query must never be silently constrained by context).
      // 4. Run it; assert the results header lists the bindings applied.
    },
  );
});

test.describe('J4 — restricted principal', () => {
  test.fixme(
    '`datatug serve --as support` filters rows, hides Email, and states the limitation',
    async () => {
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
    },
  );
});
