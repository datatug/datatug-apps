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
    if (question === 'Show the customers associated with those orders') {
      continuationHasMetadata = previous.includes('RecordSet:') && previous.includes('"Invoice"');
      expect(previous).not.toContain('99999');
      const recordSetId = previous.match(/RecordSet: ([0-9a-f-]{36})/)?.[1];
      expect(recordSetId).toBeTruthy();
      await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ dtql: {
        from: { schema: 'main', name: 'Customer' },
        where: { op: 'In', left: { field: 'CustomerId' }, right: { recordSet: { id: recordSetId, field: 'CustomerId' } } },
        limit: 100,
      } }) } }] } });
      return;
    }
    const table = question === 'Show 5 genres' ? 'Genre' : 'Invoice';
    const limit = table === 'Genre' ? 5 : 20;
    const field = `${table}Id`;
    await route.fulfill({ json: {
      choices: [{ message: { content: JSON.stringify({ dtql: { from: { schema: 'main', name: table }, orderBy: [{ field, desc: table === 'Invoice' }], limit } }) } }],
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
  await ask('Show last 20 invoices', 20);
  const firstCustomerId = await page.locator('.turn').first().locator('.ag-row[row-index="0"] .ag-cell[col-id="CustomerId"]').textContent();
  expect(firstCustomerId).toBeTruthy();

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
      const tx = database.transaction('Invoice', 'readwrite');
      const store = tx.objectStore('Invoice');
      const request = store.get('main.Invoice/412');
      request.onsuccess = () => store.put({ ...request.result, data: { ...request.result.data, CustomerId: 99999 } });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  });
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Rows 20' })).toBeVisible();
  await expect(page.locator('.turn').first().locator('.ag-row[row-index="0"] .ag-cell[col-id="CustomerId"]')).toHaveText(firstCustomerId || '');
  expect(providerCalls).toBe(1);

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.locator('.turn')).toHaveCount(0);
  await ask('Show 5 genres', 5);
  expect(await databaseCounts()).toEqual({ ChatSessions: 2, ChatTurns: 2, ChatQueries: 2, ChatRecordSets: 2 });
  await page.locator('.session-toolbar ion-select').click({ timeout: 5000 });
  await page.getByRole('radio', { name: 'Show last 20 invoices' }).click();
  await expect(page.locator('.question-bubble')).toHaveText('Show last 20 invoices');
  await page.getByLabel('Ask about Chinook data').fill('Show the customers associated with those orders');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.turn').last().getByRole('tab', { name: /Rows \d+/ })).toBeVisible();
  await expect.poll(async () => (await databaseCounts())['ChatQueries']).toBe(3);
  await page.reload();
  await expect(page.locator('.turn').last().getByRole('tab', { name: /Rows \d+/ })).toBeVisible();
  const queries = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('datatug-chat-sessions');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const queries = await new Promise<{ data: { dtql: string; parentRecordSetId?: string } }[]>((resolve, reject) => {
      const request = database.transaction('ChatQueries', 'readonly').objectStore('ChatQueries').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return queries.map((query) => query.data);
  });
  const related = queries.find((query) => query.parentRecordSetId);
  const bound = related ? { parentRecordSetId: related.parentRecordSetId, dtql: JSON.parse(related.dtql) as { where: { right: { values: number[] } } } } : null;
  expect(queries).toEqual(expect.arrayContaining([expect.objectContaining({ parentRecordSetId: expect.any(String) })]));
  expect(bound?.parentRecordSetId).toBeTruthy();
  expect(bound?.dtql.where.right.values).toContain(Number(firstCustomerId));
  expect(bound?.dtql.where.right.values).not.toContain(99999);
  expect(continuationHasMetadata).toBe(true);
  expect(providerCalls).toBe(3);

  await page.getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('Session name').fill('Invoice research');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('button', { name: /Chat session, Invoice research/ })).toBeVisible();
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
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('This chat session has missing saved messages or result snapshots.')).toBeHidden();
  await expect(page.getByRole('button', { name: /Chat session, New chat/ })).toBeVisible();
});
