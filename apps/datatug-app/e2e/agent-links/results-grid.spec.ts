import * as fs from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import {
  DEMO_DB,
  DEMO_ENV,
  DEMO_PROJECT,
  expect,
  test,
} from './fixtures/daemon';

/**
 * The community toolbar of the shared results grid (column chooser, remembered layout, autosize, row selection with
 * CSV and copy, density) on a stored result opened in the query editor, against a real daemon. Nothing here prints
 * a row value: the checks name columns, counts and storage keys only. The same grid component draws a live run, so
 * the checks of the toolbar and the layout hold for it too (the live path is covered by the unit specs of the query
 * page; this suite needs only a stored result).
 */
const DB_REF = `datatug://${DEMO_PROJECT}/${DEMO_DB}?env=${DEMO_ENV}`;

/** The first release whose results carry the column type metadata the grid aligns numbers by (0.102.1 unless a lower one is proven). */
const COLUMN_TYPES_CLI = '0.102.1';

/** The first release whose results carry the table's column order and no `$key` (datatug-cli#435). */
const COLUMN_ORDER_CLI = '0.102.1';
const INVOICE_COLUMNS = [
  'InvoiceId',
  'CustomerId',
  'InvoiceDate',
  'BillingAddress',
  'BillingCity',
  'BillingState',
  'BillingCountry',
  'BillingPostalCode',
  'Total',
];
const CUSTOMER_COLUMNS = [
  'CustomerId',
  'FirstName',
  'LastName',
  'Company',
  'Address',
  'City',
  'State',
  'Country',
];

async function open(
  page: Page,
  linkDaemon: {
    writeResult(id: string, args: readonly string[]): void;
    resultLink(id: string, view?: string): string;
  },
  id: string,
  from = 'Invoice',
  limit = 5,
): Promise<Locator> {
  linkDaemon.writeResult(id, [
    '--db',
    DB_REF,
    '--from',
    from,
    '--limit',
    String(limit),
    '--no-policies',
  ]);
  // Wide enough for every column: AG Grid draws only the columns in view.
  await page.setViewportSize({ width: 2600, height: 1100 });
  await page.goto(linkDaemon.resultLink(id, 'table'));
  const grid = page.locator('sneat-datatug-results-grid').first();
  await expect(grid.locator('.ag-row')).toHaveCount(limit, { timeout: 30_000 });
  return grid;
}

/**
 * Waits until the grid stops re-creating its rows. Marked rows survive an in-place update, so an unmarked row after
 * the pause means the rows were replaced. This used to be needed because the result page drew its read-only grid and
 * then, about 0.4 s later, was replaced by the query editor with a second grid (issue #411: a selection, a resized
 * column or a sort made in that window was lost). The page now draws nothing until it knows whether it is replaced,
 * so this is only a guard that a grid never silently re-creates its rows; it is harmless and cheap.
 */
async function settleRows(grid: Locator): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    await grid
      .locator('.ag-row')
      .evaluateAll((rows) =>
        rows.forEach((row) => row.setAttribute('data-settled', '1')),
      );
    await grid.page().waitForTimeout(1000);
    if ((await grid.locator('.ag-row:not([data-settled])').count()) === 0)
      return;
  }
  throw new Error('the grid kept re-creating its rows');
}

/** A visible element's box; fails the test when the element is not on the page. */
async function boxOf(locator: Locator) {
  // A bounding box exists only once the element is rendered and laid out: wait for that (never sleep) so a
  // viewport resize that re-renders the toolbar cannot race the measurement.
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no box');
  return box;
}

/**
 * The column names in screen order. AG Grid keeps header cells in the DOM in the order it created them and places
 * them by position, so the DOM order is not the column order once a column moved: sort by the left edge.
 */
const headerNames = (grid: Locator): Promise<string[]> =>
  grid
    .locator('.ag-header-cell [data-testid="header-name"]')
    .evaluateAll((els) =>
      els
        .map((el) => ({
          left: el.getBoundingClientRect().left,
          name: (el.textContent ?? '').trim(),
        }))
        .sort((a, b) => a.left - b.left)
        .map((c) => c.name),
    );

/** The keys the grid wrote to localStorage (keys and layout only, never read as values by the test output). */
const gridStorage = (page: Page) =>
  page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith('datatug.grid.'))
      .map((k) => ({ key: k, value: localStorage.getItem(k) ?? '' })),
  );

test.describe('results grid toolbar', () => {
  test.beforeEach(({ linkDaemon }) => {
    test.skip(
      !linkDaemon.supportsResults,
      'This datatug binary stores no query results.',
    );
  });

  test('shows the columns in table order with no $key (datatug-cli 0.102.1 or later)', async ({
    page,
    linkDaemon,
  }) => {
    test.skip(
      !linkDaemon.cliAtLeast(COLUMN_ORDER_CLI),
      `Column order of the table needs datatug ${COLUMN_ORDER_CLI} or later (this one is ${linkDaemon.cliVersion || 'unknown'}).`,
    );
    const invoice = await open(page, linkDaemon, 'e2e-order-invoice');
    await expect.poll(() => headerNames(invoice)).toEqual(INVOICE_COLUMNS);
    const customer = await open(
      page,
      linkDaemon,
      'e2e-order-customer',
      'Customer',
    );
    await expect
      .poll(async () =>
        (await headerNames(customer)).slice(0, CUSTOMER_COLUMNS.length),
      )
      .toEqual(CUSTOMER_COLUMNS);
    await expect.poll(() => headerNames(customer)).not.toContain('$key');
    await expect.poll(() => headerNames(customer)).not.toContain('id');
  });

  test('right-aligns numeric columns (InvoiceId, CustomerId, Total) and leaves text columns left', async ({
    page,
    linkDaemon,
  }) => {
    test.skip(
      !linkDaemon.cliAtLeast(COLUMN_TYPES_CLI),
      `Right-aligned numeric columns need the column types of datatug ${COLUMN_TYPES_CLI} or later (this one is ${linkDaemon.cliVersion || 'unknown'}).`,
    );
    const grid = await open(page, linkDaemon, 'e2e-align');
    await expect
      .poll(async () => (await headerNames(grid)).length)
      .toBeGreaterThan(3);
    /** The first body cell of a column, found by the header name: its class and computed text-align. */
    const firstCell = async (name: string) => {
      const colId = await grid
        .locator('.ag-header-cell')
        .filter({
          has: page.locator('[data-testid="header-name"]', { hasText: name }),
        })
        .first()
        .getAttribute('col-id');
      expect(colId, `col-id of ${name}`).toBeTruthy();
      const cell = grid.locator(`.ag-cell[col-id="${colId}"]`).first();
      await expect(cell).toBeVisible();
      return cell;
    };
    const textAlign = (cell: Locator) =>
      cell.evaluate((el) => getComputedStyle(el).textAlign);
    for (const name of ['InvoiceId', 'CustomerId', 'Total']) {
      const cell = await firstCell(name);
      await expect(cell, `${name} cell class`).toHaveClass(
        /ag-right-aligned-cell/,
      );
      expect(['right', 'end'], `${name} computed text-align`).toContain(
        await textAlign(cell),
      );
    }
    for (const name of ['BillingCity', 'BillingCountry']) {
      const cell = await firstCell(name);
      await expect(cell, `${name} cell class`).not.toHaveClass(
        /ag-right-aligned-cell/,
      );
      expect(['left', 'start'], `${name} computed text-align`).toContain(
        await textAlign(cell),
      );
    }
  });

  test('has the toolbar buttons, and the chooser hides, orders and resets columns; a refresh keeps them', async ({
    page,
    linkDaemon,
  }) => {
    const grid = await open(page, linkDaemon, 'e2e-chooser');
    await expect
      .poll(async () => (await headerNames(grid)).length)
      .toBeGreaterThan(3);
    const original = await headerNames(grid);
    for (const id of [
      'columns-button',
      'autosize',
      'density',
      'export-csv',
      'copy',
    ]) {
      await expect(grid.getByTestId(`results-grid-${id}`)).toBeVisible();
    }
    await expect(grid.getByTestId('results-grid-copy')).toBeDisabled();

    await grid.getByTestId('results-grid-columns-button').click();
    const chooser = grid.getByTestId('results-grid-chooser');
    await expect(chooser).toBeVisible();
    const items = chooser.locator('.dt-rg-chooser-item');
    // The chooser lists the data columns only: no row number, checkbox column or internal key.
    await expect(items).toHaveCount(original.length);

    // Hide the second column, then move the fourth one up above the third (a visible neighbour).
    const hidden = original[1];
    const moved = original[3];
    await items.nth(1).getByTestId('results-grid-column-toggle').uncheck();
    await expect
      .poll(() => headerNames(grid))
      .toEqual(original.filter((n) => n !== hidden));
    await chooser
      .locator('.dt-rg-chooser-item', { hasText: moved })
      .getByTestId('results-grid-column-up')
      .click();
    const expected = original.filter((n) => n !== hidden);
    [expected[1], expected[2]] = [expected[2], expected[1]];
    expect(expected[1]).toBe(moved);
    await expect.poll(() => headerNames(grid)).toEqual(expected);

    // The layout is remembered under a key of ids only.
    await expect.poll(async () => (await gridStorage(page)).length).toBe(1);
    const [stored] = await gridStorage(page);
    expect(stored.key).toMatch(
      new RegExp(`^datatug\\.grid\\.v1:${DEMO_PROJECT}:e2e-chooser:result$`),
    );
    expect(Object.keys(JSON.parse(stored.value)).sort()).toEqual(
      ['cols', 'density', 'sig', 'v'].sort(),
    );

    await page.reload();
    await expect(grid.locator('.ag-row')).toHaveCount(5, { timeout: 30_000 });
    // The remembered order is applied a moment after the rows, so wait for it.
    await expect.poll(() => headerNames(grid)).toEqual(expected);

    // Show all brings the hidden column back (at its place in the remembered order); Reset restores the table order.
    await grid.getByTestId('results-grid-columns-button').click();
    await grid.getByTestId('results-grid-show-all').click();
    await expect
      .poll(async () => (await headerNames(grid)).length)
      .toBe(original.length);
    await grid.getByTestId('results-grid-reset-columns').click();
    await expect.poll(() => headerNames(grid)).toEqual(original);
    await expect
      .poll(async () =>
        Object.keys(JSON.parse((await gridStorage(page))[0].value)),
      )
      .not.toContain('cols');
    await page.reload();
    await expect(grid.locator('.ag-row')).toHaveCount(5, { timeout: 30_000 });
    await expect.poll(() => headerNames(grid)).toEqual(original);
  });

  test('remembers a resized column and the sort, and autosize fits the columns', async ({
    page,
    linkDaemon,
  }) => {
    const grid = await open(page, linkDaemon, 'e2e-width');
    await expect
      .poll(async () => (await headerNames(grid)).length)
      .toBeGreaterThan(3);
    const cell = grid
      .locator('.ag-header-cell:not(.ag-floating-filter)')
      .nth(3);
    const colId = (await cell.getAttribute('col-id')) ?? '';
    const width = async () =>
      Math.round(
        (
          await grid
            .locator(
              `.ag-header-cell:not(.ag-floating-filter)[col-id="${colId}"]`,
            )
            .boundingBox()
        )?.width ?? 0,
      );
    const before = await width();
    // Sort descending on a column (two clicks on its name), which is remembered too.
    const name = grid.locator(
      `.ag-header-cell[col-id="${colId}"] [data-testid="header-name"]`,
    );
    await name.click();
    await name.click();
    // Drag the right edge of the header to make it wider.
    const box = await boxOf(
      grid.locator(
        `.ag-header-cell:not(.ag-floating-filter)[col-id="${colId}"]`,
      ),
    );
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 120, box.y + box.height / 2, {
      steps: 6,
    });
    await page.mouse.up();
    await expect.poll(width).toBeGreaterThan(before + 80);
    const widened = await width();
    // The layout is saved after a short delay, and the sort click saves it before the drag does: wait for the stored
    // width of THIS column to be the widened one, not just for any stored layout, or the reload below can cut off the
    // save of the resize and come back with the older width.
    await expect
      .poll(
        async () =>
          Math.abs(
            (JSON.parse((await gridStorage(page))[0]?.value ?? '{}').cols?.find(
              (c: { colId?: string }) => c.colId === colId,
            )?.width ?? 0) - widened,
          ),
      )
      .toBeLessThanOrEqual(2);
    await page.reload();
    await expect(grid.locator('.ag-row')).toHaveCount(5, { timeout: 30_000 });
    await expect
      .poll(async () => Math.abs((await width()) - widened))
      .toBeLessThanOrEqual(2);
    await expect(
      grid.locator(
        `.ag-header-cell:not(.ag-floating-filter)[col-id="${colId}"]`,
      ),
    ).toHaveAttribute('aria-sort', 'descending');
    // Autosize all fits every column to its content again.
    await grid.getByTestId('results-grid-autosize').click();
    await expect.poll(width).toBeLessThan(widened);
  });

  test('selects rows with checkboxes, exports and copies only those, and falls back to all rows', async ({
    page,
    linkDaemon,
    context,
  }) => {
    const grid = await open(page, linkDaemon, 'e2e-select');
    await settleRows(grid);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin,
    });
    const rows = grid
      .locator(
        '.ag-row[row-index="0"] .ag-cell:not([col-id="__row"]):not([col-id^="ag-Grid"])',
      )
      .nth(1);
    const checkbox = (n: number) =>
      grid
        .locator(`.ag-row[row-index="${n}"] .ag-selection-checkbox input`)
        .first();
    await checkbox(0).check();
    await checkbox(2).check();
    await expect(grid.getByTestId('results-grid-count')).toContainText(
      '2 selected',
    );
    await expect(grid.getByTestId('results-grid-copy')).toBeEnabled();
    await expect(grid.getByTestId('results-grid-export-csv')).toContainText(
      'CSV selected',
    );

    const download = page.waitForEvent('download');
    await grid.getByTestId('results-grid-export-csv').click();
    const csv = fs.readFileSync(
      (await (await download).path()) as string,
      'utf8',
    );
    // A header line and the two selected rows (no row value is cited).
    expect(csv.trim().split('\n')).toHaveLength(3);
    expect(csv.split('\n')[0]).not.toContain('$key');

    await grid.getByTestId('results-grid-copy').click();
    await expect(grid.getByTestId('results-grid-status')).toContainText(
      'Copied 2 rows',
    );
    const tsv = await page.evaluate(() => navigator.clipboard.readText());
    const lines = tsv.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0].split('\t')).toContain('InvoiceId');
    expect(lines[0].split('\t')).not.toContain('#');
    // Same column count on every line.
    expect(new Set(lines.map((l) => l.split('\t').length)).size).toBe(1);

    // A click on a row selects nothing and the Current row does not follow the checkboxes.
    await rows.click();
    await expect(grid.getByTestId('results-grid-count')).toContainText(
      '2 selected',
    );

    // With nothing checked the CSV is all rows again.
    await checkbox(0).uncheck();
    await checkbox(2).uncheck();
    await expect(grid.getByTestId('results-grid-count')).not.toContainText(
      'selected',
    );
    const all = page.waitForEvent('download');
    await grid.getByTestId('results-grid-export-csv').click();
    const allCsv = fs.readFileSync(
      (await (await all).path()) as string,
      'utf8',
    );
    expect(allCsv.trim().split('\n')).toHaveLength(6);
  });

  test('toggles the density and remembers it; stores ids and layout only', async ({
    page,
    linkDaemon,
  }) => {
    const grid = await open(page, linkDaemon, 'e2e-density');
    const rowHeight = async () =>
      Math.round(
        (await grid.locator('.ag-row[row-index="0"]').first().boundingBox())
          ?.height ?? 0,
      );
    const comfortable = await rowHeight();
    await grid.getByTestId('results-grid-density').click();
    await expect.poll(rowHeight).toBeLessThan(comfortable);
    await expect.poll(rowHeight).toBeLessThanOrEqual(30);
    await expect
      .poll(async () =>
        (await gridStorage(page)).map((s) => JSON.parse(s.value).density),
      )
      .toEqual(['compact']);
    await page.reload();
    await expect(grid.locator('.ag-row')).toHaveCount(5, { timeout: 30_000 });
    await expect.poll(rowHeight).toBeLessThanOrEqual(30);
    await expect(grid.getByTestId('results-grid-density')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Nothing the grid stored holds a cell text, a filter or the quick-filter text.
    await grid
      .getByTestId('results-grid-quick-filter')
      .fill('zz-filter-text-e2e');
    const cells = await grid.locator('.ag-cell').allTextContents();
    await page.waitForTimeout(500);
    const stored = JSON.stringify(await gridStorage(page));
    expect(stored).not.toContain('zz-filter-text-e2e');
    for (const text of cells.map((c) => c.trim()).filter((c) => c.length > 5)) {
      expect(stored).not.toContain(text);
    }
    await grid.getByTestId('results-grid-quick-filter').fill('');
    // Back to comfortable leaves the density remembered as such.
    await grid.getByTestId('results-grid-density').click();
    await expect.poll(rowHeight).toBe(comfortable);
  });

  test('keyboard: arrows and Tab move through the cells and the Current row follows', async ({
    page,
    linkDaemon,
  }) => {
    const grid = await open(page, linkDaemon, 'e2e-keys');
    await page.getByTestId('author-current-row-toggle').click();
    const first = grid
      .locator(
        '.ag-row[row-index="0"] .ag-cell:not([col-id="__row"]):not([col-id^="ag-Grid"])',
      )
      .first();
    await first.click();
    await expect(page.getByTestId('author-current-row')).toContainText(
      'Position 1',
      {
        timeout: 30_000,
      },
    );
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('author-current-row')).toContainText(
      'Position 2',
    );
    const focusedCol = () =>
      page.evaluate(
        () =>
          (
            document.activeElement?.closest('.ag-cell') as HTMLElement | null
          )?.getAttribute('col-id') ?? '',
      );
    const start = await focusedCol();
    await page.keyboard.press('Tab');
    const next = await focusedCol();
    expect(next).not.toBe('');
    expect(next).not.toBe(start);
    await page.keyboard.press('ArrowRight');
    await expect.poll(focusedCol).not.toBe(next);
    // Space checks and unchecks the row of the focused cell.
    await page.keyboard.press('Space');
    await expect(grid.getByTestId('results-grid-count')).toContainText(
      '1 selected',
    );
    await page.keyboard.press('Space');
    await expect(grid.getByTestId('results-grid-count')).not.toContainText(
      'selected',
    );
  });

  test('fits a narrow screen: the toolbar wraps and the page does not scroll sideways', async ({
    page,
    linkDaemon,
  }) => {
    await open(page, linkDaemon, 'e2e-narrow');
    await page.setViewportSize({ width: 360, height: 800 });
    const toolbar = page.getByTestId('results-grid-toolbar').first();
    await expect(toolbar).toBeVisible();
    const overflow = await toolbar.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    for (const id of [
      'columns-button',
      'autosize',
      'density',
      'export-csv',
      'copy',
    ]) {
      const box = await boxOf(page.getByTestId(`results-grid-${id}`).first());
      expect(box.x + box.width).toBeLessThanOrEqual(361);
    }
    await page.getByTestId('results-grid-columns-button').first().click();
    const chooser = await boxOf(
      page.getByTestId('results-grid-chooser').first(),
    );
    expect(chooser.x).toBeGreaterThanOrEqual(-1);
    expect(chooser.x + chooser.width).toBeLessThanOrEqual(361);
  });
});
