import { CUSTOM_ELEMENTS_SCHEMA, ChangeDetectorRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { Firestore } from 'firebase/firestore';
import { ErrorLogger } from '@sneat/core';
import { of } from 'rxjs';

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
          useValue: { getCatalogTables: vi.fn(() => of({ tables: [], views: [] })) },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null }, params: {} },
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
          useValue: { getCatalogTables: vi.fn(() => of({ tables: [], views: [] })) },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({
              get: (key: string) =>
                key === 'storeId'
                  ? 'localhost:8989'
                  : key === 'projectId'
                    ? 'demo-project'
                    : null,
            }),
            snapshot: { paramMap: { get: () => null }, params: {} },
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
