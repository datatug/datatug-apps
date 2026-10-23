import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';

const enabled = process.env['DATATUG_CONTEXT_BAG_PROVIDER_TEST'] === '1';
const dryRun = process.env['DATATUG_CONTEXT_BAG_PROVIDER_DRY_RUN'] === '1';
const providersStorageKey = 'datatug.chat.providers.v1';
const selectedProviderStorageKey = 'datatug.chat.selected-provider.v1';
const sourceWorkerStorageKey = 'context-bag-provider-source-worker-count';
const appOrigin = 'http://datatug.localhost:8181';
const projectId = 'context-native-fixture';
const environmentId = 'local';

function cliMutation(requestUrl: string, method: string): boolean {
  try {
    const url = new URL(requestUrl);
    return (
      url.origin === 'http://127.0.0.1:8989' &&
      url.pathname === '/datatug/session-context/commands' &&
      method === 'POST'
    );
  } catch {
    return false;
  }
}

function cliApiPath(requestUrl: string, pathname: string): boolean {
  try {
    const url = new URL(requestUrl);
    return url.origin === 'http://127.0.0.1:8989' && url.pathname === pathname;
  } catch {
    return false;
  }
}

function isDeepSeekCompletion(requestUrl: string): boolean {
  try {
    const url = new URL(requestUrl);
    return (
      url.origin === 'https://api.deepseek.com' &&
      /(?:\/v1)?\/chat\/completions$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function publicError(value: unknown): { code?: string; message?: string } {
  if (!value || typeof value !== 'object') return {};
  const body = value as Record<string, unknown>;
  const candidate =
    body['error'] && typeof body['error'] === 'object'
      ? (body['error'] as Record<string, unknown>)
      : body;
  const safe = (item: unknown): string | undefined =>
    typeof item === 'string'
      ? item
          .replace(/https?:\/\/\S+/g, '[url]')
          .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
          .slice(0, 180)
      : undefined;
  return { code: safe(candidate['code']), message: safe(candidate['message']) };
}

function createProjectLink(): string {
  const binary = process.env['DATATUG_BIN'];
  if (!binary)
    throw new Error('Set DATATUG_BIN to the approved native CLI binary.');
  const childEnv = {
    ...process.env,
    DATATUG_UI_BASE: appOrigin,
    DATATUG_TELEMETRY: '0',
    DO_NOT_TRACK: '1',
  };
  delete childEnv['DEEPSEEK_API_KEY'];
  delete childEnv['DATATUG_CONTEXT_BAG_PROVIDER_KEY'];
  const result = spawnSync(
    binary,
    [
      'daemon',
      'url',
      '--format',
      'text',
      '--project',
      projectId,
      '--env',
      environmentId,
      '--db',
      'chinook',
      '--table',
      'Invoice',
    ],
    { encoding: 'utf8', env: childEnv, timeout: 20_000 },
  );
  if (result.error || result.status !== 0)
    throw new Error('The native CLI could not mint a project link.');
  const linkLine = result.stdout
    .split(/\r?\n/)
    .find((line) => /^https?:\/\/\S+$/.test(line.trim()));
  if (!linkLine)
    throw new Error('The native CLI did not return a project link.');
  try {
    const link = new URL(linkLine.trim());
    if (link.origin !== appOrigin) throw new Error('unexpected origin');
    return link.toString();
  } catch {
    throw new Error('The native CLI returned an invalid project link.');
  }
}

test.describe(`${dryRun ? 'stub-provider' : 'real-provider'} Context Bag journey`, () => {
  test.skip(
    !enabled,
    'Set DATATUG_CONTEXT_BAG_PROVIDER_TEST=1 to run the real-provider journey.',
  );

  test(`${dryRun ? 'stub provider' : 'real DeepSeek'} pins Invoice revision, queries local SQLite, and restores immutable history`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(20_000);

    let providerCalls = 0;
    const providerStatuses: number[] = [];
    let sessionCreateStatus: number | undefined;
    let commandScopeKeys: string[] = [];
    let capabilityEnvironmentKeys: string[] = [];
    let sessionCreateError: { code?: string; message?: string } = {};
    let pinnedInputId: string | undefined;
    let providerReceipt: string | undefined;
    let sourceWorkerCount: number | undefined;
    let initialRevisionId: string | undefined;
    let providerRequestFacts:
      | {
          hasContextData: boolean;
          inputSnapshotId?: string;
          revisionIds: string[];
          entryCount: number;
          bodyHasInvoiceId1: boolean;
          bodyHasInvoiceId2: boolean;
        }
      | undefined;
    page.on('request', (request) => {
      if (!cliMutation(request.url(), request.method())) return;
      try {
        const body = request.postDataJSON() as Record<string, unknown>;
        if (
          body['action'] === 'putEntry' &&
          !initialRevisionId &&
          typeof body['revisionId'] === 'string'
        )
          initialRevisionId = body['revisionId'];
        const scope = body['scope'] as Record<string, unknown> | undefined;
        commandScopeKeys = scope ? Object.keys(scope).sort() : [];
      } catch {
        commandScopeKeys = ['non-JSON request body'];
      }
    });
    page.on('request', (request) => {
      if (isDeepSeekCompletion(request.url()) && request.method() === 'POST') {
        providerCalls++;
        try {
          const body = request.postDataJSON() as {
            messages?: { role?: unknown; content?: unknown }[];
          };
          const userMessage = body.messages?.find(
            (message) => message.role === 'user',
          );
          if (typeof userMessage?.content !== 'string')
            throw new Error('Missing structured user message');
          const content = JSON.parse(userMessage.content) as {
            contextData?: {
              inputSnapshotId?: unknown;
              entries?: {
                revisionId?: unknown;
                fieldId?: unknown;
                scalar?: { type?: unknown; value?: unknown };
              }[];
            };
          };
          const context = content.contextData;
          const entries = Array.isArray(context?.entries)
            ? context.entries
            : [];
          const invoiceValues = entries
            .filter(
              (entry) =>
                entry.fieldId === 'InvoiceId' &&
                entry.scalar?.type === 'integer',
            )
            .map((entry) => String(entry.scalar?.value));
          providerRequestFacts = {
            hasContextData: !!context,
            inputSnapshotId:
              typeof context?.inputSnapshotId === 'string'
                ? context.inputSnapshotId
                : undefined,
            revisionIds: entries.flatMap((entry) =>
              typeof entry.revisionId === 'string' ? [entry.revisionId] : [],
            ),
            entryCount: entries.length,
            bodyHasInvoiceId1: invoiceValues.includes('1'),
            bodyHasInvoiceId2: invoiceValues.includes('2'),
          };
        } catch {
          providerRequestFacts = undefined;
        }
      }
    });
    page.on('response', (response) => {
      if (
        cliApiPath(response.url(), '/datatug/session-context/capabilities') &&
        response.status() === 200
      ) {
        void response
          .json()
          .then((body: { environments?: Array<Record<string, unknown>> }) => {
            const scope = body.environments?.find(
              (item) => item['environmentId'] === 'local',
            );
            capabilityEnvironmentKeys = scope ? Object.keys(scope).sort() : [];
          })
          .catch(() => undefined);
      }
      if (cliMutation(response.url(), response.request().method())) {
        sessionCreateStatus = response.status();
        if (response.status() >= 400) {
          void response
            .json()
            .then((body: unknown) => {
              sessionCreateError = publicError(body);
            })
            .catch(() => undefined);
        }
      }
      if (
        isDeepSeekCompletion(response.url()) &&
        response.request().method() === 'POST'
      )
        providerStatuses.push(response.status());
    });
    await page.addInitScript((workerCountKey) => {
      const originalPostMessage = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (
        this: Worker,
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ) {
        if (
          message &&
          typeof message === 'object' &&
          'sql' in message &&
          typeof message.sql === 'string' &&
          'bindings' in message &&
          Array.isArray(message.bindings)
        ) {
          sessionStorage.setItem(
            workerCountKey,
            String(Number(sessionStorage.getItem(workerCountKey) || '0') + 1),
          );
        }
        return Reflect.apply(
          originalPostMessage,
          this,
          options === undefined ? [message] : [message, options],
        );
      };
    }, sourceWorkerStorageKey);
    try {
      if (dryRun) {
        await page.route('https://api.deepseek.com/**', (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      dtql: {
                        from: { schema: 'main', name: 'InvoiceLine' },
                        where: {
                          op: '==',
                          left: { field: 'InvoiceId' },
                          right: { value: 1 },
                        },
                        limit: 100,
                      },
                    }),
                  },
                },
              ],
            }),
          }),
        );
      }
      const projectLink = createProjectLink();
      try {
        await page.goto(projectLink);
      } catch {
        throw new Error('Could not open the native CLI project link.');
      }
      await expect(page.locator('body')).toContainText('Invoice', {
        timeout: 60_000,
      });
      const providerKey = dryRun
        ? 'synthetic-offline-ui-test-key'
        : process.env['DATATUG_CONTEXT_BAG_PROVIDER_KEY'] ||
          process.env['DEEPSEEK_API_KEY'];
      if (!providerKey)
        throw new Error(
          'Set DEEPSEEK_API_KEY or DATATUG_CONTEXT_BAG_PROVIDER_KEY in the test process.',
        );
      const sessionsMenuItem = page
        .locator('ion-item[button]')
        .filter({ hasText: /^Sessions$/ });
      await expect(sessionsMenuItem).toBeVisible({ timeout: 30_000 });
      await sessionsMenuItem.click();
      await expect(
        page.getByRole('button', { name: 'New session' }),
      ).toBeEnabled({ timeout: 60_000 });
      await page.getByRole('button', { name: 'New session' }).click();
      const createDialog = page
        .locator('ion-modal')
        .filter({ hasText: 'New session' });
      await createDialog
        .getByLabel('Title')
        .fill('Provider pinned invoice journey');
      await createDialog.locator('ion-select[label="Environment"]').click();
      const environmentAlert = page.locator(
        'ion-alert.select-alert.single-select-alert',
      );
      await expect(environmentAlert).toBeVisible();
      await page.getByRole('radio', { name: 'local', exact: true }).click();
      await page.getByRole('button', { name: 'OK', exact: true }).click();
      await expect(environmentAlert).toBeHidden({ timeout: 10_000 });
      await createDialog
        .getByRole('button', { name: 'Create session' })
        .click();
      try {
        await expect(page).toHaveURL(/\/sessions\/[A-Za-z0-9_-]+\/overview$/);
      } catch {
        throw new Error(
          `Session creation failed before provider setup: ${JSON.stringify({ status: sessionCreateStatus, commandScopeKeys, capabilityEnvironmentKeys, error: sessionCreateError })}`,
        );
      }
      await expect(page.locator('#main-content')).not.toHaveAttribute(
        'aria-hidden',
        'true',
      );

      try {
        await page.getByRole('button', { name: /Context ·/ }).click();
      } catch {
        const blockedUi = await page.evaluate(() => ({
          routerOutlets: Array.from(
            document.querySelectorAll('ion-router-outlet'),
          ).map((outlet) => ({
            className: outlet.className,
            inert: outlet.hasAttribute('inert'),
            ariaHidden: outlet.getAttribute('aria-hidden'),
          })),
          contextButton: Array.from(document.querySelectorAll('ion-button'))
            .find((button) => (button.textContent || '').includes('CONTEXT'))
            ?.outerHTML.slice(0, 500),
          activeOverlays: Array.from(
            document.querySelectorAll(
              'ion-modal.show-modal, ion-alert.show-modal',
            ),
          ).map((overlay) => overlay.tagName.toLowerCase()),
        }));
        throw new Error(
          `Context toolbar remained inaccessible: ${JSON.stringify(blockedUi)}`,
        );
      }
      const bag = page.locator('ion-modal.context-bag-drawer');
      await expect(
        bag.getByRole('heading', { name: 'Context Bag' }),
      ).toBeVisible();
      await bag.locator('ion-select[label="Mapped field"]').click();
      await page
        .getByRole('radio', { name: 'Invoice ID', exact: true })
        .click();
      await page.getByRole('button', { name: 'OK', exact: true }).click();
      await bag.locator('ion-textarea[label="Value"] textarea').fill('1');
      await bag.getByRole('button', { name: 'Add entry' }).click();
      await expect(bag.getByText('1', { exact: true })).toBeVisible();
      await expect(
        bag.getByRole('checkbox', { name: 'Use Invoice', exact: true }),
      ).toBeChecked();
      await bag.getByRole('button', { name: 'Apply Context' }).click();
      await bag.getByRole('button', { name: 'Attach checked entries' }).click();
      await bag.getByRole('button', { name: 'Done' }).click();

      await page.getByRole('button', { name: 'Session actions', exact: true }).click();
      await page.getByRole('button', { name: 'Composer', exact: true }).click();
      await page.getByRole('button', { name: 'Configure' }).click();
      const providerDialog = page
        .locator('ion-modal')
        .filter({ hasText: 'AI provider' });
      await providerDialog.locator('ion-select[label="Preset"]').click();
      const presetAlert = page.locator('ion-alert.select-alert');
      await expect(presetAlert).toBeVisible();
      await presetAlert.getByRole('radio', { name: 'DeepSeek' }).click();
      await presetAlert.getByRole('button', { name: 'OK' }).click();
      await expect(presetAlert).toBeHidden();
      try {
        await providerDialog
          .locator('ion-input[label="API key"] input')
          .fill(providerKey);
      } catch {
        throw new Error('Could not enter the test provider credential.');
      }
      await providerDialog
        .getByRole('button', { name: 'Save provider on this device' })
        .click();
      await expect(providerDialog).toBeHidden();
      const pinRevision = page.getByRole('checkbox', { name: 'Pin revision' });
      await expect(pinRevision).toBeVisible();
      await pinRevision.click();
      await expect(pinRevision).toBeChecked();
      await page
        .getByLabel('Question')
        .fill('Show InvoiceLine rows for the attached invoice.');
      const providerResponse = page.waitForResponse(
        (response) =>
          isDeepSeekCompletion(response.url()) &&
          response.request().method() === 'POST',
        { timeout: 120_000 },
      );
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      let firstProviderResponse;
      try {
        firstProviderResponse = await providerResponse;
      } catch {
        throw new Error(
          `No provider response; POST count=${providerCalls}; status codes=${JSON.stringify(providerStatuses)}. No retry was sent.`,
        );
      }
      expect(providerCalls).toBe(1);
      expect(firstProviderResponse.status()).toBe(200);
      expect(providerStatuses).toEqual([200]);
      expect(providerRequestFacts).toMatchObject({
        hasContextData: true,
        entryCount: 1,
        revisionIds: [initialRevisionId],
        bodyHasInvoiceId1: true,
        bodyHasInvoiceId2: false,
      });
      console.log(
        `PROVIDER_POST_RECEIPT ${JSON.stringify({ providerPostCount: providerCalls, status: firstProviderResponse.status(), requestFacts: providerRequestFacts })}`,
      );

      const resultReceipt = page.getByText(/\d+ rows · pinned input /);
      await expect(resultReceipt).toBeVisible({ timeout: 120_000 });
      providerReceipt = ((await resultReceipt.textContent()) || '').trim();
      pinnedInputId = providerReceipt.match(
        /pinned input ([A-Za-z0-9_-]+)/,
      )?.[1];
      expect(pinnedInputId).toBeTruthy();
      if (!pinnedInputId) throw new Error('The result receipt omitted its pinned input ID.');
      expect(providerRequestFacts?.inputSnapshotId).toBe(pinnedInputId);
      expect(providerReceipt).toMatch(/^2 rows · pinned input /);
      console.log(
        `PROVIDER_INPUT_RECEIPT ${JSON.stringify({ providerPostCount: providerCalls, status: providerStatuses[0], receipt: providerReceipt })}`,
      );
      const resultGrid = page.getByRole('grid');
      await expect(resultGrid).toBeVisible();
      const invoiceHeader = resultGrid.getByRole('columnheader', {
        name: /^Invoice\s*Id$/i,
      });
      await expect(invoiceHeader).toHaveCount(1);
      const invoiceIdColumn =
        Number(await invoiceHeader.getAttribute('aria-colindex')) - 1;
      expect(invoiceIdColumn).toBeGreaterThanOrEqual(0);
      // Not the floating-filter row (also role=row, with gridcells) that the shared results grid renders under the header.
      const resultRows = resultGrid
        .locator('[role="row"]:not(.ag-header-row-filter)')
        .filter({ has: page.getByRole('gridcell') });
      await expect(resultRows).toHaveCount(2);
      const invoiceIds = await Promise.all(
        (await resultRows.all()).map((row) =>
          row.getByRole('gridcell').nth(invoiceIdColumn).innerText(),
        ),
      );
      expect(invoiceIds.every((value) => value.trim() === '1')).toBe(true);
      expect(providerCalls).toBe(1);
      expect(providerStatuses).toEqual([200]);
      sourceWorkerCount = await page.evaluate(
        (key) => Number(sessionStorage.getItem(key) || '0'),
        sourceWorkerStorageKey,
      );
      expect(sourceWorkerCount).toBe(1);

      await page.getByRole('button', { name: /Context ·/ }).click();
      const changedBag = page.locator('ion-modal.context-bag-drawer');
      await changedBag.getByRole('button', { name: 'Edit' }).click();
      await changedBag
        .locator('ion-textarea[label="Value"] textarea')
        .fill('2');
      await changedBag.getByRole('button', { name: 'Save revision' }).click();
      await changedBag.getByRole('button', { name: 'Apply Context' }).click();
      await expect(resultReceipt).toContainText(pinnedInputId);
      await changedBag.getByRole('button', { name: 'Clear context' }).click();
      const clearAlert = page
        .locator('ion-alert')
        .filter({ hasText: 'Clear context?' });
      await clearAlert.getByRole('button', { name: 'Confirm' }).click();
      await expect(clearAlert).toBeHidden();
      await expect(
        changedBag.getByText(
          'This bag is empty. Add a typed value, then Apply Context.',
        ),
      ).toBeVisible();
      await changedBag.getByRole('button', { name: 'Done' }).click();
      await expect(changedBag).toBeHidden();
      await expect(resultReceipt).toContainText(pinnedInputId);

      await page.reload();
      await expect(
        page.getByText('Show InvoiceLine rows for the attached invoice.'),
      ).toBeVisible({ timeout: 60_000 });
      await expect(
        page.getByText(new RegExp(`\\d+ rows · pinned input ${pinnedInputId}`)),
      ).toBeVisible();
      await expect(resultRows).toHaveCount(2);
      const reloadedInvoiceIds = await Promise.all(
        (await resultRows.all()).map((row) =>
          row.getByRole('gridcell').nth(invoiceIdColumn).innerText(),
        ),
      );
      expect(reloadedInvoiceIds).toEqual(invoiceIds);
      const workersAfterReload = await page.evaluate(
        (key) => Number(sessionStorage.getItem(key) || '0'),
        sourceWorkerStorageKey,
      );
      expect(workersAfterReload).toBe(sourceWorkerCount);
      expect(providerCalls).toBe(1);
      expect(providerStatuses).toEqual([200]);
      await page.evaluate(
        ([providerKeyName, selectedKeyName]) => {
          localStorage.removeItem(providerKeyName);
          localStorage.removeItem(selectedKeyName);
        },
        [providersStorageKey, selectedProviderStorageKey],
      );
      await page
        .locator('sneat-datatug-session-composer ag-grid-angular')
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(
          `provider-journey-${dryRun ? 'stub' : 'real'}-final.png`,
        ),
      });
      console.log(
        JSON.stringify({
          providerTransport: dryRun ? 'stub' : 'real',
          providerPostCount: providerCalls,
          providerStatusCodes: providerStatuses,
          providerRequestFacts,
          pinnedInputId,
          returnedRows: invoiceIds.length,
          allReturnedInvoiceIdsMatch: invoiceIds.every(
            (value) => value.trim() === '1',
          ),
          sqliteQueryDispatches: sourceWorkerCount,
          providerPostCountAfterReload: providerCalls,
          sqliteQueryDispatchesAfterReload: workersAfterReload,
        }),
      );
    } finally {
      console.log(
        `SAFE_PROVIDER_PARTIAL_RECEIPT ${JSON.stringify({ providerTransport: dryRun ? 'stub' : 'real', providerPostCount: providerCalls, providerStatusCodes: providerStatuses, providerRequestFacts, providerReceipt, pinnedInputId, sqliteQueryDispatches: sourceWorkerCount })}`,
      );
      await page
        .evaluate(
          ([providerKeyName, selectedKeyName]) => {
            localStorage.removeItem(providerKeyName);
            localStorage.removeItem(selectedKeyName);
          },
          [providersStorageKey, selectedProviderStorageKey],
        )
        .catch(() => undefined);
      await page.goto('about:blank', { timeout: 5_000 }).catch(async () => {
        await page.close().catch(() => undefined);
      });
    }
  });
});
