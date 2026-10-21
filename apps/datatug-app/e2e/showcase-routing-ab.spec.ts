import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { type BrowserContext } from '@playwright/test';
import { expect, test } from './helpers/demodb-guard';
import { installNetworkDiagnostics } from './helpers/showcase-query-diagnostics';
import {
  CountriesRoutingBudget,
  configureCountriesRouting,
  consumeCountriesOnce,
  countriesEndpoint,
  countriesQuerySHA,
  inertDocument,
  type RoutingVariant,
} from './helpers/showcase-routing-ab';

test('opt-in inert-document Countries routing A/B diagnostic, not app acceptance', async ({
  browser,
  request,
}, testInfo) => {
  test.skip(
    process.env['DATATUG_E2E_MEASURE_LIVE'] !== '1' ||
      process.env['DATATUG_E2E_ROUTING_AB'] !== '1',
    'root-owned single two-query routing diagnostic only',
  );
  const budget = new CountriesRoutingBudget();
  const variants: Record<string, unknown>[] = [];
  const receipt: Record<string, unknown> = {
    mode: 'inert-document routing A/B; NOT app acceptance',
    querySHA: countriesQuerySHA,
    queryCap: 2,
    inertDocument,
    observer: 'passive bounded CDP only; no fetch wrapper/body observer',
    limitations: [
      'Fresh anonymous contexts; service workers blocked; no app JavaScript.',
      'Routing also disables HTTP cache; both POSTs use no-store. This isolates the routing mode, not every browser transport detail.',
      'Observer arrival timestamps can perturb timing. Fixed OFF then ON ordering is not randomized and cannot establish causality or app acceptance.',
    ],
  };
  let failed = false;
  let stage = 'prerequisites';
  try {
    expect(testInfo.project.name).toBe('chromium');
    expect(testInfo.retry).toBe(0);
    expect(testInfo.repeatEachIndex).toBe(0);
    expect(process.env['DATATUG_E2E_GITHUB_FAKE']).toBeFalsy();
    expect(process.env['DATATUG_E2E_PUBLIC_OVDB_PROXY']).toBeFalsy();
    const expectedAppSHA = process.env['DATATUG_E2E_EXPECT_APPS_SHA'] ?? '';
    expect(expectedAppSHA).toMatch(/^[0-9a-f]{40}$/);
    expect(
      execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
      }).trim(),
    ).toBe('');
    const consumerHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const query = (
      JSON.parse(
        readFileSync(
          resolve(
            'apps/datatug-app/e2e/fixtures/northwind-country-count-rights.json',
          ),
          'utf8',
        ),
      ) as { admission: { query: string } }
    ).admission.query;
    receipt['consumerHead'] = consumerHead;
    receipt['expectedAppSHA'] = expectedAppSHA;
    stage = 'identity';
    const response = await request.get('https://datatug.app/build-info.json', {
      timeout: 15_000,
      maxRedirects: 0,
    });
    expect(response.status()).toBe(200);
    const build = (await response.json()) as {
      gitHash?: string;
      version?: string;
    };
    expect(build.gitHash).toBe(expectedAppSHA);
    receipt['publicApps'] = {
      gitHash: build.gitHash,
      version:
        typeof build.version === 'string' &&
        /^[A-Za-z0-9.+-]{1,80}$/.test(build.version)
          ? build.version
          : 'other',
    };
    stage = 'variants';
    for (const variant of ['unrouted', 'continued'] as RoutingVariant[]) {
      const claimedQuery = budget.claim(variant, query); // Maximum two explicit calls, no retries.
      const row: Record<string, unknown> = { variant };
      variants.push(row);
      let context: BrowserContext | undefined;
      let diagnostics:
        | Awaited<ReturnType<typeof installNetworkDiagnostics>>
        | undefined;
      let posts = 0,
        unexpectedWrites = 0;
      try {
        context = await browser.newContext({
          storageState: { cookies: [], origins: [] },
          serviceWorkers: 'block',
        });
        context.on('request', (req) => {
          if (req.method() === 'POST' && req.url() === countriesEndpoint)
            posts++;
          else if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method()))
            unexpectedWrites++;
        });
        await configureCountriesRouting(context, variant);
        const page = await context.newPage();
        const session = await context.newCDPSession(page);
        try {
          diagnostics = await installNetworkDiagnostics(session);
        } catch (error) {
          await session.detach().catch(() => undefined);
          throw error;
        }
        await page.goto(inertDocument, { waitUntil: 'load', timeout: 30_000 });
        row['result'] = await page.evaluate(consumeCountriesOnce, claimedQuery);
        // Wait only for passive terminal metadata; never retry the provider request.
        await expect
          .poll(
            () =>
              diagnostics?.rows.filter(
                (entry) =>
                  entry.finishedAtMs !== undefined ||
                  entry.failedAtMs !== undefined,
              ).length,
            { timeout: 5_000 },
          )
          .toBe(1);
      } catch {
        row['setupOrEvaluationFailed'] = true;
        failed = true;
      } finally {
        row['network'] = diagnostics?.rows ?? [];
        await diagnostics?.dispose().catch(() => {
          row['cleanupFailed'] = true;
          failed = true;
        });
        await context?.close().catch(() => {
          row['cleanupFailed'] = true;
          failed = true;
        });
        row['postAttempts'] = posts;
        row['unexpectedWrites'] = unexpectedWrites;
        const result = row['result'] as { ok?: boolean } | undefined;
        if (
          !result?.ok ||
          posts !== 1 ||
          unexpectedWrites ||
          diagnostics?.rows.length !== 1 ||
          diagnostics.rows.some(
            (entry) =>
              entry.failedAtMs !== undefined ||
              entry.finishedAtMs === undefined,
          )
        ) {
          row['outcome'] = 'FAIL';
          failed = true;
        } else
          row['outcome'] =
            row['setupOrEvaluationFailed'] || row['cleanupFailed']
              ? 'FAIL'
              : 'PASS';
      }
    }
    stage = 'complete';
  } catch {
    failed = true;
    receipt['enabledRunFailureStage'] = stage;
  } finally {
    receipt['variants'] = variants;
    receipt['guardClaims'] = budget.snapshot();
    receipt['status'] = failed || variants.length !== 2 ? 'FAIL' : 'PASS';
    await testInfo.attach('actual-inert-countries-routing-ab', {
      body: JSON.stringify(receipt, null, 2),
      contentType: 'application/json',
    });
  }
  expect(receipt['status']).toBe('PASS');
});
