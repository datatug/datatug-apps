import { expect, test } from './helpers/demodb-guard';
import type { Request, Response } from '@playwright/test';
import { TEST_PREVIEW_PROJECT_ORIGIN } from '../src/app/checkout/checkout-config.mjs';
import {
  assertNoCredentialCapture,
  BUSINESS_PREVIEW_PROJECT_ENV,
  BUSINESS_PREVIEW_SKIP_MESSAGE,
  DEFAULT_BUSINESS_PREVIEW_PROJECT,
  hasBusinessPreviewBuyer,
  signInBusinessPreviewBuyer,
} from './fixtures/business-preview-buyer';
import { activePage } from './journey/helpers/active-page';

/**
 * Business shared project preview, live (plan product-cloud-runtimes, Task 28).
 *
 * A signed-in TEST Business buyer opens the pinned Business project in the
 * `business-preview` build of datatug-app (http://localhost:18782, the one
 * origin datatug-cloud-preview admits). The project must load from
 * datatug-cloud-preview, and a saved query in it must render.
 *
 * Opt-in: needs the designated TEST buyer in the environment and the deployed
 * datatug-cloud-preview (Stripe TEST keys only). Without the credentials every
 * case is skipped, never failed. It never enters a card, never clicks Pay, never
 * saves a query, and aborts every checkout and Stripe request.
 * Run it with `pnpm nx run datatug-app:e2e-business-preview`; see e2e/README.md.
 */

// The seven routes datatug-cloud-preview allow-lists (internal/preview,
// projectRequestAllowed). Everything else answers 404 on that origin by design.
const PREVIEW_PROJECT_ROUTES = [
  '/v0/datatug/projects/capabilities',
  '/v0/datatug/projects/project_summary',
  '/v0/datatug/projects/connection_catalog',
  '/v0/datatug/projects/branches',
  '/v0/datatug/queries/all_queries',
  '/v0/datatug/queries/query_revision',
  '/v0/datatug/queries/save_query',
];

const projectKey =
  process.env[BUSINESS_PREVIEW_PROJECT_ENV] || DEFAULT_BUSINESS_PREVIEW_PROJECT;
const [repo = '', owner = '', folder = ''] = projectKey.split('@');
// The canonical short address of a cloud (projectApi=cloud) GitHub project.
// The default branch has no ref in the address; the preview only serves `main`.
const PROJECT_PATH = `/project/github.com/${owner.toLowerCase()}/${repo.toLowerCase()}/${folder}`;
const PROJECT_QUERY = 'projectApi=cloud&branch=main';

test.skip(!hasBusinessPreviewBuyer(), BUSINESS_PREVIEW_SKIP_MESSAGE);

test.describe.configure({ mode: 'serial' });

const isProjectRoute = (url: URL) =>
  PREVIEW_PROJECT_ROUTES.includes(url.pathname);
const isRead = (method: string) => method === 'GET';
const DATATUG_API_PATH = '/v0/datatug/';

test('a signed-in TEST Business buyer opens the Business project from datatug-cloud-preview', async ({
  page,
}, testInfo) => {
  assertNoCredentialCapture(testInfo);

  // Nothing in this journey may reach a payment rail or telemetry.
  await page.route('**/v0/checkout/**', (route) => route.abort());
  await page.route(
    (url) =>
      url.hostname === 'stripe.com' || url.hostname.endsWith('.stripe.com'),
    (route) => route.abort(),
  );
  // Read-only, and only against datatug-cloud-preview: abort every DataTug API
  // call that is not a GET (save_query, create_project and anything else that
  // mutates), and every DataTug API call on another origin, so a wrong build
  // can never reach production. The aborted ones are also recorded and fail
  // the test below.
  const blocked: string[] = [];
  await page.route(
    (url) => url.pathname.startsWith(DATATUG_API_PATH),
    (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const read = isRead(request.method()) || request.method() === 'OPTIONS';
      if (read && url.origin === TEST_PREVIEW_PROJECT_ORIGIN)
        return route.fallback();
      blocked.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort();
    },
  );
  await page.route(
    /(?:sentry\.io|posthog\.com|google-analytics\.com)/,
    (route) => route.abort(),
  );

  await signInBusinessPreviewBuyer(page);

  const projectRequests: Request[] = [];
  const projectResponses: Response[] = [];
  const failedRequests: string[] = [];
  page.on('request', (request) => {
    if (isRead(request.method()) && isProjectRoute(new URL(request.url())))
      projectRequests.push(request);
  });
  page.on('response', (response) => {
    const request = response.request();
    if (isRead(request.method()) && isProjectRoute(new URL(response.url())))
      projectResponses.push(response);
  });
  page.on('requestfailed', (request) => {
    if (isRead(request.method()) && isProjectRoute(new URL(request.url())))
      failedRequests.push(new URL(request.url()).pathname);
  });

  const summary = page.waitForResponse((r) =>
    r
      .url()
      .startsWith(
        `${TEST_PREVIEW_PROJECT_ORIGIN}/v0/datatug/projects/project_summary`,
      ),
  );
  const [summaryResponse] = await Promise.all([
    summary,
    page.goto(`${PROJECT_PATH}?${PROJECT_QUERY}`),
  ]);
  expect(summaryResponse.status(), 'project_summary status').toBeLessThan(300);

  const allQueries = page.waitForResponse((r) =>
    r
      .url()
      .startsWith(
        `${TEST_PREVIEW_PROJECT_ORIGIN}/v0/datatug/queries/all_queries`,
      ),
  );
  const [queriesResponse] = await Promise.all([
    allQueries,
    page.goto(`${PROJECT_PATH}/-/queries?${PROJECT_QUERY}`),
  ]);
  expect(queriesResponse.status(), 'all_queries status').toBeLessThan(300);
  // Read the body while it is still retained for this navigation.
  const tree = (await queriesResponse.json()) as {
    items?: { id: string; title?: string }[];
    folders?: { id: string }[];
  };

  // Every project API call went to datatug-cloud-preview, and none failed.
  expect(blocked, 'DataTug API calls the guard had to abort').toEqual([]);
  expect(failedRequests, 'failed allow-listed requests').toEqual([]);
  expect(projectRequests.length).toBeGreaterThan(0);
  for (const request of projectRequests)
    expect(new URL(request.url()).origin, 'project API origin').toBe(
      TEST_PREVIEW_PROJECT_ORIGIN,
    );
  for (const response of projectResponses)
    expect(
      response.status(),
      `${new URL(response.url()).pathname} status`,
    ).toBeLessThan(300);

  // A saved query of the project renders: the first root query, or else the
  // first folder, of the all_queries tree the server returned.
  const first = tree.items?.[0];
  const label = first ? first.title || first.id : tree.folders?.[0]?.id;
  expect(
    label,
    'the project has at least one saved query or folder',
  ).toBeTruthy();
  await expect(
    activePage(page)
      .locator('sneat-datatug-queries-tab')
      .getByText(label as string, { exact: true })
      .first(),
  ).toBeVisible({ timeout: 30_000 });
});
