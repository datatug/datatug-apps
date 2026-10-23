import initSqlJs from 'sql.js';
import { createHash } from 'node:crypto';
import { expect, test } from './helpers/demodb-guard';
import { SIGN_IN_BUTTON } from './helpers/sign-in-button';

// Runs in the checkout emulator lane. Only AI replies/project metadata are faked;
// the app's pinned SQLite downloader, SHA check, worker, SQL and grid remain real.
test('both explicit AI modes use actual non-demo source schema, execute SQL and follow up; managed quota never falls back', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const email = `project-ai-${crypto.randomUUID()}@example.test`, password = 'local-project-ai-password';
  const signup = await page.request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=e2e', { data: { email, password, returnSecureToken: true } });
  expect(signup.ok()).toBe(true);
  const { localId } = await signup.json() as { localId: string };
  expect((await page.request.patch(`http://127.0.0.1:8180/v1/projects/demo-local-sneat-app/databases/(default)/documents/users/${localId}`, { headers: { Authorization: 'Bearer owner' }, data: { fields: { title: { stringValue: 'AI Fixture' }, email: { stringValue: email }, emailIsVerified: { booleanValue: true } } } })).ok()).toBe(true);
  try {
  await page.goto('/checkout/sign-in?plan=pro&period=monthly&checkout=test');
  const checkout = page.locator('datatug-checkout-page.ion-page:not(.ion-page-hidden):not(.ion-page-invisible):has([data-checkout-page="authentication"])');
  await checkout.locator('ion-segment-button[value="in"]').click();
  await page.locator('ion-input[name="email"] input').fill(email);
  await page.locator('ion-input[type="password"] input:not(.cloned-input)').fill(password);
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
  await expect(page.getByText(`Signed in as ${email}`, { exact: true })).toBeVisible({ timeout: 20_000 });

  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE Equipment (assetTag TEXT, overdue INTEGER)');
  db.run("INSERT INTO Equipment VALUES ('pump-1',1),('valve-2',0)");
  const bytes = Buffer.from(db.export()); db.close();
  const sha = createHash('sha256').update(bytes).digest('hex');
  const connections = [{ id: 'factory', title: 'Factory equipment', storage: 'sqlite', environment: 'prod', fixtureSha256: sha, browserFixture: { url: 'https://factory.example/data/equipment.sqlite', bytes: bytes.length } },
    { id: 'shipping', title: 'Shipping data', storage: 'sqlite', environment: 'test', fixtureSha256: sha, browserFixture: { url: 'https://factory.example/data/shipping.sqlite', bytes: bytes.length } }];
  await page.route('https://factory.example/**', (route) => route.fulfill({ body: bytes, contentType: 'application/vnd.sqlite3' }));
  await page.route('http://localhost:8989/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};
    if (path.endsWith('/projects_summary')) json = [{ id: 'factory-project', title: 'Factory project' }];
    else if (path.endsWith('/agent-info')) json = { version: '0.107.0' };
    else if (path.endsWith('/environments/state')) { await route.fulfill({ status: 426, json: {} }); return; }
    else if (path.endsWith('/connection_catalog')) json = { connections };
    else if (path.endsWith('/project_full') || path.endsWith('/project_summary')) json = { id: 'factory-project', title: 'Factory project', access: 'private', environments: [{ id: 'prod' }, { id: 'test' }], entities: [] };
    else if (path.endsWith('/all_queries')) json = { id: '~', items: [], folders: [] };
    else if (path.endsWith('/all_entities')) json = [];
    await route.fulfill({ json });
  });
  let managed = 0, own = 0, quota = false;
  const proposal = JSON.stringify({ sql: 'SELECT assetTag FROM Equipment WHERE overdue = 1 LIMIT 10' });
  await page.route('**/v0/ai/usage', (route) => route.fulfill({ json: { product: 'datatug', allowance: { unit: 'tokens', used: 2, limit: 100, resetsAt: '2030-01-01T00:00:00Z' } } }));
  await page.route('**/v0/ai/chat', async (route) => {
    managed++;
    expect(route.request().headers()['authorization']).toMatch(/^Bearer /);
    const body = route.request().postDataJSON();
    const metadata = body.context[0].text as string;
    expect(metadata).toContain('Equipment'); expect(metadata).toContain('assetTag');
    expect(metadata).not.toMatch(/pump-1|Chinook|test-key|factory.example/);
    if (managed === 2) expect(metadata).toContain('Show overdue equipment');
    if (quota) { await route.fulfill({ status: 429, json: { error: { code: 'quota', message: 'Daily token allowance exhausted', retryable: false } } }); return; }
    await route.fulfill({ contentType: 'text/event-stream', body: `event: text.delta\ndata: ${JSON.stringify({ type: 'text.delta', text: proposal })}\n\nevent: response.completed\ndata: {"type":"response.completed"}\n\n` });
  });
  await page.route('https://own.example/chat/completions', async (route) => {
    own++;
    const body = route.request().postDataJSON();
    expect(body.messages[0].content).not.toContain('Chinook');
    expect(body.messages[1].content).toContain('Equipment');
    await route.fulfill({ json: { choices: [{ message: { content: proposal } }] } });
  });
  await page.goto('/store/localhost:8989/project/factory-project/chat?env=prod&aiConnection=factory&aiRuntime=browser-sqlite');
  await expect(page.getByLabel('AI mode')).toBeVisible();
  await expect(page.getByLabel('Managed AI status')).toContainText('98 / 100 tokens remaining');
  const ask = async (question: string, count: number) => {
    await page.getByLabel('Ask about project data').fill(question);
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.turn ag-grid-angular')).toHaveCount(count);
    await expect(page.locator('.turn ag-grid-angular').last().locator('.ag-cell[col-id="assetTag"]').first()).toHaveText('pump-1');
  };
  await ask('Show overdue equipment', 1); await ask('Show those again', 2);
  const firstTurn = page.locator('.turn').first();
  await firstTurn.locator('ion-segment-button[value="sql"]').click();
  await expect(firstTurn.getByLabel('Generated SQL')).toHaveValue('SELECT assetTag FROM Equipment WHERE overdue = 1 LIMIT 10');
  await expect(firstTurn.getByRole('tab', { name: 'TugQL', exact: true })).toHaveCount(0);
  await firstTurn.locator('ion-segment-button[value="rows"]').click();
  await testInfo.attach('managed-ai-real-project-result', { body: await page.screenshot(), contentType: 'image/png' });
  quota = true;
  await page.getByLabel('Ask about project data').fill('Show equipment once more'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Your Managed AI allowance is exhausted. Wait for its reset or explicitly choose your own provider.', { exact: true })).toBeVisible();
  expect(own).toBe(0); expect(managed).toBe(3);
  await page.locator('ion-segment[aria-label="AI mode"] ion-segment-button[value="byok"]').click();
  await page.getByRole('button', { name: 'Add AI provider', exact: true }).click();
  await page.getByLabel('Base URL', { exact: true }).fill('https://own.example');
  await page.getByLabel('API key', { exact: true }).fill('test-key');
  await page.locator('.save-provider').click();
  await ask('Show overdue equipment', 3); await ask('Show those again', 4);
  expect(own).toBe(2); expect(managed).toBe(3);
  await testInfo.attach('byok-real-project-followup', { body: await page.screenshot(), contentType: 'image/png' });
  } finally {
    // Cleanup gets its own bounded budget even when an assertion consumed the test budget.
    const removed = await fetch(`http://127.0.0.1:8180/v1/projects/demo-local-sneat-app/databases/(default)/documents/users/${localId}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' }, signal: AbortSignal.timeout(10_000) });
    expect(removed.ok).toBe(true);
  }

});
