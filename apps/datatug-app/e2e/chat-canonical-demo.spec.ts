import { expect, test } from '@playwright/test';

test('the advertised GitHub Chinook demo seeds all tables, attaches context and executes a bounded query', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem('datatug.chat.providers.v1', JSON.stringify([{
      id: 'demo-test', name: 'Demo test', protocol: 'openai-chat', baseUrl: 'https://api.deepseek.com',
      model: 'demo-test', apiKey: 'test-key-not-a-secret',
    }]));
    localStorage.setItem('datatug.chat.selected-provider.v1', 'demo-test');
  });
  await page.route('https://api.deepseek.com/chat/completions', async (route) => {
    const body = route.request().postDataJSON() as { messages: { content: string }[] };
    expect(body.messages[0].content).toContain('main.Customer');
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ dtql: {
      from: { schema: 'main', name: 'Customer' }, orderBy: [{ field: 'CustomerId' }], limit: 3,
    } }) } }] } });
  });

  await page.goto('/project/github.com/datatug/chinook-demo/chat');
  await page.getByLabel('Ask about Chinook data').fill('Show the first three customers');
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled({ timeout: 45_000 });
  const counts = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('chinook');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const names = Array.from(database.objectStoreNames);
    const transaction = database.transaction(names, 'readonly');
    const counts = await Promise.all(names.map((name) => new Promise<number>((resolve, reject) => {
      const request = transaction.objectStore(name).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    })));
    database.close();
    return Object.fromEntries(names.map((name, index) => [name, counts[index]]));
  });
  expect(counts).toEqual({
    Album: 347, Artist: 275, Customer: 59, Employee: 8, Genre: 25, Invoice: 412,
    InvoiceLine: 2240, MediaType: 5, Playlist: 18, PlaylistTrack: 8715, Track: 3503, _meta: 1,
  });
  const workspace = page.getByLabel('Chat workspace');
  await workspace.locator('ion-item').filter({ hasText: 'Local data source' }).getByRole('button', { name: 'Attach', exact: true }).click();
  await workspace.locator('.workspace-table').filter({ hasText: 'Customer' }).getByRole('button', { name: 'Attach', exact: true }).click();
  await expect(page.getByLabel('Attached context')).toContainText('Chinook');
  await expect(page.getByLabel('Attached context')).toContainText('Customer');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('tab', { name: 'Rows 3', exact: true })).toBeVisible();
  const grid = page.locator('.turn ag-grid-angular');
  await expect(grid.locator('.ag-row[row-index="0"] .ag-cell[col-id="CustomerId"]')).toHaveText('1');
  await expect(grid.locator('.ag-row[row-index="0"] .ag-cell[col-id="FirstName"]')).toHaveText('Luís');
  await expect(grid.locator('.ag-row[row-index="2"] .ag-cell[col-id="CustomerId"]')).toHaveText('3');
  await testInfo.attach('canonical-chinook-result', { body: await page.screenshot(), contentType: 'image/png' });
});
