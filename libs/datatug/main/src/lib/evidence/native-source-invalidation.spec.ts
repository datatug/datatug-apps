import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { SneatApiAuthTokenBridge } from '@sneat/api';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { datatugApiRealProviders } from '../services/base/datatug-api.test-helpers';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { DetectiveClientService } from '../detective/detective-client.service';
import {
  ShippingApiService,
  SHIPPING_SOURCE,
  type ShippingIntent,
} from '../shipping/shipping-api.service';
import {
  matchesNativeSourceInvalidation,
  NativeSourceInvalidationService,
  type NativeSourceInvalidation,
} from './native-source-invalidation';
import { useNativeRunLifetime } from './native-run-lifetime';
import fixture from './testdata/backend-v044-retained.json';
const ref = { storeId: 'firestore', spaceID: 'space', projectId: 'project' },
  actor = 'sarah';
const intent: ShippingIntent = {
  spaceID: 'space',
  projectId: 'project',
  sourceId: SHIPPING_SOURCE,
  operationId: 'reset-current',
  action: 'reset',
  expected: { generation: 'previous', revision: 1, sha256: 'a'.repeat(64) },
};
const context = {
  kind: 'cloud' as const,
  storage: 'firestore' as const,
  spaceID: 'space',
  project: 'project',
  principal: actor,
};
const ack = () => ({
  receipt: {
    operationId: intent.operationId,
    actorId: actor,
    action: 'reset',
    outcome: 'applied',
    revision: {
      ...fixture.execution.sourcePin.revision,
      generation: 'next',
      actorId: actor,
    },
    acceptedAt: '2026-10-21T00:00:00Z',
    requestSHA256: 'a'.repeat(64),
  },
  current: { generation: 'next', revision: 1, sha256: 'a'.repeat(64) },
});
describe('Verified source receipt native invalidation', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        ...datatugApiRealProviders(),
        DetectiveClientService,
        ShippingApiService,
        {
          provide: SneatAuthStateService,
          useValue: {
            authState: new BehaviorSubject({
              status: 'authenticated',
              user: { uid: actor },
            }),
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: new BehaviorSubject({ ref }) },
        },
      ],
    }),
  );
  afterEach(() => TestBed.resetTestingModule());
  it('a verified reset cancels an original queued query token wait before replacement token dispatch, without rerun or source GET', async () => {
    const api = TestBed.inject(ShippingApiService),
      http = TestBed.inject(HttpTestingController),
      bridge = TestBed.inject(SneatApiAuthTokenBridge);
    const resetting = firstValueFrom(api.action(ref, intent, actor));
    const reset = http.expectOne((r) => r.url.endsWith('/shipping/action'));
    const readiness = bridge.beginAuthentication();
    let finish: ((token: string) => void) | undefined;
    readiness.resolveWithTokenResolver(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const owner = TestBed.runInInjectionContext(() => useNativeRunLifetime()),
      captured = owner.capture(ref, actor, {
        sourceId: SHIPPING_SOURCE,
        environment: 'demo',
      });
    const pending = firstValueFrom(
      TestBed.inject(DetectiveClientService).runHostedQuery(
        context,
        'shipping/receipt',
        'demo',
        { order_id: { type: 'integer', value: '11045' } },
        { operationId: 'query-original', signal: captured.signal },
      ),
    );
    const cancelled = expect(pending).rejects.toThrow();
    http.expectNone((r) => r.url.endsWith('/detective/run_query'));
    reset.flush(ack());
    await resetting;
    expect(captured.signal.aborted).toBe(true);
    bridge.setExplicitToken('replacement-token');
    finish?.('old-token');
    await cancelled;
    await Promise.resolve();
    http.expectNone(() => true);
    http.verify();
  });
  it.each([
    ['telemetry-source', 'publication'],
    ['document-feed', 'reset'],
  ] as const)('cancels an unbound generic run for %s %s without dispatching a queued credential', async (sourceId, action) => {
    const http = TestBed.inject(HttpTestingController),
      bridge = TestBed.inject(SneatApiAuthTokenBridge),
      events = TestBed.inject(NativeSourceInvalidationService);
    let finish: ((token: string) => void) | undefined;
    bridge.beginAuthentication().resolveWithTokenResolver(() => new Promise<string>((resolve) => { finish = resolve; }));
    const owner = TestBed.runInInjectionContext(() => useNativeRunLifetime()),
      captured = owner.capture(ref, actor, { environment: 'demo' });
    const pending = firstValueFrom(TestBed.inject(DetectiveClientService).runHostedQuery(
      context, 'measurements/current', 'demo', {},
      { operationId: 'generic-original', signal: captured.signal },
    ));
    const cancelled = expect(pending).rejects.toThrow();
    events.invalidate({ projectRef: ref, actor, sourceId, environment: 'other', action });
    events.invalidate({ projectRef: ref, actor: 'other', sourceId, environment: 'demo', action });
    expect(captured.signal.aborted).toBe(false);
    events.invalidate({ projectRef: ref, actor, sourceId, environment: 'demo', action });
    expect(captured.signal.aborted).toBe(true);
    bridge.setExplicitToken('replacement-token');
    finish?.('old-token');
    await cancelled;
    http.expectNone(() => true);
    http.verify();
    expect(matchesNativeSourceInvalidation({ projectRef: ref, actor, sourceId, action }, ref, actor, undefined)).toBe(false);
  });
  it.each(['malformed', 'unavailable'] as const)(
    'does not announce %s or uncertain action acknowledgements as source changes',
    async (failure) => {
      const owner = TestBed.runInInjectionContext(() => useNativeRunLifetime()),
        captured = owner.capture(ref, actor, {
          sourceId: SHIPPING_SOURCE,
          environment: 'demo',
        });
      const pending = firstValueFrom(
          TestBed.inject(ShippingApiService).action(ref, intent, actor),
        ),
        denied = expect(pending).rejects.toBeDefined(),
        http = TestBed.inject(HttpTestingController);
      const request = http.expectOne((r) => r.url.endsWith('/shipping/action'));
      if (failure === 'malformed')
        request.flush({
          ...ack(),
          receipt: { ...ack().receipt, actorId: 'wrong-actor' },
        });
      else request.flush({}, { status: 503, statusText: 'Unavailable' });
      await denied;
      expect(captured.signal.aborted).toBe(false);
      http.verify();
    },
  );
  it('invalidates only the explicitly acknowledged publication environment and actual source/actor/project', async () => {
    const api = TestBed.inject(ShippingApiService),
      http = TestBed.inject(HttpTestingController),
      owner = TestBed.runInInjectionContext(() => useNativeRunLifetime());
    const captured = owner.capture(ref, actor, {
      sourceId: SHIPPING_SOURCE,
      environment: 'demo',
    });
    for (const environment of ['qa', 'demo']) {
      const pending = firstValueFrom(
        api.publish(
          ref,
          {
            spaceID: 'space',
            projectId: 'project',
            sourceId: SHIPPING_SOURCE,
            environment,
            operationId: 'publish-' + environment,
            expectedRevision: 0,
            enabled: false,
          },
          actor,
        ),
      );
      http
        .expectOne((r) => r.url.endsWith('/shipping/publication'))
        .flush({ environment, revision: 1, enabled: false, actorId: actor });
      await pending;
      expect(captured.signal.aborted).toBe(environment === 'demo');
    }
    http.verify();
  });
  it.each([
    'actor',
    'store',
    'space',
    'project',
    'environment',
    'source',
  ] as const)(
    'a foreign %s notification cannot cancel this native source lifetime',
    (different) => {
      let event: NativeSourceInvalidation = {
        projectRef: { ...ref },
        actor,
        sourceId: SHIPPING_SOURCE,
        environment: 'demo',
        action: 'reset',
      };
      if (different === 'actor') event = { ...event, actor: 'other' };
      else if (different === 'store')
        event = {
          ...event,
          projectRef: { ...event.projectRef, storeId: 'other' },
        };
      else if (different === 'space')
        event = {
          ...event,
          projectRef: { ...event.projectRef, spaceID: 'other' },
        };
      else if (different === 'project')
        event = {
          ...event,
          projectRef: { ...event.projectRef, projectId: 'other' },
        };
      else if (different === 'environment')
        event = { ...event, environment: 'qa' };
      else event = { ...event, sourceId: 'invoice' };
      expect(
        matchesNativeSourceInvalidation(event, ref, actor, {
          sourceId: SHIPPING_SOURCE,
          environment: 'demo',
        }),
      ).toBe(false);
      const owner = TestBed.runInInjectionContext(() => useNativeRunLifetime()),
        captured = owner.capture(ref, actor, {
          sourceId: SHIPPING_SOURCE,
          environment: 'demo',
        });
      TestBed.inject(NativeSourceInvalidationService).invalidate(event);
      expect(captured.signal.aborted).toBe(false);
    },
  );
});
