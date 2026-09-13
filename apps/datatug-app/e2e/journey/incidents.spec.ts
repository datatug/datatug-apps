import type { Page, Response } from '@playwright/test';
import { expect, test } from './fixtures/agent-server';
import { activePage } from './helpers/active-page';

/**
 * Incidentius Task 3's real browser contract. The incident agent owns an
 * isolated copy of the demo project because `datatug serve` persists the
 * default incident repository below `<project>/incidents`; nothing in this
 * journey intercepts or fabricates an incident response.
 *
 * Flow: incident list -> Houston create -> returned server detail -> cold
 * detail reload -> persisted list. The process restart between filling and
 * submitting rotates the real server-issued securityContextId while retaining
 * the same non-default agent URL and repository. That makes the first POST
 * fail STALE_CONTEXT and proves the UI refreshes that exact agent before
 * retrying the same mutation.
 */

const DEMO_PROJECT_ID = 'datatug-demo-project';
const DEMO_ENV_ID = 'local';

function isIncidentCreateResponse(
  response: Response,
  agentOrigin: string,
): boolean {
  return (
    response.request().method() === 'POST' &&
    response.url() === `${agentOrigin}/datatug/incidents`
  );
}

async function addNamedOverlay(
  page: Page,
  agentStoreId: string,
  options: {
    role: 'suspected' | 'healthy_control';
    layerKind: 'hypothesis' | 'question';
    layerId: string;
    value: string;
  } = {
    role: 'suspected',
    layerKind: 'hypothesis',
    layerId: 'H17',
    value: '11',
  },
): Promise<void> {
  const projectUrl = `/store/${agentStoreId}/project/${DEMO_PROJECT_ID}`;
  await page.goto(`${projectUrl}/env/${DEMO_ENV_ID}`);
  await expect(
    activePage(page).getByRole('heading', { name: 'Servers', exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await page.goto(`${projectUrl}/variables`);
  await expect(
    activePage(page).getByText('Add a context variable', { exact: true }),
  ).toBeVisible({ timeout: 15_000 });

  const choose = async (label: string, option: string): Promise<void> => {
    await activePage(page).locator(`ion-select[label="${label}"]`).click();
    await page
      .locator('ion-popover')
      .getByText(option, { exact: true })
      .click();
  };
  await choose('Entity', 'Customer');
  await choose('Field', 'ID');
  await choose('Condition', '==');
  await choose('Cohort role', options.role);
  await choose('Context layer', options.layerKind);
  await activePage(page)
    .locator('ion-input[label="Layer ID"] input')
    .fill(options.layerId);
  await activePage(page)
    .locator('ion-input[label="Value"] input')
    .fill(options.value);
  await activePage(page)
    .locator('.investigation-context-page__form ion-button', {
      hasText: 'Add',
    })
    .click();
  await expect(
    activePage(page).getByText(`${options.layerKind}:${options.layerId}`, {
      exact: false,
    }),
  ).toBeVisible();
}

test.describe('Incidentius Task 3 — real persisted Houston journey', () => {
  test('creates through stale-context recovery, opens server detail, cold reloads, and remains listed', async ({
    incidentAgentServer,
    page,
  }) => {
    const agentStoreId = incidentAgentServer.storeId;
    const agentOrigin = `http://${incidentAgentServer.host}:${incidentAgentServer.port}`;
    const scope = new URLSearchParams({
      agent: agentStoreId,
      storeId: DEMO_PROJECT_ID,
      project: DEMO_PROJECT_ID,
      environment: DEMO_ENV_ID,
    });
    const listUrl = `/incidents?${scope.toString()}`;
    const title = `Houston journey worker ${test.info().workerIndex}`;
    const description = 'Persisted by the real released datatug-cli agent.';

    const initialInfoResponse = page.waitForResponse(
      (response) =>
        response.url() === `${agentOrigin}/datatug/agent-info` && response.ok(),
    );
    const initialListResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().startsWith(`${agentOrigin}/datatug/incidents?`) &&
        response.ok(),
    );
    await page.goto(listUrl);
    const initialInfo = await initialInfoResponse;
    await initialListResponse;

    const initialSecurityContextId = String(
      ((await initialInfo.json()) as { securityContextId?: unknown })
        .securityContextId,
    );
    expect(initialSecurityContextId).toMatch(/^[a-f0-9]{32}$/);
    await expect(activePage(page).getByText('No incidents yet.')).toBeVisible();

    await activePage(page)
      .getByRole('link', { name: "Houston, we've got a problem" })
      .click();
    await expect(page).toHaveURL(/\/incidents\/new\?/);
    await activePage(page)
      .getByTestId('incident-title-input')
      .locator('input')
      .fill(title);
    await activePage(page)
      .getByTestId('incident-description-input')
      .locator('textarea')
      .fill(description);

    await incidentAgentServer.restart();

    const staleResponsePromise = page.waitForResponse(
      (response) =>
        isIncidentCreateResponse(response, agentOrigin) &&
        response.status() === 409,
    );
    const refreshedInfoPromise = page.waitForResponse(
      (response) =>
        response.url() === `${agentOrigin}/datatug/agent-info` && response.ok(),
    );
    const createdResponsePromise = page.waitForResponse(
      (response) =>
        isIncidentCreateResponse(response, agentOrigin) &&
        response.status() === 201,
    );

    await activePage(page)
      .getByRole('button', { name: "Houston, we've got a problem" })
      .click();

    const staleResponse = await staleResponsePromise;
    const staleBody = (await staleResponse.json()) as {
      error?: { code?: unknown };
    };
    expect(staleBody.error?.code).toBe('STALE_CONTEXT');
    const staleRequest = staleResponse.request().postDataJSON() as {
      mutationId?: unknown;
    };
    expect(staleRequest.mutationId).toEqual(expect.any(String));
    expect(String(staleRequest.mutationId)).not.toHaveLength(0);

    const refreshedInfo = await refreshedInfoPromise;
    const refreshedSecurityContextId = String(
      ((await refreshedInfo.json()) as { securityContextId?: unknown })
        .securityContextId,
    );
    expect(refreshedSecurityContextId).toMatch(/^[a-f0-9]{32}$/);
    expect(refreshedSecurityContextId).not.toBe(initialSecurityContextId);

    const createdResponse = await createdResponsePromise;
    const createdBody = (await createdResponse.json()) as {
      incident?: { ref?: { storeId?: unknown; incidentId?: unknown } };
    };
    const retriedRequest = createdResponse.request().postDataJSON() as {
      mutationId?: unknown;
    };
    expect(retriedRequest.mutationId).toBe(staleRequest.mutationId);
    expect(createdBody.incident?.ref?.storeId).toBe(DEMO_PROJECT_ID);
    expect(createdBody.incident?.ref?.incidentId).toBe('INC-1');

    await expect(page).toHaveURL(
      new RegExp(`/incidents/${DEMO_PROJECT_ID}/INC-1\\?`),
    );
    await expect(
      activePage(page).getByRole('heading', { name: title }),
    ).toBeVisible();
    await expect(
      activePage(page).getByRole('paragraph').filter({ hasText: description }),
    ).toBeVisible();
    await expect(
      activePage(page).getByRole('heading', { name: 'Timeline' }),
    ).toBeVisible();
    await expect(activePage(page).getByText('incident.created')).toBeVisible();

    const coldDetailResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().startsWith(`${agentOrigin}/datatug/incidents/INC-1?`) &&
        response.ok(),
    );
    const coldEventsResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response
          .url()
          .startsWith(`${agentOrigin}/datatug/incidents/INC-1/events?`) &&
        response.ok(),
    );
    await page.reload();
    await coldDetailResponse;
    await coldEventsResponse;
    await expect(
      activePage(page).getByRole('heading', { name: title }),
    ).toBeVisible();
    await expect(
      activePage(page).getByRole('paragraph').filter({ hasText: description }),
    ).toBeVisible();
    await expect(activePage(page).getByText('incident.created')).toBeVisible();

    const persistedListResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().startsWith(`${agentOrigin}/datatug/incidents?`) &&
        response.ok(),
    );
    await page.goto(listUrl);
    await persistedListResponse;
    await expect(activePage(page).getByText(title)).toBeVisible();
  });
});

test.describe('Incidentius Task 4 — real context overlay decisions', () => {
  test('creates a named overlay and carries it into the real incident form', async ({
    incidentAgentServer,
    page,
  }, testInfo) => {
    await addNamedOverlay(page, incidentAgentServer.storeId);
    await expect(
      activePage(page).getByText('Use for runs', { exact: true }),
    ).toBeVisible();
    await activePage(page)
      .getByText('hypothesis:H17', { exact: false })
      .scrollIntoViewIfNeeded();
    await activePage(page).screenshot({
      path: testInfo.outputPath('incidentius-task4-context-overlay.png'),
    });

    await activePage(page).getByTestId('make-incident').click();
    await expect(page).toHaveURL(/\/incidents\/new\?/);
    await expect(
      activePage(page).getByTestId('incident-context-fact-count'),
    ).toContainText('1 enabled Investigation Context fact');
  });

  test('promotes and rejects named overlays through real idempotent append events and keeps both after reload', async ({
    incidentAgentServer,
    page,
  }) => {
    const agentStoreId = incidentAgentServer.storeId;
    const agentOrigin = `http://${incidentAgentServer.host}:${incidentAgentServer.port}`;
    await addNamedOverlay(page, agentStoreId);
    await addNamedOverlay(page, agentStoreId, {
      role: 'healthy_control',
      layerKind: 'question',
      layerId: 'compare / EU west',
      value: '12',
    });

    await activePage(page).getByTestId('make-incident').click();
    await expect(page).toHaveURL(/\/incidents\/new\?/);
    await expect(
      activePage(page).getByTestId('incident-context-fact-count'),
    ).toContainText('2 enabled Investigation Context facts');
    const title = `Overlay decision worker ${test.info().workerIndex}`;
    await activePage(page)
      .getByTestId('incident-title-input')
      .locator('input')
      .fill(title);

    const createResponsePromise = page.waitForResponse((response) =>
      isIncidentCreateResponse(response, agentOrigin),
    );
    await activePage(page)
      .getByRole('button', { name: "Houston, we've got a problem" })
      .click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(201);
    const createRequest = createResponse.request().postDataJSON() as {
      canonicalContext?: {
        facts?: Array<{ id?: string; role?: string; layer?: string }>;
      };
    };
    const attached = createRequest.canonicalContext?.facts?.find(
      (fact) => fact.layer === 'hypothesis:H17',
    );
    const rejected = createRequest.canonicalContext?.facts?.find(
      (fact) => fact.layer === 'question:compare / EU west',
    );
    expect(attached).toMatchObject({
      role: 'suspected',
      layer: 'hypothesis:H17',
    });
    expect(attached?.id).toEqual(expect.any(String));
    expect(rejected).toMatchObject({
      role: 'healthy_control',
      layer: 'question:compare / EU west',
    });

    await expect(
      activePage(page)
        .locator('ion-item', { hasText: 'hypothesis:H17' })
        .getByRole('button', { name: 'Promote as affected' }),
    ).toBeVisible({ timeout: 15_000 });
    const appendResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().startsWith(`${agentOrigin}/datatug/incidents/`) &&
        response.url().endsWith('/events'),
    );
    await activePage(page)
      .locator('ion-item', { hasText: 'hypothesis:H17' })
      .getByRole('button', { name: 'Promote as affected' })
      .click();
    const appendResponse = await appendResponsePromise;
    expect(appendResponse.ok()).toBe(true);
    const appendRequest = appendResponse.request().postDataJSON() as {
      mutationId?: unknown;
      expectedSeq?: unknown;
      event?: {
        type?: unknown;
        payload?: { fact?: { id?: unknown; layer?: unknown }; role?: unknown };
      };
    };
    expect(appendRequest).toMatchObject({
      mutationId: expect.any(String),
      expectedSeq: expect.any(Number),
      event: {
        type: 'context.fact.promoted',
        payload: {
          fact: { id: attached?.id, layer: 'hypothesis:H17' },
          role: 'affected',
        },
      },
    });
    await expect(
      activePage(page).getByText('Decided', { exact: true }),
    ).toBeVisible();
    await expect(
      activePage(page).getByText('context.fact.promoted', { exact: true }),
    ).toBeVisible();

    const rejectResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().startsWith(`${agentOrigin}/datatug/incidents/`) &&
        response.url().endsWith('/events'),
    );
    await activePage(page)
      .locator('ion-item', { hasText: 'question:compare / EU west' })
      .getByRole('button', { name: 'Reject' })
      .click();
    const rejectResponse = await rejectResponsePromise;
    expect(rejectResponse.ok()).toBe(true);
    const rejectRequest = rejectResponse.request().postDataJSON() as {
      mutationId?: unknown;
      event?: { type?: unknown; payload?: { layer?: unknown } };
    };
    expect(rejectRequest).toMatchObject({
      mutationId: expect.any(String),
      event: {
        type: 'context.fact.rejected',
        payload: { layer: 'question:compare / EU west' },
      },
    });
    const rejectedBody = (await rejectResponse.json()) as {
      event?: { id?: unknown; seq?: unknown };
      replayed?: unknown;
    };
    expect(rejectedBody.replayed).toBe(false);

    const replay = await page.evaluate(
      async ({ url, body }) => {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        return {
          status: response.status,
          body: (await response.json()) as {
            event?: { id?: unknown; seq?: unknown };
            replayed?: unknown;
          },
        };
      },
      { url: rejectResponse.url(), body: rejectRequest },
    );
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({
      event: {
        id: rejectedBody.event?.id,
        seq: rejectedBody.event?.seq,
      },
      replayed: true,
    });
    await expect(
      activePage(page).getByText('context.fact.rejected', { exact: true }),
    ).toBeVisible();
    await expect(
      activePage(page).getByText('Decided', { exact: true }),
    ).toHaveCount(2);

    await page.reload();
    await expect(
      activePage(page).getByText('Decided', { exact: true }),
    ).toHaveCount(2, {
      timeout: 15_000,
    });
    await expect(
      activePage(page).getByText('context.fact.promoted', { exact: true }),
    ).toBeVisible();
    await expect(
      activePage(page).getByText('context.fact.rejected', { exact: true }),
    ).toBeVisible();
    await expect(
      activePage(page).getByText('Decided', { exact: true }),
    ).toHaveCount(2);
  });
});
