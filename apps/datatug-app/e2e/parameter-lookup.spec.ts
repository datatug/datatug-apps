import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, expect } from './helpers/demodb-guard';
import { installFakeGithub } from './helpers/fake-github';
import { activePage } from './journey/helpers/active-page';

/**
 * Parameter lookup picker, anonymous visitor, real browser SQLite
 * (datatug/backstage spec/features/parameter-lookup: AC keyboard-only-pick,
 * AC pick-returns-typed-key, AC anonymous-visitor-can-pick).
 *
 * The pinned demo checkout predates the Northwind customer queries, so this
 * spec serves a copy of it with the real Act 1 files of the demo project
 * added (fixtures/parameter-lookup, copied verbatim at f81ca04): the saved
 * query `northwind/customer-by-id`, whose `CustomerID` parameter means
 * `Customer.ID`, and the `Customer` entity keyed by Northwind's text
 * `Customers.CustomerID` with `display`. Bumping the shared demo pin instead
 * would change the data under every other e2e lane. The rows come from the
 * app's own pinned `assets/showcase/northwind.sqlite`.
 */

const QUERY_URL =
  '/project/github.com/datatug/datatug-demo-project/demo-project-1/-/query/northwind%2Fcustomer-by-id?id=northwind%2Fcustomer-by-id&env=dev';

// Verbatim copies of datatug/datatug-demo-project at f81ca04 (after #83), the commit that added these files.
const FIXTURES = join(__dirname, 'fixtures', 'parameter-lookup');
const OVERLAY: Record<string, string> = Object.fromEntries([
  ['demo-project-1/entities/Customer/Customer.entity.json', 'Customer.entity.json'],
  ['demo-project-1/queries/northwind/customer-by-id.query.json', 'customer-by-id.query.json'],
  ['demo-project-1/queries/northwind/customer-by-id.query.sql', 'customer-by-id.query.sql'],
].map(([path, file]) => [path, readFileSync(join(FIXTURES, file), 'utf8')]));

/** A throwaway git repository: the base checkout's tracked files plus OVERLAY, committed with plumbing only. */
function lookupDemoRepository(base: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'datatug-parameter-lookup-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'e2e', GIT_AUTHOR_EMAIL: 'e2e@example.invalid', GIT_COMMITTER_NAME: 'e2e', GIT_COMMITTER_EMAIL: 'e2e@example.invalid' },
  }).trim();
  const archive = join(mkdtempSync(join(tmpdir(), 'datatug-parameter-lookup-tar-')), 'base.tar');
  execFileSync('git', ['-C', base, 'archive', '--format=tar', '-o', archive, 'HEAD']);
  execFileSync('tar', ['-x', '-f', archive, '-C', dir]);
  for (const [path, text] of Object.entries(OVERLAY)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git('init', '-q');
  git('add', '-A');
  const tree = git('write-tree');
  const commit = git('commit-tree', tree, '-m', 'parameter lookup e2e fixture');
  git('update-ref', 'HEAD', commit);
  return dir;
}

test('an anonymous visitor picks BOTTM for @CustomerID with the keyboard, and nothing runs', async ({ context, page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(20_000);
  const base = process.env['DATATUG_E2E_GITHUB_FAKE'];
  test.skip(!base, 'needs the pinned demo checkout (DATATUG_E2E_GITHUB_FAKE)');
  await installFakeGithub(context, [{ fullName: 'datatug/datatug-demo-project', dir: lookupDemoRepository(base as string) }]);

  const fixtureDownloads: string[] = [];
  const writes: string[] = [];
  let workers = 0;
  page.on('worker', () => workers++);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/assets/showcase/northwind.sqlite') fixtureDownloads.push(url.pathname);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && url.origin === new URL(page.url() || 'http://x').origin)
      writes.push(`${request.method()} ${url.pathname}`);
  });

  await page.goto(QUERY_URL);
  const host = activePage(page);
  await host.getByTestId('workspace-parameters-tab').click();
  const button = host.getByTestId('parameter-lookup-button');
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('title', 'Find CustomerID');
  const workersBeforeOpen = workers;
  expect(fixtureDownloads).toEqual([]);

  // Keyboard only: focus the [...] button and open it with Enter.
  // Keyboard: Tab from the input lands on the [...] button (REQ:accessible-picker), Enter opens it.
  await host.getByLabel('CustomerID value', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(button.locator('button')).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.locator('ion-modal').filter({ visible: true });
  const searchbar = dialog.getByTestId('parameter-lookup-filter').locator('input');
  await expect(searchbar).toBeFocused();
  await expect(dialog.getByTestId('parameter-lookup-row')).toHaveCount(50);
  await expect(dialog.getByTestId('parameter-lookup-status')).toContainText('Showing the first 50 matches');
  await expect(dialog).toContainText('Northwind sample, pinned');
  await expect(dialog).not.toContainText('Columns guessed');
  // The demo entity declares display: CompanyName, ContactName, City, headed in plain words.
  await expect(dialog).toContainText('Company name');
  await expect(dialog).toContainText('Contact name');

  await page.keyboard.type('bott');
  const rows = dialog.getByTestId('parameter-lookup-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('BOTTM');
  await expect(rows.first()).toContainText('Bottom-Dollar Markets');

  // Move to the row with the keyboard and pick it with Enter.
  await rows.first().locator('ion-radio').focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);

  const input = host.getByLabel('CustomerID value', { exact: true });
  await expect(input).toHaveValue('BOTTM');
  await expect(host.getByText('from lookup')).toBeVisible();
  await expect(button.locator('button')).toBeFocused();

  // Nothing ran: no result grid, no write request, one fixture download and one worker for the dialog.
  await expect(page.getByRole('grid')).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(fixtureDownloads).toHaveLength(1);
  expect(workers - workersBeforeOpen).toBeLessThanOrEqual(1);
});
