import { expect, gridRows, HERO, OVDB, test, testNoStack, useStaticData, waitForAnswer } from './fixtures';

const STEP_KINDS = ['understand', 'select-tables', 'resolve-meaning', 'need-source', 'reconcile-identifiers', 'reconcile-identifiers', 'execute', 'derive-metric', 'present'];

test('hand-off: question, trace building, grid, chart, follow-up, reload', async ({ page }) => {
  test.setTimeout(120_000);
  const hosts = new Set<string>();
  page.on('request', (request) => { if (/^https?:/.test(request.url())) hosts.add(new URL(request.url()).host); });
  const sourceRequests: string[] = [];
  page.on('request', (request) => { if (request.url().startsWith(OVDB)) sourceRequests.push(request.method()); });

  await page.goto(HERO);

  // The address bar reads /demo: the query string was consumed before the router and analytics ran.
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByTestId('question')).toContainText('Which countries buy the most music relative to their population?');

  // The trace appears step by step and ends in the expected order.
  await waitForAnswer(page);
  const kinds = await page.getByTestId('trace-step').evaluateAll((items) => items.map((item) => item.getAttribute('data-kind')));
  expect(kinds).toEqual(STEP_KINDS);
  const steps = page.getByTestId('trace-step');
  await expect(steps.nth(4)).toContainText('21 of 24');
  await expect(steps.nth(4)).toContainText('3 needed');
  await expect(steps.nth(5)).toContainText('24 of 24');
  await expect(steps.nth(6)).toContainText('412 invoices, 24 aliases and 216 population records became 24 rows');
  await expect(page.getByTestId('no-ai')).toContainText('0 tokens');

  // The meaning step says what is not connected yet instead of pretending.
  await expect(steps.nth(2)).toContainText('Preview');

  // An executed step opens to its evidence: the DTQL and the sources, with the counts this run observed.
  await steps.nth(6).getByRole('button').click();
  await expect(steps.nth(6).getByRole('region')).toContainText('from:');
  await expect(steps.nth(6).getByRole('region')).toContainText('chinook.Invoice: 412 rows');
  await expect(steps.nth(6).getByRole('region')).toContainText('geo.population_wb: 216 rows');

  // The grid: 24 rows, Ireland first at 8.32, the USA at 1.53.
  const rows = await gridRows(page);
  expect(rows).toHaveLength(24);
  expect(rows[0]).toEqual(['Ireland', '45.62', '5,484,367', '2025', '8.32']);
  expect(rows[1][0]).toBe('Czech Republic');
  expect(rows[1][4]).toBe('8.29');
  const usa = rows.find((row) => row[0] === 'USA');
  expect(usa).toEqual(['USA', '523.06', '341,784,857', '2025', '1.53']);

  // The chart: top 10 plus the USA at its true rank.
  const bars = page.getByTestId('chart-bar');
  await expect(bars).toHaveCount(11);
  await expect(bars.first()).toContainText('Ireland');
  await expect(bars.last()).toContainText('USA');
  await expect(bars.last()).toContainText('17');

  // Chart and grid highlight each other.
  await bars.last().hover();
  await expect(page.locator('[data-testid="demo-grid"] .linked-row')).toContainText('USA');

  // The follow-up computes observations from the rows, each linked to its rows.
  await page.getByTestId('followup-insight').click();
  const observations = page.getByTestId('observation');
  await expect(observations).toHaveCount(3);
  await expect(observations.nth(0)).toContainText('USA has the largest total (523.06) but ranks number 17 per person (1.53 per million).');
  await expect(observations.nth(1)).toContainText('Ireland leads per person (8.32 per million), just ahead of Czech Republic (8.29).');
  await expect(page.getByTestId('observations-note')).toContainText('No AI wrote this');
  await observations.nth(0).getByRole('button').click();
  await expect(page.locator('[data-testid="demo-grid"] .linked-row')).toHaveCount(1);
  await expect(page.locator('[data-testid="demo-grid"] .linked-row')).toContainText('USA');
  await expect(page.locator('[data-testid="chart-bar"].linked')).toContainText('USA');
  await expect(page.getByTestId('keep')).toContainText('Keep this investigation');
  await expect(steps).toHaveCount(STEP_KINDS.length + 1);

  // Nothing left this machine.
  expect([...hosts].filter((host) => !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))).toEqual([]);

  // Reload restores the investigation from the browser's own store, without reading the sources again.
  sourceRequests.length = 0;
  await page.reload();
  await expect(page.getByTestId('row-count')).toHaveText('24 rows', { timeout: 30_000 });
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByTestId('question')).toContainText('Which countries buy');
  await expect(page.getByTestId('trace-step')).toHaveCount(STEP_KINDS.length + 1);
  expect((await gridRows(page))[0][0]).toBe('Ireland');
  await expect(page.getByTestId('observation')).toHaveCount(3);
  expect(sourceRequests).toEqual([]);
});

testNoStack('the keep call to action opens the existing sign-in flow', async ({ page }) => {
  await useStaticData(page);
  await page.goto(HERO);
  await waitForAnswer(page);
  await page.getByTestId('followup-insight').click();
  await page.getByTestId('keep-sign-in').click();
  await expect(page).toHaveURL(/\/login#\/demo$/);
});

testNoStack('Run again replaces the run: same answer, one trace, no pile-up', async ({ page }) => {
  await useStaticData(page);
  await page.goto(HERO);
  await waitForAnswer(page);
  await page.getByTestId('run-again').click();
  await expect(page.getByTestId('trace-step')).toHaveCount(STEP_KINDS.length, { timeout: 60_000 });
  await waitForAnswer(page);
  await expect(page.getByTestId('trace-step')).toHaveCount(STEP_KINDS.length);
  expect((await gridRows(page))[0][0]).toBe('Ireland');
});
