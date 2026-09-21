import { expect, test } from '@playwright/test';

test('Chat workspace restores explicit context, selection, dock and a selected follow-up', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(12_000);
  await page.addInitScript(() => {
    localStorage.setItem('datatug.chat.providers.v1', JSON.stringify([{
      id: 'test-provider', name: 'DeepSeek', protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'test-key',
    }]));
    localStorage.setItem('datatug.chat.selected-provider.v1', 'test-provider');
  });

  let attachedTableSeen = false;
  let selectedContextSeen = false;
  let selectedIdForCrossSession = '';
  await page.route('https://api.deepseek.com/chat/completions', async (route) => {
    const body = route.request().postDataJSON() as { messages: { content: string }[] };
    const system = body.messages[0]?.content || '';
    const question = body.messages.at(-1)?.content;
    let action: Record<string, unknown>;
    if (question === 'Show 10 customers') {
      attachedTableSeen = system.includes('Attached table: Customer; id: main.Customer');
      action = { dtql: { from: { schema: 'main', name: 'Customer' }, orderBy: [{ field: 'CustomerId' }], limit: 10 } };
    } else if (question === 'Select first 3 customers') {
      const recordSetId = system.match(/RecordSet: ([0-9a-f-]{36})/)?.[1];
      expect(recordSetId).toBeTruthy();
      action = { workspaceAction: { kind: 'select', recordSetId, rows: [0, 1, 2], title: 'First 3 customers' } };
    } else if (question === 'Dock them') {
      expect(system).toContain('Current Selection: First 3 customers');
      action = { workspaceAction: { kind: 'dockCurrent' } };
    } else if (question === 'Undock that') {
      const dockId = system.match(/Dock: First 3 customers; dockId: ([0-9a-f-]{36})/)?.[1];
      expect(dockId).toBeTruthy();
      action = { workspaceAction: { kind: 'undock', dockId } };
    } else if (question === 'Try current selection without attaching') {
      const selectionId = system.match(/Current Selection: .*?; id: ([0-9a-f-]{36})/)?.[1];
      expect(selectionId).toBeTruthy();
      action = { dtql: {
        from: { schema: 'main', name: 'Invoice' },
        where: { op: 'In', left: { field: 'CustomerId' }, right: { selection: { id: selectionId, field: 'CustomerId' } } },
        limit: 100,
      } };
    } else if (question === 'Show their invoices') {
      const selectionId = system.match(/Attached Selection: .*?; id: ([0-9a-f-]{36})/)?.[1];
      selectedContextSeen = !!selectionId && !system.includes('CustomerId=1');
      expect(selectionId).toBeTruthy();
      selectedIdForCrossSession = selectionId as string;
      action = { dtql: {
        from: { schema: 'main', name: 'Invoice' },
        where: { op: 'In', left: { field: 'CustomerId' }, right: { selection: { id: selectionId, field: 'CustomerId' } } },
        limit: 100,
      } };
    } else if (question === 'Use an old selection') {
      action = { dtql: {
        from: { schema: 'main', name: 'Invoice' },
        where: { op: 'In', left: { field: 'CustomerId' }, right: { selection: { id: selectedIdForCrossSession, field: 'CustomerId' } } },
        limit: 100,
      } };
    } else {
      throw new Error(`Unexpected question: ${question}`);
    }
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(action) } }] } });
  });

  await page.goto('/store/localhost:8989/project/datatug-demo-project/chat');
  await expect(page.getByText('Loading local Chinook data…')).toBeHidden({ timeout: 45_000 });
  const workspace = page.getByLabel('Chat workspace');
  await expect(workspace.getByText('Chinook', { exact: true })).toBeVisible();
  await expect(workspace.locator('.workspace-table')).toHaveCount(11);
  await workspace.locator('.workspace-table').filter({ hasText: 'Customer' }).getByRole('button', { name: 'Attach' }).click();
  await expect(page.getByLabel('Attached context')).toContainText('Customer');

  await page.getByLabel('Ask about Chinook data').fill('Show 10 customers');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('tab', { name: 'Rows 10' })).toBeVisible();
  expect(attachedTableSeen).toBe(true);

  await page.getByLabel('Ask about Chinook data').fill('Select first 3 customers');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.turn')).toHaveCount(2);
  await expect(page.locator('.turn').last()).toContainText('Selected 3 rows.');
  await expect(workspace.locator('.selected-fields')).toHaveCount(0);
  await page.getByLabel('Ask about Chinook data').fill('Dock them');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.turn')).toHaveCount(3);
  await expect(workspace.locator('.dock-item')).toHaveCount(1);
  const recordSetCount = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('datatug-chat-sessions');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = await new Promise<number>((resolve, reject) => {
      const request = database.transaction('ChatRecordSets', 'readonly').objectStore('ChatRecordSets').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return count;
  });
  expect(recordSetCount).toBe(1);
  await page.getByLabel('Ask about Chinook data').fill('Undock that');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.turn')).toHaveCount(4);
  await expect(workspace.locator('.dock-item')).toHaveCount(0);
  await workspace.locator('ion-segment-button[value="selected"]').click();
  await workspace.getByRole('button', { name: 'Dock', exact: true }).click();
  await expect(workspace.locator('.dock-item')).toHaveCount(1);
  await workspace.getByRole('button', { name: 'Undock' }).click();
  await expect(workspace.locator('.dock-item')).toHaveCount(0);
  const checkboxes = page.locator('.turn').first().locator('.chat-grid .ag-row .ag-selection-checkbox');
  await checkboxes.nth(0).click();
  await expect(workspace.locator('h3')).toHaveText('1 selected rows');
  await checkboxes.nth(1).click();
  await expect(workspace.locator('h3')).toHaveText('2 selected rows');
  await checkboxes.nth(0).click();
  await checkboxes.nth(1).click();
  await expect(workspace.getByText('Select rows or a cell in a result grid to inspect them here.')).toBeVisible();
  await expect(workspace.getByText('Saved selections')).toBeVisible();
  await workspace.getByRole('button', { name: '2 selected rows' }).click();
  await expect(workspace.locator('h3')).toHaveText('2 selected rows');

  const customerGrid = page.locator('.turn').first().locator('.chat-grid');
  await customerGrid.locator('.ag-header-cell[col-id="CustomerId"]').click();
  await customerGrid.locator('.ag-header-cell[col-id="CustomerId"]').click();
  const selectedCustomerId = Number(await customerGrid.locator('.ag-row[row-index="0"] .ag-cell[col-id="CustomerId"]').textContent());
  expect(selectedCustomerId).toBeGreaterThan(1);
  await customerGrid.locator('.ag-row[row-index="0"] .ag-cell[col-id="CustomerId"]').click();
  await expect(workspace.getByRole('tab', { name: 'Selected' })).toHaveAttribute('aria-selected', 'true');
  await expect(workspace.locator('.selected-fields')).toContainText('CustomerId');
  await expect(workspace.locator('.selected-fields')).toContainText(String(selectedCustomerId));
  await page.getByLabel('Ask about Chinook data').fill('Try current selection without attaching');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.turn').last()).toContainText('Attach or dock this Selection before using it in a follow-up query.');
  await workspace.getByRole('button', { name: 'Attach to chat' }).click();
  await expect(page.getByLabel('Attached context')).toContainText('CustomerId · row 1');
  await workspace.getByRole('button', { name: 'Dock', exact: true }).click();
  await expect(workspace.getByRole('tab', { name: 'Docked 1' })).toHaveAttribute('aria-selected', 'true');
  await expect(workspace.locator('.dock-item')).toHaveCount(1);

  await page.reload();
  await expect(page.getByRole('tab', { name: 'Rows 10' })).toBeVisible();
  await expect(page.getByLabel('Attached context')).toContainText('CustomerId · row 1');
  await expect(workspace.locator('.dock-item')).toHaveCount(1);
  await page.getByLabel('Ask about Chinook data').fill('Show their invoices');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.turn')).toHaveCount(6);
  await expect(page.locator('.turn').last().getByRole('tab', { name: /Rows [1-9]/ })).toBeVisible();
  expect(selectedContextSeen).toBe(true);
  const boundValues = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('datatug-chat-sessions');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const saved = await new Promise<{ data: { dtql: string; parentRecordSetId?: string } }[]>((resolve, reject) => {
      const request = database.transaction('ChatQueries', 'readonly').objectStore('ChatQueries').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    const query = saved.map((item) => item.data).find((item) => item.parentRecordSetId);
    return query ? (JSON.parse(query.dtql) as { where: { right: { values: number[] } } }).where.right.values : [];
  });
  expect(boundValues).toEqual([selectedCustomerId]);

  await page.locator('.turn').first().locator('.ag-row[row-index="0"] .ag-cell[col-id="CustomerId"]').click();
  await page.keyboard.down('Shift');
  await page.locator('.turn').first().locator('.ag-row[row-index="2"] .ag-cell[col-id="FirstName"]').click();
  await page.keyboard.up('Shift');
  await expect(workspace.locator('h3')).toHaveText('3 × 2 cells');
  await expect(workspace.locator('.workspace-grid')).toHaveCount(1);

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByLabel('Attached context')).toHaveCount(0);
  await expect(workspace.locator('.dock-item')).toHaveCount(0);
  await page.getByLabel('Ask about Chinook data').fill('Use an old selection');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.turn')).toHaveCount(1);
  await expect(page.locator('.turn').first()).toContainText('The referenced Selection is not in this chat session.');
  await page.locator('.session-toolbar ion-select').click();
  await page.getByRole('radio', { name: 'Show 10 customers' }).click();
  await expect(page.getByLabel('Attached context')).toContainText('CustomerId · row 1');
  await expect(workspace.locator('h3')).toHaveText('3 × 2 cells');
  await workspace.locator('ion-segment-button[value="docked"]').click();
  await expect(workspace.locator('.dock-item')).toHaveCount(1);

  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByLabel('Attached context')).toHaveCount(0);
  await expect(workspace.locator('.dock-item')).toHaveCount(0);
  await expect(page.locator('.turn')).toHaveCount(0);
});
