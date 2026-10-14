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
const LEGACY_DTQL_URL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/query/customers%2Fcustomer-invoices?id=customers%2Fcustomer-invoices&editor=text&env=local';
const LONG_HEADER_QUERY_TITLE =
  '請求書・顧客向けの長いタイトル — Invoice Author 🚀 東京';
const LONG_HEADER_PROJECT_TITLE =
  'データベース・デモ用プロジェクト — DemoDB datasets 🌍';

// @codemirror/autocomplete's installed default; Enter is intentionally ignored
// until the option has been visible for this interaction window.
const COMPLETION_INTERACTION_DELAY_MS = 75;

// Playwright resolves ControlOrMeta from the host OS, but CodeMirror treats
// iPhone/iPad/iPod UAs as Mac and binds Mod to Meta.
const generateAuthorPreview = async (author: Locator): Promise<void> => {
  await author.getByTestId('author-preview-tab').click();
  const nativeButton = author.getByTestId('author-preview').locator('button');
  await expect(nativeButton).toBeVisible();
  await nativeButton.scrollIntoViewIfNeeded();
  await nativeButton.click();
};

const openEditorActions = async (
  page: Page,
  author: Locator,
  activation: 'pointer' | 'keyboard' = 'pointer',
): Promise<Locator> => {
  const trigger = author.getByRole('button', { name: 'More editor actions' });
  if (activation === 'keyboard') {
    await trigger.focus();
    await trigger.press('Space');
  } else {
    await trigger.click();
  }
  const menu = page
    .getByTestId('author-code-tools-popover')
    .filter({ visible: true });
  await expect(menu).toBeVisible();
  return menu;
};

const clickEditorAction = async (
  page: Page,
  author: Locator,
  action: 'Format TugQL' | 'Undo',
): Promise<void> => {
  if ((page.viewportSize()?.width ?? 1280) <= 700) {
    const menu = await openEditorActions(page, author);
    await menu.getByRole('button', { name: action, exact: true }).click();
    await expect(menu).toBeHidden();
  } else {
    await author
      .getByTestId(
        action === 'Format TugQL'
          ? 'author-format-tugql'
          : 'author-undo-format',
      )
      .click();
  }
};

const clickSuggestions = async (page: Page, author: Locator): Promise<void> => {
  if ((page.viewportSize()?.width ?? 1280) <= 700) {
    const menu = await openEditorActions(page, author);
    await menu
      .getByRole('button', { name: 'Suggestions (Ctrl+Space)', exact: true })
      .click();
    await expect(menu).toBeHidden();
  } else {
    await author
      .getByRole('button', { name: 'Suggestions (Ctrl+Space)' })
      .click();
  }
};

const ionicCheckboxIsChecked = (checkbox: Locator): Promise<boolean> =>
  checkbox.evaluate(
    (element) => (element as HTMLElement & { checked: boolean }).checked,
  );

const setIonicCheckbox = async (
  checkbox: Locator,
  checked: boolean,
): Promise<void> => {
  if ((await ionicCheckboxIsChecked(checkbox)) !== checked) {
    await checkbox.click();
  }
  await expect.poll(() => ionicCheckboxIsChecked(checkbox)).toBe(checked);
};

const installQueryExecutionMessageProbe = async (
  page: Page,
): Promise<(() => Promise<number>)> => {
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
  return () =>
    page.evaluate(
      () =>
        (
          window as Window & {
            __datatugQueryExecutionMessages?: number;
          }
        ).__datatugQueryExecutionMessages ?? 0,
    );
};

const expectAuthorMode = async (
  author: Locator,
  mode: 'compose' | 'code' | 'preview',
): Promise<void> => {
  const selectedTab = author.getByTestId(
    mode === 'preview' ? 'author-preview-tab' : `author-${mode}-tab`,
  );
  await expect(selectedTab).toHaveClass(/segment-button-checked/u);
};

const openCustomerId = async (author: Locator): Promise<Locator> => {
  await author.getByTestId('workspace-parameters-tab').click();
  const input = author.getByTestId('author-customer-id').locator('input:not(.cloned-input)');
  await expect(input).toBeVisible();
  return input;
};

const expectIonicButtonDisabled = async (
  button: Locator,
  disabled: boolean,
): Promise<void> => {
  await expect
    .poll(() =>
      button.evaluate((element) => {
        const nativeButton = element.shadowRoot?.querySelector('button');
        return nativeButton
          ? nativeButton.disabled
          : element.hasAttribute('disabled') ||
              element.getAttribute('aria-disabled') === 'true';
      }),
    )
    .toBe(disabled);
};

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

const savedLegacyDtqlSource = (repository = DEMO_REPO): string =>
  readFileSync(join(repository ?? '', 'demo-project-1', 'queries', 'customers', 'customer-invoices.query.dtql'), 'utf8');

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
  await expect(author.getByTestId('author-code-tab')).toHaveText('TugQL Query');
  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  await expect(editor).toHaveAttribute('aria-label', 'TugQL Query');
  const original = savedQuerySource('chinook-invoice-author');
  const keyword = editor.locator('.tugql-token-keyword').first();
  const parameter = editor.locator('.tugql-token-parameter').first();
  await expect(keyword).toBeVisible();
  await expect(parameter).toBeVisible();
  expect(await contrastRatio(keyword)).toBeGreaterThanOrEqual(4.5);
  expect(await contrastRatio(parameter)).toBeGreaterThanOrEqual(4.5);

  await generateAuthorPreview(author);
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
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
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
  await author.getByTestId('author-preview-tab').click();
  await expectAuthorMode(author, 'preview');
  await expect(author.getByTestId('author-preview-empty')).toBeVisible();
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
  await author.getByTestId('author-code-tab').click();
  await expectAuthorMode(author, 'code');
  await expect(
    author.getByTestId('query-body-text').locator('.cm-editor'),
  ).toBeVisible();
  const editorRoot = author
    .getByTestId('query-body-text')
    .locator('.cm-editor');
  await editorRoot.evaluate((element) => {
    (
      window as unknown as { __queryWorkbenchEditor?: Element }
    ).__queryWorkbenchEditor = element;
  });
  await editor.focus();
  await editor.press('End');
  await editor.press('Shift+ArrowLeft');
  const selectedBeforeLayout = await editor.evaluate(
    () => window.getSelection()?.toString() ?? '',
  );
  expect(selectedBeforeLayout).toBe('x');

  const sourceDiscovery = author.getByTestId('author-source-discovery');
  await author.getByTestId('author-view-tabs')
    .locator('ion-segment-button[value="related"]')
    .click();
  await expect(sourceDiscovery).toContainText('Invoice', { timeout: 20_000 });
  await author.getByTestId('author-preview-tab').click();
  await expect(
    author.getByTestId('query-body-text').locator('.cm-editor'),
  ).toBeHidden();
  await expect(author.getByTestId('author-preview-empty')).toBeVisible();
  await author.getByTestId('author-code-tab').click();
  await expect(
    author.getByTestId('query-body-text').locator('.cm-editor'),
  ).toBeVisible();

  const originalViewport = page.viewportSize();
  const codeTabGeometry = async () =>
    author.evaluate((element) => {
      const tab = element.querySelector('[data-testid="author-code-tab"]');
      const segment = element.querySelector('[data-testid="author-view-tabs"]');
      const range = document.createRange();
      const label = tab?.querySelector('ion-label');
      if (label) range.selectNodeContents(label);
      const text = range.getBoundingClientRect();
      const content = segment?.getBoundingClientRect();
      const tabBounds = tab?.getBoundingClientRect();
      return {
        textLeft: text.left,
        textRight: text.right,
        contentLeft: content?.left ?? 0,
        contentRight: content?.right ?? 0,
        tabLeft: tabBounds?.left ?? 0,
        tabRight: tabBounds?.right ?? 0,
        tabWidth: tabBounds?.width ?? 0,
        visibleTitleCount: element.querySelectorAll(
          'sneat-author-code-editor .author-code-label',
        ).length,
      };
    });
  await expect(author.locator('.author-code-label')).toHaveCount(0);
  await expect(author.getByTestId('author-code-tab')).toHaveText('TugQL Query');
  await expect
    .poll(async () => {
      const geometry = await codeTabGeometry();
      return (
        geometry.textLeft >= geometry.contentLeft &&
        geometry.textRight <= geometry.contentRight
      );
    })
    .toBe(true);
  const desktopCodeTabBounds = await codeTabGeometry();
  expect(
    desktopCodeTabBounds.textLeft - desktopCodeTabBounds.tabLeft,
  ).toBeGreaterThanOrEqual(8);
  expect(desktopCodeTabBounds.textRight).toBeLessThanOrEqual(
    desktopCodeTabBounds.tabRight - 8,
  );
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(async () => {
        const geometry = await codeTabGeometry();
        return (
          geometry.textLeft >= geometry.contentLeft &&
          geometry.textRight <= geometry.contentRight
        );
      })
      .toBe(true);
    const mobileCodeTab = await codeTabGeometry();
    expect(mobileCodeTab.textLeft - mobileCodeTab.tabLeft).toBeGreaterThanOrEqual(8);
    expect(mobileCodeTab.textRight).toBeLessThanOrEqual(
      mobileCodeTab.tabRight - 8,
    );
    expect(mobileCodeTab.visibleTitleCount).toBe(0);
    expect(mobileCodeTab.tabWidth).toBeGreaterThanOrEqual(80);
    const moreButton = await author.locator('.author-code-overflow').boundingBox();
    expect(moreButton?.width).toBeGreaterThanOrEqual(44);
    expect(moreButton?.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId('workspace-jump-to-results').click();
    await expect(page.locator('#author-results-heading')).toBeFocused();
    const mobileHeader = await author.evaluate((element) => {
      const tab = element.querySelector(
        '[data-testid="author-code-tab"]',
      );
      const tabs = element.querySelectorAll(
        '[data-testid="author-view-tabs"] ion-segment-button',
      );
      const resultHeading = document.querySelector('.author-results-heading');
      return {
        codeTabWidth: tab?.getBoundingClientRect().width ?? 0,
        resultHeadingWidth: resultHeading?.getBoundingClientRect().width ?? 0,
        buttons: [...tabs].map((button) => {
          const native = button.shadowRoot?.querySelector('button');
          return {
            label: button.textContent?.trim() ?? '',
            width: button.getBoundingClientRect().width,
            textWidth: native?.scrollWidth ?? 0,
            textClientWidth: native?.clientWidth ?? 0,
          };
        }),
      };
    });
    expect(mobileHeader.codeTabWidth).toBeGreaterThanOrEqual(80);
    expect(mobileHeader.resultHeadingWidth).toBeGreaterThanOrEqual(60);
    expect(mobileHeader.buttons).toHaveLength(6);
    for (const button of mobileHeader.buttons) {
      expect(button.label).toMatch(/Compose|TugQL Query|Preview SQL|Parameters|Sources|Related/u);
      expect(button.width).toBeGreaterThan(0);
      expect(button.textWidth).toBeLessThanOrEqual(button.textClientWidth + 1);
    }
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
      .poll(() =>
        editor.evaluate(() => window.getSelection()?.toString() ?? ''),
      )
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
  await editor.press(`${mod}+End`);
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
  await expect(genericGridViewport).toHaveCSS('height', '360px');
  const genericGridPadding = genericGridViewport.locator(
    'xpath=ancestor::div[contains(@class, "ion-padding-horizontal")][1]',
  );
  await expect(genericGridPadding).toHaveCount(1);
  expect(
    await genericGridPadding.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).paddingLeft),
    ),
  ).toBeGreaterThan(0);
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
    const renderedCells = await rows
      .nth(index)
      .getByRole('gridcell')
      .allTextContents();
    // AG Grid may buffer the fourth column at narrower flex widths; its value
    // is checked separately after scrolling horizontally below.
    cells.push(isNarrow ? renderedCells.slice(0, 3) : renderedCells);
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

// query-workspace#ac:shared-text-workspace — read-only structural transfer never changes the SQL request.
test('native SQL keeps one reachable workspace row and a read-only TugQL representation of a fully parsed draft', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const writes: string[] = [];
  let workersStarted = 0;
  page.on('worker', () => workersStarted++);
  page.on('request', (request) => {
    if (/^https:\/\/api\.github\.com\//u.test(request.url()) && !['GET', 'OPTIONS'].includes(request.method()))
      writes.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PLAYLIST_SQL_URL);
  const workspace = page.getByTestId('unified-text-workspace');
  const tabs = workspace.getByTestId('author-view-tabs');
  const sourceTab = tabs.locator('ion-segment-button[value="sql"]');
  const editor = workspace.getByTestId('query-body-text').locator('.cm-content');
  const saved = savedSqlSource('chinook-playlist-composition');
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await expectEditorSource(page, editor, saved);
  await expect(tabs.locator('ion-segment-button')).toHaveCount(7);
  await expect(tabs).toHaveClass(/\bmd\b/u);
  await expect(sourceTab).toHaveClass(/\bmd\b/u);
  await expect(tabs.locator('ion-segment-button[value="parameters"] ion-chip')).toHaveText('0');
  await expect(tabs.locator('ion-segment-button[value="sources"] ion-chip')).toHaveText('…');
  await expect.poll(() => tabs.evaluate((segment) => {
    const selected = segment.querySelector('ion-segment-button[value="sql"]');
    if (!selected) return false;
    const viewport = segment.getBoundingClientRect();
    const button = selected.getBoundingClientRect();
    return button.left >= viewport.left - 1 && button.right <= viewport.right + 1 &&
      button.height >= 44 && segment.getBoundingClientRect().height <= 56 &&
      document.documentElement.scrollWidth <= innerWidth + 1;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('unified-sql-390.png') });
  testInfo.annotations.push({ type: 'screenshot', description: 'unified-sql-390.png: expected the initially selected SQL source tab fully visible within one 48px scrollable Ionic row; observed it in view with the editable saved SQL below and no page overflow.' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(() => tabs.evaluate((segment) => segment.getBoundingClientRect().width)).toBeGreaterThan(800);
  const content = page.locator('sneat-datatug-sql-editor ion-content');
  const verticalBefore = await content.evaluate(async (host) => {
    const scroll = await (host as HTMLIonContentElement).getScrollElement();
    scroll.scrollTop = Math.min(80, scroll.scrollHeight - scroll.clientHeight);
    return scroll.scrollTop;
  });
  expect(verticalBefore).toBeGreaterThan(20);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => tabs.evaluate((segment) => {
    const selected = segment.querySelector('ion-segment-button[value="sql"]');
    if (!selected) return false;
    const viewport = segment.getBoundingClientRect();
    const button = selected.getBoundingClientRect();
    return button.left >= viewport.left - 1 && button.right <= viewport.right + 1 &&
      button.height >= 44 &&
      document.documentElement.scrollWidth <= innerWidth + 1;
  })).toBe(true);
  const verticalAfterResize = await content.evaluate(async (host) => {
    const scroll = await (host as HTMLIonContentElement).getScrollElement();
    return scroll.scrollTop;
  });
  expect(verticalAfterResize).toBeGreaterThan(20);
  // Responsive reflow can preserve the visible anchor with a different scrollTop.
  // Isolate the tab reveal at a fixed viewport to catch vertical scrolling by it.
  const verticalBeforeReveal = await content.evaluate(async (host) => {
    const scroll = await (host as HTMLIonContentElement).getScrollElement();
    scroll.scrollTop = Math.min(80, scroll.scrollHeight - scroll.clientHeight);
    return scroll.scrollTop;
  });
  expect(verticalBeforeReveal).toBeGreaterThan(20);
  const selectedWasOffscreen = await tabs.evaluate((segment) => {
    segment.scrollLeft = 0;
    const selected = segment.querySelector('ion-segment-button[value="sql"]');
    if (!selected) return false;
    return selected.getBoundingClientRect().right > segment.getBoundingClientRect().right + 1;
  });
  expect(selectedWasOffscreen).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await expect.poll(() => tabs.evaluate((segment) => {
    const selected = segment.querySelector('ion-segment-button[value="sql"]');
    if (!selected) return false;
    const viewport = segment.getBoundingClientRect();
    const button = selected.getBoundingClientRect();
    return button.left >= viewport.left - 1 && button.right <= viewport.right + 1;
  })).toBe(true);
  const verticalAfterReveal = await content.evaluate(async (host) => {
    const scroll = await (host as HTMLIonContentElement).getScrollElement();
    return scroll.scrollTop;
  });
  expect(Math.abs(verticalAfterReveal - verticalBeforeReveal)).toBeLessThanOrEqual(2);
  await expectEditorSource(page, editor, saved);

  await tabs.locator('ion-segment-button[value="tugql"]').click();
  await expect(workspace.getByTestId('workspace-derived-tugql')).toContainText('unavailable');
  await expect(workspace.getByTestId('workspace-derived-tugql')).toContainText(/function|subquery|expression/iu);
  await sourceTab.click();
  const simple = 'SELECT AlbumId, Title FROM Album ORDER BY AlbumId LIMIT 10;';
  const editorElement = workspace.getByTestId('query-body-text').locator('.cm-editor');
  await editorElement.evaluate((element) => {
    (window as unknown as { __sqlWorkspaceEditor?: Element }).__sqlWorkspaceEditor = element;
  });
  await pasteCode(page, editor, simple);
  await expectEditorSource(page, editor, simple);
  await expect(tabs.locator('ion-segment-button[value="sources"] ion-chip')).toHaveText('1');
  await tabs.locator('ion-segment-button[value="tugql"]').click();
  const derived = workspace.getByTestId('workspace-derived-tugql');
  await expect(derived).toContainText('Read-only TugQL representation');
  await expect(derived.locator('pre')).toContainText('FROM Album');
  await expect(derived.locator('pre')).toContainText('LIMIT 10');
  await expect(workspace.getByTestId('workspace-sql-pane')).toBeHidden();
  await sourceTab.click();
  expect(await editorElement.evaluate((element) => element === (window as unknown as { __sqlWorkspaceEditor?: Element }).__sqlWorkspaceEditor)).toBe(true);
  await expectEditorSource(page, editor, simple);
  const mod = await codeMirrorMod(page);
  await editor.focus();
  await editor.press(`${mod}+Z`);
  await expectEditorSource(page, editor, saved);
  await expect(tabs.locator('ion-segment-button[value="sources"] ion-chip')).toHaveText('…');
  expect(workersStarted).toBe(0);
  expect(writes).toEqual([]);
  await expect(page.getByRole('grid')).toHaveCount(0);
});

// query-workspace#ac:shared-text-workspace — the saved YAML form remains the authoritative editable source.
test('legacy DTQL YAML opens in its native source pane through a cold link and refresh', async ({ page }) => {
  const source = savedLegacyDtqlSource();
  const writes: string[] = [];
  let workersStarted = 0;
  page.on('worker', () => workersStarted++);
  page.on('request', (request) => {
    if (/^https:\/\/api\.github\.com\//u.test(request.url()) && !['GET', 'OPTIONS'].includes(request.method()))
      writes.push(request.url());
  });
  await page.goto(LEGACY_DTQL_URL);
  const workspace = page.getByTestId('unified-text-workspace');
  const tabs = workspace.getByTestId('author-view-tabs');
  const sourceTab = tabs.locator('ion-segment-button[value="dtql"]');
  const editor = workspace.getByTestId('query-body-text');
  const textarea = editor.locator('textarea:not(.cloned-input)');
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await expect(sourceTab).toHaveClass(/segment-button-checked/u);
  await expect(textarea).toHaveValue(source);
  await expect(tabs.locator('ion-segment-button[value="parameters"] ion-chip')).toHaveText('1');
  await page.reload();
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await expect(sourceTab).toHaveClass(/segment-button-checked/u);
  await expect(textarea).toHaveValue(source);
  await tabs.locator('ion-segment-button[value="parameters"]').click();
  await expect(workspace.getByRole('textbox', { name: 'CustomerId value' })).toBeVisible();
  await tabs.locator('ion-segment-button[value="tugql"]').click();
  await expect(workspace.getByTestId('workspace-derived-tugql')).toContainText(/DTQL source uses the legacy representation.*TugQL import is unavailable/iu);
  await sourceTab.click();
  await textarea.fill(`${source}limit: 2\n`);
  await expect(textarea).toHaveValue(`${source}limit: 2\n`);
  await expect(sourceTab).toHaveClass(/segment-button-checked/u);
  expect(workersStarted).toBe(0);
  expect(writes).toEqual([]);
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

  const customerId = await openCustomerId(author);
  await customerId.fill('1');
  await generateAuthorPreview(author);
  await expectIonicButtonDisabled(runButton, false);
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
    await clickSuggestions(page, author);
  } else {
    await editor.press('Control+Space');
  }
  await expect(popup).toBeVisible();
  await expect(editor).toBeFocused();
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
    author.getByTestId('author-code-tab'),
  );
  const compactViewport = (page.viewportSize()?.width ?? 1280) <= 700;
  const editorActionsMenu = compactViewport
    ? await openEditorActions(page, author, 'keyboard')
    : undefined;
  const suggestionsControl = compactViewport
    ? editorActionsMenu?.getByRole('button', {
        name: 'Suggestions (Ctrl+Space)',
        exact: true,
      })
    : author.getByRole('button', { name: 'Suggestions (Ctrl+Space)' });
  if (!suggestionsControl) {
    throw new Error('The Suggestions action is not available.');
  }
  const buttonContrast = await completionContrast(suggestionsControl);
  const buttonHint = compactViewport
    ? editorActionsMenu
        ?.locator('ion-item')
        .filter({ hasText: 'Suggestions' })
        .locator('ion-label')
    : suggestionsControl;
  if (!buttonHint) throw new Error('The Suggestions label is not available.');
  const buttonHintContrast = await completionContrast(
    buttonHint,
  );
  for (const colors of [headerContrast, buttonContrast, buttonHintContrast]) {
    expect(colors.ratio).toBeGreaterThanOrEqual(4.5);
  }
  if (compactViewport && editorActionsMenu) {
    await page.keyboard.press('Escape');
    await expect(editorActionsMenu).toBeHidden();
    await expect(
      author.getByRole('button', { name: 'More editor actions' }),
    ).toBeFocused();
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
  await editor.focus();
  await expect(editor).toBeFocused();

  // Enter remains an ordinary newline away from a parameter completion
  // context, even while the draft still contains an incomplete @C reference.
  await editor.press(`${mod}+Home`);
  await expect
    .poll(() => editor.evaluate((element) => {
      const selection = window.getSelection();
      if (!selection?.focusNode || !element.contains(selection.focusNode)) return -1;
      const range = document.createRange();
      range.selectNodeContents(element);
      range.setEnd(selection.focusNode, selection.focusOffset);
      return range.toString().length;
    }))
    .toBe(0);
  await editor.press('Escape');
  await expect(popup).toHaveCount(0);
  await editor.press('Enter');
  const newlineDraft = `\n${incompleteDraft}`;
  await expectEditorSource(page, editor, newlineDraft);
  await editor.press(`${mod}+z`);
  await expectEditorSource(page, editor, incompleteDraft);
  await editor.press(`${mod}+End`);
  await expect(popup).toHaveCount(0);

  if (isMobile) {
    await clickSuggestions(page, author);
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
  await expectIonicButtonDisabled(runButton, true);
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
  const queryExecutionMessages = await installQueryExecutionMessageProbe(page);
  await page.goto(COUNT_AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });

  const original = savedQuerySource('chinook-customer-invoice-count');
  await author.getByTestId('author-compose-tab').click();
  const rowLimit = author
    .getByTestId('author-compose-row-limit')
    .locator('input:not(.cloned-input)');
  await rowLimit.press('ControlOrMeta+A');
  await rowLimit.press('Backspace');
  await expect(rowLimit).toHaveValue('');
  await rowLimit.press('1');
  await rowLimit.press('0');
  await rowLimit.press('Tab');
  await expect(rowLimit).toHaveValue('10');

  const threshold = author
    .getByTestId('author-compose-having-threshold')
    .locator('input:not(.cloned-input)');
  await threshold.press('ControlOrMeta+A');
  await threshold.press('Backspace');
  await expect(threshold).toHaveValue('');
  await threshold.press('-');
  await threshold.press('1');
  await threshold.press('Tab');
  await expect(threshold).toHaveValue('7');
  await expect(author.getByRole('alert')).toContainText(
    'HAVING threshold of 0 or greater',
  );
  const rejectedNegativeDraft = original.replace('limit 100\n', 'limit 10\n');
  await author.getByTestId('author-code-tab').click();
  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  await expect.poll(() => copyEditorSource(page, editor)).toBe(rejectedNegativeDraft);
  await expect(author.getByTestId('author-execution-receipt')).toHaveCount(0);
  expect(await queryExecutionMessages()).toBe(0);

  await author.getByTestId('author-compose-tab').click();
  await threshold.press('ControlOrMeta+A');
  await threshold.press('Backspace');
  await threshold.press('8');
  await threshold.press('Tab');
  await expect(threshold).toHaveValue('8');
  await author.getByTestId('author-code-tab').click();
  await expect
    .poll(() => copyEditorSource(page, editor))
    .toBe(
      original
        .replace('having count(*) >= 7', 'having count(*) >= 8')
        .replace('limit 100\n', 'limit 10\n'),
    );
  await expect(author.getByTestId('author-execution-receipt')).toHaveCount(0);
  expect(await queryExecutionMessages()).toBe(0);

  await generateAuthorPreview(author);
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toContainText('Preview · Not executed');
  await expect(preview.locator('pre')).toContainText('HAVING COUNT(*) >= ?');
  await expect(preview.locator('pre')).not.toContainText('>= 8');
  await expect(author.getByTestId('author-execution-receipt')).toHaveCount(0);
  expect(await queryExecutionMessages()).toBe(0);

  await (await openCustomerId(author)).fill('1');
  await author.getByTestId('author-run').click();
  const receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('Executed');
  await expect(receipt).toContainText('0 rows');
  await expect(page.getByRole('grid').getByRole('row')).toHaveCount(1);

  await author.getByTestId('author-compose-tab').click();
  const thresholdControl = author
    .getByTestId('author-compose-having-threshold')
    .locator('input:not(.cloned-input)');
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
  await generateAuthorPreview(author);
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toContainText('Preview · Not executed');
  await expect(preview).toContainText('Required · unset');
  await expect(preview.locator('pre')).toContainText('HAVING COUNT(*) >= ?');
  await expect(preview.locator('pre')).not.toContainText('>= 7');
  await expect(preview.locator('pre')).not.toContainText('= 1');
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);

  await (await openCustomerId(author)).fill('1');
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
    resultGrid.getByRole('columnheader').filter({ has: page.getByRole('button', { name: 'Map meaning of Email', exact: true }) }).getByText('Email', { exact: true }),
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

  await generateAuthorPreview(author);
  await expect(
    author.getByTestId('author-sql-preview').locator('pre'),
  ).toContainText('HAVING COUNT(*) >= ?');
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
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

  await generateAuthorPreview(author);
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toContainText('Preview · Not executed');
  await expect(preview).toContainText('Required · unset');
  await expect(preview.locator('pre')).toContainText('HAVING COUNT(*) >= ?');
  await expect(preview.locator('pre')).not.toContainText('>= 7');
  await expect(preview.locator('pre')).not.toContainText('= 1');
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);

  await (await openCustomerId(author)).fill('1');
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
    resultGrid.getByRole('columnheader').filter({ has: page.getByRole('button', { name: 'Map meaning of Email', exact: true }) }).getByText('Email', { exact: true }),
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
  await author.getByTestId('author-code-tab').click();
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
    resultGrid.getByRole('columnheader').filter({ has: page.getByRole('button', { name: 'Map meaning of CustomerId', exact: true }) }).getByText('CustomerId', { exact: true }),
  ).toBeVisible();
  await expect(
    resultGrid.getByRole('gridcell', { name: 'Current row, position 1 1', exact: true }),
  ).toBeVisible();
  await expect(resultGrid.locator('[col-id="result_0"] .author-inspected-cell > span').last()).toHaveText('1');

  await generateAuthorPreview(author);
  await expect(
    author.getByTestId('author-sql-preview').locator('pre'),
  ).toContainText('HAVING COUNT(*) >= ?');
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
  await author.getByTestId('author-run').click();
  await expect(receipt).toContainText('0 rows');

  await author.getByTestId('author-code-tab').click();
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

  await clickEditorAction(page, author, 'Format TugQL');
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

  await clickEditorAction(page, author, 'Undo');
  await expectEditorSource(page, editor, mixed);
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);

  const malformed = mixed.replace(
    /^(\s*)where\b.*$/imu,
    "$1WHERE i.Name = 'Mixed\nCase'",
  );
  expect(malformed).not.toBe(mixed);
  await pasteCode(page, editor, malformed);
  await expectEditorSource(page, editor, malformed);
  await clickEditorAction(page, author, 'Format TugQL');
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
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);

  await pasteCode(page, editor, mixed);
  await expectEditorSource(page, editor, mixed);

  await clickEditorAction(page, author, 'Format TugQL');
  await expect(editor).not.toContainText(mixed);
  await generateAuthorPreview(author);
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toContainText('Preview · Not executed');
  await expect(preview).toContainText('Required · unset');
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);

  await (await openCustomerId(author)).fill('1');
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

test('mobile editor actions format, undo, and open completion without executing', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const queryExecutionMessages = await installQueryExecutionMessageProbe(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await author.getByTestId('author-code-tab').click();
  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  const original = savedQuerySource('chinook-invoice-author');
  const mixed = original
    .replace(/^(\s*)from\b/imu, '$1FrOm')
    .replace(/^(\s*)where\b/imu, '$1WhErE')
    .replace(/^(\s*)select\b/imu, '$1sElEcT');
  await pasteCode(page, editor, mixed);
  await expectEditorSource(page, editor, mixed);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await pasteCode(page, editor, mixed);
    await expectEditorSource(page, editor, mixed);
    const viewportWidth = await page.evaluate(
      () => document.documentElement.clientWidth,
    );
    const moreButton = author.getByRole('button', {
      name: 'More editor actions',
    });
    await expect(moreButton).toBeVisible();
    const moreBounds = await moreButton.boundingBox();
    expect(moreBounds).not.toBeNull();
    if (!moreBounds) throw new Error('The editor actions button has no bounds.');
    expect(moreBounds.width).toBeGreaterThanOrEqual(44);
    expect(moreBounds.height).toBeGreaterThanOrEqual(44);
    expect(moreBounds.x + moreBounds.width).toBeLessThanOrEqual(viewportWidth + 1);

    const tabs = author.getByTestId('author-view-tabs').locator('ion-segment-button');
    await expect(tabs).toHaveCount(6);
    for (const tab of await tabs.all()) {
      await tab.click();
      await expect(tab).toHaveClass(/segment-button-checked/u);
      const textGeometry = await tab.evaluate((host) => {
        const segment = host.parentElement;
        const range = document.createRange();
        range.selectNodeContents(host.querySelector('ion-label') ?? host);
        const textBounds = range.getBoundingClientRect();
        const hostBounds = host.getBoundingClientRect();
        const segmentBounds = segment?.getBoundingClientRect();
        return {
          label: host.textContent?.trim() ?? '',
          hostLeft: hostBounds.left,
          hostRight: hostBounds.right,
          hostHeight: hostBounds.height,
          segmentLeft: segmentBounds?.left ?? 0,
          segmentRight: segmentBounds?.right ?? 0,
          textLeft: textBounds.left,
          textRight: textBounds.right,
        };
      });
      expect(textGeometry.label).toMatch(/Compose|TugQL Query|Preview SQL|Parameters|Sources|Related/u);
      expect(textGeometry.hostHeight).toBeGreaterThanOrEqual(44);
      expect(textGeometry.hostLeft).toBeGreaterThanOrEqual(textGeometry.segmentLeft - 1);
      expect(textGeometry.hostRight).toBeLessThanOrEqual(textGeometry.segmentRight + 1);
      expect(textGeometry.textLeft).toBeGreaterThanOrEqual(
        textGeometry.hostLeft - 1,
      );
      expect(textGeometry.textRight).toBeLessThanOrEqual(
        textGeometry.hostRight + 1,
      );
    }
    await author.getByTestId('author-code-tab').click();

    await clickEditorAction(page, author, 'Format TugQL');
    await expect(author.getByTestId('author-format-status')).toHaveText(
      'TugQL formatted.',
    );
    expect(await copyEditorSource(page, editor)).not.toBe(mixed);
    await clickEditorAction(page, author, 'Undo');
    await expectEditorSource(page, editor, mixed);

    const completion = page.locator('.cm-tooltip-autocomplete');
    const incompleteDraft = [
      'parameters (',
      '  @CustomerId integer required',
      ')',
      'from Invoice as i',
      'where i.CustomerId = @C',
    ].join('\n');
    await editor.press('Escape');
    await pasteCode(page, editor, incompleteDraft);
    await expectEditorSource(page, editor, incompleteDraft);
    await clickSuggestions(page, author);
    await expect(editor).toBeFocused();
    await expect(completion).toBeVisible();
    await expect(
      completion.locator('.cm-completionLabel', {
        hasText: /^CustomerId$/u,
      }),
    ).toBeVisible();
    await expectEditorSource(page, editor, incompleteDraft);
    await editor.press('Escape');
    await expect(completion).toBeHidden();
    await expectEditorSource(page, editor, incompleteDraft);
    await expect(author.getByTestId('author-execution-receipt')).toHaveCount(0);
    expect(await queryExecutionMessages()).toBe(0);
  }
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

  await generateAuthorPreview(author);
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toContainText('Preview · Not executed');
  expect(await queryExecutionMessages()).toBe(0);
  await author.getByTestId('author-view-tabs')
    .locator('ion-segment-button[value="parameters"]')
    .click();
  const customerId = author
    .getByTestId('author-customer-id')
    .locator('input:not(.cloned-input)');
  await customerId.fill('1');
  await generateAuthorPreview(author);
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
  await author.getByTestId('author-code-tab').click();
  await pasteCode(page, editor, malformed);
  await clickEditorAction(page, author, 'Format TugQL');
  await expectEditorSource(page, editor, malformed);
  await expect(author.getByTestId('author-format-status')).toContainText(
    'TugQL was not changed',
  );
  expect(await queryExecutionMessages()).toBe(1);
  const diagnostic = author
    .locator('ion-item.author-format-diagnostic')
    .filter({ hasText: 'query clauses are out of order' });
  const diagnosticButton = diagnostic.locator('button');
  await expect(diagnostic).toBeVisible();
  await expect(diagnosticButton).toBeEnabled();
  await expect(diagnosticButton).toHaveAttribute(
    'aria-label',
    'Go to line 7, column 5: query clauses are out of order',
  );
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

  if (isMobile) await diagnosticButton.tap();
  else {
    await diagnosticButton.focus();
    await diagnosticButton.press('Enter');
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
  await author.getByTestId('author-code-tab').click();
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
  await expect(author.getByTestId('author-compose-tab')).toBeVisible();
  await expect(author.getByTestId('author-preview-tab')).toBeVisible();
  await expectAuthorMode(author, 'code');
  await author.getByTestId('author-compose-tab').click();
  await expectAuthorMode(author, 'compose');
  await expect(author.locator('sneat-author-compose-controls')).toBeVisible();
  await expect(author.getByTestId('query-body-text')).toHaveCount(1);
  await expect(
    author.getByTestId('query-body-text').locator('.cm-editor'),
  ).toBeHidden();
  await author.getByTestId('author-code-tab').click();
  await expectAuthorMode(author, 'code');
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
  await generateAuthorPreview(author);
  await expect(editor).toContainText(/on i\.CustomerId = c\.CustomerId/u);
  await expect(editor).toContainText(/-- preserve this relationship note/u);
  await expectAuthorMode(author, 'code');
  await expect(editor).toBeVisible();

  const preview = author.getByTestId('author-sql-preview');
  await author.getByTestId('author-preview-tab').click();
  await expectAuthorMode(author, 'preview');
  await expect(preview).toContainText('Preview · Not executed');
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
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);

  await (await openCustomerId(author)).fill('1');
  await author.getByTestId('author-run').click();
  const joinReceipt = page.getByTestId('author-execution-receipt');
  await expect(joinReceipt).toContainText('Executed');
  await expect(joinReceipt).toContainText('7 rows');
  await expect(joinReceipt).toContainText('Worker verified');
  let rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(1)).toContainText('98');
  await expect(rows.nth(7)).toContainText('382');

  const firstRunAction = await page
    .getByRole('button', { name: 'Look up invoices for Customer ID 1' })
    .first()
    .elementHandle();
  expect(firstRunAction).not.toBeNull();
  await (await openCustomerId(author)).fill('2');
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
  await (await openCustomerId(author)).fill('1');
  await joinReceipt.getByText('Execution details', { exact: true }).click();
  await joinReceipt.getByText('Advanced receipt', { exact: true }).click();
  const executionId = joinReceipt.getByTestId('author-receipt-worker-id');
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
    /selection · .* · client-reported/u,
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

  await generateAuthorPreview(lookupAuthor);
  await expectIonicButtonDisabled(
    lookupAuthor.getByTestId('author-run'),
    false,
  );
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
  const customerId = await openCustomerId(author);
  await expect(customerId).toBeVisible();
  await customerId.fill('');
  await generateAuthorPreview(author);
  await expectAuthorMode(author, 'preview');
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
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
  await author.getByTestId('author-code-tab').click();
  await expect(customerId).toBeHidden();
  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  await expect(editor).toContainText(/count\(\*\) >= 7/u);
  const thresholdSql = await preview.locator('pre').textContent();
  expect(thresholdSql).toContain('GROUP BY "i"."CustomerId"');
  expect(thresholdSql).toContain('HAVING COUNT(*) >= ?');
  expect(thresholdSql).not.toContain('>= 7');
  await openCustomerId(author);
  await customerId.fill('1');
  await expect(preview.locator('pre')).toHaveText(thresholdSql ?? '');
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
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
  await expectAuthorMode(author, 'compose');
  await expect(editor).toBeHidden();
  await expect(composeTab).toHaveClass(/segment-button-checked/u);
  await expect(codeTab).not.toHaveClass(/segment-button-checked/u);
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
  await generateAuthorPreview(author);
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
  if (testInfo.project.use.isMobile === true) {
    const compactTitle = invoiceAuthorPage.locator('.query-mobile-title');
    await expect(compactTitle).toBeVisible();
    expect(await compactTitle.ariaSnapshot()).toContain('Query');
  } else {
    const initialHeaderAccessibility = await initialHeader.ariaSnapshot();
    expect(initialHeaderAccessibility).toContain(LONG_HEADER_QUERY_TITLE);
    expect(initialHeaderAccessibility).toContain(LONG_HEADER_PROJECT_TITLE);
  }
  expect(workersStarted).toBe(0);

  const author = invoiceAuthorPage.getByTestId('tugql-author');
  const expectContextCount = async (
    value: 'parameters' | 'sources' | 'related',
    count: number,
    accessibleName: string,
  ): Promise<void> => {
    const tab = author.getByTestId('author-view-tabs')
      .locator(`ion-segment-button[value="${value}"]`);
    await expect(tab.locator('ion-chip')).toHaveCount(1);
    await expect(tab.locator('ion-chip')).toHaveText(String(count));
    await expect(tab.locator('button')).toHaveAccessibleName(`${value[0].toUpperCase()}${value.slice(1)}, ${accessibleName}`);
  };
  await expect(author).toBeVisible({ timeout: 20_000 });
  await expect(author.getByTestId('author-compose-tab')).toBeVisible();
  await expect(author.getByTestId('author-code-tab')).toBeVisible();
  await expect(author.getByTestId('author-preview-tab')).toBeVisible();
  await expectContextCount('parameters', 1, '1 parameter');
  await expect(author.getByTestId('author-parameters-panel')).not.toContainText(
    'Parameter declarations are unavailable until TugQL diagnostics are corrected.',
  );
  await expectContextCount('sources', 1, '1 participating source');
  const runButton = author.getByTestId('author-run');
  await expect(runButton).toBeVisible();
  const runHeaderGeometry = await author.evaluate((element) => {
    const header = element.querySelector('.author-card-title-row');
    const run = element.querySelector('[data-testid="author-run"]');
    const headerBounds = header?.getBoundingClientRect();
    const runBounds = run?.getBoundingClientRect();
    const contentBounds = header?.shadowRoot
      ?.querySelector('.item-inner')
      ?.getBoundingClientRect();
    return {
      headerTop: headerBounds?.top ?? -1,
      headerBottom: headerBounds?.bottom ?? -1,
      contentRight: contentBounds?.right ?? -1,
      runTop: runBounds?.top ?? -1,
      runBottom: runBounds?.bottom ?? -1,
      runRight: runBounds?.right ?? -1,
    };
  });
  expect(runHeaderGeometry.runTop).toBeGreaterThanOrEqual(
    runHeaderGeometry.headerTop,
  );
  expect(runHeaderGeometry.runBottom).toBeLessThanOrEqual(
    runHeaderGeometry.headerBottom,
  );
  expect(runHeaderGeometry.runRight).toBeLessThanOrEqual(
    runHeaderGeometry.contentRight + 1,
  );
  const originalDraft = savedQuerySource('chinook-invoice-author');
  await author.getByTestId('author-preview-tab').click();
  await expectAuthorMode(author, 'preview');
  await expect(author.getByTestId('author-preview-empty')).toBeVisible();
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
  expect(workersStarted).toBe(0);
  await author.getByTestId('author-code-tab').click();
  await expectAuthorMode(author, 'code');
  const coldEditor = author
    .getByTestId('query-body-text')
    .locator('.cm-content');
  await expect(coldEditor).toBeVisible();
  await expect(author.getByTestId('author-code-tab')).toHaveClass(/segment-button-checked/u);
  await expectEditorSource(page, coldEditor, originalDraft);
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
  await expect(page.getByTestId('query-view-author')).toHaveClass(/is-active/u);
  await author.getByTestId('author-compose-tab').click();
  const editorPane = invoiceAuthorPage.locator('#workspace-editor-pane');
  const resultsPane = invoiceAuthorPage.locator('#workspace-results-pane');
  if (isMobile) {
    await invoiceAuthorPage.locator('#workspace-jump-to-results').click();
    await expect(invoiceAuthorPage.getByTestId('author-results-empty')).toBeVisible();
    await expect(resultsPane).toBeVisible();
    await expect(editorPane).toBeVisible();
    await invoiceAuthorPage.locator('#workspace-back-to-editor').click();
    await expect(editorPane).toBeVisible();
    await expect(resultsPane).toBeVisible();
  } else {
    await expect(invoiceAuthorPage.getByTestId('author-results-empty')).toBeVisible();
    await expect(editorPane).toBeVisible();
    await expect(resultsPane).toBeVisible();
  }
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);

  const invoiceDate = author.getByTestId('author-compose-invoice-date');
  await expect.poll(() => ionicCheckboxIsChecked(invoiceDate)).toBe(true);
  await setIonicCheckbox(invoiceDate, false);
  await author.getByTestId('author-code-tab').click();
  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  await expect(editor).toContainText(/select i\.InvoiceId\s*$/u);
  await expect(editor).not.toContainText(/InvoiceDate/u);
  await author.getByTestId('author-compose-tab').click();
  await expect.poll(() => ionicCheckboxIsChecked(invoiceDate)).toBe(false);
  await setIonicCheckbox(invoiceDate, true);

  await author.getByTestId('author-code-tab').click();
  const sourceDiscovery = author.getByTestId('author-source-discovery');
  await author.getByTestId('author-view-tabs')
    .locator('ion-segment-button[value="sources"]')
    .click();
  const sourceInventory = author.getByTestId('author-participating-sources');
  await expect(sourceInventory).toContainText('Invoice');
  await expect(sourceInventory).toContainText('Invoice as i');
  await expect(sourceInventory).toContainText('Required source · cannot remove');
  await sourceInventory.getByTestId('author-participating-source').nth(0).click();
  await expect(sourceInventory.getByTestId('author-participating-source-details'))
    .toContainText('InvoiceId');
  await expect(sourceInventory.getByTestId('author-participating-source-details'))
    .toContainText(/integer/iu);
  await author.getByTestId('author-view-tabs')
    .locator('ion-segment-button[value="related"]')
    .click();
  await expect(sourceDiscovery.getByTestId('author-related-customer')).toBeVisible({ timeout: 20_000 });
  await expectContextCount('related', 1, '1 available related source');
  await expect(sourceDiscovery).toContainText('FirstName');
  await expect(sourceDiscovery).toContainText('Email');
  const customerItem = sourceDiscovery.getByTestId('author-related-customer');
  if (!isMobile && page.viewportSize()?.width === 1280) {
    const customerGeometry = await customerItem.evaluate((item) => {
      const row = item.getBoundingClientRect();
      const label = item.querySelector('ion-label')?.getBoundingClientRect();
      return {
        rowHeight: row.height,
        labelWidth: label?.width ?? 0,
        labelHeight: label?.height ?? 0,
      };
    });
    expect(customerGeometry.labelWidth).toBeGreaterThanOrEqual(100);
    expect(customerGeometry.labelHeight).toBeLessThan(120);
    expect(customerGeometry.rowHeight).toBeLessThan(160);
  }
  await customerItem.locator('ion-label h4').click();
  const customerDetails = sourceDiscovery.getByTestId(
    'author-related-customer-details',
  );
  await expect(customerDetails).toContainText('main.Invoice.CustomerId');
  await expect(customerDetails).toContainText('main.Customer.CustomerId');
  await expect(customerDetails).toContainText('chinook.refs.json');
  await expect(customerDetails).toContainText(/FirstName · string/iu);
  await expect(customerDetails).toContainText(/Email · string/iu);
  await expect(customerDetails).toContainText(
    'many invoices to one customer · declared',
  );
  const originalSource = savedQuerySource('chinook-invoice-author');
  await sourceDiscovery.getByTestId('author-related-join').click();
  await expect(editor).toContainText(/join Customer as c/u);
  await expectContextCount('sources', 2, '2 participating sources');
  await expectAuthorMode(author, 'code');
  await expect(author.getByTestId('workspace-related-tab').locator('ion-chip')).toHaveText('…');
  await author.getByTestId('workspace-related-tab').click();
  await expectContextCount('related', 0, '0 available related sources');
  await expect(sourceDiscovery.getByTestId('author-related-empty')).toBeVisible();
  await expect(editor).not.toContainText(/c\.FirstName/u);
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
  expect(workersStarted).toBe(0);
  await author.getByTestId('author-view-tabs')
    .locator('ion-segment-button[value="sources"]')
    .click();
  const joinedInvoiceSource = sourceInventory
    .getByTestId('author-participating-source')
    .filter({ hasText: 'Invoice as i' });
  if (await joinedInvoiceSource.getAttribute('aria-expanded') !== 'true') {
    await joinedInvoiceSource.click();
  }
  await expect(sourceInventory.getByTestId('author-participating-source-details'))
    .toContainText('InvoiceId');
  await author.getByTestId('author-view-tabs')
    .locator('ion-segment-button[value="related"]')
    .click();
  await author.getByTestId('author-code-tab').click();
  await clickEditorAction(page, author, 'Undo');
  await expectEditorSource(page, editor, originalSource);
  await expectContextCount('sources', 1, '1 participating source');
  await author.getByTestId('workspace-related-tab').click();
  await expectContextCount('related', 1, '1 available related source');
  const relatedPaneGeometry = await author.evaluate((element) => {
    const card = element as HTMLElement;
    const panel = card.querySelector('[data-testid="author-related-panel"]') as HTMLElement | null;
    const discovery = card.querySelector('[data-testid="author-source-discovery"]') as HTMLElement | null;
    const cardBounds = card.getBoundingClientRect();
    const panelBounds = panel?.getBoundingClientRect();
    return {
      panelInsideCard: !!panelBounds && panelBounds.bottom <= cardBounds.bottom + 1,
      noInternalScroll: !!discovery && discovery.scrollHeight <= discovery.clientHeight + 1,
      noPageOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    };
  });
  expect(relatedPaneGeometry).toEqual({
    panelInsideCard: true,
    noInternalScroll: true,
    noPageOverflow: true,
  });
  await sourceDiscovery.getByTestId('author-source-review').click();
  const review = sourceDiscovery.getByTestId('author-source-review-panel');
  await expect(review).toBeVisible();
  const firstNameOutput = review.locator(
    'ion-checkbox[aria-label="Customer.FirstName"]',
  );
  const lastNameOutput = review.locator(
    'ion-checkbox[aria-label="Customer.LastName"]',
  );
  const emailOutput = review.locator(
    'ion-checkbox[aria-label="Customer.Email"]',
  );
  await expect.poll(() => ionicCheckboxIsChecked(firstNameOutput)).toBe(true);
  await expect.poll(() => ionicCheckboxIsChecked(lastNameOutput)).toBe(false);
  await expect.poll(() => ionicCheckboxIsChecked(emailOutput)).toBe(false);
  await expect(review).toContainText('InvoiceDate');
  await expect(review).toContainText('Current LIMIT');
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
  await sourceDiscovery.getByTestId('author-source-apply').click();
  await expect(author.getByTestId('author-format-status'))
    .toContainText('Applied the admitted join with FirstName outputs', { timeout: 20_000 });
  await expectContextCount('sources', 2, '2 participating sources');
  await expectAuthorMode(author, 'code');
  await author.getByTestId('workspace-related-tab').click();
  await expectContextCount('related', 0, '0 available related sources');
  await author.getByTestId('author-code-tab').click();
  await expect(editor).toContainText(/join Customer as c/u);
  await expect(editor).toContainText(/@CustomerId integer required/u);
  await expect(editor).toContainText(/i\.InvoiceDate/u);
  await expect(editor).toContainText(/c\.FirstName/u);
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
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
  await expect(compose.getByTestId('author-compose-grouped')).toHaveCount(0);
  const joinedLimit = compose
    .getByTestId('author-compose-row-limit')
    .locator('input:not(.cloned-input)');
  await expect(joinedLimit).toHaveValue('100');
  const joinedInvoiceDate = compose.getByTestId('author-compose-invoice-date');
  await expect.poll(() => ionicCheckboxIsChecked(joinedInvoiceDate)).toBe(true);
  await joinedLimit.fill('75');
  await joinedLimit.press('Tab');
  await setIonicCheckbox(joinedInvoiceDate, false);
  await author.getByTestId('author-code-tab').click();
  const withoutInvoiceDate = joinedSource.replace(', i.InvoiceDate', '');
  const limitedWithoutDate = withoutInvoiceDate.replace(
    'limit 100',
    'limit 75',
  );
  await expectEditorSource(page, editor, limitedWithoutDate);
  await author.getByTestId('author-compose-tab').click();
  await setIonicCheckbox(joinedInvoiceDate, true);
  await author.getByTestId('author-code-tab').click();
  const limitedWithDate = joinedSource.replace('limit 100', 'limit 75');
  await expectEditorSource(page, editor, limitedWithDate);
  expect(workersStarted).toBe(0);

  await author.getByTestId('author-view-tabs')
    .locator('ion-segment-button[value="parameters"]')
    .click();
  const customerId = author
    .getByTestId('author-customer-id')
    .locator('input:not(.cloned-input)');
  await customerId.fill('');
  await generateAuthorPreview(author);
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
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
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
    await preview.evaluate((element) => {
      (
        window as unknown as { __authorSqlPreview?: Element }
      ).__authorSqlPreview = element;
    });
    await author.getByTestId('author-code-tab').click();
    await expect(preview).toBeHidden();
    await author.getByTestId('author-preview-tab').click();
    await expect(preview).toBeVisible();
    expect(
      await preview.evaluate(
        (element) =>
          (window as unknown as { __authorSqlPreview?: Element })
            .__authorSqlPreview === element,
      ),
    ).toBe(true);
    await expect(wrapSqlButton).toHaveAttribute('aria-pressed', 'true');
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
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);

  await openCustomerId(author);
  await customerId.fill('1.5');
  await expect(preview).toContainText('Invalid · enter a whole number');
  await expect(
    author.getByText('Enter a whole-number Customer ID', { exact: true }),
  ).toBeVisible();
  await expect(customerId).toHaveAttribute('aria-invalid', 'true');
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);

  await customerId.fill('1');
  await expect(preview.locator('pre')).toHaveText(previewSql ?? '');
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
  await author.getByTestId('author-run').click();
  if (isMobile) await invoiceAuthorPage.locator('#workspace-jump-to-results').click();
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
  const workerCountBeforeInspection = workersStarted;
  const currentRow = page.getByTestId('author-current-row');
  await rows.nth(1).click();
  await expect(currentRow).toContainText('Position 1 of 7');
  await expect(currentRow).toContainText('98');
  await expect(currentRow).toContainText('2022-03-11 00:00:00');
  await expect(currentRow).toContainText('Luís');
  await rows.nth(1).getByRole('gridcell').first().click();
  await page.keyboard.press('ArrowDown');
  await expect(currentRow).toContainText('Position 2 of 7');
  if (isMobile) await invoiceAuthorPage.locator('#workspace-back-to-editor').click();
  await author.getByTestId('author-view-tabs')
    .locator('ion-segment-button[value="sources"]')
    .click();
  const participatingSources = author.getByTestId('author-participating-sources');
  const joinedCustomer = participatingSources
    .getByTestId('author-participating-source')
    .filter({ hasText: 'Customer as c' });
  await expect(joinedCustomer).toBeVisible({ timeout: 20_000 });
  await joinedCustomer
    .locator('ion-label h3')
    .click();
  const joinedCustomerDetails = participatingSources.getByTestId(
    'author-participating-source-details',
  );
  await expect(joinedCustomerDetails).toContainText(/FirstName · string/iu);
  await expect(joinedCustomerDetails).toContainText('Database: default · Schema: main');
  await author.getByTestId('author-view-tabs')
    .locator('ion-segment-button[value="related"]')
    .click();
  const relatedSources = author.getByTestId('author-source-discovery');
  await expect(relatedSources.getByTestId('author-related-empty')).toBeVisible();
  await expectContextCount('related', 0, '0 available related sources');
  await expect(author.getByTestId('author-related-parameter-status')).toHaveCount(0);
  expect(workersStarted).toBe(workerCountBeforeInspection);
  if (isMobile) {
    await invoiceAuthorPage.locator('#workspace-jump-to-results').click();
    await expect(currentRow).toContainText('Position 2 of 7');
  }
  if (isMobile) await invoiceAuthorPage.locator('#workspace-back-to-editor').click();
  await author.getByTestId('author-view-tabs')
    .locator('ion-segment-button[value="parameters"]')
    .click();
  await expect(author.getByTestId('author-customer-id')).toBeVisible();
  expect(workersStarted).toBe(workerCountBeforeInspection);
  if (!isMobile) {
    await author.getByTestId('author-code-tab').click();
    await executionDetails.click();
    await expect(
      receipt.locator('ion-accordion[value="execution"]'),
    ).not.toHaveClass(/accordion-expanded/u);
    const originalViewport = page.viewportSize();
    await page.setViewportSize({ width: 1280, height: 720 });
    await activePage(page).evaluate((active) => {
      const scrollElement = active
        .querySelector('ion-content')
        ?.shadowRoot?.querySelector('.inner-scroll') as HTMLElement | null;
      if (scrollElement) scrollElement.scrollTop = 0;
    });
    await expect(author.getByTestId('author-run')).toHaveCount(1);
    await expect(author.getByTestId('author-preview-tab')).toHaveCount(1);
    await expect(author.getByTestId('author-preview')).toHaveCount(1);
    await expect(author.getByTestId('author-preview')).toBeHidden();
    await expect(
      author.getByTestId('author-customer-id').locator('input'),
    ).toHaveCount(1);
    await expect(author.getByTestId('author-compose-tab')).toHaveCount(1);
    await expect(author.getByTestId('author-code-tab')).toHaveCount(1);
    await expect(author.locator('.cm-editor')).toHaveCount(1);
    await expect(invoiceAuthorPage.locator('#author-results-heading')).toHaveCount(1);
    const firstRowBounds = await rows.nth(1).evaluate((row) => {
      const bounds = row.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom };
    });
    expect(firstRowBounds.top).toBeGreaterThanOrEqual(0);
    expect(firstRowBounds.bottom).toBeLessThanOrEqual(698);
    // Flex column widths can overlap the grid border by a fractional pixel.
    await expect(rows.nth(1)).toBeInViewport({ ratio: 0.999 });
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
  expect(errors).toEqual([]);

  if (isMobile) await invoiceAuthorPage.locator('#workspace-back-to-editor').click();
  await author.getByTestId('author-compose-tab').click();
  await expect(joinedLimit).toHaveValue('75');
  await joinedLimit.fill('3');
  await joinedLimit.press('Tab');
  await author.getByTestId('author-code-tab').click();
  const reducedSource = limitedWithDate.replace('limit 75', 'limit 3');
  await expectEditorSource(page, editor, reducedSource);
  if (isMobile) await invoiceAuthorPage.locator('#workspace-jump-to-results').click();
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText('7 rows');
  if (isMobile) await invoiceAuthorPage.locator('#workspace-back-to-editor').click();
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );
  expect(workersStarted).toBe(1);

  await generateAuthorPreview(author);
  const reducedPreview = author.getByTestId('author-sql-preview');
  await expect(reducedPreview).toBeVisible();
  await expect(reducedPreview).toContainText('Preview · Not executed');
  const reducedPreviewSql = await reducedPreview.locator('pre').textContent();
  expect(reducedPreviewSql).toContain('LIMIT 3');
  expect(reducedPreviewSql).toContain('"i"."InvoiceDate"');
  expect(reducedPreviewSql).toContain('"c"."FirstName"');
  expect(workersStarted).toBe(1);
  await author.getByTestId('author-run').click();
  if (isMobile) await invoiceAuthorPage.locator('#workspace-jump-to-results').click();
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
    const resultsView = invoiceAuthorPage.locator('#workspace-jump-to-results');
    await resultsView.click();
    await expect(invoiceAuthorPage.locator('#author-results-heading')).toBeFocused();
    await expect(invoiceAuthorPage.locator('#workspace-results-pane')).toBeVisible();
    await expect(invoiceAuthorPage.locator('#workspace-editor-pane')).toBeVisible();
    await expect(receipt).toBeVisible();
    const retainedReceiptText = await receipt.textContent();
    const retainedRows = await page
      .getByRole('grid')
      .getByRole('row')
      .allTextContents();
    const editorView = invoiceAuthorPage.locator('#workspace-back-to-editor');
    await editorView.click();
    await expect(author.locator('[data-workspace-heading]')).toBeFocused();
    await expect(invoiceAuthorPage.locator('#workspace-results-pane')).toBeVisible();
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
      const mobileTitle = active.querySelector('.query-mobile-title');
      const titleRange = document.createRange();
      if (mobileTitle) titleRange.selectNodeContents(mobileTitle);
      const title = mobileTitle ? titleRange.getBoundingClientRect() : undefined;
      const state = bounds('.query-save-state');
      const end = bounds('ion-toolbar ion-buttons[slot="end"]');
      return {
        startRight: start?.right,
        titleLeft: title?.left,
        titleRight: title?.right,
        stateLeft: state?.left,
        endLeft: end?.left,
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
      };
    });
    expect(header.startRight).toBeLessThanOrEqual(header.titleLeft ?? -1);
    expect(header.titleRight).toBeLessThanOrEqual(header.stateLeft ?? -1);
    expect(header.stateLeft).toBeLessThanOrEqual(header.endLeft ?? -1);
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
    await expect(activePage(page).locator('.query-mobile-title')).toBeVisible();
    const titleAccessibility = await activePage(page).locator('.query-mobile-title').ariaSnapshot();
    expect(titleAccessibility).toContain('Query');
    const header = await activePage(page).evaluate((active) => {
      const bounds = (selector: string): DOMRect | undefined =>
        active.querySelector(selector)?.getBoundingClientRect();
      const start = bounds('ion-toolbar ion-buttons[slot="start"]');
      const mobileTitle = active.querySelector('.query-mobile-title');
      const titleRange = document.createRange();
      if (mobileTitle) titleRange.selectNodeContents(mobileTitle);
      const title = mobileTitle ? titleRange.getBoundingClientRect() : undefined;
      const state = bounds('.query-save-state');
      const end = bounds('ion-toolbar ion-buttons[slot="end"]');
      return {
        startRight: start?.right,
        titleLeft: title?.left,
        titleRight: title?.right,
        stateLeft: state?.left,
        endLeft: end?.left,
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
      };
    });
    expect(header.startRight).toBeLessThanOrEqual(header.titleLeft ?? -1);
    expect(header.titleRight).toBeLessThanOrEqual(header.stateLeft ?? -1);
    expect(header.stateLeft).toBeLessThanOrEqual(header.endLeft ?? -1);
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
  await secondAuthor.getByTestId('author-view-tabs')
    .locator('ion-segment-button[value="related"]')
    .click();
  await expect(secondDiscovery).toContainText('Email', {
    timeout: 20_000,
  });
  await secondDiscovery.getByTestId('author-source-review').click();
  const secondReview = secondDiscovery.getByTestId(
    'author-source-review-panel',
  );
  await setIonicCheckbox(
    secondReview.locator('ion-checkbox[aria-label="Customer.FirstName"]'),
    false,
  );
  await setIonicCheckbox(
    secondReview.locator('ion-checkbox[aria-label="Customer.Email"]'),
    true,
  );
  await secondDiscovery.getByTestId('author-source-apply').click();
  await expect(secondAuthor.getByTestId('author-format-status'))
    .toContainText('Applied the admitted join with Email outputs', { timeout: 20_000 });
  expect(workersStarted).toBe(workersBeforeSecondEmailApply);
  await generateAuthorPreview(secondAuthor);
  const secondPreview = secondAuthor.getByTestId('author-sql-preview');
  await expect(secondPreview).toBeVisible();
  const secondPreviewSql = await secondPreview.locator('pre').textContent();
  expect(secondPreviewSql).toContain('"c"."Email"');
  expect(workersStarted).toBe(workersBeforeSecondEmailApply);
  await secondAuthor.getByTestId('author-view-tabs')
    .locator('ion-segment-button[value="parameters"]')
    .click();
  await secondAuthor
    .getByTestId('author-customer-id')
    .locator('input')
    .fill('1');
  await expectIonicButtonDisabled(
    secondAuthor.getByTestId('author-run'),
    false,
  );
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
  const secondReceipt = page.getByTestId('author-execution-receipt');
  const secondRowsBeforeRemoval = await secondRows.allTextContents();
  const secondEditor = secondAuthor.getByTestId('query-body-text').locator('.cm-content');
  const emailSource = await copyEditorSource(page, secondEditor);
  await secondAuthor.getByTestId('author-code-tab').click();
  await secondAuthor.getByTestId('author-view-tabs')
    .locator('ion-segment-button[value="sources"]')
    .click();
  const sources = secondAuthor.getByTestId('author-participating-sources');
  await expect(sources).toContainText('Customer', { timeout: 20_000 });
  const removeJoin = sources.getByTestId('author-source-remove-join');
  await expect(removeJoin).toBeEnabled();
  const removalConfirmation = page.getByTestId(
    'author-remove-customer-confirmation',
  );
  await removeJoin.click();
  await expect(removalConfirmation).toBeVisible();
  await removalConfirmation.getByRole('button', { name: 'Cancel' }).click();
  await expect(removalConfirmation).toBeHidden();
  await expectEditorSource(page, secondEditor, emailSource);
  await removeJoin.click();
  await expect(removalConfirmation).toBeVisible();
  await removalConfirmation.getByRole('button', { name: 'Remove source' }).click();
  const unjoinedEmailSource = emailSource
    .replace(/join Customer as c\n\s+on i\.CustomerId = c\.CustomerId\n/u, '')
    .replace(', c.Email', '');
  await expectEditorSource(page, secondEditor, unjoinedEmailSource);
  expect(unjoinedEmailSource).not.toContain('join Customer as c');
  expect(unjoinedEmailSource).not.toContain('c.Email');
  expect(unjoinedEmailSource).toContain('@CustomerId integer required');
  await expect(secondReceipt).toContainText('7 rows');
  expect(await secondRows.allTextContents()).toEqual(secondRowsBeforeRemoval);
  expect(workersStarted).toBe(3);
  await clickEditorAction(page, secondAuthor, 'Undo');
  await expectEditorSource(page, secondEditor, emailSource);
  await expect(secondReceipt).toContainText('7 rows');
  expect(workersStarted).toBe(3);
  expect(errors).toEqual([]);
});

test('related count arriving later keeps the focused workspace tab and native keyboard navigation', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  let releaseMetadata!: () => void;
  let metadataRequested!: () => void;
  const metadataGate = new Promise<void>((resolve) => { releaseMetadata = resolve; });
  const requestSeen = new Promise<void>((resolve) => { metadataRequested = resolve; });
  await page.route(
    (url) => url.hostname === 'raw.githubusercontent.com' &&
      url.pathname.endsWith('/dbmodels/chinook/chinook.refs.json'),
    async (route) => {
      metadataRequested();
      await metadataGate;
      await route.fallback();
    },
  );
  let workersStarted = 0;
  page.on('worker', () => workersStarted++);
  await page.goto(AUTHOR_URL);
  const author = activePage(page).getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  const source = author.getByTestId('query-body-text').locator('.cm-content');
  const originalSource = await source.textContent();
  const related = author.getByTestId('workspace-related-tab');
  await related.click();
  await requestSeen;
  const nativeRelated = related.locator('button');
  await nativeRelated.focus();
  await expect(nativeRelated).toBeFocused();
  await expect(nativeRelated).toHaveAccessibleName('Related, Related source count unavailable');
  releaseMetadata();
  await expect(related.locator('ion-chip')).toHaveText('1');
  await expect(nativeRelated).toHaveAccessibleName('Related, 1 available related source');
  await expect(nativeRelated).toBeFocused();
  await expect(related).toHaveClass(/segment-button-checked/u);
  await expect.poll(() => related.evaluate((tab) => {
    const bounds = tab.getBoundingClientRect();
    const viewport = tab.parentElement?.getBoundingClientRect();
    return !!viewport && bounds.left >= viewport.left - 1 && bounds.right <= viewport.right + 1;
  })).toBe(true);
  await nativeRelated.press('ArrowLeft');
  const sources = author.getByTestId('workspace-sources-tab');
  await expect(sources.locator('button')).toBeFocused();
  await sources.locator('button').press('Space');
  await expect(sources).toHaveClass(/segment-button-checked/u);
  await sources.locator('button').press('ArrowRight');
  await expect(nativeRelated).toBeFocused();
  await nativeRelated.press('Space');
  await expect(related).toHaveClass(/segment-button-checked/u);
  expect(await source.textContent()).toBe(originalSource);
  expect(workersStarted).toBe(0);
  await expect(activePage(page).getByTestId('author-results-empty')).toBeVisible();
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
  await openCustomerId(author);
  await customerId.fill('');
  await expect(customerId).toHaveValue('');
  // Finish the input interaction before clicking an action: Ionic's mobile
  // keyboard scroll assist can still move the button after fill() resolves.
  await customerId.blur();
  await expect(customerId).not.toBeFocused();
  await expect(
    author.getByTestId('author-customer-id').locator('.cloned-input'),
  ).toHaveCount(0);

  await generateAuthorPreview(author);
  await expect(author.getByTestId('author-sql-preview')).toContainText(
    'Preview · Not executed',
  );
  expect(workersStarted).toBe(0);
  await openCustomerId(author);
  await customerId.fill('1');
  await generateAuthorPreview(author);
  await author.getByTestId('author-run').click();
  if (isMobile) await page.locator('#workspace-jump-to-results').click();
  const retainedReceipt = page.getByTestId('author-execution-receipt');
  await expect(retainedReceipt).toContainText('Executed');
  await expect(retainedReceipt).toContainText('7 rows');
  await expect.poll(() => workersStarted).toBe(1);
  const immutableReceiptDetails = retainedReceipt.locator(
    '[data-testid="author-receipt-observed"], [data-testid="author-receipt-worker-id"], [data-testid="author-receipt-draft-revision"], [data-testid="author-receipt-bindings"]',
  );
  const retainedReceiptDetails =
    await immutableReceiptDetails.allTextContents();
  expect(retainedReceiptDetails).toHaveLength(4);
  const retainedSql = await retainedReceipt
    .getByTestId('author-receipt-sql').locator('pre')
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
  await author.getByTestId('author-code-tab').click();
  await pasteCode(page, editor, bareMultilineSource);
  await author.getByTestId('author-compose-tab').click();
  await generateAuthorPreview(author);

  const previewError = author.getByRole('alert');
  await expect(previewError).toContainText(
    "multiline SELECT requires '(' on the SELECT header line",
  );
  await expect(editor).toBeHidden();
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
  await expect(nativeAction).toHaveAttribute(
    'aria-describedby',
    'author-preview-error-message',
  );
  for (const theme of ['light', 'dark', 'forced-colors']) {
    await page.locator('ion-app').evaluate((app, dark) => {
      app.classList.toggle('ion-palette-dark', dark);
    }, theme === 'dark');
    await page.emulateMedia({
      forcedColors: theme === 'forced-colors' ? 'active' : 'none',
    });
    await expect(nativeAction).toBeVisible();
    const colors = await completionContrast(nativeAction);
    console.log(
      `[preview-action-contrast] ${JSON.stringify({ theme, ...colors })}`,
    );
    await expect
      .poll(() => completionContrast(nativeAction).then(({ ratio }) => ratio))
      .toBeGreaterThanOrEqual(4.5);
    console.log(
      `[preview-action-settled-contrast] ${JSON.stringify({
        theme,
        ...(await completionContrast(nativeAction)),
      })}`,
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
  await expect(
    author.getByTestId('query-body-text').locator('.cm-editor'),
  ).toBeVisible();
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
    retainedReceipt.getByTestId('author-receipt-sql').locator('pre'),
  ).toHaveText(retainedSql ?? '');
  await expect(page.getByRole('grid').getByRole('row')).toHaveCount(8);
  expect(
    await page.getByRole('grid').getByRole('row').allTextContents(),
  ).toEqual(retainedRows);
  if (isMobile) await page.locator('#workspace-back-to-editor').click();
  await openCustomerId(author);
  await customerId.fill('');
  await author.getByTestId('author-code-tab').click();

  const blockSource = compactSource.replace(
    /select i\.InvoiceId, i\.InvoiceDate\s*$/u,
    'select (\n  i.InvoiceId\n  i.InvoiceDate\n)',
  );
  await pasteCode(page, editor, blockSource);
  await generateAuthorPreview(author);

  const blockPreview = author.getByTestId('author-sql-preview');
  await expect(blockPreview).toBeVisible();
  await expect(blockPreview).toContainText('Required · unset');
  await expect(author.getByTestId('author-error')).toHaveCount(0);
  const blockSql = await blockPreview.locator('pre').textContent();
  expect(blockSql).toContain('"i"."InvoiceId"');
  expect(blockSql).toContain('"i"."InvoiceDate"');
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
  expect(workersStarted).toBe(1);

  await author.getByTestId('author-code-tab').click();
  await expect(editor).toBeVisible();
  await pasteCode(page, editor, compactSource);
  await generateAuthorPreview(author);
  const compactPreview = author.getByTestId('author-sql-preview');
  await expect(compactPreview).toBeVisible();
  await expect(compactPreview).toContainText('Required · unset');
  await expect(compactPreview.locator('pre')).toHaveText(blockSql ?? '');
  await expect(author.getByTestId('author-error')).toHaveCount(0);
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
});

// query-workspace#ac:author-workspace-clarity — preview text and SQL geometry.
test('query workspace clarity keeps the Preview heading and SQL readable at desktop and phone widths', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await author.getByTestId('author-code-tab').click();
  await generateAuthorPreview(author);
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toContainText('Preview · Not executed');
  const sql = preview.locator('pre');
  await expect(sql).toContainText(/select/iu);
  const originalSql = await sql.innerText();
  for (const { width, height } of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
    { width: 320, height: 720 },
  ]) {
    await page.setViewportSize({ width, height });
    await activePage(page).evaluate(active => {
      const scroller = active.querySelector('ion-content')?.shadowRoot?.querySelector('.inner-scroll');
      if (scroller) scroller.scrollTop = 0;
    });
    await expect.poll(
      () => preview.locator('.author-preview-heading').evaluate(heading => heading.getBoundingClientRect().width),
      { message: `Preview heading reaches its expected width at ${width}px` },
    ).toBeGreaterThanOrEqual(width === 1280 ? 300 : 220);
    const geometry = await preview.evaluate(root => {
      const heading = root.querySelector('.author-preview-heading');
      const title = heading?.querySelector('h3');
      const actions = root.querySelector('.author-preview-actions');
      const sqlScroll = root.querySelector('.author-sql-scroll');
      const controls = ['author-preview', 'author-wrap-sql', 'author-copy-sql']
        .map(id => root.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().toJSON());
      if (!heading || !title || !actions || !sqlScroll || controls.some(bounds => !bounds)) return undefined;
      const titleRange = document.createRange();
      titleRange.selectNodeContents(title);
      return {
        preview: root.getBoundingClientRect().toJSON(),
        heading: heading.getBoundingClientRect().toJSON(),
        title: titleRange.getBoundingClientRect().toJSON(),
        titleLines: titleRange.getClientRects().length,
        actions: actions.getBoundingClientRect().toJSON(),
        sql: sqlScroll.getBoundingClientRect().toJSON(),
        controls,
        viewportHeight: innerHeight,
      };
    });
    expect(geometry, `Preview geometry at ${width}px`).toBeDefined();
    expect(geometry?.heading.width).toBeGreaterThanOrEqual(width === 1280 ? 300 : 220);
    expect(geometry?.titleLines).toBe(1);
    expect(geometry?.title.left).toBeGreaterThanOrEqual((geometry?.heading.left ?? 0) - 1);
    expect(geometry?.title.right).toBeLessThanOrEqual((geometry?.heading.right ?? 0) + 1);
    expect(geometry?.actions.top).toBeGreaterThanOrEqual((geometry?.heading.bottom ?? 0) - 1);
    expect(geometry?.sql.top).toBeGreaterThanOrEqual((geometry?.actions.bottom ?? 0) - 1);
    expect(geometry?.sql.top).toBeLessThan((geometry?.viewportHeight ?? 0) - 32);
    expect(geometry?.sql.right).toBeLessThanOrEqual((geometry?.preview.right ?? 0) + 1);
    for (const control of geometry?.controls ?? []) {
      expect(control?.height).toBeGreaterThanOrEqual(44);
      expect(control?.right).toBeLessThanOrEqual((geometry?.preview.right ?? 0) + 1);
    }
    await page.screenshot({ path: testInfo.outputPath(`preview-readable-${width}.png`) });
    await expect(sql).toHaveText(originalSql);
  }
  const wrap = preview.getByTestId('author-wrap-sql');
  const copy = preview.getByRole('button', { name: 'Copy SQL' });
  await wrap.click();
  await expect(wrap).toHaveAttribute('aria-pressed', 'true');
  await expect(sql).toHaveText(originalSql);
  if (testInfo.project.use.browserName === 'webkit') {
    await copy.tap();
  } else {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await copy.focus();
    await copy.press('Enter');
  }
  await expect(preview.getByTestId('author-copy-sql-status')).toContainText('Preview SQL copied');
});

// query-workspace#ac:author-workspace-clarity — cold desktop action visibility.
test('query workspace clarity shows the cold Related Join action inside the desktop sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await author.getByTestId('author-code-tab').click();
  await author.getByTestId('author-view-tabs')
    .locator('ion-segment-button[value="related"]')
    .click();
  const join = author.getByTestId('author-related-join');
  await expect(join).toBeVisible({ timeout: 20_000 });
  await expectIonicButtonDisabled(join, false);
  const geometry = await join.evaluate(element => {
    const sidebar = element.closest('.author-code-sidebar-row');
    if (!sidebar) return undefined;
    const button = element.getBoundingClientRect();
    const viewport = sidebar.getBoundingClientRect();
    return {
      button: button.toJSON(), viewport: viewport.toJSON(),
      scrollTop: sidebar.scrollTop, windowHeight: innerHeight,
    };
  });
  expect(geometry).toBeDefined();
  expect(geometry?.scrollTop).toBe(0);
  expect(geometry?.button.top).toBeGreaterThanOrEqual((geometry?.viewport.top ?? 0) - 1);
  expect(geometry?.button.bottom).toBeLessThanOrEqual((geometry?.viewport.bottom ?? 0) + 1);
  expect(geometry?.button.bottom).toBeLessThanOrEqual(geometry?.windowHeight ?? 0);
});

// query-workspace#ac:inline-context-count-chips — native tabs retain full labels and compact raised counts.
test('query context counts stay inline through two digits and unavailable drafts', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const executionCount = await installQueryExecutionMessageProbe(page);
  await page.goto(AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await author.getByTestId('author-code-tab').click();
  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  const source = savedQuerySource('chinook-invoice-author');
  const twelveParameters = source.replace(
    '  @CustomerId integer required',
    [
      '  @CustomerId integer required',
      ...Array.from(
        { length: 11 },
        (_, index) => `  @Extra${index + 1} integer required`,
      ),
    ].join('\n'),
  );
  expect(twelveParameters).not.toBe(source);
  await pasteCode(page, editor, twelveParameters);
  const tabs = author.getByTestId('author-view-tabs');
  const parameters = tabs.locator('ion-segment-button[value="parameters"]');
  const parameterCount = parameters.locator('ion-chip');
  await expect(parameterCount).toHaveText('12');
  await expect(parameters.locator('button')).toHaveAccessibleName('Parameters, 12 parameters');
  const contextTabGeometry = () =>
    tabs.evaluate((element) => {
      const segment = element.getBoundingClientRect();
      const allButtons = Array.from(element.querySelectorAll('ion-segment-button'));
      const buttons = Array.from(
        element.querySelectorAll('ion-segment-button[value="parameters"], ion-segment-button[value="sources"], ion-segment-button[value="related"]'),
      );
      const tabGeometry = buttons.map((button) => {
        const value = button.getAttribute('value');
        const label = button.querySelector('ion-label');
        const chip = button.querySelector('ion-chip');
        const text =
          label &&
          Array.from(label.childNodes).find(
            (node) =>
              node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
          );
        if (!label || !text || !chip) {
          return { value, fits: false, missingContent: true };
        }
        const range = document.createRange();
        range.selectNodeContents(text);
        const row = label.getBoundingClientRect();
        const words = range.getBoundingClientRect();
        const count = chip.getBoundingClientRect();
        const tab = button.getBoundingClientRect();
        const checks = {
          oneLine: range.getClientRects().length === 1,
          touchTarget: Math.round(tab.height) >= 48,
          horizontalAdjacency:
            count.left - words.right >= 3.5 && count.left - words.right <= 6,
          mutedCount: chip.querySelector('ion-text')?.getAttribute('color') === 'medium',
          raisedWithOverlap:
            (count.top + count.bottom) / 2 < (row.top + row.bottom) / 2 &&
            count.top < words.bottom &&
            count.bottom > words.top,
          insideTab:
            words.left >= tab.left - 1 &&
            words.right <= tab.right + 1 &&
            words.top >= tab.top - 1 &&
            words.bottom <= tab.bottom + 1 &&
            count.left >= tab.left - 1 &&
            count.right <= tab.right + 1 &&
            count.top >= tab.top - 1 &&
            count.bottom <= tab.bottom + 1,
        };
        return {
          value,
          fits: Object.values(checks).every(Boolean),
          checks,
          row: { top: row.top, bottom: row.bottom },
          label: {
            left: words.left,
            right: words.right,
            top: words.top,
            bottom: words.bottom,
          },
          chip: {
            left: count.left,
            right: count.right,
            top: count.top,
            bottom: count.bottom,
          },
          tab: { left: tab.left, right: tab.right, height: tab.height },
        };
      });
      const checks = {
        threeTabs: buttons.length === 3,
        sixMainTabs: allButtons.length === 6,
        oneRow: segment.height <= 56 && allButtons.every((button) =>
          Math.abs(button.getBoundingClientRect().top - allButtons[0].getBoundingClientRect().top) <= 1),
        allTouchTargets: allButtons.every((button) => button.getBoundingClientRect().height >= 44),
        segmentInViewport: segment.right <= innerWidth + 1,
        noPageOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
      };
      return {
        fits:
          Object.values(checks).every(Boolean) &&
          tabGeometry.every((tab) => tab.fits),
        checks,
        viewportWidth: innerWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        segment: {
          left: segment.left,
          right: segment.right,
          height: segment.height,
        },
        tabs: tabGeometry,
      };
    });

  const expectContextTabGeometry = async (message: string) => {
    try {
      await expect
        .poll(contextTabGeometry, { message })
        .toMatchObject({ fits: true });
    } catch (error) {
      const geometry = await contextTabGeometry();
      throw new Error(
        `${message}\nFull context tab geometry: ${JSON.stringify(geometry)}\nOriginal assertion: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const geometry = await contextTabGeometry();
    console.info(
      `Context tabs ${message}: ${JSON.stringify({
        viewportWidth: geometry.viewportWidth,
        segment: geometry.segment,
        tabs: geometry.tabs.map(({ value, label, chip, tab }) => ({
          value,
          label,
          chip,
          tab,
        })),
      })}`,
    );
  };

  for (const { width, height } of [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
    // 720 CSS px covers the layout budget of a 1440 px window at 200% zoom;
    // this is viewport emulation, not a claim that browser chrome zoom changed.
    { width: 720, height: 720 },
    { width: 1100, height: 720 },
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize({ width, height });
    await expectContextTabGeometry(`12 parameters remain inline at ${width}px`);
    for (const value of ['parameters', 'sources', 'related']) {
      const button = tabs.locator(`ion-segment-button[value="${value}"]`);
      await button.click();
      await expect.poll(() => button.evaluate((selected) => {
        const viewport = selected.closest('ion-segment')?.getBoundingClientRect();
        const tab = selected.getBoundingClientRect();
        return !!viewport && tab.left >= viewport.left - 1 && tab.right <= viewport.right + 1;
      })).toBe(true);
    }
    await page.screenshot({
      path: testInfo.outputPath(`context-inline-12-${width}.png`),
    });
    testInfo.annotations.push({
      type: 'screenshot',
      description: `context-inline-12-${width}.png: expected one scrollable Ionic tab row with full context labels, muted raised counts, and 48px targets; observed every context tab selectable and fully visible when selected, with no page overflow.`,
    });
  }

  const related = tabs.locator('ion-segment-button[value="related"]');
  const sources = tabs.locator('ion-segment-button[value="sources"]');
  await related.getByRole('tab').focus();
  await related.getByRole('tab').press('ArrowLeft');
  await expect(sources.getByRole('tab')).toBeFocused();
  await sources.getByRole('tab').press('Enter');
  await expect
    .poll(() =>
      sources.evaluate((element) =>
        element.classList.contains('segment-button-checked'),
      ),
    )
    .toBe(true);
  await related.click();
  await expect
    .poll(() =>
      related.evaluate((element) =>
        element.classList.contains('segment-button-checked'),
      ),
    )
    .toBe(true);

  const noParameters = source
    .replace(
      /parameters \(\r?\n {2}@CustomerId integer required\r?\n\)\r?\n/u,
      '',
    )
    .replace(/where i\.CustomerId = @CustomerId\r?\n/u, '');
  expect(noParameters).not.toBe(source);
  await page.setViewportSize({ width: 320, height: 720 });
  await author.getByTestId('author-code-tab').click();
  await pasteCode(page, editor, noParameters);
  await expect(parameterCount).toHaveText('0');
  await expect(parameters.locator('button')).toHaveAccessibleName('Parameters, 0 parameters');
  await expectContextTabGeometry('Zero parameters remain inline at 320px');
  await page.screenshot({
    path: testInfo.outputPath('context-inline-0-320.png'),
  });
  testInfo.annotations.push({
    type: 'screenshot',
    description:
      'context-inline-0-320.png: expected full context labels and zero count in one scrollable 48px row; observed complete label and chip within each tab, with selection scroll available and no page overflow.',
  });
  await author.getByTestId('author-code-tab').click();
  await pasteCode(page, editor, '');
  await expect(parameterCount).toHaveText('…');
  await expect(parameters.locator('button')).toHaveAccessibleName('Parameters, Parameter count unavailable');
  await expectContextTabGeometry(
    'Unavailable parameter count remains inline at 320px',
  );
  await page.screenshot({
    path: testInfo.outputPath('context-inline-unavailable-320.png'),
  });
  testInfo.annotations.push({
    type: 'screenshot',
    description:
      'context-inline-unavailable-320.png: expected full context labels and unavailable count in one scrollable 48px row; observed complete label and chip within each tab, with selection scroll available and no page overflow.',
  });
  expect(await executionCount()).toBe(0);
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
});

// query-workspace#ac:author-workspace-clarity — real worker, native Ionic controls.
test('query workspace clarity preserves active context, inspected row and explicit execution through reflow', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const executionCount = await installQueryExecutionMessageProbe(page);
  await page.goto(AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await author.getByTestId('author-code-tab').click();
  const tabs = author.getByTestId('author-view-tabs');
  await tabs.locator('ion-segment-button[value="related"]').click();
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
  await author.getByTestId('author-run').click();
  await expect(author.getByTestId('author-run-parameter-warning')).toBeVisible();
  await author.getByTestId('author-run-recovery').click();
  await expect(author.getByTestId('author-customer-id').locator('input:not(.cloned-input)')).toBeFocused();
  await author.getByTestId('author-customer-id').locator('input:not(.cloned-input)').fill('1');
  await tabs.locator('ion-segment-button[value="related"]').click();
  await author.getByTestId('author-related-join').click();
  await expect(tabs.locator('ion-segment-button[value="sources"] ion-chip')).toHaveText('2');
  await expectAuthorMode(author, 'code');
  await tabs.locator('ion-segment-button[value="related"]').click();
  await expect(author.getByTestId('author-related-empty')).toContainText('Customer is already included');
  await author.getByTestId('author-related-metadata-details').getByText('Metadata coverage and cost').click();
  await expect(author.getByTestId('author-related-metadata-details')).toContainText(/Cross-source cost\s*unknown/u);
  await author.getByTestId('author-related-metadata-details').getByText('Metadata coverage and cost').click();
  await expect(author.getByTestId('author-run-readiness')).toContainText('Preview the current draft');
  await author.getByTestId('author-run-recovery').click();
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
  await expect(author.getByTestId('author-format-status')).toHaveCount(0);
  expect(await executionCount()).toBe(0);
  await author.getByTestId('author-run').click();
  const receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('7 rows', { timeout: 20_000 });
  await author.getByTestId('author-code-tab').click();
  const cells = page.getByRole('grid').locator('.ag-row[row-index="0"] [col-id="result_0"]');
  await cells.click();
  await page.keyboard.press('ArrowDown');
  const inlineRow = page.getByTestId('author-current-row');
  await expect(inlineRow).toContainText('Position 2 of 7');
  await expect(page.getByRole('grid').locator('.ag-row[row-index="1"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('grid').locator('.ag-row[row-index="0"]')).toHaveAttribute('aria-selected', 'false');
  await page.locator('#author-results-heading').focus();
  await expect(page.locator('.author-inspected-row-marker')).toHaveAttribute('aria-label', 'Current row, position 2');
  const retainedSource = await copyEditorSource(page, author.locator('.cm-content'));
  const retainedReceipt = await receipt.locator('.author-receipt-summary').innerText();
  await tabs.locator('ion-segment-button[value="related"]').click();
  await receipt.scrollIntoViewIfNeeded();
  await expect(receipt).toBeInViewport();
  await page.setViewportSize({ width: 1100, height: 720 });
  await expect(receipt).toBeInViewport();
  const widths = [320, 1100, 1280, 390, 1440, 1024];
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 1024 ? 560 : 720 });
    await expect.poll(() => tabs.locator('ion-segment-button[value="related"]').evaluate(element => element.classList.contains('segment-button-checked'))).toBe(true);
    await tabs.scrollIntoViewIfNeeded();
    for (const value of ['parameters', 'sources', 'related']) {
      const tab = tabs.locator(`ion-segment-button[value="${value}"]`);
      await tab.click();
      await expect(tab).toHaveClass(/segment-button-checked/u);
      await expect(tab.locator('ion-chip')).toBeVisible();
      const fits = await tab.evaluate((element) => {
        const segmentElement = element.parentElement;
        const label = element.querySelector('ion-label');
        const chip = element.querySelector('ion-chip');
        if (!segmentElement || !label || !chip) return { fits: false };
        const segment = segmentElement.getBoundingClientRect();
        const text = Array.from(label.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
        if (!text) return { fits: false };
        const range = document.createRange();
        range.selectNodeContents(text);
        const textBounds = range.getBoundingClientRect();
        const count = chip.getBoundingClientRect();
        const tab = element.getBoundingClientRect();
        const fits = tab.left >= segment.left - 1 && tab.right <= segment.right + 1 &&
          textBounds.left >= tab.left - 1 && textBounds.right <= tab.right + 1 &&
          textBounds.top >= tab.top - 1 && textBounds.bottom <= tab.bottom + 1 &&
          range.getClientRects().length === 1 &&
          count.left >= tab.left - 1 && count.right <= tab.right + 1 &&
          count.top >= tab.top - 1 && count.bottom <= tab.bottom + 1 &&
          count.left >= textBounds.right && count.top < textBounds.bottom && count.bottom > textBounds.top &&
          tab.height >= 44 && segment.height <= 56 && segment.right <= innerWidth + 1 &&
          document.documentElement.scrollWidth <= innerWidth + 1;
        return { fits, text: textBounds.toJSON(), count: count.toJSON(), tab: tab.toJSON(), segment: segment.toJSON(), lines: range.getClientRects().length, font: getComputedStyle(label).font, padding: getComputedStyle(element.shadowRoot?.querySelector('button') ?? element).padding };
      });
      expect(fits.fits, `${value} label and count are fully visible in the selected tab at ${width}px: ${JSON.stringify(fits)}`).toBe(true);
    }
    await expect(inlineRow).toContainText('Position 2 of 7');
    expect(await copyEditorSource(page, author.locator('.cm-content'))).toBe(retainedSource);
    expect(await receipt.locator('.author-receipt-summary').innerText()).toBe(retainedReceipt);
    expect(await executionCount()).toBe(1);
    await page.screenshot({ path: testInfo.outputPath(`clarity-reflow-${width}.png`) });
    testInfo.annotations.push({ type: 'screenshot', description: `clarity-reflow-${width}.png: expected all three context tabs reachable in the one-row scroller; observed each selected label/count wholly visible, retained draft/receipt/row, and one explicit execution.` });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await activePage(page).evaluate(active => {
    const scroller = active.querySelector('ion-content')?.shadowRoot?.querySelector('.inner-scroll');
    if (scroller) scroller.scrollTop = 0;
  });
  const firstRow = page.getByRole('grid').locator('.ag-row[row-index="0"]');
  const geometry = await firstRow.evaluate(row => {
    const bounds = row.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right, height: innerHeight, width: innerWidth };
  });
  console.log('clarity first row geometry', geometry);
  await page.screenshot({ path: testInfo.outputPath('clarity-desktop.png') });
  testInfo.annotations.push({ type: 'screenshot', description: `clarity-desktop.png: expected the selected Related tab and first result row visible at1280x720; observed first row top${geometry.top}/bottom${geometry.bottom}, with every context tab reachable in the preceding bounds assertions.` });
  await expect(firstRow).toBeInViewport({ ratio: 0.999 });
  await tabs.locator('ion-segment-button[value="tugql"]').click();
  expect(await author.locator('.cm-scroller').evaluate(element => element.clientHeight)).toBeGreaterThan(160);
  await tabs.locator('ion-segment-button[value="related"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#workspace-jump-to-results').click();
  const open = page.getByTestId('author-row-details-open');
  const sheet = page.getByTestId('author-row-details-sheet');
  const presented = sheet.evaluate(element => new Promise<void>(resolve => element.addEventListener('ionModalDidPresent', () => resolve(), { once: true })));
  await open.click();
  await presented;
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('author-current-row')).toContainText('Position 2 of 7');
  await expect(sheet.getByTestId('author-current-row')).toContainText('121');
  await page.getByTestId('author-row-details-close').click({ trial: true });
  const sheetFields = sheet.getByTestId('author-current-row-field');
  await expect(sheetFields.filter({ hasText: 'InvoiceId' }).locator('.author-current-row-value')).toBeInViewport({ ratio: 0.999 });
  await expect(sheetFields.filter({ hasText: 'InvoiceDate' }).locator('.author-current-row-value')).toBeInViewport({ ratio: 0.999 });
  await page.screenshot({ path: testInfo.outputPath('clarity-phone-row-sheet.png') });
  testInfo.annotations.push({ type: 'screenshot', description: 'clarity-phone-row-sheet.png: expected native sheet to show the same raw row as inline Current row; observed native didPresent, position2 of7, InvoiceId121 and rawInvoiceDate both fully inside viewport, with native Close action.' });
  await page.getByTestId('author-row-details-close').click();
  await expect(sheet).toBeHidden();
  await expect(sheet).not.toHaveClass(/show-modal/u);
  await expect(open.locator('button')).toBeFocused();
  await open.click();
  // Wait for the native presentation animation before sending a keyboard cancel.
  await page.getByTestId('author-row-details-close').click({ trial: true });
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(sheet).not.toHaveClass(/show-modal/u);
  await expect(open.locator('button')).toBeFocused();
  await open.click();
  await page.getByTestId('author-row-details-close').click({ trial: true });
  await sheet.locator('ion-backdrop').click({ position: { x: 10, y: 10 } });
  await expect(sheet).toBeHidden();
  await expect(sheet).not.toHaveClass(/show-modal/u);
  await expect(open.locator('button')).toBeFocused();
  expect(await executionCount()).toBe(1);
  // Exact timestamps remain in the collapsed receipt and retained history details.
  await receipt.getByText('Execution details').click();
  await expect(receipt.getByTestId('author-receipt-observed')).toContainText(/Observed\s*\d{4}-/u);
});

test('expanding source metadata grows the author card without scrolling the context pane or changing the draft', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const executionCount = await installQueryExecutionMessageProbe(page);
  for (const viewport of [
    { width: 1280, height: 720, label: '1280' },
    { width: 1280, height: 560, label: '1280-short' },
    { width: 390, height: 844, label: '390' },
  ]) {
    const { width } = viewport;
    await page.setViewportSize({ width, height: viewport.height });
    await page.goto(AUTHOR_URL);
    const author = page.getByTestId('tugql-author');
    await expect(author).toBeVisible({ timeout: 20_000 });
    await author.getByTestId('author-code-tab').click();
    await author.getByTestId('author-view-tabs')
      .locator('ion-segment-button[value="sources"]')
      .click();
    const source = author.getByTestId('author-participating-source').first();
    await expect(source).toContainText('Invoice');
    await expect(source).toHaveAttribute('aria-expanded', 'false');
    const editor = author.locator('.cm-content');
    const originalSource = await copyEditorSource(page, editor);
    const saveState = await page.locator('.query-save-state').innerText();
    const collapsedHeight = await author.evaluate(element => element.getBoundingClientRect().height);
    await expect(author.getByTestId('query-body-text').locator('.cm-editor')).toBeHidden();

    await source.click();
    await expect(source).toHaveAttribute('aria-expanded', 'true');
    const details = author.getByTestId('author-participating-source-details');
    await expect(details).toContainText('InvoiceId');
    const geometry = await author.evaluate(element => {
      const sidebar = element.querySelector('.author-code-sidebar-row');
      const details = element.querySelector('[data-testid="author-participating-source-details"]');
      if (!sidebar || !details) return undefined;
      const card = element.getBoundingClientRect();
      const pane = sidebar.getBoundingClientRect();
      const fields = details.getBoundingClientRect();
      return {
        cardHeight: card.height,
        cardBottom: card.bottom,
        paneHeight: pane.height,
        paneBottom: pane.bottom,
        fieldsBottom: fields.bottom,
        editorHeight: element.querySelector('.cm-editor')?.getBoundingClientRect().height ?? 0,
        paneScrollHeight: sidebar.scrollHeight,
        paneClientHeight: sidebar.clientHeight,
        pageScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
      };
    });
    if (!geometry) throw new Error('Expected expanded source geometry.');
    expect(geometry.cardHeight).toBeGreaterThan(collapsedHeight + 24);
    expect(geometry.editorHeight).toBe(0);
    expect(geometry.fieldsBottom).toBeLessThanOrEqual(geometry.cardBottom + 1);
    expect(geometry.fieldsBottom).toBeLessThanOrEqual(geometry.paneBottom + 1);
    expect(geometry.paneScrollHeight).toBeLessThanOrEqual(geometry.paneClientHeight + 1);
    expect(geometry.pageScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(await copyEditorSource(page, editor)).toBe(originalSource);
    expect(await page.locator('.query-save-state').innerText()).toBe(saveState);
    await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
    expect(await executionCount()).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`expanded-source-${viewport.label}.png`), fullPage: true });
    testInfo.annotations.push({ type: 'screenshot', description: `expanded-source-${viewport.label}.png: expected Invoice metadata inside the naturally taller full-card Sources pane, with the Code editor retained but hidden and no horizontal overflow; observed card height ${geometry.cardHeight}, field bottom ${geometry.fieldsBottom} within card bottom ${geometry.cardBottom}.` });
    await details.locator('ion-item').last().scrollIntoViewIfNeeded();
    await expect(details.locator('ion-item').last()).toBeInViewport({ ratio: 0.98 });
    await page.screenshot({ path: testInfo.outputPath(`expanded-source-fields-${viewport.label}.png`) });
    testInfo.annotations.push({ type: 'screenshot', description: `expanded-source-fields-${viewport.label}.png: expected the final Invoice field to remain readable inside the expanded author card after page scrolling; observed that field fully in the viewport and the context pane has no internal vertical scroll.` });

    await source.click();
    await expect(source).toHaveAttribute('aria-expanded', 'false');
    await expect(details).toHaveCount(0);
    const restoredHeight = await author.evaluate(element => element.getBoundingClientRect().height);
    await expect(author.getByTestId('query-body-text').locator('.cm-editor')).toBeHidden();
    expect(restoredHeight).toBeLessThan(geometry.cardHeight - 24);
    expect(Math.abs(restoredHeight - collapsedHeight)).toBeLessThanOrEqual(2);
    expect(await copyEditorSource(page, editor)).toBe(originalSource);
    expect(await page.locator('.query-save-state').innerText()).toBe(saveState);
    expect(await executionCount()).toBe(0);
    await author.getByTestId('author-code-tab').click();
    await expect(author.getByTestId('query-body-text')).toBeVisible();
    expect(await copyEditorSource(page, editor)).toBe(originalSource);
  }
});

test('Run validates a missing Customer ID only after an explicit attempt, without previewing or executing', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const executionCount = await installQueryExecutionMessageProbe(page);
  const githubWrites: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).hostname === 'api.github.com' &&
        !['GET', 'OPTIONS'].includes(request.method()))
      githubWrites.push(request.method());
  });
  await page.goto(AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  const run = author.getByTestId('author-run');
  const warning = author.getByTestId('author-run-parameter-warning');
  const input = author.getByTestId('author-customer-id').locator('input:not(.cloned-input)');
  const codeSurface = author.locator('.author-code-surface');
  const composeControls = author.locator('sneat-author-compose-controls');
  await expect(codeSurface).toBeVisible();
  await expect(composeControls).toHaveCount(0);
  const source = await copyEditorSource(page, author.getByTestId('query-body-text').locator('.cm-content'));
  await author.getByTestId('author-compose-tab').click();
  await expect(composeControls).toBeVisible();
  await expect(codeSurface).toBeHidden();
  await author.getByTestId('author-code-tab').click();
  await expect(codeSurface).toBeVisible();
  await expect(composeControls).toHaveCount(0);
  await author.getByTestId('author-preview-tab').click();
  await expect(codeSurface).toBeHidden();
  await expect(author.getByTestId('author-preview-empty')).toBeVisible();
  await author.getByTestId('workspace-parameters-tab').click();
  await expect(composeControls).toHaveCount(0);
  await expect(codeSurface).toBeHidden();
  await expect(input).toBeVisible();
  const saveState = await page.locator('.query-save-state').innerText();
  await expect(warning).toHaveCount(0);
  await expectIonicButtonDisabled(run, false);
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);

  await run.click();
  await expect(warning).toContainText('Customer ID is required to Run.');
  await expect(warning).toHaveAttribute('color', 'warning');
  await expect(warning.getByTestId('author-run-readiness')).toHaveAttribute('role', 'alert');
  await expect(warning.getByTestId('author-run-recovery')).toContainText('Set parameter');
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
  expect(await executionCount()).toBe(0);
  expect(githubWrites).toEqual([]);
  expect(await copyEditorSource(page, author.getByTestId('query-body-text').locator('.cm-content'))).toBe(source);
  expect(await page.locator('.query-save-state').innerText()).toBe(saveState);
  await page.screenshot({ path: testInfo.outputPath('run-missing-binding-warning.png') });
  testInfo.annotations.push({ type: 'screenshot', description: 'run-missing-binding-warning.png: expected no cold warning until Run, then native Ionic warning color and Set parameter action; observed warning only after the click, with no SQL preview, execution message, GitHub write or draft change.' });

  await warning.getByTestId('author-run-recovery').click();
  await expect(input).toBeFocused();
  await input.fill('1.5');
  await expect(warning).toHaveCount(0);
  await expectIonicButtonDisabled(run, false);
  await run.click();
  await expect(warning).toContainText('whole number');
  expect(await executionCount()).toBe(0);
  await input.fill('1');
  await expect(warning).toHaveCount(0);
  await input.fill('');
  await expect(warning).toHaveCount(0);
  await expectIonicButtonDisabled(run, false);
  await input.fill('1');
  await expect(warning).toHaveCount(0);
  await expectIonicButtonDisabled(run, true);
  await expect(author.getByTestId('author-run-readiness')).toContainText('Preview the current draft');
  await generateAuthorPreview(author);
  await expectIonicButtonDisabled(run, false);
  expect(await executionCount()).toBe(0);
  await run.click();
  if (testInfo.project.use.isMobile) await page.locator('#workspace-jump-to-results').click();
  await expect(page.getByTestId('author-execution-receipt')).toContainText('7 rows', { timeout: 20_000 });
  expect(await executionCount()).toBe(1);
  expect(githubWrites).toEqual([]);
});

// The admitted CTE projects enough real fields to exercise horizontal virtualization.
test('query workspace clarity keeps inspected row visible through horizontal pan and outside focus', async ({ page }) => {
  const executionCount = await installQueryExecutionMessageProbe(page);
  await page.goto(CTE_AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await author.getByTestId('workspace-parameters-tab').click();
  await author.getByTestId('author-customer-id').locator('input:not(.cloned-input)').fill('1');
  await author.getByTestId('author-customer-id').locator('input:not(.cloned-input)').press('Tab');
  await generateAuthorPreview(author);
  await expect(author.getByTestId('author-sql-preview')).toContainText('Preview · Not executed');
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
  await author.getByTestId('author-run').click();
  await expect(page.getByTestId('author-execution-receipt')).toContainText('1 row', { timeout: 20_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#workspace-jump-to-results').click();
  const grid = page.getByRole('grid');
  await grid.locator('.ag-row[row-index="0"] [col-id="result_0"]').click();
  const current = page.getByTestId('author-current-row');
  await expect(current).toContainText('Position 1 of 1');
  const raw = await current.innerText();
  const horizontal = page.locator('.author-result-grid-viewport .ag-body-horizontal-scroll-viewport');
  await horizontal.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(() => horizontal.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await expect.poll(() => grid.evaluate(element => {
    const marker = element.querySelector('.author-inspected-row-marker');
    if (!marker) return true;
    const bounds = marker.getBoundingClientRect();
    return bounds.right <= element.getBoundingClientRect().left;
  })).toBe(true);
  await page.locator('#author-results-heading').focus();
  const row = grid.locator('.ag-row[row-index="0"]');
  await expect(row).toHaveClass(/author-inspected-row/u);
  const style = await row.evaluate(element => ({ weight: getComputedStyle(element).fontWeight, cue: getComputedStyle(element).boxShadow }));
  expect(Number(style.weight)).toBeGreaterThanOrEqual(600);
  expect(style.cue).not.toBe('none');
  expect(await current.innerText()).toBe(raw);
  expect(await executionCount()).toBe(1);
});

test('query workspace six polish filters a verified InvoiceId through explicit Preview and Run', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const executionCount = await installQueryExecutionMessageProbe(page);
  const mobile = testInfo.project.use.isMobile === true;
  await page.goto(AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await (await openCustomerId(author)).fill('1');
  await author.getByTestId('author-view-tabs').locator('ion-segment-button[value="related"]').click();
  await author.getByTestId('author-related-join').click();
  await expect(author.getByTestId('author-view-tabs').locator('ion-segment-button[value="sources"] ion-chip')).toHaveText('2');
  await generateAuthorPreview(author);
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
  expect(await executionCount()).toBe(0);
  await author.getByTestId('author-run').click();
  if (mobile) await page.locator('#workspace-jump-to-results').click();
  const receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('7 rows', { timeout: 20_000 });
  await page.getByRole('grid').locator('.ag-row[row-index="0"] [col-id="result_0"]').click();
  const current = page.getByTestId('author-current-row').filter({ visible: true });
  await expect(current).toContainText('Position 1 of 7');
  await expect(current.getByTestId('author-current-row-field').first().locator('.author-current-row-value')).toHaveText('98');
  await current.getByRole('button', { name: 'Use InvoiceId as filter' }).click();
  await expect(current).toContainText('InvoiceId 98 added to TugQL Query');
  await expect(receipt).toContainText('Previous run');
  expect(await executionCount()).toBe(1);
  if (mobile) await page.locator('#workspace-back-to-editor').click();
  await expectAuthorMode(author, 'code');
  await expect(author.getByTestId('query-body-text').locator('.cm-content')).toContainText('where i.CustomerId = @CustomerId and i.InvoiceId = 98');
  await expectIonicButtonDisabled(author.getByTestId('author-run'), true);
  await page.screenshot({ path: testInfo.outputPath('invoice-filter-draft.png') });
  testInfo.annotations.push({ type: 'screenshot', description: 'invoice-filter-draft.png: expected explicit local InvoiceId 98 predicate, previous-run receipt, and disabled Run pending Preview; observed those states with one worker execution so far.' });

  await generateAuthorPreview(author);
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
  expect(await executionCount()).toBe(1);
  await author.getByTestId('author-run').click();
  if (mobile) await page.locator('#workspace-jump-to-results').click();
  await expect(receipt).toContainText('1 row', { timeout: 20_000 });
  await expect(page.getByRole('grid').getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('grid').getByRole('row').nth(1)).toContainText('98');
  expect(await executionCount()).toBe(2);
  if (mobile) await page.locator('#workspace-back-to-editor').click();
  await author.getByTestId('author-code-tab').click();
  await clickEditorAction(page, author, 'Undo');
  await expect(author.getByTestId('query-body-text').locator('.cm-content')).not.toContainText('InvoiceId = 98');
  await expect(receipt).toContainText('Previous run');
  expect(await executionCount()).toBe(2);
});

test('query workspace six polish filters untouched plain Invoice results without a JOIN', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const executionCount = await installQueryExecutionMessageProbe(page);
  const mobile = testInfo.project.use.isMobile === true;
  await page.goto(AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await (await openCustomerId(author)).fill('1');
  await generateAuthorPreview(author);
  await expect(author.getByTestId('author-preview-pane')).toBeVisible();
  await expect(author.getByTestId('author-preview-pane').locator('pre'))
    .toContainText('WHERE "i"."CustomerId" = ?');
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
  await author.getByTestId('author-run').click();
  if (mobile) await page.locator('#workspace-jump-to-results').click();
  const receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('7 rows', { timeout: 20_000 });
  await page.getByRole('grid').locator('.ag-row[row-index="0"] [col-id="result_0"]').click();
  const current = page.getByTestId('author-current-row').filter({ visible: true });
  const invoiceId = (await current.getByTestId('author-current-row-field').first().locator('.author-current-row-value').innerText()).trim();
  expect(invoiceId).toMatch(/^[1-9]\d*$/u);
  if (mobile) {
    await page.getByTestId('author-row-details-open').click();
    const sheet = page.getByTestId('author-row-details-sheet');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Use InvoiceId as filter' }).click();
    await expect(sheet).toBeHidden();
    await expect.poll(() => page.locator('#workspace-editor-pane').evaluate((pane) => pane.contains(document.activeElement))).toBe(true);
  } else {
    await current.getByRole('button', { name: 'Use InvoiceId as filter' }).click();
    await expect(current).toContainText(`InvoiceId ${invoiceId} added to TugQL Query`);
  }
  await expect(receipt).toContainText('Previous run');
  expect(await executionCount()).toBe(1);
  if (mobile) await expect(page.locator('#workspace-editor-pane')).toBeInViewport();
  await expect(author.getByTestId('query-body-text').locator('.cm-content'))
    .toContainText(`where i.CustomerId = @CustomerId and i.InvoiceId = ${invoiceId}`);
  await expectIonicButtonDisabled(author.getByTestId('author-run'), true);
  await page.screenshot({ path: testInfo.outputPath('plain-invoice-filter-draft.png') });
  testInfo.annotations.push({ type: 'screenshot', description: `plain-invoice-filter-draft.png: expected untouched plain Invoice run followed by an explicit local InvoiceId ${invoiceId} draft filter, no JOIN, previous-run receipt, and disabled Run; observed those states with one worker execution.` });
  await generateAuthorPreview(author);
  await expectIonicButtonDisabled(author.getByTestId('author-run'), false);
  expect(await executionCount()).toBe(1);
  await author.getByTestId('author-run').click();
  if (mobile) await page.locator('#workspace-jump-to-results').click();
  await expect(receipt).toContainText('1 row', { timeout: 20_000 });
  await expect(page.getByRole('grid').getByRole('row')).toHaveCount(2);
  expect(await executionCount()).toBe(2);
  if (mobile) await page.locator('#workspace-back-to-editor').click();
  await author.getByTestId('author-code-tab').click();
  await clickEditorAction(page, author, 'Undo');
  await expect(author.getByTestId('query-body-text').locator('.cm-content')).not.toContainText(`InvoiceId = ${invoiceId}`);
  expect(await executionCount()).toBe(2);
});

test('Undo clears the Current row filter confirmation when it restores the draft', async ({ page }) => {
  const executionCount = await installQueryExecutionMessageProbe(page);
  await page.goto(AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await (await openCustomerId(author)).fill('1');
  await generateAuthorPreview(author);
  await author.getByTestId('author-run').click();
  await expect(page.getByTestId('author-execution-receipt')).toContainText('7 rows', { timeout: 20_000 });
  await page.getByRole('grid').locator('.ag-row[row-index="0"] [col-id="result_0"]').click();
  const current = page.getByTestId('author-current-row').filter({ visible: true });
  await current.getByRole('button', { name: 'Use InvoiceId as filter' }).click();
  await expect(current).toContainText('added to TugQL Query. Undo available.');
  await expect(page.locator('.query-save-state')).toContainText('Unsaved');
  await author.getByTestId('author-code-tab').click();
  await clickEditorAction(page, author, 'Undo');
  await expect(current).not.toContainText('Undo available.');
  await expect(page.locator('.query-save-state')).toContainText('Saved');
  await expect(author.getByTestId('query-body-text').locator('.cm-content')).not.toContainText('i.InvoiceId =');
  expect(await executionCount()).toBe(1);
});
