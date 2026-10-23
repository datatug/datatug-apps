import { expect, test } from './helpers/demodb-guard';

const projectPath = '/store/http-localhost:19881/project/search-demo';
const metadata = {
  id: 'search-demo',
  title: 'Search demo',
  access: 'public',
  boards: [
    { id: 'customers-board', title: 'Customers' },
    { id: 'orders-board', title: 'Orders' },
  ],
  entities: [],
  environments: [],
  tags: { Customers: 1 },
};
const documents = [
  {
    kind: 'tag',
    id: 'Customers',
    name: 'Customers',
    tags: ['Customers'],
    reference: { objectId: 'Customers' },
  },
  ...['Chinook', 'Northwind'].map((source) => ({
    kind: 'table',
    id: source + '/Customers',
    name: 'Customers',
    sourceName: source,
    tags: ['Customers'],
    reference: { dbModelId: source, schema: 'dbo', table: 'Customers' },
  })),
  {
    kind: 'dashboard',
    id: 'customers-board',
    name: 'Customers',
    tags: ['Customers'],
    reference: { objectId: 'customers-board' },
  },
];
test('Quick Search consent, grouped kind navigation, tags and deletion retry', async ({
  page,
}, testInfo) => {
  let enabled = false,
    uploads = 0,
    deletes = 0;
  const status = () => ({
    state: enabled ? 'ready' : 'disabled',
    canManage: true,
    eligible: true,
    audience: 'public',
    provider: 'Typesense',
    documentCount: enabled ? documents.length : 0,
    consentVersion: enabled ? 'project-quick-search/1' : undefined,
  });
  await page.route('http://localhost:19881/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/projects/projects_summary'))
      return route.fulfill({ json: [metadata] });
    if (path.endsWith('/projects/project_summary'))
      return route.fulfill({ json: metadata });
    if (path.endsWith('/projects/project_full'))
      return route.fulfill({
        json: {
          ...metadata,
          dbModels: [
            {
              id: 'Chinook',
              schemas: [
                {
                  id: 'dbo',
                  tables: [
                    {
                      name: 'Customers',
                      Columns: [{ name: 'ID', dbType: 'int' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
    if (
      [
        '/boards/all_boards',
        '/entities/all_entities',
        '/environments/all_environments',
      ].some((endpoint) => path.endsWith(endpoint))
    )
      return route.fulfill({ json: [] });
    if (path.endsWith('/queries/all_queries'))
      return route.fulfill({ json: { id: '~', folders: [], items: [] } });
    // A released agent that predates environment-state/1 answers its own agent-info (the app confirms an old agent
    // by its version, 0.107.0 or earlier, before it falls back to the read-only environment list).
    if (path.endsWith('/agent-info'))
      return route.fulfill({ json: { version: '0.100.0' } });
    // Like every released `datatug serve`, this agent has no
    // environment-state/1 route: Go's router answers it with a plain-text 404.
    if (path.endsWith('/environments/state'))
      return route.fulfill({
        status: 404,
        contentType: 'text/plain; charset=utf-8',
        body: '404 page not found\n',
      });
    return route.fulfill({ json: {} });
  });
  await page.route('**/v0/datatug/project/quick-search/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/status')) return route.fulfill({ json: status() });
    if (path.endsWith('/enable')) {
      uploads++;
      const body = route.request().postDataJSON();
      expect(body.consent).toBe(true);
      expect(body.consentVersion).toBe('project-quick-search/1');
      expect(JSON.stringify(body)).not.toMatch(/dbType|SQL|password/);
      enabled = true;
      return route.fulfill({ json: status() });
    }
    if (path.endsWith('/search')) {
      const body = route.request().postDataJSON();
      if (typeof body.q !== 'string' || !body.q.trim() || body.q.length > 256)
        return route.fulfill({
          status: 400,
          json: { error: 'invalid_request' },
        });
      const items = body.tags?.length
        ? documents.filter((item) => item.tags.includes(body.tags[0]))
        : documents;
      return route.fulfill({
        json: { items, itemCount: items.length, tags: ['Customers'] },
      });
    }
    if (path.endsWith('/disable')) {
      enabled = false;
      deletes++;
      if (deletes === 1)
        return route.fulfill({
          status: 503,
          json: { error: 'provider unavailable' },
        });
      return route.fulfill({ json: status() });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto(projectPath + '/overview');
  const overviewSearch = page.getByRole('searchbox', {
    name: 'Quick Search',
    exact: true,
  });
  const overviewRows = page.locator(
    'sneat-datatug-project:not(.ion-page-hidden) ion-card > ion-list > ion-item',
  );
  await expect(overviewRows).toHaveCount(2);
  const rowBorders = await overviewRows.evaluateAll((rows) =>
    rows.map((row) => {
      const native = row.shadowRoot?.querySelector('.item-native'),
        inner = row.shadowRoot?.querySelector('.item-inner');
      return (
        (native ? parseFloat(getComputedStyle(native).borderBottomWidth) : 0) +
        (inner ? parseFloat(getComputedStyle(inner).borderBottomWidth) : 0)
      );
    }),
  );
  expect(rowBorders[0]).toBeGreaterThan(0);
  expect(rowBorders[1]).toBe(0);
  await overviewSearch.fill('Customers');
  await page.screenshot({
    path: testInfo.outputPath('quick-search-overview-input.png'),
    fullPage: true,
  });
  await overviewSearch.press('Enter');
  await expect(page).toHaveURL(/quick-search\?q=Customers$/);
  await page.locator('sneat-datatug-quick-search').waitFor();
  // Development-only Angular debug API supplies the controlled HTTP fixture's
  // bearer token through the real auth bridge; no application test hook ships.
  await page.evaluate(() => {
    const debug = window as unknown as {
      ng: {
        getComponent(element: Element): {
          api: { api: { setApiAuthToken(token: string): void } };
        };
      };
    };
    debug.ng
      .getComponent(
        document.querySelector('sneat-datatug-quick-search') as Element,
      )
      .api.api.setApiAuthToken('quick-search-http-fixture');
  });
  await page
    .locator('sneat-datatug-quick-search')
    .getByRole('button', { name: 'Retry status' })
    .click();
  const main = page.locator(
    'sneat-datatug-quick-search[data-search-view=search]:not(.ion-page-hidden)',
  );
  const schemaPage = page.locator(
    'sneat-datatug-quick-search[data-search-view=schema]:not(.ion-page-hidden)',
  );
  const tagPage = page.locator(
    'sneat-datatug-quick-search[data-search-view=tags]:not(.ion-page-hidden)',
  );
  await expect(
    main.getByText('no search index yet', { exact: false }),
  ).toBeVisible();
  await main
    .getByRole('button', { name: 'Index settings', exact: true })
    .click();
  expect(uploads).toBe(0);
  await main.getByRole('button', { name: 'Preview selected metadata' }).click();
  await expect(
    main.getByText('selected items.', { exact: false }),
  ).toBeVisible();
  await expect(
    main.getByRole('button', { name: 'Enable and index', exact: true }),
  ).toBeDisabled();
  expect(uploads).toBe(0);
  await main.locator('ion-checkbox').click();
  expect(uploads).toBe(0);
  await main
    .getByRole('button', { name: 'Enable and index', exact: true })
    .click();
  await expect.poll(() => uploads).toBe(1);
  await main
    .getByRole('textbox', {
      name: 'Search project names and tags',
      exact: true,
    })
    .fill('Customers');
  await main.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(main.locator('.results > li')).toHaveCount(1);
  await expect(main.locator('.results > li').last()).toHaveCSS(
    'border-bottom-width',
    '0px',
  );
  await expect(
    main.getByRole('link', { name: 'Table@Chinook', exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole('link', { name: 'Table@Northwind', exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole('link', { name: 'Table@Northwind', exact: true }),
  ).toHaveAttribute(
    'href',
    /search-schema\/Northwind\?schema=dbo&table=Customers/,
  );
  await main
    .getByRole('button', { name: 'Index settings', exact: true })
    .click();
  await page.screenshot({
    path: testInfo.outputPath('quick-search-grouped-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page
    .getByRole('searchbox', { name: 'Quick Search', exact: true })
    .fill('Customers');
  await page
    .getByRole('searchbox', { name: 'Quick Search', exact: true })
    .press('Enter');
  await expect(page).toHaveURL(/quick-search\?q=Customers$/);
  await expect(main.locator('.results > li')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await main.getByRole('link', { name: 'Table@Chinook', exact: true }).focus();
  await expect(
    main.getByRole('link', { name: 'Table@Chinook', exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath('quick-search-grouped-mobile.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await main
    .getByRole('link', { name: 'Table@Chinook', exact: true })
    .press('Enter');
  await expect(page).toHaveURL(
    /search-schema\/Chinook\?schema=dbo&table=Customers/,
  );
  await expect(
    schemaPage.getByRole('heading', { name: 'Customers', exact: true }),
  ).toBeVisible();
  await expect(schemaPage).toHaveCount(1);
  await expect(schemaPage.locator('.results')).toContainText('ID');
  await schemaPage
    .getByRole('link', { name: 'Column@Chinook', exact: true })
    .click();
  await expect(page).toHaveURL(
    /search-schema\/Chinook\?schema=dbo&table=Customers&column=ID/,
  );
  await expect(schemaPage.locator('.results > li')).toHaveCount(1);
  await expect(schemaPage.locator('a.name')).toHaveText('ID');
  await page.goBack();
  await expect(schemaPage.locator('.results > li')).toHaveCount(2);

  await page.goBack();
  await expect(main).toHaveCount(1);
  await expect(page).toHaveURL(/quick-search\?q=Customers$/);
  await expect(
    main.getByRole('link', { name: 'Table@Northwind', exact: true }),
  ).toBeVisible();
  await main.locator('a.name').click();
  await expect(page).toHaveURL(/\/tags\?name=Customers/);
  await expect(
    tagPage.getByText('Items explicitly tagged', { exact: false }),
  ).toBeVisible();
  await expect(tagPage.locator('.results > li')).toHaveCount(1);
  await page.goBack();
  await expect(page).toHaveURL(/quick-search\?q=Customers$/);
  await main
    .getByRole('button', { name: 'Index settings', exact: true })
    .click();
  await main
    .getByRole('button', { name: 'Disable and delete index', exact: true })
    .click();
  await main
    .getByRole('button', { name: 'Confirm disable and delete', exact: true })
    .click();
  await expect(main.getByRole('alert')).toContainText('Index operation failed');
  await main
    .getByRole('button', { name: 'Confirm disable and delete', exact: true })
    .click();
  await expect(
    main.getByText('no search index yet', { exact: false }),
  ).toBeVisible();
  expect(deletes).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('quick-search-disabled-mobile.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
