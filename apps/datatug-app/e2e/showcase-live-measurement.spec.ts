import { installShowcaseQueryDiagnostics } from './helpers/showcase-query-diagnostics';
import { type APIRequestContext, type Locator } from '@playwright/test';
import { expect, test } from './helpers/demodb-guard';
import {
  finalizeShowcaseMeasurement,
  installShowcaseMeasurementLedger,
} from './helpers/showcase-measurement-ledger';

const origin = 'https://datatug.app';
const boardURL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/board/showcase';
const expectedSubtree = 'b9743cc8f6306f8421abb0f98b188d10e0fb1b78';
const allThree = { orders: 1, countries: 1, comparison: 1 };
type Group = {
  country: string;
  northwind: number;
  chinook: number;
  index: number;
};

async function deploymentIdentity(
  request: APIRequestContext,
  expectedAppSHA: string,
) {
  const buildResponse = await request.get(origin + '/build-info.json', {
    maxRedirects: 0,
    timeout: 15_000,
  });
  expect(buildResponse.status()).toBe(200);
  expect(buildResponse.headers()['content-type']).toContain('application/json');
  const build = (await buildResponse.json()) as {
    gitHash?: string;
    version?: string;
    buildTimestamp?: string;
  };
  expect(build.gitHash).toBe(expectedAppSHA);
  const mainResponse = await request.get(
    'https://api.github.com/repos/datatug/datatug-demo-project/commits/main',
    { maxRedirects: 0, timeout: 15_000 },
  );
  expect(mainResponse.status()).toBe(200);
  const main = (await mainResponse.json()) as {
    sha: string;
    commit: { tree: { sha: string } };
  };
  expect(main.sha).toMatch(/^[0-9a-f]{40}$/);
  const treeResponse = await request.get(
    'https://api.github.com/repos/datatug/datatug-demo-project/git/trees/' +
      main.commit.tree.sha,
    { maxRedirects: 0, timeout: 15_000 },
  );
  expect(treeResponse.status()).toBe(200);
  const tree = (await treeResponse.json()) as {
    truncated?: boolean;
    tree: { path: string; type: string; sha: string }[];
  };
  expect(tree.truncated).not.toBe(true);
  const project = tree.tree.find((entry) => entry.path === 'demo-project-1');
  expect(project?.type).toBe('tree');
  expect(project?.sha).toBe(expectedSubtree);
  return {
    appsSHA: build.gitHash,
    version: build.version,
    buildTimestamp: build.buildTimestamp,
    demoMainSHA: main.sha,
    demoRootTreeSHA: main.commit.tree.sha,
    demoProjectTreeSHA: project?.sha,
  };
}

async function groups(paired: Locator): Promise<Group[]> {
  const items = paired.locator('.grouped-bars > li');
  const result: Group[] = [];
  for (let index = 0; index < (await items.count()); index++) {
    const item = items.nth(index);
    const values = (await item.locator('.exact-value').allTextContents()).map(
      (value) => Number(value.trim()),
    );
    expect(values).toHaveLength(2);
    expect(values.every(Number.isSafeInteger)).toBe(true);
    result.push({
      country: (await item.locator('strong').innerText()).trim(),
      northwind: values[0],
      chinook: values[1],
      index,
    });
  }
  return result;
}

async function monthlyData(race: Locator) {
  const trend = race.getByRole('region', {
    name: 'Monthly orders trend',
    exact: true,
  });
  await expect(trend).toContainText(
    '830 orders · 23 calendar months · orders per month',
  );
  await expect(trend).toContainText(
    'Country selection and race Top N do not change this overview.',
  );
  await expect(trend).toContainText(
    /Observed\s+OrderDate:\s+\d{4}-\d{2}-\d{2}[^–]*–\s*\d{4}-\d{2}-\d{2}/,
  );
  await expect(trend).toContainText(
    'Counts cover available sample dates; boundary months may be partial.',
  );
  const summary = trend
    .locator('summary')
    .filter({ hasText: /^Monthly data \(23 months\)$/ });
  await expect(summary).toBeVisible();
  if ((await summary.locator('..').getAttribute('open')) === null)
    await summary.click();
  const table = trend.getByRole('table', {
    name: 'All source orders per calendar month',
    exact: true,
  });
  await expect(table.locator('tbody tr')).toHaveCount(23);
  const months: { month: string; orders: number }[] = [];
  for (const row of await table.locator('tbody tr').all()) {
    const month = (await row.locator('th').innerText()).trim();
    const text = (await row.locator('td').innerText()).trim();
    expect(text).toMatch(/^\d+$/);
    months.push({ month, orders: Number(text) });
  }
  const expectedMonths = Array.from({ length: 23 }, (_, index) => {
    const date = new Date(Date.UTC(2016, 6 + index, 1));
    return date.toISOString().slice(0, 7);
  });
  expect(months.map((month) => month.month)).toEqual(expectedMonths);
  expect(months.reduce((sum, month) => sum + month.orders, 0)).toBe(830);
  await expect(table.locator('tfoot td')).toHaveText('830');
  return months;
}

test('bounded deployed showcase network and held-result measurement', async ({
  page,
  context,
  request,
}, testInfo) => {
  test.skip(
    process.env['DATATUG_E2E_MEASURE_LIVE'] !== '1',
    'explicit one-pass production read acceptance only',
  );
  const expectedAppSHA = process.env['DATATUG_E2E_EXPECT_APPS_SHA'] ?? '';
  expect(expectedAppSHA).toMatch(/^[0-9a-f]{40}$/);
  expect(testInfo.project.use.baseURL).toBe(origin);
  expect(testInfo.project.name).toBe('chromium');
  expect(testInfo.retry).toBe(0);
  expect(testInfo.repeatEachIndex).toBe(0);
  expect(testInfo.config.workers).toBe(1);
  expect(testInfo.project.retries).toBe(0);
  expect(testInfo.project.use.storageState).toEqual({
    cookies: [],
    origins: [],
  });
  expect(testInfo.project.use.trace).toBe('off');
  expect(testInfo.project.use.video).toBe('off');
  expect(process.env['DATATUG_E2E_GITHUB_FAKE']).toBeFalsy();
  expect(process.env['DATATUG_E2E_PUBLIC_OVDB_PROXY']).toBeFalsy();
  expect(process.env['DATATUG_E2E_SERVER_SHOWCASE']).toBeFalsy();
  const initialDiagnostic = process.env['DATATUG_E2E_DIAGNOSE_INITIAL'] === '1';
  const ledger = await installShowcaseMeasurementLedger(context, {
    maxQueries: initialDiagnostic ? 3 : 12,
  });
  let diagnostics:
    | Awaited<ReturnType<typeof installShowcaseQueryDiagnostics>>
    | undefined;
  const receipt: Record<string, unknown> = {
    observedAt: new Date().toISOString(),
    source: 'actual public production browser requests',
    origin,
    boardURL,
    expectedAppSHA,
    expectedSubtree,
    authentication: 'fresh anonymous context; no credential storage inspected',
    responseBodyCapture:
      'not required; no provider response replacement or body interception',
    encodedByteMeaning:
      'Playwright request.sizes responseBodySize; excludes response headers and transport overhead',
    cache:
      'HTTP cache disabled by Playwright routing guard; fresh context; service workers blocked',
    mode: initialDiagnostic ? 'initial-only-diagnostic' : 'full-measurement',
    queryCap: initialDiagnostic ? 3 : 12,
    queryCapAuthority: initialDiagnostic
      ? 'root approved initial-only diagnostic with enforced three-query cap'
      : 'root approved 12 after verifying the existing fourth tutorial query identity',
    phaseBudgets: initialDiagnostic
      ? { initial: 3 }
      : {
          initial: 3,
          interaction: 0,
          refresh: 1,
          tutorialMaterialization: 4,
          tutorialViewRevisit: 0,
          restartEmpty: 0,
          restartFirstCard: 1,
          showFull: 3,
        },
    dateCoverage:
      '23 calendar-month buckets July 2016 through May 2018; first/last buckets may cover partial months. No first/last raw OrderDate asserted.',
    limitations: [
      'No physical-device or reduced-motion claim; covered by focused fixtures.',
      'No authenticated copy, provider write, retry-fault injection, or inactive-tab execution claim.',
      'Zero request claims apply only to the observed bounded intervals.',
      'Encoded HTTP response-body bytes are not total network wire bytes.',
    ],
  };
  const timings: { action: string; observedMs: number }[] = [];
  const waitSettled = async () => {
    ledger.healthy();
    await expect
      .poll(
        () => {
          ledger.healthy();
          return ledger.summary().pendingQueries;
        },
        { timeout: 45_000 },
      )
      .toBe(0);
    // Fixed bounded observation window catches deferred execution after the visible render.
    await new Promise((resolve) => setTimeout(resolve, 400));
    await ledger.drain();
    ledger.healthy();
    expect(ledger.summary().pendingQueries).toBe(0);
  };
  const observedAction = async (name: string, action: () => Promise<void>) => {
    const before = ledger.summary().queryAttempts;
    const started = performance.now();
    await action();
    timings.push({ action: name, observedMs: performance.now() - started });
    await waitSettled();
    expect(
      ledger.summary().queryAttempts,
      name + ' executed another query',
    ).toBe(before);
  };
  const card = (title: string) =>
    page.locator('ion-card').filter({ hasText: title }).first();
  const paired = card('Customer records by shared country');
  const race = card('Where Northwind orders shipped');
  const inspector = card('Inspect saved query results');
  const fullReady = async () => {
    await expect(paired.locator('.grouped-bars > li')).toHaveCount(17, {
      timeout: 45_000,
    });
    await expect(race).toContainText('830 source orders');
    await expect(race).toContainText('23 monthly frames');
    await expect(inspector).toContainText('830 rows · 14 columns');
    await expect(card('Northwind orders by shipping country')).toContainText(
      '21 rows · 2 columns',
    );
  };
  try {
    if (initialDiagnostic)
      diagnostics = await installShowcaseQueryDiagnostics(context, page);
    receipt['identityBefore'] = await deploymentIdentity(
      request,
      expectedAppSHA,
    );
    ledger.phase('initial', 3, allThree);
    const started = performance.now();
    await page.goto(boardURL);
    await fullReady();
    receipt['automationObservedReadyMs'] = performance.now() - started;
    await waitSettled();
    const initial = ledger.rows.filter((row) => row.kind === 'query');
    expect(initial.map((row) => row.query).sort()).toEqual([
      'comparison',
      'countries',
      'orders',
    ]);
    expect(
      initial.every((row) => row.outcome === 'finished' && row.status === 200),
    ).toBe(true);
    expect(
      ledger.rows.filter(
        (row) => row.query === 'billing' || row.query === 'inspector-countries',
      ),
    ).toHaveLength(0);
    receipt['initialSummary'] = ledger.summary();
    receipt['initialQueries'] = initial.map((row) => ({ ...row }));
    if (initialDiagnostic) {
      receipt['identityAfter'] = await deploymentIdentity(
        request,
        expectedAppSHA,
      );
      ledger.healthy();
      receipt['status'] = 'PASS';
      return;
    }
    const original = await groups(paired);
    expect(original.find((group) => group.country === 'Canada')).toMatchObject({
      northwind: 3,
      chinook: 8,
    });
    expect(original.find((group) => group.country === 'USA')).toMatchObject({
      northwind: 13,
      chinook: 13,
    });
    expect(new Set(original.map((group) => group.country)).size).toBe(17);
    const firstOrder = await inspector
      .locator('table tbody tr')
      .first()
      .innerText();
    ledger.phase('interaction', 0);
    const order = paired.getByRole('combobox', {
      name: 'Chart order',
      exact: true,
    });
    const labelTie = (a: Group, b: Group) =>
      a.country < b.country
        ? -1
        : a.country > b.country
          ? 1
          : a.index - b.index;
    for (const option of ['country', 'series:0', 'series:1', 'difference']) {
      await observedAction('sort ' + option, async () => {
        await order.focus();
        await order.selectOption(option);
        await expect(order).toBeFocused();
        const expected = [...original].sort(
          (a, b) =>
            (option === 'series:0'
              ? b.northwind - a.northwind
              : option === 'series:1'
                ? b.chinook - a.chinook
                : option === 'difference'
                  ? b.northwind - b.chinook - (a.northwind - a.chinook)
                  : 0) || labelTie(a, b),
        );
        const values = (group: Group) => ({
          country: group.country,
          northwind: group.northwind,
          chinook: group.chinook,
        });
        expect((await groups(paired)).map(values)).toEqual(
          expected.map(values),
        );
      });
    }
    await observedAction('page scrolling and source evidence', async () => {
      const lastCountry = paired.locator('.grouped-bars > li').last();
      await lastCountry.scrollIntoViewIfNeeded();
      await expect(lastCountry).toBeInViewport();
      const overflow = await paired
        .locator('.grouped-bars')
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            verticalScroll:
              ['auto', 'scroll'].includes(style.overflowY) &&
              element.scrollHeight > element.clientHeight + 1,
          };
        });
      expect(overflow.verticalScroll).toBe(false);
      const details = paired.locator('.source-details');
      await details.locator('summary').click();
      await expect(details).toContainText(
        'https://cloud.openvaultdb.com/v1/tugql',
      );
    });
    await observedAction('keyboard Canada and selected rows', async () => {
      const canada = paired.getByRole('button', {
        name: 'Canada Northwind 3 Chinook 8',
        exact: true,
      });
      await canada.focus();
      await canada.press('Enter');
      await expect(canada).toBeFocused();
      await expect(paired).toContainText('Selected country: Canada');
      await expect(inspector).toContainText(
        '30 of 830 orders shipped to Canada',
      );
      await paired.getByRole('button', { name: 'Rows', exact: true }).click();
      await expect(paired.locator('table tbody tr')).toHaveCount(17);
      await expect(paired).toContainText('Selected country: Canada');
      await paired.getByRole('button', { name: 'Chart', exact: true }).click();
    });
    await observedAction('race settings and monthly trend', async () => {
      await race
        .getByRole('combobox', { name: 'Chart value mode' })
        .selectOption('cumulative');
      const top = race.getByRole('spinbutton', { name: 'Top', exact: true });
      await top.fill('5');
      await top.press('Tab');
      await race.getByRole('slider', { name: 'Choose month' }).fill('3');
      await race
        .getByRole('button', { name: 'Monthly trend', exact: true })
        .click();
      receipt['monthlyDataWithCountrySelectedAndTop5'] =
        await monthlyData(race);
      receipt['observedDateCoverageCaption'] = await race
        .getByRole('region', { name: 'Monthly orders trend' })
        .locator('p')
        .filter({ hasText: /^\s*Observed OrderDate:/ })
        .innerText();
      await expect(inspector).toContainText(
        '30 of 830 orders shipped to Canada',
      );
    });
    await observedAction('source rows and restored paused race', async () => {
      await race
        .getByRole('button', { name: 'Source rows', exact: true })
        .click();
      await expect(race.locator('table tbody tr')).toHaveCount(25);
      await race.getByRole('button', { name: 'Chart', exact: true }).click();
      await expect(
        race.getByRole('slider', { name: 'Choose month' }),
      ).toHaveValue('3');
      await expect(
        race.getByRole('spinbutton', { name: 'Top', exact: true }),
      ).toHaveValue('5');
      await expect(
        race.getByRole('combobox', { name: 'Chart value mode' }),
      ).toHaveValue('cumulative');
    });
    await observedAction('Clear and unchanged monthly totals', async () => {
      await paired
        .getByRole('button', { name: 'Clear country', exact: true })
        .click();
      await expect(inspector).toContainText('830 rows · 14 columns');
      await expect(inspector.locator('table tbody tr').first()).toHaveText(
        firstOrder,
      );
      await race
        .getByRole('button', { name: 'Monthly trend', exact: true })
        .click();
      expect(await monthlyData(race)).toEqual(
        receipt['monthlyDataWithCountrySelectedAndTop5'],
      );
      await race.getByRole('button', { name: 'Chart', exact: true }).click();
    });
    ledger.phase('refresh', 1, { comparison: 1 });
    const beforeRefresh = ledger.summary().queryAttempts;
    await paired
      .getByRole('button', { name: /^Refresh chart · / })
      .click();
    await expect
      .poll(() => ledger.summary().queryAttempts)
      .toBe(beforeRefresh + 1);
    await expect(paired.locator('.grouped-bars > li')).toHaveCount(17);
    await waitSettled();
    expect(
      ledger.rows.filter(
        (row) => row.phase === 'refresh' && row.kind === 'query',
      ),
    ).toHaveLength(1);

    ledger.phase('tutorial-materialization', 4, {
      ...allThree,
      'inspector-countries': 1,
    });
    await page.goto(boardURL + '?mode=tutorial');
    const tutorial = page.locator('.tutorial-panel');
    await expect(tutorial).toBeVisible();
    const next = tutorial
      .getByRole('group', { name: 'Tutorial steps' })
      .getByRole('button', { name: 'Next Step', exact: true });
    const previous = tutorial
      .getByRole('group', { name: 'Tutorial steps' })
      .getByRole('button', { name: 'Previous', exact: true });
    const indicator = tutorial.locator('.tutorial-step .tutorial-eyebrow');
    let sawTrend = false,
      revisitedTrend = false,
      sawSourceRows = false,
      sawPausedRace = false,
      sawCountries = false;
    const stages: string[] = [];
    const transitions: {
      actionCue: string;
      nextCue: string;
      queryDelta: number;
    }[] = [];
    for (let step = 0; step < 16; step++) {
      const title = (
        await tutorial.locator('.tutorial-step h3').innerText()
      ).trim();
      stages.push(title);
      if (title === 'Inspect the monthly trend') {
        // The heading describes the NEXT action. This cue still has the race visible.
        await expect(race).toContainText('830 source orders');
        await expect(
          race.getByRole('button', { name: 'Chart', exact: true }),
        ).toHaveAttribute('aria-pressed', 'true');
        await waitSettled();
        ledger.phase('tutorial-view-revisit', 0);
        await observedAction(
          'tutorial Next applies trend; Previous undoes; Next reapplies',
          async () => {
            const before = await indicator.innerText();
            await next.click();
            await expect(indicator).not.toHaveText(before);
            await expect(tutorial.locator('.tutorial-step h3')).toHaveText(
              'Inspect the source rows',
            );
            await monthlyData(race);
            await previous.click();
            await expect(tutorial.locator('.tutorial-step h3')).toHaveText(
              'Inspect the monthly trend',
            );
            await expect(
              race.getByRole('button', { name: 'Chart', exact: true }),
            ).toHaveAttribute('aria-pressed', 'true');
            await next.click();
            await expect(tutorial.locator('.tutorial-step h3')).toHaveText(
              'Inspect the source rows',
            );
            await monthlyData(race);
          },
        );
        // Remaining initial card identities have a fresh local allowance, but
        // cumulative tutorial first-materialization is checked separately below.
        ledger.phase('tutorial-materialization-rest', 3, {
          countries: 1,
          comparison: 1,
          'inspector-countries': 1,
        });
        sawTrend = true;
        revisitedTrend = true;
        transitions.push({
          actionCue: title,
          nextCue: 'Inspect the source rows',
          queryDelta: 0,
        });
        continue;
      }
      if (!(await next.isEnabled())) break;
      if (title === 'Inspect the source rows') await monthlyData(race);
      if (title === 'Return to the paused race')
        await expect(
          race.getByRole('button', { name: 'Source rows', exact: true }),
        ).toHaveAttribute('aria-pressed', 'true');
      const before = await indicator.innerText();
      const queryBefore = ledger.summary().queryAttempts;
      await next.click();
      await expect(indicator).not.toHaveText(before);
      if (title === 'Inspect the source rows') {
        await expect(
          race.getByRole('button', { name: 'Source rows', exact: true }),
        ).toHaveAttribute('aria-pressed', 'true');
        await expect(race.locator('table tbody tr')).toHaveCount(25);
        sawSourceRows = true;
      }
      if (title === 'Return to the paused race') {
        await expect(
          race.getByRole('button', { name: 'Chart', exact: true }),
        ).toHaveAttribute('aria-pressed', 'true');
        sawPausedRace = true;
      }
      if (title === 'Inspect Northwind · server countries') {
        await expect(inspector).toContainText('21 rows · 2 columns');
        sawCountries = true;
      }
      await waitSettled();
      transitions.push({
        actionCue: title,
        nextCue: (
          await tutorial.locator('.tutorial-step h3').innerText()
        ).trim(),
        queryDelta: ledger.summary().queryAttempts - queryBefore,
      });
      if (
        ['Inspect the source rows', 'Return to the paused race'].includes(title)
      )
        expect(ledger.summary().queryAttempts).toBe(queryBefore);
      if (step === 15) throw new Error('Tutorial exceeded the 16-stage bound');
    }
    expect(sawTrend).toBe(true);
    expect(revisitedTrend).toBe(true);
    expect(sawSourceRows).toBe(true);
    expect(sawPausedRace).toBe(true);
    expect(sawCountries).toBe(true);
    receipt['tutorialStages'] = stages;
    receipt['tutorialActionTransitions'] = transitions;
    // The existing tutorial deliberately demonstrates the distinct countries tab.
    // Switch back to already-held Orders before checking full-board equivalence.
    await inspector
      .getByRole('tab', { name: 'Northwind · server orders', exact: true })
      .click();
    await fullReady();
    await waitSettled();
    expect(
      ledger.rows.filter(
        (row) =>
          row.phase.startsWith('tutorial-materialization') &&
          row.kind === 'query',
      ).length,
    ).toBeLessThanOrEqual(4);
    ledger.phase('restart-empty', 0);
    await observedAction('tutorial Restart empty', async () => {
      await tutorial
        .getByRole('button', { name: 'Restart', exact: true })
        .click();
      await expect(
        page.getByRole('region', { name: 'Your empty tutorial canvas' }),
      ).toBeVisible();
    });
    ledger.phase('restart-first-card', 1, { orders: 1 });
    await tutorial
      .getByRole('button', { name: 'Add the first card', exact: true })
      .click();
    await expect(race).toContainText('830 source orders');
    await waitSettled();
    // Recreating the full board may retain Orders or rematerialize all three cards.
    ledger.phase('show-full', 3, allThree);
    await tutorial
      .getByRole('button', { name: 'Show Full Dashboard', exact: true })
      .click();
    await expect(tutorial).toHaveCount(0);
    await fullReady();
    await waitSettled();
    await expect(page).toHaveURL(origin + boardURL);
    expect(ledger.rows.filter((row) => row.query === 'billing')).toHaveLength(
      0,
    );
    receipt['identityAfter'] = await deploymentIdentity(
      request,
      expectedAppSHA,
    );
    ledger.healthy();
    receipt['status'] = 'PASS';
  } finally {
    let diagnosticFailure: Error | undefined;
    if (diagnostics) {
      try {
        const evidence = await diagnostics.finish();
        receipt['diagnostics'] = evidence;
        if (evidence.fetchUnavailable)
          diagnosticFailure = new Error('Fetch diagnostics were unavailable.');
      } catch {
        receipt['diagnostics'] = { unavailable: true };
        diagnosticFailure = new Error(
          'Query diagnostics could not be finalized.',
        );
      }
    }
    receipt['timings'] = timings;
    await finalizeShowcaseMeasurement(
      ledger,
      receipt,
      () =>
        testInfo.attach('actual-production-showcase-measurement', {
          body: JSON.stringify(receipt, null, 2),
          contentType: 'application/json',
        }),
      diagnosticFailure,
    );
  }
});
