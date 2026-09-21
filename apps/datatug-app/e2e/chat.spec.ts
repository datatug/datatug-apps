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
  test.setTimeout(90_000);
  let fixtureRequests = 0;
  let localInterpretRequests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/assets/chinook-full.json')) fixtureRequests += 1;
    if (request.url().includes('/datatug/chat/interpret')) localInterpretRequests += 1;
  });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('chat-provider-test-seeded')) return;
    sessionStorage.setItem('chat-provider-test-seeded', 'true');
    localStorage.setItem('datatug.chat.providers.v1', JSON.stringify([{
      id: 'fake-deepseek', name: 'DeepSeek', protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'test-key-not-a-secret',
    }]));
    localStorage.setItem('datatug.chat.selected-provider.v1', 'fake-deepseek');
  });
  await page.route('https://api.deepseek.com/chat/completions', async (route) => {
    expect(route.request().headers()['authorization']).toBe('Bearer test-key-not-a-secret');
    const body = route.request().postDataJSON() as { model: string; messages: { role: string; content: string }[] };
    expect(body.model).toBe('deepseek-flash');
    expect(JSON.stringify(body)).not.toContain('test-key-not-a-secret');
    expect(body.messages[0].content).toContain('main.Artist(ArtistId, Name)');
    const question = body.messages.at(-1)?.content;
    if (question === 'Return oversized response') {
      await route.fulfill({ json: { choices: [{ message: { content: 'x'.repeat(140_000) } }] } });
      return;
    }
    const actions: Record<string, unknown> = {
      'Show last 100 orders': { from: { schema: 'main', name: 'Invoice' }, orderBy: [{ field: 'InvoiceId', desc: true }], limit: 100 },
      'Show 50 customers from Prague': { from: { name: 'Customer' }, where: { op: '==', left: { field: 'City' }, right: { value: 'Prague' } }, orderBy: [{ field: 'CustomerId' }], limit: 50 },
      'Show the last 20 invoices': { from: { schema: 'main', name: 'Invoice' }, orderBy: [{ field: 'InvoiceId', desc: true }], limit: 20 },
      'Show customers from Brazil': { from: { schema: 'main', name: 'Customer' }, where: { op: '==', left: { field: 'Country' }, right: { value: 'Brazil' } }, orderBy: [{ field: 'CustomerId' }], limit: 50 },
      'Show the newest 30 invoices': { from: { schema: 'main', name: 'Invoice' }, orderBy: [{ field: 'InvoiceId', desc: true }], limit: 30 },
      'Show 10 tracks by AC/DC': { from: { schema: 'main', name: 'Track' }, where: { op: '==', left: { field: 'ArtistName' }, right: { value: 'AC/DC' } }, orderBy: [{ field: 'TrackId' }], limit: 10 },
      'Show 10 artists': { from: { name: 'Artist' }, orderBy: [{ field: 'ArtistId' }], limit: 10 },
      'Show 10 invoice lines': { from: { schema: 'main', name: 'InvoiceLine' }, orderBy: [{ field: 'InvoiceLineId' }], limit: 10 },
      'Show nobody from nowhere': { from: { schema: 'main', name: 'Customer' }, where: { op: '==', left: { field: 'City' }, right: { value: 'Nowhere' } }, limit: 50 },
      'Return malformed DTQL': 'not valid DTQL',
    };
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ dtql: actions[question || ''] }) } }], usage: { prompt_tokens: 21, completion_tokens: 9, total_tokens: 30 } } });
  });

  await page.goto('/store/localhost:8989/project/datatug-demo-project/chat', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#main-content').getByText(/Chat\s*@\s*(DataTug Demo Project 1|datatug-demo-project)/)).toBeVisible();
  await expect(page.locator('ion-footer').getByLabel('AI provider')).toBeVisible();
  await expect(page.getByText('Loading local Chinook data…')).toBeHidden({ timeout: 30_000 });
  await page.getByLabel('Ask about Chinook data').fill('Show last 100 orders');
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled({ timeout: 30_000 });
  expect(fixtureRequests).toBe(1);
  const stores = await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    const name = databases.find((database) => database.name === 'chinook')?.name;
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
  expect(stores).toEqual({
    Album: 347, Artist: 275, Customer: 59, Employee: 8, Genre: 25,
    Invoice: 412, InvoiceLine: 2240, MediaType: 5, Playlist: 18,
    PlaylistTrack: 8715, Track: 3503, _meta: 1,
  });
  for (const [question, count] of [
    ['Show last 100 orders', 100], ['Show 50 customers from Prague', 2],
    ['Show the last 20 invoices', 20], ['Show customers from Brazil', 5],
    ['Show the newest 30 invoices', 30], ['Show 10 tracks by AC/DC', 10],
    ['Show 10 artists', 10], ['Show 10 invoice lines', 10],
  ] as const) {
    await page.getByLabel('Ask about Chinook data').fill(question);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('tab', { name: `Rows ${count}` }).last()).toBeVisible();
  }
  const grids = page.locator('ag-grid-angular');
  await expect(grids).toHaveCount(8);
  await expect(grids.first()).toBeVisible();
  await expect(page.locator('.question-bubble').first()).toHaveText('Show last 100 orders');
  const you = await page.locator('.turn').first().locator('.question-row strong').boundingBox();
  const bubble = await page.locator('.question-bubble').first().boundingBox();
  expect(you && bubble).toBeTruthy();
  expect(bubble!.x).toBeGreaterThan(you!.x + you!.width);
  expect(Math.abs((bubble!.y + bubble!.height / 2) - (you!.y + you!.height / 2))).toBeLessThan(12);
  await expect(page.locator('.turn').first().getByText('Rows 100', { exact: true })).toBeVisible();
  await expect(page.locator('.turn').first().locator('.dtql')).toHaveCount(0);
  await page.locator('.turn').first().getByText('DTQL', { exact: true }).click();
  await expect(page.locator('.turn').first().locator('.dtql')).toBeVisible();
  await expect(page.locator('.turn').first().locator('.dtql')).toContainText('from:\n  schema: "main"\n  name: "Invoice"');
  await expect(page.locator('.turn').first().locator('.dtql')).toContainText('limit: 100');
  await page.locator('.turn').first().getByText('SQL', { exact: true }).click();
  const sqlTurn = page.locator('.turn').first();
  await expect(sqlTurn.getByLabel('SQL syntax')).toBeVisible();
  await sqlTurn.locator('ion-select').click();
  await expect(page.getByRole('radio', { name: 'SQLite' })).toBeVisible();
  await page.getByRole('radio', { name: 'SQLite' }).click();
  await expect(sqlTurn.getByLabel('Generated SQL')).toHaveValue('SELECT *\nFROM "main"."Invoice"\nORDER BY "InvoiceId" DESC\nLIMIT 100;');
  await expect(sqlTurn.getByLabel('Generated SQL')).toHaveAttribute('readonly');
  await page.locator('.turn').first().getByText('Rows 100', { exact: true }).click();
  await expect(page.locator('.turn').first().locator('ag-grid-angular')).toBeVisible();
  await page.locator('.turn').first().getByText('Metrics', { exact: true }).click();
  await expect(page.locator('.turn').first().locator('.metric').filter({ hasText: 'Input tokens' })).toContainText('21');
  await expect(page.locator('.turn').first().locator('.metric').filter({ hasText: 'Total tokens' })).toContainText('30');
  await expect(page.locator('.turn').first().locator('.metric').filter({ hasText: 'Request body' })).toContainText('B');
  await page.locator('.turn').first().getByText('Rows 100', { exact: true }).click();
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
  await page.locator('.turn').nth(5).getByText('SQL', { exact: true }).click();
  await expect(page.locator('.turn').nth(5).getByLabel('Generated SQL')).toHaveValue(/JOIN "main"\."Artist" AS "Artist"[\s\S]*WHERE "Artist"\."Name" = 'AC\/DC'/);
  await page.locator('.turn').nth(5).getByText('Rows 10', { exact: true }).click();
  await scrollGridToLastRow(grids.nth(5));
  await expect(cell(grids.nth(5), 9, 'TrackId')).toHaveText('14');
  await expect(cell(grids.nth(6), 0, 'ArtistId')).toHaveText('1');
  await expect(cell(grids.nth(7), 0, 'InvoiceLineId')).toHaveText('1');

  await page.getByLabel('Ask about Chinook data').fill('Show nobody from nowhere');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('No matching rows.')).toBeVisible();

  await page.getByLabel('Ask about Chinook data').fill('Return malformed DTQL');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.turn').last().locator('ion-text[color="danger"]')).toHaveText(/DTQL|from/i);

  await page.getByLabel('Ask about Chinook data').fill('Return oversized response');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.turn').last().locator('ion-text[color="danger"]')).toHaveText('The AI provider response is too large.');

  await page.reload();
  await expect(page.getByText('Loading local Chinook data…')).toBeHidden({ timeout: 30_000 });
  await page.getByLabel('Ask about Chinook data').fill('Show last 100 orders');
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled({ timeout: 30_000 });
  expect(fixtureRequests).toBe(1);
  await expect(page.locator('ion-footer').getByLabel('AI provider')).toHaveAttribute('aria-label', /DeepSeek/);
  await page.locator('ion-footer ion-select').click({ timeout: 5000 });
  await page.getByRole('radio', { name: 'Add new AI provider' }).click({ timeout: 5000 });
  await expect(page.getByText('API keys are stored in this browser origin')).toBeVisible();
  await expect(page.getByText('Key test-••••cret')).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('button', { name: 'Save provider' })).toBeVisible();
  await expect(page.getByLabel('API key')).toHaveValue('test-key-not-a-secret');
  await page.getByLabel('Provider name').fill('My DeepSeek');
  await page.getByRole('button', { name: 'Save provider' }).click();
  await page.reload();
  await expect(page.locator('ion-footer').getByLabel('AI provider')).toHaveAttribute('aria-label', /My DeepSeek/);

  await page.goto('/store/evil.example/project/datatug-demo-project/chat');
  await expect(page.getByText('Loading local Chinook data…')).toBeHidden({ timeout: 30_000 });
  await page.getByLabel('Ask about Chinook data').fill('Show last 100 orders');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('tab', { name: 'Rows 100' }).last()).toBeVisible();
  expect(localInterpretRequests).toBe(0);

  await page.goto('/store/localhost:8989/project/a-different-project/chat');
  await expect(page.getByText('This local Chat trial has Chinook data only for datatug-demo-project.')).toBeVisible();
  await expect(page.getByText('Show last 100 orders')).toHaveCount(0);
});

test('composer can add a provider and restore it after reload', async ({ page }) => {
  await page.goto('/store/localhost:8989/project/datatug-demo-project/chat');
  await page.locator('ion-footer ion-select').click();
  await page.getByRole('radio', { name: 'Add new AI provider' }).click();
  await expect(page.getByRole('heading', { name: 'Add AI provider' })).toBeVisible();
  await page.getByRole('button', { name: 'Add AI provider' }).click();
  await expect(page.getByText('Enter a name, base URL, model, and API key.')).toBeVisible();
  await page.getByLabel('API key').fill('test-key-not-a-secret');
  await page.getByRole('button', { name: 'Add AI provider' }).click();
  await expect(page.locator('ion-modal')).toBeHidden();
  await expect(page.locator('ion-footer').getByLabel('AI provider')).toHaveAttribute('aria-label', /DeepSeek/);
  await page.reload();
  await expect(page.locator('ion-footer').getByLabel('AI provider')).toHaveAttribute('aria-label', /DeepSeek/);
  await page.setViewportSize({ width: 390, height: 800 });
  const input = await page.locator('ion-footer ion-input').boundingBox();
  const dropdown = await page.locator('ion-footer ion-select').boundingBox();
  const send = await page.locator('ion-footer ion-button').boundingBox();
  expect(input && dropdown && send).toBeTruthy();
  expect(dropdown!.x).toBeGreaterThan(input!.x + input!.width);
  expect(send!.x).toBeGreaterThan(dropdown!.x + dropdown!.width);
  expect(send!.x + send!.width).toBeLessThanOrEqual(390);
  const stored = await page.evaluate(() => ({
    providers: JSON.parse(localStorage.getItem('datatug.chat.providers.v1') || '[]') as { id: string; name: string }[],
    selected: localStorage.getItem('datatug.chat.selected-provider.v1'),
  }));
  expect(stored.providers).toHaveLength(1);
  expect(stored.providers[0]?.name).toBe('DeepSeek');
  expect(stored.selected).toBe(stored.providers[0]?.id);
});

test('existing three-table Chinook database upgrades in place to all eleven tables', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/store/localhost:8989/project/a-different-project/chat');
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('chinook', 1);
      request.onupgradeneeded = () => {
        for (const name of ['Customer', 'Invoice', 'Track', '_meta']) {
          request.result.createObjectStore(name, { keyPath: 'path' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['Customer', '_meta'], 'readwrite');
      transaction.objectStore('Customer').put({ path: 'legacy-preserved', data: { CustomerId: 99999 } });
      transaction.objectStore('_meta').put({
        path: 'main._meta/chinook-version',
        data: { version: 'chinook-sqlite-6334395117e2478a2712e083be614721341c26c9' },
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await page.goto('/store/localhost:8989/project/datatug-demo-project/chat');
  await expect(page.locator('ion-footer').getByLabel('AI provider')).toBeVisible();
  await expect(page.getByText('Loading local Chinook data…')).toBeHidden({ timeout: 45_000 });
  const upgraded = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('chinook');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(['Customer', 'PlaylistTrack', '_meta'], 'readonly');
    const get = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const [legacy, playlistTracks, marker] = await Promise.all([
      get(transaction.objectStore('Customer').get('legacy-preserved')),
      get(transaction.objectStore('PlaylistTrack').count()),
      get(transaction.objectStore('_meta').get('main._meta/chinook-version')),
    ]);
    const result = { version: database.version, stores: Array.from(database.objectStoreNames), legacy, playlistTracks, marker };
    database.close();
    return result;
  });
  expect(upgraded.version).toBe(2);
  expect(upgraded.stores).toHaveLength(12);
  expect(upgraded.legacy).toEqual({ path: 'legacy-preserved', data: { CustomerId: 99999 } });
  expect(upgraded.playlistTracks).toBe(8715);
  expect(upgraded.marker.data.version).toBe('chinook-sqlite-6334395117e2478a2712e083be614721341c26c9-all-11-v2');
});

for (const provider of [
  { name: 'OpenAI', protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', url: 'https://api.openai.com/v1/chat/completions' },
  { name: 'Anthropic', protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-4-5-20251001', url: 'https://api.anthropic.com/v1/messages' },
] as const) {
  test(`${provider.name} sends Chat directly from the browser`, async ({ page }) => {
    test.setTimeout(60_000);
    let providerRequests = 0;
    let localInterpretRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/datatug/chat/interpret')) localInterpretRequests += 1;
    });
    await page.addInitScript((selected) => {
      localStorage.setItem('datatug.chat.providers.v1', JSON.stringify([{ ...selected, id: 'selected-provider', apiKey: 'test-key-not-a-secret' }]));
      localStorage.setItem('datatug.chat.selected-provider.v1', 'selected-provider');
    }, provider);
    await page.route(provider.url, async (route) => {
      providerRequests += 1;
      const headers = route.request().headers();
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body['model']).toBe(provider.model);
      if (provider.protocol === 'anthropic-messages') {
        expect(headers['x-api-key']).toBe('test-key-not-a-secret');
        expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
        expect(body['system']).toContain('main.Artist(ArtistId, Name)');
      } else {
        expect(headers['authorization']).toBe('Bearer test-key-not-a-secret');
      }
      const content = JSON.stringify({ dtql: { from: { name: 'Artist' }, orderBy: [{ field: 'ArtistId' }], limit: 10 } });
      await route.fulfill({ json: provider.protocol === 'anthropic-messages'
        ? { content: [{ type: 'text', text: content }], usage: { input_tokens: 20, output_tokens: 8 } }
        : { choices: [{ message: { content } }], usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 } } });
    });
    await page.goto('/store/localhost:8989/project/datatug-demo-project/chat');
    await expect(page.locator('ion-footer').getByLabel('AI provider')).toBeVisible();
    await expect(page.getByText('Loading local Chinook data…')).toBeHidden({ timeout: 45_000 });
    await page.getByLabel('Ask about Chinook data').fill('Show 10 artists');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('tab', { name: 'Rows 10' })).toBeVisible();
    await expect(cell(page.locator('ag-grid-angular'), 0, 'ArtistId')).toHaveText('1');
    expect(providerRequests).toBe(1);
    expect(localInterpretRequests).toBe(0);
  });
}
