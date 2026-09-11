import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MenuController } from '@ionic/angular/menu-controller';
import { ErrorLogger } from '@sneat/core';
import { PRODUCT_PROFILE, PRODUCT_PROFILES } from '@datatug/product-profiles';

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

  it('incidentius: brand "Incidentius" with a "Planned" badge (hub REQ:brand-and-domain-honesty)', () => {
    const fixture = render(PRODUCT_PROFILES.incidentius);
    const link: HTMLAnchorElement =
      fixture.nativeElement.querySelector('a.brand-home-link');

    expect(link.getAttribute('aria-label')).toBe('Incidentius home');
    expect(link.textContent?.trim()).toBe('Incidentius Planned');
    expect(link.querySelector('.brand-planned-badge')).toBeTruthy();
  });
});
