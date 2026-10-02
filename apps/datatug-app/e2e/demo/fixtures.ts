import { expect, test as base, type Page } from '@playwright/test';

/** The demo project's OVDB, as the dev environment's demo config names it (see `pnpm demo:up`). */
export const OVDB = 'http://127.0.0.1:50501';
export const QUESTION = 'Which countries buy the most music relative to their population?';
export const QUESTION_RU = 'Какие страны покупают больше всего музыки на душу населения?';

export function handoff(params: { scenario?: string; q?: string; lang?: string }): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, value);
  const text = search.toString();
  return `/demo${text ? `?${text}` : ''}`;
}

export const HERO = handoff({ scenario: 'countries-music-per-capita', q: QUESTION, lang: 'en' });

/**
 * The tests talk to the real local stack. When it is not running the whole project is skipped with a
 * reason that says how to start it, instead of failing in a way that looks like a product bug.
 */
export const test = base.extend<{ stack: void }>({
  stack: [async ({ request }, use, testInfo) => {
    const health = await request.get(`${OVDB}/v1/databases/geo/records/population_wb/ie`).catch(() => undefined);
    if (!health?.ok()) testInfo.skip(true, `The demo stack is not running (nothing healthy at ${OVDB}). Start it with: pnpm demo:up (or run pnpm demo:e2e).`);
    await use();
  }, { auto: true }],
});

/**
 * For tests that need no OVDB server: they read the static data published with the app (or fail the
 * source on purpose), so they also run where the stack is not available, such as the CI e2e job.
 */
export const testNoStack = base;

/** Read the demo's rows from the static files published with the app instead of the OVDB server. */
export async function useStaticData(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('datatug.demo.dataSource', 'static'));
}

export { expect };

/** Wait for the investigation to finish: the grid has its rows. */
export async function waitForAnswer(page: Page): Promise<void> {
  await expect(page.getByTestId('row-count')).toHaveText(/24 rows|24 строки/, { timeout: 60_000 });
}

/** The visible text of the grid's rows, in display order: [country, total, population, year, perMillion]. */
export async function gridRows(page: Page): Promise<string[][]> {
  await expect(page.locator('[data-testid="demo-grid"] .ag-row')).toHaveCount(24, { timeout: 15_000 });
  return page.locator('[data-testid="demo-grid"] .ag-row').evaluateAll((rows) =>
    (rows as HTMLElement[])
      .sort((a, b) => Number(a.getAttribute('row-index')) - Number(b.getAttribute('row-index')))
      .map((row) => Array.from(row.querySelectorAll('.ag-cell')).map((cell) => (cell.textContent ?? '').trim())));
}
