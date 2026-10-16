import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/daemon';

/**
 * AC:unresolvable-link-names-the-problem (Feature claude-mod-web-links, plan Task 11): every link the agent cannot
 * resolve opens a named state on the same address, with a hint and Check again, shows no other project's data and
 * sends no write.
 */

const READ_POSTS = ['/datatug/session/exchange', '/datatug/records/schema', '/datatug/records/lookup'];

function watchWrites(page: Page, port: number): string[] {
  const writes: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(`http://127.0.0.1:${port}/`) || ['GET', 'OPTIONS'].includes(r.method())) return;
    if (!READ_POSTS.includes(new URL(url).pathname)) writes.push(`${r.method()} ${url}`);
  });
  return writes;
}

async function expectState(page: Page, link: string, problem: string, text: string) {
  await page.goto(link);
  const card = page.locator(`[data-testid="link-problem"][data-problem="${problem}"]`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText(text);
  await expect(card.getByTestId('link-check-again')).toBeVisible();
  // Same address: the path is the link's, only the code left the fragment.
  expect(page.url().split('#')[0]).toBe(new URL(link, page.url()).href.split('#')[0]);
}

test.describe('links the agent cannot resolve', () => {
  test('unknown project, database, table and record each name the problem, with nothing written', async ({
    page,
    linkDaemon,
  }) => {
    const writes = watchWrites(page, linkDaemon.port);
    await expectState(page, linkDaemon.link({ table: 'Album', project: 'no-such-project' }), 'project-not-found', 'no project no-such-project');
    await expectState(page, linkDaemon.link({ table: 'Album', db: 'no-such-db', records: true }), 'database-not-found', 'datatug db add');
    await expectState(page, linkDaemon.link({ table: 'NoSuchTable', records: true }), 'table-not-found', 'no table NoSuchTable');
    await expectState(page, linkDaemon.link({ table: 'Album', record: '{"AlbumId":99999}' }), 'record-not-found', 'Album has no record');
    // No other project's data on any of them.
    await expect(page.getByTestId('records-grid')).toHaveCount(0);
    await expect(page.getByTestId('record-fields')).toHaveCount(0);
    expect(writes).toEqual([]);
  });

  test('a stopped agent is agent-unreachable; after it restarts, the old session is link-expired; a fresh link opens', async ({
    page,
    linkDaemon,
  }) => {
    test.setTimeout(90_000);
    const writes = watchWrites(page, linkDaemon.port);
    // Open a link while the agent runs: the page now holds its session token.
    const link = linkDaemon.link({ table: 'Album', records: true, limit: 3 });
    await page.goto(link);
    await expect(page.getByTestId('records-grid').locator('tbody tr')).toHaveCount(3, { timeout: 30_000 });
    // A code is never replayed after an exchange attempt (#327), so the agent going away is seen with the token.
    linkDaemon.stop();
    try {
      await page.reload();
      const card = page.locator('[data-testid="link-problem"][data-problem="agent-unreachable"]');
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card).toContainText('datatug daemon start');
    } finally {
      linkDaemon.start();
    }
    // The restarted agent has a new secret: Check again sends the old token, which it refuses.
    await page.getByTestId('link-check-again').click();
    await expect(page.locator('[data-testid="link-problem"][data-problem="link-expired"]')).toBeVisible({
      timeout: 30_000,
    });
    // A fresh link from the card (a card opens it in a new tab) opens the rows.
    const fresh = await page.context().newPage();
    await fresh.goto(linkDaemon.link({ table: 'Album', records: true, limit: 3 }));
    await expect(fresh.getByTestId('records-grid').locator('tbody tr')).toHaveCount(3, { timeout: 30_000 });
    expect(writes).toEqual([]);
  });
});
