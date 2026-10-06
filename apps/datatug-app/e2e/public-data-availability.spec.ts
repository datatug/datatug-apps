import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { activePage } from './journey/helpers/active-page';

/** Synthetic project metadata, actual app-pinned canonical index bytes. No
 * admitted provider, semantic mapping, source rows or hosted runtime success.
 * The real route, GitHub reader, canonical reader and zoneless DOM run intact.
 */
const revision = 'a'.repeat(40);
const repository = 'fabric-fixture/public-data';
const project = `/project/github.com/${repository}/tree/${revision}/sample/-`;
const fixtures = resolve(
  'libs/datatug/main/src/lib/queries/fixtures/public-data-fabric/representation',
);
const pins = {
  directory: [
    'openvaultdb/directory',
    '02db362144d7924c6081dd6768cc0d7187ac9bc3',
    '2795164e7051fb5b3c59400e261a0219382d68c9d74178c13f86f3ac3ef11995',
  ],
  models: [
    'modelspec-org/registry',
    '34be21159e522e85b6e5c110f8bfb8baaa8035a8',
    '302a04f9775aec8627ddab0361030156f592abb3e446088ba43bd813aa527576',
  ],
  meanings: [
    'meaninggraph/registry',
    '3d85ae6fa06b7f38f59cfd2893e07ba801856b96',
    '42931545086beb7c69d803767b8d50e524baff2ff37a2ec9eb8526eee16aa4a5',
  ],
} as const;
const canonical = Object.fromEntries(
  Object.entries(pins).map(([name, [repo, commit, hash]]) => {
    const bytes = readFileSync(resolve(fixtures, `${name}.pinned.json`));
    // Do not silently replace immutable bytes with a normalized JSON fixture.
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
    return [
      `https://raw.githubusercontent.com/${repo}/${commit}/index.json`,
      bytes,
    ];
  }),
);
const directory = JSON.parse(canonical[Object.keys(canonical)[0]].toString());
const chinook = directory.databases.find(
  (item: { localId: string }) => item.localId === 'chinook',
);
const contract = JSON.parse(
  readFileSync(resolve(fixtures, 'contract.json'), 'utf8'),
).contracts[0];
const immutable = (name: keyof typeof pins) => ({
  repository: `https://github.com/${pins[name][0]}`,
  revision: pins[name][1],
  path: 'index.json',
  sha256: pins[name][2],
});
const saved = {
  id: 'pending',
  title: 'Synthetic pending lookup',
  type: 'DTQL',
  federation: { ovdbBaseUrl: 'https://cloud.openvaultdb.com', tables: [] },
  publicData: {
    source: contract.source,
    canonical: {
      directory: immutable('directory'),
      models: immutable('models'),
      meanings: immutable('meanings'),
    },
    attachment: immutable('directory'),
    snapshot: immutable('directory'),
    model: immutable('models'),
    meaning: immutable('meanings'),
    decision: immutable('directory'),
    decisionScope: 'synthetic-pending-only',
    namespace: contract.target.namespace,
    projection: 'identity',
    equality: 'utf8-byte-exact',
    rights: { source: 'fixture', model: 'fixture', meaning: 'fixture' },
    observedAt: '2026-10-05T00:00:00Z',
    eligible: false,
    unavailableReason:
      'Synthetic pending scenario; production execution is unavailable.',
  },
};
const cors = { 'access-control-allow-origin': '*' };
type Failure = 'checksum' | 'redirect' | 'registry';

async function installMetadata(
  page: Page,
  options: {
    host?: string;
    mismatchedRevision?: boolean;
    failure?: Failure;
  } = {},
) {
  const files: Record<string, string> = {
    'sample/datatug-project.json': JSON.stringify({
      id: `public-data@fabric-fixture@sample@${revision}`,
      title: 'Synthetic availability project',
      access: 'public',
      environments: [{ id: 'test' }],
    }),
    'sample/environments/test/test.env.json': JSON.stringify({
      title: 'Synthetic source',
      dbServers: [
        {
          driver: 'ovdb',
          host: options.host ?? chinook.apiUrl,
          catalogs: ['chinook'],
        },
      ],
    }),
    'sample/environments/test/catalogs/chinook/chinook.db.json': JSON.stringify(
      {
        dbModel: 'test',
        ...(options.mismatchedRevision
          ? {
              upstream: {
                repository: chinook.repository,
                revision: 'b'.repeat(40),
              },
            }
          : {}),
      },
    ),
    'sample/dbmodels/test/main/tables/Customer/table.json': '{}',
    'sample/queries/pending.query.json': JSON.stringify(saved),
    'sample/queries/pending.query.dtql': '{}',
  };
  const tree = new Map<string, string>();
  for (const path of Object.keys(files)) {
    tree.set(path, 'blob');
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++)
      tree.set(parts.slice(0, i).join('/'), 'tree');
  }
  const metadata: string[] = [];
  const unexpected: string[] = [];
  const data: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.hostname === 'cloud.openvaultdb.com' ||
      url.hostname === 'demodb.dev' ||
      /\/dtql(?:\?|$)|\/data\//.test(url.pathname)
    )
      data.push(`${request.method()} ${request.url()}`);
  });
  await page.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            ...cors,
            'access-control-allow-headers': '*',
            'access-control-allow-methods': 'GET, OPTIONS',
          },
        });
        return;
      }
      if (
        url.hostname === 'api.github.com' &&
        (url.pathname.startsWith(`/repos/${repository}/`) ||
          url.pathname === `/repos/${repository}`)
      ) {
        const body =
          url.pathname === `/repos/${repository}`
            ? JSON.stringify({ default_branch: 'main' })
            : url.pathname.includes('/commits/')
              ? revision
              : JSON.stringify({
                  sha: revision,
                  truncated: false,
                  tree: [...tree].map(([path, type]) => ({ path, type })),
                });
        await route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body,
        });
        return;
      }
      const prefix = `https://raw.githubusercontent.com/${repository}/${revision}/`;
      if (request.url().startsWith(prefix)) {
        const body =
          files[decodeURIComponent(request.url().slice(prefix.length))];
        await route.fulfill({
          status: body === undefined ? 404 : 200,
          headers: cors,
          body: body ?? 'not found',
        });
        return;
      }
      if (canonical[request.url()]) {
        metadata.push(request.url());
        // Delay resolves after the loading UI has painted: no follow-up click may
        // be used to refresh the resulting DOM.
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
        if (options.failure === 'redirect') {
          await route.fulfill({
            status: 302,
            headers: {
              ...cors,
              location: 'https://untrusted.invalid/metadata.json',
            },
          });
          return;
        }
        if (
          options.failure === 'registry' &&
          request.url().includes('modelspec-org/registry/')
        ) {
          await route.fulfill({
            status: 503,
            headers: cors,
            body: 'synthetic registry failure',
          });
          return;
        }
        await route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body:
            options.failure === 'checksum'
              ? Buffer.from('{}')
              : canonical[request.url()],
        });
        return;
      }
      unexpected.push(`${request.method()} ${request.url()}`);
      await route.abort('blockedbyclient');
    },
  );
  return { metadata, unexpected, data };
}

async function idleWithoutData(
  page: Page,
  traffic: Awaited<ReturnType<typeof installMetadata>>,
) {
  // Two windows catch work scheduled after an async repaint or navigation.
  for (let window = 0; window < 2; window++) {
    await page.waitForTimeout(300);
    expect(traffic.data).toEqual([]);
    expect(traffic.unexpected).toEqual([]);
  }
}
async function loadAndInspect(page: Page) {
  await page.goto(`${project}/public-data`);
  const view = activePage(page);
  await view
    .getByRole('button', { name: 'Load configured sources', exact: true })
    .click();
  await expect(view.getByLabel('Source', { exact: true })).toBeVisible();
  await view
    .getByLabel('Source', { exact: true })
    .selectOption('test/ovdb:chinook/chinook');
  return view;
}

test('configured source inspection repaints asynchronously, explains missing mapping and stays idle', async ({
  page,
}, testInfo) => {
  const traffic = await installMetadata(page);
  await page.goto(`${project}/public-data`);
  await expect(
    activePage(page).getByRole('button', {
      name: 'Load configured sources',
      exact: true,
    }),
  ).toBeEnabled();
  await idleWithoutData(page, traffic);
  expect(traffic.metadata).toEqual([]);
  const view = await loadAndInspect(page);
  await expect(view.getByLabel('Table and field')).toBeVisible();
  await view.getByLabel('Table and field').selectOption('main.Customer');
  await expect(view.getByTestId('configured-field-reason')).toContainText(
    'No explicit canonical recordset-to-model entity mapping',
  );
  await expect(view.getByTestId('no-contract')).toBeVisible();
  await expect(
    view.getByRole('button', { name: 'Run bounded lookup', exact: true }),
  ).toBeDisabled();
  expect(traffic.metadata).toEqual(Object.keys(canonical));
  await idleWithoutData(page, traffic);
  await testInfo.attach('unavailable-source-dom', {
    body: await view.innerText(),
    contentType: 'text/plain',
  });
  await testInfo.attach('metadata-network-receipt', {
    body: JSON.stringify({ canonicalPins: pins, ...traffic }, null, 2),
    contentType: 'application/json',
  });
});

for (const [name, options] of [
  ['missing provider identity', { host: 'https://unmapped.invalid' }],
  ['mismatched upstream revision', { mismatchedRevision: true }],
] as const) {
  test(`${name} never promotes matching table names to a runnable lookup`, async ({
    page,
  }) => {
    const traffic = await installMetadata(page, options);
    const view = await loadAndInspect(page);
    await expect(view.getByLabel('Table and field')).toBeVisible();
    await view.getByLabel('Table and field').selectOption('main.Customer');
    await expect(view.getByTestId('configured-field-reason')).toContainText(
      'no exact canonical provider identity/revision',
    );
    await expect(
      view.getByRole('button', { name: 'Run bounded lookup', exact: true }),
    ).toBeDisabled();
    await idleWithoutData(page, traffic);
  });
}
for (const failure of ['checksum', 'redirect', 'registry'] as const) {
  test(`${failure} metadata failure is visible after inspection and never starts source traffic`, async ({
    page,
  }) => {
    const traffic = await installMetadata(page, { failure });
    const view = await loadAndInspect(page);
    await expect(view.getByRole('alert')).toContainText(
      failure === 'checksum'
        ? 'checksum mismatch'
        : failure === 'registry'
          ? '503'
          : /fetch|redirect|Failed/i,
    );
    await expect(view.getByLabel('Table and field')).toHaveCount(0);
    await expect(
      view.getByRole('button', { name: 'Run bounded lookup', exact: true }),
    ).toHaveCount(0);
    await expect(
      view.getByRole('button', {
        name: 'Load configured sources',
        exact: true,
      }),
    ).toBeEnabled();
    await idleWithoutData(page, traffic);
  });
}

test('reopening a saved pending plan keeps its pins without automatic metadata or data reads', async ({
  page,
}, testInfo) => {
  const traffic = await installMetadata(page, { failure: 'checksum' });
  await page.goto(`${project}/query/pending?id=pending`);
  const view = activePage(page);
  await expect(
    view.getByText('Saved public-data lookup', { exact: true }),
  ).toBeVisible();
  await view
    .getByText('Saved provenance and immutable revisions', { exact: true })
    .click();
  await expect(view.getByTestId('saved-public-data-provenance')).toContainText(
    pins.directory[1],
  );
  await idleWithoutData(page, traffic);
  expect(traffic.metadata).toEqual([]);
  await view.getByRole('button', { name: 'Run query', exact: true }).click();
  await expect(
    view.getByText(
      'Saved public-data execution awaits canonical companion publication and fresh metadata admission. A saved eligibility value does not authorize execution.',
      { exact: true },
    ),
  ).toBeVisible();
  await idleWithoutData(page, traffic);
  await view
    .getByRole('button', { name: 'Check current metadata', exact: true })
    .click();
  await expect(
    view.getByRole('status').filter({ hasText: 'checksum mismatch' }),
  ).toBeVisible();
  await expect(view.getByTestId('saved-public-data-provenance')).toContainText(
    pins.directory[1],
  );
  await expect(view.getByTestId('saved-public-data-provenance')).toContainText(
    pins.models[2],
  );
  await idleWithoutData(page, traffic);
  await page.reload();
  await expect(
    activePage(page).getByText('Saved public-data lookup', { exact: true }),
  ).toBeVisible();
  expect(traffic.metadata).toHaveLength(1);
  await idleWithoutData(page, traffic);
  await testInfo.attach('saved-plan-network-receipt', {
    body: JSON.stringify({ saved, ...traffic }, null, 2),
    contentType: 'application/json',
  });
});

// Rendering-only contract fixture: no admitted ECB/provider and no query success claim.
const rightsWire = JSON.parse(readFileSync(resolve('libs/datatug/semantic/src/contract/fixtures/source-rights.json'), 'utf8'));
async function showCapturedFixture(page: Page, evidence: unknown) {
  await page.locator('sneat-datatug-public-data-page').last().evaluate((element, evidence) => {
    const component = (window as unknown as { ng: { getComponent(el: Element): unknown } }).ng.getComponent(element) as { result: { set(value: unknown): void }; sourceText: { set(value: string): void } };
    component.result.set({ recordset: { columns: [], rows: [] }, limitations: [], bindingsApplied: [], truncated: false, provenance: { mode: 'local', executionProfile: 'public', source: 'Rendering contract fixture only', observedAt: '2026-10-05T00:00:00Z' }, ...(evidence as object) });
    component.sourceText.set('Current selection changed after the captured fixture');
  }, evidence);
}
test('captured source rights render safely at result use and changing current metadata stays idle', async ({ page }, testInfo) => {
  const traffic = await installMetadata(page);
  await page.goto(`${project}/public-data`);
  const view = activePage(page);
  await expect(view.getByRole('button', { name: 'Load configured sources', exact: true })).toBeEnabled();
  const right = { ...rightsWire.structured.sourceRights[0], attribution: { text: 'Fixture credit <img src=x onerror=alert(1)>' }, freeSource: { text: 'Fixture data freely available', url: 'https://example.org/free' }, transformations: ['XML restructured into rows'] };
  await showCapturedFixture(page, { sourceRights: [right], usedSourceIds: rightsWire.structured.usedSourceIds });
  const notice = view.getByTestId('source-rights-notice');
  await expect(notice).toContainText('Used by this result');
  await expect(notice).toContainText('server-declared metadata');
  await expect(notice).toContainText('They do not assign a licence to the joined or derived result');
  await expect(notice).toContainText('Fixture credit <img');
  await expect(notice.locator('img')).toHaveCount(0);
  await expect(notice.getByRole('link', { name: 'Source terms (external)', exact: true })).toHaveAttribute('href', 'https://example.org/terms#reuse');
  await expect(notice.getByRole('link', { name: 'Original free source (external)' })).toHaveAttribute('rel', 'noopener noreferrer');
  await notice.getByText('Source terms text', { exact: true }).click();
  await expect(notice).toContainText('Preserve source attribution.');
  await page.locator('sneat-datatug-public-data-page').last().evaluate((element) => {
    const component = (window as unknown as { ng: { getComponent(el: Element): unknown } }).ng.getComponent(element) as { sourceText: { set(value: string): void } };
    component.sourceText.set('New current declaration URL: https://example.org/new-terms');
  });
  await expect(notice.getByRole('link', { name: 'Source terms (external)', exact: true })).toHaveAttribute('href', 'https://example.org/terms#reuse');
  await showCapturedFixture(page, rightsWire.multiSource);
  await expect(notice.locator('article')).toHaveCount(3);
  await expect(notice).toContainText('Planned input; not reported used');
  await showCapturedFixture(page, rightsWire.mixedDeclaredUndeclared);
  await expect(notice).toContainText('Source data terms not declared: ovdb:fixture-server/unlicensed/Notes');
  await showCapturedFixture(page, {});
  await expect(notice).toContainText('Source data terms not declared.');
  await showCapturedFixture(page, { sourceRights: [{ ...right, declaration: { text: '<script>fixture only</script>' } }] });
  await notice.getByText('Source terms text', { exact: true }).click();
  await expect(notice).toContainText('<script>fixture only</script>');
  await expect(notice.locator('script')).toHaveCount(0);
  await showCapturedFixture(page, { sourceRights: [{ ...right, declaration: { url: 'javascript:alert(1)' } }] });
  await expect(notice.getByRole('alert')).toContainText('malformed or unsafe evidence');
  await expect(notice.getByRole('link')).toHaveCount(0);
  await idleWithoutData(page, traffic);
  expect(traffic.metadata).toEqual([]);
  await testInfo.attach('source-rights-rendering-receipt', { body: JSON.stringify({ fixtureOnly: true, ...traffic }, null, 2), contentType: 'application/json' });
});
