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
import { DetectiveClientService } from '../detective/detective-client.service';
import { ShippingWorkspaceComponent } from './shipping-workspace.component';

// Actual native context and authenticated HTTP adapter: no injected signal writes
// or fake JWT decoding stand in for a principal change while auth is pending.
describe('Shipping initial native authentication fence', () => {
  async function mount() {
    const auth = new BehaviorSubject({
      status: 'authenticated',
      user: { uid: 'sarah' },
    });
    const project = new BehaviorSubject({
      ref: { storeId: 'firestore', spaceID: 'space', projectId: 'training' },
    });
    TestBed.configureTestingModule({
      imports: [ShippingWorkspaceComponent],
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
        {
          provide: DetectiveClientService,
          useValue: { state: () => of({ capabilities: { canWrite: true } }) },
        },
      ],
    });
    sessionStorage.clear();
    const bridge = TestBed.inject(SneatApiAuthTokenBridge);
    bridge.setExplicitToken('token-A');
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ShippingWorkspaceComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    http
      .expectOne((r) => r.url.endsWith('/shipping/revision'))
      .flush({
        generation: 'g1',
        revision: 1,
        sha256: 'a'.repeat(64),
        configuration: 17,
        artifacts: [],
      });
    await vi.waitFor(() =>
      expect(fixture.nativeElement.textContent).toContain(
        'Routing configuration 17',
      ),
    );
    const correct = Array.from(
      fixture.nativeElement.querySelectorAll(
        'ion-button',
      ) as NodeListOf<HTMLElement>,
    ).find((b) => b.textContent?.includes('Correct routing'));
    if (!correct) throw new Error('Missing correction control.');
    return { fixture, http, bridge, auth, project, correct };
  }
  it.each(['actor', 'project'] as const)(
    'cancels a queued Sarah mutation synchronously on native %s change before tokenB dispatch',
    async (change) => {
      const f = await mount();
      f.bridge.beginAuthentication();
      f.correct.click();
      f.http.expectNone((r) => r.url.endsWith('/shipping/action'));
      // Same JavaScript turn: effect cleanup alone is too late for this fence.
      if (change === 'actor')
        f.auth.next({ status: 'authenticated', user: { uid: 'maya' } });
      else
        f.project.next({
          ref: { storeId: 'firestore', spaceID: 'space', projectId: 'other' },
        });
      f.bridge.setExplicitToken('token-B');
      f.http.expectNone((r) => r.url.endsWith('/shipping/action'));
      f.fixture.destroy();
      f.http.verify({ ignoreCancelled: true });
    },
  );
  it('refuses a late selected async tokenA resolver after a native actor change', async () => {
    const f = await mount();
    let resolveA: ((value: string) => void) | undefined;
    const tokenA = new Promise<string>((resolve) => {
      resolveA = resolve;
    });
    const readiness = f.bridge.beginAuthentication();
    readiness.resolveWithTokenResolver(() => tokenA);
    f.correct.click();
    f.http.expectNone((r) => r.url.endsWith('/shipping/action'));
    f.auth.next({ status: 'authenticated', user: { uid: 'maya' } });
    f.bridge.setExplicitToken('token-B');
    if (!resolveA) throw new Error('Missing pending native resolver.');
    resolveA('late-token-A');
    await Promise.resolve();
    await Promise.resolve();
    f.http.expectNone((r) => r.url.endsWith('/shipping/action'));
    f.fixture.destroy();
    f.http.verify({ ignoreCancelled: true });
  });
  it('cancels initial token wait on destruction', async () => {
    const f = await mount();
    const readiness = f.bridge.beginAuthentication();
    f.correct.click();
    f.fixture.destroy();
    readiness.resolve('token-A');
    await Promise.resolve();
    f.http.expectNone((r) => r.url.endsWith('/shipping/action'));
    f.http.verify({ ignoreCancelled: true });
  });
  it('already changed native scope issues zero POST before effects repaint', async () => {
    const f = await mount();
    f.auth.next({ status: 'authenticated', user: { uid: 'maya' } });
    f.correct.click();
    f.http.expectNone((r) => r.url.endsWith('/shipping/action'));
    f.fixture.destroy();
    f.http.verify({ ignoreCancelled: true });
  });
  it('cancels in-flight native HTTP before a changed actor401 can emit another mutation', async () => {
    const f = await mount();
    f.correct.click();
    const first = f.http.expectOne((r) => r.url.endsWith('/shipping/action'));
    expect(first.request.headers.get('Authorization')).toBe('Bearer token-A');
    f.auth.next({ status: 'authenticated', user: { uid: 'maya' } });
    f.bridge.setExplicitToken('token-B');
    expect(first.cancelled).toBe(true);
    expect(() =>
      first.flush({}, { status: 401, statusText: 'Unauthorized' }),
    ).toThrow(/cancelled/);
    f.http.expectNone((r) => r.url.endsWith('/shipping/action'));
    f.fixture.destroy();
    f.http.verify({ ignoreCancelled: true });
  });
});
