import { expect, test } from './helpers/demodb-guard';

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

  await page.goto('/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/chat');
  await page.getByLabel('Ask about project data').fill('Show the first three customers');
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

for (const width of [1280, 375]) {
  test(`Chat header keeps title, session and actions on one row at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/chat');
    const header = page.locator('sneat-datatug-chat-page > .ion-page > ion-header');
    await expect(header).toBeVisible({ timeout: 45_000 });
    await expect(header.locator('ion-toolbar')).toHaveCount(1);
    const title = header.getByRole('heading', { name: 'Chat', exact: true });
    const session = header.locator('.chat-header-title ion-select');
    const create = header.getByRole('button', { name: 'New chat', exact: true });
    const actions = header.getByRole('button', { name: 'Chat session actions', exact: true });
    await expect(page.getByText('Loading project context…', { exact: true })).toBeHidden({ timeout: 45_000 });
    await expect(create).toBeEnabled({ timeout: 45_000 });
    for (const control of [title, session, create, actions]) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      if (!box) throw new Error('Header control has no layout box');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      const headerBox = await header.boundingBox();
      if (!headerBox) throw new Error('Header has no layout box');
      expect(box.y + box.height / 2).toBeLessThan(headerBox.y + 60);
    }
    await create.click();
    await expect(session).toHaveJSProperty('selectedText', 'New chat');
    await actions.click();
    for (const name of ['Rename', 'Clear', 'Delete']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await page.getByLabel('Session name').fill('A long investigation session title that must stay on one row');
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByRole('button', { name: 'Save name', exact: true })).toBeHidden();
    await expect(session).toHaveJSProperty('selectedText', 'A long investigation session title that must stay on one row');
    await expect(header.locator('sneat-datatug-page-title ion-title')).toHaveAttribute('title', /Chat @ DataTug Demo/);
    const finalHeader = await header.boundingBox();
    if (!finalHeader) throw new Error('Header has no layout box after rename');
    expect(finalHeader.height).toBeLessThanOrEqual(60);
    await testInfo.attach(`chat-header-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}
