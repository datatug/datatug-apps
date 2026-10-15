import { expect, test } from './fixtures/daemon';

/**
 * AC:metadata-link-opens-same-table (Feature claude-mod-web-links, plan Task 7): the Table card's link opens the
 * table's metadata, read live through the agent, with the one-time code exchanged and removed from the address.
 */
test.describe('metadata link of the Table card', () => {
  test('opens a schemaless table cold and after a refresh', async ({ page, linkDaemon }) => {
    const link = linkDaemon.link({ table: 'Album' });
    expect(link).toMatch(/\/table\/Album\?schema=#code=[^&]+$/);

    const agentRequests: string[] = [];
    page.on('request', (r) => {
      if (r.url().startsWith(`http://127.0.0.1:${linkDaemon.port}/`)) agentRequests.push(r.url());
    });

    await page.goto(link);
    const columns = page.getByTestId('table-metadata-columns');
    await expect(columns).toContainText('AlbumId', { timeout: 30_000 });
    for (const text of ['Title', 'ArtistId', 'int', 'string', 'PK']) {
      await expect(columns).toContainText(text);
    }
    await expect(page.getByTestId('table-metadata-pk')).toContainText('AlbumId');
    await expect(page.getByTestId('table-metadata-referenced-by')).toContainText('Track');

    // The code left the address bar; the path and the schema query stay.
    expect(page.url()).not.toContain('code=');
    expect(page.url()).toContain('/table/Album?schema=');
    // The agent was asked for the session once, and no request carried the code in its address.
    expect(agentRequests.filter((u) => u.endsWith('/datatug/session/exchange'))).toHaveLength(1);
    expect(agentRequests.some((u) => u.includes('code='))).toBe(false);

    await page.reload();
    await expect(page.getByTestId('table-metadata-columns')).toContainText('AlbumId', {
      timeout: 30_000,
    });
  });

  test('a second click on a spent link still opens the table', async ({ context, linkDaemon }) => {
    const link = linkDaemon.link({ table: 'Album' });
    const first = await context.newPage();
    await first.goto(link);
    await expect(first.getByTestId('table-metadata-columns')).toContainText('AlbumId', {
      timeout: 30_000,
    });
    const second = await context.newPage();
    await second.goto(link);
    await expect(second.getByTestId('table-metadata-columns')).toContainText('AlbumId', {
      timeout: 30_000,
    });
  });
});
