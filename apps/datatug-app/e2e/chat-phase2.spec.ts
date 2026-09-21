import { expect, test } from '@playwright/test';

test('Chat restores isolated DALgo sessions and immutable result snapshots', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  await page.addInitScript(() => {
    localStorage.setItem('datatug.chat.providers.v1', JSON.stringify([{
      id: 'test-provider', name: 'DeepSeek', protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'test-key',
    }]));
    localStorage.setItem('datatug.chat.selected-provider.v1', 'test-provider');
  });
  let providerCalls = 0;
  let continuationHasMetadata = false;
  await page.route('https://api.deepseek.com/chat/completions', async (route) => {
    providerCalls += 1;
    const body = route.request().postDataJSON() as { messages: { content: string }[] };
    const question = body.messages.at(-1)?.content;
    const previous = body.messages[0]?.content || '';
    if (question === 'Show 3 albums') {
      continuationHasMetadata = previous.includes('RecordSet:') && previous.includes('"Artist"');
      expect(previous).not.toContain('Modified after snapshot');
    }
    const table = question === 'Show 5 genres' ? 'Genre' : question === 'Show 3 albums' ? 'Album' : 'Artist';
    const limit = table === 'Genre' ? 5 : table === 'Album' ? 3 : 10;
    const field = `${table}Id`;
    await route.fulfill({ json: {
      choices: [{ message: { content: JSON.stringify({ dtql: { from: { schema: 'main', name: table }, orderBy: [{ field }], limit } }) } }],
      usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    } });
  });

  await page.goto('/store/localhost:8989/project/datatug-demo-project/chat');
  await expect(page.getByText('Restoring chat session…')).toBeHidden();
  await expect(page.getByText('Loading local Chinook data…')).toBeHidden({ timeout: 45_000 });
  const ask = async (question: string, rows: number) => {
    await page.getByLabel('Ask about Chinook data').fill(question);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('tab', { name: `Rows ${rows}` }).last()).toBeVisible();
  };
  await ask('Show 10 artists', 10);
  const firstName = await page.locator('.turn').first().locator('.ag-row[row-index="0"] .ag-cell[col-id="Name"]').textContent();
  expect(firstName).toBeTruthy();

  const databaseCounts = async () => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('datatug-chat-sessions');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = ['ChatSessions', 'ChatTurns', 'ChatQueries', 'ChatRecordSets'];
    const tx = database.transaction(stores, 'readonly');
    const counts = await Promise.all(stores.map((name) => new Promise<number>((resolve, reject) => {
      const request = tx.objectStore(name).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    })));
    database.close();
    return Object.fromEntries(stores.map((name, index) => [name, counts[index]]));
  });
  expect(await databaseCounts()).toEqual({ ChatSessions: 1, ChatTurns: 1, ChatQueries: 1, ChatRecordSets: 1 });

  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('chinook');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('Artist', 'readwrite');
      const store = tx.objectStore('Artist');
      const request = store.get('main.Artist/1');
      request.onsuccess = () => store.put({ ...request.result, data: { ...request.result.data, Name: 'Modified after snapshot' } });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  });
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Rows 10' })).toBeVisible();
  await expect(page.locator('.turn').first().locator('.ag-row[row-index="0"] .ag-cell[col-id="Name"]')).toHaveText(firstName || '');
  expect(providerCalls).toBe(1);

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.locator('.turn')).toHaveCount(0);
  await ask('Show 5 genres', 5);
  expect(await databaseCounts()).toEqual({ ChatSessions: 2, ChatTurns: 2, ChatQueries: 2, ChatRecordSets: 2 });
  await page.locator('.session-toolbar ion-select').click({ timeout: 5000 });
  await page.getByRole('radio', { name: 'Show 10 artists' }).click();
  await expect(page.locator('.question-bubble')).toHaveText('Show 10 artists');
  await ask('Show 3 albums', 3);
  expect(continuationHasMetadata).toBe(true);
  expect(providerCalls).toBe(3);

  await page.getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('Session name').fill('Artist research');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('button', { name: /Chat session, Artist research/ })).toBeVisible();
  await page.reload();
  await expect(page.locator('.question-bubble')).toHaveCount(2);
  expect(providerCalls).toBe(3);

  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(page.locator('.turn')).toHaveCount(0);
  expect(await databaseCounts()).toEqual({ ChatSessions: 2, ChatTurns: 1, ChatQueries: 1, ChatRecordSets: 1 });
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('button', { name: /Chat session, Show 5 genres/ })).toBeVisible();
  await expect(page.locator('.question-bubble')).toHaveText('Show 5 genres');
  expect(await databaseCounts()).toEqual({ ChatSessions: 1, ChatTurns: 1, ChatQueries: 1, ChatRecordSets: 1 });
});

test('Chat reports a missing persisted RecordSet without rerunning its query', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    localStorage.setItem('datatug.chat.providers.v1', JSON.stringify([{
      id: 'test-provider', name: 'DeepSeek', protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'test-key',
    }]));
    localStorage.setItem('datatug.chat.selected-provider.v1', 'test-provider');
  });
  let providerCalls = 0;
  await page.route('https://api.deepseek.com/chat/completions', async (route) => {
    providerCalls += 1;
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({
      dtql: { from: { schema: 'main', name: 'Artist' }, limit: 1 },
    }) } }] } });
  });
  await page.goto('/store/localhost:8989/project/datatug-demo-project/chat');
  await expect(page.getByText('Loading local Chinook data…')).toBeHidden({ timeout: 45_000 });
  await page.getByLabel('Ask about Chinook data').fill('Show one artist');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('tab', { name: 'Rows 1' })).toBeVisible();
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('datatug-chat-sessions');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('ChatRecordSets', 'readwrite');
      const store = tx.objectStore('ChatRecordSets');
      const request = store.getAllKeys();
      request.onsuccess = () => store.delete(request.result[0]);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  });
  await page.reload();
  await expect(page.getByText('This chat session has missing saved messages or result snapshots.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry loading chats' })).toBeVisible();
  expect(providerCalls).toBe(1);
});
