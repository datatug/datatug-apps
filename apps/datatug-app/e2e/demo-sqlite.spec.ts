import { BrowserContext, expect, Locator, Page, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installFakeGithub } from './helpers/fake-github';
import { installPinnedChinookSqlite } from './helpers/pinned-chinook-sqlite';

/**
 * /demo/sqlite/<dataset>: "Explore SQLite in DataTug". A pinned SQLite file from demodb.dev opens as an editable
 * copy in the browser: downloaded and verified by a dataset worker, kept in the origin private file system (OPFS)
 * and shared by every tab through one leader. These tests drive the real BUILT app (see
 * playwright.demo-sqlite.config.ts) in a real browser against the real demodb.dev files: the worker, SQLite WASM,
 * OPFS, Web Locks and the in-process OVDB server are all real. The edited-copy Board to Query case serves the
 * exact hash-pinned Chinook bytes at its admitted public URL; the other cases keep their live DemoDB reads.
 * Only the third-party hosts the app also talks to (error reporting, analytics) are cut off.
 *
 * WebKit under Playwright has no OPFS in its default (ephemeral) context. There the persistence journey is
 * replaced by the in-memory behaviour the page promises for that case: the warning banner, edits that work, and
 * edits that are gone after a reload. `hasOpfs` decides, in the browser under test, which of the two applies.
 *
 * Needs the network (chinook.demodb.dev). The full AdventureWorks download (126.8 MB unpacked, ~35 MB on the
 * wire) runs only with DATATUG_E2E_ADVENTUREWORKS=1.
 */

const DEMODB = /(^|\.)demodb\.dev$/;
const SQLITE_ORIGINAL_ARTIST_1 = 'AC/DC';
const ARTIST_WITHOUT_ALBUMS = 'Milton Nascimento & Bebeto'; // ArtistId 25: nothing refers to it

test('an edited local copy runs on a saved Board card and ordinary query page', async ({ page, context }) => {
  test.skip(!process.env['DATATUG_E2E_GITHUB_FAKE'], 'requires the offline demo project checkout');
  const source = process.env['DATATUG_E2E_GITHUB_FAKE'];
  if (!source) return;
  test.setTimeout(180_000);
  const scratch = mkdtempSync(join(tmpdir(), 'datatug-working-copy-'));
  try {
    const checkout = join(scratch, 'project');
    execFileSync('git', ['clone', '--local', '--quiet', source, checkout]);
    const project = join(checkout, 'demo-project-1');
    const boardPath = join(project, 'boards/board1/board.json');
    const board = JSON.parse(readFileSync(boardPath, 'utf8'));
    board.rows[0].cards[0].title = 'Live artist names';
    board.rows[0].cards[0].widget.data.sql.queryId = 'demodb/live-artist-names';
    writeFileSync(boardPath, JSON.stringify(board));
    writeFileSync(join(project, 'queries/demodb/live-artist-names.query.json'), JSON.stringify({
      id: 'live-artist-names', title: 'Live artist names', type: 'DTQL', connectionId: 'chinook-sqlite',
      recordsets: [{ columns: [{ name: 'Name', type: 'string' }] }],
    }));
    writeFileSync(join(project, 'queries/demodb/live-artist-names.query.dtql'),
      'from:\n  name: "Artist"\nlimit: 100\n');
    execFileSync('git', ['-C', checkout, 'add', '-A']);
    execFileSync('git', ['-C', checkout, '-c', 'user.name=E2E', '-c', 'user.email=e2e@example.test',
      'commit', '--quiet', '-m', 'Create saved working copy query']);
    await installFakeGithub(context, [{ fullName: 'datatug/datatug-demo-project', dir: checkout }]);
    await installPinnedChinookSqlite(context, checkout);

    const requests = trackDemodbRequests(context);
    await openDataset(page, 'chinook', 'Artist');
    const edited = 'AC/DC (working copy journey)';
    await editName(page, SQLITE_ORIGINAL_ARTIST_1, edited);
    await page.locator('a.brand-home-link').first().click();
    await page.getByTestId('open-demo-github').click();
    const environment = page.locator('sneat-datatug-menu-env-selector ion-select');
    await expect(environment).toBeVisible();
    await environment.click();
    await page.getByRole('radio', { name: 'dev' }).click();
    await page.locator('sneat-datatug-project-menu-top ion-item', { hasText: 'Boards' }).click();
    await page.getByRole('link', { name: 'Chinook customer insights' }).last().click();
    const card = page.locator('sneat-datatug-board-page ion-card', { hasText: 'Live artist names' });
    await expect(card).toBeVisible();
    const runtime = card.locator('select option').filter({ hasText: 'working copy' });
    await expect(runtime).toHaveCount(1);
    const selectionId = await runtime.getAttribute('value');
    if (!selectionId) throw new Error('The working copy has no runtime selection ID');
    await card.locator('select').selectOption(selectionId);
    await card.getByRole('button', { name: 'Run on board' }).click();
    await expect(card.locator('table tbody')).toContainText(edited, { timeout: 30_000 });
    await expect(card.getByRole('link', { name: 'Open saved query' })).toHaveAttribute('href', new RegExp(`runtime=${selectionId}`));
    await card.getByRole('link', { name: 'Open saved query' }).click();
    await expect(page).toHaveURL(new RegExp(`runtime=${selectionId}`));
    const queryRuntime = page.locator('sneat-datatug-sql-editor select option').filter({ hasText: 'working copy' });
    await expect(queryRuntime).toHaveCount(1);
    await expect(page.locator('sneat-datatug-sql-editor').getByRole('combobox', { name: 'Execution runtime', exact: true }))
      .toHaveValue(selectionId, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Run query', exact: true }).click();
    await expect(page.locator('sneat-datatug-sql-editor .result-grid-viewport')).toContainText(edited, { timeout: 30_000 });
    expect(requests.filter((url) => url.endsWith('/data/chinook.sqlite'))).toHaveLength(1);
    await page.reload();
    await expect(page.locator('sneat-datatug-sql-editor').getByRole('combobox', { name: 'Execution runtime', exact: true }))
      .toHaveValue(selectionId, { timeout: 20_000 });
    await expect(page.locator('sneat-datatug-sql-editor').getByRole('alert'))
      .toContainText('selected working copy is unavailable');
    await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeDisabled();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test.beforeEach(async ({ context, baseURL }) => {
  const own = new URL(baseURL ?? 'http://127.0.0.1').origin;
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === own || DEMODB.test(url.hostname) || url.protocol === 'data:' || url.protocol === 'blob:') {
      return route.continue();
    }
    return route.abort();
  });
});

/** Every request any page or worker of the context makes to demodb.dev. */
function trackDemodbRequests(context: BrowserContext): string[] {
  const urls: string[] = [];
  context.on('request', (request) => {
    if (DEMODB.test(new URL(request.url()).hostname)) urls.push(request.url());
  });
  return urls;
}

/** Whether this browser context gives pages OPFS (asked of the browser itself, on the app's origin). */
async function hasOpfs(page: Page): Promise<boolean> {
  await page.goto('/demo/sqlite');
  await expect(page.getByTestId('demo-sqlite-datasets')).toBeVisible();
  return page.evaluate(async () => {
    try {
      await navigator.storage.getDirectory();
      return true;
    } catch {
      return false;
    }
  });
}

async function openDataset(page: Page, dataset: string, table?: string): Promise<void> {
  await page.goto(`/demo/sqlite/${dataset}${table ? `/table/${table}` : ''}`);
  await expect(page.getByTestId(table ? 'ovdb-rows' : 'ovdb-table-list')).toBeVisible({ timeout: 90_000 });
}

const rows = (page: Page): Locator => page.getByTestId('ovdb-rows').locator('tbody tr');
const rowWith = (page: Page, text: string): Locator => rows(page).filter({ hasText: text });
const nameCell = (page: Page, name: string): Locator => page.getByRole('cell', { name, exact: true });

async function editName(page: Page, from: string, to: string): Promise<void> {
  await rowWith(page, from).first().click();
  await page.getByTestId('record-edit').click();
  await page.getByTestId('record-input-Name').locator('input').fill(to);
  await page.getByTestId('record-save').click();
  await expect(page.getByTestId('record-notice')).toHaveText('Saved.');
  await expect(nameCell(page, to)).toBeVisible();
}

const alert = (page: Page): Locator => page.locator('ion-alert');

async function confirmAlert(page: Page, button: string): Promise<void> {
  await alert(page).getByRole('button', { name: button, exact: true }).click();
  await expect(alert(page)).toHaveCount(0);
}

/** Makes OPFS unusable inside the dataset worker only (the page keeps it), so the open falls back to memory. */
async function hideOpfsFromWorkers(context: BrowserContext): Promise<void> {
  await context.route(/\/worker-[^/]*\.js(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body: `Object.defineProperty(StorageManager.prototype, 'getDirectory', { value: undefined, configurable: true });\n${body}`,
    });
  });
}

/** What the page promises where the copy cannot be kept: a warning, working edits, and no memory of them. */
async function expectMemoryOnlyBehaviour(page: Page): Promise<void> {
  await openDataset(page, 'chinook', 'Artist');
  await expect(page.getByTestId('demo-sqlite-not-persistent')).toContainText('Changes will not be saved in this browser');
  await expect(page.getByTestId('ovdb-status')).toHaveText('Local copy (memory only)');
  await editName(page, SQLITE_ORIGINAL_ARTIST_1, 'AC/DC (memory)');
  await page.reload();
  await expect(page.getByTestId('ovdb-rows')).toBeVisible({ timeout: 90_000 });
  await expect(nameCell(page, SQLITE_ORIGINAL_ARTIST_1)).toBeVisible();
  await expect(nameCell(page, 'AC/DC (memory)')).toHaveCount(0);
}

test.describe('Chinook as a local SQLite copy', () => {
  test('creates a record, rejects a duplicate, and persists until reset', async ({ page }) => {
    test.setTimeout(180_000);
    const persistent = await hasOpfs(page);
    await openDataset(page, 'chinook', 'Genre');
    await page.getByTestId('record-create').click();
    await page.getByTestId('record-input-GenreId').locator('input').fill('901');
    const name = page.getByTestId('record-input-Name').locator('input');
    await expect(name).toBeDisabled();
    await page.getByTestId('record-null-Name').uncheck();
    await expect(name).toBeEnabled();
    await name.fill('Created in browser');
    await page.getByTestId('record-save').click();
    await expect(page.getByTestId('ovdb-record')).toContainText('GenreId 901');
    await expect(nameCell(page, 'Created in browser')).toBeVisible();
    await page.getByTestId('record-create').click();
    await page.getByTestId('record-input-GenreId').locator('input').fill('901');
    await page.getByTestId('record-save').click();
    await expect(page.getByTestId('record-error')).toContainText('already');
    await page.getByTestId('record-cancel').click();
    await page.reload();
    await expect(page.getByTestId('ovdb-rows')).toBeVisible({ timeout: 90_000 });
    if (persistent) await expect(nameCell(page, 'Created in browser')).toBeVisible();
    else await expect(nameCell(page, 'Created in browser')).toHaveCount(0);
    await page.getByTestId('reset-database').click();
    await confirmAlert(page, 'Reset Database');
    await expect(page.getByTestId('reset-message')).toContainText('reset');
    await expect(nameCell(page, 'Created in browser')).toHaveCount(0);
  });

  test('browse, edit, delete and reset all persist across reloads', async ({ page, context }) => {
    test.setTimeout(240_000);
    const demodb = trackDemodbRequests(context);
    if (!(await hasOpfs(page))) {
      test.info().annotations.push({ type: 'mode', description: 'in-memory: this browser context has no OPFS' });
      await expectMemoryOnlyBehaviour(page);
      return;
    }
    test.info().annotations.push({ type: 'mode', description: 'persistent: OPFS' });

    // Open: the local SQLite copy initialises (one download of the pinned file) and lands in the table list.
    await openDataset(page, 'chinook');
    await expect(page.getByTestId('ovdb-status')).toHaveText('Local copy ready');
    await expect(page.getByTestId('demo-sqlite-not-persistent')).toHaveCount(0);
    await expect(page.getByTestId('ovdb-table-list').locator('[data-testid^="table-"]')).toHaveCount(11);
    expect(demodb.some((url) => url.endsWith('/data/chinook.sqlite'))).toBe(true);

    // Open a table and see its records.
    await page.getByTestId('table-Artist').click();
    await expect(page.getByTestId('ovdb-rows')).toBeVisible();
    await expect(nameCell(page, SQLITE_ORIGINAL_ARTIST_1)).toBeVisible();
    expect(await rows(page).count()).toBe(100);

    // A row is reachable and operable from the keyboard.
    const second = rowWith(page, 'Accept').first();
    await second.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('ovdb-record')).toContainText('Accept');
    await page.keyboard.press('Escape');

    // Edit a known record, reload: the edit persisted.
    await editName(page, SQLITE_ORIGINAL_ARTIST_1, 'AC/DC (edited by e2e)');
    await page.reload();
    await expect(page.getByTestId('ovdb-rows')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('ovdb-status')).toHaveText('Local copy ready');
    await expect(nameCell(page, 'AC/DC (edited by e2e)')).toBeVisible();
    await expect(nameCell(page, SQLITE_ORIGINAL_ARTIST_1)).toHaveCount(0);

    // Delete a record nothing depends on (a double click opens one confirmation, not two), reload: it is gone.
    await rowWith(page, ARTIST_WITHOUT_ALBUMS).click();
    await page.getByTestId('record-delete').dblclick();
    await expect(alert(page)).toHaveCount(1);
    await expect(alert(page)).toContainText('Artist ArtistId 25');
    await confirmAlert(page, 'Delete');
    await expect(rowWith(page, ARTIST_WITHOUT_ALBUMS)).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('ovdb-rows')).toBeVisible({ timeout: 90_000 });
    await expect(rowWith(page, ARTIST_WITHOUT_ALBUMS)).toHaveCount(0);
    await expect(nameCell(page, 'AC/DC (edited by e2e)')).toBeVisible();

    // NULL is shown as such, apart from text.
    await openDataset(page, 'chinook', 'Customer');
    const nullCell = page.locator('td[data-cell-kind="null"]').first();
    await expect(nullCell).toHaveText('NULL');
    await expect(nullCell).toHaveCSS('font-style', 'italic');

    // Reset Database warns, and on confirmation restores the canonical data, which survives a reload.
    await openDataset(page, 'chinook', 'Artist');
    await page.getByTestId('reset-database').click();
    await expect(alert(page)).toHaveCount(1);
    await expect(alert(page)).toContainText('All your local changes to Chinook (local SQLite) will be lost');
    await expect(alert(page)).toContainText('cannot be undone');
    await confirmAlert(page, 'Reset Database');
    await expect(page.getByTestId('reset-message')).toContainText('Database reset to the original DemoDB data');
    await expect(nameCell(page, SQLITE_ORIGINAL_ARTIST_1)).toBeVisible();
    await expect(rowWith(page, ARTIST_WITHOUT_ALBUMS)).toHaveCount(1);
    await expect(nameCell(page, 'AC/DC (edited by e2e)')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('ovdb-rows')).toBeVisible({ timeout: 90_000 });
    await expect(nameCell(page, SQLITE_ORIGINAL_ARTIST_1)).toBeVisible();
    await expect(rowWith(page, ARTIST_WITHOUT_ALBUMS)).toHaveCount(1);
    await expect(nameCell(page, 'AC/DC (edited by e2e)')).toHaveCount(0);

    // Reset restored the stored pristine copy: the file was downloaded exactly once, on the first open.
    expect(demodb.filter((url) => url.endsWith('/data/chinook.sqlite'))).toHaveLength(1);
  });

  test('two tabs share one copy: a follower reads and writes, and another tab takes over when the leader closes', async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    test.skip(!(await hasOpfs(page)), 'This browser context has no OPFS, so tabs cannot share a stored copy.');
    const demodb = trackDemodbRequests(context);

    await openDataset(page, 'chinook', 'Artist');
    await expect.poll(() => page.workers().length).toBe(1); // this tab leads: it runs the dataset worker
    const downloadsByLeader = demodb.length;

    const follower = await context.newPage();
    await openDataset(follower, 'chinook', 'Artist');
    expect(follower.workers()).toHaveLength(0); // the follower asks the leader
    expect(demodb).toHaveLength(downloadsByLeader); // and downloads nothing

    // The follower writes; the leader sees it.
    await editName(follower, 'Accept', 'Accept (follower edit)');
    await page.getByRole('link', { name: 'All tables' }).click();
    await page.getByTestId('table-Artist').click();
    await expect(nameCell(page, 'Accept (follower edit)')).toBeVisible();

    // The leader closes; the follower takes over and keeps working on the same data.
    await page.close();
    await expect.poll(() => follower.workers().length, { timeout: 30_000 }).toBe(1);
    await editName(follower, 'Aerosmith', 'Aerosmith (after takeover)');
    await follower.reload();
    await expect(follower.getByTestId('ovdb-rows')).toBeVisible({ timeout: 90_000 });
    await expect(nameCell(follower, 'Accept (follower edit)')).toBeVisible();
    await expect(nameCell(follower, 'Aerosmith (after takeover)')).toBeVisible();
    expect(demodb).toHaveLength(downloadsByLeader);
  });

  test('where the copy cannot be kept it opens in memory, says so, and forgets edits on reload', async ({ page, context }) => {
    test.setTimeout(240_000);
    await hideOpfsFromWorkers(context);
    await expectMemoryOnlyBehaviour(page);
  });
});

test.describe('AdventureWorks', () => {
  test('asks before downloading, and requests nothing from demodb.dev until Continue', async ({ page, context }) => {
    const demodb = trackDemodbRequests(context);
    const opfs = await hasOpfs(page);
    await page.goto('/demo/sqlite/adventureworks');
    if (!opfs) {
      // Without OPFS a large dataset is refused before any download (it must never run from memory).
      await expect(page.getByTestId('demo-sqlite-unsupported')).toContainText('regular desktop browser window');
      await page.waitForTimeout(1500);
      expect(demodb).toEqual([]);
      return;
    }
    const confirm = page.getByTestId('demo-sqlite-confirm-large');
    await expect(confirm).toBeVisible();
    const figures = (await page.getByTestId('demo-sqlite-confirm-figures').innerText()).replace(/\s+/g, ' ');
    expect(figures).toContain('downloads ~35.4 MB (compressed in transit; 126.8 MB once unpacked)');
    expect(figures).toContain('uses ~126.8 MB of browser storage (one working copy)');
    expect(figures).toContain('Reset Database downloads it again');
    await page.waitForTimeout(1500);
    expect(demodb).toEqual([]);

    // Cancel leaves without downloading anything either.
    await page.getByTestId('demo-sqlite-cancel').click();
    await expect(page).toHaveURL(/\/demo\/sqlite$/);
    await expect(page.getByTestId('demo-sqlite-datasets')).toBeVisible();
    expect(demodb).toEqual([]);
  });

  test('is refused when the browser reports too little storage, with nothing downloaded', async ({ page, context }) => {
    const demodb = trackDemodbRequests(context);
    await page.addInitScript(() => {
      Object.defineProperty(StorageManager.prototype, 'estimate', {
        value: async () => ({ quota: 50_000_000, usage: 0 }),
        configurable: true,
      });
    });
    await page.goto('/demo/sqlite/adventureworks');
    const refusal = page.getByTestId('demo-sqlite-no-storage');
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText('needs ~126.8 MB');
    await expect(refusal).toContainText('~50.0 MB available');
    await expect(page.getByTestId('dataset-chinook')).toBeVisible();
    await page.waitForTimeout(1500);
    expect(demodb).toEqual([]);
  });

  test('downloads, installs and browses after Continue; a reload opens it without asking or downloading', async ({
    page,
    context,
  }) => {
    test.skip(!process.env['DATATUG_E2E_ADVENTUREWORKS'], 'Set DATATUG_E2E_ADVENTUREWORKS=1 to download the 126.8 MB dataset.');
    test.setTimeout(600_000);
    const demodb = trackDemodbRequests(context);
    test.skip(!(await hasOpfs(page)), 'AdventureWorks needs OPFS.');
    await page.goto('/demo/sqlite/adventureworks');
    await page.getByTestId('demo-sqlite-continue').click();
    await expect(page.getByTestId('demo-sqlite-progress')).toContainText('(unpacked size)', { timeout: 120_000 });
    await expect(page.getByTestId('ovdb-table-list')).toBeVisible({ timeout: 480_000 });
    await expect(page.getByTestId('ovdb-status')).toHaveText('Local copy ready');
    const downloaded = demodb.length;
    expect(downloaded).toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByTestId('ovdb-table-list')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('demo-sqlite-confirm-large')).toHaveCount(0);
    expect(demodb).toHaveLength(downloaded);
  });
});

test('sqlite3.wasm is served as application/wasm', async ({ request }) => {
  const response = await request.get('/sqlite3.wasm');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/wasm');
  const bytes = await response.body();
  expect([...bytes.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]); // "\0asm": not the SPA's index.html
});
