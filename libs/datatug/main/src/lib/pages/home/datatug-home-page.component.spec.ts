import {
  CUSTOM_ELEMENTS_SCHEMA,
  EnvironmentProviders,
  Provider,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { SneatAuthStateService } from '@sneat/auth-core';
import { PRODUCT_PROFILE, PRODUCT_PROFILES } from '@datatug/product-profiles';

import { DatatugHomePageComponent } from './datatug-home-page.component';

const configure = (
  authStatus: 'authenticated' | 'notAuthenticated' | undefined,
  profile?: (typeof PRODUCT_PROFILES)[keyof typeof PRODUCT_PROFILES],
) => {
  const providers: Array<Provider | EnvironmentProviders> = [
    provideRouter([]),
    {
      provide: SneatAuthStateService,
      useValue: { authStatus: of(authStatus) },
    },
  ];
  if (profile) {
    providers.push({ provide: PRODUCT_PROFILE, useValue: profile });
  }
  TestBed.configureTestingModule({
    imports: [DatatugHomePageComponent],
    providers,
    schemas: [CUSTOM_ELEMENTS_SCHEMA],
  })
    // Keep the real template for the header/footer assertions but render
    // child components as unknown elements (same trick as the menu spec).
    .overrideComponent(DatatugHomePageComponent, {
      set: { imports: [], providers: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
  const fixture = TestBed.createComponent(DatatugHomePageComponent);
  fixture.detectChanges();
  return fixture;
};

describe('HomePage', () => {
  it('should create', () => {
    TestBed.configureTestingModule({
      imports: [DatatugHomePageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideRouter([]),
        {
          provide: SneatAuthStateService,
          useValue: { authStatus: of(undefined) },
        },
      ],
    })
      .overrideComponent(DatatugHomePageComponent, {
        set: {
          imports: [],
          template: '',
          providers: [],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
        },
      })
      .compileComponents();
    const fixture = TestBed.createComponent(DatatugHomePageComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
});

describe('HomePage header & footer (UX brief §1/§2/§14)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('signed out (no home panel): header carries brand AND motto', () => {
    // The panel is hidden while signed out on home (founder 2026-10-14: "no
    // empty side panel"), so the header owns the brand it used to live in.
    const fixture = configure('notAuthenticated');
    const title = fixture.nativeElement.querySelector('ion-title');
    expect(title.innerHTML).toContain('DataTug.app');
    expect(title.innerHTML).toContain(PRODUCT_PROFILES.datatug.motto);
  });

  it('signed in (panel visible): header shows the motto only, never the brand', () => {
    const fixture = configure('authenticated');
    const title = fixture.nativeElement.querySelector('ion-title');
    expect(title.innerHTML).toContain(PRODUCT_PROFILES.datatug.motto);
    expect(title.innerHTML).not.toContain('DataTug.app');
  });

  it('renders Sign in in the app header when not authenticated', () => {
    const fixture = configure('notAuthenticated');
    expect(
      fixture.nativeElement.querySelector('[data-testid="home-sign-in"]'),
    ).toBeTruthy();
  });

  it('does not render Sign in when authenticated', () => {
    const fixture = configure('authenticated');
    expect(
      fixture.nativeElement.querySelector('[data-testid="home-sign-in"]'),
    ).toBeNull();
  });

  it('main-content footer carries the single app-version block, with the DALgo attribution as a standalone line after it', () => {
    const fixture = configure(undefined);
    const footer = fixture.nativeElement.querySelector('.home-footer');
    const version = footer.querySelector('sneat-app-version');
    const credit = footer.querySelector('[data-testid="powered-by-dalgo"]');
    expect(version).toBeTruthy();
    expect(credit).toBeTruthy();
    // "Powered by DALgo" is outside the version block, its own line (brief §14).
    expect(credit.closest('sneat-app-version')).toBeNull();
    expect(credit.closest('ion-card')).toBeNull();
  });

  it('drops the legacy static sneat-copyright block', () => {
    const fixture = configure(undefined);
    expect(fixture.nativeElement.querySelector('sneat-copyright')).toBeNull();
  });

  it('profile-fallback: with no motto the header shows the brand, and the DALgo credit is declarative', () => {
    const fixture = configure(undefined, PRODUCT_PROFILES.incidentius);
    const title = fixture.nativeElement.querySelector('ion-title');
    expect(title.innerHTML).toContain('Incidentius');
    expect(
      fixture.nativeElement.querySelector('[data-testid="powered-by-dalgo"]'),
    ).toBeNull();
  });
});

describe('HomePage composition', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('pairs the home value proposition with the hero image without a redundant card header', () => {
    const fixture = configure('notAuthenticated');
    const hero = fixture.nativeElement.querySelector(
      '[data-testid="home-hero"]',
    );
    expect(hero.querySelector('h1')?.textContent).toContain(
      'Ask better questions of your data.',
    );
    expect(hero.querySelector('.hero-copy')?.textContent).toContain(
      'connected data, and saved queries together',
    );
    expect(hero.querySelector('ion-item[color="light"]')).toBeNull();
    const image = hero.querySelector('img.hero-visual');
    expect(image?.getAttribute('src')).toBe('assets/home/hero-dawn.webp');
    expect(image?.getAttribute('alt')).toContain('tugboat');
    expect(hero.querySelector('ion-list')).toBeNull();
  });

  it('keeps the Detective promotion honest about its private demo flow', () => {
    const fixture = configure('notAuthenticated');
    const headings = Array.from(
      fixture.nativeElement.querySelectorAll('h2') as NodeListOf<Element>,
    ).map((heading) => heading.textContent?.trim());
    expect(headings).toContain('Start a private Detective demo');
    expect(fixture.nativeElement.textContent).not.toContain(
      'Try Detective with real checks',
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'Explore the public demo',
    );
  });
});
