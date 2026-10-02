import { expect, handoff, HERO, OVDB, QUESTION_RU, test, testNoStack, useStaticData, waitForAnswer } from './fixtures';

const DEAD = 'http://127.0.0.1:59999';

const describe = test.describe;
describe('honest edges', () => {
  testNoStack('source down: a clear message and a retry, nothing invented', async ({ page }) => {
    await page.addInitScript((dead) => localStorage.setItem('datatug.demo.dataSource', dead), DEAD);
    await page.goto(HERO);
    const problem = page.getByTestId('problem');
    await expect(problem).toContainText('The demo data source is not reachable', { timeout: 30_000 });
    await expect(problem).toHaveAttribute('data-phase', 'source-unavailable');
    await expect(page.getByTestId('demo-grid')).toHaveCount(0);
    await expect(page.getByTestId('trace-step').last()).toHaveAttribute('data-status', 'failed');
    await expect(page.getByTestId('retry')).toBeVisible();
    await page.getByTestId('retry').click();
    await expect(problem).toContainText('not reachable', { timeout: 30_000 });
    // The failure is restored after a reload, still with a retry.
    await page.reload();
    await expect(page.getByTestId('problem')).toBeVisible({ timeout: 30_000 });
  });

  test('retry after the source comes back', async ({ page }) => {
    let failing = true;
    await page.route(`${OVDB}/**`, async (route) => {
      if (route.request().method() === 'OPTIONS' || !failing) { await route.fallback(); return; }
      await route.abort('connectionrefused');
    });
    await page.goto(HERO);
    await expect(page.getByTestId('problem')).toContainText('not reachable', { timeout: 30_000 });
    failing = false;
    await page.getByTestId('retry').click();
    await waitForAnswer(page);
    await expect(page.getByTestId('problem')).toHaveCount(0);
  });

  test('slow data: the page says it is still loading, then answers', async ({ page }) => {
    test.setTimeout(60_000);
    await page.route(`${OVDB}/v1/databases/geo/dtql`, async (route) => {
      await new Promise((done) => setTimeout(done, 5000));
      await route.fallback();
    });
    await page.goto(HERO);
    await expect(page.getByTestId('running')).toContainText('longer than usual', { timeout: 20_000 });
    await waitForAnswer(page);
  });

  testNoStack('Russian: the page chrome, the trace and the observations are in Russian, the question as given', async ({ page }) => {
    await useStaticData(page);
    await page.goto(handoff({ scenario: 'countries-music-per-capita', q: QUESTION_RU, lang: 'ru' }));
    await expect(page.getByTestId('row-count')).toHaveText('24 строки', { timeout: 60_000 });
    await expect(page.locator('main.demo')).toHaveAttribute('lang', 'ru');
    await expect(page.getByTestId('question')).toContainText(QUESTION_RU);
    await expect(page.getByTestId('trace-step').first()).toContainText('Вопрос распознан');
    await expect(page.getByTestId('trace-step').nth(4)).toContainText('21 из 24');
    await expect(page.getByTestId('no-ai')).toContainText('0 токенов');
    await page.getByTestId('followup-insight').click();
    await expect(page.getByTestId('observation').first()).toContainText('на 17-м месте');
    // The choice survives a reload, and can be switched back.
    await page.reload();
    await expect(page.getByTestId('row-count')).toHaveText('24 строки', { timeout: 30_000 });
    await page.getByTestId('lang-en').click();
    await expect(page.getByTestId('row-count')).toHaveText('24 rows');
  });

  testNoStack('a question longer than the limit is cut, not rejected', async ({ page }) => {
    await page.goto(handoff({ scenario: 'nope', q: 'x'.repeat(5000) }));
    const text = await page.getByTestId('question').locator('p').innerText();
    expect(text.length).toBeLessThanOrEqual(1000);
  });
});
