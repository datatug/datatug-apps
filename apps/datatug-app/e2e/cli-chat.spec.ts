import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('CLI chat deep link restores, sends, and follows terminal updates', async ({ page }) => {
  const token = 'a'.repeat(64);
  const messages = [
    { ID: 'user-1', Role: 'You', Kind: 'text', Text: 'Count customers', RecordSetID: '' },
    { ID: 'answer-1', Role: 'DataTug', Kind: 'text', Text: 'Three customers.', RecordSetID: '' },
    { ID: 'grid-1', Role: 'DataTug', Kind: 'grid', Text: '', RecordSetID: 'rs-1' },
  ];
  const sent: { text: string; sessionId: string }[] = [];
  await page.route('http://127.0.0.1:3284/v1/chat/**', async (route) => {
    expect(route.request().headers()['x-datatug-chat-capability']).toBe(token);
    if (route.request().method() === 'POST') {
      sent.push(route.request().postDataJSON());
      messages.push({ ID: 'user-2', Role: 'You', Kind: 'text', Text: sent[0].text, RecordSetID: '' });
      messages.push({ ID: 'answer-2', Role: 'DataTug', Kind: 'text', Text: 'Sent through the CLI.', RecordSetID: '' });
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ json: {
      ID: 'dtcs-1', Title: 'Customer analysis', Messages: messages,
      RecordSets: { 'rs-1': { Title: 'Customers', Result: { Columns: ['Count'], Rows: [{ Key: '', Data: { Count: 3 } }] } } },
    } });
  });
  await page.goto(`/chat#h=127.0.0.1:3284&t=${token}`);
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByText('Three customers.')).toBeVisible();
  await expect(page.getByRole('cell', { name: '3' })).toBeVisible();
  await page.getByLabel('Message to CLI chat').fill('Show their names');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Sent through the CLI.')).toBeVisible();
  expect(sent).toEqual([{ text: 'Show their names', sessionId: 'dtcs-1' }]);
  messages.push({ ID: 'terminal-3', Role: 'DataTug', Kind: 'text', Text: 'From the terminal.', RecordSetID: '' });
  await expect(page.getByText('From the terminal.')).toBeVisible();

  const newerToken = 'b'.repeat(64);
  await page.route('http://127.0.0.1:3285/v1/chat/session', async (route) => {
    expect(route.request().headers()['x-datatug-chat-capability']).toBe(newerToken);
    await route.fulfill({ json: { ID: 'dtcs-2', Title: 'Another CLI', Messages: [], RecordSets: {} } });
  });
  await page.goto(`/chat#h=127.0.0.1:3285&t=${newerToken}`);
  await expect(page.getByRole('banner').getByText('Another CLI')).toBeVisible();
});

test('browser connects to a real local CLI bridge', async ({ page }) => {
  test.skip(!process.env.DATATUG_BRIDGE_SMOKE_LINK_FILE, 'Requires a running local CLI bridge.');
  let changes = 0;
  page.on('websocket', (socket) => {
    if (socket.url().endsWith('/v1/chat/events')) socket.on('framereceived', ({ payload }) => {
      if (String(payload).includes('changed')) changes += 1;
    });
  });
  const link = readFileSync(process.env.DATATUG_BRIDGE_SMOKE_LINK_FILE!, 'utf8');
  const fragment = new URL(link).hash;
  await page.goto(`/chat${fragment}`);
  await expect(page.getByLabel('Message to CLI chat')).toBeEnabled();
  await expect.poll(() => changes).toBeGreaterThan(0);
  const beforeSend = changes;
  await page.getByLabel('Message to CLI chat').fill('Hello from browser');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('CLI answered: Hello from browser')).toBeVisible();
  await expect.poll(() => changes).toBeGreaterThan(beforeSend);
});
