import { expect, hasGuardRoute, test as guarded } from './helpers/demodb-guard';

/**
 * The guard's passive mode (no route, counters only) is a per-test option. These tests run in ONE worker, a passive one first:
 * with the old process-wide flag the passive module disabled the route for every later guarded spec of that worker
 * (cross-contamination), and the second and fourth tests failed.
 */
const passive = guarded.extend({ demodbPassive: [true, { option: true }] as never });

guarded.describe.configure({ mode: 'serial' });

let passiveWorker = -1;

passive('a passive test installs no route, on its own context or on one it creates', async ({ context, browser }, testInfo) => {
  passiveWorker = testInfo.workerIndex;
  expect(hasGuardRoute(context)).toBe(false);
  const own = await browser.newContext();
  expect(hasGuardRoute(own)).toBe(false);
  await own.close();
});

guarded('a guarded test that follows a passive one in the same worker still gets the route', async ({ context, browser }, testInfo) => {
  expect(testInfo.workerIndex, 'must share the worker with the passive test above').toBe(passiveWorker);
  expect(hasGuardRoute(context)).toBe(true);
  const own = await browser.newContext();
  expect(hasGuardRoute(own)).toBe(true);
  await own.close();
});

passive('passive again, after a guarded one', async ({ context }) => {
  expect(hasGuardRoute(context)).toBe(false);
});

guarded('and guarded again', async ({ context }) => {
  expect(hasGuardRoute(context)).toBe(true);
});

/**
 * Negative control for the dev server's public OVDB proxy (tools/public-ovdb-proxy.cjs): in fixture mode the lane's dev server
 * runs with DATATUG_PUBLIC_OVDB_UPSTREAM=refuse, answers a public OVDB route with 403 + x-datatug-ovdb-refused, and the guard
 * counts that as an escape, which fails the test. `test.fail()` makes this pass exactly when the guard fails it. If this test
 * "unexpectedly passes", the proxy is forwarding (a dev server started without the lane's environment, e.g. reused locally
 * outside CI) and the claim "public OVDB hosts are never reached" is not true for that run.
 */
guarded('the dev-server OVDB proxy answers 403 with the refusal header in fixture mode', async ({ request }) => {
  guarded.skip(process.env['DEMODB_E2E_MODE'] === 'live', 'live mode forwards by design');
  // A plain API request, not a browser context: it is not observed by the guard, so this asserts the proxy alone and stays a
  // normal test. (The negative control below runs under test.fail(), which would also pass on any unrelated failure.)
  const response = await request.get('/__datatug_public_ovdb/cloud/v1/databases/chinook-postgresql', { failOnStatusCode: false });
  expect(response.status()).toBe(403);
  expect(response.headers()['x-datatug-ovdb-refused'] ?? '').toContain('openvaultdb.com');
});

guarded('an app request through the dev-server OVDB proxy is refused and counted as an escape', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'demodb-expected-escape', description: 'negative control: the guard must flag this request' });
  guarded.skip(process.env['DEMODB_E2E_MODE'] === 'live', 'live mode forwards by design');
  guarded.fail();
  await page.goto('/');
  await page.evaluate(async () => {
    await fetch('/__datatug_public_ovdb/cloud/v1/databases/chinook-postgresql').catch(() => undefined);
  });
});
