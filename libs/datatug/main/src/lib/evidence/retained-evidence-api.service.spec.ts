import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  type TestRequest,
} from '@angular/common/http/testing';
import { SneatApiAuthTokenBridge } from '@sneat/api';
import {
  decodeResult,
  type RowEvidenceSelector,
} from '@sneat/datatug-semantic';
import { datatugApiRealProviders } from '../services/base/datatug-api.test-helpers';
import { RetainedEvidenceApiService } from './retained-evidence-api.service';
import {
  originalContractFixture,
  originalContractPin,
} from './original-evidence.spec-helper';
import fixture from './testdata/backend-v044-retained.json';
import sourceFixture from './testdata/source-operation.http.go.json';
const scope = {
  projectRef: {
    storeId: 'firestore',
    spaceID: 'fixture-space',
    projectId: 'fixture-project',
  },
  environment: 'demo',
  actor: 'current-reader',
};
const execution = {
  kind: 'execution' as const,
  execution: fixture.execution.result.execution,
};
const capabilities = {
  schemaVersion: 1 as const,
  actorId: 'current-reader',
  databaseId: 'fixture-db',
  projectId: 'fixture-project',
  environments: [
    { environmentId: 'demo', identityDomain: 'fixture-shipping-domain' },
  ],
  actions: [],
};
async function admit(http: HttpTestingController): Promise<void> {
  let request: TestRequest | undefined;
  await vi.waitFor(() => {
    request = http.match((r) =>
      r.url.endsWith('/session-context/capabilities'),
    )[0];
    expect(request).toBeDefined();
  });
  if (!request) throw new Error('Missing current namespace request');
  request.flush(capabilities);
  await Promise.resolve();
}
async function nextRequest(
  http: HttpTestingController,
  suffix: string,
): Promise<TestRequest> {
  let request: TestRequest | undefined;
  await vi.waitFor(() => {
    request = http.match((r) => r.url.endsWith(suffix))[0];
    expect(request).toBeDefined();
  });
  if (!request) throw new Error(`Missing ${suffix} request`);
  return request;
}
describe('Retained evidence real native HTTP reads', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [...datatugApiRealProviders(), RetainedEvidenceApiService],
    }),
  );
  afterEach(() => TestBed.resetTestingModule());
  it('uses exact source history GET scope and POST-only reference bodies with real Go response parity', async () => {
    const http = TestBed.inject(HttpTestingController),
      api = TestBed.inject(RetainedEvidenceApiService);
    const sourceScope = {
      projectRef: {
        storeId: 'firestore',
        spaceID: sourceFixture.request.spaceID,
        projectId: sourceFixture.request.projectId,
      },
      environment: sourceFixture.request.environment,
      actor: sourceFixture.request.reference.receiptActorId,
    };
    const history = api.sourceOperations(
      sourceScope,
      new AbortController().signal,
    );
    const list = await nextRequest(http, '/shipping/source-operations');
    expect(list.request.method).toBe('GET');
    expect(
      Object.fromEntries(
        list.request.params.keys().map((k) => [k, list.request.params.get(k)]),
      ),
    ).toEqual({
      storage: 'firestore',
      spaceID: sourceScope.projectRef.spaceID,
      project: sourceScope.projectRef.projectId,
      environment: 'demo',
    });
    list.flush(sourceFixture.discovery);
    expect(await history).toEqual(sourceFixture.discovery.operations);
    const opened = api.read(
      sourceScope,
      {
        kind: 'source-operation',
        sourceOperation: sourceFixture.request.reference,
      },
      new AbortController().signal,
    );
    const post = await nextRequest(http, '/shipping/source-operation/open');
    expect(post.request.method).toBe('POST');
    expect(post.request.params.keys()).toEqual([]);
    expect(post.request.body).toEqual(sourceFixture.request);
    post.flush(sourceFixture.open);
    expect(await opened).toEqual(sourceFixture.open);
    http.verify();
  });
  it('refuses source-reference account mismatch before dispatch and aborts an in-flight historical read', async () => {
    const http = TestBed.inject(HttpTestingController),
      api = TestBed.inject(RetainedEvidenceApiService);
    const sourceScope = {
      projectRef: {
        storeId: 'firestore',
        spaceID: sourceFixture.request.spaceID,
        projectId: sourceFixture.request.projectId,
      },
      environment: 'demo',
      actor: sourceFixture.request.reference.receiptActorId,
    };
    await expect(
      api.read(
        { ...sourceScope, actor: 'other' },
        {
          kind: 'source-operation',
          sourceOperation: sourceFixture.request.reference,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    http.verify();
    const controller = new AbortController(),
      pending = api.read(
        sourceScope,
        {
          kind: 'source-operation',
          sourceOperation: sourceFixture.request.reference,
        },
        controller.signal,
      );
    const post = await nextRequest(http, '/shipping/source-operation/open'),
      rejected = expect(pending).rejects.toThrow();
    controller.abort();
    await rejected;
    expect(post.cancelled).toBe(true);
    http.verify();
  });
  it('cold-opens the exact original execution using current scope without any mutation or rerun', async () => {
    const http = TestBed.inject(HttpTestingController),
      api = TestBed.inject(RetainedEvidenceApiService);
    const pending = api.read(scope, execution, new AbortController().signal);
    await admit(http);
    const request = await nextRequest(http, '/shipping/execution');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('executionId')).toBe('fixture-execution');
    expect(
      Object.fromEntries(
        request.request.params
          .keys()
          .map((key) => [key, request.request.params.get(key)]),
      ),
    ).toEqual({
      storage: 'firestore',
      spaceID: 'fixture-space',
      project: 'fixture-project',
      environment: 'demo',
      executionId: 'fixture-execution',
    });
    request.flush(fixture.execution);
    expect((await pending).manifest.actorId).toBe('fixture-actor');
    http.verify();
  });
  it('cold-opens an actual standalone CheckRun identity without converting it into a query execution', async () => {
    const http = TestBed.inject(HttpTestingController),
      api = TestBed.inject(RetainedEvidenceApiService);
    const pending = api.read(
      scope,
      {
        kind: 'check-run',
        checkRun: {
          storeId: 'firestore',
          projectId: 'fixture-project',
          environment: 'demo',
          checkId: 'request-received',
          checkVersion: 1,
          runId: 'fixture-run',
        },
      },
      new AbortController().signal,
    );
    await admit(http);
    const request = await nextRequest(http, '/shipping/check-run');
    expect(request.request.params.get('runId')).toBe('fixture-run');
    expect(request.request.params.has('executionId')).toBe(false);
    request.flush(fixture.check);
    expect('run' in (await pending)).toBe(true);
    http.verify();
  });
  it('opens only an exact held row selector and never resends that read-only POST after401', async () => {
    const http = TestBed.inject(HttpTestingController),
      api = TestBed.inject(RetainedEvidenceApiService),
      bridge = TestBed.inject(SneatApiAuthTokenBridge);
    const selector = fixture.selector as RowEvidenceSelector,
      held = decodeResult(fixture.execution.result);
    const pending = api.openRow(
      scope,
      held,
      selector,
      new AbortController().signal,
    );
    await admit(http);
    const denied = expect(pending).rejects.toMatchObject({ status: 401 });
    // Hash verification is asynchronous and must complete before the native request exists.
    let request: TestRequest | undefined;
    await vi.waitFor(() => {
      request = http.match((r) => r.url.endsWith('/shipping/evidence/open'))[0];
      expect(request).toBeDefined();
    });
    if (!request) throw new Error('Missing exact row request');
    expect(request.request.body).toEqual({
      spaceID: 'fixture-space',
      projectId: 'fixture-project',
      environment: 'demo',
      selector,
    });
    bridge.setExplicitToken('replacement-token');
    request.flush({}, { status: 401, statusText: 'Unauthorized' });
    await denied;
    http.expectNone(() => true);
    http.verify();
  });
  it('opens the actual Go row response after current authorization without changing its original business NULL', async () => {
    const http = TestBed.inject(HttpTestingController),
      api = TestBed.inject(RetainedEvidenceApiService);
    const pending = api.openRow(
      scope,
      decodeResult(fixture.execution.result),
      fixture.selector as RowEvidenceSelector,
      new AbortController().signal,
    );
    await admit(http);
    let request: TestRequest | undefined;
    await vi.waitFor(() => {
      request = http.match((r) => r.url.endsWith('/shipping/evidence/open'))[0];
      expect(request).toBeDefined();
    });
    if (!request) throw new Error('Missing exact row request');
    // Contract-only extension until Backend emits the required original status.
    request.flush({
      ...fixture.row,
      originalEvidence: {
        version: 1,
        status: 'unavailable',
        reason: 'not-admitted',
      },
    });
    const result = await pending;
    expect(result.result.execution?.executionId).toBe('fixture-execution');
    expect(result.result.recordset.rows[0][3]).toEqual({
      type: 'null',
      value: null,
    });
    http.verify();
  });
  it.each([
    'available',
    'missing',
    'malformed',
    'pin-forgery',
    'selected-event',
    'reason-array',
    'parse-status-array',
  ] as const)(
    'validates the contract-only original extension via actual HTTP client: %s',
    async (mode) => {
      const http = TestBed.inject(HttpTestingController),
        api = TestBed.inject(RetainedEvidenceApiService);
      const pending = api.openRow(
        scope,
        decodeResult(fixture.execution.result),
        fixture.selector as RowEvidenceSelector,
        new AbortController().signal,
      );
      const outcome =
        mode === 'available'
          ? expect(pending).resolves.toHaveProperty(
              'originalEvidence.status',
              'available',
            )
          : expect(pending).rejects.toThrow();
      await admit(http);
      const request = await nextRequest(http, '/shipping/evidence/open');
      expect(request.request.method).toBe('POST');
      expect(request.request.body.selector).toEqual(fixture.selector);
      const wire = {
        ...structuredClone(fixture.row),
        ...(mode === 'missing'
          ? {}
          : {
              originalEvidence:
                mode === 'malformed' ? null : originalContractFixture(),
            }),
      };
      wire.sourcePin = originalContractPin();
      if (mode === 'pin-forgery') wire.sourcePin.revision.generation = 'other';
      const response: Record<string, unknown> = wire;
      if (mode === 'selected-event') {
        const original = originalContractFixture();
        const other = {
          type: 'string' as const,
          value: 'unrelated-same-order-event',
        };
        response['originalEvidence'] = {
          ...original,
          records: original.records.map((record, index) =>
            index
              ? record
              : {
                  ...record,
                  key: other,
                  fields: { ...record.fields, event_id: other },
                },
          ),
        };
      } else if (mode === 'reason-array')
        response['originalEvidence'] = {
          version: 1,
          status: 'unavailable',
          reason: ['not-admitted'],
        };
      else if (mode === 'parse-status-array') {
        const original = originalContractFixture();
        response['originalEvidence'] = {
          ...original,
          log: { ...original.log, parseStatus: ['parsed'] },
        };
      }
      request.flush(response);
      await outcome;
      http.verify();
    },
  );
  it('returns no protected fallback on current denial and cancels an outstanding original read', async () => {
    const http = TestBed.inject(HttpTestingController),
      api = TestBed.inject(RetainedEvidenceApiService);
    const denied = api.read(scope, execution, new AbortController().signal),
      failure = expect(denied).rejects.toMatchObject({ status: 403 });
    await admit(http);
    (await nextRequest(http, '/shipping/execution')).flush(
      {},
      { status: 403, statusText: 'Forbidden' },
    );
    await failure;
    const lifetime = new AbortController(),
      pending = api.read(scope, execution, lifetime.signal),
      cancelled = expect(pending).rejects.toThrow();
    await admit(http);
    const request = await nextRequest(http, '/shipping/execution');
    lifetime.abort();
    await cancelled;
    expect(request.cancelled).toBe(true);
    http.verify();
  });
});
