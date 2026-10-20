import { expect, test } from './helpers/demodb-guard';
import { SIGN_IN_BUTTON } from './helpers/sign-in-button';

const firebaseProject = 'demo-local-sneat-app';
const password = 'local-incident-fixture-password';
const incidentRef = { storeId: 'detective-incidents-9c561d36', incidentId: 'INC-1' };
const projectId = 'fixture_project';

test('signed-in Incident first: private setup, create, cold detail, distinct linked Case, and list return', async ({ page }) => {
  const email = `incident-${crypto.randomUUID()}@example.test`;
  const seeded = await page.request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=e2e',
    { data: { email, password, returnSecureToken: true } },
  );
  expect(seeded.ok()).toBe(true);
  const { localId } = (await seeded.json()) as { localId: string };
  const spaceID = `personal_${localId}`;
  const firestore = `http://127.0.0.1:8180/v1/projects/${firebaseProject}/databases/(default)/documents`;
  expect((await page.request.patch(`${firestore}/users/${localId}`, { data: {
    fields: {
      title: { stringValue: 'Incident Fixture' }, email: { stringValue: email },
      emailIsVerified: { booleanValue: true },
      spaces: { mapValue: { fields: { [spaceID]: { mapValue: { fields: {
        title: { stringValue: 'Personal' }, type: { stringValue: 'personal' },
        roles: { arrayValue: { values: [{ stringValue: 'owner' }] } },
      } } } } } },
      spaceIDs: { arrayValue: { values: [{ stringValue: spaceID }] } },
    },
  } })).ok()).toBe(true);
  expect((await page.request.patch(`${firestore}/spaces/${spaceID}`, { data: {
    fields: {
      title: { stringValue: 'Personal' }, type: { stringValue: 'personal' },
      userIDs: { arrayValue: { values: [{ stringValue: localId }] } },
    },
  } })).ok()).toBe(true);
  expect((await page.request.patch(`${firestore}/spaces/${spaceID}/ext/datatug/projects/${projectId}`, { data: {
    fields: { title: { stringValue: 'Incident Fixture Project' }, createdBy: { stringValue: localId } },
  } })).ok()).toBe(true);

  await page.goto('/checkout/sign-in?plan=pro&period=monthly&checkout=test');
  const checkout = page.locator('datatug-checkout-page.ion-page:not(.ion-page-hidden):not(.ion-page-invisible):has([data-checkout-page="authentication"])');
  await expect(checkout).toHaveCount(1);
  await checkout.locator('ion-segment-button[value="in"]').click();
  await page.locator('ion-input[name="email"] input').fill(email);
  await page.locator('ion-input[type="password"] input:not(.cloned-input)').fill(password);
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
  await expect(page.getByText(`Signed in as ${email}`, { exact: true })).toBeVisible({ timeout: 20_000 });

  let savedIncident: Record<string, unknown> | undefined;
  let linkedCase: Record<string, unknown> | undefined;
  const writes: Array<Record<string, unknown>> = [];
  await page.route('**/v0/datatug/detective/**', async (route) => {
    const request = route.request();
    if (!request.headers()['authorization']?.startsWith('Bearer ')) {
      await route.fulfill({ status: 401, json: { error: 'unauthorized' } });
      return;
    }
    const endpoint = new URL(request.url()).pathname.split('/').at(-1);
    const body = request.method() === 'POST' ? request.postDataJSON() as Record<string, unknown> : undefined;
    if (body) writes.push(body);
    if (endpoint === 'demo_project') {
      await route.fulfill({ status: 200, json: { storeId: 'firestore', spaceID, projectId } });
    } else if (endpoint === 'state') {
      await route.fulfill({ status: 200, json: {
        environments: ['demo'], cases: linkedCase ? [linkedCase] : [],
        checks: [], validators: [], queryValidators: [], scenarios: [], runs: [],
        capabilities: { localOnly: false, canRead: true, canWrite: true, canRun: false, maxRows: 100, maxFanout: 10 },
      } });
    } else if (endpoint === 'project_incidents') {
      await route.fulfill({ status: 200, json: { incidents: savedIncident ? [savedIncident] : [] } });
    } else if (endpoint === 'incident') {
      await route.fulfill({ status: savedIncident ? 200 : 404, json: { incident: savedIncident } });
    } else if (endpoint === 'incident_action' && body?.['type'] === 'create') {
      expect(body['caseId']).toBeUndefined();
      expect(body['context']).toEqual({ OrderID: { type: 'number', value: 11039 } });
      savedIncident = {
        ref: incidentRef, uid: 'INC-1', title: 'Order 11039 is missing',
        description: 'Customer reported a missing order.', status: 'open',
        canonicalContext: { facts: [] }, lastSeq: 1,
      };
      await route.fulfill({ status: 200, json: { incident: savedIncident, receipt: 'created' } });
    } else if (endpoint === 'incident_action' && body?.['type'] === 'start-case') {
      expect(body['incidentRef']).toBe(`${incidentRef.storeId}/${incidentRef.incidentId}`);
      const draft = body['case'] as Record<string, unknown>;
      linkedCase = { ...draft, version: 1, incidentRefs: [`${incidentRef.storeId}/${incidentRef.incidentId}`] };
      await route.fulfill({ status: 200, json: { incident: savedIncident, case: linkedCase, receipt: 'started' } });
    } else if (endpoint === 'case_events') {
      await route.fulfill({ status: 200, json: { caseId: linkedCase?.['id'], events: [], hasMore: false } });
    } else {
      await route.fulfill({ status: 404, json: { error: { message: `Unhandled test endpoint ${endpoint}` } } });
    }
  });

  await page.goto('/incidents');
  await expect(page.getByText('Create a private project to record your first hosted Incident, or open your existing private project.')).toBeVisible();
  await page.getByRole('button', { name: 'Set up private project for Incidents' }).click();
  const list = `/space/${spaceID}/store/firestore/project/${projectId}/incidents`;
  await expect(page).toHaveURL(new RegExp(`${list}$`));
  await expect(page.getByRole('heading', { name: 'Incidents' })).toBeVisible();
  await page.getByRole('link', { name: 'Create Incident' }).click();
  await expect(page).toHaveURL(new RegExp(`${list}/new\\?environment=demo$`));
  await page.getByRole('textbox', { name: 'Incident title' }).fill('Order 11039 is missing');
  await page.getByRole('textbox', { name: 'Incident description' }).fill('Customer reported a missing order.');
  await page.getByRole('spinbutton', { name: 'Order ID' }).fill('11039');
  await page.getByRole('button', { name: 'Save Incident' }).click();
  const detail = `${list}/${incidentRef.storeId}/${incidentRef.incidentId}?environment=demo`;
  await expect(page).toHaveURL(detail);
  expect(writes.find((body) => body['type'] === 'create')).toMatchObject({
    storage: 'firestore', spaceID, project: projectId, environment: 'demo',
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'INC-1 — Order 11039 is missing' })).toBeVisible();
  await expect(page.getByText('No Detective Case has been started')).toBeVisible();
  await page.getByRole('button', { name: 'Investigate in a Detective Case' }).click();
  await expect(page).toHaveURL(new RegExp(`/detective/incident-[a-f0-9-]+$`));
  expect(linkedCase?.['id']).not.toBe(incidentRef.incidentId);
  await page.goto(detail);
  await expect(page.getByText(`Detective Case ${linkedCase?.['id']}`)).toBeVisible();
  await page.getByRole('link', { name: 'Back to Incidents' }).click();
  await expect(page.getByRole('list', { name: 'Project Incidents' })).toContainText('INC-1 — Order 11039 is missing');
});
