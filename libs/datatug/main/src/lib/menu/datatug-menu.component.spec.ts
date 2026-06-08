import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Analytics, logEvent } from '@angular/fire/analytics';
import { ErrorLogger } from '@sneat/core';
import { Subject } from 'rxjs';

import { DatatugMenuComponent } from './datatug-menu.component';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { DatatugUserService } from '../services/base/datatug-user-service';

// isLoginPage / currentStoreId / currentProject / datatugUserState /
// onProjectChanged are `protected` (template-only). Cast to read them in tests.
interface MenuInternals {
  isLoginPage(): boolean;
  currentStoreId(): string | undefined;
  currentProject(): unknown;
  datatugUserState(): unknown;
  onProjectChanged(project?: unknown): void;
}
const peek = (c: DatatugMenuComponent): MenuInternals =>
  c as unknown as MenuInternals;

// logEvent is a standalone export, so mock the module to assert calls and to
// avoid touching a real Firebase Analytics instance.
vi.mock('@angular/fire/analytics', () => ({
  Analytics: class Analytics {},
  logEvent: vi.fn(),
}));

describe('DatatugMenuComponent', () => {
  let routerEvents: Subject<unknown>;
  let routerMock: { url: string; events: Subject<unknown> };
  let storeId$: Subject<string | undefined>;
  let project$: Subject<unknown>;
  let envDbTable$: Subject<unknown>;
  let userState$: Subject<unknown>;

  // The constructor reads router.url, so set it before creating the component.
  const createComponent = (
    url = '/',
  ): ComponentFixture<DatatugMenuComponent> => {
    routerMock.url = url;
    return TestBed.createComponent(DatatugMenuComponent);
  };

  beforeEach(async () => {
    vi.mocked(logEvent).mockClear();
    routerEvents = new Subject();
    routerMock = { url: '/', events: routerEvents };
    storeId$ = new Subject();
    project$ = new Subject();
    envDbTable$ = new Subject();
    userState$ = new Subject();

    await TestBed.configureTestingModule({
      imports: [DatatugMenuComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        { provide: Router, useValue: routerMock },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentStoreId: storeId$,
            currentProject: project$,
            currentEnvDbTable: envDbTable$,
          },
        },
        {
          provide: DatatugUserService,
          useValue: { datatugUserState: userState$ },
        },
        { provide: Analytics, useValue: {} },
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
      expect(logEvent).toHaveBeenCalledTimes(1);
      expect(logEvent).toHaveBeenCalledWith(
        expect.anything(),
        'login_page_viewed',
      );
    });

    it('does not log when not on /login', () => {
      createComponent('/');
      expect(logEvent).not.toHaveBeenCalled();
    });

    it('logs only on transition into /login, not on repeat', () => {
      createComponent('/');
      routerEvents.next(new NavigationEnd(1, '/login', '/login'));
      routerEvents.next(new NavigationEnd(2, '/login', '/login'));
      expect(logEvent).toHaveBeenCalledTimes(1);
    });

    it('does not throw or log when Analytics is not provided', () => {
      TestBed.overrideProvider(Analytics, { useValue: null });
      const c = createComponent('/login').componentInstance;
      expect(peek(c).isLoginPage()).toBe(true);
      expect(logEvent).not.toHaveBeenCalled();
    });
  });

  describe('auth menu card visibility', () => {
    it('renders the auth menu item when not on /login', () => {
      const fixture = createComponent('/');
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('sneat-auth-menu-item'),
      ).toBeTruthy();
    });

    it('hides the auth menu item when on /login', () => {
      const fixture = createComponent('/login');
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('sneat-auth-menu-item'),
      ).toBeNull();
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
