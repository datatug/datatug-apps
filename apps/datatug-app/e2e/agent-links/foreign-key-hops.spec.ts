import { expect, test } from './fixtures/daemon';

/** Plan Task 9: a record's foreign keys open the referenced record; the metadata view lists them. */
test.describe('foreign keys of a card link', () => {
  test('the metadata view lists the table foreign keys', async ({ page, linkDaemon }) => {
    await page.goto(linkDaemon.link({ table: 'Album' }));
    const fks = page.getByTestId('table-metadata-foreign-keys');
    await expect(fks).toContainText('Artist', { timeout: 30_000 });
    await expect(fks).toContainText('ArtistId');
  });

  test('a record hops to the record its foreign key references, the key never in an address sent', async ({
    page,
    linkDaemon,
  }) => {
    const sent: string[] = [];
    page.on('request', (r) => sent.push(r.url().split('#')[0]));
    await page.goto(linkDaemon.link({ table: 'Album', record: '{"AlbumId":1}' }));
    await expect(page.getByTestId('record-fields')).toContainText('For Those About To Rock', { timeout: 30_000 });
    await page.getByTestId('record-hop').filter({ hasText: 'Artist' }).click();
    await expect(page).toHaveURL(/\/table\/Artist\/record\?schema=main#pk=/);
    // Ionic keeps the page it came from in the outlet: find the Artist record among them.
    await expect(page.getByTestId('record-fields').filter({ hasText: 'AC/DC' })).toBeVisible({ timeout: 30_000 });
    // The referenced key went only in the lookup body: no address the browser sent holds it.
    expect(sent.some((u) => u.includes('ArtistId'))).toBe(false);
  });
});
