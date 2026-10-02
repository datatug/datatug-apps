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
      'This is the question you asked. The live demo opens here soon.',
    without: 'The live demo opens here soon.',
  },
  ru: {
    withQuestion: 'Это ваш вопрос. Живое демо скоро откроется здесь.',
    without: 'Живое демо скоро откроется здесь.',
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
});

test.describe('the question reaches no analytics or error report', () => {
  const HOST = 'https://handoff.datatug.test';

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
      (o) => o === HOST || o === baseURL,
    );
    await context.route(`${HOST}/**`, async (route) => {
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

test.describe('every other route behaves as it does on main', () => {
  for (const path of [
    '/no-such-route-xyz?q=1',
    '/project/github.com/datatug/chinook-demo',
    '/project/github.com/datatug/chinook-demo/chat/extra',
    '/demo/other?q=1',
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
