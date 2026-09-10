import { CUSTOM_ELEMENTS_SCHEMA, Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Params } from '@angular/router';
import { Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { Firestore } from 'firebase/firestore';
import { ErrorLogger } from '@sneat/core';
import { BehaviorSubject, NEVER, of } from 'rxjs';
import { By } from '@angular/platform-browser';

import { QueriesPageComponent } from './queries-page.component';
import { QueriesService } from '../queries.service';
import { DatatugNavContextService } from '../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import { QueriesTabComponent } from './queries-tab.component';
import { SqlEditorComponent } from '../../components/sqleditor/sql-editor.component';
import { IProjectContext } from '../../nav/nav-models';
import { IQueryDef, IQueryFolder, QueryType } from '../../models/definition/query-def';

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

/** Stand-in for `SqlEditorComponent` (`sneat-datatug-sql`) — same selector
 * and `sql` input, no `@acrodata/code-editor` dependency — so the describe
 * below can render `QueriesTabComponent`'s REAL template (needed to prove
 * the folder items actually (dis)appear in the DOM) without pulling in a
 * third-party code-editor custom element this test has no interest in. */
@Component({ selector: 'sneat-datatug-sql', template: '' })
class SqlEditorStubComponent {
  readonly sql = input<string>();
}

function makeParamMap(params: Params) {
  return {
    get: (key: string): string | null =>
      Object.prototype.hasOwnProperty.call(params, key) ? params[key] : null,
    has: (key: string): boolean =>
      Object.prototype.hasOwnProperty.call(params, key),
    getAll: (key: string): string[] =>
      Object.prototype.hasOwnProperty.call(params, key) ? [params[key]] : [],
    keys: Object.keys(params),
  };
}

/**
 * Regression for S154 (founder ruling, external browser on datatug.app
 * build a7eaf10): "When I switch tabs on .../queries?...&tab=personal from
 * personal to anything else and then back to personal items disappear."
 * Reproduced live against that exact build: the Personal tab's folder list
 * (albums/artists/customers/...) loads fine, but clicking "Shared" then
 * "Personal" again leaves BOTH tabs empty — no new network request fires,
 * and no second `QueriesTabComponent` gets constructed either (confirmed
 * via the page's own `console.log`s), so the data loss happens entirely
 * in-memory, on the SAME already-loaded component instance.
 *
 * Root cause: `QueriesTabComponent` is never routed on its own — it is a
 * plain child of `QueriesPageComponent`'s template
 * (`queries-page.component.html`'s single
 * `@if (tab === "shared" || tab === "personal") { <sneat-datatug-queries-tab
 * [rootFolder]="tab" /> }` keeps ONE instance alive across that whole
 * branch — Angular only destroys/recreates it when `tab` becomes
 * "active"/"bookmarked"). So `inject(ActivatedRoute)` in BOTH components
 * resolves to the SAME `ActivatedRoute`. The page's own
 * `updateUrlWithCurrentTab()` (its segment's `(ionChange)`) is a
 * query-param-only `router.navigate([], {queryParamsHandling: 'merge'})`,
 * which re-emits `queryParamMap` to every subscriber of that route —
 * including `QueriesTabComponent`'s OWN constructor subscription. That
 * subscription's no-op guard used to compare the URL's `''` "no folder"
 * sentinel against `this.currentFolder.id` — but once the root folder has
 * actually loaded, `currentFolder.id` is the SERVER's own id for it: the
 * literal string `'~'` (see `GithubProjectReaderService.getQueriesFolder()`
 * and `onFolderRetrieved()` below). `'' !== '~'` defeated the guard and
 * reset `currentFolder` to the bare `{path: '~', id: ''}` stub — losing
 * the folders/items with nothing left to re-fetch them (`loadQueries()`
 * only ever runs once, in the constructor).
 *
 * This test shares ONE `ActivatedRoute`/`queryParamMap` between the real
 * `QueriesPageComponent` template and the real `QueriesTabComponent`
 * class+template, and a `Router.navigate` fake that mimics Angular's own
 * `queryParamsHandling: 'merge'` (merges the new params into the shared
 * `queryParamMap` and re-emits) — the exact mechanic the real `Router`
 * provides in the app, and the one the bug depends on.
 */
describe('QueriesPage tab switching keeps personal-tab items (S154)', () => {
  const project: IProjectContext = {
    ref: { projectId: 'demo-project-1@datatug', storeId: 'github.com' },
  } as IProjectContext;

  const folder: IQueryFolder = {
    id: '~',
    items: [
      {
        id: 'q1',
        title: 'Customer invoices',
        request: { queryType: QueryType.SQL, text: 'select 1' },
      } as IQueryDef,
    ],
  };

  let currentParams: Params;
  let paramMap$: BehaviorSubject<ReturnType<typeof makeParamMap>>;
  let fixture: ComponentFixture<QueriesPageComponent>;
  let component: QueriesPageComponent;

  beforeEach(async () => {
    currentParams = { tab: 'personal' };
    paramMap$ = new BehaviorSubject(makeParamMap(currentParams));

    const navigate = vi.fn(
      (_commands: unknown[], extras?: { queryParams?: Params }) => {
        currentParams = { ...currentParams, ...(extras?.queryParams ?? {}) };
        paramMap$.next(makeParamMap(currentParams));
        return Promise.resolve(true);
      },
    );

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
            queryParamMap: paramMap$,
            paramMap: of(makeParamMap({})),
            snapshot: { paramMap: { get: () => null }, params: {} },
          },
        },
        {
          provide: Router,
          useValue: { navigate, events: of() },
        },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: of(project) },
        },
        {
          provide: QueriesService,
          useValue: { getQueriesFolder: vi.fn(() => of(folder)) },
        },
        { provide: DatatugNavService, useValue: { goQuery: vi.fn() } },
      ],
    })
      .overrideComponent(QueriesPageComponent, {
        set: { imports: [QueriesTabComponent], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      // Real QueriesTabComponent class AND template (needed to prove items
      // actually (dis)appear in the DOM) — only its `sneat-datatug-sql` leaf
      // is swapped for a dependency-free stub (see SqlEditorStubComponent).
      .overrideComponent(QueriesTabComponent, {
        remove: { imports: [SqlEditorComponent] },
        add: { imports: [SqlEditorStubComponent], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(QueriesPageComponent);
    component = fixture.componentInstance;
  });

  function tab(): QueriesTabComponent {
    const debugEl = fixture.debugElement.query(By.directive(QueriesTabComponent));
    expect(debugEl).toBeTruthy();
    return debugEl.componentInstance as QueriesTabComponent;
  }

  // `.textContent` doesn't reliably walk light-DOM children of the
  // unregistered `ion-*` custom elements under happy-dom (this suite's DOM
  // env — no real Ionic/Stencil runtime is loaded in tests), so this reads
  // rendered markup via `.innerHTML` instead — proven reliable against the
  // same fixture, unlike `.textContent`/`.innerText`.
  function tabHtml(): string {
    return (fixture.debugElement.query(By.directive(QueriesTabComponent))
      .nativeElement as HTMLElement).innerHTML;
  }

  // `fixture.detectChanges(false)` throughout (never the default
  // `true`/checkNoChanges): this test mutates `tab` and calls
  // `updateUrlWithCurrentTab()` directly — standing in for what a real
  // segment click's `[(ngModel)]` write + `(ionChange)` handler do — rather
  // than dispatching a DOM event, so Angular's dev-mode
  // ExpressionChangedAfterItHasBeenCheckedError re-verification pass trips
  // over that externally-driven change. The app itself hits no such error:
  // a real click's listener is itself what notifies Angular's zoneless
  // scheduler, so the DOM write and the checked value are never out of sync
  // the way they are when a test pokes a field directly.
  it("keeps the personal tab's items after switching to shared and back", () => {
    component.tab = 'personal';
    fixture.detectChanges(false);
    // Sanity check the REAL template actually paints the loaded item (not
    // just component state) — proves the harness below is faithful. This
    // is the fixture's first-ever render (creation mode always does a full,
    // unconditional check), so it reflects state correctly even without an
    // explicit notify — unlike the later checks below.
    expect(tabHtml()).toContain('Customer invoices');
    expect(tab().currentFolder.items?.map((i) => i.id)).toEqual(['q1']);

    // Simulate clicking the "Shared" segment button: `[(ngModel)]="tab"`
    // updates `tab` first, then `(ionChange)="updateUrlWithCurrentTab()"`
    // fires — a query-param-only merge navigate on the SAME ActivatedRoute
    // QueriesTabComponent's own constructor is subscribed to (see this
    // describe's own doc comment above for why: the tab is never routed on
    // its own, so it shares the page's ActivatedRoute).
    component.tab = 'shared';
    component.updateUrlWithCurrentTab();
    fixture.detectChanges(false);

    // And back to "Personal" the same way. The regression: on unfixed code
    // this merge-navigate echo (folder-less, like the FIRST one above) fails
    // its own no-op guard and wipes `currentFolder` back to the empty
    // `{path: '~', id: ''}` stub — losing the items with nothing left to
    // re-fetch them. Asserted directly on component state, not rendered
    // HTML: this app is zoneless, and `fixture.detectChanges()` only
    // refreshes views the scheduler was actually notified about — a plain
    // field mutation from a faked (non-DOM-event) `router.navigate()` call
    // notifies nothing, unlike a real click or the real Router (which
    // itself participates in the zoneless scheduler after every
    // navigation). Reproducing that exact notification under a faked
    // Router is incidental to this regression — the STATE loss inside
    // `QueriesTabComponent` is the actual bug, and asserting on it directly
    // is fully decisive without depending on a render that a test double
    // has no reason to trigger.
    component.tab = 'personal';
    component.updateUrlWithCurrentTab();
    fixture.detectChanges(false);

    expect(tab().currentFolder.items?.map((i) => i.id)).toEqual(['q1']);
  });
});
