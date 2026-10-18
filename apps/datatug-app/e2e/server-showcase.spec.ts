import { expect, test } from '@playwright/test';
import { installFakeGithub } from './helpers/fake-github';

// Explicit live acceptance: the project reader uses the paired committed demo
// checkout, while OVDB and its pinned publisher rights remain real network reads.
test('server showcase and tutorial hold complete results without SQLite downloads', async ({ page, context }) => {
  test.skip(process.env['DATATUG_E2E_SERVER_SHOWCASE'] !== '1', 'explicit live server acceptance only');
  const source = process.env['DATATUG_E2E_GITHUB_FAKE'];
  if (!source) throw new Error('Set DATATUG_E2E_GITHUB_FAKE to the paired committed demo checkout.');
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  await installFakeGithub(context, [{ fullName: 'datatug/datatug-demo-project', dir: source }]);
  // The fake project reader also owns raw.githubusercontent.com; let this
  // different repository serve its real SHA-pinned rights publications.
  await context.route('https://raw.githubusercontent.com/demo-db/northwind/**', route => route.continue());
  const requests: string[] = [];
  context.on('request', request => {
    if (!request.url().endsWith('/dtql') || request.method() === 'POST') requests.push(request.url());
  });
  const queries = () => requests.filter(url => url.includes('ovdb.demodb.dev/v1/databases/') && url.endsWith('/dtql'));
  const downloads = () => requests.filter(url => /\.(?:sqlite|wasm)(?:$|\?)/.test(url));
  const url = '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/board/showcase';
  await page.goto(url);
  const race = page.locator('ion-card').filter({ hasText: 'Where Northwind orders shipped' }).first();
  await expect(race).toContainText('830 source orders', { timeout: 60_000 });
  await expect(race).toContainText('23 monthly frames');
  await expect.poll(() => queries().length).toBeGreaterThanOrEqual(2);
  const inspector = page.locator('ion-card').filter({ hasText: 'Inspect three saved query results' }).first();
  for (const [tab, summary, database, rowCount] of [
    ['Northwind · server orders', '830 rows · 14 columns', 'northwind', 25],
    ['Northwind · server countries', '21 rows · 2 columns', 'northwind', 21],
    ['Chinook · customer billing', '10 rows · 6 columns', 'chinook', 10],
  ] as const) {
    const tabHost = inspector.locator('ion-segment-button').filter({ hasText: tab });
    await expect(tabHost).toHaveText(tab);
    await tabHost.click();
    const before = queries().length;
    await Promise.all([
      page.waitForResponse(response => response.request().method() === 'POST' &&
        response.url() === `https://ovdb.demodb.dev/v1/databases/${database}/dtql`, { timeout: 30_000 }),
      inspector.getByRole('button', { name: 'Run on board', exact: true }).click(),
    ]);
    await expect(inspector.getByRole('button', { name: 'Run on board', exact: true })).toBeEnabled();
    await expect(inspector).toContainText(summary, { timeout: 30_000 });
    await expect(inspector.locator('table tbody tr')).toHaveCount(rowCount);
    expect(queries().length).toBeGreaterThan(before);
    expect(queries().at(-1)).toContain(`/databases/${database}/dtql`);
  }
  const count = queries().length;
  await race.getByRole('button', { name: 'Source rows', exact: true }).click();
  await expect(race.locator('sneat-datatug-held-result-presentation table tbody tr')).toHaveCount(25);
  await race.getByRole('button', { name: 'Chart', exact: true }).click();
  expect(queries()).toHaveLength(count);
  expect(downloads()).toEqual([]);

  await page.goto(url + '?mode=tutorial');
  await expect(page.getByRole('heading', { name: 'Build this dashboard' })).toBeVisible();
  await page.getByRole('button', { name: 'Add the first card', exact: true }).click();
  const tutorialRace = page.locator('ion-card').filter({ hasText: 'Where Northwind orders shipped' }).first();
  await expect(tutorialRace).toContainText('830 source orders', { timeout: 60_000 });
  const tutorialCount = queries().length;
  await tutorialRace.getByRole('button', { name: 'Source rows', exact: true }).click();
  await expect(tutorialRace.locator('sneat-datatug-held-result-presentation table tbody tr')).toHaveCount(25);
  await tutorialRace.getByRole('button', { name: 'Chart', exact: true }).click();
  expect(queries()).toHaveLength(tutorialCount);
  expect(downloads()).toEqual([]);
});
