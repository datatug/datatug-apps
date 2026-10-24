import { expect, test } from './helpers/demodb-guard';
import type { WorkDetail, WorkPage } from '@sneat/datatug-main';
const base = 'http://127.0.0.1:8090/v0/datatug';
const scope = { spaceID: 'space', projectID: 'project' };
/** Run e2e-work first: this epilogue reuses its actual Northwind Incident/Case and retained evidence. */
test('resolved Northwind Incident origin, related investigation, stale editor and viewer isolation', async ({
  request,
}, testInfo) => {
  async function login(actor: string) {
    const response = await request.post(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=e2e',
      {
        data: {
          email: `${actor}@work.example.test`,
          password: 'work-emulator-only-2026',
          returnSecureToken: true,
        },
      },
    );
    expect(response.ok()).toBe(true);
    return { Authorization: `Bearer ${(await response.json()).idToken}` };
  }
  const headers = await login('alice');
  const list = await request.get(`${base}/work/items`, {
    headers,
    params: { ...scope, type: 'incident' },
  });
  expect(list.ok()).toBe(true);
  const items = ((await list.json()) as WorkPage).items;
  const incident = items.find(
    (item) =>
      item.lifecycle === 'done' &&
      item.title.includes('11045') &&
      item.incident?.legacyRef,
  );
  expect(
    incident,
    'Run the real e2e-work profile first to retain the resolved Northwind11045 Incident.',
  ).toBeDefined();
  if (!incident) throw new Error('Missing persisted Northwind Incident');
  const create = await request.post(`${base}/work/actions`, {
    headers,
    data: {
      ...scope,
      operationId: crypto.randomUUID(),
      action: 'create',
      parentId: incident.id,
      parentVersion: incident.version,
      inheritance: 'snapshot',
      draft: {
        type: 'postmortem',
        title: 'Northwind11045 Incident postmortem',
        priority: 'normal',
      },
    },
  });
  expect(create.ok(), await create.text()).toBe(true);
  const work = (await create.json()) as WorkDetail;
  const source = await request.get(`${base}/work/item`, {
    headers,
    params: { ...scope, id: incident.id },
  });
  expect(source.ok()).toBe(true);
  const origin = (await source.json()) as WorkDetail;
  const investigation = origin.relatedItems?.find(
    (item) => item.type === 'case',
  );
  if (investigation) {
    const link = await request.post(`${base}/work/actions`, {
      headers,
      data: {
        ...scope,
        itemId: work.item.id,
        expectedVersion: work.item.version,
        operationId: crypto.randomUUID(),
        action: 'link',
        relation: 'related',
        target: { kind: 'work', id: investigation.id },
      },
    });
    expect(link.ok(), await link.text()).toBe(true);
  }
  const details = await request.get(`${base}/postmortems/item`, {
    headers,
    params: { ...scope, id: work.item.id },
  });
  expect(details.ok()).toBe(true);
  const current = await details.json();
  const evidence = await request.get(`${base}/postmortems/evidence`, {
    headers,
    params: { ...scope, id: work.item.id },
  });
  expect(evidence.ok()).toBe(true);
  expect(
    (await evidence.json()).evidence.some(
      (item: { kind: string }) => item.kind === 'check-run',
    ),
  ).toBe(true);
  const action = {
    ...scope,
    itemId: work.item.id,
    expectedVersion: current.work.item.version,
    action: 'save',
    draft: {
      sections: [
        {
          name: 'root-cause',
          text: 'Root cause remains unverified by the retained evidence.',
          classification: 'unknown',
          evidenceIds: [],
        },
      ],
      recommendations: [],
    },
  };
  const first = await request.post(`${base}/postmortems/actions`, {
    headers,
    data: { ...action, operationId: crypto.randomUUID() },
  });
  expect(first.ok(), await first.text()).toBe(true);
  const stale = await request.post(`${base}/postmortems/actions`, {
    headers,
    data: { ...action, operationId: crypto.randomUUID() },
  });
  expect(stale.status()).toBe(409);
  const viewer = await login('viewer');
  const denied = await request.post(`${base}/postmortems/actions`, {
    headers: viewer,
    data: {
      ...action,
      operationId: crypto.randomUUID(),
      expectedVersion: (await first.json()).work.item.version,
      action: 'approve',
    },
  });
  expect(denied.status()).toBe(403);
  const unrelated = await request.get(`${base}/postmortems/item`, {
    headers,
    params: { spaceID: 'space', projectID: 'other', id: work.item.id },
  });
  expect([403, 404]).toContain(unrelated.status());
  await testInfo.attach('origin-and-security-receipts', {
    body: JSON.stringify({
      origin: 'persisted Northwind11045 Incident',
      relatedCase: !!investigation,
      retainedCheckEvidence: true,
      staleStatus: stale.status(),
      viewerStatus: denied.status(),
      otherProjectStatus: unrelated.status(),
    }),
    contentType: 'application/json',
  });
});
