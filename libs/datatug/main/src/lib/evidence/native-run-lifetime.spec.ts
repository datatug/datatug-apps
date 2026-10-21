import {
  EnvironmentInjector,
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { SneatApiAuthTokenBridge } from '@sneat/api';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { datatugApiRealProviders } from '../services/base/datatug-api.test-helpers';
import { DetectiveClientService } from '../detective/detective-client.service';
import { useNativeRunLifetime } from './native-run-lifetime';
const ref = { storeId: 'firestore', spaceID: 'space', projectId: 'training' };
const context = {
  kind: 'cloud' as const,
  storage: 'firestore' as const,
  spaceID: 'space',
  project: 'training',
  principal: 'sarah',
};
const action = {
  type: 'create' as const,
  title: 'Shipping request',
  environment: 'demo',
};
describe('Native run original-stream mutation boundary', () => {
  let auth: BehaviorSubject<{ status: string; user: { uid: string } }>,
    navigation: BehaviorSubject<{ ref: typeof ref }>;
  beforeEach(() => {
    auth = new BehaviorSubject({
      status: 'authenticated',
      user: { uid: 'sarah' },
    });
    navigation = new BehaviorSubject({ ref });
    TestBed.configureTestingModule({
      providers: [
        ...datatugApiRealProviders(),
        DetectiveClientService,
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: navigation },
        },
      ],
    });
  });
  afterEach(() => TestBed.resetTestingModule());
  const lifetime = () =>
    TestBed.runInInjectionContext(() => useNativeRunLifetime());
  it.each(['actor', 'project', 'destroy'] as const)(
    'cancels pending native token resolution synchronously on %s before replacement credentials dispatch',
    async (change) => {
      const bridge = TestBed.inject(SneatApiAuthTokenBridge),
        http = TestBed.inject(HttpTestingController);
      const gate = bridge.beginAuthentication();
      let resolve: ((token: string) => void) | undefined;
      gate.resolveWithTokenResolver(
        () =>
          new Promise<string>((done) => {
            resolve = done;
          }),
      );
      const child = createEnvironmentInjector(
        [],
        TestBed.inject(EnvironmentInjector),
      );
      const owner = runInInjectionContext(child, () => useNativeRunLifetime()),
        captured = owner.capture(ref, 'sarah');
      const pending = firstValueFrom(
        TestBed.inject(DetectiveClientService).incidentAction(
          context,
          action,
          'operation-frozen',
          captured.signal,
        ),
      );
      const denied = expect(pending).rejects.toThrow();
      if (change === 'actor')
        auth.next({ status: 'authenticated', user: { uid: 'maya' } });
      else if (change === 'project')
        navigation.next({ ref: { ...ref, projectId: 'other' } });
      else child.destroy();
      bridge.setExplicitToken('token-B');
      resolve?.('late-token-A');
      await denied;
      await Promise.resolve();
      expect(captured.signal.aborted).toBe(true);
      http.expectNone(() => true);
      http.verify();
      if (!child.destroyed) child.destroy();
    },
  );
  it('never automatically resends a frozen Incident mutation after401 and keeps explicit same-scope retry exact', async () => {
    const bridge = TestBed.inject(SneatApiAuthTokenBridge),
      http = TestBed.inject(HttpTestingController),
      client = TestBed.inject(DetectiveClientService);
    bridge.setExplicitToken('token-A');
    const owner = lifetime(),
      signal = owner.capture(ref, 'sarah').signal;
    const pending = firstValueFrom(
      client.incidentAction(context, action, 'operation-frozen', signal),
    );
    const denied = expect(pending).rejects.toMatchObject({ status: 401 });
    const first = http.expectOne((r) =>
      r.url.endsWith('/detective/incident_action'),
    );
    const body = first.request.body;
    expect(first.request.headers.get('Authorization')).toBe('Bearer token-A');
    bridge.setExplicitToken('token-B');
    first.flush({}, { status: 401, statusText: 'Unauthorized' });
    await denied;
    http.expectNone(() => true);
    const retry = firstValueFrom(
      client.incidentAction(
        context,
        action,
        'operation-frozen',
        owner.capture(ref, 'sarah').signal,
      ),
    );
    const second = http.expectOne((r) =>
      r.url.endsWith('/detective/incident_action'),
    );
    expect(second.request.body).toEqual(body);
    second.flush({ receipt: 'operation-frozen' });
    await retry;
    http.verify();
  });
  it('refuses already changed actor before subscribing to transport', () => {
    const owner = lifetime();
    owner.capture(ref, 'sarah');
    auth.next({ status: 'authenticated', user: { uid: 'maya' } });
    expect(() => owner.capture(ref, 'sarah')).toThrow(/scope changed/);
    TestBed.inject(HttpTestingController).expectNone(() => true);
  });
});
