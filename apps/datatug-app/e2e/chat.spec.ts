import { expect, test, type Locator } from '@playwright/test';

async function scrollGridToLastRow(grid: Locator): Promise<void> {
  await grid.evaluate((host: HTMLElement) => {
    const viewport = host.querySelector<HTMLElement>('.ag-body-vertical-scroll-viewport');
    if (!viewport) throw new Error('AG Grid did not expose a vertical results viewport.');
    viewport.scrollTop = viewport.scrollHeight;
  });
}

function cell(grid: Locator, row: number, column: string): Locator {
  return grid.locator(`.ag-row[row-index="${row}"] .ag-cell[col-id="${column}"]`);
}

test('Chat persists a selected endpoint and renders seeded Chinook rows from deterministic DTQL', async ({ page }) => {
  let fixtureRequests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/assets/chinook-phase1.json')) fixtureRequests += 1;
  });
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
      'Show last 100 orders': { from: { schema: 'chinook', name: 'Invoice' }, orderBy: [{ field: 'InvoiceId', desc: true }], limit: 100 },
      'Show 50 customers from Prague': { from: { schema: 'chinook', name: 'Customer' }, where: { op: '==', left: { field: 'City' }, right: { value: 'Prague' } }, orderBy: [{ field: 'CustomerId' }], limit: 50 },
      'Show the last 20 invoices': { from: { schema: 'chinook', name: 'Invoice' }, orderBy: [{ field: 'InvoiceId', desc: true }], limit: 20 },
      'Show customers from Brazil': { from: { schema: 'chinook', name: 'Customer' }, where: { op: '==', left: { field: 'Country' }, right: { value: 'Brazil' } }, orderBy: [{ field: 'CustomerId' }], limit: 50 },
      'Show the newest 30 invoices': { from: { schema: 'chinook', name: 'Invoice' }, orderBy: [{ field: 'InvoiceId', desc: true }], limit: 30 },
      'Show 10 tracks by AC/DC': { from: { schema: 'chinook', name: 'Track' }, where: { op: '==', left: { field: 'ArtistName' }, right: { value: 'AC/DC' } }, orderBy: [{ field: 'TrackId' }], limit: 10 },
      'Show nobody from nowhere': { from: { schema: 'chinook', name: 'Customer' }, where: { op: '==', left: { field: 'City' }, right: { value: 'Nowhere' } }, limit: 50 },
      'Return malformed DTQL': 'not valid DTQL',
    };
    await route.fulfill({ json: { dtql: JSON.stringify(actions[body.question]) } });
  });

  await page.goto('/store/localhost:8989/project/datatug-demo-project/chat', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#main-content').getByText('Chat', { exact: true })).toBeVisible();
  await expect(page.getByText('API keys are stored in this browser origin')).toBeVisible();
  await expect(page.getByText('Loading local Chinook data…')).toBeHidden({ timeout: 30_000 });
  await page.getByLabel('Ask about Chinook data').fill('Show last 100 orders');
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled({ timeout: 30_000 });
  expect(fixtureRequests).toBe(1);
  const stores = await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    const name = databases.find((database) => database.name?.startsWith('datatug-chat:v2:'))?.name;
    if (!name) throw new Error(`Chinook IndexedDB database was not created: ${JSON.stringify(databases)}`);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const names = Array.from(database.objectStoreNames);
    const transaction = database.transaction(names, 'readonly');
    const counts = await Promise.all(names.map((storeName) => new Promise<number>((resolve, reject) => {
      const request = transaction.objectStore(storeName).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    })));
    database.close();
    return Object.fromEntries(names.map((storeName, index) => [storeName, counts[index]]));
  });
  expect(stores).toEqual({ 'chinook.Customer': 59, 'chinook.Invoice': 412, 'chinook.Track': 3503, 'chinook._meta': 1 });
  for (const [question, count] of [
    ['Show last 100 orders', 100], ['Show 50 customers from Prague', 2],
    ['Show the last 20 invoices', 20], ['Show customers from Brazil', 5],
    ['Show the newest 30 invoices', 30], ['Show 10 tracks by AC/DC', 10],
  ] as const) {
    await page.getByLabel('Ask about Chinook data').fill(question);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('tab', { name: `Rows ${count}` }).last()).toBeVisible();
  }
  const grids = page.locator('ag-grid-angular');
  await expect(grids).toHaveCount(6);
  await expect(grids.first()).toBeVisible();
  await expect(page.locator('.question-bubble').first()).toHaveText('Show last 100 orders');
  await expect(page.locator('.turn').first().getByText('Rows 100', { exact: true })).toBeVisible();
  await expect(page.locator('.turn').first().locator('.dtql')).toHaveCount(0);
  await page.locator('.turn').first().getByText('DTQL', { exact: true }).click();
  await expect(page.locator('.turn').first().locator('.dtql')).toBeVisible();
  await page.locator('.turn').first().getByText('Rows 100', { exact: true }).click();
  await expect(page.locator('.turn').first().locator('ag-grid-angular')).toBeVisible();
  await expect(cell(grids.nth(0), 0, 'InvoiceId')).toHaveText('412');
  await scrollGridToLastRow(grids.nth(0));
  await expect(cell(grids.nth(0), 99, 'InvoiceId')).toHaveText('313');
  await expect(cell(grids.nth(1), 0, 'CustomerId')).toHaveText('5');
  await expect(cell(grids.nth(1), 1, 'CustomerId')).toHaveText('6');
  await expect(cell(grids.nth(3), 0, 'CustomerId')).toHaveText('1');
  await expect(cell(grids.nth(3), 4, 'CustomerId')).toHaveText('13');
  await expect(cell(grids.nth(2), 0, 'InvoiceId')).toHaveText('412');
  await scrollGridToLastRow(grids.nth(2));
  await expect(cell(grids.nth(2), 19, 'InvoiceId')).toHaveText('393');
  await expect(cell(grids.nth(4), 0, 'InvoiceId')).toHaveText('412');
  await scrollGridToLastRow(grids.nth(4));
  await expect(cell(grids.nth(4), 29, 'InvoiceId')).toHaveText('383');
  await expect(cell(grids.nth(5), 0, 'TrackId')).toHaveText('1');
  await scrollGridToLastRow(grids.nth(5));
  await expect(cell(grids.nth(5), 9, 'TrackId')).toHaveText('14');

  await page.getByLabel('Ask about Chinook data').fill('Show nobody from nowhere');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('No matching rows.')).toBeVisible();

  await page.getByLabel('Ask about Chinook data').fill('Return malformed DTQL');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.turn').last().locator('ion-text[color="danger"]')).toHaveText(/DTQL|from/i);

  await page.reload();
  await expect(page.getByText('Loading local Chinook data…')).toBeHidden({ timeout: 30_000 });
  expect(fixtureRequests).toBe(1);
  await expect(page.getByText('DeepSeek · deepseek-flash').nth(1)).toBeVisible();
  await expect(page.getByText('key test-••••cret')).toBeVisible();
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
