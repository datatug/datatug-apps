import { expect, test } from './fixtures/session-continuity-agent';

const projectId = process.env['DATATUG_SESSION_CONTINUITY_PROJECT_ID'] || 'context-native-fixture';
const sessionTitle = `Continuity ${Date.now()}`;
const composerDraft = 'Preserve this unsent continuity draft.';

async function hasPersistedComposerDraft(page: import('@playwright/test').Page, text: string): Promise<boolean> {
  return page.evaluate((draftText) => new Promise<boolean>((resolve) => {
    const request = indexedDB.open('datatug-session-device-drafts');
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('drafts')) { database.close(); resolve(false); return; }
      const read = database.transaction('drafts', 'readonly').objectStore('drafts').getAll();
      read.onerror = () => { database.close(); resolve(false); };
      read.onsuccess = () => {
        const found = (read.result as { composer?: unknown }[]).some((draft) => draft.composer === draftText);
        database.close();
        resolve(found);
      };
    };
  }), text);
}

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test.describe('Session continuity with the native local CLI', () => {

  test('creates, closes, finds, reopens, and cold-reloads the same session context and composer draft', async ({ page, continuityLink, baseURL }) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(20_000);
    const link = continuityLink;
    let parsed: URL;
    try { parsed = new URL(link); } catch { throw new Error('The private CLI link file did not contain a valid URL.'); }
    if (parsed.origin !== new URL(baseURL as string).origin) throw new Error('The private CLI link targets a different app origin.');

    const sessionCommands: string[] = [];
    let capabilitiesSummary: { status: number; actions: string[]; environments: string[] } | undefined;
    page.on('response', (response) => {
      if (!new URL(response.url()).pathname.endsWith('/session-context/capabilities')) return;
      void response.json().then((body: { actions?: unknown; environments?: unknown }) => {
        capabilitiesSummary = {
          status: response.status(),
          actions: Array.isArray(body.actions) ? body.actions.filter((value): value is string => typeof value === 'string') : [],
          environments: Array.isArray(body.environments) ? body.environments.flatMap((item) =>
            item && typeof item === 'object' && typeof (item as { environmentId?: unknown }).environmentId === 'string'
              ? [(item as { environmentId: string }).environmentId] : []) : [],
        };
      }).catch(() => { capabilitiesSummary = { status: response.status(), actions: [], environments: [] }; });
    });
    page.on('request', (request) => {
      if (request.method() !== 'POST' || !/\/session-context\/commands$/.test(new URL(request.url()).pathname)) return;
      try {
        const body = request.postDataJSON() as { action?: unknown };
        if (typeof body.action === 'string') sessionCommands.push(body.action);
      } catch { /* Preserve only validated action names in this test receipt. */ }
    });

    const storeId = parsed.pathname.match(/^\/store\/([^/]+)/)?.[1];
    if (!storeId) throw new Error('The CLI link did not contain its expected store route.');
    const agentHost = storeId.startsWith('http-') ? storeId.slice('http-'.length) : storeId;
    const agentOrigin = `http://${agentHost}`;
    // Exchange is lazy: a project data request is needed before the token is issued.
    // Keep the original one-time fragment on this first navigation only.
    parsed.pathname = `/store/${storeId}/project/${encodeURIComponent(projectId)}/sessions`;
    parsed.search = '';
    const usesAccessCode = parsed.hash.startsWith('#code=');
    try { await page.goto(parsed.toString()); } catch { throw new Error('Unable to open the local CLI Session route.'); }
    if (usesAccessCode) await expect.poll(() => page.evaluate((origin) =>
      location.hash === '' && localStorage.getItem(`datatug.agent-session:${origin}`) !== null,
    agentOrigin), { timeout: 30_000 }).toBe(true);
    const openSession = page.getByRole('button', { name: 'Open a session', exact: true });
    await expect(openSession).toBeVisible();
    await openSession.click();
    const chooser = page.locator('ion-modal').filter({ hasText: 'Open a session' });
    await expect(chooser).toBeVisible();
    const newSession = page.getByRole('button', { name: 'New session', exact: true }).first();
    await expect.poll(() => capabilitiesSummary, { timeout: 30_000 }).toBeDefined();
    if (!(await newSession.isEnabled())) {
      throw new Error(`The CLI did not admit session creation. Sanitized capabilities: ${JSON.stringify(capabilitiesSummary)}`);
    }
    await newSession.click();
    const createDialog = page.locator('ion-modal').filter({ hasText: 'New session' });
    await createDialog.locator('ion-input[label="Title"] input').fill(sessionTitle);
    await createDialog.getByRole('button', { name: 'Create session', exact: true }).click();
    const sessionTab = page.getByRole('tab', { name: new RegExp(sessionTitle) });
    await expect(sessionTab).toBeVisible();
    // The tab is focused before the router finishes navigating (saveCreate focuses the session, then awaits
    // navigateByUrl), so the tab can be visible while the URL is still the chooser route. Wait for the route itself.
    const sessionRoute = /\/sessions\/([A-Za-z0-9_-]+)(?:\/|$)/;
    await expect.poll(() => new URL(page.url()).pathname.match(sessionRoute)?.[1], { timeout: 20_000 }).toBeTruthy();
    const sessionId = new URL(page.url()).pathname.match(sessionRoute)?.[1];
    expect(sessionId).toBeTruthy();
    if (!sessionId) throw new Error('The created session route did not contain its session ID.');

    await page.getByRole('button', { name: /Context ·/ }).click();
    const bag = page.locator('ion-modal.context-bag-drawer');
    await expect(bag.getByRole('heading', { name: 'Context Bag' })).toBeVisible();
    const mappedField = bag.locator('ion-select[label="Mapped field"]');
    const fieldPickerDismissed = mappedField.evaluate((select) => new Promise<void>((resolve) => {
      select.addEventListener('ionDismiss', () => resolve(), { once: true });
    }));
    await mappedField.click();
    await expect(page.getByRole('radio', { name: 'Invoice ID', exact: true })).toBeVisible();
    await expect(bag.getByRole('button', { name: 'Done', exact: true, includeHidden: true })).toBeDisabled();
    await expect(bag.getByRole('button', { name: 'Add entry', exact: true, includeHidden: true })).toBeDisabled();
    await page.getByRole('radio', { name: 'Invoice ID', exact: true }).click();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await fieldPickerDismissed;
    await expect(bag.getByRole('button', { name: 'Done', exact: true, includeHidden: true })).toBeEnabled();
    await bag.locator('ion-textarea[label="Value"] textarea').fill('1');
    await bag.locator('ion-input[label="Label (optional)"] input').fill('Invoice');
    await bag.getByRole('button', { name: 'Add entry', exact: true }).click();
    const selectedInvoice = bag.getByRole('checkbox', { name: 'Use Invoice', exact: true });
    await expect(selectedInvoice).toBeChecked();
    await bag.getByRole('button', { name: 'Apply Context', exact: true }).click();
    const drawerDismissed = bag.evaluate((modal) => new Promise<void>((resolve) => {
      modal.addEventListener('ionModalDidDismiss', () => resolve(), { once: true });
    }));
    await bag.getByRole('button', { name: 'Done', exact: true }).click();
    await drawerDismissed;
    await expect(bag).toBeHidden();
    await expect(page.getByRole('button', { name: /context · 1 applied/i })).toBeVisible();

    await page.getByRole('button', { name: 'Session actions', exact: true }).click();
    await page.getByRole('button', { name: 'Composer', exact: true }).click();
    const question = page.getByLabel('Question');
    await question.fill(composerDraft);
    await expect.poll(() => hasPersistedComposerDraft(page, composerDraft), { timeout: 10_000 }).toBe(true);

    await page.getByRole('button', { name: `Close ${sessionTitle} tab` }).click();
    await expect(chooser).toBeVisible();
    expect(sessionCommands).toContain('createSession');
    expect(sessionCommands).toContain('putEntry');
    expect(sessionCommands).toContain('applyContext');
    expect(sessionCommands).not.toContain('stop');
    expect(sessionCommands).not.toContain('archive');

    // Closing the last workspace tab opens the session chooser.
    await chooser.getByLabel('Search loaded sessions').fill(sessionTitle);
    const savedSession = chooser.getByText(sessionTitle, { exact: true });
    await expect(savedSession).toBeVisible();
    await savedSession.click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}/overview`));

    await page.getByRole('button', { name: /context · 1 applied/i }).click();
    const reopenedBag = page.locator('ion-modal.context-bag-drawer');
    await expect(reopenedBag.getByRole('checkbox', { name: 'Use Invoice', exact: true })).toBeChecked();
    await expect(reopenedBag.locator('ion-item').filter({ hasText: 'invoice → InvoiceId' })).toContainText('1');
    await reopenedBag.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Session actions', exact: true }).click();
    await page.getByRole('button', { name: 'Composer', exact: true }).click();
    await expect(page.getByLabel('Question')).toHaveValue(composerDraft);

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}/composer`));
    await expect(page.getByLabel('Question')).toHaveValue(composerDraft, { timeout: 30_000 });
    await page.getByRole('button', { name: /context · 1 applied/i }).click();
    const coldReloadBag = page.locator('ion-modal.context-bag-drawer');
    await expect(coldReloadBag.getByRole('checkbox', { name: 'Use Invoice', exact: true })).toBeChecked();
    await expect(coldReloadBag.locator('ion-item').filter({ hasText: 'invoice → InvoiceId' })).toContainText('1');
  });
});
