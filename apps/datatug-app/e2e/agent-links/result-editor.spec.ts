import * as fs from 'node:fs';
import {
  DEMO_DB,
  DEMO_ENV,
  DEMO_PROJECT,
  expect,
  test,
} from './fixtures/daemon';

/**
 * The Table view of a stored query result is the query editor: the card's "Open in DataTug" link
 * (`/result/<id>?view=table`) lands on `/project/<p>/query?result=<id>`, filled from the result and showing its saved
 * rows in the shared results grid. Against a real daemon; nothing here prints a row value or the prompt. The checks of
 * the query text and the prompt need a datatug-cli with the editor-ready result members (#431) and are skipped
 * against an older binary, which gets the "older DataTug" message instead.
 */
type Answer = {
  query?: { text?: unknown };
  meta?: { columns?: { name: string; pk?: number | null }[] };
  recordset?: { columns?: { name: string; type: string }[] };
};
/** The position of the first numeric column of the result (its type only, never a value), or -1. */
const numericColumn = (a: Answer): number =>
  a.recordset?.columns?.findIndex((c) =>
    ['integer', 'decimal', 'number'].includes(c.type),
  ) ?? -1;

const DB_REF = `datatug://${DEMO_PROJECT}/${DEMO_DB}?env=${DEMO_ENV}`;
/** Markup on purpose: the prompt is only ever drawn as text. */
const PROMPT =
  'show the first invoices <b id="e2e-prompt-bold">bold</b><img src=x onerror="window.__e2eXss=1"> please';

test.describe('query result in the query editor', () => {
  test.beforeEach(({ linkDaemon }) => {
    test.skip(
      !linkDaemon.supportsResults,
      'This datatug binary stores no query results.',
    );
  });

  test('the table link opens the editor with the saved rows in the shared grid; nothing runs', async ({
    page,
    linkDaemon,
  }) => {
    linkDaemon.writeResult('e2e-editor', [
      '--db',
      DB_REF,
      '--from',
      'Invoice',
      '--limit',
      '5',
      '--no-policies',
    ]);
    if (linkDaemon.supportsPrompt) linkDaemon.annotate('e2e-editor', PROMPT);
    // Wide enough for every column: AG Grid draws only the columns in view.
    await page.setViewportSize({ width: 2600, height: 1100 });

    const agentRequests: { method: string; url: string }[] = [];
    page.on('request', (r) => {
      if (r.url().startsWith(`http://127.0.0.1:${linkDaemon.port}/`)) {
        agentRequests.push({ method: r.method(), url: r.url() });
      }
    });
    const resultRead = page.waitForResponse((r) =>
      /\/datatug\/results\/e2e-editor$/.test(r.url()),
    );
    await page.goto(linkDaemon.resultLink('e2e-editor', 'table'));
    const answer = (await (await resultRead).json()) as Answer;
    const editorReady = typeof answer.query?.text === 'string';

    // The result page was replaced by the editor of its project: the code is gone, no id of a row or a prompt.
    await expect(page).toHaveURL(
      new RegExp(`/project/${DEMO_PROJECT}/query\\?result=e2e-editor`),
      { timeout: 30_000 },
    );
    expect(page.url()).not.toContain('code=');
    expect(page.url()).not.toContain('#');
    expect(decodeURIComponent(page.url())).not.toContain('please');

    const banner = page.getByTestId('saved-result-banner');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('saved-result-badge')).toContainText(
      'Saved result from',
    );
    await expect(page.getByTestId('saved-result-rows')).toContainText('5 rows');
    // The project of the result is the current one on the editor too.
    await expect(page.locator('sneat-datatug-project-menu')).toContainText(
      'Queries',
      { timeout: 30_000 },
    );

    // The saved rows are in the shared grid right away.
    const grid = page.locator('sneat-datatug-results-grid').first();
    const bodyRows = grid.locator('.ag-row');
    await expect(bodyRows).toHaveCount(5, { timeout: 30_000 });
    await expect(grid.locator('.ag-floating-filter').first()).toBeVisible();
    // Numbers are right-aligned, and the row-number column is pinned in front.
    const numeric = numericColumn(answer);
    if (numeric >= 0) {
      await expect(
        grid.locator(`.ag-cell[col-id="result_${numeric}"]`).first(),
      ).toHaveClass(/ag-right-aligned-cell/);
    }
    await expect(grid.locator('.ag-cell[col-id="__row"]')).toHaveCount(5);

    // The page is named for the result and the project, not the app's generic title.
    await expect(page).toHaveTitle(/^Query from result · \S/);
    // The database and environment of the result are shown, and the environment is the selected one.
    await expect(page.getByTestId('saved-result-database')).toContainText(
      `${DEMO_DB} · environment ${DEMO_ENV}`,
    );
    await expect(
      page.locator('sneat-datatug-menu-env-selector'),
    ).toContainText(DEMO_ENV, { timeout: 30_000 });
    // A saved snapshot has nothing to chart yet: it says when charts become available, not a rights error.
    await expect(page.getByTestId('chart-unavailable')).toHaveText(
      'Charts are available after running the query.',
    );
    await expect(page.getByText('usage rights')).toHaveCount(0);

    // The internal `$key` column and its placeholder never show; the columns keep the order of the recordset, except
    // that the primary key the metadata names comes first.
    await expect(grid).not.toContainText('__dalgo_record_id');
    await expect(grid.getByTestId('header-name').filter({ hasText: '$key' })).toHaveCount(0);
    const shown = (answer.recordset?.columns ?? []).filter((c) => c.name !== '$key');
    const headers = grid.locator('.ag-header-cell[role="columnheader"][col-id^="result_"]');
    await expect(headers).toHaveCount(shown.length);
    const pk = (answer.meta?.columns ?? [])
      .filter((c) => typeof c.pk === 'number' && c.pk > 0)
      .sort((a, b) => (a.pk as number) - (b.pk as number))[0];
    if (pk) {
      await expect(headers.first().getByTestId('header-name')).toHaveText(pk.name);
    }
    // Sort indicators are on every column, not only the sorted one. The column menu button is AG Grid
    // Enterprise's: a community build has none, so it is checked only where the grid has one.
    await expect(grid.getByTestId('header-sort-idle')).toHaveCount(shown.length);
    const menus = grid.locator('[data-testid="header-menu"], .ag-header-cell-menu-button');
    if ((await menus.count()) > 0) {
      await headers.first().hover();
      await expect(menus).toHaveCount(shown.length);
      await expect(menus.first()).toBeVisible();
    }

    // A wide result starts with the Current row pane closed, so the grid has the width; one click opens it.
    const toggle = page.getByTestId('author-current-row-toggle');
    await expect(toggle).toBeVisible();
    if (shown.length > 6) {
      await expect(page.getByTestId('author-current-row')).toHaveCount(0);
      await toggle.click();
      await expect(page.getByTestId('author-current-row')).toBeVisible();
      await toggle.click();
      await expect(page.getByTestId('author-current-row')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('author-current-row')).toBeVisible();
    }

    if (editorReady) {
      await expect(
        page.getByRole('textbox', { name: 'DTQL source' }),
      ).toContainText('Invoice');
    } else {
      await expect(page.getByTestId('saved-result-notice')).toContainText(
        'older DataTug',
      );
      await expect(page.getByTestId('saved-result-summary')).toContainText(
        'Database: chinook-local',
      );
    }
    if (linkDaemon.supportsPrompt) {
      const prompt = page.getByTestId('saved-result-prompt');
      await expect(prompt.locator('summary')).toHaveText('Prompt');
      // Text only: the markup in the prompt built no element and ran nothing.
      await expect(page.getByTestId('saved-result-prompt-text')).toHaveText(
        PROMPT,
      );
      await expect(banner.locator('b, img')).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __e2eXss?: number }).__e2eXss)).toBeUndefined();
      // Collapsible.
      await prompt.locator('summary').click();
      await expect(page.getByTestId('saved-result-prompt-text')).toBeHidden();
    }

    // Opening the editor read the result and the project; it ran and wrote nothing.
    const others = agentRequests.filter(
      (r) => !r.url.endsWith('/datatug/session/exchange'),
    );
    for (const r of others) {
      expect(r.url).not.toMatch(/\/datatug\/exec\//);
      expect(r.url).not.toContain('code=');
    }
    expect(
      agentRequests.filter((r) => r.url.endsWith('/datatug/session/exchange')),
    ).toHaveLength(1);
  });

  test('the grid sorts, filters and exports', async ({ page, linkDaemon }) => {
    linkDaemon.writeResult('e2e-grid', [
      '--db',
      DB_REF,
      '--from',
      'Invoice',
      '--limit',
      '5',
      '--no-policies',
    ]);
    await page.setViewportSize({ width: 2600, height: 1100 });
    const resultRead = page.waitForResponse((r) =>
      /\/datatug\/results\/e2e-grid$/.test(r.url()),
    );
    await page.goto(linkDaemon.resultLink('e2e-grid', 'table'));
    const answer = (await (await resultRead).json()) as Answer;
    const grid = page.locator('sneat-datatug-results-grid').first();
    const bodyRows = grid.locator('.ag-row');
    await expect(bodyRows).toHaveCount(5, { timeout: 30_000 });

    // Sorting on a numeric column compares numbers: ascending then descending (the screen order is the row index).
    const numeric = numericColumn(answer);
    if (numeric >= 0) {
      const col = `result_${numeric}`;
      const values = async () => {
        const rows = await grid.locator('.ag-row').all();
        const byIndex = new Map<number, number>();
        for (const row of rows) {
          const index = Number(await row.getAttribute('row-index'));
          const text = await row.locator(`.ag-cell[col-id="${col}"]`).textContent();
          byIndex.set(index, Number(text));
        }
        return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
      };
      // The editor's headers carry the "meaning" button, so the name of the column is what sorts.
      const header = grid.locator(`.ag-header-cell[col-id="${col}"] [data-testid="header-name"]`);
      await header.click();
      const ascending = await values();
      expect(ascending).toEqual([...ascending].sort((a, b) => a - b));
      await header.click();
      const descending = await values();
      expect(descending).toEqual([...descending].sort((a, b) => b - a));
    }

    // The quick filter narrows the rows and the count says so.
    await grid.getByTestId('results-grid-quick-filter').fill('no-such-value-e2e');
    await expect(bodyRows).toHaveCount(0);
    await expect(grid.getByTestId('results-grid-count')).toContainText('0 of 5 rows');
    await grid.getByTestId('results-grid-quick-filter').fill('');
    await expect(bodyRows).toHaveCount(5);

    // The community build has no Excel export; CSV downloads.
    await expect(grid.getByTestId('results-grid-export-excel')).toHaveCount(0);
    const download = page.waitForEvent('download');
    await grid.getByTestId('results-grid-export-csv').click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('query-result.csv');
    // The internal `$key` column is not exported.
    const csv = fs.readFileSync((await file.path()) as string, 'utf8');
    expect(csv.split('\n')[0]).not.toContain('$key');
    expect(csv).not.toContain('__dalgo_record_id');
  });

  test('Back and the other result views work, and a refresh reopens the editor', async ({
    page,
    linkDaemon,
  }) => {
    linkDaemon.writeResult('e2e-views', [
      '--db',
      DB_REF,
      '--from',
      'Invoice',
      '--limit',
      '2',
      '--no-policies',
    ]);
    await page.goto(linkDaemon.resultLink('e2e-views', 'table'));
    await expect(page.getByTestId('saved-result-banner')).toBeVisible({
      timeout: 30_000,
    });

    // The editor replaced the result page: no history entry is left behind for it.
    // Another view of the result is one click away, and the browser's Back returns to the editor.
    await page.getByTestId('saved-result-view-sources').click();
    await expect(page).toHaveURL(/\/result\/e2e-views\?view=sources$/);
    await expect(page.getByTestId('result-sources')).toContainText('Invoice', {
      timeout: 30_000,
    });
    await page.goBack();
    await expect(page).toHaveURL(
      new RegExp(`/project/${DEMO_PROJECT}/query\\?result=e2e-views`),
    );
    await expect(page.getByTestId('saved-result-banner')).toBeVisible({
      timeout: 30_000,
    });

    // A refresh (the code is gone from the address) reads the result again.
    await page.reload();
    await expect(page.getByTestId('saved-result-banner')).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.locator('sneat-datatug-results-grid .ag-row'),
    ).toHaveCount(2, { timeout: 30_000 });

    // The editor's own Back button (with no history to go back to) goes to the queries of the project.
    await page.goto(
      page.url().replace(/\/query\?.*$/, '/query?result=e2e-views'),
    );
    await page.locator('ion-back-button').first().click();
    await expect(page).toHaveURL(
      new RegExp(`/project/${DEMO_PROJECT}/queries`),
    );
  });

  test('a result the agent does not have shows its named state in the editor', async ({
    page,
    linkDaemon,
  }) => {
    linkDaemon.writeResult('e2e-editor-known', [
      '--db',
      DB_REF,
      '--from',
      'Invoice',
      '--limit',
      '1',
      '--no-policies',
    ]);
    await page.goto(linkDaemon.resultLink('e2e-editor-known', 'table'));
    await expect(page.getByTestId('saved-result-banner')).toBeVisible({
      timeout: 30_000,
    });
    await page.goto(page.url().replace('result=e2e-editor-known', 'result=e2e-gone'));
    await expect(page.getByTestId('link-problem')).toHaveAttribute(
      'data-problem',
      'result-not-found',
      { timeout: 30_000 },
    );
  });
});
