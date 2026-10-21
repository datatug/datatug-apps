import { expect, test } from '@playwright/test';
import { activePage } from './journey/helpers/active-page';

// Deterministic browser contract for the local provider. Provider integration tests
// separately verify the files written by these conditional mutation endpoints.
test('project tags: edit persisted metadata and follow count chips to URL-backed filters', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const base = '/store/http-localhost:44378/project/tag-fixture';
  let boardTags = ['ops'];
  let serverTags = ['ops'];
  let queryTags = ['ops'];
  let revision = 1;
  let failSave = false;
  let failServerMetadata = false;
  const board = () => ({
    id: 'b',
    title: 'Operations board',
    tags: boardTags,
    rows: [],
  });
  const query = () => ({
    id: 'q',
    title: 'Operations query',
    tags: queryTags,
    type: 'SQL',
    text: 'SELECT 1',
  });
  const server = () => ({
    id: 'sqlite3:',
    tags: serverTags,
    server: { driver: 'sqlite3' },
    databases: [],
  });
  const summary = () => ({
    id: 'tag-fixture',
    title: 'Tag fixture',
    access: 'public',
    boards: [board()],
    environments: [],
  });
  await page.context().route('http://localhost:44378/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const reply = (json: unknown, status = 200) =>
      route.fulfill({
        status,
        json,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
        },
      });
    if (request.method() === 'OPTIONS') return reply({});
    if (path.endsWith('/projects/projects_summary')) return reply([]);
    if (path.endsWith('/agent-info')) return reply({ version: 'v0.103.4' });
    if (path.endsWith('/projects/capabilities'))
      return reply({
        boardTags: true,
        dbServerTags: true,
        queryRead: true,
        querySave: true,
        branches: true,
      });
    if (path.endsWith('/projects/branches'))
      return reply({
        currentBranch: 'main',
        branches: [{ name: 'main', head: 'head' }],
      });
    if (path.endsWith('/projects/project_summary')) return reply(summary());
    if (path.endsWith('/projects/project_full') && failServerMetadata)
      return reply({ error: 'unavailable' }, 503);
    if (path.endsWith('/projects/project_full'))
      return reply({
        ...summary(),
        dbServers: [{ ...server(), dbServer: { driver: 'sqlite3', host: '' } }],
      });
    if (path.endsWith('/projects/item_tags')) {
      const body =
        request.method() === 'PUT' ? request.postDataJSON() : undefined;
      const kind = body?.kind || url.searchParams.get('kind');
      if (body) {
        if (failSave) {
          failSave = false;
          return reply({ error: 'conflict' }, 409);
        }
        if (kind === 'board') boardTags = body.tags;
        else serverTags = body.tags;
        revision++;
      }
      return reply({
        kind,
        id: kind === 'board' ? 'b' : 'sqlite3:',
        tags: kind === 'board' ? boardTags : serverTags,
        revision: `r${revision}`,
        branchHead: 'head',
      });
    }
    if (path.endsWith('/boards/all_boards')) return reply([board()]);
    if (path.endsWith('/boards/board')) return reply(board());
    if (path.endsWith('/dbservers/all_dbservers')) return reply([server()]);
    if (path.endsWith('/dbserver-summary'))
      return reply({ driver: 'sqlite3', host: '', databases: [] });
    if (path.endsWith('/dbserver-databases')) return reply([]);
    if (path.endsWith('/queries/all_queries'))
      return reply({ id: '~', items: [query()], folders: [] });
    if (path.endsWith('/queries/query_revision'))
      return reply({
        query: { ...query(), folderPath: '~' },
        revision: `q${revision}`,
        branchHead: 'head',
        saveSupported: true,
      });
    if (path.endsWith('/queries/get_query')) return reply(query());
    if (path.endsWith('/queries/update_query')) {
      queryTags = request.postDataJSON().tags ?? [];
      return reply({ ...query(), request: request.postDataJSON().request });
    }
    if (path.endsWith('/queries/save_query')) {
      queryTags = request.postDataJSON().query.tags ?? [];
      revision++;
      return reply({
        query: { ...query(), folderPath: '~' },
        revision: `q${revision}`,
        branchHead: 'head',
        saveSupported: true,
      });
    }
    if (
      path.endsWith('/environments/all_environments') ||
      path.endsWith('/entities/all_entities')
    )
      return reply([]);
    return reply({});
  });
  const add = async (tag: string) => {
    const view = activePage(page);
    await view.getByRole('textbox', { name: 'New tag', exact: true }).fill(tag);
    await view.getByRole('button', { name: 'Add tag', exact: true }).click();
  };
  const save = async () => {
    const view = activePage(page);
    await view.getByRole('button', { name: 'Save tags', exact: true }).click();
    await expect(view.getByText('Tags saved.', { exact: true })).toBeVisible();
  };
  await page.goto(`${base}/board/b`);
  await expect(
    activePage(page).getByRole('button', {
      name: 'Remove tag ops',
      exact: true,
    }),
  ).toBeVisible();
  await add('prod');
  await save();
  await page.reload();
  await expect(
    activePage(page).getByRole('button', {
      name: 'Remove tag prod',
      exact: true,
    }),
  ).toBeVisible();
  failSave = true;
  await add('draft');
  await activePage(page)
    .getByRole('button', { name: 'Save tags', exact: true })
    .click();
  await expect(activePage(page).getByRole('alert')).toContainText(
    'draft is preserved',
  );
  await expect(
    activePage(page).getByRole('button', {
      name: 'Remove tag draft',
      exact: true,
    }),
  ).toBeVisible();
  await activePage(page)
    .getByRole('button', { name: 'Reload tags', exact: true })
    .click();
  await expect(
    activePage(page).getByRole('button', {
      name: 'Remove tag draft',
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goto(`${base}/overview`);
  const overviewTabs = activePage(page).getByRole('group', {
    name: 'Project overview sections',
  });
  await expect(
    overviewTabs.getByRole('button', { name: 'Environments', exact: true }),
  ).toHaveCount(0);
  await expect(
    activePage(page).locator('.overview-environments'),
  ).toBeVisible();
  await expect(
    activePage(page).locator('sneat-datatug-project-tags-cloud'),
  ).toHaveCount(0);
  await overviewTabs.getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(
    activePage(page).getByRole('group', { name: 'Tag ops', exact: true }),
  ).toContainText('Boards: 1');
  const overviewCloud = activePage(page).locator(
    'sneat-datatug-project-tags-cloud',
  );
  await expect(overviewCloud.locator('ion-list ion-item.tag-row')).toHaveCount(
    2,
  );
  await expect(overviewCloud.locator('ion-item.tag-row ion-chip')).toHaveCount(
    4,
  );
  await expect(overviewCloud.getByRole('link', { name: /: 0$/ })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: testInfo.outputPath('overview-tags-tab.png'),
    fullPage: true,
  });
  await page.goto(`${base}/tags`);
  const ops = activePage(page).getByRole('group', {
    name: 'Tag ops',
    exact: true,
  });
  await expect(ops).toContainText('Boards: 1');
  await expect(ops).toContainText('Queries: 1');
  await expect(
    ops.getByRole('link', { name: 'Queries: 1', exact: true }),
  ).not.toHaveAttribute('href', /folder=|null/);
  await expect(ops).toContainText('Database servers: 1');
  await page.screenshot({
    path: testInfo.outputPath('tag-cloud.png'),
    fullPage: true,
  });
  await activePage(page)
    .getByRole('link', { name: 'ops', exact: true })
    .click();
  await expect(page).toHaveURL(/\/tag\/ops$/);
  const detail = activePage(page)
    .locator('sneat-datatug-project-tags-cloud')
    .filter({ has: page.locator('.tag-items') });
  await expect(
    detail.getByRole('heading', { name: 'Tag: ops', exact: true }),
  ).toBeVisible();
  await expect(detail.locator('.tag-items')).toContainText('Operations board');
  await expect(detail.locator('.tag-items')).toContainText('Operations query');
  await expect(detail.locator('ion-item[href*="/board/b"]')).toBeVisible();
  await expect(detail.locator('ion-item[href*="query?id=q"]')).toBeVisible();
  await expect(
    detail.locator('ion-item[href*="/servers/db/sqlite3/-"]'),
  ).toBeVisible();
  await detail
    .getByRole('button', { name: 'Reload tags', exact: true })
    .click();
  await expect(detail.locator('.tag-items')).toContainText('Operations board');
  await page.reload();
  await expect(detail.locator('.tag-items')).toContainText('Operations query');
  await page.screenshot({
    path: testInfo.outputPath('tag-detail.png'),
    fullPage: true,
  });
  const specialTag = 'Ops / É?#';
  await page.goto(`${base}/tag/${encodeURIComponent(specialTag)}`);
  await expect(
    detail.getByRole('heading', { name: `Tag: ${specialTag}`, exact: true }),
  ).toBeVisible();
  await expect(detail.locator('.tag-items')).toContainText(
    'No matching boards.',
  );
  await activePage(page)
    .getByRole('link', { name: 'All tags', exact: true })
    .click();
  await expect(page).toHaveURL(/\/tags$/);
  await ops.getByRole('link', { name: 'Boards: 1', exact: true }).click();
  await expect(page).toHaveURL(/tag=ops/);
  const boardRow = activePage(page)
    .locator('ion-item')
    .filter({
      has: page.getByRole('link', { name: 'Operations board', exact: true }),
    });
  await expect(boardRow).not.toHaveAttribute('href');
  await expect(
    boardRow.getByRole('link', { name: 'Operations board', exact: true }),
  ).toHaveAttribute('href', /\/board\/b$/);
  await expect(
    boardRow.getByRole('link', { name: 'ops', exact: true }),
  ).toHaveAttribute('href', /\/tag\/ops$/);
  const popupPromise = page.context().waitForEvent('page');
  await boardRow
    .getByRole('link', { name: 'ops', exact: true })
    .click({ button: 'middle' });
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/tag\/ops$/);
  await popup.close();
  await expect(page).toHaveURL(/\/boards\?tag=ops$/);
  await activePage(page)
    .getByRole('button', { name: 'prod (1)', exact: true })
    .click();
  await expect(page).toHaveURL(/tag=ops&tag=prod/);
  await expect(
    activePage(page).getByText('Operations board', { exact: true }),
  ).toBeVisible();
  await activePage(page)
    .getByRole('textbox', { name: 'Filter boards', exact: true })
    .fill('missing');
  await expect(
    activePage(page).getByText('No boards match the selected filters.'),
  ).toBeVisible();
  await activePage(page)
    .getByRole('button', { name: 'Clear tags', exact: true })
    .click();
  await expect(page).not.toHaveURL(/tag=/);
  await page.goto(`${base}/board/b`);
  await activePage(page)
    .getByRole('button', { name: 'Remove tag ops', exact: true })
    .click();
  await activePage(page)
    .getByRole('button', { name: 'Remove tag prod', exact: true })
    .click();
  await save();
  await page.reload();
  await expect(
    activePage(page).getByText('No tags yet.', { exact: true }),
  ).toBeVisible();
  await page.goto(`${base}/servers/db/sqlite3/-`);
  await expect(
    activePage(page).getByRole('button', {
      name: 'Remove tag ops',
      exact: true,
    }),
  ).toBeVisible();
  await activePage(page)
    .getByRole('button', { name: 'Remove tag ops', exact: true })
    .click();
  await save();
  await page.reload();
  await expect(
    activePage(page).getByText('No tags yet.', { exact: true }),
  ).toBeVisible();
  await add('restored');
  await save();
  failServerMetadata = true;
  await page.reload();
  await expect(
    activePage(page)
      .getByRole('alert')
      .filter({ hasText: 'Server tags could not be loaded' }),
  ).toBeVisible();
  await expect(
    activePage(page).locator('sneat-datatug-project-item-tags'),
  ).toHaveCount(0);
  await expect(
    activePage(page).getByText('No tags yet.', { exact: true }),
  ).toHaveCount(0);
  failServerMetadata = false;
  await activePage(page)
    .getByRole('button', { name: 'Reload tags', exact: true })
    .click();
  await expect(
    activePage(page).getByRole('button', {
      name: 'Remove tag restored',
      exact: true,
    }),
  ).toBeVisible();
  await page.goto(`${base}/query?id=q`);
  await expect(
    activePage(page).getByRole('button', {
      name: 'Remove tag ops',
      exact: true,
    }),
  ).toBeVisible();
  await activePage(page)
    .getByRole('button', { name: 'Remove tag ops', exact: true })
    .click();
  await activePage(page)
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await expect.poll(() => queryTags).toEqual([]);
  await page.reload();
  await expect(
    activePage(page).getByText('No tags yet.', { exact: true }),
  ).toBeVisible();
  await add('query-tag');
  await activePage(page)
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await expect.poll(() => queryTags).toEqual(['query-tag']);
  await page.reload();
  await expect(
    activePage(page).getByRole('button', {
      name: 'Remove tag query-tag',
      exact: true,
    }),
  ).toBeVisible();
  for (const opaque of ['..', 'team/']) {
    await add(opaque);
    await activePage(page)
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    await expect.poll(() => queryTags.includes(opaque)).toBe(true);
    await activePage(page)
      .getByRole('link', { name: opaque, exact: true })
      .click();
    await expect(page).toHaveURL(/\/tag\?tag=/);
    const opaqueDetail = activePage(page)
      .locator('sneat-datatug-project-tags-cloud')
      .filter({ has: page.locator('.tag-items') });
    await expect(
      opaqueDetail.getByRole('heading', {
        name: `Tag: ${opaque}`,
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await expect(opaqueDetail.locator('.tag-items')).toContainText(
      'Operations query',
    );
    await page.goto(`${base}/query?id=q`);
    await expect(
      activePage(page).getByRole('button', {
        name: `Remove tag ${opaque}`,
        exact: true,
      }),
    ).toBeVisible();
  }
});

test('project tags: dashboard uses light card headers with Ionic tabs beside the title', async ({
  page,
}, testInfo) => {
  const board = {
    id: 'b',
    title: 'Dashboard headers',
    tags: ['ops'],
    rows: [
      {
        cards: [
          {
            id: 'race',
            title: 'Where Northwind orders shipped · month by month',
            cols: 12,
            widget: {
              name: 'chart',
              data: {
                title: 'Shipping country',
                sources: [
                  {
                    id: 'orders',
                    queryId: 'orders',
                    transform: {
                      name: 'orders-monthly-country-count',
                      orderIdColumn: 'OrderID',
                      dateColumn: 'OrderDate',
                      countryColumn: 'ShipCountry',
                    },
                  },
                ],
                chart: {
                  type: 'bar-race',
                  categoryColumn: 'category',
                  valueColumn: 'value',
                  periodColumn: 'period',
                  unit: 'orders',
                  grain: 'month',
                  onDuplicate: 'reject',
                  mode: 'period',
                  topN: 10,
                },
              },
            },
          },
        ],
      },
    ],
  };
  const fixtureBoard = {
    ...board,
    rows: [
      {
        cards: [
          ...board.rows[0].cards,
          {
            id: 'plain',
            title: 'Plain query',
            cols: 12,
            widget: { name: 'SQL', data: { sql: { queryId: 'orders' } } },
          },
        ],
      },
    ],
  };
  await page.route('http://localhost:44378/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const summary = {
      id: 'tag-fixture',
      title: 'Tag fixture',
      access: 'public',
      boards: [fixtureBoard],
    };
    const json = path.endsWith('/projects/projects_summary')
      ? []
      : path.endsWith('/boards/board')
        ? fixtureBoard
        : path.endsWith('/projects/capabilities')
          ? { querySave: false }
          : path.endsWith('/projects/project_full')
            ? { ...summary, dbServers: [], environments: [] }
            : path.endsWith('/projects/project_summary')
              ? summary
              : path.endsWith('/agent-info')
                ? { version: 'v0.103.4' }
                : {};
    return route.fulfill({
      json,
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  await page.goto('/store/http-localhost:44378/project/tag-fixture/board/b');
  const card = activePage(page).locator('[data-board-card-id="race"]');
  const header = card.locator('.board-card-header');
  await expect(header.locator('ion-item[color="light"]')).toBeVisible();
  await expect(
    header.getByRole('tab', { name: 'Monthly trends', exact: true }),
  ).toBeVisible();
  const titleBox = await header.locator('ion-label').first().boundingBox();
  const tabsBox = await header.locator('ion-segment').boundingBox();
  expect(titleBox).toBeTruthy();
  expect(tabsBox).toBeTruthy();
  if (titleBox && tabsBox) {
    expect(tabsBox.x).toBeGreaterThan(titleBox.x);
    expect(
      Math.abs(
        titleBox.y + titleBox.height / 2 - (tabsBox.y + tabsBox.height / 2),
      ),
    ).toBeLessThan(24);
  }
  await header.locator('ion-segment-button[value="grid"]').click();
  await expect(
    header.getByRole('tab', { name: 'Source rows', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await header.locator('ion-segment-button[value="chart"]').click();
  await expect(
    header.getByRole('tab', { name: 'Chart', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(
    activePage(page).locator(
      'sneat-datatug-tags-editor ion-card > ion-item-divider[color="light"]',
    ),
  ).toBeVisible();
  expect(await page.locator('ion-card ion-card').count()).toBe(0);
  const plain = activePage(page).locator('[data-board-card-id="plain"]');
  await expect(
    plain
      .locator('.board-card-header ion-buttons[slot="end"]')
      .getByRole('link', { name: 'Edit query', exact: true }),
  ).toBeVisible();
  await expect(plain.locator('.board-card-footer')).toHaveCount(0);
  await expect(card.locator('.board-card-footer ion-buttons')).toBeVisible();
  await expect(activePage(page).locator('ion-toolbar')).toHaveCSS(
    '--background',
    '#f4f5f8',
  );
  const race = card.locator('datatug-bar-race-chart .race');
  await expect(race).toHaveCSS('border-top-width', '0px');
  await expect(race).toContainText('Run this card to load its chart.');
  await page.screenshot({
    path: testInfo.outputPath('dashboard-header-tabs.png'),
    fullPage: true,
  });
});
