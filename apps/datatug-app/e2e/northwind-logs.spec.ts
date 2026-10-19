import { expect, test } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';

const appOrigin = `http://127.0.0.1:${process.env['DATATUG_LOGS_E2E_PORT'] ?? '4342'}`;
const adapterPort = Number(process.env['DATATUG_LOGS_ADAPTER_PORT'] ?? '6832');
const adapterOrigin = `http://127.0.0.1:${adapterPort}`;
const demoProject = process.env['DATATUG_DEMO_PROJECT_DIR'];
const adapterRepo = process.env['DALGO2LOGS_REPO'];
const adapterUrl = `${adapterOrigin}/v1/databases/northwind_evidence`;
let scratchDir: string | undefined;
let adapter: ChildProcess | undefined;
let startupStderr = '';
let adapterReady = false;

async function assertAdapterPortIsFree(): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', (error) => {
      rejectListen(
        new Error(
          `Refusing to reuse or stop an existing OVDB server on 127.0.0.1:6832; stop it and retry (${error.message}).`,
        ),
      );
    });
    server.listen(adapterPort, '127.0.0.1', () => resolveListen());
  });
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

function assertAdapterIsRunning(): void {
  if (adapter && (adapter.exitCode !== null || adapter.signalCode !== null)) {
    const stderr = startupStderr.trim();
    throw new Error(
      `The local OVDB adapter stopped${adapter.exitCode !== null ? ` with code ${adapter.exitCode}` : ` after signal ${adapter.signalCode}`}${stderr ? `; startup stderr: ${stderr}` : ''}.`,
    );
  }
}

function waitForAdapterExit(): Promise<void> {
  if (!adapter || adapter.exitCode !== null || adapter.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolveExit) =>
    adapter?.once('exit', () => resolveExit()),
  );
}

async function waitForAdapter(): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError = 'adapter did not answer';

  while (Date.now() < deadline) {
    assertAdapterIsRunning();

    try {
      const response = await fetch(adapterUrl);
      if (response.ok) return;
      lastError = `adapter returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }

  assertAdapterIsRunning();
  throw new Error(
    `The local OVDB adapter did not become ready: ${lastError}${startupStderr.trim() ? `; startup stderr: ${startupStderr.trim()}` : ''}`,
  );
}

test.describe('Northwind order log investigation with the real local OVDB adapter', () => {
  test.skip(
    !demoProject || !adapterRepo,
    'Set DATATUG_DEMO_PROJECT_DIR and DALGO2LOGS_REPO to enable the local Northwind logs journey.',
  );

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    if (!demoProject || !adapterRepo) return;
    const configPath = resolve(
      demoProject,
      'demo-project-1/fixtures/logs/ovdb-direct.json',
    );
    const adapterConfig = JSON.parse(readFileSync(configPath, 'utf8')) as {
      listen: string;
      sources: { corsOrigins: string[]; [key: string]: unknown };
    };
    expect(adapterConfig.listen).toBe('127.0.0.1:6832');
    expect(adapterConfig.sources.corsOrigins).toContain(
      'http://127.0.0.1:4200',
    );

    const corsOrigins = [
      ...new Set([
        ...adapterConfig.sources.corsOrigins,
        appOrigin,
        `http://localhost:${new URL(appOrigin).port}`,
      ]),
    ];
    const tempConfig = {
      ...adapterConfig,
      listen: `127.0.0.1:${adapterPort}`,
      sources: { ...adapterConfig.sources, corsOrigins },
    };

    scratchDir = mkdtempSync(join(tmpdir(), 'dalgo2logs-northwind-e2e-'));
    const tempConfigPath = join(scratchDir, 'ovdb-direct.json');
    const binaryPath = join(scratchDir, 'dalgo2logs-ovdb');
    writeFileSync(tempConfigPath, `${JSON.stringify(tempConfig, null, 2)}\n`, {
      mode: 0o600,
    });

    execFileSync(
      'go',
      ['-C', adapterRepo, 'build', '-o', binaryPath, './cmd/dalgo2logs-ovdb'],
      { env: { ...process.env, GOWORK: 'off' }, stdio: 'pipe' },
    );
    await assertAdapterPortIsFree();
    adapter = spawn(binaryPath, ['--config', tempConfigPath], {
      cwd: demoProject,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    adapter.stderr?.setEncoding('utf8');
    adapter.stderr?.on('data', (chunk: string) => {
      // Keep diagnostics bounded and only retain startup output. Adapter
      // request logs can contain fixture payloads, so discard after ready.
      if (!adapterReady && startupStderr.length < 512) {
        startupStderr = `${startupStderr}${chunk}`.slice(0, 512);
      }
    });
    adapter.once('error', (error) => {
      if (!adapterReady && startupStderr.length < 512) {
        startupStderr = `${startupStderr}${error.message}`.slice(0, 512);
      }
    });
    await waitForAdapter();

    const descriptorResponse = await fetch(adapterUrl);
    assertAdapterIsRunning();
    const descriptor = (await descriptorResponse.json()) as {
      id: string;
      collections: string[];
    };
    expect(descriptor.id).toBe('northwind_evidence');
    expect(descriptor.collections).toEqual(
      expect.arrayContaining(['fulfillment_events', 'carrier_events']),
    );
    assertAdapterIsRunning();
    adapterReady = true;
    startupStderr = '';
  });

  test.afterAll(async () => {
    if (adapter && adapter.exitCode === null && adapter.signalCode === null) {
      const exited = waitForAdapterExit();
      adapter.kill('SIGTERM');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const gracefulExit = await Promise.race([
        exited.then(() => true),
        new Promise<boolean>((resolveTimeout) => {
          timer = setTimeout(() => resolveTimeout(false), 3_000);
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (
        !gracefulExit &&
        adapter.exitCode === null &&
        adapter.signalCode === null
      ) {
        const forcedExit = waitForAdapterExit();
        adapter.kill('SIGKILL');
        await forcedExit;
      }
    }
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ page }) => {
    if (adapterPort !== 6832) {
      await page.route('http://127.0.0.1:6832/**', async route => {
        const response = await route.fetch({ url: route.request().url().replace('http://127.0.0.1:6832', adapterOrigin) });
        await route.fulfill({ response });
      });
    }
  });

  test('filters six real fixture events, narrows severity, opens source details, and handles noise/empty orders', async ({
    page,
  }, testInfo) => {
    const response = await page.request.get(adapterUrl);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain('northwind_evidence');

    await page.goto('/demo/logs?order=11039');
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Why did order 11039 remain unshipped?',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: '6 entries' }),
    ).toBeVisible();
    const timeline = page.getByRole('grid', { name: 'Log evidence entries', exact: true });
    await expect(timeline).toHaveAttribute('aria-describedby', 'log-grid-help');
    await expect(timeline.getByRole('columnheader')).toHaveText(['Timestamp', 'Severity', 'Service', 'Source', 'Message']);
    await expect(timeline.locator('.ag-row')).toHaveCount(6);
    await expect(timeline).toContainText(
      'United Package label request failed with HTTP 503',
    );
    await expect(timeline).toContainText('retry_budget=0');
    await expect(timeline).toContainText(
      'Shipment update deferred; ShippedDate remains unset',
    );

    await timeline
      .getByRole('row', {
        name: /ERROR.*United Package label request failed with HTTP 503/,
      })
      .click();
    const errorDetails = page.locator('.entry-details').first();
    await expect(errorDetails).toContainText('nw-11039-f1');
    await expect(errorDetails).toContainText(
      'northwind_evidence:fulfillment_events:',
    );
    await expect(errorDetails).toContainText('Original file entry');
    await expect(errorDetails.locator('pre').first()).toContainText(
      'retryable',
    );

    await timeline
      .getByRole('row', {
        name: /WARN.*Retryable carrier failure treated as terminal/,
      })
      .click();
    await expect(page.locator('.entry-details').last()).toContainText(
      'retry_budget=0',
    );

    await timeline.screenshot({ path: testInfo.outputPath('log-grid-desktop.png') });
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(timeline).toBeVisible();
    expect(await timeline.evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(375);
    await timeline.screenshot({ path: testInfo.outputPath('log-grid-mobile.png') });
    const focusedCell = timeline.locator('.ag-row').first().locator('[role="gridcell"]').first();
    await focusedCell.focus();
    await focusedCell.press('Enter');
    const selectedRow = timeline.locator('.ag-row').first();
    await expect(selectedRow).toHaveAttribute('aria-selected', 'true');
    await expect(timeline.locator('.ag-row[aria-selected="true"]')).toHaveCount(1);
    await expect(page.locator('.entry-details')).toContainText('Shipment update deferred');
    await focusedCell.press('Space');
    await expect(selectedRow).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('.entry-details')).toHaveCount(0);
    await focusedCell.press('Space');
    await expect(selectedRow).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.entry-details')).toContainText('Shipment update deferred');
    await page.setViewportSize({ width: 1280, height: 720 });
    const severity = page.getByLabel('Severity');
    await severity.selectOption('ERROR');
    await page.getByRole('button', { name: 'Find evidence' }).click();
    await expect(page.locator('.log-grid .ag-row')).toHaveCount(1);
    await expect(page.locator('.log-grid')).toContainText('ERROR');
    await expect(page.locator('.log-grid')).not.toContainText('WARN');

    await severity.selectOption('WARN');
    await page.getByRole('button', { name: 'Find evidence' }).click();
    await expect(page.locator('.log-grid .ag-row')).toHaveCount(1);
    await expect(page.locator('.log-grid')).toContainText('retry_budget=0');

    await severity.selectOption('');
    const sourceSettings = page.locator('details.source-settings');
    await sourceSettings.locator('summary').click();
    await sourceSettings.getByLabel('Collection').fill('carrier_events');
    await page.getByRole('button', { name: 'Find evidence' }).click();
    await expect(page.locator('.log-grid .ag-row')).toHaveCount(2);
    await page
      .locator('.log-grid')
      .getByRole('row', { name: /ERROR.*Carrier returned HTTP 503/ })
      .click();
    await expect(page.locator('.entry-details').last()).toContainText(
      'at CarrierClient.createLabel(CarrierClient.java:91)',
    );

    await sourceSettings.getByLabel('Collection').fill('fulfillment_events');
    await page.getByLabel('Order ID').fill('11040');
    await page.getByRole('button', { name: 'Find evidence' }).click();
    await expect(page).toHaveURL(/\/demo\/logs\?order=11040$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Order 11040 evidence' }),
    ).toBeVisible();
    await expect(page.locator('.log-grid .ag-row')).toHaveCount(1);

    await page.getByLabel('Order ID').fill('99999');
    await page.getByRole('button', { name: 'Find evidence' }).click();
    await expect(page).toHaveURL(/\/demo\/logs\?order=99999$/);
    await expect(page.getByRole('status')).toContainText(
      'No entries matched this bounded query.',
    );
  });

  test('follows the selected order record URL and browser back returns to the same order timeline', async ({
    page,
  }) => {
    await page.goto('/demo/logs?order=11039');
    await expect(page.locator('.log-grid .ag-row')).toHaveCount(6);

    const orderLink = page.getByRole('link', { name: 'Open the order record' });
    await expect(orderLink).toHaveAttribute(
      'href',
      '/demo/sqlite/northwind/table/Orders?record=11039',
    );
    await orderLink.click();
    await expect(page).toHaveURL(
      /\/demo\/sqlite\/northwind\/table\/Orders\?record=11039$/,
    );

    // This asserts the record link and route only. The browser SQLite fixture
    // is a separately pinned public download and is not part of this test.
    await page.goBack({ waitUntil: 'commit' });
    await expect(page).toHaveURL(/\/demo\/logs\?order=11039$/);
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Why did order 11039 remain unshipped?',
      }),
    ).toBeVisible();
    await expect(page.locator('.log-grid .ag-row')).toHaveCount(6);
  });
});
