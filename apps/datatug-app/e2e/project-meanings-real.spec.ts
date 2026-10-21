import { expect, test } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
interface FixtureCatalog {
  readonly revision: string;
  readonly scope: {
    readonly storage: 'local';
    readonly project: string;
    readonly branch: string;
  };
  readonly entities: readonly unknown[];
}

/** Real provider acceptance. The fixture owns its temporary Git repo, port, agent child,
 * and teardown (SIGTERM, bounded wait, SIGKILL fallback, remove temp repo).
 * Run only through e2e-meanings with a current DATATUG_BIN; no shared checkout changes. */
test('durable meanings CRUD, query references and protected deletion through a real local agent', async ({
  page,
  request,
}, testInfo) => {
  const binary = process.env['DATATUG_BIN'];
  expect(
    binary,
    'Set DATATUG_BIN to a built CLI supporting project meanings.',
  ).toBeTruthy();
  const directory = mkdtempSync(join(tmpdir(), 'datatug-meanings-browser-'));
  const project = 'meanings-browser';
  writeFileSync(
    join(directory, 'datatug-project.json'),
    JSON.stringify({
      id: project,
      title: 'Meanings acceptance',
      created: { at: '2026-10-21T00:00:00Z' },
      access: 'public',
    }),
  );
  mkdirSync(join(directory, 'queries'));
  writeFileSync(
    join(directory, 'queries', 'buyers.query.json'),
    JSON.stringify({ id: 'buyers', title: 'Buyers', type: 'SQL' }),
  );
  writeFileSync(
    join(directory, 'queries', 'buyers.query.sql'),
    'SELECT 1 AS CustomerId',
  );
  execFileSync('git', ['init', '-b', 'main'], { cwd: directory });
  execFileSync('git', ['config', 'user.name', 'Meanings acceptance'], {
    cwd: directory,
  });
  execFileSync(
    'git',
    ['config', 'user.email', 'meanings-acceptance@example.invalid'],
    { cwd: directory },
  );
  execFileSync('git', ['add', 'datatug-project.json', 'queries'], {
    cwd: directory,
  });
  execFileSync(
    'git',
    ['commit', '-m', 'test: seed disposable meanings project'],
    { cwd: directory },
  );
  const reservation = createServer();
  await new Promise<void>((resolve) =>
    reservation.listen(0, '127.0.0.1', resolve),
  );
  const address = reservation.address();
  if (!address || typeof address === 'string')
    throw new Error('No fixture port.');
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(
    binary as string,
    [
      'serve',
      '--project',
      directory,
      '--host',
      'localhost',
      '--port',
      String(port),
      '--as',
      'meanings-browser',
      '--role',
      'admin',
      '--allow-writes',
      '--idle-timeout',
      '10m',
    ],
    {
      env: {
        ...process.env,
        DATATUG_TELEMETRY: '0',
        DATATUG_DAEMON_DIR: join(directory, '.agent-state'),
      },
      // Agent output can contain bootstrap credentials; keep it out of test artifacts.
      stdio: 'ignore',
    },
  );
  const api = `http://localhost:${port}/datatug`;
  const endpoint = (path: string, extra: Record<string, string> = {}) =>
    `${api}/${path}?${new URLSearchParams({ storage: 'local', project, ...extra })}`;
  const active = () =>
    page.locator('sneat-datatug-meanings-page.ion-page:not(.ion-page-hidden)');
  try {
    await expect
      .poll(
        async () => {
          try {
            return (await request.get(`${api}/ping`)).status();
          } catch {
            return 0;
          }
        },
        {
          timeout: 20_000,
          message:
            'Owned local agent did not become ready behind its required token boundary.',
        },
      )
      .toBe(401);
    const secret = Buffer.from(
      readFileSync(
        join(directory, '.agent-state', `access-${port}.key`),
        'utf8',
      ).trim(),
      'hex',
    );
    const token = createHmac('sha256', secret)
      .update('datatug-session-v1\0')
      .digest('base64url');
    const auth = { Authorization: `Bearer ${token}` };
    await page.addInitScript(
      ({ origin, token }) =>
        localStorage.setItem(`datatug.agent-session:${origin}`, token),
      { origin: `http://localhost:${port}`, token },
    );
    const root = `/store/http-localhost:${port}/project/${project}/meanings`;
    await page.goto(root);
    await expect(
      active().getByText(
        'No meanings could be resolved from the available project declarations.',
      ),
    ).toBeVisible();
    await active()
      .getByRole('link', { name: 'Add entity', exact: true })
      .click();
    await active()
      .locator('ion-input[formcontrolname="conceptId"] input')
      .fill('customer');
    await active()
      .locator('ion-input[formcontrolname="name"] input')
      .fill('Customer');
    await active()
      .locator('ion-textarea textarea')
      .fill('A buyer in the business.');
    await active().getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/meanings\/entity\?.*concept=customer/);
    await page.reload();
    await expect(
      active().getByText('A buyer in the business.', { exact: true }),
    ).toBeVisible();
    await active()
      .getByRole('link', { name: 'Add field', exact: true })
      .click();
    await active()
      .locator('ion-input[formcontrolname="conceptId"] input')
      .fill('customer-id');
    await active()
      .locator('ion-input[formcontrolname="name"] input')
      .fill('Customer ID');
    await active()
      .locator('ion-textarea textarea')
      .fill('Stable buyer identifier.');
    await active().getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/meanings\/field\?.*field=customer-id/);
    await page.reload();
    await expect(
      active().getByText('Stable buyer identifier.', { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('01-field-after-reload.png'),
      fullPage: true,
    });
    const fieldUrl = page.url();
    await page.goto(root);
    await expect(active().getByText('Customer', { exact: true })).toBeVisible();
    await expect(
      active().getByText('Customer ID', { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('00-list-entity-and-field.png'),
      fullPage: true,
    });
    await active().getByText('Customer ID', { exact: true }).click();
    await expect(page).toHaveURL(fieldUrl);
    let catalogResponse = await request.get(endpoint('meanings/catalog'), {
      headers: auth,
    });
    expect(catalogResponse.ok()).toBe(true);
    let catalog = (await catalogResponse.json()) as FixtureCatalog;
    const queryResponse = await request.get(
      endpoint('queries/query_revision', {
        id: 'buyers',
        branch: catalog.scope.branch as string,
      }),
      { headers: auth },
    );
    expect(queryResponse.ok(), await queryResponse.text()).toBe(true);
    const loaded = await queryResponse.json();
    const semantic = {
      version: 1,
      basis: {
        queryHash: 'a'.repeat(64),
        resultIndex: 0,
        columns: [{ name: 'CustomerId', dataType: 'integer' }],
      },
      meaning: {
        format: 'meaning/draft-2',
        id: 'buyers-meaning',
        name: 'Buyer meanings',
        description: 'MeaningGraph definitions for the acceptance query.',
        models: { query: 'query.modelspec.json' },
        concepts: [] as unknown[],
      },
      model: {
        modelspec: '1.0-draft-2',
        module: { id: 'datatug/query', name: 'query', version: '0.1.0' },
        records: { QueryResult: { fields: { column1: { type: 'int' } } } },
      },
      bindings: [] as unknown[],
    };
    semantic.meaning.concepts = [
      {
        id: 'customer',
        kind: 'entity',
        labels: { en: 'Customer' },
        description: 'A buyer in the business.',
        meaningRef: {
          documentId: 'project',
          conceptId: 'customer',
          scope: catalog.scope,
        },
      },
      {
        id: 'customer-id',
        kind: 'property',
        of: 'customer',
        bindings: [
          {
            model: 'modelspec:///query.QueryResult',
            field: 'column1',
            role: 'value',
          },
        ],
        labels: { en: 'Customer ID' },
        description: 'Stable buyer identifier.',
        meaningRef: {
          documentId: 'project',
          conceptId: 'customer-id',
          scope: catalog.scope,
        },
      },
    ];
    semantic.bindings = [
      { columnIndex: 0, field: 'column1', concept: 'customer-id' },
    ];
    const linkedQuery = {
      ...loaded.query,
      semanticModel: semantic,
    };
    const saved = await request.post(`${api}/queries/save_query`, {
      headers: auth,
      data: {
        storage: 'local',
        project,
        branch: catalog.scope.branch,
        operationId: crypto.randomUUID(),
        ifMatch: loaded.revision,
        expectedBranchHead: loaded.branchHead,
        query: linkedQuery,
      },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    await page.reload();
    await expect(
      active().getByRole('button', { name: 'Delete field', exact: true }),
    ).toBeDisabled();
    await expect(active().getByText('Buyers', { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('02-reference-protected-field.png'),
      fullPage: true,
    });
    const beforeDelete = await request.get(endpoint('meanings/catalog'), {
      headers: auth,
    });
    catalog = await beforeDelete.json();
    const blocked = await request.post(`${api}/meanings/change`, {
      headers: auth,
      data: {
        storage: 'local',
        project,
        branch: catalog.scope.branch,
        operationId: crypto.randomUUID(),
        ifMatch: catalog.revision,
        change: {
          action: 'delete-field',
          entity: { documentId: 'project', conceptId: 'customer' },
          field: { documentId: 'project', conceptId: 'customer-id' },
        },
      },
    });
    expect(blocked.status()).toBe(409);
    const linkedRevision = await saved.json();
    const detached = { ...linkedRevision.query };
    delete detached.semanticModel;
    const removedRef = await request.post(`${api}/queries/save_query`, {
      headers: auth,
      data: {
        storage: 'local',
        project,
        branch: catalog.scope.branch,
        operationId: crypto.randomUUID(),
        ifMatch: linkedRevision.revision,
        expectedBranchHead: linkedRevision.branchHead,
        query: detached,
      },
    });
    expect(removedRef.ok(), await removedRef.text()).toBe(true);
    await page.reload();
    await active()
      .getByRole('button', { name: 'Delete field', exact: true })
      .click();
    await active().getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page).toHaveURL(/meanings\/entity\?/);
    await expect(
      active().getByText('No fields defined.', { exact: true }),
    ).toBeVisible();
    await active()
      .getByRole('button', { name: 'Delete entity', exact: true })
      .click();
    await active().getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page).toHaveURL(/\/meanings\?projectApi=local/);
    await expect(
      active().getByText(
        'No meanings could be resolved from the available project declarations.',
      ),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('03-empty-after-delete.png'),
      fullPage: true,
    });
    catalogResponse = await request.get(endpoint('meanings/catalog'), {
      headers: auth,
    });
    expect((await catalogResponse.json()).entities).toEqual([]);
  } finally {
    const exited = once(child, 'exit').catch(() => undefined);
    child.kill('SIGTERM');
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
