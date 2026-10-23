import { createHash } from 'node:crypto';
import { APIRequestContext, Locator } from '@playwright/test';
import {
  DEMODB_HOST,
  DEMODB_LIVE,
  expect,
  test,
  type DemodbGuard,
} from './helpers/demodb-guard';
import { hasOpfs, trackDemodbRequests } from './helpers/demo-sqlite';
// The catalog is plain TypeScript with no Angular imports; the lib's barrel would pull the whole app into Playwright.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  demoSqliteCatalog,
  demoSqliteDatasetIds,
  isLargeDemoSqliteDataset,
  type DemoSqliteCatalogEntry,
} from '../../../libs/datatug/main/src/lib/queries/demo-sqlite-catalog';

/**
 * One smoke journey for EVERY dataset in the DataTug catalog (demoSqliteDatasetIds), driven by the catalog and
 * by DemoDB's own published registry (https://demodb.dev/corpus.json), so a dataset added to either is covered
 * without editing this file:
 *
 *  - registry agreement: the DemoDB registry and the DataTug catalog list the same datasets with the same file
 *    URL, SHA-256 and size (a mismatch fails here, naming the dataset and the field);
 *  - availability: the pinned file is served live and is the pinned bytes (AdventureWorks: HEAD only, unless
 *    DATATUG_E2E_ADVENTUREWORKS=1);
 *  - the advertised complete-database downloads of the dataset all answer;
 *  - the browser journey: local SQLite initialises, the table list is the registry's, a row of a table can be
 *    read, edit/delete/reset are offered, an edit survives a reload and Reset restores the original, with the
 *    in-memory behaviour asserted instead where the browser context has no OPFS (WebKit default).
 *
 * Fixture mode (the default) answers every demodb.dev request from the local, SHA-256 verified fixtures
 * (helpers/demodb-guard.ts), so the run needs no network and sends nothing to the live hosts. The checks whose point
 * is the live site (the large file's HEAD, the advertised downloads answering) run only with DEMODB_E2E_MODE=live
 * (the manual "DemoDB live smoke" workflow). The 126.8 MB AdventureWorks journey (a download, then a second one for Reset)
 * runs only with DATATUG_E2E_ADVENTUREWORKS=1; set DEMODB_CORPUS_URL to read a different registry.
 */

const DEMODB = DEMODB_HOST;
const CORPUS_URL =
  process.env['DEMODB_CORPUS_URL'] || 'https://demodb.dev/corpus.json';
const RUN_ADVENTUREWORKS = !!process.env['DATATUG_E2E_ADVENTUREWORKS'];

interface CorpusColumn {
  name: string;
  type: string;
  primaryKey?: boolean;
}
interface CorpusRecordset {
  name: string;
  kind: 'table' | 'view';
  rowCount: number | null;
  columns: CorpusColumn[];
}
interface CorpusExport {
  format: string;
  url?: string;
  table?: string | null;
  bytes?: number | null;
  sha256?: string | null;
  decodedBytes?: number | null;
  decodedSha256?: string | null;
}
interface CorpusDatabase {
  localId: string;
  recordsets: CorpusRecordset[];
  exports: CorpusExport[];
}

let corpusPromise: Promise<CorpusDatabase[]> | undefined;
/** DemoDB's published registry, read once per worker process (from the fixture, or live exactly once in live mode). */
function loadCorpus(
  guard: DemodbGuard,
  request: APIRequestContext,
): Promise<CorpusDatabase[]> {
  corpusPromise ??= guard.get(request, CORPUS_URL).then((response) => {
    if (response.status !== 200)
      throw new Error(`${CORPUS_URL}: HTTP ${response.status}`);
    return (JSON.parse(response.body.toString('utf8')) as { databases: CorpusDatabase[] })
      .databases;
  });
  return corpusPromise;
}

const sqliteExport = (db: CorpusDatabase): CorpusExport | undefined =>
  db.exports.find((file) => file.format === 'sqlite' && !file.table);

// The dataset matrix runs in Chromium only. What differs between browsers is the storage path (OPFS or memory),
// and demo-sqlite.spec.ts drives both in all three; a dataset's tables and rows do not depend on the browser.
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'per-dataset coverage is browser-independent; demo-sqlite.spec.ts covers each browser',
);

test.beforeEach(async ({ context, baseURL }) => {
  const own = new URL(baseURL ?? 'http://127.0.0.1').origin;
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    // demodb.dev requests fall through to the guard in helpers/demodb-guard.ts (local fixtures by default).
    if (DEMODB.test(url.hostname)) return route.fallback();
    if (
      url.origin === own ||
      url.protocol === 'data:' ||
      url.protocol === 'blob:'
    ) {
      return route.continue();
    }
    return route.abort();
  });
});

test.describe('DemoDB registry and DataTug catalog', () => {
  test('list the same datasets with the same SQLite file, SHA-256 and size', async ({
    request,
    demodbGuard,
  }) => {
    const corpus = await loadCorpus(demodbGuard, request);
    const registryIds = corpus.map((db) => db.localId).sort();
    expect(
      registryIds,
      'DemoDB registry datasets vs DataTug catalog datasets',
    ).toEqual([...demoSqliteDatasetIds].sort());
    for (const db of corpus) {
      const entry =
        demoSqliteCatalog[db.localId as keyof typeof demoSqliteCatalog];
      const file = sqliteExport(db);
      expect(
        file,
        `${db.localId}: the registry advertises a complete SQLite file`,
      ).toBeTruthy();
      expect({
        dataset: db.localId,
        url: file?.url,
        sha256: file?.decodedSha256 ?? file?.sha256,
        bytes: file?.decodedBytes ?? file?.bytes,
        transferBytes: file?.bytes,
      }).toEqual({
        dataset: db.localId,
        url: entry.url,
        sha256: entry.sha256,
        bytes: entry.bytes,
        transferBytes: entry.transferBytes,
      });
    }
  });
});

for (const id of demoSqliteDatasetIds) {
  const entry: DemoSqliteCatalogEntry = demoSqliteCatalog[id];
  const large = isLargeDemoSqliteDataset(entry);

  test.describe(`dataset ${id}`, () => {
    test('the pinned SQLite file is served live and is the pinned file', async ({
      request,
      demodbGuard,
    }) => {
      if (large) {
        test.skip(
          !DEMODB_LIVE,
          'The 126.8 MB file is not fixtured; its HEAD runs only in live mode (DEMODB_E2E_MODE=live).',
        );
        // Not downloaded here (126.8 MB): the server must answer, name the gzip it sends, and (when it reports
        // a length) report the pinned transfer size. The full file is checked by the opt-in browser journey.
        const response = await demodbGuard.head(request, entry.url);
        expect(response.status).toBe(200);
        const length = response.headers['content-length'];
        if (length) expect(Number(length)).toBe(entry.transferBytes);
        return;
      }
      const response = await demodbGuard.get(request, entry.url);
      expect(response.status).toBe(200);
      const body = response.body;
      expect(body.length).toBe(entry.bytes);
      expect(createHash('sha256').update(body).digest('hex')).toBe(
        entry.sha256,
      );
      expect(body.subarray(0, 16).toString('latin1')).toBe('SQLite format 3\0');
    });

    test('every complete-database download DemoDB advertises answers', async ({
      request,
      demodbGuard,
    }) => {
      test.skip(
        !DEMODB_LIVE,
        'Probes every advertised download on the live hosts; runs only in live mode (DEMODB_E2E_MODE=live).',
      );
      const db = (await loadCorpus(demodbGuard, request)).find(
        (candidate) => candidate.localId === id,
      );
      expect(db, `${id} is in the DemoDB registry`).toBeTruthy();
      if (!db) throw new Error(`${id} is missing from the DemoDB registry`);
      const downloads = db.exports.filter(
        (file): file is CorpusExport & { url: string } =>
          !file.table && file.format !== 'metadata' && typeof file.url === 'string' && file.url.length > 0,
      );
      expect(downloads.map((file) => file.format)).toContain('sqlite');
      for (const file of downloads) {
        const response = await demodbGuard.head(request, file.url);
        expect(response.status, `${file.format}: ${file.url}`).toBe(200);
      }
    });

    test('opens as a local SQLite copy, reads a row, offers edit/delete/reset, and keeps and resets an edit', async ({
      page,
      context,
      request,
      demodbGuard,
    }) => {
      test.skip(
        large && !RUN_ADVENTUREWORKS,
        'Set DATATUG_E2E_ADVENTUREWORKS=1 (live mode) to download the 126.8 MB dataset (twice: open, then Reset). The hermetic fixture-served journey is demo-sqlite-adventureworks.spec.ts.',
      );
      test.setTimeout(large ? 1_200_000 : 240_000);
      const loadTimeout = large ? 600_000 : 90_000;
      const db = (await loadCorpus(demodbGuard, request)).find(
        (candidate) => candidate.localId === id,
      );
      if (!db) throw new Error(`${id} is missing from the DemoDB registry`);
      const demodb = trackDemodbRequests(context);
      const persistent = await hasOpfs(page);
      test.skip(
        large && !persistent,
        'AdventureWorks needs OPFS (it is refused, not run from memory, without it).',
      );
      test
        .info()
        .annotations.push({
          type: 'mode',
          description: persistent ? 'persistent: OPFS' : 'in-memory: no OPFS',
        });
      const started = Date.now();

      // 1. Open: the local SQLite copy initialises and lands in the table list.
      await page.goto(`/demo/sqlite/${id}`);
      if (large) {
        await expect(
          page.getByTestId('demo-sqlite-confirm-large'),
        ).toBeVisible();
        await page.getByTestId('demo-sqlite-continue').click();
      }
      await expect(page.getByTestId('ovdb-table-list')).toBeVisible({
        timeout: loadTimeout,
      });
      const openedAfter = Date.now() - started;
      test
        .info()
        .annotations.push({
          type: 'open-ms',
          description: String(openedAfter),
        });
      await expect(page.getByTestId('ovdb-status')).toHaveText(
        persistent ? 'Local copy ready' : 'Local copy (memory only)',
      );
      if (persistent)
        await expect(
          page.getByTestId('demo-sqlite-not-persistent'),
        ).toHaveCount(0);
      else
        await expect(
          page.getByTestId('demo-sqlite-not-persistent'),
        ).toContainText('Changes will not be saved in this browser');
      expect(demodb.some((url) => url === entry.url)).toBe(true);

      // 2. The table list is the registry's list of tables (the browser lists base tables; views are not browsable).
      const listed = (
        await page
          .getByTestId('ovdb-table-list')
          .locator('[data-testid^="table-"]')
          .evaluateAll((items) =>
            items.map((item) => {
              const testId = item.getAttribute('data-testid');
              if (testId === null) throw new Error('Table-list item is missing data-testid');
              return testId.slice('table-'.length);
            }),
          )
      ).sort();
      expect(listed).toEqual(
        db.recordsets
          .filter((recordset) => recordset.kind === 'table')
          .map((recordset) => recordset.name)
          .sort(),
      );

      // 3. Capabilities of a local SQLite copy: editable, resettable.
      await expect(page.getByTestId('ovdb-database-header')).toContainText(
        'editable',
      );
      await expect(page.getByTestId('source-menu')).toBeVisible(); // Reset Database sits in its menu

      // 4. Open the first table that has rows, a primary key and a text column: read a row.
      const target = db.recordsets.find(
        (recordset) =>
          recordset.kind === 'table' &&
          (recordset.rowCount ?? 0) > 0 &&
          recordset.columns.some((column) => column.primaryKey) &&
          recordset.columns.some(
            (column) => !column.primaryKey && /CHAR|TEXT/i.test(column.type),
          ),
      );
      expect(
        target,
        `${id} has a table that can be edited by the smoke test`,
      ).toBeTruthy();
      if (!target) throw new Error(`${id} has no editable table`);
      const editableColumn = target.columns.find(
        (column) => !column.primaryKey && /CHAR|TEXT/i.test(column.type),
      );
      if (!editableColumn) throw new Error(`${id}/${target.name} has no editable text column`);
      const editedColumn = editableColumn.name;
      await page.getByTestId(`table-${target.name}`).click();
      await expect(page.getByTestId('ovdb-rows')).toBeVisible({
        timeout: 60_000,
      });
      const rows = page.getByTestId('ovdb-rows').locator('tbody tr');
      if (target.rowCount == null) throw new Error(`${id}/${target.name} has no row count`);
      expect(await rows.count()).toBe(Math.min(target.rowCount, 100));
      const headers = await page
        .getByTestId('ovdb-rows')
        .locator('thead th')
        .allInnerTexts();
      const cellOfFirstRow = (): Locator =>
        rows.first().locator('td').nth(headers.indexOf(editedColumn));
      expect(headers).toContain(editedColumn);
      const original = await cellOfFirstRow().innerText();

      // 5. A row opens with Edit and Delete offered (Delete is not used here; the Chinook journey does that).
      await rows.first().click();
      await expect(page.getByTestId('record-edit')).toBeEnabled();
      await expect(page.getByTestId('record-delete')).toBeEnabled();

      // 6. Edit it.
      const edited = `e2e-${id}-edit`;
      await page.getByTestId('record-edit').click();
      await page
        .getByTestId(`record-input-${editedColumn}`)
        .locator('input')
        .fill(edited);
      await page.getByTestId('record-save').click();
      await expect(page.getByTestId('record-notice')).toHaveText('Saved.');
      await expect(cellOfFirstRow()).toHaveText(edited);

      // 7. Reload: kept where OPFS keeps it, forgotten in memory.
      await page.reload();
      await expect(page.getByTestId('ovdb-rows')).toBeVisible({
        timeout: loadTimeout,
      });
      if (persistent) {
        await expect(cellOfFirstRow()).toHaveText(edited);
        // 8. Reset restores the original data, and that survives a reload.
        await page.getByTestId('source-menu').click();
        await page.getByTestId('reset-database').click();
        const alert = page.locator('ion-alert');
        await expect(alert).toHaveCount(1);
        await expect(alert).toContainText('All your local changes to');
        await alert
          .getByRole('button', { name: 'Reset Database', exact: true })
          .click();
        await expect(alert).toHaveCount(0);
        await expect(page.getByTestId('reset-message')).toContainText(
          'Database reset to the original DemoDB data',
          { timeout: loadTimeout },
        );
        await expect(cellOfFirstRow()).toHaveText(original);
        await page.reload();
        await expect(page.getByTestId('ovdb-rows')).toBeVisible({
          timeout: loadTimeout,
        });
        await expect(cellOfFirstRow()).toHaveText(original);
      } else {
        await expect(cellOfFirstRow()).toHaveText(original);
      }
      test
        .info()
        .annotations.push({
          type: 'total-ms',
          description: String(Date.now() - started),
        });
    });
  });
}
