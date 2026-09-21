import { expect, test, type Locator } from '@playwright/test';

async function scrollGridToLastRow(grid: Locator): Promise<void> {
  await grid.evaluate((host: HTMLElement) => {
    const viewport = [...host.querySelectorAll<HTMLElement>('*')]
      .find((element) => element.scrollHeight > element.clientHeight);
    if (!viewport) throw new Error('AG Grid did not expose a scrollable results viewport.');
    viewport.scrollTop = viewport.scrollHeight;
  });
}

test('Chat persists a selected endpoint and renders seeded Chinook rows from deterministic DTQL', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('datatug.chat.providers.v1')) return;
    localStorage.setItem('datatug.chat.providers.v1', JSON.stringify([{
      id: 'fake-deepseek', name: 'DeepSeek', protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'test-key-not-a-secret',
    }]));
    localStorage.setItem('datatug.chat.selected-provider.v1', 'fake-deepseek');
  });
  await page.route('**/datatug/chat/interpret', async (route) => {
    expect(route.request().url()).not.toContain('test-key-not-a-secret');
    const body = route.request().postDataJSON() as { question: string; provider: { apiKey: string } };
    expect(body.provider.apiKey).toBe('test-key-not-a-secret');
    const actions: Record<string, unknown> = {
      'Show last 100 orders': { from: { schema: 'main', name: 'Invoice' }, orderBy: [{ field: 'InvoiceId', desc: true }], limit: 100 },
      'Show 50 customers from Prague': { from: { schema: 'main', name: 'Customer' }, where: { op: '==', left: { field: 'City' }, right: { value: 'Prague' } }, orderBy: [{ field: 'CustomerId' }], limit: 50 },
      'Show the last 20 invoices': { from: { schema: 'main', name: 'Invoice' }, orderBy: [{ field: 'InvoiceId', desc: true }], limit: 20 },
      'Show customers from Brazil': { from: { schema: 'main', name: 'Customer' }, where: { op: '==', left: { field: 'Country' }, right: { value: 'Brazil' } }, orderBy: [{ field: 'CustomerId' }], limit: 50 },
      'Show the newest 30 invoices': { from: { schema: 'main', name: 'Invoice' }, orderBy: [{ field: 'InvoiceId', desc: true }], limit: 30 },
      'Show 10 tracks by AC/DC': { from: { schema: 'main', name: 'Track' }, where: { op: '==', left: { field: 'ArtistName' }, right: { value: 'AC/DC' } }, orderBy: [{ field: 'TrackId' }], limit: 10 },
      'Show nobody from nowhere': { from: { schema: 'main', name: 'Customer' }, where: { op: '==', left: { field: 'City' }, right: { value: 'Nowhere' } }, limit: 50 },
      'Return malformed DTQL': 'not valid DTQL',
    };
    await route.fulfill({ json: { dtql: JSON.stringify(actions[body.question]) } });
  });

  await page.goto('/store/localhost:8989/project/datatug-demo-project/chat', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#main-content').getByText('Chat', { exact: true })).toBeVisible();
  await expect(page.getByText('API keys are stored in this browser origin')).toBeVisible();
  await expect(page.getByText('Loading local Chinook data…')).toBeHidden({ timeout: 30_000 });
  for (const [question, count] of [
    ['Show last 100 orders', 100], ['Show 50 customers from Prague', 2],
    ['Show the last 20 invoices', 20], ['Show customers from Brazil', 5],
    ['Show the newest 30 invoices', 30], ['Show 10 tracks by AC/DC', 10],
  ] as const) {
    await page.getByLabel('Ask about Chinook data').fill(question);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText(`${count} rows`).last()).toBeVisible();
  }
  const grids = page.locator('ag-grid-angular');
  await expect(grids).toHaveCount(6);
  await expect(grids.first()).toBeVisible();
  await expect(grids.nth(0)).toContainText('412');
  await scrollGridToLastRow(grids.nth(0));
  await expect(grids.nth(0)).toContainText('313');
  await expect(grids.nth(1)).toContainText('5');
  await expect(grids.nth(1)).toContainText('6');
  await expect(grids.nth(3)).toContainText('Brazil');
  await scrollGridToLastRow(grids.nth(4));
  await expect(grids.nth(4)).toContainText('383');
  await expect(grids.nth(5)).toContainText('1');
  await scrollGridToLastRow(grids.nth(5));
  await expect(grids.nth(5)).toContainText('14');

  await page.getByLabel('Ask about Chinook data').fill('Show nobody from nowhere');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('No matching rows.')).toBeVisible();

  await page.getByLabel('Ask about Chinook data').fill('Return malformed DTQL');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.turn').last().locator('ion-text[color="danger"]')).toHaveText(/DTQL|from/i);

  await page.reload();
  await expect(page.getByText('DeepSeek · deepseek-flash').nth(1)).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('button', { name: 'Save provider' })).toBeVisible();
  await expect(page.getByLabel('API key')).toHaveValue('test-key-not-a-secret');

  await page.goto('/store/evil.example/project/datatug-demo-project/chat');
  await expect(page.getByText('Loading local Chinook data…')).toBeHidden({ timeout: 30_000 });
  await page.getByLabel('Ask about Chinook data').fill('Show last 100 orders');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('This local Chat trial sends API keys only to a loopback DataTug agent. Choose a localhost store.')).toBeVisible();

  await page.goto('/store/localhost:8989/project/a-different-project/chat');
  await expect(page.getByText('This local Chat trial has Chinook data only for datatug-demo-project.')).toBeVisible();
  await expect(page.getByText('Show last 100 orders')).toHaveCount(0);
});
