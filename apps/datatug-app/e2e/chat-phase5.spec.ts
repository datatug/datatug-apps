import { expect, test } from '@playwright/test';

test('FK JOIN candidates execute against real Chinook, chain, persist, and accept the agent action', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  await page.addInitScript(() => {
    localStorage.setItem('datatug.chat.providers.v1', JSON.stringify([{
      id: 'test-provider', name: 'DeepSeek', protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'test-key',
    }]));
    localStorage.setItem('datatug.chat.selected-provider.v1', 'test-provider');
  });
  let providerCalls = 0;
  let joinedBookmarkId = '';
  await page.route('https://api.deepseek.com/chat/completions', async (route) => {
    providerCalls++;
    const request = route.request().postDataJSON() as { messages: { content: string }[] };
    const question = request.messages.at(-1)?.content;
    let action: Record<string, unknown>;
    if (question === 'Show five invoices') {
      action = { dtql: { from: { schema: 'main', name: 'Invoice' }, orderBy: [{ field: 'InvoiceId' }], limit: 5 } };
    } else if (question === 'Show five employees') {
      action = { dtql: { from: { schema: 'main', name: 'Employee' }, orderBy: [{ field: 'EmployeeId' }], limit: 5 } };
    } else if (question === 'Invoices for joined bookmark customers') {
      expect(request.messages[0].content).toContain(joinedBookmarkId);
      action = { dtql: { from: { schema: 'main', name: 'Invoice' }, where: {
        op: 'In', left: { field: 'CustomerId' }, right: { bookmark: { id: joinedBookmarkId, field: 'Customer.CustomerId' } },
      }, limit: 100 } };
    } else if (question === 'Join Customer using CustomerId') {
      const system = request.messages[0].content;
      const recordSetId = system.match(/RecordSet ([0-9a-f-]{36}) \(latest\)/)?.[1];
      const candidate = system.match(/\{"candidateId":"((?:[^"\\]|\\.)*)","source":"Invoice","target":"Customer"/)?.[1];
      expect(recordSetId).toBeTruthy();
      expect(candidate).toBeTruthy();
      action = { joinCandidate: { recordSetId, candidateId: JSON.parse(`"${candidate}"`) } };
    } else if (question === 'Join with stale FK metadata') {
      const system = request.messages[0].content;
      const recordSetId = system.match(/RecordSet ([0-9a-f-]{36}) \(latest\)/)?.[1];
      const encoded = system.match(/"candidateId":"((?:[^"\\]|\\.)*)"/)?.[1];
      expect(recordSetId).toBeTruthy();
      expect(encoded).toBeTruthy();
      const identity = JSON.parse(JSON.parse(`"${encoded}"`)) as unknown[];
      identity[0] = 'sha256:previous-schema';
      action = { joinCandidate: { recordSetId, candidateId: JSON.stringify(identity) } };
    } else {
      throw new Error(`Unexpected question: ${question}`);
    }
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(action) } }] } });
  });

  await page.goto('/store/localhost:8989/project/datatug-demo-project/chat');
  await expect(page.getByText('Loading local Chinook data…')).toBeHidden({ timeout: 45_000 });
  await page.getByLabel('Ask about Chinook data').fill('Show five invoices');
  await page.getByRole('button', { name: 'Send' }).click();
  const first = page.locator('.turn').first();
  await expect(first.getByRole('tab', { name: 'Rows 5' })).toBeVisible();
  await expect(first.locator('.join-candidates')).toContainText('Customer');
  await first.locator('.join-candidates').focus();
  await first.locator('.join-candidates').press('Enter');
  await expect(page.getByLabel('Chat workspace').locator('.join-details')).toContainText('CustomerId');
  await first.locator('.join-candidates').press('ArrowRight');
  await expect(first.locator('.join-candidates ion-button[fill="solid"]')).toContainText('InvoiceLine');
  await first.locator('.join-candidates').press('ArrowLeft');
  await expect(first.locator('.join-candidates ion-button[fill="solid"]')).toContainText('Customer');
  await first.locator('.join-candidates').press('Escape');
  await expect(first.locator('.chat-grid .ag-cell:focus, .chat-grid .ag-header-cell:focus')).toHaveCount(1);
  await first.locator('.join-candidates').focus();
  await first.locator('.join-candidates').press('Space');
  const second = page.locator('.turn').nth(1);
  await expect(second.getByRole('tab', { name: 'Rows 5' })).toBeVisible();
  await expect(second.locator('.join-candidates')).toContainText('Employee');
  await second.locator('.join-candidates').focus();
  await second.locator('.join-candidates').press('ArrowDown');
  await expect(second.locator('.join-candidates ion-button[fill="solid"]')).toContainText('Employee');
  await second.locator('.join-candidates').press('ArrowUp');
  await expect(second.locator('.join-candidates ion-button[fill="solid"]')).not.toContainText('Employee');
  await second.locator('.join-candidates').getByRole('button', { name: /Employee/ }).first().click();
  await second.locator('.join-candidates').getByRole('button', { name: 'Join Employee' }).click();
  const third = page.locator('.turn').nth(2);
  await expect(third.getByRole('tab', { name: 'Rows 5' })).toBeVisible();
  await expect(third.locator('.join-candidates')).toContainText('Employee');

  const snapshot = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('datatug-chat-sessions');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<{ data: { id: string; parentRecordSetId?: string; join?: { foreignKeyId: string; manifestVersion: string }; columns: string[]; rows: Record<string, unknown>[] } }[]>((resolve, reject) => {
      const request = database.transaction('ChatRecordSets', 'readonly').objectStore('ChatRecordSets').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return rows.map((row) => row.data);
  });
  expect(snapshot).toHaveLength(3);
  expect(snapshot.filter((row) => row.join)).toHaveLength(2);
  expect(snapshot.find((row) => row.columns.includes('Customer.FirstName'))?.parentRecordSetId).toBeTruthy();
  expect(snapshot.find((row) => row.columns.includes('Employee.FirstName'))?.join?.manifestVersion).toMatch(/^sha256:/);
  const withCustomer = snapshot.find((row) => row.columns.includes('Customer.FirstName'));
  expect(withCustomer?.rows).toHaveLength(5);
  expect(withCustomer?.rows.every((row) => row['Customer.CustomerId'] === row['CustomerId'])).toBe(true);
  const withEmployee = snapshot.find((row) => row.columns.includes('Employee.FirstName'));
  expect(withEmployee?.rows.every((row) => row['Employee.EmployeeId'] === row['Customer.SupportRepId'])).toBe(true);
  const joinedRecordSetId = withEmployee?.id || '';
  expect(joinedRecordSetId).toBeTruthy();
  await page.reload();
  await expect(third.getByRole('tab', { name: 'Rows 5' })).toBeVisible();
  await expect(third.locator('.join-candidates')).toContainText('Related tables');
  expect(providerCalls).toBe(1);
  await page.getByLabel('Ask about Chinook data').fill('Join with stale FK metadata');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.turn').last()).toContainText('foreign-key metadata is no longer available');
  await expect(third.getByRole('tab', { name: 'Rows 5' })).toBeVisible();
  const restoredJoin = await page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('datatug-chat-sessions'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const record = await new Promise<{ data: { rows: unknown[]; join?: { manifestVersion: string } } }>((resolve, reject) => {
      const request = database.transaction('ChatRecordSets', 'readonly').objectStore('ChatRecordSets').get(id);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    database.close();
    return record.data;
  }, joinedRecordSetId);
  expect(restoredJoin.rows).toHaveLength(5);
  expect(restoredJoin.join?.manifestVersion).toBe(withEmployee?.join?.manifestVersion);

  await third.getByRole('button', { name: 'Bookmark result' }).click();
  const workspace = page.getByLabel('Chat workspace');
  await expect(workspace.getByRole('tab', { name: /Bookmarks/ })).toHaveAttribute('aria-selected', 'true');
  const joinedBookmark = workspace.locator('.bookmark-item').filter({ hasText: 'to Employee via' });
  await joinedBookmark.getByRole('button', { name: 'Attach' }).click();
  page.once('dialog', (dialog) => dialog.accept('joined'));
  await joinedBookmark.getByRole('button', { name: 'Tag' }).click();
  joinedBookmarkId = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('datatug-chat-sessions'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const bookmarks = await new Promise<{ data: { id: string; recordSet: { columns: string[] } } }[]>((resolve, reject) => {
      const request = database.transaction('ChatBookmarks', 'readonly').objectStore('ChatBookmarks').getAll();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    database.close();
    return bookmarks.find((bookmark) => bookmark.data.recordSet.columns.includes('Employee.FirstName'))?.data.id || '';
  });
  expect(joinedBookmarkId).toBeTruthy();
  await page.reload();
  await workspace.locator('ion-segment-button[value="bookmarks"]').click();
  await expect(joinedBookmark).toContainText('joined');
  await joinedBookmark.getByRole('button', { name: 'Open' }).click();
  await expect(workspace.locator('.bookmark-open ag-grid-angular')).toBeVisible();

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await workspace.locator('ion-segment-button[value="bookmarks"]').click();
  await joinedBookmark.getByRole('button', { name: 'Attach' }).click();
  await page.getByLabel('Ask about Chinook data').fill('Invoices for joined bookmark customers');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.turn').last().getByRole('tab', { name: /Rows [1-9]/ })).toBeVisible();

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByLabel('Ask about Chinook data').fill('Show five invoices');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.turn').first().getByRole('tab', { name: 'Rows 5' })).toBeVisible();
  await page.getByLabel('Ask about Chinook data').fill('Join Customer using CustomerId');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.turn').last().locator('.join-candidates')).toContainText('Employee');

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByLabel('Ask about Chinook data').fill('Show five employees');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.turn').first().getByRole('tab', { name: 'Rows 5' })).toBeVisible();
  const callsBeforeAmbiguity = providerCalls;
  await page.getByLabel('Ask about Chinook data').fill('Join Employee');
  await page.getByRole('button', { name: 'Send' }).click();
  const choices = page.getByLabel('Choose a relationship');
  await expect(choices.getByRole('button')).toHaveCount(2);
  expect(providerCalls).toBe(callsBeforeAmbiguity);
  await page.reload();
  await expect(choices.getByRole('button')).toHaveCount(2);
  await choices.getByRole('button', { name: /ReportsTo/ }).click();
  await expect(page.locator('.turn').last().getByRole('tab', { name: /Rows [1-9]/ })).toBeVisible();
});
