import { expect, test } from '@playwright/test';

test('Bookmarks migrate, preserve scoped snapshots, and support cross-session follow-ups', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(12_000);
  let followupContext = '';
  let selectionBookmarkId = '';
  await page.addInitScript(() => {
    localStorage.setItem('datatug.chat.providers.v1', JSON.stringify([{
      id: 'fake', name: 'Fake', protocol: 'openai-chat', baseUrl: 'https://api.deepseek.com', model: 'fake', apiKey: 'fake-key',
    }]));
    localStorage.setItem('datatug.chat.selected-provider.v1', 'fake');
  });
  await page.goto('/favicon.ico');
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('datatug-chat-sessions', 1);
      request.onupgradeneeded = () => ['ChatSessions', 'ChatTurns', 'ChatQueries', 'ChatRecordSets'].forEach((name) => request.result.createObjectStore(name, { keyPath: 'path' }));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('ChatSessions', 'readwrite');
      tx.objectStore('ChatSessions').put({ path: 'legacy-session', data: { scope: 'legacy' } });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    database.close();
  });
  await page.route('https://api.deepseek.com/chat/completions', async (route) => {
    const request = route.request().postDataJSON() as { messages: { content: string }[] };
    const question = request.messages.at(-1)?.content;
    let dtql: Record<string, unknown>;
    if (question === 'Show 10 customers') {
      dtql = { from: { schema: 'main', name: 'Customer' }, orderBy: [{ field: 'CustomerId' }], limit: 10 };
    } else if (question === 'Invoices for selected bookmark cells') {
      followupContext = request.messages[0].content;
      expect(followupContext).toContain(selectionBookmarkId);
      dtql = { from: { schema: 'main', name: 'Invoice' }, where: {
        op: 'In', left: { field: 'CustomerId' }, right: { bookmark: { id: selectionBookmarkId, field: 'CustomerId' } },
      }, limit: 100 };
    } else if (question === 'Invoices for bookmarked customers') {
      followupContext = request.messages[0].content;
      const id = followupContext.match(/Attached Bookmark: Show 10 customers; id: ([0-9a-f-]{36})/)?.[1];
      expect(id).toBeTruthy();
      dtql = { from: { schema: 'main', name: 'Invoice' }, where: {
        op: 'In', left: { field: 'CustomerId' }, right: { bookmark: { id, field: 'CustomerId' } },
      }, limit: 100 };
    } else throw new Error(`Unexpected question: ${question}`);
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ dtql }) } }] } });
  });
  await page.goto('/store/localhost:8989/project/datatug-demo-project/chat');
  await expect(page.getByText('Loading local Chinook data…')).toBeHidden({ timeout: 45_000 });
  await page.getByLabel('Ask about Chinook data').fill('Show 10 customers');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('tab', { name: 'Rows 10' })).toBeVisible();
  await page.getByRole('button', { name: 'Bookmark result' }).click();
  const workspace = page.getByLabel('Chat workspace');
  await expect(workspace.getByRole('tab', { name: /Bookmarks/ })).toHaveAttribute('aria-selected', 'true');
  await expect(workspace.getByText('Show 10 customers', { exact: true })).toBeVisible();
  await workspace.getByRole('button', { name: 'Attach' }).click();
  await expect(page.getByLabel('Attached context')).toContainText('Show 10 customers');
  await workspace.getByRole('button', { name: 'Dock' }).click();
  await expect(workspace.locator('.dock-item')).toHaveCount(1);
  await page.reload();
  await expect(page.getByText('Loading local Chinook data…')).toBeHidden({ timeout: 45_000 });
  await expect(page.getByLabel('Chat workspace').locator('.dock-item ag-grid-angular')).toBeVisible();
  await workspace.locator('ion-segment-button[value="bookmarks"]').click();
  await workspace.getByRole('button', { name: 'Open' }).click();
  await expect(workspace.locator('.bookmark-open ag-grid-angular')).toBeVisible();
  const upgraded = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('datatug-chat-sessions'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const tx = database.transaction(['ChatSessions', 'ChatBookmarks'], 'readonly');
    const legacy = await new Promise<unknown>((resolve, reject) => { const request = tx.objectStore('ChatSessions').get('legacy-session'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const result = { version: database.version, bookmarkStore: database.objectStoreNames.contains('ChatBookmarks'), legacy };
    database.close(); return result;
  });
  expect(upgraded).toEqual({ version: 2, bookmarkStore: true, legacy: { path: 'legacy-session', data: { scope: 'legacy' } } });

  const recordBookmark = workspace.locator('.bookmark-item').filter({ hasText: 'Show 10 customers' });
  page.once('dialog', (dialog) => dialog.accept(' ROCK '));
  await recordBookmark.getByRole('button', { name: 'Tag' }).click();
  page.once('dialog', (dialog) => dialog.accept(' LIVE '));
  await recordBookmark.getByRole('button', { name: 'Tag' }).click();
  await workspace.getByLabel('Filter bookmark tags').fill('rock');
  await expect(workspace.locator('.bookmark-item')).toHaveCount(1);
  await workspace.getByLabel('Filter bookmark tags').fill('ROCK,live');
  await expect(workspace.locator('.bookmark-item')).toHaveCount(1);
  await workspace.getByLabel('Search bookmarks').fill('SHOW 10');
  await expect(workspace.locator('.bookmark-item')).toHaveCount(1);
  await workspace.getByLabel('Filter bookmark tags').fill('jazz');
  await expect(workspace.locator('.bookmark-item')).toHaveCount(0);
  await workspace.getByLabel('Filter bookmark tags').fill('');
  await workspace.getByLabel('Search bookmarks').fill('');

  await page.locator('.turn').first().locator('.ag-row[row-index="0"] .ag-cell[col-id="CustomerId"]').click();
  await workspace.getByRole('button', { name: 'Bookmark selection' }).click();
  await workspace.locator('ion-segment-button[value="selected"]').click();
  await workspace.getByRole('button', { name: 'Bookmark view' }).click();
  await expect(workspace.locator('.bookmark-item')).toHaveCount(3);
  const masked = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('datatug-chat-sessions'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const bookmarks = await new Promise<{ data: { target: string; recordSet: { rows: Record<string, unknown>[] } } }[]>((resolve, reject) => {
      const request = database.transaction('ChatBookmarks', 'readonly').objectStore('ChatBookmarks').getAll();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    database.close();
    return bookmarks.map((item) => item.data).find((item) => item.target === 'selection')?.recordSet.rows;
  });
  expect(masked?.[0]).toEqual({ CustomerId: 1 });
  expect(masked?.[1]).toEqual({});

  // Persist a nonuniform two-range selection, as produced by range-aware workspace clients.
  selectionBookmarkId = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('datatug-chat-sessions'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const bookmark = await new Promise<{ path: string; data: { id: string; target: string; recordSet: { columns: string[]; rows: Record<string, unknown>[] }; selection: { rows: number[]; columns: string[]; ranges: { rowIndices: number[]; columns: string[] }[] } } }>((resolve, reject) => {
      const request = database.transaction('ChatBookmarks', 'readonly').objectStore('ChatBookmarks').getAll();
      request.onsuccess = () => resolve(request.result.find((item: { data: { target: string } }) => item.data.target === 'selection'));
      request.onerror = () => reject(request.error);
    });
    bookmark.data.recordSet.columns = ['CustomerId', 'FirstName'];
    bookmark.data.recordSet.rows[1] = { FirstName: 'Selected name' };
    bookmark.data.selection.rows = [0, 1];
    bookmark.data.selection.columns = ['CustomerId', 'FirstName'];
    bookmark.data.selection.ranges = [
      { rowIndices: [0], columns: ['CustomerId'] },
      { rowIndices: [1], columns: ['FirstName'] },
    ];
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('ChatBookmarks', 'readwrite');
      tx.objectStore('ChatBookmarks').put(bookmark);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    database.close();
    return bookmark.data.id;
  });

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await workspace.locator('ion-segment-button[value="bookmarks"]').click();
  const selectedBookmark = workspace.locator('.bookmark-item').filter({ hasText: 'selection ·' });
  await selectedBookmark.getByRole('button', { name: 'Attach' }).click();
  await page.getByLabel('Ask about Chinook data').fill('Invoices for selected bookmark cells');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.turn').last().getByRole('tab', { name: /Rows [1-9]/ })).toBeVisible();
  await workspace.locator('ion-segment-button[value="bookmarks"]').click();
  await selectedBookmark.getByRole('button', { name: 'Detach' }).click();
  await workspace.locator('.bookmark-item').filter({ hasText: 'Show 10 customers' }).getByRole('button', { name: 'Attach' }).click();
  await page.getByLabel('Ask about Chinook data').fill('Invoices for bookmarked customers');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.turn').last().getByRole('tab', { name: /Rows [1-9]/ })).toBeVisible();
  expect(followupContext).toContain('columns: CustomerId');
  expect(followupContext).not.toContain('Luís');

  await page.locator('.session-toolbar ion-select').click();
  await page.getByRole('radio', { name: 'Show 10 customers' }).click();
  await page.locator('.session-toolbar').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await workspace.locator('ion-segment-button[value="bookmarks"]').click();
  await expect(workspace.locator('.bookmark-item')).toHaveCount(3);
  const retained = workspace.locator('.bookmark-item').filter({ hasText: 'Show 10 customers' });
  page.once('dialog', (dialog) => dialog.accept());
  await retained.getByRole('button', { name: 'Delete' }).click();
  await expect(workspace.locator('.bookmark-item')).toHaveCount(3);
  await retained.getByRole('button', { name: 'Detach' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await retained.getByRole('button', { name: 'Delete' }).click();
  await expect(workspace.locator('.bookmark-item')).toHaveCount(2);
  await page.goto('/store/localhost:8989/project/another-project/chat');
  await workspace.locator('ion-segment-button[value="bookmarks"]').click();
  await expect(workspace.locator('.bookmark-item')).toHaveCount(0);
  await page.goto('/store/localhost:8989/project/datatug-demo-project/chat');
  await workspace.locator('ion-segment-button[value="bookmarks"]').click();
  await expect(workspace.locator('.bookmark-item')).toHaveCount(2);
});
