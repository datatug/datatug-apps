import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter, Router, Routes } from '@angular/router';
import { NavController } from '@ionic/angular/common';
import {
  ISneatAuthState,
  ISneatUserState,
  SneatAuthStateService,
  SneatUserService,
} from '@sneat/auth-core';
import { authRoutes } from '@sneat/auth-ui';
import { APP_INFO, AnalyticsService, ErrorLogger } from '@sneat/core';
import { BehaviorSubject } from 'rxjs';
import { routes } from './datatug-app-routes';

@Component({ selector: 'datatug-test-page', template: '' })
class PageStub {}

const SPACE_ID = 'fu05n';

const authState: ISneatAuthState = {
  status: 'authenticated',
  loadingPhase: 'ready',
  token: 'test-token',
  user: {
    uid: 'founder',
    email: 'founder@example.invalid',
    displayName: 'Founder',
    isAnonymous: false,
    emailVerified: true,
    providerData: [],
  } as unknown as ISneatAuthState['user'],
};

// The founder's real account: the shared Sneat user record holds a family space, and that space is the saved
// "current space" of the shared login page.
const userState = {
  ...authState,
  record: {
    title: 'Founder',
    spaces: { [SPACE_ID]: { title: 'Family', type: 'family' } },
  },
  userRecordStatus: 'ready',
} as unknown as ISneatUserState;

describe('the shared login page of a signed-in user on DataTug (NG04002 on "Continue")', () => {
  let fixture: ComponentFixture<unknown>;
  let router: Router;

  async function openLoginPage(): Promise<void> {
    const login = authRoutes.find((route) => route.path === 'login');
    const component = await login?.loadComponent?.();
    if (!component)
      throw new Error('@sneat/auth-ui should still register /login');
    // The app's own redirect for a Sneat space, plus stand-ins for the pages around it. The root stands in for the
    // product profile's redirect to its home (profileHomeRedirectGuard, covered by its own spec).
    const spaceRedirect = routes.find(
      (route) => route.path === 'space/:spaceType/:spaceId',
    );
    const testRoutes: Routes = [
      { path: 'login', component: component as never },
      ...(spaceRedirect ? [spaceRedirect] : []),
      { path: 'home', component: PageStub },
      { path: '', pathMatch: 'full', redirectTo: 'home' },
    ];
    TestBed.configureTestingModule({
      providers: [
        provideRouter(testRoutes),
        {
          provide: SneatAuthStateService,
          useValue: {
            authState: new BehaviorSubject(authState),
            signOut: vi.fn(),
          },
        },
        {
          provide: SneatUserService,
          useValue: { userState: new BehaviorSubject(userState) },
        },
        { provide: AnalyticsService, useValue: { logEvent: vi.fn() } },
        {
          provide: ErrorLogger,
          useValue: { logError: vi.fn(), logErrorHandler: () => vi.fn() },
        },
        {
          provide: APP_INFO,
          useValue: { appId: 'datatug', appTitle: 'DataTug.app' },
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParams: {}, paramMap: new Map() } },
        },
        {
          // Ionic's NavController.navigateRoot goes to the router; this does the same without Ionic's stack.
          provide: NavController,
          useFactory: (r: Router) => ({
            navigateRoot: (url: string) => r.navigateByUrl(url),
          }),
          deps: [Router],
        },
      ],
    });
    router = TestBed.inject(Router);
    await router.navigateByUrl('/login');
    fixture = TestBed.createComponent(component as never);
    fixture.detectChanges();
  }

  beforeEach(() => {
    localStorage.setItem(
      'sneat.currentSpace',
      JSON.stringify({ id: SPACE_ID, type: 'family' }),
    );
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('takes the user to the DataTug home, not to the Sneat space, when they click Continue', async () => {
    await openLoginPage();
    const navigations: string[] = [];
    const original = router.navigateByUrl.bind(router);
    vi.spyOn(router, 'navigateByUrl').mockImplementation((url, extras) => {
      navigations.push(String(url));
      return original(url, extras);
    });

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('You are already signed in as');
    const buttons = fixture.debugElement.queryAll(By.css('ion-button'));
    const cont = buttons.find((b) =>
      b.nativeElement.textContent.includes('Continue'),
    );
    expect(cont).toBeDefined();
    cont?.nativeElement.click();
    await fixture.whenStable();
    await vi.waitFor(() => expect(router.url).toBe('/home'));

    // The login page did ask for the space (that is the shared library's choice) ...
    expect(navigations).toEqual([`/space/family/${SPACE_ID}`]);
    // ... and DataTug answered it with its own home instead of NG04002.
    expect(router.url).toBe('/home');
  });

  it('answers the space address with the root, which is where the product profile sends the user home', async () => {
    await openLoginPage();
    await expect(router.navigateByUrl('/space/family/anything')).resolves.toBe(
      true,
    );
    expect(router.url).toBe('/home');
  });
});
