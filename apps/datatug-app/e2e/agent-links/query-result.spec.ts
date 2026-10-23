import {
  DEMO_DB,
  DEMO_ENV,
  DEMO_PROJECT,
  expect,
  test,
} from './fixtures/daemon';

/**
 * The page of a query result stored by `datatug query run --result-id`, opened from the link `datatug daemon url
 * --result` mints, against a real daemon. Nothing here prints a row value: the checks name columns, tables and
 * counts only. Skipped with a binary that stores no results (a CLI release before the result route).
 */
const DB_REF = `datatug://${DEMO_PROJECT}/${DEMO_DB}?env=${DEMO_ENV}`;

test.describe('query result link', () => {
  test.beforeEach(({ linkDaemon }) => {
    test.skip(
      !linkDaemon.supportsResults,
      'This datatug binary stores no query results.',
    );
  });

  test('opens the views cold and after a refresh; names open the table pages; nothing runs', async ({
    page,
    linkDaemon,
  }) => {
    linkDaemon.writeResult('e2e-invoices', [
      '--db',
      DB_REF,
      '--from',
      'Invoice',
      '--limit',
      '5',
      '--no-policies',
    ]);
    const link = linkDaemon.resultLink('e2e-invoices', 'sources');
    expect(link).toMatch(/\/result\/e2e-invoices\?view=sources#code=[^&]+$/);

    const agentRequests: { method: string; url: string }[] = [];
    page.on('request', (r) => {
      if (r.url().startsWith(`http://127.0.0.1:${linkDaemon.port}/`)) {
        agentRequests.push({ method: r.method(), url: r.url() });
      }
    });

    await page.goto(link);
    const sources = page.getByTestId('result-sources');
    await expect(sources).toContainText('Invoice', { timeout: 30_000 });
    await expect.poll(() => page.url()).not.toContain('code=');
    await expect.poll(() => page.url()).toContain('/result/e2e-invoices?view=sources');

    // The project of the result is the current one: the side panel shows its menu, as on the project's own pages.
    const projectMenu = page.locator('sneat-datatug-project-menu');
    await expect(projectMenu).toContainText('Queries', { timeout: 30_000 });

    await page.getByTestId('result-view-related').click();
    const related = page.getByTestId('result-related');
    await expect(related).toContainText('Customer');
    await expect(related).toContainText('many-to-one');
    await expect(related).toContainText('InvoiceLine');
    await expect(related).toContainText('one-to-many');
    await expect(page).toHaveURL(/view=related/);

    await page.getByTestId('result-view-columns').click();
    await expect(page.getByTestId('result-columns')).toContainText(
      'CustomerId',
    );

    await page.getByTestId('result-view-record').click();
    await expect(page.getByTestId('author-current-row')).toContainText(
      'Position 1',
    );

    // Changing the view did not drop the project, and a refresh (the code is gone from the address) selects it again.
    await expect(projectMenu).toContainText('Queries');
    await page.reload();
    await expect(page.getByTestId('author-current-row')).toContainText(
      'Position 1',
      { timeout: 30_000 },
    );
    await expect(page.locator('sneat-datatug-project-menu')).toContainText(
      'Queries',
      { timeout: 30_000 },
    );

    // The page only read: one session exchange, the result reads and the project's own reads, and no run or write.
    expect(
      agentRequests.filter((r) => r.url.endsWith('/datatug/session/exchange')),
    ).toHaveLength(1);
    const others = agentRequests.filter(
      (r) => !r.url.endsWith('/datatug/session/exchange'),
    );
    expect(others.some((r) => /\/datatug\/results\/e2e-invoices$/.test(r.url))).toBe(true);
    for (const r of others) {
      expect(r.method).toBe('GET');
      expect(r.url).not.toMatch(/\/datatug\/exec\//);
      expect(r.url).not.toContain('code=');
    }

    // A related name opens the table page of the same database.
    await page.getByTestId('result-view-related').click();
    await page
      .getByTestId('result-related')
      .getByRole('link', { name: 'Customer', exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(
        `/project/${DEMO_PROJECT}/env/${DEMO_ENV}/db/${DEMO_DB}/table/Customer\\?schema=$`,
      ),
    );
    await expect(page.getByTestId('table-metadata-columns')).toContainText(
      'CustomerId',
      { timeout: 30_000 },
    );
  });

  test('Back of a result page with no history goes to the project of the result', async ({
    page,
    linkDaemon,
  }) => {
    linkDaemon.writeResult('e2e-back', [
      '--db',
      DB_REF,
      '--from',
      'Invoice',
      '--limit',
      '2',
      '--no-policies',
    ]);
    await page.goto(linkDaemon.resultLink('e2e-back', 'columns'));
    await expect(page.locator('sneat-datatug-project-menu')).toContainText(
      'Queries',
      { timeout: 30_000 },
    );
    await page.locator('ion-back-button').first().click();
    await expect(page).toHaveURL(
      new RegExp(`/store/http-127\\.0\\.0\\.1:\\d+/project/${DEMO_PROJECT}$`),
    );
  });

  test('Run again sends the saved query once, on the press, and Back shows the saved rows', async ({
    page,
    linkDaemon,
  }) => {
    linkDaemon.writeResult('e2e-rerun', [
      '--db',
      DB_REF,
      '--from',
      'Invoice',
      '--limit',
      '3',
      '--no-policies',
    ]);
    const runs: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/datatug/exec/run_query'))
        runs.push(r.postData() ?? '');
    });
    // A view other than the table: the table view of a result is the query editor (result-editor.spec.ts).
    await page.goto(linkDaemon.resultLink('e2e-rerun', 'columns'));
    await expect(page.getByTestId('result-summary')).toContainText(
      '3 saved rows',
      { timeout: 30_000 },
    );
    await page.getByTestId('result-view-record').click();
    await page.getByTestId('result-view-columns').click();
    expect(runs).toHaveLength(0);

    await page.getByTestId('result-run-again').click();
    await expect(page.getByTestId('result-fresh')).toBeVisible({
      timeout: 30_000,
    });
    expect(runs).toHaveLength(1);
    const body = JSON.parse(runs[0]) as Record<string, unknown>;
    expect(body).toMatchObject({
      project: DEMO_PROJECT,
      environment: DEMO_ENV,
      source: DEMO_DB,
      mode: 'live',
      limit: 500,
      parameters: {},
      bindingOrigins: [],
    });
    expect(typeof body['tugql']).toBe('string');
    expect(typeof body['securityContextId']).toBe('string');
    expect(body).not.toHaveProperty('queryId');
    await expect(page.getByTestId('result-fresh')).toContainText('3 rows');
    await page.getByTestId('result-back-to-saved').click();
    await expect(page.getByTestId('result-summary')).toContainText(
      '3 saved rows',
    );
    await page.reload();
    await expect(page.getByTestId('result-summary')).toContainText(
      '3 saved rows',
      { timeout: 30_000 },
    );
    expect(runs).toHaveLength(1);
  });

  test('Run again of a saved query names it by id with its parameter', async ({
    page,
    linkDaemon,
  }) => {
    linkDaemon.writeResult('e2e-saved', [
      '--project',
      DEMO_PROJECT,
      '--query',
      'customers/customer-invoices',
      '--env',
      DEMO_ENV,
      '--var',
      'CustomerId=2',
      '--role',
      'admin',
    ]);
    const runs: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/datatug/exec/run_query'))
        runs.push(r.postData() ?? '');
    });
    await page.goto(linkDaemon.resultLink('e2e-saved', 'record', 2));
    await expect(page.getByTestId('author-current-row')).toContainText(
      'Position 2',
      { timeout: 30_000 },
    );
    await page.getByTestId('result-run-again').click();
    const answered = page
      .getByTestId('result-fresh')
      .or(page.getByTestId('result-run-error'));
    await expect(answered).toBeVisible({ timeout: 30_000 });
    expect(runs).toHaveLength(1);
    const body = JSON.parse(runs[0]) as Record<string, unknown>;
    expect(body).toMatchObject({
      project: DEMO_PROJECT,
      environment: DEMO_ENV,
      source: DEMO_DB,
      queryId: 'customers/customer-invoices',
      parameters: { CustomerId: { type: 'integer', value: '2' } },
      bindingOrigins: [{ parameterId: 'CustomerId', origin: 'manual' }],
      mode: 'live',
      limit: 500,
    });
    expect(body).not.toHaveProperty('tugql');
    // The daemon accepts the request: an answer with rows, not a refusal of its shape.
    await expect(page.getByTestId('result-fresh')).toBeVisible();
  });

  test('an unknown result shows its named state, never a blank page', async ({
    page,
    linkDaemon,
  }) => {
    linkDaemon.writeResult('e2e-known', [
      '--db',
      DB_REF,
      '--from',
      'Invoice',
      '--limit',
      '1',
      '--no-policies',
    ]);
    // Exchange a code first (the session token is then held for this agent), then ask for a result that is not there.
    const link = linkDaemon.resultLink('e2e-known', 'columns');
    await page.goto(link);
    await expect(page.getByTestId('result-summary')).toBeVisible({
      timeout: 30_000,
    });
    await page.goto(
      link.replace('/result/e2e-known', '/result/e2e-missing').split('#')[0],
    );
    await expect(page.getByTestId('link-problem')).toHaveAttribute(
      'data-problem',
      'result-not-found',
      {
        timeout: 30_000,
      },
    );
    await page.goto(
      link.replace('/result/e2e-known', '/result/bad.id').split('#')[0],
    );
    await expect(page.getByTestId('link-problem')).toHaveAttribute(
      'data-problem',
      'result-not-found',
      {
        timeout: 30_000,
      },
    );
  });
});
