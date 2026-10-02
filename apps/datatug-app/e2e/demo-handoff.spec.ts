import { BrowserContext, expect, Page, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * G-0: a hand-off from datatug.io (`/demo?scenario=<id>&q=<question>&lang=<en|ru>`) must show the holding page
 * and keep the visitor's question out of every analytics and error report. Before this the router threw NG04002,
 * Sentry's crash-report dialog opened, the address bar was rewritten to `/` and the question was lost.
 *
 * MUST run against the PRODUCTION build (real Sentry DSN, real analytics): see
 * playwright.demo-handoff.config.ts, `pnpm e2e:demo-handoff`. Nothing here talks to a third party: every
 * request to a host other than the app's own is recorded and answered with an empty reply.
 *
 * Set DEMO_SHOTS_DIR to also write a screenshot of every page state.
 */
const SENTRY_DIALOG = '.sentry-error-embed';
const MARKER = 'ZEBRA-SECRET-QUESTION-7731';

const EN_QUESTION = `Which countries listen to the most jazz per person? ${MARKER} <b>bold</b> <img src=x onerror="window.__pwned=1">`;
const RU_QUESTION = `Какие страны слушают больше всего джаза на душу населения? ${MARKER} 🎷`;
const SCENARIO = 'countries-music-per-capita';

const SENTENCE = {
  en: {
    withQuestion:
      'This is the question you asked. The live demo is not open yet; it opens here soon.',
    without: 'The live demo is not open yet; it opens here soon.',
  },
  ru: {
    withQuestion:
      'Это ваш вопрос. Живое демо ещё не открыто, скоро оно появится здесь.',
    without: 'Живое демо ещё не открыто, скоро оно появится здесь.',
  },
};

interface External {
  url: string;
  method: string;
  body: string;
}

/** Records, and answers with nothing, every request that is not the app's own origin. */
async function stubExternal(
  context: BrowserContext,
  own: (origin: string) => boolean,
): Promise<External[]> {
  const seen: External[] = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (own(url.origin)) return route.continue();
    seen.push({
      url: request.url(),
      method: request.method(),
      body: request.postData() ?? '',
    });
    const type = request.resourceType();
    if (type === 'script')
      return route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: '',
      });
    if (type === 'image') return route.fulfill({ status: 204 });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: '{}',
    });
  });
  return seen;
}

/**
 * Sentry's report dialog is an embed script fetched from the ingest host, and the stand-in above answers every
 * third-party script with an empty one, so `.sentry-error-embed` can never appear here. The request for that
 * script is the proof that the app asked for the dialog, so a "no dialog" assertion is made on both.
 */
const dialogRequested = (external: External[]): boolean =>
  external.some((request) => request.url.includes('/api/embed/error-page'));

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on(
    'console',
    (message) => message.type() === 'error' && errors.push(message.text()),
  );
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => {
    const inner = document
      .querySelector('ion-content')
      ?.shadowRoot?.querySelector('.inner-scroll');
    return {
      page: [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ],
      body: [document.body.scrollWidth, document.body.clientWidth],
      content: inner ? [inner.scrollWidth, inner.clientWidth] : [0, 0],
    };
  });
  for (const [name, [scroll, client]] of Object.entries(widths)) {
    expect(
      scroll,
      `${name} scrolls sideways (${scroll} > ${client})`,
    ).toBeLessThanOrEqual(client);
  }
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['DEMO_SHOTS_DIR'];
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

const HANDOFF_HOST = 'https://handoff.datatug.test';

/**
 * Serves the production build as if it lived on an https host that is not localhost (so the app turns its
 * analytics and error reporting on, as in production), and stands in for Google Analytics with a script that
 * reports what gtag.js reports: the page location and every command.
 */
async function onProductionLikeHost(
  context: BrowserContext,
  baseURL: string,
): Promise<External[]> {
  const external = await stubExternal(
    context,
    (o) => o === HANDOFF_HOST || o === baseURL,
  );
  await context.route(`${HANDOFF_HOST}/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: baseURL + url.pathname + url.search,
    });
    await route.fulfill({ response });
  });
  await context.route(
    'https://www.googletagmanager.com/**',
    async (route) => {
      external.push({ url: route.request().url(), method: 'GET', body: '' });
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: `(function(){var dl=window.dataLayer=window.dataLayer||[];
        function report(args){new Image().src='https://www.google-analytics.com/g/collect?dl='+encodeURIComponent(location.href)+'&cmd='+encodeURIComponent(JSON.stringify(Array.prototype.slice.call(args)));}
        dl.slice().forEach(report);var push=dl.push;dl.push=function(a){report(a);return push.apply(dl,arguments);};})();`,
      });
    },
  );
  return external;
}

const leaks = (external: External[]): string[] =>
  external
    .filter((request) =>
      [request.url, request.body].some(
        (text) =>
          text.includes(MARKER) ||
          text.includes(encodeURIComponent(MARKER)) ||
          text.includes(SCENARIO),
      ),
    )
    .map((request) => request.method + ' ' + request.url.slice(0, 120));

const VIEWPORTS = [
  { name: '390', width: 390, height: 844 },
  { name: '1440', width: 1440, height: 900 },
];

test.describe('the hand-off holding page', () => {
  for (const lang of ['en', 'ru'] as const) {
    for (const withQuestion of [true, false]) {
      for (const viewport of VIEWPORTS) {
        const question = lang === 'en' ? EN_QUESTION : RU_QUESTION;
        const label = `${lang}, ${withQuestion ? 'with' : 'without'} a question, ${viewport.name} px`;

        test(`/demo in ${label}`, async ({ page, context, baseURL }) => {
          const origin = new URL(baseURL ?? '').origin;
          const external = await stubExternal(context, (o) => o === origin);
          await page.setViewportSize({
            width: viewport.width,
            height: viewport.height,
          });
          const errors = consoleErrors(page);
          const idb = await recordIndexedDb(page);

          const query = `?scenario=${SCENARIO}${withQuestion ? `&q=${encodeURIComponent(question)}` : ''}&lang=${lang}`;
          await page.goto(`/demo${query}`);

          // The page, in the visitor's language, with her question as text.
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
            timeout: 20_000,
          });
          await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
          const sentence = withQuestion
            ? SENTENCE[lang].withQuestion
            : SENTENCE[lang].without;
          await expect(page.locator('#demo-holding-message')).toContainText(
            sentence,
          );
          if (withQuestion) {
            await expect(page.locator('blockquote')).toHaveText(question);
            await expect(
              page.locator('blockquote b, blockquote img'),
            ).toHaveCount(0); // text, never markup
          } else {
            await expect(page.locator('blockquote')).toHaveCount(0);
          }
          expect(
            await page.evaluate(
              () => (window as unknown as { __pwned?: number }).__pwned,
            ),
          ).toBeUndefined();

          // The tab title and the document language follow the page's language.
          await expect(page).toHaveTitle(
            lang === 'en' ? 'DataTug live demo' : 'Живое демо DataTug',
          );
          await expect(page.locator('html')).toHaveAttribute('lang', lang);

          // The address bar no longer carries the question, the scenario or the language.
          expect(
            new URL(page.url()).pathname + new URL(page.url()).search,
          ).toBe('/demo');

          // Two links: the demo project as the home page opens it today, and the site.
          await expect(
            page.getByRole('link', {
              name:
                lang === 'en' ? 'Open the demo project' : 'Открыть демо-проект',
            }),
          ).toHaveAttribute(
            'href',
            '/store/github.com/project/datatug-demo-projects@datatug@demo-project-1',
          );
          await expect(
            page.getByRole('link', {
              name: lang === 'en' ? 'Back to the site' : 'Назад на сайт',
            }),
          ).toHaveAttribute('href', 'https://datatug.io/');

          // One main landmark, nothing scrolls sideways, no crash.
          await expect(page.getByRole('main')).toHaveCount(1);
          await noHorizontalScroll(page);
          await page.waitForTimeout(1500); // Sentry injects its dialog asynchronously: look again after a beat
          await expect(page.locator(SENTRY_DIALOG)).toHaveCount(0);
          expect(dialogRequested(external)).toBe(false);
          expect(errors).toEqual([]);
          // No database of the app's own (chat sessions, query results, ...). The Firebase SDK of the app shell
          // opens its own on every route, this one included, exactly as on main.
          expect(
            (await idb()).filter(
              (call) => !/ (firebase|validate-browser-context)/.test(call),
            ),
          ).toEqual([]);

          await shot(
            page,
            `${lang}-${withQuestion ? 'question' : 'bare'}-${viewport.name}`,
          );

          // A reload shows the same page; the question is still there and the URL is still clean.
          await page.reload();
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
            timeout: 20_000,
          });
          await expect(page.locator('#demo-holding-message')).toContainText(
            sentence,
          );
          if (withQuestion)
            await expect(page.locator('blockquote')).toHaveText(question);
          expect(
            new URL(page.url()).pathname + new URL(page.url()).search,
          ).toBe('/demo');
          await noHorizontalScroll(page);
          expect(errors).toEqual([]);
        });
      }
    }
  }

  test('/demo?q=… with sessionStorage and localStorage blocked: the question is shown, the URL is clean, a reload shows the no-question copy', async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? '').origin;
    const external = await stubExternal(context, (o) => o === origin);
    // What a browser set to block site data does: merely touching the property throws a SecurityError.
    await page.addInitScript(() => {
      for (const name of ['sessionStorage', 'localStorage']) {
        Object.defineProperty(window, name, {
          configurable: true,
          get() {
            throw new DOMException(
              'The operation is insecure.',
              'SecurityError',
            );
          },
        });
      }
    });
    await page.goto(`/demo?q=${encodeURIComponent(EN_QUESTION)}&lang=en`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('blockquote')).toHaveText(EN_QUESTION);
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
      '/demo',
    );
    await expect(page.locator(SENTRY_DIALOG)).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('#demo-holding-message')).toContainText(
      SENTENCE.en.without,
    );
    await expect(page.locator('blockquote')).toHaveCount(0);
    await expect(page.locator(SENTRY_DIALOG)).toHaveCount(0);
    expect(dialogRequested(external)).toBe(false);
  });

  test('the query is out of the address bar before the app has even started, and a reload at that moment loses nothing', async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? '').origin;
    await stubExternal(context, (o) => o === origin);
    // The app bundle never arrives: only index.html's first script has run.
    await page.route(/\/main[-.][^/]*\.js$/, (route) => route.abort());
    await page.goto(
      `/demo?scenario=${SCENARIO}&q=${encodeURIComponent(EN_QUESTION)}&lang=en`,
      { waitUntil: 'commit' },
    );
    await page.waitForLoadState('domcontentloaded');
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
      '/demo',
    );
    await expect(page.locator('blockquote')).toHaveCount(0); // the app did not run

    await page.unroute(/\/main[-.][^/]*\.js$/);
    await page.reload();
    await expect(page.locator('blockquote')).toHaveText(EN_QUESTION, {
      timeout: 20_000,
    });
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
      '/demo',
    );
  });

  for (const path of ['/demo;x=1', '/Demo', '/DEMO/', '/demo;x=1/']) {
    test(`${path}?q=… (matrix parameter, letter case, trailing slash) shows the same page and strips the query`, async ({
      page,
      context,
      baseURL,
    }) => {
      const origin = new URL(baseURL ?? '').origin;
      const external = await stubExternal(context, (o) => o === origin);
      const errors = consoleErrors(page);
      await page.goto(
        `${path}?scenario=${SCENARIO}&q=${encodeURIComponent(EN_QUESTION)}&lang=en`,
      );
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator('blockquote')).toHaveText(EN_QUESTION);
      await expect(page.locator('#demo-holding-message')).toContainText(
        SENTENCE.en.withQuestion,
      );
      expect(new URL(page.url()).search).toBe('');
      expect(page.url()).not.toContain(MARKER);
      await page.waitForTimeout(1500);
      await expect(page.locator(SENTRY_DIALOG)).toHaveCount(0);
      expect(dialogRequested(external)).toBe(false);
      expect(errors).toEqual([]);
    });
  }

  test('a visitor who came from the Russian pages of datatug.ai goes back to its Russian home page', async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? '').origin;
    await stubExternal(context, (o) => o === origin);
    await page.goto('/demo?q=Hi&lang=ru', {
      referer: 'https://datatug.ai/ru/some/page?q=secret',
    });
    await expect(
      page.getByRole('link', { name: 'Назад на сайт' }),
    ).toHaveAttribute('href', 'https://datatug.ai/ru/');
  });

  test('blank lines in the question are collapsed and the quote picks its own text direction', async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? '').origin;
    await stubExternal(context, (o) => o === origin);
    await page.goto(`/demo?q=${encodeURIComponent('one\n\n\n\n\ntwo')}`);
    await expect(page.locator('blockquote')).toHaveText('one\n\ntwo', {
      timeout: 20_000,
    });
    await expect(page.locator('blockquote')).toHaveAttribute('dir', 'auto');
  });

  test('leaving through the "Open the demo project" link puts the title and language back, and Back brings the page\'s own again', async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? '').origin;
    await stubExternal(context, (o) => o === origin);
    await page.goto('/demo?q=hi&lang=ru');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page).toHaveTitle('Живое демо DataTug');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');

    await page.getByRole('link', { name: 'Открыть демо-проект' }).click();
    await expect(page).toHaveURL(/\/store\/github\.com\/project\//);
    // The app's own defaults (index.html): the page kept in the Ionic stack must not leave its own behind.
    await expect(page).toHaveTitle('DataTug.app');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.goBack();
    await expect(page).toHaveURL(/\/demo$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveTitle('Живое демо DataTug');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  });

  test('on app.incidentius.com the hand-off addresses go to the root: no failed navigation, no crash dialog, query stripped', async ({
    page,
    context,
    baseURL,
  }) => {
    const HOST = 'https://app.incidentius.com';
    const external = await stubExternal(
      context,
      (o) => o === HOST || o === baseURL,
    );
    await context.route(`${HOST}/**`, async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({
        url: (baseURL ?? '') + url.pathname + url.search,
      });
      await route.fulfill({ response });
    });
    const errors = consoleErrors(page);
    await page.goto(
      `${HOST}/demo?q=${encodeURIComponent(EN_QUESTION)}&lang=en`,
    );
    await expect(page).not.toHaveURL(/\/demo/, { timeout: 20_000 });
    expect(new URL(page.url()).search).toBe('');
    await page.waitForTimeout(1500);
    await expect(page.locator(SENTRY_DIALOG)).toHaveCount(0);
    expect(dialogRequested(external)).toBe(false);
    expect(errors.filter((e) => e.includes('NG04002'))).toEqual([]);
    await expect(page.locator('blockquote')).toHaveCount(0);
  });

  test('a long question is cut at 1000 bytes and says so', async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? '').origin;
    await stubExternal(context, (o) => o === origin);
    await page.goto(`/demo?q=${encodeURIComponent('ж'.repeat(900))}&lang=ru`);
    await expect(page.locator('blockquote')).toHaveText('ж'.repeat(500), {
      timeout: 20_000,
    });
    await expect(page.locator('.note')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalScroll(page);
  });

  test('a question that is one very long word does not scroll sideways at 390 px', async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? '').origin;
    await stubExternal(context, (o) => o === origin);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/demo?q=${'x'.repeat(900)}`);
    await expect(page.locator('blockquote')).toBeVisible({ timeout: 20_000 });
    await noHorizontalScroll(page);
  });

  for (const path of [
    '/project/github.com/datatug/chinook-demo/chat',
    '/project/github.com/Datatug/Chinook-Demo/chat',
    '/project/github.com/datatug/chinook-demo/tree/HEAD/-/chat',
  ]) {
    test(`the demo project chat address (${path}) shows the same page, with the question, and a clean URL`, async ({
      page,
      context,
      baseURL,
    }) => {
      const origin = new URL(baseURL ?? '').origin;
      const external = await stubExternal(context, (o) => o === origin);
      const errors = consoleErrors(page);
      await page.goto(
        `${path}?msg=${encodeURIComponent(EN_QUESTION)}&q=ignored&lang=ru`,
      );
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator('blockquote')).toHaveText(EN_QUESTION); // msg wins over q
      await expect(page.locator('#demo-holding-message')).toContainText(
        SENTENCE.ru.withQuestion,
      );
      expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
        path,
      );
      await page.waitForTimeout(1500);
      await expect(page.locator(SENTRY_DIALOG)).toHaveCount(0);
      expect(dialogRequested(external)).toBe(false);
      // No "Something went wrong" toast and no logged error either (the nav context used to throw on this address).
      await expect(page.locator('ion-toast')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  for (const path of [
    '/project/github.com/someone/else/chat',
    '/project/github.com/store/x/chat', // an owner called `store` is not a store: no error toast
    '/project/github.com/datatug/chinook-demo-evil/chat',
    '/project/github.com/datatug/chinook-demo/tree/0123abcd4567ef89/-/chat',
  ]) {
    test(`any other repository chat address (${path}) never shows the message, claims no demo, and still strips the URL`, async ({
      page,
      context,
      baseURL,
    }) => {
      const origin = new URL(baseURL ?? '').origin;
      const external = await stubExternal(context, (o) => o === origin);
      const errors = consoleErrors(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${path}?msg=${encodeURIComponent(EN_QUESTION)}&lang=en`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'DataTug',
        { timeout: 20_000 },
      );
      await expect(page.locator('#demo-holding-message')).toHaveText(
        'This page is not available yet.',
      );
      const body =
        (await page.locator('body').innerText()) + (await page.content());
      expect(body).not.toContain(MARKER);
      expect(body).not.toContain('Which countries');
      await expect(page.locator('blockquote')).toHaveCount(0);
      await expect(
        page.getByRole('link', { name: 'Open the demo project' }),
      ).toHaveCount(0);
      expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
        path,
      );
      await noHorizontalScroll(page);
      await shot(
        page,
        `neutral-${path.includes('tree') ? 'tree' : path.includes('evil') ? 'evil' : 'other'}-390`,
      );

      // Reload: still nothing, and blocked or not, the message is not kept anywhere it could come back from.
      await page.reload();
      await expect(page.locator('#demo-holding-message')).toHaveText(
        'This page is not available yet.',
      );
      expect(await page.content()).not.toContain(MARKER);
      const kept = await page.evaluate(() =>
        JSON.stringify(Object.entries(sessionStorage)),
      );
      expect(kept).not.toContain(MARKER);
      await page.waitForTimeout(1000);
      await expect(page.locator(SENTRY_DIALOG)).toHaveCount(0);
      expect(dialogRequested(external)).toBe(false);
      await expect(page.locator('ion-toast')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  // G-A1b: the short project route and the holding page share the project chat address. With a question the
  // holding page (the chat cannot run it yet, and it must not be lost); without one, the project's own chat page.
  // The demo flag is off in this production build and is not consulted either way.
  const TRUSTED = '/project/github.com/datatug/chinook-demo/chat';

  test('the demo project chat address with no question is the project chat page, not the holding page, and keeps its URL', async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? '').origin;
    const external = await stubExternal(context, (o) => o === origin);
    await page.goto(TRUSTED);
    await expect(page.locator('ion-title', { hasText: 'Chat' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('#demo-holding-message')).toHaveCount(0);
    await expect(page.locator('blockquote')).toHaveCount(0);
    await expect(page).not.toHaveTitle('DataTug live demo');
    expect(new URL(page.url()).pathname).toBe(TRUSTED);
    await page.waitForTimeout(1500);
    await expect(page.locator(SENTRY_DIALOG)).toHaveCount(0);
    expect(dialogRequested(external)).toBe(false);
  });

  for (const query of ['?lang=ru', '?msg=', '?msg=%20%20&utm_source=x']) {
    test(`the demo project chat address with ${query} (no question) is the project chat page, and its query is stripped`, async ({
      page,
      context,
      baseURL,
    }) => {
      const origin = new URL(baseURL ?? '').origin;
      await stubExternal(context, (o) => o === origin);
      await page.goto(TRUSTED + query);
      await expect(page.locator('ion-title', { hasText: 'Chat' })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator('#demo-holding-message')).toHaveCount(0);
      expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
        TRUSTED,
      );
    });
  }

  // Review minor 11: what only a project page has. The problem page ("No DataTug project here", "This address is not
  // supported") also has a header, so a header proves nothing. The stand-in for GitHub answers with `{}`, which is a
  // project file the pages read; the page that opens is the project's own, with the title of its page.
  test('a project page other than the chat opens the project, question or not', async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? '').origin;
    await stubExternal(context, (o) => o === origin);
    for (const [url, title] of [
      ['/project/github.com/datatug/chinook-demo/queries?msg=Hello', 'Queries'],
      ['/project/github.com/datatug/chinook-demo/tree/HEAD/dir/-/chat', 'Chat'],
      ['/project/github.com/datatug/chinook-demo', ''],
    ]) {
      await page.goto(url);
      if (title) {
        await expect(
          page.locator('ion-title', { hasText: title }),
          url,
        ).toBeVisible({ timeout: 20_000 });
      } else {
        await expect(page.locator('ion-header').first()).toBeVisible({
          timeout: 20_000,
        });
      }
      await page.waitForTimeout(500);
      await expect(page.locator('#demo-holding-message'), url).toHaveCount(0);
      await expect(
        page.getByRole('heading', {
          name: /No DataTug project here|This address is not supported/,
        }),
        url,
      ).toHaveCount(0);
    }
  });

  // Review B1: the fixed segments of a hand-off address match in any letter case, as they do on main. With a
  // question: the holding page, as on main. Without: the project's chat at its canonical lower-case address, through
  // one redirect, never the crash page (NG04002).
  for (const typed of [
    '/Project/GitHub.com/datatug/chinook-demo/chat',
    '/PROJECT/github.com/datatug/chinook-demo/chat?lang=ru',
    '/project/github.com/datatug/chinook-demo/Chat',
    '/project/github.com/datatug/chinook-demo/Tree/HEAD/-/chat',
  ]) {
    const [path, ownQuery] = typed.split('?');
    const join = (more: string): string =>
      path + '?' + [ownQuery, more].filter(Boolean).join('&');

    test(`${typed} without a question is the project chat at ${TRUSTED}, and never the crash page`, async ({
      page,
      context,
      baseURL,
    }) => {
      const origin = new URL(baseURL ?? '').origin;
      const external = await stubExternal(context, (o) => o === origin);
      const errors = consoleErrors(page);
      await page.goto(typed);
      await expect(page.locator('ion-title', { hasText: 'Chat' })).toBeVisible({
        timeout: 20_000,
      });
      expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
        TRUSTED,
      );
      await expect(page.locator('#demo-holding-message')).toHaveCount(0);
      await page.waitForTimeout(1500);
      await expect(page.locator(SENTRY_DIALOG)).toHaveCount(0);
      expect(dialogRequested(external)).toBe(false);
      expect(errors.filter((e) => e.includes('NG04002'))).toEqual([]);
    });

    test(`${typed} with a question shows the holding page with the question, as on main`, async ({
      page,
      context,
      baseURL,
    }) => {
      const origin = new URL(baseURL ?? '').origin;
      const external = await stubExternal(context, (o) => o === origin);
      const errors = consoleErrors(page);
      await page.goto(join(`msg=${encodeURIComponent(EN_QUESTION)}`));
      await expect(page.locator('blockquote')).toHaveText(EN_QUESTION, {
        timeout: 20_000,
      });
      expect(new URL(page.url()).search).toBe('');
      await page.waitForTimeout(1500);
      await expect(page.locator(SENTRY_DIALOG)).toHaveCount(0);
      expect(dialogRequested(external)).toBe(false);
      expect(errors).toEqual([]);
    });
  }

  test('a reload of a chat address that arrived with a question shows the holding page again, for the demo project and for any other repository', async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? '').origin;
    await stubExternal(context, (o) => o === origin);
    await page.goto(`${TRUSTED}?msg=${encodeURIComponent(EN_QUESTION)}`);
    await expect(page.locator('blockquote')).toHaveText(EN_QUESTION, {
      timeout: 20_000,
    });
    await page.reload();
    await expect(page.locator('blockquote')).toHaveText(EN_QUESTION, {
      timeout: 20_000,
    });

    const other = '/project/github.com/someone/else/chat';
    await page.goto(`${other}?msg=${encodeURIComponent(EN_QUESTION)}`);
    await expect(page.locator('#demo-holding-message')).toHaveText(
      'This page is not available yet.',
      { timeout: 20_000 },
    );
    await page.reload();
    await expect(page.locator('#demo-holding-message')).toHaveText(
      'This page is not available yet.',
      { timeout: 20_000 },
    );
    expect(await page.content()).not.toContain(MARKER);
  });

  test('a fresh visit to the bare chat address after a question, in the same tab, is the project chat page', async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? '').origin;
    await stubExternal(context, (o) => o === origin);
    await page.goto(`${TRUSTED}?msg=${encodeURIComponent(EN_QUESTION)}`);
    await expect(page.locator('blockquote')).toBeVisible({ timeout: 20_000 });
    await page.goto(TRUSTED);
    await expect(page.locator('ion-title', { hasText: 'Chat' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('#demo-holding-message')).toHaveCount(0);
  });

  // Review S1: a bare visit forgets the question kept for the tab, so a reload shows the project chat.
  for (const [what, path] of [
    ['the demo project', TRUSTED],
    ['another repository', '/project/github.com/someone/else/chat'],
  ]) {
    test(`a question, then the bare chat address of ${what}, then a reload: still the project chat`, async ({
      page,
      context,
      baseURL,
    }) => {
      const origin = new URL(baseURL ?? '').origin;
      await stubExternal(context, (o) => o === origin);
      await page.goto(`${path}?msg=${encodeURIComponent(EN_QUESTION)}`);
      await expect(page.locator('#demo-holding-message')).toBeVisible({
        timeout: 20_000,
      });
      await page.goto(path);
      await expect(page.locator('ion-title', { hasText: 'Chat' })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator('#demo-holding-message')).toHaveCount(0);
      expect(
        await page.evaluate(() => sessionStorage.getItem('datatug.demo.handoff.v1')),
      ).toBeNull();
      expect(
        await page.evaluate(
          () => (window as unknown as Record<string, unknown>)['__datatugHandoffSearch'],
        ),
      ).toBeUndefined();

      await page.reload();
      await expect(page.locator('ion-title', { hasText: 'Chat' })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator('#demo-holding-message')).toHaveCount(0);
      expect(await page.content()).not.toContain(MARKER);
    });

    test(`the same in a second tab opened from the first (it starts with a copy of the first tab's storage): ${what}`, async ({
      page,
      context,
      baseURL,
    }) => {
      const origin = new URL(baseURL ?? '').origin;
      await stubExternal(context, (o) => o === origin);
      await page.goto(`${path}?msg=${encodeURIComponent(EN_QUESTION)}`);
      await expect(page.locator('#demo-holding-message')).toBeVisible({
        timeout: 20_000,
      });
      const [second] = await Promise.all([
        context.waitForEvent('page'),
        page.evaluate((url) => window.open(url, '_blank'), origin + path),
      ]);
      await expect(second.locator('ion-title', { hasText: 'Chat' })).toBeVisible({
        timeout: 20_000,
      });
      await second.reload();
      await expect(second.locator('ion-title', { hasText: 'Chat' })).toBeVisible({
        timeout: 20_000,
      });
      await expect(second.locator('#demo-holding-message')).toHaveCount(0);
      // and the first tab, reloaded, still has its own question
      await page.reload();
      await expect(page.locator('#demo-holding-message')).toBeVisible({
        timeout: 20_000,
      });
    });
  }

  test('a non-canonical spelling of a project address is replaced by the canonical one, query kept', async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? '').origin;
    await stubExternal(context, (o) => o === origin);
    await page.goto('/project/github.com/Datatug/Chinook-Demo/tree/HEAD/-/queries?x=1');
    await expect(page).toHaveURL(
      /\/project\/github\.com\/datatug\/chinook-demo\/queries\?x=1(&|$)/,
      { timeout: 20_000 },
    );
  });

  test('the old form of a project address opens as before: no redirect', async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? '').origin;
    await stubExternal(context, (o) => o === origin);
    await page.goto('/store/github.com/project/chinook-demo@datatug@/queries');
    await expect(page.locator('ion-header').first()).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toBe(
      '/store/github.com/project/chinook-demo@datatug@/queries',
    );
  });
});

test.describe('the question reaches no analytics or error report', () => {
  const HOST = 'https://handoff.datatug.test';

  test('control: the same stand-in for Google Analytics does see a query that is NOT stripped (so it is not blind)', async ({
    page,
    context,
    baseURL,
  }) => {
    const external = await onProductionLikeHost(context, baseURL ?? '');
    await page.goto(`${HOST}/no-such-route-xyz?q=${MARKER}`);
    await page.waitForTimeout(2000);
    expect(leaks(external).length).toBeGreaterThan(0);
  });

  test('/demo: Google Analytics, Sentry (an error is thrown on purpose) and PostHog never receive it', async ({
    page,
    context,
    baseURL,
  }) => {
    const external = await onProductionLikeHost(context, baseURL ?? '');
    await page.goto(
      `${HOST}/demo?scenario=${SCENARIO}&q=${encodeURIComponent(EN_QUESTION)}&lang=en`,
    );
    await expect(page.locator('blockquote')).toHaveText(EN_QUESTION, {
      timeout: 20_000,
    });
    expect(page.url()).toBe(`${HOST}/demo`);

    // Make Sentry send something, with its breadcrumbs and request URL.
    await page.evaluate(() =>
      setTimeout(() => {
        throw new Error('G-0 probe: an uncaught error on the holding page');
      }),
    );
    await page.waitForTimeout(3000);

    const hosts = new Set(
      external.map((request) => new URL(request.url).hostname),
    );
    // Not vacuous: Google Analytics saw page commands and a location, Sentry received the probe.
    expect([...hosts].some((h) => h.includes('google-analytics.com'))).toBe(
      true,
    );
    expect([...hosts].some((h) => h.includes('sentry.io'))).toBe(true);
    expect(
      external.some((request) =>
        request.url.includes('dl=' + encodeURIComponent(`${HOST}/demo`) + '&'),
      ),
    ).toBe(true);
    expect(leaks(external)).toEqual([]);
  });
});

test.describe('a question on a project address that is not a hand-off address is dropped, and reaches no analytics (review S2)', () => {
  const HOST = 'https://handoff.datatug.test';

  for (const path of [
    '/project/github.com/datatug/chinook-demo/tree/HEAD/dir/-/chat',
    '/project/github.com/datatug/chinook-demo/queries',
    '/project/github.com/datatug/chinook-demo',
    '/Project/GitHub.com/datatug/chinook-demo/tree/HEAD/dir/-/Chat',
  ]) {
    test(`${path}?msg=…&x=1: the address bar loses msg and keeps x=1, and nothing outgoing carries it`, async ({
      page,
      context,
      baseURL,
    }) => {
      const external = await stubExternal(
        context,
        (o) => o === HOST || o === baseURL,
      );
      await context.route(`${HOST}/**`, async (route) => {
        const url = new URL(route.request().url());
        const response = await route.fetch({
          url: (baseURL ?? '') + url.pathname + url.search,
        });
        await route.fulfill({ response });
      });
      await context.route(
        'https://www.googletagmanager.com/**',
        async (route) => {
          external.push({
            url: route.request().url(),
            method: 'GET',
            body: '',
          });
          await route.fulfill({
            status: 200,
            contentType: 'text/javascript',
            body: `(function(){var dl=window.dataLayer=window.dataLayer||[];
          function report(args){new Image().src='https://www.google-analytics.com/g/collect?dl='+encodeURIComponent(location.href)+'&cmd='+encodeURIComponent(JSON.stringify(Array.prototype.slice.call(args)));}
          dl.slice().forEach(report);var push=dl.push;dl.push=function(a){report(a);return push.apply(dl,arguments);};})();`,
          });
        },
      );
      await page.goto(
        `${HOST}${path}?msg=${encodeURIComponent(MARKER)}&q=${encodeURIComponent(MARKER)}&x=1#frag`,
      );
      await expect(page.locator('ion-header').first()).toBeVisible({
        timeout: 20_000,
      });
      await page.evaluate(() =>
        setTimeout(() => {
          throw new Error('S2 probe: an uncaught error on a project page');
        }),
      );
      await page.waitForTimeout(3000);

      const url = new URL(page.url());
      expect(url.searchParams.has('msg')).toBe(false);
      expect(url.searchParams.has('q')).toBe(false);
      expect(url.searchParams.get('x')).toBe('1');
      // The queries page rewrites its own address (adds its default query, drops the fragment), on the old form
      // of the address too; every other page leaves the fragment where the script left it.
      if (!path.endsWith('/queries')) expect(url.hash).toBe('#frag');
      expect(page.url()).not.toContain(MARKER);
      // Not vacuous: the stand-in for Google Analytics saw page commands, Sentry received the probe.
      const hosts = new Set(
        external.map((request) => new URL(request.url).hostname),
      );
      expect([...hosts].some((h) => h.includes('google-analytics.com'))).toBe(
        true,
      );
      expect([...hosts].some((h) => h.includes('sentry.io'))).toBe(true);
      const leaked = external.filter((request) =>
        [request.url, request.body].some(
          (text) =>
            text.includes(MARKER) || text.includes(encodeURIComponent(MARKER)),
        ),
      );
      expect(leaked.map((r) => r.url.slice(0, 120))).toEqual([]);
      // nothing keeps it in the tab either
      expect(
        await page.evaluate(
          () =>
            JSON.stringify(Object.entries(sessionStorage)) +
            JSON.stringify(Object.entries(localStorage)),
        ),
      ).not.toContain(MARKER);
    });
  }
});

test.describe('an address that the router reads another way than the inline script leaves no question behind (review r2, B1)', () => {
  const HOST = HANDOFF_HOST;
  const hasMarker = (text: string): boolean => {
    let decoded = text;
    for (let i = 0; i < 3; i++) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        break;
      }
    }
    return text.includes(MARKER) || decoded.includes(MARKER);
  };

  /** Everything the page did with the address after it was loaded, and where the question could have gone. */
  async function openAndWatch(
    page: Page,
    context: BrowserContext,
    baseURL: string,
    path: string,
    ready: () => Promise<void>,
  ) {
    const external = await onProductionLikeHost(context, baseURL);
    await page.addInitScript(() => {
      const log: string[] = ((window as unknown as { __urls: string[] }).__urls =
        []);
      for (const name of ['pushState', 'replaceState'] as const) {
        const original = history[name].bind(history);
        history[name] = (state: unknown, title: string, url?: string | URL | null) => {
          log.push(`${name} ${String(url)}`);
          original(state, title, url);
          log.push(`${name} -> ${location.href}`);
        };
      }
      addEventListener('popstate', () => log.push(`popstate ${location.href}`));
    });
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.isNavigationRequest()) requests.push(request.url());
    });
    await page.goto(`${HOST}${path}`);
    await ready();
    // Make Sentry report something, so that its breadcrumbs and request URL are on the wire too.
    await page.evaluate(() =>
      setTimeout(() => {
        throw new Error('R2 probe: an uncaught error');
      }),
    );
    await page.waitForTimeout(2500);
    return { external, requests };
  }

  /**
   * The question is nowhere: not in the address, the history, the title, the storage, a request. The one place a
   * hand-off address that may echo its question keeps it, as on main, is this tab's sessionStorage, so that a
   * reload shows the holding page again (`keptForReload`).
   */
  async function expectNoQuestion(
    page: Page,
    watched: { external: External[]; requests: string[] },
    keptForReload = false,
  ) {
    expect(hasMarker(page.url()), `address bar ${page.url()}`).toBe(false);
    const state = await page.evaluate(() => ({
      title: document.title,
      session: JSON.stringify(Object.entries(sessionStorage)),
      local: JSON.stringify(Object.entries(localStorage)),
      recorded: (window as unknown as { __urls: string[] }).__urls,
      // every entry of the session history (the Navigation API, in Chromium)
      entries: (
        window as unknown as {
          navigation: { entries: () => { url: string }[] };
        }
      ).navigation
        .entries()
        .map((entry) => entry.url),
    }));
    expect(state.title.includes(MARKER)).toBe(false);
    expect(hasMarker(state.session), 'sessionStorage').toBe(keptForReload);
    expect(hasMarker(state.local), 'localStorage').toBe(false);
    expect(state.recorded.filter(hasMarker), 'history calls').toEqual([]);
    expect(state.entries.filter(hasMarker), 'history entries').toEqual([]);
    expect(watched.requests.filter(hasMarker), 'own requests').toEqual([]);
    expect(leaks(watched.external), 'third-party requests').toEqual([]);
    // Not vacuous: Google Analytics reported the page, and Sentry received the probe.
    const hosts = new Set(
      watched.external.map((request) => new URL(request.url).hostname),
    );
    expect([...hosts].some((h) => h.includes('google-analytics.com'))).toBe(true);
    expect([...hosts].some((h) => h.includes('sentry.io'))).toBe(true);
  }

  const query = `?msg=${encodeURIComponent(MARKER)}&lang=ru`;

  // Hand-off addresses spelled so that the script did not recognise them: the holding page, as on main.
  for (const [path, trusted] of [
    ['//project/github.com/datatug/chinook-demo/chat', true],
    ['//project/github.com/acme/demo/chat', false],
    ['/(project/github.com/datatug/chinook-demo/chat)', true],
    ['/(project/github.com/acme/demo/chat)', false],
    ['///project/github.com/datatug/chinook-demo/chat', true],
    ['//project/github.com/datatug/chinook-demo/tree/HEAD/-/chat', true],
    ['/(project/github.com/acme/demo/tree/HEAD/-/chat)', false],
    ['/project/github.com/datatug/chinook-demo/Tree/HEAD/-/chat', true],
    ['/project/github.com/acme/demo/Tree/HEAD/-/chat', false],
  ] as const) {
    test(`${path}${'?msg=…'}: the holding page, ${trusted ? 'with the question' : 'with neutral wording'}, and the question nowhere else`, async ({
      page,
      context,
      baseURL,
    }) => {
      const watched = await openAndWatch(
        page,
        context,
        baseURL ?? '',
        path + query,
        async () => {
          await expect(page.locator('#demo-holding-message')).toBeVisible({
            timeout: 20_000,
          });
        },
      );
      if (trusted) {
        await expect(page.locator('blockquote')).toHaveText(MARKER);
      } else {
        await expect(page.locator('blockquote')).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText(MARKER);
      }
      expect(new URL(page.url()).searchParams.get('lang')).toBeNull();
      await expectNoQuestion(page, watched, trusted);
    });
  }

  // Every other address under /project/github.com: the project, or the page that says what is wrong with the
  // address, with the question dropped.
  for (const path of [
    '//project/github.com/acme/demo/queries',
    '///project/github.com/acme/demo/queries',
    '/(project/github.com/acme/demo/queries)',
    '/project/github.com/acme/demo/queries',
    '//project/github.com/acme/demo',
    '/project;a=1/github.com/acme/demo/queries',
    // (no file extension: the dev server of CI answers 404 to an address that looks like a file, with no SPA fallback)
    '/project/github.com/acme/demo/blob/main/dir/notes',
  ]) {
    test(`${path}${'?msg=…&x=1'}: the address loses the question and keeps x=1, and the question is nowhere`, async ({
      page,
      context,
      baseURL,
    }) => {
      const watched = await openAndWatch(
        page,
        context,
        baseURL ?? '',
        `${path}?msg=${encodeURIComponent(MARKER)}&x=1`,
        async () => {
          await expect(page.locator('ion-header').first()).toBeVisible({
            timeout: 20_000,
          });
        },
      );
      await expect
        .poll(() => new URL(page.url()).pathname)
        .toMatch(
          /^\/project\/github\.com\/acme\/demo(\/queries|\/blob\/main\/dir\/notes)?$/,
        );
      await expectNoQuestion(page, watched);
    });
  }

  // The question as a matrix parameter of the path (`…;msg=Q`) is not a query: index.html's script does not look
  // for it (it would have to rewrite the path), so an analytics tag that reads the address before the router has
  // started could see it. The router then drops it with the canonical redirect: the address and the history keep
  // nothing of it.
  for (const typed of [
    '/project/github.com/acme/demo;msg=' + MARKER + '/queries',
    '/project/github.com/acme/demo/queries;msg=' + MARKER,
    '/project;q=' + MARKER + '/github.com/acme/demo/queries',
  ]) {
    test(`${typed}: the router's canonical redirect leaves it neither in the address nor in the history`, async ({
      page,
      context,
      baseURL,
    }) => {
      await onProductionLikeHost(context, baseURL ?? '');
      await page.goto(`${HOST}${typed}?x=1`);
      await expect(page.locator('ion-header').first()).toBeVisible({
        timeout: 20_000,
      });
      await expect
        .poll(() => new URL(page.url()).pathname, { timeout: 20_000 })
        .toBe('/project/github.com/acme/demo/queries');
      await page.waitForTimeout(1500);
      expect(new URL(page.url()).searchParams.get('x')).toBe('1');
      const state = await page.evaluate(() => ({
        title: document.title,
        storage:
          JSON.stringify(Object.entries(sessionStorage)) +
          JSON.stringify(Object.entries(localStorage)),
        entries: (
          window as unknown as { navigation: { entries: () => { url: string }[] } }
        ).navigation
          .entries()
          .map((entry) => entry.url),
      }));
      expect(hasMarker(page.url())).toBe(false);
      expect(state.entries.filter(hasMarker)).toEqual([]);
      expect(hasMarker(state.title + state.storage)).toBe(false);
    });
  }

  test('the matrix parameters of a short address are dropped by the canonical redirect', async ({
    page,
    context,
    baseURL,
  }) => {
    await onProductionLikeHost(context, baseURL ?? '');
    for (const typed of [
      '/project;a=1/github.com/acme/demo/queries',
      '/project/github.com/acme/demo;b=2/queries',
      '/project/github.com/acme/demo/queries;c=3',
    ]) {
      await page.goto(`${HOST}${typed}`);
      await expect(page.locator('ion-header').first()).toBeVisible({
        timeout: 20_000,
      });
      await expect
        .poll(() => new URL(page.url()).pathname, { message: typed })
        .toBe('/project/github.com/acme/demo/queries');
    }
  });

  test('a folder with literal parentheses (as pasted from GitHub) shows the unsupported-address page, not folder a', async ({
    page,
    context,
    baseURL,
  }) => {
    await onProductionLikeHost(context, baseURL ?? '');
    await page.goto(
      `${HOST}/project/github.com/Acme/demo/tree/HEAD/a(b)/-/queries`,
    );
    await expect(page.getByText('This address is not supported')).toBeVisible({
      timeout: 20_000,
    });
  });

  test('a path written as one group at the root, without a question, is the project chat, not the holding page', async ({
    page,
    context,
    baseURL,
  }) => {
    await onProductionLikeHost(context, baseURL ?? '');
    await page.goto(`${HOST}/(project/github.com/acme/demo/chat)`);
    await expect(page.locator('ion-header').first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('#demo-holding-message')).toHaveCount(0);
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe('/project/github.com/acme/demo/chat');
  });

  // An in-app navigation: the page is already open, and the router is asked to go to a short address with a
  // question. The router's own Back/Forward handling is the way into the router that a production build allows
  // from outside (it has no debugging handle); the unit specs call `router.navigateByUrl` itself.
  test('a navigation inside the app to a short address with a question ends without it, in the address and the history', async ({
    page,
    context,
    baseURL,
  }) => {
    await onProductionLikeHost(context, baseURL ?? '');
    await page.goto(`${HOST}/project/github.com/acme/demo/chat`);
    await expect(page.locator('ion-header').first()).toBeVisible({
      timeout: 20_000,
    });
    // Back and Forward are the browser telling the router that the address changed.
    await page.evaluate(
      (question) => {
        history.pushState(
          history.state,
          '',
          `/project/github.com/acme/demo/queries?msg=${encodeURIComponent(question)}&x=1`,
        );
        dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      },
      MARKER,
    );
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 20_000 })
      .toBe('/project/github.com/acme/demo/queries');
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).searchParams.has('msg')).toBe(false);
    expect(new URL(page.url()).searchParams.get('x')).toBe('1');
    const entries = await page.evaluate(() =>
      (
        window as unknown as { navigation: { entries: () => { url: string }[] } }
      ).navigation
        .entries()
        .map((entry) => entry.url),
    );
    // the entry the test pushed itself carried the question; the router replaced it
    expect(entries.filter(hasMarker)).toEqual([]);
  });
});

test.describe('the matrix-parameter address reaches no analytics either', () => {
  const HOST = 'https://handoff.datatug.test';
  test('/demo;x=1?q=…: Google Analytics, Sentry and PostHog never receive the question', async ({
    page,
    context,
    baseURL,
  }) => {
    const external = await stubExternal(
      context,
      (o) => o === HOST || o === baseURL,
    );
    await context.route(`${HOST}/**`, async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({
        url: (baseURL ?? '') + url.pathname + url.search,
      });
      await route.fulfill({ response });
    });
    await context.route(
      'https://www.googletagmanager.com/**',
      async (route) => {
        external.push({ url: route.request().url(), method: 'GET', body: '' });
        await route.fulfill({
          status: 200,
          contentType: 'text/javascript',
          body: `(function(){var dl=window.dataLayer=window.dataLayer||[];
          function report(args){new Image().src='https://www.google-analytics.com/g/collect?dl='+encodeURIComponent(location.href)+'&cmd='+encodeURIComponent(JSON.stringify(Array.prototype.slice.call(args)));}
          dl.slice().forEach(report);var push=dl.push;dl.push=function(a){report(a);return push.apply(dl,arguments);};})();`,
        });
      },
    );
    await page.goto(
      `${HOST}/demo;x=1?scenario=${SCENARIO}&q=${encodeURIComponent(EN_QUESTION)}&lang=en`,
    );
    await expect(page.locator('blockquote')).toHaveText(EN_QUESTION, {
      timeout: 20_000,
    });
    await page.evaluate(() =>
      setTimeout(() => {
        throw new Error('G-0 probe: an uncaught error on the holding page');
      }),
    );
    await page.waitForTimeout(3000);
    const hosts = new Set(
      external.map((request) => new URL(request.url).hostname),
    );
    expect([...hosts].some((h) => h.includes('google-analytics.com'))).toBe(
      true,
    );
    expect([...hosts].some((h) => h.includes('sentry.io'))).toBe(true);
    const leaked = external.filter((request) =>
      [request.url, request.body].some(
        (text) =>
          text.includes(MARKER) ||
          text.includes(encodeURIComponent(MARKER)) ||
          text.includes(SCENARIO),
      ),
    );
    expect(leaked.map((r) => r.url.slice(0, 120))).toEqual([]);
  });
});

test.describe('every other route behaves as it does on main', () => {
  for (const path of [
    '/no-such-route-xyz?q=1',
    // (`/project/github.com/datatug/chinook-demo` used to be here: since G-A1b it is the project, at its short address.)
    '/project/github.com/datatug/chinook-demo/chat/extra',
    '/demo/other?q=1',
    '/demo(menu:x)?q=1', // an outlet group: not a hand-off address, for the script and the router alike
  ]) {
    test(`${path} still fails to match, asks for the crash-report dialog and rewrites the URL to /`, async ({
      page,
      context,
      baseURL,
    }) => {
      const origin = new URL(baseURL ?? '').origin;
      const external = await stubExternal(context, (o) => o === origin);
      const errors = consoleErrors(page);
      await page.goto(path);
      // This is main's behaviour, unchanged by G-0 (the global not-found handling is a separate task).
      await expect
        .poll(() => dialogRequested(external), { timeout: 20_000 })
        .toBe(true);
      expect(errors.some((e) => e.includes('NG04002'))).toBe(true);
      expect(new URL(page.url()).pathname).toBe('/');
    });
  }
});

/** Records every IndexedDB database the page opens or deletes; returns the list read back from the page. */
async function recordIndexedDb(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { __idb: string[] }).__idb = calls;
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name: string, version?: number) {
      calls.push(`open ${name}${version === undefined ? '' : '@' + version}`);
      return open.call(this, name, version);
    };
    const del = IDBFactory.prototype.deleteDatabase;
    IDBFactory.prototype.deleteDatabase = function (name: string) {
      calls.push(`delete ${name}`);
      return del.call(this, name);
    };
  });
  return () =>
    page.evaluate(() => (window as unknown as { __idb: string[] }).__idb);
}
