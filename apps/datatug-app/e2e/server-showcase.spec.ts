import { expect, test } from './helpers/demodb-guard';

// Explicit live acceptance: the project reader uses the paired committed demo
// checkout, while OVDB and its pinned publisher rights remain real network reads.
test('server showcase and tutorial hold complete results without SQLite downloads', async ({ page, context }) => {
  test.skip(process.env['DATATUG_E2E_SERVER_SHOWCASE'] !== '1', 'explicit live server acceptance only');
  const source = process.env['DATATUG_E2E_GITHUB_FAKE'];
  if (!source) throw new Error('Set DATATUG_E2E_GITHUB_FAKE to the paired committed demo checkout.');
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  // The demo project and the SHA-pinned demo-db/northwind rights publications come from the GitHub pins
  // (e2e/github-pins.json), answered by the guard.
  const requests: string[] = [];
  context.on('request', request => {
    if (!request.url().endsWith('/dtql') || request.method() === 'POST') requests.push(request.url());
  });
  const queries = () => requests.filter(url => url.includes('ovdb.demodb.dev/v1/databases/') && url.endsWith('/dtql'));
  const downloads = () => requests.filter(url => /\.(?:sqlite|wasm)(?:$|\?)/.test(url));
  const url = '/project/github.com/datatug/datatug-demo-project/demo-project-1/-/board/showcase';
  await page.goto(url);
  const race = page.locator('ion-card').filter({ hasText: 'Where Northwind orders shipped' }).first();
  await expect(race).toContainText('830 source orders', { timeout: 60_000 });
  await expect(race).toContainText('23 monthly frames');
  await expect.poll(() => queries().length).toBeGreaterThanOrEqual(2);
  const inspector = page.locator('ion-card').filter({ hasText: /Inspect (?:three )?saved query results/ }).first();
  for (const [tab, summary, database, rowCount] of [
    ['Northwind · server orders', '830 rows · 14 columns', 'northwind', 25],
    ['Northwind · server countries', '21 rows · 2 columns', 'northwind', 21],
    ['Chinook · customer billing', '10 rows · 6 columns', 'chinook', 10],
  ] as const) {
    const tabHost = inspector.locator('ion-segment-button').filter({ hasText: tab });
    await expect(tabHost).toHaveText(tab);
    await tabHost.click();
    const before = queries().length;
    await Promise.all([
      page.waitForResponse(response => response.request().method() === 'POST' &&
        response.url() === `https://ovdb.demodb.dev/v1/databases/${database}/dtql`, { timeout: 30_000 }),
      inspector.getByRole('button', { name: /^Refresh on board · / }).click(),
    ]);
    await expect(inspector.getByRole('button', { name: /^Refresh on board · / })).toBeEnabled();
    await expect(inspector).toContainText(summary, { timeout: 30_000 });
    await expect(inspector.locator('table tbody tr')).toHaveCount(rowCount);
    expect(queries().length).toBeGreaterThan(before);
    expect(queries().at(-1)).toContain(`/databases/${database}/dtql`);
  }
  const count = queries().length;
  await race.getByRole('button', { name: 'Source rows', exact: true }).click();
  await expect(race.locator('sneat-datatug-held-result-presentation table tbody tr')).toHaveCount(25);
  await race.getByRole('button', { name: 'Chart', exact: true }).click();
  expect(queries()).toHaveLength(count);
  expect(downloads()).toEqual([]);

  await page.goto(url + '?mode=tutorial');
  await expect(page.getByRole('heading', { name: 'Build this dashboard' })).toBeVisible();
  await page.getByRole('button', { name: 'Add the first card', exact: true }).click();
  const tutorialRace = page.locator('ion-card').filter({ hasText: 'Where Northwind orders shipped' }).first();
  await expect(tutorialRace).toContainText('830 source orders', { timeout: 60_000 });
  const tutorialCount = queries().length;
  await tutorialRace.getByRole('button', { name: 'Source rows', exact: true }).click();
  await expect(tutorialRace.locator('sneat-datatug-held-result-presentation table tbody tr')).toHaveCount(25);
  await tutorialRace.getByRole('button', { name: 'Chart', exact: true }).click();
  expect(queries()).toHaveLength(tutorialCount);
  expect(downloads()).toEqual([]);
});

test('cross-database comparison runs one native server query and displays source counts', async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    process.env['DATATUG_E2E_SERVER_SHOWCASE'] !== '1',
    'explicit live server acceptance only',
  );
  // GITHUB_E2E_MODE=live reads the real GitHub; otherwise the guard answers from the pinned checkouts.
  const realGithub = process.env['GITHUB_E2E_MODE'] === 'live';
  const localProxy = process.env['DATATUG_E2E_PUBLIC_OVDB_PROXY'] === '1';
  test.setTimeout(120_000);
  const endpoint = localProxy
    ? '/__datatug_public_ovdb/cloud/v1/dtql'
    : 'https://cloud.openvaultdb.com/v1/dtql';
  const posts: string[] = [];
  const preflights: string[] = [];
  const downloads: string[] = [];
  context.on('request', (request) => {
    if (localProxy && new URL(request.url()).pathname.startsWith('/__datatug_public_ovdb/cloud/')) {
      expect(request.headers()['authorization']).toBeUndefined();
      expect(request.headers()['cookie']).toBeUndefined();
      if (request.method() === 'GET') preflights.push(new URL(request.url()).pathname);
    }
    if (
      request.method() === 'POST' &&
      (localProxy ? new URL(request.url()).pathname.startsWith('/__datatug_public_ovdb/cloud/v1/') : request.url().includes('cloud.openvaultdb.com/v1/'))
    )
      posts.push(request.url());
    if (/\.(sqlite|wasm)(?:$|\?)/.test(request.url()))
      downloads.push(request.url());
  });
  const revision = process.env['DATATUG_E2E_SERVER_SHOWCASE_REF'] || 'HEAD';
  await page.goto(
    `/project/github.com/datatug/datatug-demo-project@${revision}/demo-project-1/-/board/showcase`,
  );
  if (localProxy) {
    const race = page.locator('ion-card').filter({ hasText: 'Where Northwind orders shipped' }).first();
    await expect(race).toContainText('830 source orders', { timeout: 60_000 });
    await expect(race).toContainText('23 monthly frames');
  }
  const inspector = page
    .locator('ion-card')
    .filter({ hasText: 'Inspect saved query results' })
    .first();
  await inspector
    .locator('ion-segment-button')
    .filter({ hasText: 'Northwind + Chinook · shared countries' })
    .click();
  await expect(inspector).toContainText('Customer records, not shared people');
  const response = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      (localProxy ? new URL(response.url()).pathname === endpoint : response.url() === endpoint),
  );
  await inspector
    .getByRole('button', { name: /^Refresh on board · / })
    .click();
  const answered = await response;
  expect(answered.status()).toBe(200);
  // Chromium can discard a completed worker's response body before CDP reads
  // it. Local acceptance uses the real visible typed result and canonical
  // lineage; the native decoder's strict envelope/source checks have unit gates.
  const envelope = localProxy ? undefined : await answered.json();
  if (envelope) {
    expect(envelope.complete).toBe(true);
    expect(envelope.execution.route).toBe('in-memory');
    expect(envelope.execution.sources.map((source: { database: string; collection: string }) =>
      `${source.database}.${source.collection}`).sort()).toEqual(['chinook.Customer', 'northwind.Customers']);
  }
  if (localProxy) expect(preflights).toEqual([
    '/__datatug_public_ovdb/cloud/v1/databases/northwind',
    '/__datatug_public_ovdb/cloud/v1/databases/chinook',
  ]);
  await expect(inspector).toContainText('17 rows · 3 columns');
  await expect(
    inspector.locator('table tbody tr').filter({ hasText: 'Canada' }),
  ).toContainText('3');
  await expect(
    inspector.locator('table tbody tr').filter({ hasText: 'Canada' }),
  ).toContainText('8');
  expect(posts).toHaveLength(1);
  expect(localProxy ? new URL(posts[0]).pathname : posts[0]).toBe(endpoint);
  expect(downloads).toEqual([]);
  const sourceDetails = inspector.locator('details.source-details');
  await sourceDetails.locator('summary').click();
  await expect(sourceDetails).toContainText('https://cloud.openvaultdb.com/v1/dtql (direct OVDB)');
  await page.screenshot({ path: testInfo.outputPath('local-federation.png'), fullPage: true });
  await testInfo.attach('native-federation-public-receipt', {
    body: JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        endpoint: 'https://cloud.openvaultdb.com/v1/dtql',
        transport: localProxy ? 'development-loopback-proxy' : 'direct',
        projectReader: realGithub ? 'public GitHub' : 'pinned GitHub checkout (e2e/github-pins.json)',
        projectRevision: revision,
        browserEndpoint: answered.url(),
        status: answered.status(),
        ...(envelope ? { execution: envelope.execution, columns: envelope.columns, complete: envelope.complete,
          canada: envelope.records.find((record: { data: { country: string } }) => record.data.country === 'Canada')?.data } : {
          responseEnvelopeCapture: 'Worker response body unavailable to CDP; visible result admitted by strict native decoder.',
          capabilityPreflights: preflights,
          visibleRows: await inspector.locator('table tbody tr').count(),
          visibleCanada: await inspector.locator('table tbody tr').filter({ hasText: 'Canada' }).innerText(),
          canonicalSourceDetails: await sourceDetails.innerText(),
        }),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});
