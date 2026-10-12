import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installFakeGithub } from './helpers/fake-github';
import { activePage } from './journey/helpers/active-page';

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
const PLAYLIST_SQL_URL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/query/chinook-playlist-composition?id=chinook-playlist-composition&editor=text&env=local';
const LONG_HEADER_QUERY_TITLE =
  '請求書・顧客向けの長いタイトル — Invoice Author 🚀 東京';
const LONG_HEADER_PROJECT_TITLE =
  'データベース・デモ用プロジェクト — DemoDB datasets 🌍';

// @codemirror/autocomplete's installed default; Enter is intentionally ignored
// until the option has been visible for this interaction window.
const COMPLETION_INTERACTION_DELAY_MS = 75;

// Playwright resolves ControlOrMeta from the host OS, but CodeMirror treats
// iPhone/iPad/iPod UAs as Mac and binds Mod to Meta.
const codeMirrorMod = async (page: Page): Promise<'Meta' | 'ControlOrMeta'> =>
  /iPhone|iPad|iPod/u.test(await page.evaluate(() => navigator.userAgent))
    ? 'Meta'
    : 'ControlOrMeta';

const savedQuerySource = (queryId: string, repository = DEMO_REPO): string =>
  readFileSync(
    join(
      repository ?? '',
      'demo-project-1',
      'queries',
      'demodb',
      `${queryId}.query.dtql`,
    ),
    'utf8',
  );

const savedSqlSource = (queryId: string, repository = DEMO_REPO): string =>
  readFileSync(
    join(
      repository ?? '',
      'demo-project-1',
      'queries',
      'demodb',
      `${queryId}.query.sql`,
    ),
    'utf8',
  );

const installLongHeaderMetadataVariant = async (page: Page): Promise<void> => {
  if (!DEMO_REPO) throw new Error('The canonical DemoDB fixture is required');

  const variants = [
    {
      relativePath: 'demo-project-1/datatug-project.json',
      originalTitle: 'DataTug Demo: DemoDB datasets',
      title: LONG_HEADER_PROJECT_TITLE,
    },
    {
      relativePath:
        'demo-project-1/queries/demodb/chinook-invoice-author.query.json',
      originalTitle: 'Chinook Invoice Author',
      title: LONG_HEADER_QUERY_TITLE,
    },
  ];

  for (const variant of variants) {
    const source = readFileSync(join(DEMO_REPO, variant.relativePath), 'utf8');
    const original = JSON.stringify(variant.originalTitle);
    const occurrences = source.split(original).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `Expected one title in ${variant.relativePath}, found ${occurrences}`,
      );
    }
    const body = source.replace(original, JSON.stringify(variant.title));
    const relativePath = variant.relativePath;
    await page.route(
      (url) =>
        url.hostname === 'raw.githubusercontent.com' &&
        url.pathname.endsWith(`/${relativePath}`),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'text/plain; charset=utf-8',
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
            'access-control-allow-methods': 'GET, OPTIONS',
          },
          body,
        });
      },
    );
  }
};

const pasteCode = async (
  page: Page,
  editor: Locator,
  source: string,
): Promise<void> => {
  await editor.click();
  await editor.press(`${await codeMirrorMod(page)}+A`);
  if (page.context().browser()?.browserType().name() === 'webkit') {
    // WebKit does not support Playwright's Chromium clipboard permission
    // grant. insertText still follows the focused editor's native input path.
    await page.keyboard.insertText(source);
  } else {
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate((text) => navigator.clipboard.writeText(text), source);
    await editor.press('ControlOrMeta+V');
  }
  await expectEditorSource(page, editor, source);
};

const copyEditorSource = async (
  _page: Page,
  editor: Locator,
): Promise<string> =>
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
  token
    .evaluate((element) => {
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
      let canvas: Element | null =
        element.closest('.cm-editor') ?? element.closest('.author-sql-scroll');
      if (!canvas)
        throw new Error('Token is not inside a syntax editor canvas');
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
        keywordVariable: getComputedStyle(
          element.closest('.cm-editor') ?? element,
        ).getPropertyValue('--tugql-keyword'),
        ratio:
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05),
      };
    })
    .then(({ ratio }) => ratio);

type RgbaColor = { red: number; green: number; blue: number; alpha: number };

const parseCssColor = (value: string): RgbaColor => {
  const match = /^rgba?\((.*)\)$/iu.exec(value.trim());
  if (!match)
    throw new Error(`Cannot calculate contrast for CSS color ${value}`);
  const [channels, alphaValue] = match[1].split(/\s*\/\s*/u);
  const parts = channels.includes(',')
    ? channels.split(/\s*,\s*/u)
    : channels.trim().split(/\s+/u);
  const alphaPart = alphaValue ?? parts[3];
  if (parts.length < 3 || parts.length > 4) {
    throw new Error(`Cannot calculate contrast for CSS color ${value}`);
  }
  const channel = (part: string): number => {
    const percentage = part.endsWith('%');
    const number = Number.parseFloat(part);
    if (!Number.isFinite(number)) {
      throw new Error(`Cannot calculate contrast for CSS color ${value}`);
    }
    const result = percentage ? (number * 255) / 100 : number;
    if (result < 0 || result > 255) {
      throw new Error(`CSS color channel is out of range: ${value}`);
    }
    return result;
  };
  const alpha =
    alphaPart === undefined
      ? 1
      : alphaPart.endsWith('%')
        ? Number.parseFloat(alphaPart) / 100
        : Number.parseFloat(alphaPart);
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new Error(`CSS color alpha is out of range: ${value}`);
  }
  return {
    red: channel(parts[0]),
    green: channel(parts[1]),
    blue: channel(parts[2]),
    alpha,
  };
};

const composite = (foreground: RgbaColor, background: RgbaColor): RgbaColor => {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
  const channel = (front: number, back: number): number =>
    (front * foreground.alpha +
      back * background.alpha * (1 - foreground.alpha)) /
    alpha;
  return {
    red: channel(foreground.red, background.red),
    green: channel(foreground.green, background.green),
    blue: channel(foreground.blue, background.blue),
    alpha,
  };
};

const contrastBetweenColors = (
  foregroundColor: string,
  backgroundColors: string | readonly string[],
): { ratio: number; resolvedBackgroundColor: string } => {
  const backgrounds = Array.isArray(backgroundColors)
    ? [...backgroundColors].reverse()
    : [backgroundColors as string];
  let background: RgbaColor = { red: 0, green: 0, blue: 0, alpha: 0 };
  for (const color of backgrounds) {
    background = composite(parseCssColor(color), background);
  }
  if (background.alpha < 0.999999) {
    throw new Error(
      `Cannot calculate contrast over an unresolved background (${background.alpha} alpha)`,
    );
  }
  const resolvedBackgroundColor = `rgb(${background.red}, ${background.green}, ${background.blue})`;
  const foreground = composite(parseCssColor(foregroundColor), background);
  const luminance = (color: RgbaColor): number => {
    const linear = (value: number): number => {
      const normalized = value / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return (
      linear(color.red) * 0.2126 +
      linear(color.green) * 0.7152 +
      linear(color.blue) * 0.0722
    );
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return {
    ratio:
      (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
    resolvedBackgroundColor,
  };
};

const completionContrast = async (
  token: Locator,
): Promise<{
  foregroundColor: string;
  backgroundColor: string;
  backgroundLayers: string[];
  resolvedBackgroundColor: string;
  ratio: number;
}> => {
  const colors = await token.evaluate((element) => {
    const backgroundLayers: string[] = [];
    let surface: Element | null = element;
    while (surface) {
      backgroundLayers.push(getComputedStyle(surface).backgroundColor);
      const root = surface.getRootNode();
      surface =
        surface.parentElement ??
        (root instanceof ShadowRoot ? root.host : null);
    }
    return {
      foregroundColor: getComputedStyle(element).color,
      backgroundColor: getComputedStyle(element).backgroundColor,
      backgroundLayers,
    };
  });
  const contrast = contrastBetweenColors(
    colors.foregroundColor,
    colors.backgroundLayers,
  );
  return { ...colors, ...contrast };
};

test.skip(
  !DEMO_REPO,
  'set DATATUG_E2E_GITHUB_FAKE to the demo project checkout containing the saved Author query',
);

test.beforeEach(async ({ context, page }, testInfo) => {
  if (testInfo.project.use.browserName === 'webkit') {
    // The anonymous query journeys do not use Firebase Auth; satisfy only the
    // local emulator iframe requested by WebKit's auth bootstrap. Query APIs,
    // comparison workers, and datasets continue through their real test paths.
    await page.route(
      /^http:\/\/127\.0\.0\.1:9099\/emulator\/auth\/iframe(?:\?.*)?$/u,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><body></body></html>',
        }),
    );
  }
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
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );
  await expect(page.getByTestId('author-execution-receipt')).toHaveCount(0);
  await author.getByTestId('author-code-tab').click();

  await editor.click();
  await editor.focus();
  await expect(editor).toBeFocused();
  const mod = await codeMirrorMod(page);
  await editor.press(`${mod}+End`);
  await editor.press('Enter');
  await editor.press(`${mod}+End`);
  await editor.type('s', { delay: 20 });
  await expectEditorSource(page, editor, `${original}\ns`);
  await editor.type('e', { delay: 20 });
  await expectEditorSource(page, editor, `${original}\nse`);
  await editor.type("lect 'draft', 42 -- temporary edit", { delay: 20 });
  const editedSource = `${original}\nselect 'draft', 42 -- temporary edit`;
  await expectEditorSource(page, editor, editedSource);
  const stringToken = editor
    .locator('.tugql-token-string')
    .filter({ hasText: "'draft'" });
  const numberToken = editor
    .locator('.tugql-token-number')
    .filter({ hasText: '42' });
  const commentToken = editor
    .locator('.tugql-token-comment')
    .filter({ hasText: '-- temporary edit' });
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
  for (const token of [
    keyword,
    parameter,
    stringToken,
    numberToken,
    commentToken,
  ]) {
    expect(await contrastRatio(token)).toBeGreaterThanOrEqual(4.5);
  }
  await page.emulateMedia({ forcedColors: 'active' });
  const forcedSyntaxTokens = [
    ['keyword', keyword],
    ['parameter', parameter],
    ['string', stringToken],
    ['number', numberToken],
    ['comment', commentToken],
  ] as const;
  const forcedSyntaxEvidence = [];
  for (const [name, token] of forcedSyntaxTokens) {
    const colors = await completionContrast(token);
    expect(colors.ratio).toBeGreaterThanOrEqual(4.5);
    forcedSyntaxEvidence.push({ name, ...colors });
  }
  console.info(
    '[forced-colors-syntax-token-contrast]',
    JSON.stringify(forcedSyntaxEvidence),
  );
  await page.emulateMedia({ forcedColors: 'none' });
  await page
    .locator('ion-app')
    .evaluate((app) => app.classList.remove('ion-palette-dark'));
  await editor.press(`${mod}+Z`);
  await expectEditorSource(page, editor, `${original}\n`);
  await editor.press(`${mod}+Z`);
  await expectEditorSource(page, editor, original);

  await editor.locator('.cm-line').last().click();
  await editor.press(`${mod}+End`);
  const wrappedComment = `-- echoed through parent ${'x'.repeat(280)}`;
  await editor.type(wrappedComment);
  const parentEcho = `${original}${wrappedComment}`;
  await author.getByTestId('author-preview').click();
  const sqlDisclosure = author.locator('.author-sql-disclosure');
  await expect(sqlDisclosure).toBeVisible();
  const editorRoot = author.getByTestId('query-body-text').locator('.cm-editor');
  await editorRoot.evaluate((element) => {
    (window as unknown as { __queryWorkbenchEditor?: Element }).__queryWorkbenchEditor = element;
  });
  await editor.focus();
  await editor.press('End');
  await editor.press('Shift+ArrowLeft');
  const selectedBeforeLayout = await editor.evaluate(
    () => window.getSelection()?.toString() ?? '',
  );
  expect(selectedBeforeLayout).toBe('x');

  const sourceDiscovery = author.getByTestId('author-source-discovery');
  await sourceDiscovery.locator('summary').click();
  await expect(sourceDiscovery.locator('summary')).toBeVisible();
  await sourceDiscovery.locator('summary').click();
  await sqlDisclosure.locator(':scope > summary').click();
  await expect(sqlDisclosure.locator('sneat-author-sql-preview')).toBeHidden();
  await sqlDisclosure.locator(':scope > summary').click();
  await expect(sqlDisclosure.locator('sneat-author-sql-preview')).toBeVisible();

  const originalViewport = page.viewportSize();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByTestId('workspace-jump-to-results').click();
    await expect(page.locator('#author-results-heading')).toBeFocused();
    await page.getByTestId('workspace-back-to-editor').click();
    await expect(author.locator('[data-workspace-heading]')).toBeFocused();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __queryWorkbenchEditor?: Element })
            .__queryWorkbenchEditor ===
          document.querySelector('[data-testid="query-body-text"] .cm-editor'),
      ),
    ).toBe(true);
    await editor.focus();
    await expectEditorSource(page, editor, parentEcho);
    await expect
      .poll(() => editor.evaluate(() => window.getSelection()?.toString() ?? ''))
      .toBe(selectedBeforeLayout);
    const editorGeometry = await editor.evaluate((content) => {
      const editorRoot = content.closest('.cm-editor');
      const gutter = editorRoot?.querySelector('.cm-gutters');
      const contentBox = editorRoot?.querySelector('.cm-content');
      const editorBounds = editorRoot?.getBoundingClientRect();
      const gutterBounds = gutter?.getBoundingClientRect();
      const contentBounds = contentBox?.getBoundingClientRect();
      return {
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        source: content.textContent ?? '',
        editorLeft: editorBounds?.left ?? -1,
        editorRight: editorBounds?.right ?? -1,
        gutterLeft: gutterBounds?.left ?? -1,
        gutterRight: gutterBounds?.right ?? -1,
        contentLeft: contentBounds?.left ?? -1,
      };
    });
    expect(editorGeometry.source).toContain('x'.repeat(100));
    expect(editorGeometry.documentWidth).toBeLessThanOrEqual(
      editorGeometry.viewportWidth,
    );
    expect(editorGeometry.gutterLeft).toBeGreaterThanOrEqual(
      editorGeometry.editorLeft,
    );
    expect(editorGeometry.gutterRight).toBeLessThanOrEqual(
      editorGeometry.editorRight,
    );
    expect(editorGeometry.contentLeft).toBeGreaterThanOrEqual(
      editorGeometry.gutterRight - 1,
    );
  }
  await editor.press(`${mod}+Z`);
  await expectEditorSource(page, editor, original);
  await editor.press(`${mod}+Shift+KeyZ`);
  await expectEditorSource(page, editor, parentEcho);
  if (originalViewport) await page.setViewportSize(originalViewport);
  await editor.press('ArrowRight');
  await editor.type('!');
  await expectEditorSource(page, editor, `${parentEcho}!`);
  await editor.press(`${mod}+Z`);
  await expectEditorSource(page, editor, parentEcho);
  await editor.press(`${mod}+Shift+KeyZ`);
  await expectEditorSource(page, editor, `${parentEcho}!`);
  await editor.press(`${mod}+Z`);
  await expectEditorSource(page, editor, parentEcho);

  await author.getByTestId('author-compose-tab').click();
  await author.getByTestId('author-code-tab').click();
  const remountedEditor = author
    .getByTestId('query-body-text')
    .locator('.cm-content');
  await expectEditorSource(page, remountedEditor, parentEcho);
  await page.setViewportSize({ width: 320, height: 780 });
  const numberedLines = `${parentEcho}\n${Array.from(
    { length: 105 },
    (_, index) => `-- numbered ${index + 1} ${'x'.repeat(160)}`,
  ).join('\n')}`;
  await remountedEditor.fill(numberedLines);
  await remountedEditor.press(`${mod}+End`);
  const threeDigitGutter = await remountedEditor.evaluate((content) => {
    const editorRoot = content.closest('.cm-editor');
    const gutter = editorRoot?.querySelector('.cm-lineNumbers');
    const lastLineNumber = gutter?.querySelector(
      '.cm-gutterElement:last-child',
    );
    const text = editorRoot?.querySelector('.cm-content');
    return {
      lineNumber: Number(lastLineNumber?.textContent ?? 0),
      gutterRight: gutter?.getBoundingClientRect().right ?? -1,
      contentLeft: text?.getBoundingClientRect().left ?? -1,
      editor: editorRoot?.getBoundingClientRect(),
      scrollTop: editorRoot?.querySelector('.cm-scroller')?.scrollTop ?? 0,
    };
  });
  expect(threeDigitGutter.lineNumber).toBeGreaterThanOrEqual(100);
  expect(threeDigitGutter.scrollTop).toBeGreaterThan(0);
  expect(threeDigitGutter.contentLeft).toBeGreaterThanOrEqual(
    threeDigitGutter.gutterRight - 1,
  );
  expect(threeDigitGutter.gutterRight).toBeLessThanOrEqual(
    threeDigitGutter.editor?.right ?? -1,
  );
  await remountedEditor.press(`${mod}+Z`);
  await expectEditorSource(page, remountedEditor, parentEcho);
  await remountedEditor.locator('.cm-line').last().click();
  await remountedEditor.press('Tab');
  await expect(remountedEditor).not.toBeFocused();

  const editorScroller = author
    .getByTestId('query-body-text')
    .locator('.cm-scroller');
  await expect
    .poll(() =>
      editorScroller.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
});

test('native SQL editor highlights the saved query and runs it against Chinook', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  const pageErrors: string[] = [];
  let workersStarted = 0;
  page.on('worker', () => workersStarted++);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(PLAYLIST_SQL_URL);
  const source = savedSqlSource('chinook-playlist-composition');
  const editorHost = page.getByTestId('query-body-text');
  const editor = editorHost.locator('.cm-content');
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await expect(editor).toHaveAttribute('aria-label', 'SQL query');
  await expectEditorSource(page, editor, source);
  await expect(editorHost.locator('.cm-gutters')).toBeHidden();
  await expect(editorHost.locator('.cm-lineNumbers')).toHaveCount(1);
  const mod = await codeMirrorMod(page);
  await editor.focus();
  await editor.press(`${mod}+A`);
  await editor.press('ArrowRight');
  await editor.type('(');
  await expectEditorSource(page, editor, `${source}(`);
  await editor.press(`${mod}+Z`);
  await expectEditorSource(page, editor, source);

  const keyword = editor.locator('.sql-token-keyword').first();
  const identifier = editor.locator('.sql-token-identifier').first();
  const number = editor.locator('.sql-token-number').filter({ hasText: '10' });
  const logTokenContrast = async (theme: string): Promise<void> => {
    const samples = [
      ['keyword', keyword],
      ['identifier', identifier],
      ['number', number],
      ['string', editor.locator('.sql-token-string').first()],
      ['comment', editor.locator('.sql-token-comment').first()],
    ] as const;
    const measured = [];
    for (const [kind, token] of samples) {
      await expect(token).toBeVisible();
      const colors = await completionContrast(token);
      expect(colors.ratio).toBeGreaterThanOrEqual(4.5);
      measured.push({ kind, ...colors });
    }
    console.info(
      `[native-sql-token-contrast] ${JSON.stringify({ theme, tokens: measured })}`,
    );
  };
  const logSelectionContrast = async (theme: string): Promise<void> => {
    const mod = await codeMirrorMod(page);
    await editor.focus();
    await editor.press(`${mod}+A`);
    const selection = editorHost.locator('.cm-selectionBackground').first();
    await expect(selection).toBeVisible();
    const measure = async (focus: 'focused' | 'unfocused'): Promise<void> => {
      const pair = await selection.evaluate((element) => {
        const token = element
          .closest('.cm-editor')
          ?.querySelector('.sql-token-identifier');
        if (!token) throw new Error('SQL editor identifier token is missing.');
        const backgroundLayers: string[] = [];
        let surface: Element | null = element;
        while (surface) {
          backgroundLayers.push(getComputedStyle(surface).backgroundColor);
          if (surface.classList.contains('cm-editor')) break;
          surface = surface.parentElement;
        }
        const styles = getComputedStyle(element);
        return {
          foregroundColor: getComputedStyle(token).color,
          selectionBackgroundColor: getComputedStyle(element).backgroundColor,
          backgroundLayers,
          selectionOutline: styles.outline,
          selectionOutlineColor: styles.outlineColor,
          selectionOutlineStyle: styles.outlineStyle,
          selectionOutlineWidth: styles.outlineWidth,
        };
      });
      console.info(
        `[native-sql-selection-colors] ${JSON.stringify({ theme, focus, ...pair })}`,
      );
      const contrast = contrastBetweenColors(
        pair.foregroundColor,
        pair.backgroundLayers,
      );
      expect(contrast.ratio).toBeGreaterThanOrEqual(4.5);
      let outlineContrast: ReturnType<typeof contrastBetweenColors> | undefined;
      if (theme === 'forced-colors') {
        expect(pair.selectionOutlineStyle).toBe('solid');
        expect(pair.selectionOutlineWidth).toBe('2px');
        outlineContrast = contrastBetweenColors(
          pair.selectionOutlineColor,
          pair.backgroundLayers,
        );
        expect(outlineContrast.ratio).toBeGreaterThanOrEqual(3);
      }
      console.info(
        `[native-sql-selection-contrast] ${JSON.stringify({ theme, focus, ...pair, ...contrast, outlineContrast })}`,
      );
    };
    await measure('focused');
    await editor.evaluate((element) => (element as HTMLElement).blur());
    await expect
      .poll(() =>
        editorHost
          .locator('.cm-editor')
          .evaluate((element) => element.classList.contains('cm-focused')),
      )
      .toBe(false);
    await measure('unfocused');
    await editor.focus();
    await editor.press('ArrowRight');
  };
  await expect(keyword).toBeVisible();
  await expect(identifier).toBeVisible();
  await expect(number).toBeVisible();
  const darkSurface = await keyword.evaluate((element) => {
    const editorElement = element.closest('.cm-editor');
    if (!editorElement) throw new Error('SQL editor surface is missing.');
    return getComputedStyle(editorElement).backgroundColor;
  });
  expect(darkSurface).toBe('rgb(17, 24, 39)');
  const contrastSample = `${source}\n-- contrast sample\nSELECT 'sample', 42;`;
  await pasteCode(page, editor, contrastSample);
  await logTokenContrast('system-dark');
  await logSelectionContrast('system-dark');
  await editor.press(`${mod}+Z`);
  await expectEditorSource(page, editor, source);

  await page.emulateMedia({ colorScheme: 'light' });
  const lightSurface = await keyword.evaluate((element) => {
    const editorElement = element.closest('.cm-editor');
    if (!editorElement) throw new Error('SQL editor surface is missing.');
    return getComputedStyle(editorElement).backgroundColor;
  });
  expect(lightSurface).toBe('rgb(255, 255, 255)');
  await pasteCode(page, editor, contrastSample);
  await logTokenContrast('system-light');
  await logSelectionContrast('system-light');
  await editor.press(`${mod}+Z`);
  await expectEditorSource(page, editor, source);

  await page
    .locator('ion-app')
    .evaluate((app) => app.classList.add('ion-palette-dark'));
  const classDarkSurface = await keyword.evaluate((element) => {
    const editorElement = element.closest('.cm-editor');
    if (!editorElement) throw new Error('SQL editor surface is missing.');
    return getComputedStyle(editorElement).backgroundColor;
  });
  expect(classDarkSurface).toBe('rgb(17, 24, 39)');
  await pasteCode(page, editor, contrastSample);
  await logTokenContrast('class-dark');
  await logSelectionContrast('class-dark');
  await editor.press(`${mod}+Z`);
  await expectEditorSource(page, editor, source);
  await page
    .locator('ion-app')
    .evaluate((app) => app.classList.remove('ion-palette-dark'));
  await page.emulateMedia({ forcedColors: 'active' });
  await pasteCode(
    page,
    editor,
    `${source}\n-- contrast sample\nSELECT 'sample', 42;`,
  );
  await logTokenContrast('forced-colors');
  await logSelectionContrast('forced-colors');
  await editor.press(`${mod}+Z`);
  await expectEditorSource(page, editor, source);
  await page.emulateMedia({ forcedColors: 'none' });
  await page.emulateMedia({ colorScheme: 'dark' });

  await editor.focus();
  await editor.press('Control+Space');
  await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
  expect(workersStarted).toBe(0);
  await expect(page.getByRole('grid')).toHaveCount(0);

  await page.getByRole('button', { name: 'Run query', exact: true }).click();
  await expect.poll(() => workersStarted).toBe(1);
  const rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(11, { timeout: 45_000 });
  const genericGridViewport = page.locator('.result-grid-viewport');
  await expect(genericGridViewport).toHaveCount(1);
  await expect(genericGridViewport).toHaveCSS('height', '420px');
  await expect(genericGridViewport.locator('xpath=..')).toHaveClass(
    /ion-padding-horizontal/u,
  );
  await expect(rows.first()).toContainText('Playlist');
  await expect(rows.first()).toContainText('TrackCount');
  await expect(page.getByTestId('result-provenance')).toContainText('snapshot');
  await expect(page.getByTestId('query-run-timings')).toBeVisible();
  const expectedRows = [
    ['1', 'Music', '3290', '335'],
    ['8', 'Music', '3290', '335'],
    ['5', '90’s Music', '1477', '151'],
    ['3', 'TV Shows', '213', '12'],
    ['10', 'TV Shows', '213', '12'],
    ['12', 'Classical', '75', '73'],
    ['11', 'Brazilian Music', '39', '14'],
    ['17', 'Heavy Metal Classic', '26', '19'],
    ['13', 'Classical 101 - Deep Cuts', '25', '25'],
    ['14', 'Classical 101 - Next Steps', '25', '25'],
  ];
  const isNarrow = (page.viewportSize()?.width ?? 1280) <= 600;
  if (!isNarrow) await expect(rows.first()).toContainText('AlbumCount');
  const cells: string[][] = [];
  for (let index = 1; index < 11; index++) {
    cells.push(await rows.nth(index).getByRole('gridcell').allTextContents());
  }
  expect(cells).toEqual(
    expectedRows.map((row) => row.slice(0, isNarrow ? 3 : 4)),
  );
  if (isNarrow) {
    const horizontalScroll = page.locator(
      '.ag-body-horizontal-scroll-viewport',
    );
    await expect
      .poll(() =>
        horizontalScroll.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      )
      .toBeGreaterThan(0);
    await horizontalScroll.evaluate(
      (element) => (element.scrollLeft = element.scrollWidth),
    );
    await expect(
      page.getByRole('columnheader', { name: 'AlbumCount' }),
    ).toBeVisible();
    for (let index = 1; index < 11; index++) {
      const visibleCells = await rows
        .nth(index)
        .getByRole('gridcell')
        .allTextContents();
      expect(visibleCells[visibleCells.length - 1]).toBe(
        expectedRows[index - 1][3],
      );
    }
  }
  expect(errors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
test('TugQL suggestions are explicit, source-safe, and touch reachable', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  expect(
    contrastBetweenColors('rgba(0, 0, 0, 0.847)', 'rgb(192, 192, 192)').ratio,
  ).toBeCloseTo(9.227, 3);
  const isMobile = testInfo.project.use.isMobile === true;
  let workersStarted = 0;
  page.on('worker', () => workersStarted++);
  await page.goto(AUTHOR_URL);
  const mod = await codeMirrorMod(page);
  const author = page.getByTestId('tugql-author');
  const runButton = author.getByTestId('author-run').locator('button');
  await expect(author).toBeVisible({ timeout: 20_000 });

  if (isMobile) {
    await page.locator('#workspace-jump-to-results').click();
    await expect(page.getByTestId('author-results-empty')).toBeVisible();
    await page.locator('#workspace-back-to-editor').click();
  }

  const customerId = author.getByTestId('author-customer-id').locator('input');
  await customerId.fill('1');
  await author.getByTestId('author-preview').click();
  await expect(runButton).toBeEnabled();
  await author.getByTestId('author-run').click();
  if (isMobile) await page.locator('#workspace-jump-to-results').click();
  const receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('Executed');
  await expect(receipt).toContainText('7 rows');
  await expect.poll(() => workersStarted).toBe(1);
  const executionId = (await receipt.textContent())?.match(
    /execution ID ([0-9a-f-]{36})/iu,
  )?.[1];
  expect(executionId).toBeTruthy();
  const boundCustomerId = await customerId.inputValue();

  if (isMobile) await page.locator('#workspace-back-to-editor').click();
  await author.getByTestId('author-code-tab').click();
  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  const incompleteDraft = [
    'parameters (',
    '  @CustomerId integer required',
    ')',
    'from Invoice as i -- forced-colors comment',
    'where i.CustomerId = @C',
  ].join('\n');
  await pasteCode(page, editor, incompleteDraft);
  const popup = author.locator('.cm-tooltip-autocomplete');
  await expect(popup).toHaveCount(0);

  if (!isMobile) await page.setViewportSize({ width: 320, height: 780 });

  if (isMobile) {
    await author
      .getByRole('button', { name: 'Suggestions (Ctrl+Space)' })
      .tap();
  } else {
    await editor.press('Control+Space');
  }
  await expect(popup).toBeVisible();
  const selectedOption = popup.locator('li[aria-selected="true"]');
  await expect(selectedOption).toBeVisible();
  const lightPopupBackground = await popup.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(lightPopupBackground).not.toBe('rgba(0, 0, 0, 0)');
  const lightContrast = await completionContrast(selectedOption);
  expect(lightContrast.ratio).toBeGreaterThanOrEqual(4.5);
  const popupBounds = await popup.boundingBox();
  const viewport = page.viewportSize();
  if (!popupBounds || !viewport) {
    throw new Error(
      'The completion popup or viewport has no measurable bounds',
    );
  }
  expect(popupBounds.x).toBeGreaterThanOrEqual(0);
  expect(popupBounds.x + popupBounds.width).toBeLessThanOrEqual(
    viewport.width + 1,
  );
  const option = popup.locator('.cm-completionLabel', {
    hasText: /^CustomerId$/u,
  });
  await expect(option).toBeVisible();
  await page
    .locator('ion-app')
    .evaluate((app) => app.classList.add('ion-palette-dark'));
  const darkPopupBackground = await popup.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(darkPopupBackground).not.toBe(lightPopupBackground);
  const darkContrast = await completionContrast(selectedOption);
  expect(darkContrast.ratio).toBeGreaterThanOrEqual(4.5);
  await page.emulateMedia({ forcedColors: 'active' });
  const forcedColorsContrast = await completionContrast(selectedOption);
  const popupColors = await completionContrast(popup);
  const forcedColorsStyle = await selectedOption.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineColor: style.outlineColor,
      backgroundColor: style.backgroundColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      fontWeight: style.fontWeight,
    };
  });
  const sourceContrastChecks = [
    ['keyword', editor.locator('.tugql-token-keyword').first()],
    ['parameter', editor.locator('.tugql-token-parameter').first()],
    ['identifier', editor.locator('.tugql-token-identifier').first()],
    ['operator', editor.locator('.tugql-token-operator').first()],
    ['punctuation', editor.locator('.tugql-token-punctuation').first()],
    ['comment', editor.locator('.tugql-token-comment').first()],
  ] as const;
  const sourceContrastEvidence = [];
  for (const [name, token] of sourceContrastChecks) {
    await expect(token).toBeVisible();
    const colors = await completionContrast(token);
    expect(colors.ratio).toBeGreaterThanOrEqual(4.5);
    sourceContrastEvidence.push({ name, ...colors });
  }
  const headerContrast = await completionContrast(
    author.locator('.author-code-label'),
  );
  const buttonContrast = await completionContrast(
    author.getByRole('button', { name: 'Suggestions (Ctrl+Space)' }),
  );
  const buttonHintContrast = await completionContrast(
    author
      .getByRole('button', { name: 'Suggestions (Ctrl+Space)' })
      .locator('span'),
  );
  for (const colors of [headerContrast, buttonContrast, buttonHintContrast]) {
    expect(colors.ratio).toBeGreaterThanOrEqual(4.5);
  }
  const outlineContrast = contrastBetweenColors(
    forcedColorsStyle.outlineColor,
    forcedColorsStyle.backgroundColor,
  );
  console.info(
    '[forced-colors-completion-contrast]',
    JSON.stringify({
      selected: forcedColorsContrast,
      selectedStyle: forcedColorsStyle,
      outlineContrast,
      sourceTokens: sourceContrastEvidence,
      header: headerContrast,
      button: buttonContrast,
      buttonHint: buttonHintContrast,
    }),
  );
  await testInfo.attach('forced-colors-completion-style.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          selected: forcedColorsContrast,
          popup: popupColors,
          selectedStyle: forcedColorsStyle,
          outlineContrast,
          sourceTokens: sourceContrastEvidence,
          header: headerContrast,
          button: buttonContrast,
          buttonHint: buttonHintContrast,
        },
        null,
        2,
      ),
    ),
    contentType: 'application/json',
  });
  await testInfo.attach('forced-colors-completion.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(forcedColorsContrast.foregroundColor).toBe(
    popupColors.foregroundColor,
  );
  expect(forcedColorsContrast.backgroundColor).toBe(
    popupColors.backgroundColor,
  );
  expect(forcedColorsContrast.ratio).toBeGreaterThanOrEqual(4.5);
  expect(forcedColorsStyle.outlineStyle).toBe('solid');
  expect(forcedColorsStyle.outlineWidth).toBe('2px');
  expect(forcedColorsStyle.fontWeight).toBe('600');
  expect(outlineContrast.ratio).toBeGreaterThanOrEqual(3);
  await page.emulateMedia({ forcedColors: 'none' });
  await page
    .locator('ion-app')
    .evaluate((app) => app.classList.remove('ion-palette-dark'));
  await editor.press('Escape');
  await expect(popup).toHaveCount(0);
  await expectEditorSource(page, editor, incompleteDraft);

  // Enter remains an ordinary newline when no completion list is open.
  await editor.press('Enter');
  await expectEditorSource(page, editor, `${incompleteDraft}\n`);
  await editor.press(`${mod}+z`);
  await expectEditorSource(page, editor, incompleteDraft);

  if (isMobile) {
    await author
      .getByRole('button', { name: 'Suggestions (Ctrl+Space)' })
      .tap();
  } else {
    await editor.press('Control+Space');
  }
  await expect(popup).toBeVisible();
  const acceptedOption = popup.locator('.cm-completionLabel', {
    hasText: /^CustomerId$/u,
  });
  await expect(popup.locator('li[aria-selected="true"]')).toBeVisible();
  await page.waitForTimeout(COMPLETION_INTERACTION_DELAY_MS + 25);
  if (isMobile) {
    await acceptedOption.tap();
  } else {
    await editor.press('Enter');
  }
  const acceptedDraft = incompleteDraft.replace(/@C$/u, '@CustomerId');
  await expectEditorSource(page, editor, acceptedDraft);
  await expect(editor).toBeFocused();
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
  await expect(runButton).toBeDisabled();
  await editor.press(`${mod}+z`);
  await expectEditorSource(page, editor, incompleteDraft);
  // Use the physical key so Shift remains part of CodeMirror's redo chord.
  await editor.press(`${mod}+Shift+KeyZ`);
  await expectEditorSource(page, editor, acceptedDraft);

  const resultsTab = page.locator('#workspace-jump-to-results');
  if (await resultsTab.isVisible()) await resultsTab.click();
  await expect(receipt).toContainText('Previous run');
  await expect(receipt).toContainText('7 rows');
  expect(await receipt.textContent()).toContain(executionId);
  expect(await customerId.inputValue()).toBe(boundCustomerId);
  expect(workersStarted).toBe(1);
  expect(await page.getByRole('grid').getByRole('row').count()).toBe(8);
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
  await pasteCode(
    page,
    editor,
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
  const original = savedQuerySource(
    'chinook-customer-count-graph',
    GRAPH_DEMO_REPO,
  );
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
  await pasteCode(
    page,
    editor,
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

test('Format diagnostics navigate the unchanged draft without another run', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const isMobile = testInfo.project.use.isMobile === true;
  let workersStarted = 0;
  page.on('worker', () => workersStarted++);
  await page.addInitScript(() => {
    const originalPostMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = new Proxy(originalPostMessage, {
      apply(target, worker: Worker, args: unknown[]) {
        const message = args[0];
        if (
          typeof message === 'object' &&
          message !== null &&
          'sql' in message &&
          typeof message.sql === 'string' &&
          'bindings' in message &&
          Array.isArray(message.bindings)
        ) {
          const instrumentedWindow = window as Window & {
            __datatugQueryExecutionMessages?: number;
          };
          instrumentedWindow.__datatugQueryExecutionMessages =
            (instrumentedWindow.__datatugQueryExecutionMessages ?? 0) + 1;
        }
        return Reflect.apply(target, worker, args);
      },
    }) as typeof Worker.prototype.postMessage;
  });
  const queryExecutionMessages = () =>
    page.evaluate(
      () =>
        (
          window as Window & {
            __datatugQueryExecutionMessages?: number;
          }
        ).__datatugQueryExecutionMessages ?? 0,
    );
  await page.goto(AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await author.getByTestId('author-code-tab').click();
  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  const valid = savedQuerySource('chinook-invoice-author');
  await expectEditorSource(page, editor, valid);

  await author.getByTestId('author-preview').click();
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toContainText('Preview · Not executed');
  expect(await queryExecutionMessages()).toBe(0);
  const customerId = author
    .getByTestId('author-customer-id')
    .locator('input:not(.cloned-input)');
  await customerId.fill('1');
  await author.getByTestId('author-preview').click();
  await expect(author.getByTestId('author-sql-preview')).toContainText(
    'Preview · Not executed',
  );
  expect(await queryExecutionMessages()).toBe(0);
  await author.getByTestId('author-run').click();
  if (isMobile) await page.locator('#workspace-jump-to-results').click();
  const receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('Executed');
  await expect(receipt).toContainText('7 rows');
  await expect.poll(() => workersStarted).toBe(1);
  await expect.poll(queryExecutionMessages).toBe(1);
  const executionId = (await receipt.textContent())?.match(
    /execution ID ([0-9a-f-]{36})/iu,
  )?.[1];
  expect(executionId).toBeDefined();
  const rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(8);
  const retainedRows = await rows.allTextContents();
  if (isMobile) await page.locator('#workspace-back-to-editor').click();

  const malformed = valid.replace(
    'limit 100\nselect i.InvoiceId, i.InvoiceDate',
    'select i.InvoiceId, i.InvoiceDate\n    limit 100',
  );
  expect(malformed).not.toBe(valid);
  await pasteCode(page, editor, malformed);
  await author.getByTestId('author-format-tugql').click();
  await expectEditorSource(page, editor, malformed);
  await expect(author.getByTestId('author-format-status')).toContainText(
    'TugQL was not changed',
  );
  expect(await queryExecutionMessages()).toBe(1);
  const diagnostic = author.getByRole('button', {
    name: 'Go to line 7, column 5: query clauses are out of order',
  });
  await expect(diagnostic).toBeVisible();
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);

  const originalViewport = page.viewportSize();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() =>
        diagnostic.evaluate((button) => button.getBoundingClientRect().height),
      )
      .toBeGreaterThanOrEqual(44);
    const bounds = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(bounds.document).toBeLessThanOrEqual(bounds.viewport);
  }

  if (isMobile) await diagnostic.tap();
  else {
    await diagnostic.focus();
    await diagnostic.press('Enter');
  }
  await expectEditorSource(page, editor, malformed);
  const caret = await editor.evaluate((element) => {
    const selection = window.getSelection();
    const focusNode = selection?.focusNode;
    const line =
      focusNode instanceof Element
        ? focusNode.closest('.cm-line')
        : focusNode?.parentElement?.closest('.cm-line');
    if (!selection || !focusNode || !line) return undefined;
    const range = document.createRange();
    range.selectNodeContents(line);
    range.setEnd(focusNode, selection.focusOffset);
    const renderedLines = [...element.querySelectorAll('.cm-line')];
    return {
      focused: document.activeElement === element,
      collapsed: selection.isCollapsed,
      line: renderedLines.indexOf(line) + 1,
      column: [...range.toString()].length + 1,
    };
  });
  expect(caret).toEqual({ focused: true, collapsed: true, line: 7, column: 5 });
  expect(await copyEditorSource(page, editor)).toBe(malformed);
  expect(
    await author
      .getByTestId('author-customer-id')
      .locator('input:not(.cloned-input)')
      .inputValue(),
  ).toBe('1');
  expect(workersStarted).toBe(1);
  expect(await queryExecutionMessages()).toBe(1);

  if (isMobile) await page.locator('#workspace-jump-to-results').click();
  else if (originalViewport) await page.setViewportSize(originalViewport);
  await expect(receipt).toContainText(`Worker execution ID ${executionId}`);
  await expect(receipt).toContainText('7 rows');
  await expect(rows).toHaveCount(8);
  expect(await rows.allTextContents()).toEqual(retainedRows);
  expect(workersStarted).toBe(1);
  if (isMobile) await page.locator('#workspace-back-to-editor').click();

  const edited = malformed.replace('limit 100', 'limit 99');
  await pasteCode(page, editor, edited);
  await expect(author.getByTestId('author-format-status')).toHaveCount(0);
  await expect(author.getByRole('button', { name: /Go to line/u })).toHaveCount(
    0,
  );
  await expect(receipt).toContainText('7 rows');
  expect(workersStarted).toBe(1);
  expect(await queryExecutionMessages()).toBe(1);
  if (isMobile && originalViewport)
    await page.setViewportSize(originalViewport);
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
  await expect(author.getByTestId('author-compose-tab')).toHaveAttribute(
    'fill',
    'solid',
  );
  await expect(author.getByTestId('author-code-tab')).toHaveAttribute(
    'fill',
    'clear',
  );
  await expect(author.locator('sneat-author-compose-controls')).toBeVisible();
  await expect(author.getByTestId('query-body-text')).toHaveCount(0);
  await author.getByTestId('author-code-tab').click();
  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  const original = savedQuerySource(
    'chinook-customer-invoice-join',
    JOIN_DEMO_REPO,
  );
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
  if (firstRunAction === null) {
    throw new Error(
      'The original Customer ID 1 lookup action was not captured',
    );
  }
  await firstRunAction.evaluate((button) => {
    if (!(button instanceof HTMLElement)) {
      throw new Error(
        'The original invoice lookup action was not an HTML element',
      );
    }
    button.click();
  });
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
  await page.locator('#workspace-jump-to-results').click();
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
  await expect(page.locator('#workspace-results-pane')).toBeVisible();
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
  await page.locator('#workspace-jump-to-results').click();
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

  const aboveSeven = savedQuerySource('chinook-customer-count-cte').replace(
    '>= 7',
    '> 7',
  );
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
  const isMobile = testInfo.project.use.isMobile === true;
  const errors: string[] = [];
  let workersStarted = 0;
  page.on('worker', () => workersStarted++);
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  // This scoped fake-GitHub fixture changes only the displayed query and
  // project title strings. The real saved source, permissions, bindings,
  // database, and worker journey remain unchanged.
  await installLongHeaderMetadataVariant(page);

  // Start from another saved read-only query, then follow its existing Back
  // → Queries path to the Invoice Author query. Header navigation must not
  // execute either query; the later Preview/Run actions remain explicit.
  await page.goto(PLAYLIST_SQL_URL);
  await expect(
    activePage(page).locator('sneat-datatug-page-title'),
  ).toContainText('Playlist Composition', {
    timeout: 20_000,
  });
  await expect(
    activePage(page).locator('sneat-datatug-page-title'),
  ).toContainText(LONG_HEADER_PROJECT_TITLE);
  await expect(page.getByRole('grid')).toHaveCount(0);
  await activePage(page).locator('ion-back-button').click();
  // Ionic keeps the outgoing page mounted during its transition. Identify the
  // destination by its route component, then wait until only that page is
  // active before using the shared activePage locator again.
  const queriesPage = page.locator(
    'ion-router-outlet > sneat-datatug-sql-queries.ion-page:not(.ion-page-hidden)',
  );
  await expect(queriesPage).toHaveCount(1, { timeout: 20_000 });
  await expect(queriesPage.locator('ion-title')).toContainText('Queries');
  await expect(activePage(page)).toHaveCount(1);
  await queriesPage.locator('ion-item', { hasText: 'demodb' }).click();
  const invoiceQuery = queriesPage
    .locator('ion-item', { hasText: LONG_HEADER_QUERY_TITLE })
    .getByTitle('Edit');
  await invoiceQuery.click();
  const invoiceAuthorPage = page.locator(
    'ion-router-outlet > sneat-datatug-sql-editor.ion-page:not(.ion-page-hidden)',
  );
  await expect
    .poll(() => new URL(page.url()).searchParams.get('id'))
    .toBe('demodb/chinook-invoice-author');
  await expect(invoiceAuthorPage).toHaveCount(1, { timeout: 20_000 });
  await expect(activePage(page)).toHaveCount(1);
  const initialHeader = invoiceAuthorPage.locator(
    'sneat-datatug-page-title ion-title',
  );
  await expect(initialHeader).toContainText(LONG_HEADER_QUERY_TITLE, {
    timeout: 20_000,
  });
  await expect(initialHeader).toContainText(LONG_HEADER_PROJECT_TITLE);
  const initialHeaderAccessibility = await initialHeader.ariaSnapshot();
  expect(initialHeaderAccessibility).toContain(LONG_HEADER_QUERY_TITLE);
  expect(initialHeaderAccessibility).toContain(LONG_HEADER_PROJECT_TITLE);
  expect(workersStarted).toBe(0);

  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await expect(author.getByTestId('author-compose-tab')).toBeVisible();
  await expect(author.getByTestId('author-code-tab')).toBeVisible();
  await author.getByTestId('author-code-tab').click();
  await expect(author.getByTestId('author-code-tab')).toHaveClass(/is-active/u);
  await expect(author.getByTestId('author-code-tab')).toHaveCSS(
    'border-bottom-width',
    '2px',
  );
  await expect(page.getByTestId('query-view-author')).toHaveClass(/is-active/u);
  await author.getByTestId('author-compose-tab').click();
  const editorPane = page.locator('#workspace-editor-pane');
  const resultsPane = page.locator('#workspace-results-pane');
  if (isMobile) {
    await page.locator('#workspace-jump-to-results').click();
    await expect(page.getByTestId('author-results-empty')).toBeVisible();
    await expect(resultsPane).toBeVisible();
    await expect(editorPane).toBeVisible();
    await page.locator('#workspace-back-to-editor').click();
    await expect(editorPane).toBeVisible();
    await expect(resultsPane).toBeVisible();
  } else {
    await expect(page.getByTestId('author-results-empty')).toBeVisible();
    await expect(editorPane).toBeVisible();
    await expect(resultsPane).toBeVisible();
  }
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

  const joinedSource = await copyEditorSource(page, editor);
  expect(joinedSource).toContain('join Customer as c');
  expect(joinedSource).toContain('order by i.InvoiceId');
  expect(joinedSource).toContain('c.FirstName');
  await author.getByTestId('author-compose-tab').click();
  const compose = author.locator('sneat-author-compose-controls');
  await expect(compose).toBeVisible();
  await expect(compose).toContainText(
    'Grouping is unavailable for Invoice–Customer joins',
  );
  await expect(
    compose.getByLabel('Group by CustomerId and count invoices'),
  ).toHaveCount(0);
  const joinedLimit = compose.getByRole('spinbutton', { name: 'Row limit' });
  await expect(joinedLimit).toHaveValue('100');
  const joinedInvoiceDate = compose.getByLabel('InvoiceDate', { exact: true });
  await expect(joinedInvoiceDate).toBeChecked();
  await joinedLimit.fill('75');
  await joinedLimit.press('Tab');
  await joinedInvoiceDate.uncheck();
  await author.getByTestId('author-code-tab').click();
  const withoutInvoiceDate = joinedSource.replace(', i.InvoiceDate', '');
  const limitedWithoutDate = withoutInvoiceDate.replace(
    'limit 100',
    'limit 75',
  );
  await expectEditorSource(page, editor, limitedWithoutDate);
  await author.getByTestId('author-compose-tab').click();
  await compose.getByLabel('InvoiceDate', { exact: true }).check();
  await author.getByTestId('author-code-tab').click();
  const limitedWithDate = joinedSource.replace('limit 100', 'limit 75');
  await expectEditorSource(page, editor, limitedWithDate);
  expect(workersStarted).toBe(0);

  const customerId = author
    .getByTestId('author-customer-id')
    .locator('input:not(.cloned-input)');
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
  expect(previewSql).toContain('LIMIT 75');
  expect(previewSql).not.toContain('= 1');
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );
  expect(workersStarted).toBe(0);

  // Prove the browser clipboard receives the current preview string itself,
  // not highlighted DOM, bindings, or an executed request. The same checks
  // run at narrow widths; mobile WebKit uses a real touch activation.
  const previewSourceBeforeTools = await copyEditorSource(page, editor);
  const bindingsBeforeTools = await preview
    .locator('.author-binding-list')
    .textContent();
  const receiptCountBeforeTools = await page
    .getByTestId('author-execution-receipt')
    .count();
  const copySqlButton = preview.getByRole('button', { name: 'Copy SQL' });
  const wrapSqlButton = preview.getByRole('button', { name: 'Wrap SQL' });
  for (const button of [copySqlButton, wrapSqlButton]) {
    await expect
      .poll(() =>
        button.evaluate((element) => element.getBoundingClientRect().height),
      )
      .toBeGreaterThanOrEqual(44);
  }
  if (testInfo.project.use.browserName !== 'webkit') {
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write']);
  }
  const expectedPreviewSql = previewSql ?? '';
  const readClipboard = async (): Promise<string> =>
    page.evaluate(() => navigator.clipboard.readText());
  const assertCopyAndWrap = async (useTouch: boolean): Promise<void> => {
    const useWrap = async (): Promise<void> => {
      if (useTouch) {
        await wrapSqlButton.tap();
      } else {
        await wrapSqlButton.focus();
        await wrapSqlButton.press('Enter');
      }
    };
    const copyFromPreview = async (): Promise<void> => {
      if (!useTouch) {
        await copySqlButton.focus();
        await copySqlButton.press('Enter');
      } else {
        await copySqlButton.tap();
      }
      await expect(preview.getByTestId('author-copy-sql-status')).toContainText(
        'Preview SQL copied',
      );
      if (testInfo.project.use.browserName !== 'webkit') {
        await expect.poll(readClipboard).toBe(expectedPreviewSql);
      }
    };

    await expect(wrapSqlButton).toHaveAttribute('aria-pressed', 'false');
    await useWrap();
    await expect(wrapSqlButton).toHaveAttribute('aria-pressed', 'true');
    await expect(preview.locator('pre')).toHaveText(expectedPreviewSql);
    await copyFromPreview();
    const layout = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const documentWidth = document.documentElement.scrollWidth;
      const region = document.querySelector('.author-sql-scroll');
      const pre = region?.querySelector('pre');
      return {
        viewportWidth,
        documentWidth,
        regionWidth: region?.getBoundingClientRect().width ?? 0,
        regionClientWidth: region?.clientWidth ?? 0,
        regionScrollWidth: region?.scrollWidth ?? 0,
        preWidth: pre?.getBoundingClientRect().width ?? 0,
      };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.regionWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.preWidth).toBeLessThanOrEqual(layout.regionClientWidth + 1);
    expect(layout.regionScrollWidth).toBeLessThanOrEqual(
      layout.regionClientWidth + 1,
    );

    await useWrap();
    await expect(wrapSqlButton).toHaveAttribute('aria-pressed', 'false');
    await expect(preview.locator('pre')).toHaveText(expectedPreviewSql);
    await copyFromPreview();
    const unwrappedLayout = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      regionWidth:
        document.querySelector('.author-sql-scroll')?.getBoundingClientRect()
          .width ?? 0,
    }));
    expect(unwrappedLayout.documentWidth).toBeLessThanOrEqual(
      unwrappedLayout.viewportWidth,
    );
    expect(unwrappedLayout.regionWidth).toBeLessThanOrEqual(
      unwrappedLayout.viewportWidth,
    );
  };

  const initialViewport = page.viewportSize();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await assertCopyAndWrap(isMobile);
  }
  if (initialViewport) await page.setViewportSize(initialViewport);
  expect(await copyEditorSource(page, editor)).toBe(previewSourceBeforeTools);
  expect(await preview.locator('.author-binding-list').textContent()).toBe(
    bindingsBeforeTools,
  );
  expect(await page.getByTestId('author-execution-receipt').count()).toBe(
    receiptCountBeforeTools,
  );
  expect(workersStarted).toBe(0);
  await expect(preview.locator('pre')).toHaveText(expectedPreviewSql);
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  await customerId.fill('1.5');
  await expect(preview).toContainText('Invalid · enter a whole number');
  await expect(
    author.getByText('Enter a whole-number Customer ID', { exact: true }),
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
  if (isMobile) await page.locator('#workspace-jump-to-results').click();
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
  if (!isMobile) {
    const sources = author.getByTestId('author-source-discovery');
    if (await sources.evaluate((details) => (details as HTMLDetailsElement).open)) {
      await sources.locator('summary').click();
    }
    const sqlDisclosure = author.locator('.author-sql-disclosure');
    if (await sqlDisclosure.evaluate((details) => (details as HTMLDetailsElement).open)) {
      await sqlDisclosure.locator(':scope > summary').click();
    }
    await executionDetails.click();
    await expect(receipt.locator('.author-receipt-details')).not.toHaveAttribute(
      'open',
    );
    const originalViewport = page.viewportSize();
    await page.setViewportSize({ width: 1280, height: 720 });
    await activePage(page).evaluate((active) => {
      const scrollElement = active
        .querySelector('ion-content')
        ?.shadowRoot?.querySelector('.inner-scroll') as HTMLElement | null;
      if (scrollElement) scrollElement.scrollTop = 0;
    });
    await expect(author.getByTestId('author-run')).toHaveCount(1);
    await expect(author.getByTestId('author-preview')).toHaveCount(1);
    await expect(author.getByTestId('author-customer-id').locator('input')).toHaveCount(1);
    await expect(author.getByTestId('author-compose-tab')).toHaveCount(1);
    await expect(author.getByTestId('author-code-tab')).toHaveCount(1);
    await expect(author.locator('.cm-editor')).toHaveCount(1);
    await expect(page.locator('#author-results-heading')).toHaveCount(1);
    const firstRowBounds = await rows.nth(1).evaluate((row) => {
      const bounds = row.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom };
    });
    expect(firstRowBounds.top).toBeGreaterThanOrEqual(0);
    expect(firstRowBounds.bottom).toBeLessThanOrEqual(698);
    await expect(rows.nth(1)).toBeInViewport({ ratio: 1 });
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
  expect(errors).toEqual([]);

  if (isMobile) await page.locator('#workspace-back-to-editor').click();
  await author.getByTestId('author-compose-tab').click();
  await expect(joinedLimit).toHaveValue('75');
  await joinedLimit.fill('3');
  await joinedLimit.press('Tab');
  await author.getByTestId('author-code-tab').click();
  const reducedSource = limitedWithDate.replace('limit 75', 'limit 3');
  await expectEditorSource(page, editor, reducedSource);
  if (isMobile) await page.locator('#workspace-jump-to-results').click();
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText('7 rows');
  if (isMobile) await page.locator('#workspace-back-to-editor').click();
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );
  expect(workersStarted).toBe(1);

  await author.getByTestId('author-preview').click();
  const reducedPreview = author.getByTestId('author-sql-preview');
  await expect(reducedPreview).toBeVisible();
  await expect(reducedPreview).toContainText('Preview · Not executed');
  const reducedPreviewSql = await reducedPreview.locator('pre').textContent();
  expect(reducedPreviewSql).toContain('LIMIT 3');
  expect(reducedPreviewSql).toContain('"i"."InvoiceDate"');
  expect(reducedPreviewSql).toContain('"c"."FirstName"');
  expect(workersStarted).toBe(1);
  await author.getByTestId('author-run').click();
  if (isMobile) await page.locator('#workspace-jump-to-results').click();
  await expect(receipt).toContainText('Executed', { timeout: 20_000 });
  await expect(receipt).toContainText('3 rows');
  await expect.poll(() => workersStarted).toBe(2);
  const reducedRows = page.getByRole('grid').getByRole('row');
  await expect(reducedRows).toHaveCount(4);
  await expect(reducedRows.nth(1)).toContainText('98');
  await expect(reducedRows.nth(1)).toContainText('2022-03-11 00:00:00');
  await expect(reducedRows.nth(1)).toContainText('Luís');
  await expect(reducedRows.nth(2)).toContainText('121');
  await expect(reducedRows.nth(3)).toContainText('143');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const resultsView = page.locator('#workspace-jump-to-results');
    await resultsView.click();
    await expect(page.locator('#author-results-heading')).toBeFocused();
    await expect(page.locator('#workspace-results-pane')).toBeVisible();
    await expect(page.locator('#workspace-editor-pane')).toBeVisible();
    await expect(receipt).toBeVisible();
    const retainedReceiptText = await receipt.textContent();
    const retainedRows = await page
      .getByRole('grid')
      .getByRole('row')
      .allTextContents();
    const editorView = page.locator('#workspace-back-to-editor');
    await editorView.click();
    await expect(author.locator('[data-workspace-heading]')).toBeFocused();
    await expect(page.locator('#workspace-results-pane')).toBeVisible();
    await expect(author).toBeVisible();
    const currentPreview = author.getByTestId('author-sql-preview');
    await expect(currentPreview).toBeVisible();
    const currentPreviewSql = await currentPreview.locator('pre').textContent();
    const retainedSource = await copyEditorSource(page, editor);
    const retainedBindings = await currentPreview
      .locator('.author-binding-list')
      .textContent();
    const currentWrapButton = currentPreview.getByRole('button', {
      name: 'Wrap SQL',
    });
    const currentCopyButton = currentPreview.getByRole('button', {
      name: 'Copy SQL',
    });
    for (const button of [currentWrapButton, currentCopyButton]) {
      await expect
        .poll(() =>
          button.evaluate((element) => element.getBoundingClientRect().height),
        )
        .toBeGreaterThanOrEqual(44);
    }
    await currentWrapButton.click();
    await expect(currentWrapButton).toHaveAttribute('aria-pressed', 'true');
    await expect(currentPreview.locator('pre')).toHaveText(
      currentPreviewSql ?? '',
    );
    await currentCopyButton.focus();
    await currentCopyButton.press('Enter');
    await expect(
      currentPreview.getByTestId('author-copy-sql-status'),
    ).toContainText('Preview SQL copied');
    if (testInfo.project.use.browserName !== 'webkit') {
      await expect.poll(readClipboard).toBe(currentPreviewSql ?? '');
    }
    const wrappedDocument = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(wrappedDocument.documentWidth).toBeLessThanOrEqual(
      wrappedDocument.viewportWidth,
    );
    await currentWrapButton.click();
    await expect(currentWrapButton).toHaveAttribute('aria-pressed', 'false');
    await expect(currentPreview.locator('pre')).toHaveText(
      currentPreviewSql ?? '',
    );
    await currentCopyButton.focus();
    await currentCopyButton.press('Enter');
    await expect(
      currentPreview.getByTestId('author-copy-sql-status'),
    ).toContainText('Preview SQL copied');
    if (testInfo.project.use.browserName !== 'webkit') {
      await expect.poll(readClipboard).toBe(currentPreviewSql ?? '');
    }
    expect(await copyEditorSource(page, editor)).toBe(retainedSource);
    expect(
      await currentPreview.locator('.author-binding-list').textContent(),
    ).toBe(retainedBindings);
    expect(await receipt.textContent()).toBe(retainedReceiptText);
    expect(workersStarted).toBe(2);
    await resultsView.click();
    await expect(receipt).toBeVisible();
    expect(
      await page.getByRole('grid').getByRole('row').allTextContents(),
    ).toEqual(retainedRows);
    const header = await activePage(page).evaluate((active) => {
      const bounds = (selector: string): DOMRect | undefined =>
        active.querySelector(selector)?.getBoundingClientRect();
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
  const authorPageTitle = activePage(page).locator('sneat-datatug-page-title');
  await expect(queryToolbar).toHaveClass(/\bios\b/u);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(authorPageTitle).toContainText(LONG_HEADER_QUERY_TITLE);
    await expect(authorPageTitle).toContainText(LONG_HEADER_PROJECT_TITLE);
    const titleAccessibility = await authorPageTitle
      .locator('ion-title')
      .ariaSnapshot();
    expect(titleAccessibility).toContain(LONG_HEADER_QUERY_TITLE);
    expect(titleAccessibility).toContain(LONG_HEADER_PROJECT_TITLE);
    const header = await activePage(page).evaluate((active) => {
      const bounds = (selector: string): DOMRect | undefined =>
        active.querySelector(selector)?.getBoundingClientRect();
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
  const workersBeforeSecondEmailApply = workersStarted;
  expect(workersBeforeSecondEmailApply).toBe(2);
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
  expect(workersStarted).toBe(workersBeforeSecondEmailApply);
  await secondAuthor.getByTestId('author-preview').click();
  const secondPreview = secondAuthor.getByTestId('author-sql-preview');
  await expect(secondPreview).toBeVisible();
  const secondPreviewSql = await secondPreview.locator('pre').textContent();
  expect(secondPreviewSql).toContain('"c"."Email"');
  expect(workersStarted).toBe(workersBeforeSecondEmailApply);
  await secondAuthor
    .getByTestId('author-customer-id')
    .locator('input')
    .fill('1');
  await expect(secondAuthor.getByTestId('author-run')).toBeEnabled();
  expect(workersStarted).toBe(workersBeforeSecondEmailApply);
  await secondAuthor.getByTestId('author-run').click();
  await expect(page.getByTestId('author-execution-receipt')).toContainText(
    '7 rows',
    { timeout: 20_000 },
  );
  await expect
    .poll(() => workersStarted)
    .toBe(workersBeforeSecondEmailApply + 1);
  const secondRows = page.getByRole('grid').getByRole('row');
  await expect(secondRows).toHaveCount(8);
  await expect(secondRows.nth(1)).toContainText('2022-03-11 00:00:00');
  await expect(secondRows.nth(1)).toContainText('luisg@embraer.com.br');
  expect(workersStarted).toBe(3);
  expect(errors).toEqual([]);
});

test('Preview syntax errors navigate to the exact unchanged draft without running it', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const isMobile = testInfo.project.use.isMobile === true;
  let workersStarted = 0;
  page.on('worker', () => workersStarted++);
  await page.goto(AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await author.getByTestId('author-code-tab').click();

  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  const customerId = author
    .getByTestId('author-customer-id')
    .locator('input:not(.cloned-input)');
  const compactSource = savedQuerySource('chinook-invoice-author');
  expect(compactSource).toMatch(/select i\.InvoiceId, i\.InvoiceDate\s*$/u);
  await expectEditorSource(page, editor, compactSource);
  await customerId.fill('');
  await expect(customerId).toHaveValue('');
  // Finish the input interaction before clicking an action: Ionic's mobile
  // keyboard scroll assist can still move the button after fill() resolves.
  await customerId.blur();
  await expect(customerId).not.toBeFocused();
  await expect(
    author.getByTestId('author-customer-id').locator('.cloned-input'),
  ).toHaveCount(0);

  await author.getByTestId('author-preview').click();
  await expect(author.getByTestId('author-sql-preview')).toContainText(
    'Preview · Not executed',
  );
  expect(workersStarted).toBe(0);
  await customerId.fill('1');
  await author.getByTestId('author-preview').click();
  await author.getByTestId('author-run').click();
  if (isMobile) await page.locator('#workspace-jump-to-results').click();
  const retainedReceipt = page.getByTestId('author-execution-receipt');
  await expect(retainedReceipt).toContainText('Executed');
  await expect(retainedReceipt).toContainText('7 rows');
  await expect.poll(() => workersStarted).toBe(1);
  const immutableReceiptDetails = retainedReceipt
    .locator('.author-receipt-details > p')
    .filter({
      hasText:
        /^\s*(Observed at|Worker execution ID|Draft revision|Worker verified bindings)/u,
    });
  const retainedReceiptDetails =
    await immutableReceiptDetails.allTextContents();
  expect(retainedReceiptDetails).toHaveLength(4);
  const retainedSql = await retainedReceipt
    .locator('.author-receipt-details pre')
    .textContent();
  const retainedRows = await page
    .getByRole('grid')
    .getByRole('row')
    .allTextContents();
  expect(retainedRows).toHaveLength(8);
  if (isMobile) await page.locator('#workspace-back-to-editor').click();

  const bareMultilineSource = compactSource.replace(
    /select i\.InvoiceId, i\.InvoiceDate\s*$/u,
    'select\n  i.InvoiceId\n  i.InvoiceDate',
  );
  expect(bareMultilineSource).not.toBe(compactSource);
  await pasteCode(page, editor, bareMultilineSource);
  await author.getByTestId('author-compose-tab').click();
  await author.getByTestId('author-preview').click();

  const previewError = author.getByRole('alert');
  await expect(previewError).toContainText(
    "multiline SELECT requires '(' on the SELECT header line",
  );
  await expect(editor).toHaveCount(0);
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );
  await expect(retainedReceipt).toContainText('7 rows');
  const diagnostic = author.getByRole('button', {
    name: /^Go to line [1-9]\d*, column [1-9]\d*$/u,
  });
  await expect(diagnostic).toBeVisible();
  await expect(diagnostic).toHaveAttribute(
    'aria-describedby',
    'author-preview-error-message',
  );
  const target = (await diagnostic.getAttribute('aria-label'))?.match(
    /^Go to line (\d+), column (\d+)$/u,
  );
  expect(target).toBeTruthy();
  const originalViewport = page.viewportSize();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() =>
        diagnostic.evaluate((button) => button.getBoundingClientRect().height),
      )
      .toBeGreaterThanOrEqual(44);
    const bounds = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(bounds.document).toBeLessThanOrEqual(bounds.viewport);
  }
  const nativeAction = author
    .getByTestId('author-preview-go-to-error')
    .locator('button');
  for (const theme of ['light', 'dark', 'forced-colors']) {
    await page.locator('ion-app').evaluate((app, dark) => {
      app.classList.toggle('ion-palette-dark', dark);
    }, theme === 'dark');
    await page.emulateMedia({
      forcedColors: theme === 'forced-colors' ? 'active' : 'none',
    });
    await expect(nativeAction).toBeVisible();
    const colors = await completionContrast(nativeAction);
    expect(colors.ratio).toBeGreaterThanOrEqual(4.5);
    console.log(
      `[preview-action-contrast] ${JSON.stringify({ theme, ...colors })}`,
    );
  }
  await page.emulateMedia({ forcedColors: 'none' });
  await page.locator('ion-app').evaluate((app) => {
    app.classList.remove('ion-palette-dark');
  });
  if (isMobile) await diagnostic.tap();
  else {
    await nativeAction.focus();
    await expect(nativeAction).toBeFocused();
    await nativeAction.press('Enter');
  }
  await expect(author.getByTestId('author-code-tab')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expectEditorSource(page, editor, bareMultilineSource);
  const caret = await editor.evaluate((element) => {
    const selection = window.getSelection();
    const focusNode = selection?.focusNode;
    const line =
      focusNode instanceof Element
        ? focusNode.closest('.cm-line')
        : focusNode?.parentElement?.closest('.cm-line');
    if (!selection || !focusNode || !line) return undefined;
    const range = document.createRange();
    range.selectNodeContents(line);
    range.setEnd(focusNode, selection.focusOffset);
    const renderedLines = [...element.querySelectorAll('.cm-line')];
    return {
      focused: document.activeElement === element,
      collapsed: selection.isCollapsed,
      line: renderedLines.indexOf(line) + 1,
      column: [...range.toString()].length + 1,
    };
  });
  expect(caret).toEqual({
    focused: true,
    collapsed: true,
    line: Number(target?.[1]),
    column: Number(target?.[2]),
  });
  expect(await copyEditorSource(page, editor)).toBe(bareMultilineSource);
  await expect(customerId).toHaveValue('1');
  expect(workersStarted).toBe(1);
  if (originalViewport && !isMobile)
    await page.setViewportSize(originalViewport);
  if (isMobile) await page.locator('#workspace-jump-to-results').click();
  await expect(retainedReceipt).toContainText('Previous run');
  await expect(immutableReceiptDetails).toHaveCount(4);
  expect(await immutableReceiptDetails.allTextContents()).toEqual(
    retainedReceiptDetails,
  );
  await expect(
    retainedReceipt.locator('.author-receipt-details pre'),
  ).toHaveText(retainedSql ?? '');
  await expect(page.getByRole('grid').getByRole('row')).toHaveCount(8);
  expect(
    await page.getByRole('grid').getByRole('row').allTextContents(),
  ).toEqual(retainedRows);
  if (isMobile) await page.locator('#workspace-back-to-editor').click();
  await customerId.fill('');

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
  expect(workersStarted).toBe(1);

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
