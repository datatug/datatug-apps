import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectorRef,
  ElementRef,
  provideZonelessChangeDetection,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  IonInput,
  IonSegment,
  IonSegmentButton,
  IonButton,
  NavController,
} from '@ionic/angular';
import { Firestore } from 'firebase/firestore';
import { ErrorLogger } from '@sneat/core';
import { of, Subject } from 'rxjs';
import { IProjectFull } from '../../../models/definition/project';
import { ICatalogTables } from '../../../models/definition/apis/database';

import { EnvDbPageComponent } from './env-db-page.component';
import { ProjectService } from '../../../services/project/project.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { EnvironmentService } from '../../../services/unsorted/environment.service';

describe('EnvDbPage', () => {
  let component: EnvDbPageComponent;
  let fixture: ComponentFixture<EnvDbPageComponent>;

  beforeEach(async () => {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: { db: undefined } },
      writable: true,
      configurable: true,
    });
    await TestBed.configureTestingModule({
      imports: [EnvDbPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ProjectService,
          useValue: { watchProjectSummary: vi.fn(), getFull: vi.fn() },
        },
        { provide: DatatugNavService, useValue: { goTable: vi.fn() } },
        {
          provide: EnvironmentService,
          useValue: {
            getCatalogTables: vi.fn(() => of({ tables: [], views: [] })),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of(convertToParamMap({})),
            paramMap: of(convertToParamMap({})),
            snapshot: { paramMap: convertToParamMap({}), params: {} },
          },
        },
      ],
    })
      .overrideComponent(EnvDbPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EnvDbPageComponent);
    component = fixture.componentInstance;
  });

  it('registers count tooltips on the real grid and explains metadata using the event/cell contract', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    const page = component as unknown as {
      createTabulator(): void;
      tabulator: import('tabulator-tables').Tabulator & {
        modules: Record<string, unknown>;
      };
    };
    component.gridElRef = new ElementRef(grid);
    page.createTabulator();
    try {
      await new Promise<void>((resolve) =>
        page.tabulator.on('tableBuilt', resolve),
      );
      expect(page.tabulator.modules['tooltip']).toBeTruthy();
      expect(warn.mock.calls.flat().join(' ')).not.toContain(
        'Invalid column definition option: tooltip',
      );
      const data = {
        t: {
          columns: [{ name: '<b>Title</b>', dbType: 'text' }],
          foreignKeys: [{ name: 'author_fk', columns: ['AuthorId'] }],
          referencedBy: [
            {
              schema: 'public',
              name: 'Book',
              foreignKeys: [{ name: 'book_fk' }],
            },
          ],
        },
      };
      const cell = {
        getData: () => data,
      } as unknown as import('tabulator-tables').CellComponent;
      const expected = {
        cols: 'COLUMNS:\n<b>Title</b>: text',
        fks: 'FOREIGN KEYS:\nauthor_fk (AuthorId)',
        refsBy: 'REFERENCED BY:\npublic.Book (book_fk)',
      };
      for (const [field, text] of Object.entries(expected)) {
        const tooltip = page.tabulator.getColumn(field).getDefinition().tooltip;
        expect(typeof tooltip).toBe('function');
        if (typeof tooltip !== 'function')
          throw new Error('Missing count tooltip');
        const content = tooltip(
          new MouseEvent('mousemove'),
          cell,
          () => undefined,
        ) as HTMLElement;
        expect(content.textContent).toBe(text);
        expect(content.querySelector('b')).toBeNull();
        expect(content.style.whiteSpace).toBe('pre-wrap');
        const empty = tooltip(
          new MouseEvent('mousemove'),
          {
            getData: () => ({ t: {} }),
          } as unknown as import('tabulator-tables').CellComponent,
          () => undefined,
        ) as HTMLElement;
        expect(empty.textContent).toMatch(/:\nNone$/);
      }
    } finally {
      page.tabulator.destroy();
      grid.remove();
      warn.mockRestore();
    }
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

// Regression coverage for the fix in env-db-page.component.ts: `this.project` was
// never assigned from the route's project ref, so the tabulator rowClick handler's
// `if (!project || ...)` guard always bailed and a row click silently did nothing —
// found by S10's journey e2e (see e2e/journey/README.md "Known gap").
describe('EnvDbPage — project ref wiring', () => {
  let component: EnvDbPageComponent;
  let getFullMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: { db: undefined } },
      writable: true,
      configurable: true,
    });
    getFullMock = vi.fn(() => of({}));
    await TestBed.configureTestingModule({
      imports: [EnvDbPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ProjectService,
          useValue: { watchProjectSummary: vi.fn(), getFull: getFullMock },
        },
        { provide: DatatugNavService, useValue: { goTable: vi.fn() } },
        {
          provide: EnvironmentService,
          useValue: {
            getCatalogTables: vi.fn(() => of({ tables: [], views: [] })),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of(convertToParamMap({})),
            paramMap: of(
              convertToParamMap({
                storeId: 'localhost:8989',
                projectId: 'demo-project',
              }),
            ),
            snapshot: {
              paramMap: convertToParamMap({}),
              params: { environmentId: 'local', dbCatalogId: 'db' },
            },
          },
        },
      ],
    })
      .overrideComponent(EnvDbPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    component = TestBed.createComponent(EnvDbPageComponent).componentInstance;
  });

  it('sets project from the route project ref on ngOnInit', () => {
    component.ngOnInit();
    expect(component.project).toEqual({
      ref: { storeId: 'localhost:8989', projectId: 'demo-project' },
      store: { ref: { type: 'agent', url: 'localhost:8989' } },
    });
    expect(getFullMock).toHaveBeenCalledWith({
      storeId: 'localhost:8989',
      projectId: 'demo-project',
    });
  });
});

/**
 * Regression for `NG0201: No provider found for ProjectService. Source:
 * Standalone[EnvDbPageComponent]`, thrown for real on a direct URL load of
 * this page's own bare route (`env/:envId/db/:catalogId`, one level above
 * `env-db-table.page.ts`'s `/table/<type>` route). The two describes above
 * cannot see it: they stub every injected service AND blank the component's
 * own `imports`, so they prove the class constructs under hand-fed doubles,
 * not that the app can build it.
 *
 * Here the component is left exactly as production declares it, so the only
 * thing that can satisfy `ProjectService` is its own `imports` list, and only
 * leaf I/O (HTTP, Firestore, router, navigation) is stubbed.
 */
describe('EnvDbPage dependency injection', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: { db: undefined } },
      writable: true,
      configurable: true,
    });
    TestBed.configureTestingModule({
      // Importing the standalone component brings its own `imports` into the
      // testing injector — nothing else here provides the datatug services.
      imports: [EnvDbPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
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
            queryParamMap: of(convertToParamMap({})),
            paramMap: of(convertToParamMap({})),
            snapshot: { paramMap: convertToParamMap({}), params: {} },
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
        // `runInInjectionContext(() => new EnvDbPageComponent())` below
        // constructs the component without an actual host view (no
        // `TestBed.createComponent`), so the real `ChangeDetectorRef` —
        // only ever resolvable from a component's own view injector — isn't
        // available. Provide a stub so this test keeps proving what it's
        // meant to prove (every *service* dependency resolves via the
        // component's own declared `imports`), rather than failing on an
        // unrelated view-layer token.
        { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn() } },
      ],
    });
  });

  it('constructs from its own declared imports, the site that threw NG0201', () => {
    expect(() =>
      TestBed.runInInjectionContext(() => new EnvDbPageComponent()),
    ).not.toThrow();
  });

  it('resolves ProjectService, which is provided by a module and never `providedIn: root`', () => {
    expect(TestBed.inject(ProjectService, null)).toBeTruthy();
  });
});

describe('EnvDbPage catalog read lifecycle', () => {
  let fixture: ComponentFixture<EnvDbPageComponent>;
  let full: Subject<IProjectFull>;
  let catalog: Subject<ICatalogTables>;
  let params: Subject<ReturnType<typeof convertToParamMap>>;
  let getCatalogTables: ReturnType<typeof vi.fn>;
  const routeParams = {
    storeId: 'localhost:8989',
    projectId: 'demo',
    environmentId: 'local',
    dbCatalogId: 'registered',
  };

  beforeEach(async () => {
    full = new Subject();
    catalog = new Subject();
    params = new Subject();
    getCatalogTables = vi.fn(() => catalog);
    await TestBed.configureTestingModule({
      imports: [EnvDbPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ErrorLogger, useValue: { logError: vi.fn() } },
        { provide: ProjectService, useValue: { getFull: vi.fn(() => full) } },
        { provide: EnvironmentService, useValue: { getCatalogTables } },
        { provide: DatatugNavService, useValue: { goTable: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: params,
            queryParamMap: of(convertToParamMap({})),
            snapshot: {
              params: routeParams,
              paramMap: convertToParamMap(routeParams),
            },
          },
        },
      ],
    })
      .overrideComponent(EnvDbPageComponent, {
        set: {
          imports: [
            FormsModule,
            IonInput,
            IonSegment,
            IonSegmentButton,
            IonButton,
          ],
          providers: [],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
        },
      })
      .compileComponents();
    fixture = TestBed.createComponent(EnvDbPageComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    params.next(convertToParamMap(routeParams));
    await fixture.whenStable();
  });

  it('renders deferred unscanned/error feedback without a fake empty catalog and retries deliberately', async () => {
    const component = fixture.componentInstance;
    full.next({
      id: 'demo',
      title: 'Demo',
      access: 'private',
      dbServers: [],
      environments: [{ id: 'local', title: 'Local' }],
    });
    catalog.error(new Error('dbModel is empty'));
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('[role="alert"]').textContent,
    ).toContain('needs a scan');
    expect(component.loading()).toBe(false);
    expect(component.envDb).toBeUndefined();
    const hiddenCard = fixture.nativeElement.querySelector('ion-card[hidden]');
    expect(hiddenCard).not.toBeNull();
    // Ionic's author display:block rule overrides the user-agent [hidden] rule.
    // Consume the real component's scoped style against that vendor rule.
    const ionicDisplay = document.createElement('style');
    ionicDisplay.textContent = 'ion-card { display: block; }';
    document.head.appendChild(ionicDisplay);
    try {
      expect(hiddenCard.isConnected).toBe(true);
      expect(getComputedStyle(hiddenCard).display).toBe('none');
    } finally {
      ionicDisplay.remove();
    }
    catalog = new Subject();
    fixture.nativeElement.querySelector('ion-button').click();
    await fixture.whenStable();
    expect(component.loading()).toBe(true);
    full.next({ id: 'demo', title: 'Demo', access: 'private', dbServers: [] });
    expect(getCatalogTables).toHaveBeenCalledTimes(2);
    // The production grid must measure after Angular has removed hidden, including on Retry.
    const page = component as unknown as { onDataChanged(): void };
    const applyData = page.onDataChanged.bind(page);
    const applied = vi.spyOn(page, 'onDataChanged').mockImplementation(() => {
      expect(
        fixture.nativeElement.querySelector('ion-card[hidden]'),
      ).toBeNull();
      applyData();
    });
    // An admitted empty catalog is a successful result, distinct from a failed read.
    catalog.next({ tables: [], views: [] });
    await fixture.whenStable();
    expect(component.envDb?.tables).toEqual([]);
    expect(applied).toHaveBeenCalledOnce();
    expect(component.loading()).toBe(false);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('renders project-read failures and cancels pending catalog reads on scope change and destroy', async () => {
    const component = fixture.componentInstance;
    full.next({ id: 'demo', title: 'Demo', access: 'private', dbServers: [] });
    expect(catalog.observed).toBe(true);
    params.next(convertToParamMap({ ...routeParams, dbCatalogId: 'other' }));
    expect(catalog.observed).toBe(false);
    catalog.next({ tables: [], views: [] });
    expect(component.envDb).toBeUndefined();
    full.error(new Error('agent unavailable'));
    await fixture.whenStable();
    expect(component.loading()).toBe(false);
    expect(
      fixture.nativeElement.querySelector('[role="alert"]').textContent,
    ).toContain('check your connection');
    fixture.destroy();
    expect(full.observed).toBe(false);
    expect(params.observed).toBe(false);
  });
});
