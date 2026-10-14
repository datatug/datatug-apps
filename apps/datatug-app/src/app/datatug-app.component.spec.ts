import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { MenuController } from '@ionic/angular/menu-controller';
import { ErrorLogger } from '@sneat/core';
import { SneatAuthStateService } from '@sneat/auth-core';
import { of } from 'rxjs';
import { ResizableMenuDirective } from '@sneat/ui';
import { PRODUCT_PROFILE, PRODUCT_PROFILES } from '@datatug/product-profiles';

// The shell reads auth status to decide whether the compact header shows
// its Sign-in affordance and whether the signed-out home page hides the
// side panel; `authenticated` keeps the pre-existing brand/menu assertions
// independent of it (the compact header only renders on narrow viewports,
// where jsdom/happy-dom matchMedia reports no match anyway).
const authMock = (
  status: 'authenticated' | 'notAuthenticated' | undefined = 'authenticated',
) => ({
  provide: SneatAuthStateService,
  useValue: { authStatus: of(status) },
});

interface ShellInternals {
  homePanelHidden(): boolean;
  paneWhen(): boolean | string;
}
const peek = (c: DatatugAppComponent): ShellInternals =>
  c as unknown as ShellInternals;

import { DatatugAppComponent } from './datatug-app.component';

describe('AppComponent', () => {
  let fixture: ComponentFixture<DatatugAppComponent>;
  let menuCtrl: { close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    menuCtrl = { close: vi.fn().mockResolvedValue(true) };

    await TestBed.configureTestingModule({
      imports: [DatatugAppComponent],
      providers: [
        provideRouter([]),
        { provide: MenuController, useValue: menuCtrl },
        authMock(),
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(DatatugAppComponent);
  });

  it('should create the app', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('enables the shared resizable menu with DataTug-specific width storage', () => {
    fixture.detectChanges();

    const menu = fixture.debugElement.query(
      By.directive(ResizableMenuDirective),
    );

    expect(menu).toBeTruthy();
    expect(
      menu.injector.get(ResizableMenuDirective).sneatResizableMenuStorageKey,
    ).toBe('datatug.menu.width');
  });

  it('renders the brand as a link to the home route', () => {
    fixture.detectChanges();

    const link: HTMLAnchorElement =
      fixture.nativeElement.querySelector('a.brand-home-link');

    expect(link).toBeTruthy();
    expect(link.getAttribute('aria-label')).toBe('DataTug.app home');
    expect(link.textContent?.trim()).toBe('DataTug.app');
  });

  it('navigates to the home route when the brand link is activated', async () => {
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const navigateSpy = vi
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true);

    const link: HTMLAnchorElement =
      fixture.nativeElement.querySelector('a.brand-home-link');
    link.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(navigateSpy).toHaveBeenCalled();
    const target = navigateSpy.mock.calls[0][0];
    expect(target.toString()).toBe('/');
  });

  it('closes the side menu when the brand link is activated', () => {
    fixture.detectChanges();

    const link: HTMLAnchorElement =
      fixture.nativeElement.querySelector('a.brand-home-link');
    link.click();

    expect(menuCtrl.close).toHaveBeenCalled();
  });
});

describe('DatatugAppComponent shell — signed-out home panel hidden (founder 2026-10-14)', () => {
  const render = async (status: 'authenticated' | 'notAuthenticated') => {
    await TestBed.configureTestingModule({
      imports: [DatatugAppComponent],
      providers: [
        provideRouter([
          { path: 'home', children: [] },
          { path: '**', children: [] },
        ]),
        { provide: MenuController, useValue: { close: vi.fn() } },
        authMock(status),
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();
    const fixture = TestBed.createComponent(DatatugAppComponent);
    // The panel-hiding rule keys off the profile's start page (/home for
    // datatug), not the '/' redirect pass-through — navigate there first.
    await TestBed.inject(Router).navigateByUrl('/home');
    fixture.detectChanges();
    return fixture;
  };

  it('signed out on the start page: panel hidden at every width', async () => {
    const fixture = await render('notAuthenticated');
    const c = fixture.componentInstance;
    expect(peek(c).homePanelHidden()).toBe(true);
    expect(peek(c).paneWhen()).toBe(false);
  });

  it('signed in on the start page: panel returns', async () => {
    const fixture = await render('authenticated');
    const c = fixture.componentInstance;
    expect(peek(c).homePanelHidden()).toBe(false);
    expect(peek(c).paneWhen()).toBe('(min-width: 992px)');
  });
});

// The shared app shell (brand header) rendered under each product-profile
// token this build serves (hub `product-profiles` REQ:profile-config-is-declarative:
// "a screen can be rendered under every profile token that build serves in
// one test run"). A separate top-level `describe`, not nested in the suite
// above, because each case needs `PRODUCT_PROFILE` overridden with
// `TestBed.overrideProvider` *before* `createComponent()` runs — the suite
// above creates its fixture once in a shared `beforeEach`.
describe('DatatugAppComponent shell — rendered under each profile token', () => {
  let menuCtrl: { close: ReturnType<typeof vi.fn> };

  const render = (
    profile: (typeof PRODUCT_PROFILES)[keyof typeof PRODUCT_PROFILES],
  ): ComponentFixture<DatatugAppComponent> => {
    menuCtrl = { close: vi.fn().mockResolvedValue(true) };
    TestBed.configureTestingModule({
      imports: [DatatugAppComponent],
      providers: [
        provideRouter([]),
        { provide: MenuController, useValue: menuCtrl },
        authMock(),
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        { provide: PRODUCT_PROFILE, useValue: profile },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    });
    const fixture = TestBed.createComponent(DatatugAppComponent);
    fixture.detectChanges();
    return fixture;
  };

  it('datatug: brand "DataTug.app", no planned badge', () => {
    const fixture = render(PRODUCT_PROFILES.datatug);
    const link: HTMLAnchorElement =
      fixture.nativeElement.querySelector('a.brand-home-link');

    expect(link.getAttribute('aria-label')).toBe('DataTug.app home');
    expect(link.textContent?.trim()).toBe('DataTug.app');
    expect(link.querySelector('.brand-planned-badge')).toBeNull();
  });

  it('incidentius: live app hostname removes the planned badge', () => {
    const fixture = render(PRODUCT_PROFILES.incidentius);
    const link: HTMLAnchorElement =
      fixture.nativeElement.querySelector('a.brand-home-link');

    expect(link.getAttribute('aria-label')).toBe('Incidentius home');
    expect(link.textContent?.trim()).toBe('Incidentius');
    expect(link.querySelector('.brand-planned-badge')).toBeNull();
  });
});
