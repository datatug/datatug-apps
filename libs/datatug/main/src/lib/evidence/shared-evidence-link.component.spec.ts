import {
  Component,
  input,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { SneatAuthStateService, type ISneatAuthState } from '@sneat/auth-core';
import { BehaviorSubject } from 'rxjs';
import { UsageAnalyticsService } from '../analytics/usage-analytics';
import type { IProjectRef } from '../core/project-context';
import { evidenceLinkFragment, type EvidenceLink } from './evidence-link';
import { RetainedEvidenceViewerComponent } from './retained-evidence-viewer.component';
import {
  PENDING_EVIDENCE_LINK_KEY,
  SharedEvidenceLinkComponent,
} from './shared-evidence-link.component';

const ref = { storeId: 'firestore', spaceID: 'S1', projectId: 'p1' };
const overview = '/space/S1/store/firestore/project/p1/overview';
const link: EvidenceLink = {
  environment: 'demo',
  target: {
    kind: 'check-run',
    checkRun: {
      storeId: 'firestore',
      projectId: 'p1',
      environment: 'demo',
      checkId: 'request-received',
      checkVersion: 1,
      runId: 'r1',
    },
  },
};
const fragment = evidenceLinkFragment(link, ref);
const signedIn = {
  status: 'authenticated',
  user: { uid: 'u1', isAnonymous: false },
} as unknown as ISneatAuthState;
const anonymous = { status: 'notAuthenticated' } as ISneatAuthState;

@Component({
  selector: 'sneat-datatug-retained-evidence-viewer',
  template: 'Viewer {{ environment() }} {{ target()?.kind }}',
})
class ViewerStub {
  readonly projectRef = input<unknown>();
  readonly environment = input('');
  readonly target = input<{ kind: string }>();
}

const projectRef = signal<IProjectRef | undefined>(ref);
@Component({
  imports: [SharedEvidenceLinkComponent],
  template: `<sneat-datatug-shared-evidence-link [projectRef]="ref()" />`,
})
class OverviewStub {
  readonly ref = projectRef;
}
@Component({ template: 'Login page' })
class LoginStub {}

describe('SharedEvidenceLinkComponent', () => {
  let auth: BehaviorSubject<ISneatAuthState | undefined>;
  let usage: { signInPrompted: ReturnType<typeof vi.fn> };

  async function open(url: string, state?: ISneatAuthState) {
    auth = new BehaviorSubject<ISneatAuthState | undefined>(state);
    usage = { signInPrompted: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([
          {
            path: 'space/:s/store/:st/project/:p/overview',
            component: OverviewStub,
          },
          { path: 'login', component: LoginStub },
        ]),
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        { provide: UsageAnalyticsService, useValue: usage },
      ],
    });
    TestBed.overrideComponent(SharedEvidenceLinkComponent, {
      remove: { imports: [RetainedEvidenceViewerComponent] },
      add: { imports: [ViewerStub] },
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    harness.detectChanges();
    await harness.fixture.whenStable();
    return harness;
  }
  const text = (harness: RouterTestingHarness) =>
    (harness.routeNativeElement?.textContent ?? '').replace(/\s+/g, ' ');

  beforeEach(() => projectRef.set(ref));
  afterEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('opens the run for a signed-in reader through the retained viewer', async () => {
    const harness = await open(`${overview}#${fragment}`, signedIn);
    expect(text(harness)).toContain('Shared evidence');
    expect(text(harness)).toContain('Viewer demo check-run');
    expect(usage.signInPrompted).not.toHaveBeenCalled();
    const close = harness.routeNativeElement?.querySelector(
      'ion-button',
    ) as HTMLElement;
    close.click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe(overview);
    harness.detectChanges();
    expect(text(harness)).not.toContain('Shared evidence');
  });

  it('shows nothing without an evidence fragment', async () => {
    const harness = await open(`${overview}#section`, signedIn);
    expect(text(harness).trim()).toBe('');
  });

  it('waits for sign-in state and the project identity before judging the link', async () => {
    projectRef.set(undefined);
    const harness = await open(`${overview}#${fragment}`, signedIn);
    expect(text(harness)).toContain('Checking this link');
    projectRef.set(ref);
    auth.next({ status: 'authenticating' } as ISneatAuthState);
    harness.detectChanges();
    expect(text(harness)).toContain('Checking this link');
    auth.next(signedIn);
    harness.detectChanges();
    expect(text(harness)).toContain('Viewer demo');
  });

  it('refuses a bad link without reading anything', async () => {
    const harness = await open(`${overview}#evidence=bm90LWEtbGluaw`, signedIn);
    expect(text(harness)).toContain("This evidence link can't be opened.");
    expect(text(harness)).not.toContain('Viewer');
  });

  it('asks an anonymous visitor to sign in, shows no content and keeps the link only in this tab', async () => {
    const harness = await open(`${overview}#${fragment}`, anonymous);
    expect(text(harness)).toContain('Sign in to open this shared evidence');
    expect(text(harness)).not.toContain('Viewer');
    expect(usage.signInPrompted).toHaveBeenCalledExactlyOnceWith(
      'evidence-link',
    );
    harness.detectChanges();
    expect(usage.signInPrompted).toHaveBeenCalledOnce();
    (
      harness.routeNativeElement?.querySelector('ion-button') as HTMLElement
    ).click();
    await harness.fixture.whenStable();
    const router = TestBed.inject(Router);
    // Only the overview path goes to sign-in: never the fragment.
    expect(router.url).toBe('/login?returnTo=' + encodeURIComponent(overview));
    expect(router.url).not.toContain('evidence');
    expect(
      JSON.parse(sessionStorage.getItem(PENDING_EVIDENCE_LINK_KEY) || '{}'),
    ).toMatchObject({ path: overview, fragment });
  });

  it('returns to the kept link once after sign-in', async () => {
    sessionStorage.setItem(
      PENDING_EVIDENCE_LINK_KEY,
      JSON.stringify({ path: overview, fragment, createdAt: Date.now() }),
    );
    const harness = await open(overview, signedIn);
    await vi.waitFor(() =>
      expect(TestBed.inject(Router).url).toBe(`${overview}#${fragment}`),
    );
    harness.detectChanges();
    await harness.fixture.whenStable();
    expect(text(harness)).toContain('Viewer demo check-run');
    expect(sessionStorage.getItem(PENDING_EVIDENCE_LINK_KEY)).toBeNull();
  });

  it.each([
    ['another page', { path: '/elsewhere', fragment, createdAt: Date.now() }],
    ['an old entry', { path: overview, fragment, createdAt: 0 }],
    [
      'not a link',
      { path: overview, fragment: 'code=1', createdAt: Date.now() },
    ],
    ['not a fragment', { path: overview, fragment: 42, createdAt: Date.now() }],
  ])('drops a kept link for %s', async (_name, pending) => {
    sessionStorage.setItem(PENDING_EVIDENCE_LINK_KEY, JSON.stringify(pending));
    const harness = await open(overview, signedIn);
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe(overview);
    expect(sessionStorage.getItem(PENDING_EVIDENCE_LINK_KEY)).toBeNull();
  });

  it('ignores an unreadable kept entry', async () => {
    sessionStorage.setItem(PENDING_EVIDENCE_LINK_KEY, '{oops');
    await open(overview, signedIn);
    expect(TestBed.inject(Router).url).toBe(overview);
  });

  it('forgets a kept link when the reader signs out', async () => {
    const harness = await open(overview, signedIn);
    sessionStorage.setItem(
      PENDING_EVIDENCE_LINK_KEY,
      JSON.stringify({ path: overview, fragment, createdAt: Date.now() }),
    );
    auth.next(anonymous);
    harness.detectChanges();
    await harness.fixture.whenStable();
    expect(sessionStorage.getItem(PENDING_EVIDENCE_LINK_KEY)).toBeNull();
  });

  it('still sends the visitor to sign in when tab storage is refused', async () => {
    const harness = await open(`${overview}#${fragment}`, anonymous);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    (
      harness.routeNativeElement?.querySelector('ion-button') as HTMLElement
    ).click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toContain('/login?returnTo=');
  });

  it('works without tab storage at all (blocked site data)', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      const harness = await open(`${overview}#${fragment}`, anonymous);
      (
        harness.routeNativeElement?.querySelector('ion-button') as HTMLElement
      ).click();
      await harness.fixture.whenStable();
      expect(TestBed.inject(Router).url).toContain('/login?returnTo=');
      TestBed.resetTestingModule();
      await open(overview, signedIn);
      expect(TestBed.inject(Router).url).toBe(overview);
    } finally {
      if (original) Object.defineProperty(window, 'sessionStorage', original);
    }
  });
});
