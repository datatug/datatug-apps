import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { Firestore } from 'firebase/firestore';
import { ErrorLogger } from '@sneat/core';
import { NEVER, of } from 'rxjs';
import { By } from '@angular/platform-browser';

import { QueriesPageComponent } from './queries-page.component';
import { QueriesService } from '../queries.service';
import { DatatugNavContextService } from '../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import { QueriesTabComponent } from './queries-tab.component';
import { IProjectContext } from '../../nav/nav-models';
import { IQueryDef } from '../../models/definition/query-def';

describe('SqlQueriesPage', () => {
  let component: QueriesPageComponent;
  let fixture: ComponentFixture<QueriesPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QueriesPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null } },
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(() => Promise.resolve(true)),
            events: of(),
          },
        },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
      ],
    })
      .overrideComponent(QueriesPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(QueriesPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

/**
 * Regression for `NG0201: No provider found for QueriesService`, thrown for
 * real by `QueriesTabComponent` (rendered in this page's own template) on
 * every navigation to `queries` — direct URL load or in-app — because
 * neither `QueriesPageComponent` nor `QueriesTabComponent` declared any of
 * the modules that provide `QueriesService`/`DatatugNavContextService`/
 * `AppContextService`. The describe above cannot see it: it blanks this
 * component's own `imports`, so it proves the class constructs under a
 * hand-fed empty template, not that the app can build the real child tree.
 *
 * Here `QueriesPageComponent` is left exactly as production declares it —
 * `TestBed.configureTestingModule({ imports: [QueriesPageComponent] })`
 * folds its own declared `imports` (which is what this fix changed) into
 * the testing injector, the same technique
 * `env-db-table.page.spec.ts`'s "dependency injection" describe uses — and
 * only leaf I/O (HTTP, Firestore, router, navigation) is stubbed.
 */
describe('QueriesPage dependency injection', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [QueriesPageComponent],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null }, params: {} },
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(() => Promise.resolve(true)),
            events: of(),
            url: '/',
          },
        },
        {
          provide: NavController,
          useValue: {
            navigateForward: vi.fn(() => Promise.resolve(true)),
            navigateRoot: vi.fn(),
          },
        },
        { provide: HttpClient, useValue: { get: vi.fn(() => of({})) } },
        { provide: Firestore, useValue: {} },
      ],
    });
  });

  it.each([['QueriesService', QueriesService]])(
    'resolves %s, which is provided by a module and never `providedIn: root`',
    (_name, token) => {
      expect(TestBed.inject(token, null)).toBeTruthy();
    },
  );

  // DatatugNavContextService is now providedIn: 'root'
  // (nav-context-root-singletons) — no longer grouped with the above.
  it('resolves DatatugNavContextService, which is `providedIn: root`', () => {
    expect(TestBed.inject(DatatugNavContextService, null)).toBeTruthy();
  });
});

/**
 * Regression (nav-context-root-singletons, journey J3): clicking a saved query
 * on the Queries page silently did nothing. `QueriesTabComponent.goQuery()`
 * only navigates when its own `project` model has a value. The tab sets that
 * model itself, from `DatatugNavContextService.currentProject` in its
 * constructor (`loadQueries()`). But this page's template also bound
 * `[project]="project"`, and the page never assigns its own `project` field,
 * so the page's first change-detection pass wrote `undefined` over the value
 * the tab had just set.
 *
 * That bug was masked while every standalone component got its OWN
 * DatatugNavContextService: the tab's private instance emitted a second time
 * once its async project-summary fetch returned, after the parent's binding,
 * restoring the value. With DatatugNavContextService a root singleton, the
 * summary is already cached, so `currentProject` replays exactly once,
 * synchronously, during the tab's construction (modelled below with `of()`),
 * and nothing ever restored the value.
 *
 * This keeps the page's REAL template (the binding under test lives there)
 * and the tab's real class; only the tab's own template is blanked and leaf
 * I/O is stubbed.
 */
describe('QueriesPage -> QueriesTab project hand-off', () => {
  const project: IProjectContext = {
    ref: { projectId: 'datatug-demo-project', storeId: 'localhost:8989' },
  } as IProjectContext;
  let goQuery: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    goQuery = vi.fn();
    await TestBed.configureTestingModule({
      imports: [QueriesPageComponent],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null }, params: {} },
          },
        },
        {
          provide: Router,
          useValue: { navigate: vi.fn(() => Promise.resolve(true)), events: of() },
        },
        // One synchronous emission and no second one: exactly what the root
        // DatatugNavContextService replays once the project summary is cached.
        { provide: DatatugNavContextService, useValue: { currentProject: of(project) } },
        { provide: QueriesService, useValue: { getQueriesFolder: vi.fn(() => NEVER) } },
        { provide: DatatugNavService, useValue: { goQuery } },
      ],
    })
      .overrideComponent(QueriesPageComponent, {
        set: { imports: [QueriesTabComponent], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .overrideComponent(QueriesTabComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();
  });

  function renderTab(): QueriesTabComponent {
    const fixture = TestBed.createComponent(QueriesPageComponent);
    fixture.detectChanges();
    const tab = fixture.debugElement.query(By.directive(QueriesTabComponent));
    expect(tab).toBeTruthy();
    return tab.componentInstance as QueriesTabComponent;
  }

  it("keeps the tab's current project after the page's first change detection", () => {
    expect(renderTab().project()).toEqual(project);
  });

  it('navigates to a clicked query with that project', () => {
    const q = { id: 'customer-purchases-by-genre', title: 'Customer purchases by genre' } as IQueryDef;
    renderTab().goQuery(q);
    expect(goQuery).toHaveBeenCalledWith(
      project,
      expect.objectContaining({ id: 'customer-purchases-by-genre' }),
      undefined,
    );
  });
});
