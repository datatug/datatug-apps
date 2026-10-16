import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterLink } from '@angular/router';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { of, Subject } from 'rxjs';

import { PRODUCT_PROFILE, PRODUCT_PROFILES } from '@datatug/product-profiles';
import { ProjectMenuTopComponent } from './project-menu-top.component';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { DatatugUserService } from '../../../services/base/datatug-user-service';
import { datatugProjectRoutes } from '../../../routes/datatug-routing-proj';
import { DEMO_PROJECT_REF } from '@datatug/project-address';
import { projectPageHref } from '../../../nav/project-page-href';

describe('ProjectContextMenuComponent', () => {
  let component: ProjectMenuTopComponent;
  let fixture: ComponentFixture<ProjectMenuTopComponent>;
  let router: {
    url: string;
    events: ReturnType<typeof of>;
    parseUrl: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    router = {
      url: '/',
      events: of(),
      parseUrl: vi.fn((url: string) => ({ url })),
    };
    await TestBed.configureTestingModule({
      imports: [ProjectMenuTopComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: Router, useValue: router },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(undefined),
            currentStoreId: of(undefined),
            currentEnv: of(undefined),
            currentFolder: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
        { provide: PRODUCT_PROFILE, useValue: PRODUCT_PROFILES.datatug },
        { provide: DatatugNavService, useValue: { goProjPage: vi.fn() } },
        {
          provide: DatatugUserService,
          useValue: {
            datatugUserState: of({ status: undefined, record: null }),
          },
        },
      ],
    })
      .overrideComponent(ProjectMenuTopComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ProjectMenuTopComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it.each([
    [
      { storeId: 'localhost:8989', projectId: 'p1' },
      '/store/localhost:8989/project/p1',
    ],
    [
      { storeId: 'firestore', spaceID: 'S1', projectId: 'p1' },
      '/space/S1/store/firestore/project/p1',
    ],
  ])(
    'builds visible menu links in the admitted project/session scopes for %j',
    (ref, base) => {
      component.project = { ref };
      router.url = `${base}/sessions/session-a/overview`;
      expect(component.projectPageUrl('queries')).toBe(
        `${base}/sessions/session-a/queries`,
      );
      expect(component.projectPageUrl('overview')).toBe(
        `${base}/sessions/session-a/overview`,
      );
      expect(component.projectPageUrl('checks')).toBe(`${base}/checks`);
      expect(component.projectPageUrl('detective')).toBe(`${base}/detective`);
      expect(component.projectPageUrl('sessions')).toBe(`${base}/sessions`);
      if (!('spaceID' in ref))
        expect(component.projectPageUrl('variables')).toBe(
          `${base}/sessions/session-a/variables`,
        );
      router.url =
        '/store/localhost:8989/project/other/sessions/session-b/overview';
      expect(component.projectPageUrl('queries')).toBe(`${base}/queries`);
    },
  );

  it('REQ:context-basket — links to the Investigation Context screen (the former "Variables" empty-shell entry), unconditionally', () => {
    const entry = component.projTopLevelPages.find(
      (page) => page.path === 'variables',
    );
    expect(entry).toMatchObject({
      path: 'variables',
      title: 'Investigation Context',
    });
  });

  it('keeps the Sandbox route for deep links without duplicating it in the project menu', () => {
    expect(
      component.projTopLevelPages.some(
        (page) => page.path === 'demo-db-sandbox',
      ),
    ).toBe(false);
    expect(
      datatugProjectRoutes.some((route) => route.path === 'demo-db-sandbox'),
    ).toBe(true);
  });

  // Regression coverage for the founder-reported NG04002 ("Overview" 404):
  // every item actually rendered in the side menu must resolve to a route
  // under `store/:storeId/project/:projectId/*` — a menu entry with no
  // matching route is exactly the class of bug this test catches, without
  // booting the router (imports the routes array directly and matches
  // paths, per the task brief).
  it('every rendered projTopLevelPages entry has a matching datatugProjectRoutes path', () => {
    const routePaths = new Set(datatugProjectRoutes.map((r) => r.path));
    for (const page of component.projTopLevelPages) {
      expect(
        routePaths.has(page.path),
        `no route for menu item "${page.path}"`,
      ).toBe(true);
    }
  });

  // Any `buttons` shortcut (e.g. a former "+" add button) must itself
  // resolve too — a shortcut to nowhere is the same class of bug as a
  // top-level menu item to nowhere (see the removed "query" add button,
  // which routed to a bare 'query' segment with no matching route: only
  // 'query/:queryId', requiring an id, exists).
  it('every projTopLevelPages button target has a matching datatugProjectRoutes path', () => {
    const routePaths = new Set(datatugProjectRoutes.map((r) => r.path));
    for (const page of component.projTopLevelPages) {
      for (const button of page.buttons ?? []) {
        expect(
          routePaths.has(button.path),
          `no route for button "${button.path}" on menu item "${page.path}"`,
        ).toBe(true);
      }
    }
  });
});

describe('ProjectMenuTopComponent — Incidents link (UX brief §13)', () => {
  let storeId$: Subject<string | undefined>;
  let project$: Subject<unknown>;
  let env$: Subject<unknown>;

  interface IncidentInternals {
    incidentQueryParams(): Readonly<Record<string, string>> | undefined;
  }

  const render = (
    profile: (typeof PRODUCT_PROFILES)[keyof typeof PRODUCT_PROFILES],
  ): ComponentFixture<ProjectMenuTopComponent> => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProjectMenuTopComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        // Real Router (no override): the Investigation Context child reads
        // RouterSnapshotService, which a stubbed Router token would break.
        provideRouter([]),
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: project$,
            currentStoreId: storeId$,
            currentEnv: env$,
            currentFolder: new Subject(),
            setCurrentEnvironment: vi.fn(),
          },
        },
        { provide: PRODUCT_PROFILE, useValue: profile },
        { provide: DatatugNavService, useValue: { goProjPage: vi.fn() } },
        {
          provide: DatatugUserService,
          useValue: {
            datatugUserState: of({ status: undefined, record: null }),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProjectMenuTopComponent);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(() => {
    storeId$ = new Subject();
    project$ = new Subject();
    env$ = new Subject();
  });

  it('renders the Incidents row with the standard non-colored menu icon under the datatug profile', () => {
    const fixture = render(PRODUCT_PROFILES.datatug);
    const item = fixture.nativeElement.querySelector(
      '[data-testid="incidents-project-menu-item"]',
    );
    expect(item).toBeTruthy();
    expect(item.innerHTML).toContain('Incidents');
    const icon = item.querySelector('ion-icon');
    expect(icon.getAttribute('name')).toBe('warning-outline');
    expect(icon.getAttribute('color')).toBeNull();
  });

  it('is omitted when the profile declares showIncidentsMenuItem: false', () => {
    const fixture = render(PRODUCT_PROFILES.incidentius);
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="incidents-project-menu-item"]',
      ),
    ).toBeNull();
  });

  it('builds the incidents context link from the current agent, project, and environment', () => {
    const fixture = render(PRODUCT_PROFILES.datatug);
    storeId$.next('localhost:8989');
    project$.next({
      ref: { projectId: 'billing', storeId: 'localhost:8989' },
    });
    env$.next({ id: 'prod' });
    const internals = fixture.componentInstance as unknown as IncidentInternals;
    expect(internals.incidentQueryParams()).toEqual({
      agent: 'localhost:8989',
      storeId: 'billing',
      project: 'billing',
      environment: 'prod',
    });
  });

  it('drops the context params when any part of the scope is unknown', () => {
    const fixture = render(PRODUCT_PROFILES.datatug);
    storeId$.next('localhost:8989');
    project$.next({
      ref: { projectId: 'billing', storeId: 'localhost:8989' },
    });
    const internals = fixture.componentInstance as unknown as IncidentInternals;
    expect(internals.incidentQueryParams()).toBeUndefined();
  });
  it('renders GitHub Sessions navigation with real query parameters, never encoded pathname text', async () => {
    const fixture = render(PRODUCT_PROFILES.datatug);
    storeId$.next('github.com');
    project$.next({
      ref: {
        storeId: 'github.com',
        projectId: 'repo@owner@datatug',
        projectApi: 'cloud',
        branch: 'release/context',
      },
    });
    await fixture.whenStable();
    const item = fixture.debugElement
      .queryAll(By.directive(RouterLink))
      .find((item) => item.nativeElement.textContent.includes('Sessions'));
    if (!item) throw new Error('Missing rendered Sessions link.');
    const tree = item.injector.get(RouterLink).urlTree;
    expect(tree?.queryParams).toMatchObject({
      projectApi: 'cloud',
      branch: 'release/context',
    });
    expect(tree?.toString()).not.toContain('%3F');
  });

  it('uses the project-qualified preview only for the canonical public demo', () => {
    const fixture = render(PRODUCT_PROFILES.datatug);
    project$.next({ ref: DEMO_PROJECT_REF });
    expect(fixture.componentInstance.isDemoProject()).toBe(true);
    expect(fixture.componentInstance.incidentsProjectRoute().toString()).toBe(
      projectPageHref(DEMO_PROJECT_REF, 'incidents'),
    );
    project$.next({
      ref: { storeId: 'localhost:8989', projectId: 'shop' },
    });
    expect(fixture.componentInstance.isDemoProject()).toBe(false);
    expect(fixture.componentInstance.incidentsProjectRoute()).toBe(
      '/incidents',
    );
  });
});
