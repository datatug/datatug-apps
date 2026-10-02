import { expect, gridRows, HERO, OVDB, testNoStack as test, waitForAnswer } from './fixtures';

// The production data path: the same saved query and the same engine, reading the rows from static JSON
// published with the app instead of an OVDB server. The answer must be the same.
test('static data adapter: same 24 rows, no OVDB server involved', async ({ page }) => {
  test.setTimeout(90_000);
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.addInitScript(() => localStorage.setItem('datatug.demo.dataSource', 'static'));
  await page.goto(HERO);
  await waitForAnswer(page);
  const rows = await gridRows(page);
  expect(rows).toHaveLength(24);
  expect(rows[0]).toEqual(['Ireland', '45.62', '5,484,367', '2025', '8.32']);
  expect(rows.find((row) => row[0] === 'USA')).toEqual(['USA', '523.06', '341,784,857', '2025', '1.53']);
  await expect(page.getByTestId('trace-step').nth(6)).toContainText('412 invoices, 24 aliases and 216 population records became 24 rows');
  expect(requested.filter((url) => url.startsWith(OVDB))).toEqual([]);
  expect(requested.filter((url) => url.includes('/assets/demo-data/ovdb/')).length).toBeGreaterThanOrEqual(3);
  await page.getByTestId('trace-step').nth(6).getByRole('button').click();
  await expect(page.getByTestId('trace-step').nth(6).getByRole('region')).toContainText('static files published with the app');
});
