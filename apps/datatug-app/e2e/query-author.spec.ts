import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installFakeGithub } from './helpers/fake-github';

const DEMO_REPO = process.env['DATATUG_E2E_GITHUB_FAKE'];
const JOIN_DEMO_REPO = process.env['DATATUG_E2E_GITHUB_JOIN'] ?? DEMO_REPO;
const GRAPH_DEMO_REPO = process.env['DATATUG_E2E_GITHUB_GRAPH'] ?? DEMO_REPO;
const AUTHOR_URL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/query/chinook-invoice-author?id=chinook-invoice-author&editor=text&env=local';
const COUNT_AUTHOR_URL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/query/chinook-customer-invoice-count?id=chinook-customer-invoice-count&editor=text&env=local';
const CTE_AUTHOR_URL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/query/chinook-customer-count-cte?id=chinook-customer-count-cte&editor=text&env=local';
const CTE_GRAPH_AUTHOR_URL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/query/chinook-customer-count-graph?id=chinook-customer-count-graph&editor=text&env=local';

const savedQuerySource = (queryId: string, repository = DEMO_REPO): string =>
  readFileSync(
    join(repository ?? '', 'demo-project-1', 'queries', 'demodb', `${queryId}.query.dtql`),
    'utf8',
  );

const pasteCode = async (
  page: Page,
  editor: Locator,
  source: string,
): Promise<void> => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((text) => navigator.clipboard.writeText(text), source);
  await editor.click();
  await editor.press('ControlOrMeta+A');
  await editor.press('ControlOrMeta+V');
  await expectEditorSource(page, editor, source);
};

const copyEditorSource = async (_page: Page, editor: Locator): Promise<string> =>
  (await editor.locator('.cm-line').allTextContents()).join('\n');

const expectEditorSource = async (
  page: Page,
  editor: Locator,
  expected: string,
): Promise<void> => {
  const expectedLines = expected.replace(/\r\n|\r/gu, '\n').split('\n');
  const normalized = expectedLines.join('\n');
  await expect.poll(() => copyEditorSource(page, editor)).toBe(normalized);
  await expect
    .poll(() => editor.locator('.cm-line').count())
    .toBe(expectedLines.length);
  const lines = await editor.locator('.cm-line').allTextContents();
  expect(lines).toHaveLength(expectedLines.length);
  expect(await copyEditorSource(page, editor)).toBe(expectedLines.join('\n'));
};

const tokenColor = (token: Locator): Promise<string> =>
  token.evaluate((element) => getComputedStyle(element).color);

const contrastRatio = async (token: Locator): Promise<number> =>
  token.evaluate((element) => {
    const channel = (value: string): number[] =>
      [...value.matchAll(/[\d.]+/gu)].map((match) => Number(match[0]));
    const luminance = (color: string): number => {
      const rgb = channel(color)
        .slice(0, 3)
        .map((value) => {
          const normalized = value / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    let canvas: Element | null = element.closest('.cm-editor') ?? element.closest('.author-sql-scroll');
    if (!canvas) throw new Error('Token is not inside a syntax editor canvas');
    const foregroundColor = getComputedStyle(element).color;
    let backgroundColor = getComputedStyle(canvas).backgroundColor;
    while (backgroundColor === 'rgba(0, 0, 0, 0)' && canvas.parentElement) {
      canvas = canvas.parentElement;
      backgroundColor = getComputedStyle(canvas).backgroundColor;
    }
    const foreground = luminance(foregroundColor);
    const background = luminance(backgroundColor);
    return {
      foregroundColor,
      backgroundColor,
      tokenClass: (element as HTMLElement).className,
      inlineColor: (element as HTMLElement).style.color,
      keywordVariable: getComputedStyle(element.closest('.cm-editor') ?? element).getPropertyValue('--tugql-keyword'),
      ratio:
        (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05),
    };
  }).then(({ ratio }) => ratio);

test.skip(
  !DEMO_REPO,
  'set DATATUG_E2E_GITHUB_FAKE to the demo project checkout containing the saved Author query',
);

test.beforeEach(async ({ context }, testInfo) => {
  if (DEMO_REPO) {
    const repository = testInfo.title.includes('Invoice Customer join')
      ? JOIN_DEMO_REPO
      : testInfo.title.includes('bounded CTE graph')
        ? GRAPH_DEMO_REPO
        : DEMO_REPO;
    await installFakeGithub(context, [
      {
        fullName: 'datatug/datatug-demo-project',
        dir: repository ?? DEMO_REPO,
      },
    ]);
  }
});

test('TugQL and SQL coloring preserves editable source, keyboard undo, and readable palettes', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await author.getByTestId('author-code-tab').click();
  await expect(
    author.getByText('TugQL · Query', { exact: true }),
  ).toBeVisible();
  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  await expect(editor).toHaveAttribute('aria-label', 'TugQL · Query');
  const original = savedQuerySource('chinook-invoice-author');
  const keyword = editor.locator('.tugql-token-keyword').first();
  const parameter = editor.locator('.tugql-token-parameter').first();
  await expect(keyword).toBeVisible();
  await expect(parameter).toBeVisible();
  expect(await contrastRatio(keyword)).toBeGreaterThanOrEqual(4.5);
  expect(await contrastRatio(parameter)).toBeGreaterThanOrEqual(4.5);

  await author.getByTestId('author-preview').click();
  const preview = author.getByTestId('author-sql-preview');
  const sql = preview.locator('pre');
  await expect(sql.locator('.tugql-token-keyword').first()).toBeVisible();
  await expect(sql.locator('.tugql-token-parameter').first()).toBeVisible();
  expect(
    await contrastRatio(sql.locator('.tugql-token-keyword').first()),
  ).toBeGreaterThanOrEqual(4.5);
  await page
    .locator('ion-app')
    .evaluate((app) => app.classList.add('ion-palette-dark'));
  expect(
    await contrastRatio(sql.locator('.tugql-token-keyword').first()),
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    await contrastRatio(sql.locator('.tugql-token-parameter').first()),
  ).toBeGreaterThanOrEqual(4.5);
  await page
    .locator('ion-app')
    .evaluate((app) => app.classList.remove('ion-palette-dark'));
  await expect(author.getByTestId('author-run')).toHaveAttribute('disabled', '');
  await expect(page.getByTestId('author-execution-receipt')).toHaveCount(0);
  await author.getByTestId('author-code-tab').click();

  await editor.click();
  await editor.focus();
  await expect(editor).toBeFocused();
  await editor.press('ControlOrMeta+End');
  await editor.press('Enter');
  await editor.press('ControlOrMeta+End');
  await editor.type('s', { delay: 20 });
  await expectEditorSource(page, editor, `${original}\ns`);
  await editor.type('e', { delay: 20 });
  await expectEditorSource(page, editor, `${original}\nse`);
  await editor.type("lect 'draft', 42 -- temporary edit", { delay: 20 });
  const editedSource = `${original}\nselect 'draft', 42 -- temporary edit`;
  await expectEditorSource(page, editor, editedSource);
  const stringToken = editor.locator('.tugql-token-string').filter({ hasText: "'draft'" });
  const numberToken = editor.locator('.tugql-token-number').filter({ hasText: '42' });
  const commentToken = editor.locator('.tugql-token-comment').filter({ hasText: '-- temporary edit' });
  await expect(stringToken).toContainText("'draft'");
  await expect(numberToken).toContainText('42');
  await expect(editor.locator('.tugql-token-comment')).toContainText(
    '-- temporary edit',
  );
  for (const token of [stringToken, numberToken, commentToken]) {
    expect(await contrastRatio(token)).toBeGreaterThanOrEqual(4.5);
  }
  expect(
    new Set(
      await Promise.all(
        [keyword, parameter, stringToken, numberToken, commentToken].map(
          tokenColor,
        ),
      ),
    ).size,
  ).toBe(5);
  await page
    .locator('ion-app')
    .evaluate((app) => app.classList.add('ion-palette-dark'));
  for (const token of [keyword, parameter, stringToken, numberToken, commentToken]) {
    expect(await contrastRatio(token)).toBeGreaterThanOrEqual(4.5);
  }
  await page
    .locator('ion-app')
    .evaluate((app) => app.classList.remove('ion-palette-dark'));
  await editor.press('ControlOrMeta+Z');
  await expectEditorSource(page, editor, `${original}\n`);
  await editor.press('ControlOrMeta+Z');
  await expectEditorSource(page, editor, original);

  await editor.locator('.cm-line').last().click();
  await editor.press('End');
  await editor.type('-- echoed through parent');
  const parentEcho = `${original}-- echoed through parent`;
  await author.getByTestId('author-compose-tab').click();
  await author.getByTestId('author-code-tab').click();
  const remountedEditor = author.getByTestId('query-body-text').locator('.cm-content');
  await expectEditorSource(page, remountedEditor, parentEcho);
  await remountedEditor.locator('.cm-line').last().click();
  await remountedEditor.press('Tab');
  await expect(remountedEditor).not.toBeFocused();

  await page.setViewportSize({ width: 320, height: 780 });
  const editorScroller = author.getByTestId('query-body-text').locator('.cm-scroller');
  await expect
    .poll(() =>
      editorScroller.evaluate((element) => element.scrollWidth - element.clientWidth),
    )
    .toBeLessThanOrEqual(1);

});

test('Compose HAVING edits replace the shared draft before Preview and worker Run', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(COUNT_AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });

  const threshold = author.getByRole('spinbutton', {
    name: 'HAVING threshold',
  });
  await threshold.fill('8');
  await threshold.press('Tab');
  await author.getByTestId('author-code-tab').click();
  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  await expect
    .poll(() => copyEditorSource(page, editor))
    .toContain('having count(*) >= 8');

  await author.getByTestId('author-preview').click();
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toContainText('Preview · Not executed');
  await expect(preview.locator('pre')).toContainText('HAVING COUNT(*) >= ?');
  await expect(preview.locator('pre')).not.toContainText('>= 8');

  await author.getByTestId('author-customer-id').locator('input').fill('1');
  await author.getByTestId('author-run').click();
  const receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('Executed');
  await expect(receipt).toContainText('0 rows');
  await expect(page.getByRole('grid').getByRole('row')).toHaveCount(1);

  await author.getByTestId('author-compose-tab').click();
  const thresholdControl = author.getByRole('spinbutton', {
    name: 'HAVING threshold',
  });
  await thresholdControl.fill('8.5');
  await thresholdControl.press('Tab');
  await expect(thresholdControl).toHaveValue('8');
  await expect(author.getByRole('alert')).toContainText(
    'Enter a whole-number HAVING threshold',
  );
  await author.getByTestId('author-code-tab').click();
  await expect
    .poll(() => copyEditorSource(page, editor))
    .toContain('having count(*) >= 8');
});

test('Customer count CTE previews without values and runs against the pinned fixture', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto(CTE_AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await author.getByTestId('author-preview').click();
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toContainText('Preview · Not executed');
  await expect(preview).toContainText('Required · unset');
  await expect(preview.locator('pre')).toContainText('HAVING COUNT(*) >= ?');
  await expect(preview.locator('pre')).not.toContainText('>= 7');
  await expect(preview.locator('pre')).not.toContainText('= 1');
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  await author.getByTestId('author-customer-id').locator('input').fill('1');
  await author.getByTestId('author-run').click();
  const receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('Executed');
  await expect(receipt).toContainText('1 row');
  const rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(2);
  const resultCells = rows.nth(1).getByRole('gridcell');
  await expect(resultCells.nth(0)).toHaveText('1');
  await expect(resultCells.nth(1)).toHaveText('7');
  await expect(resultCells.nth(2)).toHaveText('Luís');
  await expect(resultCells.nth(3)).toHaveText('Gonçalves');
  const lastNameCell = page.getByRole('gridcell', {
    name: 'Gonçalves',
    exact: true,
  });
  await lastNameCell.click();
  await lastNameCell.press('ArrowRight');
  const resultGrid = page.getByRole('grid');
  await expect(
    resultGrid.getByRole('columnheader', { name: 'Email', exact: true }),
  ).toBeVisible();
  await expect(
    resultGrid.getByRole('gridcell', {
      name: 'luisg@embraer.com.br',
      exact: true,
    }),
  ).toBeVisible();
  await expect(receipt).not.toContainText('Worker-verified relationship');

  await author.getByTestId('author-code-tab').click();
  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  const original = savedQuerySource('chinook-customer-count-cte');
  await pasteCode(page, editor,
    original.replace('having count(*) >= 7', 'having count(*) >= 8'),
  );
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
  await expect(receipt).toContainText('Executed');

  await author.getByTestId('author-preview').click();
  await expect(
    author.getByTestId('author-sql-preview').locator('pre'),
  ).toContainText('HAVING COUNT(*) >= ?');
  await expect(author.getByTestId('author-run')).toBeEnabled();
  await author.getByTestId('author-run').click();
  await expect(receipt).toContainText('0 rows');
});

test('bounded CTE graph previews, runs, preserves results while stale, and runs zero rows', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(CTE_GRAPH_AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await author.getByTestId('author-code-tab').click();
  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  const original = savedQuerySource('chinook-customer-count-graph', GRAPH_DEMO_REPO);
  await expect(editor).toContainText(/with CustomerCounts as \(/u);
  await expect(editor).toContainText(/with EligibleCounts as \(/u);
  await expect(editor).toContainText(/with CustomerFields as \(/u);

  await author.getByTestId('author-preview').click();
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toContainText('Preview · Not executed');
  await expect(preview).toContainText('Required · unset');
  await expect(preview.locator('pre')).toContainText('HAVING COUNT(*) >= ?');
  await expect(preview.locator('pre')).not.toContainText('>= 7');
  await expect(preview.locator('pre')).not.toContainText('= 1');
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  await author.getByTestId('author-customer-id').locator('input').fill('1');
  await author.getByTestId('author-run').click();
  const receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('Executed');
  await expect(receipt).toContainText('1 row');
  const rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(2);
  const resultCells = rows.nth(1).getByRole('gridcell');
  await expect(resultCells.nth(0)).toHaveText('1');
  await expect(resultCells.nth(1)).toHaveText('7');
  await expect(resultCells.nth(2)).toHaveText('Luís');
  await expect(resultCells.nth(3)).toHaveText('Gonçalves');
  const lastNameCell = page.getByRole('gridcell', {
    name: 'Gonçalves',
    exact: true,
  });
  await lastNameCell.click();
  await lastNameCell.press('ArrowRight');
  const resultGrid = page.getByRole('grid');
  await expect(
    resultGrid.getByRole('columnheader', { name: 'Email', exact: true }),
  ).toBeVisible();
  await expect(
    resultGrid.getByRole('gridcell', {
      name: 'luisg@embraer.com.br',
      exact: true,
    }),
  ).toBeVisible();
  const retainedExecutionId = (await receipt.textContent())?.match(
    /Worker execution ID ([0-9a-f-]+)/u,
  )?.[1];
  expect(retainedExecutionId).toBeTruthy();
  await pasteCode(page, editor,
    original.replace(
      'where counts.InvoiceCount >= 7',
      'where counts.InvoiceCount >= 8',
    ),
  );
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
  await expect(receipt.locator('.author-receipt-status')).toHaveText(
    'Previous run',
  );
  expect(await receipt.textContent()).toContain(
    `Worker execution ID ${retainedExecutionId}`,
  );
  await expect(rows).toHaveCount(2);
  const retainedCountCell = resultGrid.getByRole('gridcell', {
    name: '7',
    exact: true,
  });
  await retainedCountCell.click();
  await retainedCountCell.press('ArrowLeft');
  await expect(
    resultGrid.getByRole('columnheader', {
      name: 'CustomerId',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    resultGrid.getByRole('gridcell', { name: '1', exact: true }),
  ).toBeVisible();

  await author.getByTestId('author-preview').click();
  await expect(
    author.getByTestId('author-sql-preview').locator('pre'),
  ).toContainText('HAVING COUNT(*) >= ?');
  await expect(author.getByTestId('author-run')).toBeEnabled();
  await author.getByTestId('author-run').click();
  await expect(receipt).toContainText('0 rows');

  await pasteCode(page, editor, original);
  expect(await copyEditorSource(page, editor)).toBe(original);
});

test('Code formats TugQL reversibly before explicit Preview and worker Run', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await author.getByTestId('author-code-tab').click();
  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  const original = savedQuerySource('chinook-invoice-author');
  const mixed = original
    .replace(/^(\s*)from\b/imu, '$1FrOm')
    .replace(/^(\s*)where\b/imu, '$1WhErE')
    .replace(/^(\s*)limit\b/imu, '$1LiMiT')
    .replace(/^(\s*)select\b/imu, '$1sElEcT')
    .replace(/^( {2,})/gmu, '\t');
  expect(mixed).not.toBe(original);
  await pasteCode(page, editor, mixed);
  await expectEditorSource(page, editor, mixed);

  await author.getByTestId('author-format-tugql').click();
  await expect(author.getByTestId('author-format-status')).toHaveText(
    'TugQL formatted.',
  );
  const formatted = await copyEditorSource(page, editor);
  expect(formatted).not.toBe(mixed);
  await expectEditorSource(
    page,
    editor,
    mixed.replace(
      /^(\s*)(FrOm|WhErE|LiMiT|sElEcT)\b/gimu,
      (_match, indentation: string, keyword: string) =>
        `${indentation}${keyword.toLowerCase()}`,
    ),
  );
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
  await expect(page.getByTestId('author-execution-receipt')).toHaveCount(0);

  await author.getByTestId('author-undo-format').click();
  await expectEditorSource(page, editor, mixed);
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);

  const malformed = mixed.replace(
    /^(\s*)where\b.*$/imu,
    "$1WHERE i.Name = 'Mixed\nCase'",
  );
  expect(malformed).not.toBe(mixed);
  await pasteCode(page, editor, malformed);
  await expectEditorSource(page, editor, malformed);
  await author.getByTestId('author-format-tugql').click();
  await expectEditorSource(page, editor, malformed);
  const formatStatus = author.getByTestId('author-format-status');
  await expect(formatStatus).toContainText(
    'TugQL was not changed: quoted value cannot continue across lines',
  );
  expect(
    (await formatStatus.innerText()).match(
      /quoted value cannot continue across lines/gu,
    ),
  ).toHaveLength(1);
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
  await expect(page.getByTestId('author-execution-receipt')).toHaveCount(0);
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  await pasteCode(page, editor, mixed);
  await expectEditorSource(page, editor, mixed);

  await author.getByTestId('author-format-tugql').click();
  await expect(editor).not.toContainText(mixed);
  await author.getByTestId('author-preview').click();
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toContainText('Preview · Not executed');
  await expect(preview).toContainText('Required · unset');
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  await author.getByTestId('author-customer-id').locator('input').fill('1');
  await author.getByTestId('author-run').click();
  const receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('Executed');
  await expect(receipt).toContainText('7 rows');
  const rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(8);
  for (const [index, invoiceId] of [
    '98',
    '121',
    '143',
    '195',
    '316',
    '327',
    '382',
  ].entries()) {
    await expect(
      rows
        .nth(index + 1)
        .getByRole('gridcell')
        .first(),
    ).toHaveText(invoiceId);
  }
  await expect(author.getByTestId('author-format-status')).toHaveText(
    'TugQL formatted.',
  );
});

test('Invoice Customer join makes missing ON reviewable and opens an explicit typed lookup', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(
    '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/query/chinook-customer-invoice-join?id=chinook-customer-invoice-join&editor=text&env=local',
  );
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await expect(
    author.getByRole('button', { name: 'Code', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  const original = savedQuerySource('chinook-customer-invoice-join', JOIN_DEMO_REPO);
  const missingOn = original.replace(
    /join Customer as c\r?\n\s*on i\.CustomerId = c\.CustomerId\r?\n/u,
    'join Customer as c -- preserve this relationship note\n',
  );
  expect(missingOn).not.toBe(original);
  await pasteCode(page, editor, missingOn);
  await author.getByTestId('author-preview').click();

  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toContainText('Preview · Not executed');
  await expect(editor).toContainText(/on i\.CustomerId = c\.CustomerId/u);
  await expect(editor).toContainText(/-- preserve this relationship note/u);
  const sourceInspector = preview.getByTestId('author-source-inspector');
  await expect(sourceInspector.locator(':scope > summary')).toHaveText(
    'Sources and relationships',
  );
  await expect(sourceInspector).not.toHaveAttribute('open', '');
  await sourceInspector.locator(':scope > summary').click();
  const preparedMetadata = preview.getByTestId('author-source-metadata');
  await expect(preparedMetadata).toContainText('chinook-sqlite');
  await expect(preparedMetadata).toContainText(
    'FK_Invoice_Customer_CustomerId',
  );
  const declaredRelationship = preparedMetadata.locator(
    '[aria-label="Prepared relationship"]',
  );
  const relationshipPairs = declaredRelationship.locator('li');
  await expect(relationshipPairs).toHaveCount(1);
  await expect(relationshipPairs.first()).toHaveText(
    'i.CustomerId → c.CustomerId',
  );
  await expect(
    declaredRelationship.getByText('Relationship definition fingerprint'),
  ).toBeVisible();
  await expect(
    declaredRelationship.locator('.author-source-fingerprint'),
  ).not.toHaveAttribute('open', '');
  await expect(preparedMetadata).toContainText(
    'Prepared metadata · not worker-verified or executed.',
  );
  await expect(preview.locator('pre')).toContainText(
    'INNER JOIN "Customer" AS "c" ON "i"."CustomerId" = "c"."CustomerId"',
  );
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  await author.getByTestId('author-customer-id').locator('input').fill('1');
  await author.getByTestId('author-run').click();
  const joinReceipt = page.getByTestId('author-execution-receipt');
  await expect(joinReceipt).toContainText('Executed');
  await expect(joinReceipt).toContainText('7 rows');
  await expect(joinReceipt).toContainText('Worker-verified relationship');
  let rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(1)).toContainText('98');
  await expect(rows.nth(7)).toContainText('382');

  const firstRunAction = await page
    .getByRole('button', { name: 'Look up invoices for Customer ID 1' })
    .first()
    .elementHandle();
  expect(firstRunAction).not.toBeNull();
  await author.getByTestId('author-customer-id').locator('input').fill('2');
  await expect(
    page.getByRole('button', { name: 'Look up invoices for Customer ID 1' }),
  ).toHaveCount(0);
  await expect(author.getByTestId('author-binding-origin')).toContainText(
    'manual · client-reported',
  );
  await author.getByTestId('author-run').click();
  await expect(joinReceipt).toContainText('Customer ID 2');
  await expect(
    rows
      .nth(1)
      .getByRole('button', { name: 'Look up invoices for Customer ID 2' }),
  ).toBeVisible();
  await firstRunAction?.evaluate((button) => button.click());
  await expect(page).toHaveURL(/id=chinook-customer-invoice-join/u);
  await author.getByTestId('author-customer-id').locator('input').fill('1');
  await joinReceipt.getByText('Execution details', { exact: true }).click();
  const executionId = joinReceipt.getByText(/^Worker execution ID /u);
  const previousExecutionId = await executionId.textContent();
  await author.getByTestId('author-run').click();
  // The previous CustomerId=2 run has the same row count, so waiting only for
  // “7 rows” can race the refreshed grid and start keyboard navigation against
  // the old receipt. Bind the keyboard journey to the new worker execution.
  await expect(executionId).not.toHaveText(previousExecutionId ?? '');
  await expect(joinReceipt).toContainText('Customer ID 1');
  await expect(joinReceipt).toContainText('7 rows');
  await expect(rows.nth(1)).toContainText('98');
  await expect(
    rows
      .nth(1)
      .getByRole('button', { name: 'Look up invoices for Customer ID 1' }),
  ).toBeVisible();

  const lookupActions = page.getByRole('button', {
    name: 'Look up invoices for Customer ID 1',
  });
  const firstLookupAction = lookupActions.nth(0);
  const firstResultRow = rows.nth(1);
  const invoiceIdCell = firstResultRow.getByRole('gridcell').nth(0);
  const customerIdCell = firstResultRow.getByRole('gridcell').nth(1);
  const firstNameCell = firstResultRow.getByRole('gridcell').nth(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#workspace-results-tab').click();
  await expect(page.locator('#workspace-results-pane')).toBeVisible();
  await expect(firstLookupAction).toBeVisible();
  await invoiceIdCell.click();
  await page.keyboard.press('Tab');
  await expect(customerIdCell).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(firstLookupAction).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(firstNameCell).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(customerIdCell).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(invoiceIdCell).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(customerIdCell).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(firstLookupAction).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/id=chinook-invoice-author/u);
  const lookupAuthor = page.getByTestId('tugql-author');
  await expect(lookupAuthor).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Editor', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#workspace-editor-pane')).toBeVisible();
  await expect(lookupAuthor.locator('ion-card-title')).toBeFocused();
  await expect(
    lookupAuthor.getByTestId('author-customer-id').locator('input'),
  ).toHaveValue('1');
  await expect(page.getByTestId('author-results-empty')).toHaveCount(1);
  await expect(lookupAuthor.getByTestId('author-binding-origin')).toContainText(
    'selection · client-reported',
  );
  await expect(lookupAuthor.getByTestId('author-binding-origin')).toContainText(
    'chinook-customer-invoice-join.CustomerId',
  );
  await expect(lookupAuthor.getByTestId('author-binding-origin')).toContainText(
    'Chinook Invoice Author',
  );
  await expect(lookupAuthor.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );
  await expect(page.getByTestId('author-execution-receipt')).toHaveCount(0);

  await lookupAuthor.getByTestId('author-preview').click();
  await expect(lookupAuthor.getByTestId('author-run')).toBeEnabled();
  await expect(page.getByTestId('author-execution-receipt')).toHaveCount(0);
  await lookupAuthor.getByTestId('author-run').click();
  await page.locator('#workspace-results-tab').click();
  await expect(page.locator('#workspace-results-pane')).toBeVisible();
  const lookupReceipt = page.getByTestId('author-execution-receipt');
  await expect(lookupReceipt).toContainText('Executed');
  await expect(lookupReceipt).toContainText('7 rows');
  await lookupReceipt.getByText('Execution details').click();
  await expect(lookupReceipt).toContainText(
    'Input origin: selection · client-reported',
  );
  await expect(lookupReceipt).toContainText(
    'chinook-customer-invoice-join.CustomerId',
  );
  rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(1)).toContainText('98');
});

test('cold saved CustomerId count supports parameterized HAVING thresholds in the worker', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.goto(COUNT_AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  const customerId = author.getByTestId('author-customer-id').locator('input');
  await expect(customerId).toBeVisible();
  await customerId.fill('');
  await author.getByTestId('author-preview').click();
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Preview · Not executed');
  await expect(preview).toContainText('?1');
  await expect(preview).toContainText('@CustomerId · integer');
  await expect(preview).toContainText('Required · unset');
  await expect(preview).toContainText('HAVING threshold · integer literal');
  await expect(preview).toContainText('?2');
  await expect(preview).toContainText('7');
  const sourceInspector = preview.getByTestId('author-source-inspector');
  await sourceInspector.locator(':scope > summary').click();
  const preparedMetadata = preview.getByTestId('author-source-metadata');
  await expect(preparedMetadata).toContainText('chinook-sqlite');
  await expect(preparedMetadata).toContainText(
    'Column lineage is unavailable for this preview.',
  );
  await expect(preparedMetadata).not.toContainText('Declared relationship');
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );
  await author.getByTestId('author-code-tab').click();
  await expect(customerId).toBeVisible();
  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  await expect(editor).toContainText(/count\(\*\) >= 7/u);
  const thresholdSql = await preview.locator('pre').textContent();
  expect(thresholdSql).toContain('GROUP BY "i"."CustomerId"');
  expect(thresholdSql).toContain('HAVING COUNT(*) >= ?');
  expect(thresholdSql).not.toContain('>= 7');
  await customerId.fill('1');
  await expect(preview.locator('pre')).toHaveText(thresholdSql ?? '');
  await expect(author.getByTestId('author-run')).toBeEnabled();
  await author.getByTestId('author-run').click();

  let receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('Executed');
  await expect(receipt).toContainText('1 row');
  await expect(receipt).toContainText('Customer ID 1');
  let rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('1');
  await expect(rows.nth(1)).toContainText('7');
  await expect(receipt).toContainText('Loaded in');
  await expect(page.getByTestId('result-provenance')).toHaveCount(0);
  await expect(page.getByTestId('query-run-timings')).toHaveCount(0);
  const composeTab = author.getByTestId('author-compose-tab');
  const codeTab = author.getByTestId('author-code-tab');
  await composeTab.click();
  await expect(editor).toHaveCount(0);
  await expect(composeTab).toHaveAttribute('fill', 'solid');
  await expect(codeTab).toHaveAttribute('fill', 'clear');
  await expect(composeTab).toHaveClass(/button-solid/u);
  await expect(codeTab).toHaveClass(/button-clear/u);
  await expect(composeTab).toHaveAttribute('aria-pressed', 'true');
  await expect(codeTab).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.screenshot({
    path: testInfo.outputPath('query-author-having-success.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await author.getByTestId('author-code-tab').click();
  await expect(editor).toBeVisible();
  await receipt.getByText('Execution details').click();
  await expect(receipt).toContainText('HAVING threshold (literal)');

  const aboveSeven = savedQuerySource('chinook-customer-count-cte').replace('>= 7', '> 7');
  await pasteCode(page, editor, aboveSeven);
  await expect(receipt).toContainText('Previous run');
  await expect(receipt).toContainText('1 row');
  await author.getByTestId('author-preview').click();
  const strictThresholdSql = await preview.locator('pre').textContent();
  expect(strictThresholdSql).toContain('HAVING COUNT(*) > ?');
  expect(strictThresholdSql).not.toContain('> 7');
  await author.getByTestId('author-run').click();

  receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('Executed');
  await expect(receipt).toContainText('0 rows');
  await expect(receipt).toContainText('Customer ID 1');
  await expect(receipt).toContainText('Loaded in');
  rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(1);
});

test('cold saved Chinook query previews and runs the same bound TugQL plan in the real SQLite worker', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  let workersStarted = 0;
  page.on('worker', () => workersStarted++);
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await expect(author.getByTestId('author-compose-tab')).toBeVisible();
  await expect(author.getByTestId('author-code-tab')).toBeVisible();
  await expect(page.getByTestId('author-results-empty')).toBeVisible();
  await expect(page.locator('#workspace-editor-pane')).toBeVisible();
  await expect(page.locator('#workspace-results-pane')).toBeVisible();
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  const invoiceDate = author.getByLabel('InvoiceDate', { exact: true });
  await expect(invoiceDate).toBeChecked();
  await invoiceDate.uncheck();
  await author.getByTestId('author-code-tab').click();
  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  await expect(editor).toContainText(/select i\.InvoiceId\s*$/u);
  await expect(editor).not.toContainText(/InvoiceDate/u);
  await author.getByTestId('author-compose-tab').click();
  await expect(invoiceDate).not.toBeChecked();
  await invoiceDate.check();

  await author.getByTestId('author-code-tab').click();
  const sourceDiscovery = author.getByTestId('author-source-discovery');
  await sourceDiscovery.locator('summary').click();
  await expect(sourceDiscovery).toContainText('Invoice.InvoiceDate', {
    timeout: 20_000,
  });
  await expect(sourceDiscovery).toContainText('Customer.FirstName');
  await expect(sourceDiscovery).toContainText('Customer.Email');
  await expect(sourceDiscovery).toContainText(
    'many invoices to one customer · declared',
  );
  await sourceDiscovery.getByTestId('author-source-review').click();
  const review = sourceDiscovery.getByTestId('author-source-review-panel');
  await expect(review.getByLabel('Customer.FirstName')).toBeChecked();
  await expect(review.getByLabel('Customer.LastName')).not.toBeChecked();
  await expect(review.getByLabel('Customer.Email')).not.toBeChecked();
  await expect(review).toContainText('InvoiceDate');
  await expect(review).toContainText('Current LIMIT');
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
  await sourceDiscovery.getByTestId('author-source-apply').click();
  await expect(
    sourceDiscovery.getByTestId('author-source-status'),
  ).toContainText('Applied the reviewed join and binding', { timeout: 20_000 });
  await author.getByTestId('author-code-tab').click();
  await expect(editor).toContainText(/join Customer as c/u);
  await expect(editor).toContainText(/@CustomerId integer required/u);
  await expect(editor).toContainText(/i\.InvoiceDate/u);
  await expect(editor).toContainText(/c\.FirstName/u);
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );
  expect(workersStarted).toBe(0);

  const customerId = author.getByTestId('author-customer-id').locator('input');
  await customerId.fill('');
  await author.getByTestId('author-preview').click();
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('SQL preview');
  await expect(preview).toContainText('Preview · Not executed');
  await expect(preview).toContainText('Preview never executes the query');
  await expect(preview).toContainText('Required · unset');
  const previewSql = await preview.locator('pre').textContent();
  expect(previewSql).toContain('WHERE "i"."CustomerId" = ?');
  expect(previewSql).toContain('"c"."FirstName"');
  expect(previewSql).toContain('"i"."InvoiceDate"');
  expect(previewSql).toContain('LIMIT 100');
  expect(previewSql).not.toContain('= 1');
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );
  expect(workersStarted).toBe(0);

  await customerId.fill('1.5');
  await expect(preview).toContainText('Invalid · enter a whole number');
  await expect(
    author.getByText('Enter a whole-number Customer ID'),
  ).toBeVisible();
  await expect(customerId).toHaveAttribute('aria-invalid', 'true');
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  await customerId.fill('1');
  await expect(preview.locator('pre')).toHaveText(previewSql ?? '');
  await expect(author.getByTestId('author-run')).toBeEnabled();
  await author.getByTestId('author-run').click();
  const receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toBeVisible({ timeout: 20_000 });
  await expect(receipt).toContainText('Executed');
  await expect(receipt).toContainText('7 rows');
  await expect.poll(() => workersStarted).toBe(1);
  await expect(receipt).toContainText('Customer ID 1');
  await expect(receipt).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('query-author-browser-success.png'),
    fullPage: true,
  });
  const executionDetails = receipt.getByText('Execution details');
  await executionDetails.click();
  await expect(receipt).toContainText('Worker execution ID');
  await expect(receipt).toContainText('Input origin: manual · client-reported');
  await expect(receipt).toContainText(
    'The executed request matched the preview at Run time',
  );
  await expect(receipt).toContainText('Loaded in');
  await expect(page.getByTestId('result-provenance')).toHaveCount(0);
  await expect(page.getByTestId('query-run-timings')).toHaveCount(0);
  const executionId = await receipt.textContent();
  expect(executionId).toMatch(/execution ID [0-9a-f-]{36}/iu);
  const rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(1)).toContainText('98');
  await expect(rows.nth(1)).toContainText('2022-03-11 00:00:00');
  await expect(rows.nth(1)).toContainText('Luís');
  await expect(rows.nth(7)).toContainText('382');
  expect(errors).toEqual([]);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const resultsView = page.locator('#workspace-results-tab');
    await resultsView.click();
    await expect(resultsView).toHaveAttribute('aria-pressed', 'true');
    await expect(receipt).toBeVisible();
    const editorView = page.locator('#workspace-editor-tab');
    await editorView.click();
    await expect(editorView).toHaveAttribute('aria-pressed', 'true');
    await expect(author).toBeVisible();
    const header = await page.evaluate(() => {
      const bounds = (selector: string): DOMRect | undefined =>
        document.querySelector(selector)?.getBoundingClientRect();
      const start = bounds('ion-toolbar ion-buttons[slot="start"]');
      const title = bounds('.query-page-title');
      const end = bounds('ion-toolbar ion-buttons[slot="end"]');
      return {
        startRight: start?.right,
        titleLeft: title?.left,
        titleRight: title?.right,
        endLeft: end?.left,
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
      };
    });
    expect(header.startRight).toBeLessThanOrEqual(header.titleLeft ?? -1);
    expect(header.titleRight).toBeLessThanOrEqual(header.endLeft ?? -1);
    expect(header.documentWidth).toBeLessThanOrEqual(header.viewportWidth);
  }

  // Ionic chooses its mode during the first page bootstrap, so use a fresh
  // navigation to exercise the iOS header layout explicitly.
  await page.goto(`${AUTHOR_URL}&ionic:mode=ios`);
  const queryToolbar = page.locator('ion-toolbar.toolbar-label');
  await expect(queryToolbar).toHaveClass(/\bios\b/u);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const header = await page.evaluate(() => {
      const bounds = (selector: string): DOMRect | undefined =>
        document.querySelector(selector)?.getBoundingClientRect();
      const start = bounds('ion-toolbar ion-buttons[slot="start"]');
      const title = bounds('.query-page-title');
      const end = bounds('ion-toolbar ion-buttons[slot="end"]');
      return {
        startRight: start?.right,
        titleLeft: title?.left,
        titleRight: title?.right,
        endLeft: end?.left,
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
      };
    });
    expect(header.startRight).toBeLessThanOrEqual(header.titleLeft ?? -1);
    expect(header.titleRight).toBeLessThanOrEqual(header.endLeft ?? -1);
    expect(header.documentWidth).toBeLessThanOrEqual(header.viewportWidth);
  }

  // Start from the saved unjoined source again, then choose Email explicitly.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(AUTHOR_URL);
  const secondAuthor = page.getByTestId('tugql-author');
  await expect(secondAuthor).toBeVisible({ timeout: 20_000 });
  const secondDiscovery = secondAuthor.getByTestId('author-source-discovery');
  await secondDiscovery.locator('summary').click();
  await expect(secondDiscovery).toContainText('Customer.Email', {
    timeout: 20_000,
  });
  await secondDiscovery.getByTestId('author-source-review').click();
  const secondReview = secondDiscovery.getByTestId(
    'author-source-review-panel',
  );
  await secondReview.getByLabel('Customer.FirstName').uncheck();
  await secondReview.getByLabel('Customer.Email').check();
  await secondDiscovery.getByTestId('author-source-apply').click();
  await expect(
    secondDiscovery.getByTestId('author-source-status'),
  ).toContainText('Applied the reviewed join and binding', { timeout: 20_000 });
  expect(workersStarted).toBe(1);
  await secondAuthor.getByTestId('author-preview').click();
  const secondPreview = secondAuthor.getByTestId('author-sql-preview');
  await expect(secondPreview).toBeVisible();
  const secondPreviewSql = await secondPreview.locator('pre').textContent();
  expect(secondPreviewSql).toContain('"c"."Email"');
  await secondAuthor
    .getByTestId('author-customer-id')
    .locator('input')
    .fill('1');
  await expect(secondAuthor.getByTestId('author-run')).toBeEnabled();
  expect(workersStarted).toBe(1);
  await secondAuthor.getByTestId('author-run').click();
  await expect(page.getByTestId('author-execution-receipt')).toContainText(
    '7 rows',
    { timeout: 20_000 },
  );
  await expect.poll(() => workersStarted).toBe(2);
  const secondRows = page.getByRole('grid').getByRole('row');
  await expect(secondRows).toHaveCount(8);
  await expect(secondRows.nth(1)).toContainText('2022-03-11 00:00:00');
  await expect(secondRows.nth(1)).toContainText('luisg@embraer.com.br');
  expect(errors).toEqual([]);
});

test('multiline SELECT requires a block while compact and canonical queries preview identically', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await author.getByTestId('author-code-tab').click();

  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  const customerId = author.getByTestId('author-customer-id').locator('input');
  await customerId.fill('');
  const compactSource = savedQuerySource('chinook-invoice-author');
  expect(compactSource).toMatch(/select i\.InvoiceId, i\.InvoiceDate\s*$/u);

  const bareMultilineSource = compactSource.replace(
    /select i\.InvoiceId, i\.InvoiceDate\s*$/u,
    'select\n  i.InvoiceId\n  i.InvoiceDate',
  );
  expect(bareMultilineSource).not.toBe(compactSource);
  await pasteCode(page, editor, bareMultilineSource);
  await author.getByTestId('author-preview').click();

  await expect(author.getByTestId('author-error')).toContainText(
    "multiline SELECT requires '(' on the SELECT header line",
  );
  await expectEditorSource(page, editor, bareMultilineSource);
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  const blockSource = compactSource.replace(
    /select i\.InvoiceId, i\.InvoiceDate\s*$/u,
    'select (\n  i.InvoiceId\n  i.InvoiceDate\n)',
  );
  await pasteCode(page, editor, blockSource);
  await author.getByTestId('author-preview').click();

  const blockPreview = author.getByTestId('author-sql-preview');
  await expect(blockPreview).toBeVisible();
  await expect(blockPreview).toContainText('Required · unset');
  await expect(author.getByTestId('author-error')).toHaveCount(0);
  const blockSql = await blockPreview.locator('pre').textContent();
  expect(blockSql).toContain('"i"."InvoiceId"');
  expect(blockSql).toContain('"i"."InvoiceDate"');
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  await pasteCode(page, editor, compactSource);
  await author.getByTestId('author-preview').click();
  const compactPreview = author.getByTestId('author-sql-preview');
  await expect(compactPreview).toBeVisible();
  await expect(compactPreview).toContainText('Required · unset');
  await expect(compactPreview.locator('pre')).toHaveText(blockSql ?? '');
  await expect(author.getByTestId('author-error')).toHaveCount(0);
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );
});
