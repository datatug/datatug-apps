import { expect, test } from './fixtures/daemon';

/** Agent requests a page sent, with method, path and body, for the read-only and no-key-in-address checks. */
function watchAgent(page: import('@playwright/test').Page, port: number) {
  const seen: { method: string; url: string; body: string }[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(`http://127.0.0.1:${port}/`) && r.method() !== 'OPTIONS') {
      seen.push({ method: r.method(), url: r.url(), body: r.postData() ?? '' });
    }
  });
  return seen;
}

/** Only reads: the code exchange, the schema and the lookup are POSTs that read; every other request is a GET. */
const READ_POSTS = ['/datatug/session/exchange', '/datatug/records/schema', '/datatug/records/lookup'];
function expectReadOnly(seen: { method: string; url: string }[]) {
  for (const r of seen) {
    if (r.method !== 'GET') {
      expect(READ_POSTS.some((p) => new URL(r.url).pathname === p), `${r.method} ${r.url}`).toBe(true);
    }
  }
}

test.describe('records link of the Table records card (AC:records-link-opens-top-n)', () => {
  test('lists at most limit rows, read-only, cold and after a refresh', async ({ page, linkDaemon }) => {
    const link = linkDaemon.link({ table: 'Album', records: true, limit: 7 });
    expect(link).toMatch(/\/table\/Album\/records\?limit=7&schema=#code=/);
    const seen = watchAgent(page, linkDaemon.port);
    await page.goto(link);
    const rows = page.getByTestId('records-grid').locator('tbody tr');
    await expect(rows).toHaveCount(7, { timeout: 30_000 });
    await expect(page.getByTestId('records-grid')).toContainText('For Those About To Rock We Salute You');
    await expect.poll(() => page.url()).not.toContain('code=');
    expectReadOnly(seen);
    const select = seen.find((r) => r.url.includes('/datatug/exec/select'));
    expect(new URL(select?.url ?? 'http://x').searchParams.get('limit')).toBe('7');

    await page.reload();
    await expect(page.getByTestId('records-grid').locator('tbody tr')).toHaveCount(7, { timeout: 30_000 });
  });
});

test.describe('record link of the Record card (AC:record-link-uses-primary-key-in-fragment)', () => {
  test('opens a composite-key record with the key only in the fragment', async ({ page, linkDaemon }) => {
    const link = linkDaemon.link({ table: 'PlaylistTrack', record: '{"PlaylistId":1,"TrackId":3402}' });
    expect(link).toMatch(
      /\/table\/PlaylistTrack\/record\?schema=#code=[^&]+&pk=%7B%22PlaylistId%22%3A1%2C%22TrackId%22%3A3402%7D$/,
    );
    expect(link).not.toContain('$key');
    const seen = watchAgent(page, linkDaemon.port);
    const appRequests: string[] = [];
    const appOrigin = String(test.info().project.use.baseURL);
    page.on('request', (r) => {
      if (r.url().startsWith(appOrigin)) appRequests.push(r.url().split('#')[0]);
    });
    await page.goto(link);
    const fields = page.getByTestId('record-fields');
    await expect(fields).toContainText('PlaylistId', { timeout: 30_000 });
    await expect(fields).toContainText('3402');
    // The key stays in the fragment (refreshable); the code does not.
    await expect.poll(() => page.url()).toContain('#pk=');
    await expect.poll(() => page.url()).not.toContain('code=');
    // The key never went to the web host, nor in an agent address; it went once, in the lookup's body.
    for (const url of [...appRequests, ...seen.map((r) => r.url)]) {
      expect(url).not.toContain('3402');
    }
    const lookups = seen.filter((r) => r.url.endsWith('/datatug/records/lookup'));
    expect(lookups).toHaveLength(1);
    expect(JSON.parse(lookups[0].body).key).toEqual({ PlaylistId: 1, TrackId: 3402 });
    expectReadOnly(seen);

    await page.reload();
    await expect(page.getByTestId('record-fields')).toContainText('3402', { timeout: 30_000 });
  });

  test('an injection-shaped key is bad-key and no lookup is sent', async ({ page, linkDaemon }) => {
    // A hand-edited fragment: daemon url refuses to mint it, so the link is the metadata link plus that key.
    const base = linkDaemon.link({ table: 'Album', record: '{"AlbumId":1}' }).split('&pk=')[0];
    const seen = watchAgent(page, linkDaemon.port);
    await page.goto(base + '&pk=' + encodeURIComponent('{"AlbumId":"1 OR 1=1"}'));
    await expect(page.getByTestId('link-problem')).toContainText('bad-key', { timeout: 30_000 });
    expect(seen.some((r) => r.url.endsWith('/datatug/records/lookup'))).toBe(false);
  });
});
