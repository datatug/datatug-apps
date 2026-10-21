import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { expect as baseExpect, Locator, Page } from '@playwright/test';
import { DEMODB_LIVE, expect, fixtureDir, test } from './helpers/demodb-guard';
import { hasOpfs, trackDemodbRequests } from './helpers/demo-sqlite';
// The catalog is plain TypeScript with no Angular imports; the lib's barrel would pull the whole app into Playwright.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { demoSqliteCatalog } from '../../../libs/datatug/main/src/lib/queries/demo-sqlite-catalog';

/**
 * The AdventureWorks in-browser journey, end to end and hermetic (lane: playwright.demo-sqlite-adventureworks.config.ts):
 *
 *   0. the fixture is what the catalog pins: manifest (`demodb-chunked-export/v1`) -> gzip parts -> joined gzip -> unpacked
 *      file, size and SHA-256 equal to demo-sqlite-catalog.ts (checked here again, independently of the fetch script)
 *   1. /demo/sqlite/adventureworks asks before it downloads (large dataset), and has requested nothing yet
 *   2. Continue: the app downloads manifest + 2 parts (each once), verifies and stores the file; the table list appears
 *   3. the file stored in the browser (OPFS) is byte for byte the pinned file (hashed inside the page)
 *   4. read a table: the first rows of the first table that has rows, a primary key and a text column
 *   5. edit a row (capability gated: "editable" header, Edit enabled), reload, the edit is still there
 *   6. Reset Database with its confirmation: the single-copy dataset is downloaded again (manifest + 2 parts), the original
 *      value is back, and it stays after a reload
 *
 * Every request for a DemoDB host is answered by the guard's route from the fixtures made by scripts/fetch-demodb-fixtures.mjs
 * (DEMODB_FIXTURE_ADVENTUREWORKS=only; GitHub is the only network source). Anything that reaches the network fails the test
 * (helpers/demodb-guard.ts), and Chromium cannot resolve the DemoDB names at all (helpers/demodb-config.ts). The evidence of a run
 * (timings, bytes, row counts, requests) is attached to the test as `adventureworks-evidence.json` and screenshots.
 */

const entry = demoSqliteCatalog.adventureworks;
const MANIFEST_URL = entry.url;
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

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

function corpusRecordsets(): CorpusRecordset[] {
  const corpus = JSON.parse(readFileSync(join(__dirname, 'fixtures/demodb/corpus.json'), 'utf8')) as {
    databases: { localId: string; recordsets: CorpusRecordset[] }[];
  };
  const db = corpus.databases.find((candidate) => candidate.localId === 'adventureworks');
  if (!db) throw new Error('adventureworks is missing from the committed corpus.json');
  return db.recordsets;
}

/**
 * The OPFS files of the app's origin (path -> size) and, for the one file that holds the database, the SHA-256 of the SQLite bytes.
 * The app stores the database in an opaque file that is one 4096-byte page longer than the SQLite file, so both the whole file and
 * the two windows of the pinned length (first bytes, last bytes) are hashed; `sha256` is the first window that equals `pin`.
 */
async function opfsDatabaseEvidence(
  page: Page,
  bytes: number,
  pin: string,
): Promise<{ files: Record<string, number>; path?: string; storedBytes?: number; window?: string; sha256?: string; windows?: Record<string, string> }> {
  return page.evaluate(
    async ({ expectedBytes, pinned }) => {
      const files: Record<string, number> = {};
      const found: { path: string; handle: FileSystemFileHandle; size: number }[] = [];
      const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for await (const [name, handle] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
          if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`);
          else {
            const file = await (handle as FileSystemFileHandle).getFile();
            files[`${prefix}${name}`] = file.size;
            if (file.size >= expectedBytes) found.push({ path: `${prefix}${name}`, handle: handle as FileSystemFileHandle, size: file.size });
          }
        }
      };
      await walk(await navigator.storage.getDirectory(), '');
      if (found.length !== 1) return { files };
      const buffer = await (await found[0].handle.getFile()).arrayBuffer();
      const hex = async (view: ArrayBuffer): Promise<string> =>
        Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', view)), (byte) => byte.toString(16).padStart(2, '0')).join('');
      const windows: Record<string, string> = {
        'first-bytes': await hex(buffer.slice(0, expectedBytes)),
        'last-bytes': await hex(buffer.slice(buffer.byteLength - expectedBytes)),
      };
      const window = Object.keys(windows).find((name) => windows[name] === pinned);
      return { files, path: found[0].path, storedBytes: found[0].size, windows, window, sha256: window ? pinned : undefined };
    },
    { expectedBytes: bytes, pinned: pin },
  );
}

/**
 * Waits for the success element OR the app's own error state, whichever shows first, so a rejected or corrupt download fails within
 * seconds with the app's error text instead of waiting out the long download timeout and reporting "element not found".
 * `timeout` is only the budget of a real, working download.
 */
async function waitForSuccessOrAppError(success: Locator, failures: Locator[], what: string, timeout: number): Promise<void> {
  const failure = failures.reduce((all, next) => all.or(next));
  await success.or(failure).first().waitFor({ state: 'visible', timeout });
  if (await failure.first().isVisible()) {
    const text = (await failure.first().innerText()).replace(/\s+/g, ' ').trim();
    throw new Error(`${what}: the app reported an error instead of finishing: ${text}`);
  }
}

test('AdventureWorks: download via gzip parts, verify, open, read, edit, reload, Reset to pristine - hermetic', async ({
  page,
  context,
  demodbGuard,
}, testInfo) => {
  test.skip(DEMODB_LIVE, 'This journey is served from the local fixtures; the live site is checked by demodb-live-smoke.yml.');
  test.setTimeout(1_200_000);
  const timings: Record<string, number> = {};
  const evidence: Record<string, unknown> = { catalog: { url: MANIFEST_URL, bytes: entry.bytes, transferBytes: entry.transferBytes, sha256: entry.sha256 } };
  const started = Date.now();
  const mark = (name: string): void => {
    timings[name] = Date.now() - started;
  };
  const shot = async (name: string): Promise<void> => {
    await testInfo.attach(name, { body: await page.screenshot({ fullPage: false }), contentType: 'image/png' });
  };

  // 0. The fixture is the pinned file, checked again here from the manifest as the app will read it.
  const manifestPath = join(fixtureDir(), 'data', 'adventureworks.sqlite.parts.json');
  expect(existsSync(manifestPath), `run: DEMODB_FIXTURE_ADVENTUREWORKS=only node scripts/fetch-demodb-fixtures.mjs (${manifestPath})`).toBe(true);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    format: string;
    file: string;
    compression: string;
    bytes: number;
    sha256: string;
    uncompressedSha256: string | null;
    parts: { path: string; bytes: number; sha256: string }[];
  };
  expect(manifest.format).toBe('demodb-chunked-export/v1');
  expect(manifest.file).toBe('adventureworks.sqlite');
  expect(manifest.compression).toBe('gzip');
  expect(manifest.uncompressedSha256).toBe(entry.sha256);
  const pieces = manifest.parts.map((part) => {
    const bytes = readFileSync(join(fixtureDir(), 'data', part.path));
    expect({ bytes: bytes.length, sha256: sha256(bytes) }, part.path).toEqual({ bytes: part.bytes, sha256: part.sha256 });
    return bytes;
  });
  const gzip = Buffer.concat(pieces);
  expect({ bytes: gzip.length, sha256: sha256(gzip) }).toEqual({ bytes: manifest.bytes, sha256: manifest.sha256 });
  expect(gzip.length).toBe(entry.transferBytes);
  const unpacked = gunzipSync(gzip);
  expect({ bytes: unpacked.length, sha256: sha256(unpacked) }, 'reassembled and unpacked file equals the catalog pin').toEqual({
    bytes: entry.bytes,
    sha256: entry.sha256,
  });
  expect(unpacked.subarray(0, 16).toString('latin1')).toBe('SQLite format 3\0');
  evidence['fixture'] = { parts: manifest.parts, gzipBytes: gzip.length, gzipSha256: manifest.sha256, unpackedBytes: unpacked.length, unpackedSha256: sha256(unpacked) };

  const demodb = trackDemodbRequests(context);
  const persistent = await hasOpfs(page);
  test.skip(!persistent, 'AdventureWorks needs OPFS (it is refused, not run from memory, without it).');
  const partUrls = manifest.parts.map((part) => new URL(part.path, MANIFEST_URL).href);
  const expectedOneDownload = [MANIFEST_URL, ...partUrls];

  // 1. Asks first; nothing requested yet.
  await page.goto('/demo/sqlite/adventureworks');
  await expect(page.getByTestId('demo-sqlite-confirm-large')).toBeVisible();
  const figures = (await page.getByTestId('demo-sqlite-confirm-figures').innerText()).replace(/\s+/g, ' ');
  expect(figures).toContain('downloads ~35.4 MB (compressed in transit; 126.8 MB once unpacked)');
  expect(figures).toContain('uses ~126.8 MB of browser storage (one working copy)');
  expect(figures).toContain('Reset Database downloads it again');
  evidence['confirmFigures'] = figures;
  await page.waitForTimeout(1000);
  expect(demodb, 'nothing is requested before Continue').toEqual([]);
  await shot('1-confirm-large-download');

  // 2. Continue: download (manifest, then each part once), verify, store, open.
  mark('continue-clicked');
  await page.getByTestId('demo-sqlite-continue').click();
  await expect(page.getByTestId('demo-sqlite-progress')).toBeVisible({ timeout: 120_000 });
  await shot('2-downloading');
  await waitForSuccessOrAppError(
    page.getByTestId('ovdb-table-list'),
    [page.getByTestId('demo-sqlite-failed'), page.getByTestId('demo-sqlite-locked'), page.getByTestId('demo-sqlite-no-storage')],
    'download and open',
    600_000,
  );
  await expect(page.getByTestId('ovdb-table-list')).toBeVisible();
  mark('opened');
  await expect(page.getByTestId('ovdb-status')).toHaveText('Local copy ready');
  await expect(page.getByTestId('demo-sqlite-not-persistent')).toHaveCount(0);
  expect(demodb, 'the first open downloads the manifest, then each part, once').toEqual(expectedOneDownload);
  evidence['firstDownloadRequests'] = [...demodb];
  await shot('3-opened-table-list');

  // 3. The stored file is the pinned file (hashed in the page).
  const stored = await opfsDatabaseEvidence(page, entry.bytes, entry.sha256);
  evidence['opfs'] = stored;
  expect(stored.sha256, `the OPFS database file holds the pinned ${entry.bytes} bytes: ${JSON.stringify(stored.files)}`).toBe(entry.sha256);

  // The table list is the registry's list of tables (the browser lists base tables; views are not browsable).
  const recordsets = corpusRecordsets();
  const listed = (
    await page
      .getByTestId('ovdb-table-list')
      .locator('[data-testid^="table-"]')
      .evaluateAll((items) => items.map((item) => (item.getAttribute('data-testid') ?? '').slice('table-'.length)))
  ).sort();
  const tables = recordsets.filter((recordset) => recordset.kind === 'table');
  expect(listed).toEqual(tables.map((recordset) => recordset.name).sort());
  evidence['tables'] = { listed: listed.length, rowCountsFromRegistry: Object.fromEntries(tables.map((table) => [table.name, table.rowCount])) };

  // 4. Read a table.
  await expect(page.getByTestId('ovdb-database-header')).toContainText('editable');
  await expect(page.getByTestId('reset-database')).toBeVisible();
  const target = tables.find(
    (recordset) =>
      (recordset.rowCount ?? 0) > 0 &&
      recordset.columns.some((column) => column.primaryKey) &&
      recordset.columns.some((column) => !column.primaryKey && /CHAR|TEXT/i.test(column.type)),
  );
  if (!target || target.rowCount == null) throw new Error('adventureworks has no table the journey can edit');
  const editedColumn = target.columns.find((column) => !column.primaryKey && /CHAR|TEXT/i.test(column.type))?.name;
  if (!editedColumn) throw new Error(`${target.name} has no text column`);
  await page.getByTestId(`table-${target.name}`).click();
  await expect(page.getByTestId('ovdb-rows')).toBeVisible({ timeout: 60_000 });
  const rows = page.getByTestId('ovdb-rows').locator('tbody tr');
  const shownRows = await rows.count();
  expect(shownRows).toBe(Math.min(target.rowCount, 100));
  const headers = await page.getByTestId('ovdb-rows').locator('thead th').allInnerTexts();
  expect(headers).toContain(editedColumn);
  const cellOfFirstRow = (): Locator => rows.first().locator('td').nth(headers.indexOf(editedColumn));
  const original = await cellOfFirstRow().innerText();
  evidence['read'] = { table: target.name, registryRowCount: target.rowCount, rowsShown: shownRows, columns: headers.length, editedColumn, original };
  await shot('4-table-rows');

  // 5. Edit (capability gated), reload, still there.
  await rows.first().click();
  await expect(page.getByTestId('record-edit')).toBeEnabled();
  await expect(page.getByTestId('record-delete')).toBeEnabled();
  const edited = 'e2e-adventureworks-edit';
  await page.getByTestId('record-edit').click();
  await page.getByTestId(`record-input-${editedColumn}`).locator('input').fill(edited);
  await page.getByTestId('record-save').click();
  await expect(page.getByTestId('record-notice')).toHaveText('Saved.');
  await expect(cellOfFirstRow()).toHaveText(edited);
  mark('edited');
  const requestsBeforeReload = demodb.length;
  await page.reload();
  await expect(page.getByTestId('demo-sqlite-confirm-large')).toHaveCount(0);
  // The app reopens the table that was open (the route remembers it), so the rows are there without a click.
  await expect(page.getByTestId('ovdb-rows')).toBeVisible({ timeout: 300_000 });
  await expect(cellOfFirstRow()).toHaveText(edited);
  expect(demodb, 'a reload opens the stored copy without downloading again').toHaveLength(requestsBeforeReload);
  mark('reloaded-edit-persisted');
  await shot('5-edit-persisted-after-reload');

  // 6. Reset Database, with its confirmation: downloads again (single-copy), restores the original.
  expect(entry.storagePolicy).toBe('single-copy');
  await page.getByTestId('reset-database').click();
  const alert = page.locator('ion-alert');
  await expect(alert).toHaveCount(1);
  await expect(alert).toContainText('All your local changes to');
  await shot('6-reset-confirmation');
  await alert.getByRole('button', { name: 'Reset Database', exact: true }).click();
  await expect(alert).toHaveCount(0);
  await waitForSuccessOrAppError(
    page.getByTestId('reset-message'),
    [page.getByTestId('reset-error'), page.getByTestId('demo-sqlite-failed')],
    'Reset Database',
    600_000,
  );
  await expect(page.getByTestId('reset-message')).toContainText('Database reset to the original DemoDB data');
  mark('reset-done');
  expect(demodb, 'Reset downloads manifest + parts again').toEqual([...expectedOneDownload, ...expectedOneDownload]);
  await expect(cellOfFirstRow()).toHaveText(original);
  await page.reload();
  // The app reopens the table that was open (the route remembers it), so the rows are there without a click.
  await expect(page.getByTestId('ovdb-rows')).toBeVisible({ timeout: 300_000 });
  await expect(cellOfFirstRow()).toHaveText(original);
  expect(demodb).toHaveLength(expectedOneDownload.length * 2);
  mark('pristine-after-reload');
  const afterReset = await opfsDatabaseEvidence(page, entry.bytes, entry.sha256);
  evidence['opfsAfterReset'] = afterReset;
  expect(afterReset.sha256, 'after Reset the stored file is the pinned file again').toBe(entry.sha256);
  await shot('7-pristine-after-reset-and-reload');

  evidence['requestsToDemodbHosts'] = demodb;
  evidence['guardCounts'] = Object.fromEntries(demodbGuard.counts);
  evidence['timingsMs'] = timings;
  evidence['totalMs'] = Date.now() - started;
  await testInfo.attach('adventureworks-evidence.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  writeFileSync(testInfo.outputPath('adventureworks-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`[adventureworks-evidence] ${JSON.stringify(evidence)}`);
  baseExpect(Object.keys(timings).length).toBeGreaterThan(0);
});
