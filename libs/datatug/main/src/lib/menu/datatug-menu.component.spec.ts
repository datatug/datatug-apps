import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { AnalyticsService } from '@sneat/core';
import { PRODUCT_PROFILE, PRODUCT_PROFILES } from '@datatug/product-profiles';
import { Subject } from 'rxjs';

import { DatatugMenuComponent } from './datatug-menu.component';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { DatatugUserService } from '../services/base/datatug-user-service';
import { provideMockErrorLogger } from '../testing/error-logger.spec-helper';

// isLoginPage / currentStoreId / currentProject / datatugUserState /
// onProjectChanged are `protected` (template-only). Cast to read them in tests.
interface MenuInternals {
  isLoginPage(): boolean;
  isHomePage(): boolean;
  showAuthCard(): boolean;
  currentStoreId(): string | undefined;
  currentProject(): unknown;
  datatugUserState(): unknown;
  onProjectChanged(project?: unknown): void;
}
const peek = (c: DatatugMenuComponent): MenuInternals =>
  c as unknown as MenuInternals;

describe('DatatugMenuComponent', () => {
  let routerEvents: Subject<unknown>;
  let routerMock: { url: string; events: Subject<unknown> };
  let storeId$: Subject<string | undefined>;
  let project$: Subject<unknown>;
  let env$: Subject<unknown>;
  let envDbTable$: Subject<unknown>;
  let userState$: Subject<unknown>;
  let analytics: { logEvent: ReturnType<typeof vi.fn> };

  // The constructor reads router.url, so set it before creating the component.
  const createComponent = (
    url = '/',
  ): ComponentFixture<DatatugMenuComponent> => {
    routerMock.url = url;
    return TestBed.createComponent(DatatugMenuComponent);
  };

  beforeEach(async () => {
    routerEvents = new Subject();
    routerMock = { url: '/', events: routerEvents };
    storeId$ = new Subject();
    project$ = new Subject();
    env$ = new Subject();
    envDbTable$ = new Subject();
    userState$ = new Subject();
    analytics = { logEvent: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [DatatugMenuComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideMockErrorLogger(),
        { provide: Router, useValue: routerMock },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentStoreId: storeId$,
            currentProject: project$,
            currentEnv: env$,
            currentEnvDbTable: envDbTable$,
          },
        },
        {
          provide: DatatugUserService,
          useValue: { datatugUserState: userState$ },
        },
        { provide: AnalyticsService, useValue: analytics },
      ],
    })
      // Keep the real template (so visibility can be asserted) but render child
      // components as unknown elements via CUSTOM_ELEMENTS_SCHEMA.
      .overrideComponent(DatatugMenuComponent, {
        set: {
          imports: [],
          providers: [],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
        },
      })
      .compileComponents();
  });

  it('should create', () => {
    expect(createComponent().componentInstance).toBeTruthy();
  });

  describe('isLoginPage', () => {
    it('is false when not on /login at startup', () => {
      expect(peek(createComponent('/').componentInstance).isLoginPage()).toBe(
        false,
      );
    });

    it('is true when on /login at startup', () => {
      expect(
        peek(createComponent('/login').componentInstance).isLoginPage(),
      ).toBe(true);
    });

    it('updates to true on navigation to /login', () => {
      const c = createComponent('/').componentInstance;
      routerEvents.next(new NavigationEnd(1, '/login', '/login'));
      expect(peek(c).isLoginPage()).toBe(true);
    });

    it('updates back to false on navigation away from /login (e.g. browser back)', () => {
      const c = createComponent('/login').componentInstance;
      routerEvents.next(new NavigationEnd(2, '/', '/'));
      expect(peek(c).isLoginPage()).toBe(false);
    });

    it('ignores query string / hash when matching /login', () => {
      const c = createComponent('/').componentInstance;
      routerEvents.next(
        new NavigationEnd(3, '/login?next=/x', '/login?next=/x'),
      );
      expect(peek(c).isLoginPage()).toBe(true);
    });

    it('ignores non-NavigationEnd router events', () => {
      const c = createComponent('/').componentInstance;
      routerEvents.next({ not: 'a NavigationEnd' });
      expect(peek(c).isLoginPage()).toBe(false);
    });
  });

  describe('login_page_viewed analytics event', () => {
    it('logs once when entering /login at startup', () => {
      createComponent('/login');
      expect(analytics.logEvent).toHaveBeenCalledTimes(1);
      expect(analytics.logEvent).toHaveBeenCalledWith('login_page_viewed');
    });

    it('does not log when not on /login', () => {
      createComponent('/');
      expect(analytics.logEvent).not.toHaveBeenCalled();
    });

    it('logs only on transition into /login, not on repeat', () => {
      createComponent('/');
      routerEvents.next(new NavigationEnd(1, '/login', '/login'));
      routerEvents.next(new NavigationEnd(2, '/login', '/login'));
      expect(analytics.logEvent).toHaveBeenCalledTimes(1);
    });

    it('does not throw or log when Analytics is not provided', () => {
      TestBed.overrideProvider(AnalyticsService, { useValue: null });
      const c = createComponent('/login').componentInstance;
      expect(peek(c).isLoginPage()).toBe(true);
      expect(analytics.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('auth menu card visibility', () => {
    it('renders the auth menu item when not on /login', () => {
      const fixture = createComponent('/');
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('sneat-datatug-auth-menu-item'),
      ).toBeTruthy();
    });

    it('hides the auth menu item when on /login', () => {
      const fixture = createComponent('/login');
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('sneat-datatug-auth-menu-item'),
      ).toBeNull();
    });
  });

  describe('Incidents item relocated to project navigation (UX brief §13)', () => {
    // The awkward standalone Incidents sidebar card (a colored warning icon
    // floating below the auth card) is gone; the item now renders inside
    // ProjectMenuTopComponent next to the other project destinations (its
    // presence is covered by project-menu-top.component.spec.ts).
    it('no longer renders a standalone incidents card in the side panel', () => {
      const fixture = createComponent('/');
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="incidents-menu-item"]',
        ),
      ).toBeNull();
    });
  });

  describe('home panel cleanup (UX brief §2)', () => {
    it('recognizes the /home start page', () => {
      const c = createComponent('/home').componentInstance;
      expect(peek(c).isHomePage()).toBe(true);
      routerEvents.next(new NavigationEnd(9, '/', '/'));
      expect(peek(c).isHomePage()).toBe(false);
    });

    it('hides the store-selector card, the version card and the DALgo credit on /home', () => {
      const fixture = createComponent('/home');
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector(
          'sneat-datatug-menu-store-selector',
        ),
      ).toBeNull();
      expect(
        fixture.nativeElement.querySelector('sneat-app-version'),
      ).toBeNull();
      expect(
        fixture.nativeElement.querySelector('[data-testid="powered-by-dalgo"]'),
      ).toBeNull();
    });

    it('keeps the auth card on /home while signed out, pending, and signed in', () => {
      const fixture = createComponent('/home');
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('sneat-datatug-auth-menu-item'),
      ).toBeTruthy();
      userState$.next({ status: 'notAuthenticated' });
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('sneat-datatug-auth-menu-item'),
      ).toBeTruthy();
      userState$.next({ status: 'authenticating' });
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('sneat-datatug-auth-menu-item'),
      ).toBeTruthy();
      userState$.next({
        status: 'authenticated',
        record: { id: 'u1' },
      });
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('sneat-datatug-auth-menu-item'),
      ).toBeTruthy();
    });

    it('keeps the version card and the DALgo credit on non-home pages', () => {
      const fixture = createComponent('/login');
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('sneat-app-version'),
      ).toBeTruthy();
      expect(
        fixture.nativeElement.querySelector('[data-testid="powered-by-dalgo"]'),
      ).toBeTruthy();
    });
  });

  describe('build info footer', () => {
    // The shared @sneat/components AppVersionComponent (sneat-app-version) —
    // see datatug-menu.component.html. Rendered as an unknown element under
    // this spec's CUSTOM_ELEMENTS_SCHEMA, so only its presence in the DOM is
    // asserted here; AppVersionComponent's own behavior (collapse/expand,
    // copyright text) is covered by @sneat/components' own test suite.
    it('always renders the app-version footer', () => {
      const fixture = createComponent('/');
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('sneat-app-version'),
      ).toBeTruthy();
    });

    it('renders the app-version footer on the login page too', () => {
      const fixture = createComponent('/login');
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('sneat-app-version'),
      ).toBeTruthy();
    });
  });

  describe('Powered by DALgo credit', () => {
    const credit = (fixture: ComponentFixture<DatatugMenuComponent>) =>
      fixture.nativeElement.querySelector(
        '[data-testid="powered-by-dalgo"]',
      ) as HTMLAnchorElement | null;

    it('links to dalgo.io in a new tab, with the full accessible name, under the datatug profile', () => {
      const fixture = createComponent('/');
      fixture.detectChanges();
      const link = credit(fixture);
      expect(link).toBeTruthy();
      expect(link?.getAttribute('href')).toBe('https://dalgo.io');
      expect(link?.getAttribute('target')).toBe('_blank');
      expect(link?.getAttribute('rel')).toBe('noopener');
      expect(link?.getAttribute('aria-label')).toBe(
        'Powered by DALgo, the database abstraction layer for Go',
      );
      expect(link?.textContent).toContain('Powered by DALgo');
    });

    it('is a standalone attribution line, outside the version card (UX brief §14)', () => {
      const fixture = createComponent('/');
      fixture.detectChanges();
      const version = fixture.nativeElement.querySelector('sneat-app-version');
      expect(version.closest('ion-card')?.contains(credit(fixture))).toBe(
        false,
      );
    });

    it('is on the login page too', () => {
      const fixture = createComponent('/login');
      fixture.detectChanges();
      expect(credit(fixture)).toBeTruthy();
    });

    it('reads the declarative showPoweredByDalgo field: absent under incidentius', () => {
      TestBed.overrideProvider(PRODUCT_PROFILE, {
        useValue: PRODUCT_PROFILES.incidentius,
      });
      const fixture = createComponent('/');
      fixture.detectChanges();
      expect(credit(fixture)).toBeNull();
    });
  });

  describe('context tracking signals', () => {
    it('tracks the current store id', () => {
      const c = createComponent('/').componentInstance;
      storeId$.next('store-1');
      expect(peek(c).currentStoreId()).toBe('store-1');
    });

    it('tracks the current project from the service stream', () => {
      const c = createComponent('/').componentInstance;
      const project = { ref: { projectId: 'p1', storeId: 's1' } };
      project$.next(project);
      expect(peek(c).currentProject()).toBe(project);
    });

    // The incident-scope query params moved with the Incidents item into
    // ProjectMenuTopComponent — see project-menu-top.component.spec.ts.

    it('updates the current project via onProjectChanged', () => {
      const c = createComponent('/').componentInstance;
      const project = { ref: { projectId: 'p2', storeId: 's2' } };
      peek(c).onProjectChanged(project);
      expect(peek(c).currentProject()).toBe(project);
    });

    it('tracks the datatug user state', () => {
      const c = createComponent('/').componentInstance;
      const userState = { status: 'authenticated', record: { id: 'u1' } };
      userState$.next(userState);
      expect(peek(c).datatugUserState()).toBe(userState);
    });

    it('tracks the current env db table', () => {
      const c = createComponent('/').componentInstance;
      const table = { name: 't', schema: 'dbo', meta: {} };
      envDbTable$.next(table);
      expect(c.table).toBe(table);
    });
  });

  describe('teardown', () => {
    it('stops updating signals after destroy', () => {
      const fixture = createComponent('/');
      const c = fixture.componentInstance;
      storeId$.next('store-1');
      fixture.destroy();
      storeId$.next('store-2');
      expect(peek(c).currentStoreId()).toBe('store-1');
    });
  });
});
