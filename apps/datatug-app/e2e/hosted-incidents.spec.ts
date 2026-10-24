import { expect, test } from './helpers/demodb-guard';
import type {
  WorkAction,
  WorkDetail,
  WorkItem,
  WorkLink,
} from '@sneat/datatug-main';
import { SIGN_IN_BUTTON } from './helpers/sign-in-button';

const firebaseProject = 'demo-local-sneat-app';
const password = 'local-incident-fixture-password';
const incidentRef = {
  storeId: 'detective-incidents-9c561d36',
  incidentId: 'INC-1',
};
const projectId = 'fixture_project';

test('signed-in Incident first: canonical Work create/comment/delegate with retained native evidence cold reads', async ({
  page,
}) => {
  // This journey includes sign-in and six cold navigations. CI's first-page
  // initialization and repeated loading must not consume the final assertion's
  // normal five-second wait (the mobile checkout journey uses the same budget).
  test.setTimeout(60_000);
  const email = `incident-${crypto.randomUUID()}@example.test`;
  const seeded = await page.request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=e2e',
    { data: { email, password, returnSecureToken: true } },
  );
  expect(seeded.ok()).toBe(true);
  const { localId } = (await seeded.json()) as { localId: string };
  const spaceID = `personal_${localId}`;
  const firestore = `http://127.0.0.1:8180/v1/projects/${firebaseProject}/databases/(default)/documents`;
  expect(
    (
      await page.request.patch(`${firestore}/users/${localId}`, {
        data: {
          fields: {
            title: { stringValue: 'Incident Fixture' },
            email: { stringValue: email },
            emailIsVerified: { booleanValue: true },
            spaces: {
              mapValue: {
                fields: {
                  [spaceID]: {
                    mapValue: {
                      fields: {
                        title: { stringValue: 'Personal' },
                        type: { stringValue: 'personal' },
                        roles: {
                          arrayValue: { values: [{ stringValue: 'owner' }] },
                        },
                      },
                    },
                  },
                },
              },
            },
            spaceIDs: { arrayValue: { values: [{ stringValue: spaceID }] } },
          },
        },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.patch(`${firestore}/spaces/${spaceID}`, {
        data: {
          fields: {
            title: { stringValue: 'Personal' },
            type: { stringValue: 'personal' },
            userIDs: { arrayValue: { values: [{ stringValue: localId }] } },
          },
        },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.patch(
        `${firestore}/spaces/${spaceID}/ext/datatug/projects/${projectId}`,
        {
          data: {
            fields: {
              title: { stringValue: 'Incident Fixture Project' },
              createdBy: { stringValue: localId },
            },
          },
        },
      )
    ).ok(),
  ).toBe(true);

  await page.goto('/checkout/sign-in?plan=pro&period=monthly&checkout=test');
  const checkout = page.locator(
    'datatug-checkout-page.ion-page:not(.ion-page-hidden):not(.ion-page-invisible):has([data-checkout-page="authentication"])',
  );
  await expect(checkout).toHaveCount(1);
  await checkout.locator('ion-segment-button[value="in"]').click();
  await page.locator('ion-input[name="email"] input').fill(email);
  await page
    .locator('ion-input[type="password"] input:not(.cloned-input)')
    .fill(password);
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
  await expect(
    page.getByText(`Signed in as ${email}`, { exact: true }),
  ).toBeVisible({ timeout: 20_000 });

  let savedIncident: Record<string, unknown> | undefined;
  let linkedCase: Record<string, unknown> | undefined;
  const messages: Array<Record<string, unknown>> = [];
  const writes: Array<Record<string, unknown>> = [];
  // This checkout test isolates routing and wire contracts. The separate work.spec.ts
  // journey exercises these APIs against real Firestore and verified Firebase auth.
  const workWrites: WorkAction[] = [];
  const workItems = new Map<string, WorkItem>();
  const workActivity = new Map<string, WorkDetail['activity']>();
  const workLinks: WorkLink[] = [];
  const at = '2026-10-21T12:00:00Z';
  const environments = [
    {
      environmentId: 'demo',
      identityDomain: 'fixture-orders',
      title: 'Demo orders',
      subjects: [],
    },
  ];
  const capabilities = {
    canRead: true,
    canCreate: true,
    canEdit: true,
    canAssign: true,
    canContext: true,
    transitions: [],
  };
  const members = [{ id: localId, title: 'Incident Fixture', role: 'owner' }];
  const workDetail = (item: WorkItem): WorkDetail => ({
    item,
    members,
    environments,
    capabilities,
    proposals: [],
    activity: workActivity.get(item.id) || [],
    links: workLinks.filter(
      (link) => link.sourceId === item.id || link.target.id === item.id,
    ),
    relatedItems: workLinks
      .filter((link) => link.sourceId === item.id || link.target.id === item.id)
      .map((link) =>
        workItems.get(
          link.sourceId === item.id ? link.target.id : link.sourceId,
        ),
      )
      .flatMap((peer) =>
        peer ? [{ id: peer.id, type: peer.type, title: peer.title }] : [],
      ),
    context: {
      session: {
        schemaVersion: 1,
        id: item.contextSessionId,
        databaseId: 'firestore',
        projectId,
        owner: localId,
        title: item.title,
        state: 'active',
        version: 1,
        defaultBagId: `bag_${item.id}`,
        contextSetId: `set_${item.id}`,
        bagIds: [`bag_${item.id}`],
        createdAt: at,
        updatedAt: at,
      },
      bags: [
        {
          id: `bag_${item.id}`,
          sessionId: item.contextSessionId,
          title: 'Context Bag',
          scope: environments[0],
          version: 1,
          entryIds: [],
        },
      ],
      entries: [],
      revisions: [],
      contextSet: {
        id: `set_${item.id}`,
        sessionId: item.contextSessionId,
        enabled: true,
        slots: [],
        createdAt: at,
      },
    },
  });
  await page.route('**/v0/datatug/work/**', async (route) => {
    const request = route.request();
    expect(request.headers()['authorization']).toMatch(/^Bearer /);
    const url = new URL(request.url());
    const endpoint = url.pathname.split('/').at(-1);
    if (request.method() === 'GET') {
      expect(url.searchParams.get('spaceID')).toBe(spaceID);
      expect(url.searchParams.get('projectID')).toBe(projectId);
      if (endpoint === 'items') {
        await route.fulfill({
          json: {
            items: [...workItems.values()],
            members,
            environments,
            capabilities,
            hasMore: false,
          },
        });
        return;
      }
      expect(['item', 'context']).toContain(endpoint);
      const item = workItems.get(url.searchParams.get('id') || '');
      expect(item).toBeDefined();
      await route.fulfill({
        json:
          endpoint === 'context'
            ? workDetail(required(item)).context
            : workDetail(required(item)),
      });
      return;
    }
    expect(endpoint).toBe('actions');
    const body = request.postDataJSON() as WorkAction;
    expect(body).toMatchObject({ spaceID, projectID: projectId });
    expect(body.operationId).toMatch(/^work_/);
    expect(
      (body as unknown as Record<string, unknown>)['actor'],
    ).toBeUndefined();
    workWrites.push(body);
    let item: WorkItem;
    if (body.action === 'create') {
      const draft = required(body.draft);
      expect(body.contextScope).toEqual({
        environmentId: 'demo',
        identityDomain: 'fixture-orders',
      });
      const id = draft.type === 'incident' ? 'work_incident' : 'work_case';
      item = {
        id,
        spaceID,
        projectID: projectId,
        type: draft.type,
        title: draft.title,
        description: draft.description,
        ownerId: required(draft.ownerId),
        assigneeIds: draft.assigneeIds || [],
        primaryAssigneeId: draft.primaryAssigneeId,
        status: draft.type === 'case' ? 'active' : 'open',
        lifecycle: draft.type === 'case' ? 'active' : 'open',
        priority: draft.priority,
        version: 1,
        contextSessionId: `context_${id}`,
        createdBy: localId,
        createdAt: at,
        updatedAt: at,
        ...(draft.type === 'incident'
          ? {
              incident: {
                severity: required(draft.severity),
                environment: 'demo',
                legacyRef: incidentRef,
              },
            }
          : {
              case: { legacyCaseId: id },
              parentId: body.parentId,
              inheritance: body.inheritance,
            }),
      };
      if (draft.type === 'incident') {
        savedIncident = {
          ref: incidentRef,
          uid: 'INC-1',
          workItemId: id,
          title: item.title,
          description: item.description,
          status: 'open',
          canonicalContext: { facts: [] },
          lastSeq: 1,
        };
      } else {
        expect(body).toMatchObject({
          parentId: 'work_incident',
          parentVersion: 2,
          inheritance: 'snapshot',
        });
        linkedCase = {
          id,
          workItemId: id,
          title: item.title,
          status: 'active',
          version: 1,
          incidentRefs: [`${incidentRef.storeId}/${incidentRef.incidentId}`],
        };
        workLinks.push({
          id: 'case_parent',
          sourceId: 'work_incident',
          relation: 'parent',
          target: { kind: 'work', id },
          createdBy: localId,
          createdAt: at,
        });
      }
      workActivity.set(id, [
        {
          id: `created_${id}`,
          itemId: id,
          version: 1,
          actorId: localId,
          action: 'created',
          at,
        },
      ]);
    } else {
      expect(body.action).toBe('comment');
      const previous = required(workItems.get(required(body.itemId)));
      expect(body.expectedVersion).toBe(previous.version);
      item = { ...previous, version: previous.version + 1 };
      required(workActivity.get(item.id)).push({
        id: 'comment_1',
        itemId: item.id,
        version: item.version,
        actorId: localId,
        action: 'comment',
        comment: body.comment,
        at,
      });
    }
    workItems.set(item.id, item);
    await route.fulfill({ json: workDetail(item) });
  });
  await page.route('**/v0/datatug/detective/**', async (route) => {
    const request = route.request();
    if (!request.headers()['authorization']?.startsWith('Bearer ')) {
      await route.fulfill({ status: 401, json: { error: 'unauthorized' } });
      return;
    }
    const endpoint = new URL(request.url()).pathname.split('/').at(-1);
    const body =
      request.method() === 'POST'
        ? (request.postDataJSON() as Record<string, unknown>)
        : undefined;
    if (body) writes.push(body);
    if (endpoint === 'demo_project') {
      await route.fulfill({
        status: 200,
        json: { storeId: 'firestore', spaceID, projectId },
      });
    } else if (endpoint === 'state') {
      await route.fulfill({
        status: 200,
        json: {
          environments: ['demo'],
          cases: linkedCase ? [linkedCase] : [],
          checks: [],
          validators: [],
          queryValidators: [],
          scenarios: [],
          runs: [],
          capabilities: {
            localOnly: false,
            canRead: true,
            canWrite: true,
            canRun: false,
            maxRows: 100,
            maxFanout: 10,
          },
        },
      });
    } else if (endpoint === 'project_incidents') {
      await route.fulfill({
        status: 200,
        json: { incidents: savedIncident ? [savedIncident] : [] },
      });
    } else if (endpoint === 'incident') {
      await route.fulfill({
        status: savedIncident ? 200 : 404,
        json: { incident: savedIncident },
      });
    } else if (endpoint === 'incident_events') {
      const after = Number(
        new URL(request.url()).searchParams.get('afterSeq') || 0,
      );
      await route.fulfill({
        status: 200,
        json: {
          events: messages.filter((event) => Number(event['seq']) > after),
          nextAfterSeq: savedIncident?.['lastSeq'] || after,
          hasMore: false,
        },
      });
    } else if (
      endpoint === 'incident_action' &&
      body?.['type'] === 'append-message'
    ) {
      expect(body['expectedSeq']).toBe(savedIncident?.['lastSeq']);
      expect(body['actor']).toBeUndefined();
      expect(body['ifMatch']).toBeUndefined();
      const seq = Number(savedIncident?.['lastSeq']) + 1;
      const event = {
        id: `message-${seq}`,
        seq,
        incident: incidentRef,
        at: '2026-10-21T12:00:00Z',
        visibleAt: '2026-10-21T12:00:00Z',
        actor: { kind: 'human', id: localId, via: 'web' },
        type: 'note.added',
        assertion: { kind: 'claim' },
        payload: { body: (body['message'] as { body: string }).body },
      };
      messages.push(event);
      savedIncident = { ...savedIncident, lastSeq: seq };
      await route.fulfill({
        status: 200,
        json: { incident: savedIncident, event, receipt: body['operationId'] },
      });
    } else if (endpoint === 'case_events') {
      await route.fulfill({
        status: 200,
        json: { caseId: linkedCase?.['id'], events: [], hasMore: false },
      });
    } else {
      await route.fulfill({
        status: 404,
        json: { error: { message: `Unhandled test endpoint ${endpoint}` } },
      });
    }
  });

  await page.goto('/incidents');
  await expect(
    page.getByText(
      'Create a private project to record your first hosted Incident, or open your existing private project.',
    ),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Set up private project for Incidents' })
    .click();
  const list = `/space/${spaceID}/store/firestore/project/${projectId}/incidents`;
  await expect(page).toHaveURL(new RegExp(`${list}$`));
  // A new private project has no Incidents yet: its list opens on the
  // empty-state welcome, whose primary action reports the first Incident.
  // The /incidents page that set up the project stays in the DOM (and is still
  // visible while Ionic animates the transition): read the project's own list page.
  const shown = page.locator('sneat-datatug-hosted-incidents-page');
  await expect(shown.getByRole('banner')).toContainText('Incidents');
  await expect(
    shown.getByRole('heading', {
      name: 'Follow the evidence. Find the cause.',
      level: 1,
    }),
  ).toBeVisible();
  await shown
    .getByRole('link', { name: 'Report an incident', exact: true })
    .click();
  const workBase = `/space/${spaceID}/store/firestore/project/${projectId}/work`;
  await expect(page).toHaveURL(
    `${workBase}/new?type=incident&environment=demo`,
  );
  const workPage = () =>
    page.locator(
      'sneat-work-page.ion-page:not(.ion-page-hidden):not(.ion-page-invisible)',
    );
  await workPage()
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Order 11039 is missing');
  await workPage()
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Customer reported a missing order.');
  await expect(page.getByRole('spinbutton', { name: 'Order ID' })).toHaveCount(
    0,
  );
  await workPage()
    .getByRole('button', { name: 'Create work', exact: true })
    .click();
  await expect(page).toHaveURL(`${workBase}/work_incident`);
  expect(workWrites[0]).toMatchObject({
    action: 'create',
    draft: { type: 'incident', ownerId: localId, environment: 'demo' },
  });
  await workPage()
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Lead owns investigation and follow-up.');
  await workPage()
    .getByRole('button', { name: 'Add comment', exact: true })
    .click();
  await expect(
    workPage().getByText('Lead owns investigation and follow-up.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    workPage().getByText('Lead owns investigation and follow-up.', {
      exact: true,
    }),
  ).toBeVisible();
  await workPage()
    .getByText('Open Incident evidence and resolution', { exact: true })
    .click();
  const detail = `${list}/${incidentRef.storeId}/${incidentRef.incidentId}?environment=demo`;
  await expect(page).toHaveURL(detail);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'INC-1 — Order 11039 is missing' }),
  ).toBeVisible();
  await expect(
    page.getByText('No Detective Case has been started'),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Incident message' })
    .fill('Request received; carrier assignment is missing.');
  await page.getByRole('button', { name: 'Post message', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Message saved.' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('list', { name: 'Incident messages' }),
  ).toContainText('Request received; carrier assignment is missing.');
  await expect(
    page.getByRole('list', { name: 'Incident messages' }),
  ).toContainText(`${localId} · web`);
  await page
    .getByRole('button', { name: 'Investigate in a Detective Case' })
    .click();
  await expect(page).toHaveURL(
    `${workBase}/new?type=case&parent=work_incident`,
  );
  await workPage()
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Find missing carrier allocation');
  await workPage()
    .getByRole('button', { name: 'Create work', exact: true })
    .click();
  await expect(page).toHaveURL(`${workBase}/work_case`);
  await expect(
    workPage().getByText('Open Detective tools and evidence', { exact: true }),
  ).toBeVisible();
  expect(workWrites.map((body) => body.action)).toEqual([
    'create',
    'comment',
    'create',
  ]);
  expect(
    writes.some(
      (body) => body['type'] === 'create' || body['type'] === 'start-case',
    ),
  ).toBe(false);
  expect(linkedCase?.['id']).not.toBe(incidentRef.incidentId);
  await expect(
    workPage().getByText('Parent · Incident', { exact: true }),
  ).toBeVisible();
  await page.goto(`${workBase}/work_incident`);
  await expect(
    workPage().getByText('Child · Detective Case', { exact: true }),
  ).toBeVisible();
  await page.goto(detail);
  await expect(
    page.getByText(`Detective Case ${linkedCase?.['id']}`),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Back to Incidents' }).click();
  await expect(
    page.getByRole('list', { name: 'Project Incidents' }),
  ).toContainText('INC-1 — Order 11039 is missing');
});

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error('Missing required Incident fixture value');
  return value;
}
