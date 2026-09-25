import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('CLI chat deep link restores, sends, and follows terminal updates', async ({ page }) => {
  const token = 'a'.repeat(64);
  const messages: { ID: string; Role: string; Kind: string; Text: string; RecordSetID: string; HTTPResponseID?: string }[] = [
    { ID: 'user-1', Role: 'You', Kind: 'text', Text: 'Count customers', RecordSetID: '' },
    { ID: 'answer-1', Role: 'DataTug', Kind: 'text', Text: 'Three customers.', RecordSetID: '' },
    { ID: 'grid-1', Role: 'DataTug', Kind: 'grid', Text: '', RecordSetID: 'rs-1' },
    { ID: 'http-1', Role: 'DataTug', Kind: 'text', Text: 'HTTP fetched', RecordSetID: '', HTTPResponseID: 'http-response-1' },
  ];
  const sent: { text: string; sessionId: string }[] = [];
  let sessionTitle = 'Customer analysis';
  let savedQueryTitle = '';
  let savedVersions = 0;
  const actions: { kind: string; title?: string; reference?: { kind: string; objectId: string } }[] = [];
  const workspace = { activeTab: 'Project', attachments: [] as { kind: string; objectId: string; title: string }[], selections: {} as Record<string, unknown>, views: {} as Record<string, unknown>, currentSelectionId: '', docks: [] as { id: string; reference: { kind: string; objectId: string }; title: string }[], exportBucket: [] as string[] };
  const bookmarks: Record<string, unknown> = {};
  const result = { ID: 'rs-1', Title: 'Customers', Result: { Columns: ['Count'], Rows: [{ Key: 'three', Data: { Count: 3 } }, { Key: 'one', Data: { Count: 1 } }] } };
  bookmarks['untagged'] = { ID: 'untagged', Title: 'Untagged result', ProjectID: 'demo-project-1', SourceID: '', TargetKind: 'recordset', Tags: null, Snapshot: { RecordSet: result } };
  await page.route('http://127.0.0.1:3284/datatug/projects/project_summary**', async (route) => {
    expect(route.request().headers()['x-datatug-chat-capability']).toBe(token);
    await route.fulfill({ json: { id: 'demo-project-1', title: 'Demo project 1', access: 'private' } });
  });
  await page.route('http://127.0.0.1:3284/v1/chat/**', async (route) => {
    expect(route.request().headers()['x-datatug-chat-capability']).toBe(token);
    if (route.request().url().endsWith('/catalog')) {
      await route.fulfill({ json: { ID: 'demo-project-1', Title: 'Demo project 1', Objects: [{ Reference: { kind: 'table', objectId: 'customers', title: 'Customers', projectId: 'demo-project-1' }, Columns: ['CustomerId', 'Name'], ColumnTypes: { CustomerId: 'integer', Name: 'text' }, QueryType: '', QueryText: '', Issue: '' }, { Reference: { kind: 'query', objectId: 'top-customers', title: 'Top customers', projectId: 'demo-project-1' }, Columns: null, ColumnTypes: null, QueryType: 'dtql', QueryText: 'from: customers', Issue: '' }] } });
      return;
    }
    if (route.request().url().endsWith('/sessions')) {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        expect(body.sessionId).toBe('dtcs-1');
        if (body.action === 'rename') sessionTitle = body.value;
        await route.fulfill({ status: 204 });
      } else {
        await route.fulfill({ json: [{ id: 'dtcs-1', title: sessionTitle }] });
      }
      return;
    }
    if (route.request().url().endsWith('/settings')) {
      if (route.request().method() === 'POST') { savedVersions = route.request().postDataJSON().versions; await route.fulfill({ status: 204 }); }
      else await route.fulfill({ json: { versions: 3, environment: 'local', database: 'chinook' } });
      return;
    }
    if (route.request().url().endsWith('/queries')) {
      if (route.request().method() === 'POST') {
        savedQueryTitle = route.request().postDataJSON().save.Title;
        await route.fulfill({ status: 204 });
      }
      else await route.fulfill({ json: [{ ID: 'customers-query', Title: 'Customers query', Type: 'DTQL', Tags: [], Parameters: [] }] });
      return;
    }
    if (route.request().url().includes('/cell_detail?')) {
      expect(route.request().headers()['x-datatug-chat-session']).toBe('dtcs-1');
      await route.fulfill({ json: { Title: 'Customers', Column: 'Count', Value: 3, Row: { Count: 3 }, Qualified: 'main.Customers.Count', DBType: 'integer', Related: [] } });
      return;
    }
    if (route.request().url().includes('/join_candidates')) {
      expect(route.request().headers()['x-datatug-chat-session']).toBe('dtcs-1');
      await route.fulfill({ json: [{ ID: 'fk-1', Source: { Alias: 'c', Relation: 'Customers' }, Target: { Schema: 'main', Relation: 'Orders' }, Cardinality: 'one-to-many', ConstraintID: 'fk-orders', Fields: [] }] });
      return;
    }
    if (route.request().url().includes('/export?')) {
      expect(route.request().headers()['x-datatug-chat-session']).toBe('dtcs-1');
      await route.fulfill({ contentType: 'text/csv', body: 'Count\n3\n1\n' });
      return;
    }
    if (route.request().url().endsWith('/results')) {
      const body = route.request().postDataJSON();
      expect(body).toEqual({ sessionId: 'dtcs-1', recordSetId: 'rs-1', action: 'join', candidateId: 'fk-1' });
      messages.push({ ID: 'join-1', Role: 'DataTug', Kind: 'text', Text: 'JOIN applied.', RecordSetID: '' });
      await route.fulfill({ status: 204 });
      return;
    }
    if (route.request().url().endsWith('/workspace')) {
      const { action, sessionId } = route.request().postDataJSON();
      expect(sessionId).toBe('dtcs-1');
      actions.push(action);
      if (action.kind === 'set_tab') workspace.activeTab = action.title;
      if (action.kind === 'attach') workspace.attachments.push(action.reference);
      if (action.kind === 'detach') workspace.attachments = workspace.attachments.filter((item) => item.objectId !== action.reference.objectId);
      if (action.kind === 'select') {
        workspace.views['view-1'] = { id: 'view-1', recordSetId: action.recordSetId, title: 'Selected customers', rowIndices: action.rows };
        workspace.selections['selection-1'] = { id: 'selection-1', viewId: 'view-1', title: action.title, rows: action.rows, columns: action.columns };
        workspace.currentSelectionId = 'selection-1';
      }
      if (action.kind === 'dock') workspace.docks.push({ id: 'dock-1', reference: action.reference, title: action.reference.title });
      if (action.kind === 'bucket_add') workspace.exportBucket.push(action.recordSetId);
      if (action.kind === 'bucket_remove') workspace.exportBucket = workspace.exportBucket.filter((id) => id !== action.recordSetId);
      if (action.kind === 'bucket_clear') workspace.exportBucket = [];
      if (action.kind === 'bookmark_create') bookmarks['bookmark-1'] = { ID: 'bookmark-1', Title: action.title || action.reference.title, ProjectID: 'demo-project-1', SourceID: '', TargetKind: action.reference.kind, Tags: [], Snapshot: { RecordSet: result } };
      await route.fulfill({ status: 204 });
      return;
    }
    if (route.request().method() === 'POST') {
      sent.push(route.request().postDataJSON());
      messages.push({ ID: 'user-2', Role: 'You', Kind: 'text', Text: sent[0].text, RecordSetID: '' });
      messages.push({ ID: 'answer-2', Role: 'DataTug', Kind: 'text', Text: 'Sent through the CLI.', RecordSetID: '' });
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ json: {
      ID: 'dtcs-1', Title: sessionTitle, Messages: messages,
      RecordSets: { 'rs-1': result }, Workspace: workspace, Bookmarks: bookmarks,
      HTTPResponses: { 'http-response-1': { URL: 'https://example.test/data', StatusCode: 200, ContentType: 'text/plain', Headers: { 'Content-Type': ['text/plain'] }, Body: 'aGVsbG8gaHR0cA==' } },
    } });
  });
  const projectChat = '/store/http-127.0.0.1:3284/project/demo-project-1/chat';
  await page.goto(`${projectChat}#h=127.0.0.1:3284&t=${token}`);
  await expect(page).toHaveURL(new RegExp(`${projectChat}$`));
  await expect(page.getByText('Three customers.')).toBeVisible();
  await expect(page.getByRole('gridcell', { name: '3' })).toBeVisible();
  const httpCard = page.locator('[data-message-id="http-1"]');
  await httpCard.getByRole('tab', { name: 'Raw' }).click();
  await expect(httpCard.getByText('hello http')).toBeVisible();
  await httpCard.getByRole('tab', { name: 'Headers' }).click();
  await expect(httpCard.getByText('Content-Type: text/plain')).toBeVisible();
  let savePrompt = 0;
  const answerSavePrompt = (dialog: import('@playwright/test').Dialog) => { void dialog.accept(savePrompt++ === 0 ? 'Saved HTTP request' : 'api, demo'); };
  page.on('dialog', answerSavePrompt);
  await httpCard.getByRole('button', { name: 'Save query' }).click();
  await expect.poll(() => savedQueryTitle).toBe('Saved HTTP request');
  page.off('dialog', answerSavePrompt);
  await expect(page.getByLabel('Chat session')).toHaveValue('dtcs-1');
  await page.getByRole('button', { name: 'Tools' }).click();
  await expect(page.getByRole('region', { name: 'Chat tools' })).toContainText('Customers query');
  await expect(page.getByRole('region', { name: 'Chat tools' })).toContainText('chinook');
  await page.getByRole('region', { name: 'Chat tools' }).getByRole('spinbutton').fill('4');
  await page.getByRole('region', { name: 'Chat tools' }).getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => savedVersions).toBe(4);
  await page.getByRole('button', { name: 'Hide tools' }).click();
  page.once('dialog', (dialog) => dialog.accept('Renamed from browser'));
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('banner').getByText('Renamed from browser')).toBeVisible();
  await page.getByRole('columnheader', { name: 'Count' }).click();
  await expect(page.getByRole('region', { name: 'Query result' }).getByRole('columnheader', { name: 'Count' })).toHaveAttribute('aria-sort', 'ascending');
  const customersProjectCard = page.getByRole('complementary', { name: 'Chat workspace' }).locator('.context-card').filter({ has: page.getByText('Customers', { exact: true }) });
  await expect(customersProjectCard.getByText('Customers', { exact: true })).toBeVisible();
  await customersProjectCard.getByRole('button', { name: 'Attach' }).click();
  await expect(page.getByLabel('Attached context').getByText('Customers')).toBeVisible();
  await page.getByRole('tab', { name: 'Selected' }).click();
  await expect(page.getByText('Select a row or cell in a result table')).toBeVisible();
  expect(actions.map((action) => action.kind)).toEqual(['attach', 'set_tab']);
  await page.getByRole('gridcell', { name: '3' }).click();
  await expect(page.getByRole('complementary', { name: 'Chat workspace' }).locator('.selected-values dd').first()).toHaveText('3');
  await expect(page.getByRole('region', { name: 'Cell detail' })).toContainText('main.Customers.Count');
  await page.getByRole('complementary', { name: 'Chat workspace' }).getByRole('button', { name: 'Dock' }).click();
  await page.getByRole('tab', { name: 'Docked 1' }).click();
  await expect(page.getByRole('complementary', { name: 'Chat workspace' }).getByRole('gridcell', { name: '3' })).toBeVisible();
  await page.getByRole('tab', { name: 'Bookmarks 1' }).click();
  await expect(page.getByRole('complementary', { name: 'Chat workspace' }).getByText('Untagged result')).toBeVisible();
  const resultCard = page.getByRole('region', { name: 'Query result' });
  await resultCard.getByRole('button', { name: 'Add to export bucket' }).click();
  await page.getByRole('tab', { name: 'Docked 1' }).click();
  await expect(page.getByRole('region', { name: 'Export bucket' })).toContainText('Customers');
  page.once('dialog', (dialog) => dialog.accept('csv'));
  const download = page.waitForEvent('download');
  await resultCard.getByRole('button', { name: 'Download', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('datatug-chat-export.csv');
  await resultCard.getByRole('tab', { name: 'Charts' }).click();
  await expect(resultCard.locator('.chart-row')).toHaveCount(2);
  await resultCard.getByRole('tab', { name: 'Current row' }).click();
  await expect(resultCard.locator('.selected-values')).toContainText('Count');
  await resultCard.getByRole('tab', { name: 'Table' }).click();
  await resultCard.getByRole('button', { name: 'Related tables' }).click();
  await expect(resultCard.getByText('Customers → main.Orders')).toBeVisible();
  await resultCard.getByRole('button', { name: 'Join table' }).click();
  await expect(page.getByText('JOIN applied.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'menu' }).getByText('Chat', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'menu' }).getByText('Demo project 1')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'menu' }).getByText('Overview', { exact: true }).locator('..')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('ion-footer').getByLabel('Message to CLI chat')).toBeVisible();
  const footer = await page.locator('ion-footer').boundingBox();
  expect(footer).not.toBeNull();
  expect(Math.abs((footer?.y || 0) + (footer?.height || 0) - (page.viewportSize()?.height || 0))).toBeLessThan(4);
  const userCard = await page.locator('.message-card.from-user').first().boundingBox();
  const botCard = await page.locator('.message-card:not(.from-user)').first().boundingBox();
  expect(userCard && botCard && userCard.x > botCard.x).toBeTruthy();
  await page.getByLabel('Message to CLI chat').fill('Show their names');
  await page.getByLabel('Message to CLI chat').press('Shift+Enter');
  expect(sent).toHaveLength(0);
  await page.getByLabel('Message to CLI chat').press('Backspace');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Sent through the CLI.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Query result' }).getByRole('columnheader', { name: 'Count' })).toHaveAttribute('aria-sort', 'ascending');
  expect(sent).toEqual([{ text: 'Show their names', sessionId: 'dtcs-1' }]);
  messages.push({ ID: 'terminal-3', Role: 'DataTug', Kind: 'text', Text: 'From the terminal.', RecordSetID: '' });
  await expect(page.getByText('From the terminal.')).toBeVisible();
  for (let index = 0; index < 30; index += 1) messages.push({ ID: `long-${index}`, Role: 'DataTug', Kind: 'text', Text: `Transcript entry ${index}`, RecordSetID: '' });
  await expect(page.getByText('Transcript entry 29')).toBeVisible();
  const panelBeforeScroll = await page.getByRole('complementary', { name: 'Chat workspace' }).boundingBox();
  await page.locator('.chat-history').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const panelAfterScroll = await page.getByRole('complementary', { name: 'Chat workspace' }).boundingBox();
  expect(panelBeforeScroll?.y).toBe(panelAfterScroll?.y);

  const newerToken = 'b'.repeat(64);
  await page.route('http://127.0.0.1:3285/datatug/projects/project_summary**', async (route) => {
    expect(route.request().headers()['x-datatug-chat-capability']).toBe(newerToken);
    await route.fulfill({ json: { id: 'another-project', title: 'Another project', access: 'private' } });
  });
  await page.route('http://127.0.0.1:3285/v1/chat/session', async (route) => {
    expect(route.request().headers()['x-datatug-chat-capability']).toBe(newerToken);
    await route.fulfill({ json: { ID: 'dtcs-2', Title: 'Another CLI', Messages: [], RecordSets: {} } });
  });
  await page.route('http://127.0.0.1:3285/v1/chat/sessions', async (route) => {
    expect(route.request().headers()['x-datatug-chat-capability']).toBe(newerToken);
    await route.fulfill({ json: [{ id: 'dtcs-2', title: 'Another CLI' }] });
  });
  await page.goto(`/store/http-127.0.0.1:3285/project/another-project/chat#h=127.0.0.1:3285&t=${newerToken}`);
  await expect(page.getByRole('banner').getByText('Another CLI')).toBeVisible();
});

test('browser connects to a real local CLI bridge', async ({ page }) => {
  const linkFile = process.env.DATATUG_BRIDGE_SMOKE_LINK_FILE;
  test.skip(!linkFile, 'Requires a running local CLI bridge.');
  let changes = 0;
  page.on('websocket', (socket) => {
    if (socket.url().endsWith('/v1/chat/events')) socket.on('framereceived', ({ payload }) => {
      if (String(payload).includes('changed')) changes += 1;
    });
  });
  const link = readFileSync(linkFile || '', 'utf8');
  const bridgeURL = new URL(link);
  await page.goto(`${bridgeURL.pathname}${bridgeURL.hash}`);
  await expect(page.getByLabel('Message to CLI chat')).toBeEnabled();
  await expect.poll(() => changes).toBeGreaterThan(0);
  const beforeSend = changes;
  await page.getByLabel('Message to CLI chat').fill('Hello from browser');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('CLI answered: Hello from browser')).toBeVisible();
  await expect.poll(() => changes).toBeGreaterThan(beforeSend);
});
