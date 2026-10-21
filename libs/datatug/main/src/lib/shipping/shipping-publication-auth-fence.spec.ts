import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { SneatApiAuthTokenBridge } from '@sneat/api';
import { SneatAuthStateService } from '@sneat/auth-core';
import {
  AgentContextService,
  DatatugApiBaseUrl,
} from '@sneat/datatug-semantic';
import { BehaviorSubject, of } from 'rxjs';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { ShippingQueryAccessComponent } from './shipping-query-access.component';

describe('Query publication original native identity HTTP fence', () => {
  async function mount() {
    sessionStorage.clear();
    const auth = new BehaviorSubject({
      status: 'authenticated',
      user: { uid: 'sarah' },
    });
    const project = new BehaviorSubject({
      ref: { storeId: 'firestore', spaceID: 'space', projectId: 'training' },
    });
    TestBed.configureTestingModule({
      imports: [ShippingQueryAccessComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DatatugApiBaseUrl, useValue: 'https://datatug.test/v0/' },
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: project, currentEnv: of(undefined) },
        },
        { provide: AgentContextService, useValue: {} },
      ],
    });
    const bridge = TestBed.inject(SneatApiAuthTokenBridge);
    bridge.setExplicitToken('token-A');
    const http = TestBed.inject(HttpTestingController),
      fixture = TestBed.createComponent(ShippingQueryAccessComponent);
    fixture.componentRef.setInput('environments', ['demo']);
    fixture.componentRef.setInput('canWrite', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.chooseEnvironment('demo');
    await fixture.whenStable();
    http
      .expectOne((r) => r.url.endsWith('/shipping/publication'))
      .flush({ exists: false });
    await fixture.whenStable();
    return { auth, project, bridge, http, fixture };
  }
  it.each(['actor', 'project', 'destroy'] as const)(
    'cancels initial token wait on %s before tokenB can submit Sarah intent',
    async (change) => {
      const f = await mount();
      f.bridge.beginAuthentication();
      f.fixture.componentInstance.prepare(true);
      f.http.expectNone((r) => r.method === 'POST');
      if (change === 'actor')
        f.auth.next({ status: 'authenticated', user: { uid: 'maya' } });
      else if (change === 'project')
        f.project.next({
          ref: { storeId: 'firestore', spaceID: 'space', projectId: 'other' },
        });
      else f.fixture.destroy();
      f.bridge.setExplicitToken('token-B');
      f.http.expectNone((r) => r.method === 'POST');
      if (change !== 'destroy') f.fixture.destroy();
      f.http.verify({ ignoreCancelled: true });
    },
  );
  it('drops an already selected async tokenA resolver after native actor changes', async () => {
    const f = await mount();
    let resolveA: ((value: string) => void) | undefined;
    const tokenA = new Promise<string>((resolve) => {
      resolveA = resolve;
    });
    f.bridge.beginAuthentication().resolveWithTokenResolver(() => tokenA);
    f.fixture.componentInstance.prepare(true);
    f.http.expectNone((r) => r.method === 'POST');
    f.auth.next({ status: 'authenticated', user: { uid: 'maya' } });
    f.bridge.setExplicitToken('token-B');
    if (!resolveA) throw new Error('Missing selected token resolver');
    resolveA('late-token-A');
    await Promise.resolve();
    await Promise.resolve();
    f.http.expectNone((r) => r.method === 'POST');
    f.fixture.destroy();
    f.http.verify({ ignoreCancelled: true });
  });
  it('refuses a new operation after native identity changed before effects repaint', async () => {
    const f = await mount();
    f.auth.next({ status: 'authenticated', user: { uid: 'maya' } });
    f.fixture.componentInstance.prepare(true);
    f.http.expectNone((r) => r.method === 'POST');
    f.fixture.destroy();
    f.http.verify({ ignoreCancelled: true });
  });
  it('cancels an in-flight request across principal change and cannot resend401', async () => {
    const f = await mount();
    f.fixture.componentInstance.prepare(true);
    const post = f.http.expectOne((r) => r.method === 'POST');
    expect(post.request.headers.get('Authorization')).toBe('Bearer token-A');
    f.auth.next({ status: 'authenticated', user: { uid: 'maya' } });
    f.bridge.setExplicitToken('token-B');
    expect(post.cancelled).toBe(true);
    expect(() =>
      post.flush({}, { status: 401, statusText: 'Unauthorized' }),
    ).toThrow(/cancelled/);
    f.http.expectNone((r) => r.method === 'POST');
    f.fixture.destroy();
    f.http.verify({ ignoreCancelled: true });
  });
  it('preserves uncertain401 intent until explicit current read restores readiness; retry is exact', async () => {
    const f = await mount();
    f.fixture.componentInstance.prepare(true);
    const first = f.http.expectOne((r) => r.method === 'POST'),
      intent = first.request.body;
    first.flush({}, { status: 401, statusText: 'Unauthorized' });
    await f.fixture.whenStable();
    expect(f.fixture.componentInstance.current()).toBeUndefined();
    await f.fixture.componentInstance.send();
    f.http.expectNone((r) => r.method === 'POST');
    f.fixture.componentInstance.refresh();
    await f.fixture.whenStable();
    f.http
      .expectOne((r) => r.method === 'GET')
      .flush({ exists: true, publication: { revision: 2, enabled: false } });
    await f.fixture.whenStable();
    const retried = f.fixture.componentInstance.send(),
      retry = f.http.expectOne((r) => r.method === 'POST');
    expect(retry.request.body).toEqual(intent);
    retry.flush({
      environment: 'demo',
      revision: 1,
      enabled: true,
      actorId: 'sarah',
    });
    await retried;
    await f.fixture.whenStable();
    const current = f.http.expectOne((r) => r.method === 'GET');
    current.flush({
      exists: true,
      publication: { revision: 2, enabled: false },
    });
    await f.fixture.whenStable();
    expect(f.fixture.componentInstance.enabled()).toBe(false);
    f.fixture.destroy();
    f.http.verify();
  });
});
