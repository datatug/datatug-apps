import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { ErrorLogger } from '@sneat/core';
import { IRecord } from '@sneat/data';
import { of, Subject } from 'rxjs';

import { EntityPageComponent } from './entity-page.component';
import { EntityService } from '../../../services/unsorted/entity.service';
import { IEntity } from '../../../models/definition/metapedia/entity';

describe('EntityPage', () => {
  let component: EntityPageComponent;
  let fixture: ComponentFixture<EntityPageComponent>;

  beforeEach(async () => {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: { entity: undefined } },
      writable: true,
      configurable: true,
    });
    await TestBed.configureTestingModule({
      imports: [EntityPageComponent],
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
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: EntityService,
          useValue: { getEntity: vi.fn(), getAllEntities: vi.fn() },
        },
        { provide: HttpClient, useValue: { get: vi.fn(), post: vi.fn() } },
      ],
    })
      .overrideComponent(EntityPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EntityPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

/**
 * Regression for the same "Loading..." bug class the founder reported
 * (2026-09-10) — same fix already established in
 * pages/signed-in/project/project-page.component.ts (PR #95), now guarded
 * fleet-wide by tools/check-zoneless-fields.mjs. `entity`, `sourceIndex`,
 * `sourceData`, and `sourceCols` used to be plain fields, written from
 * inside deeply nested `.subscribe()` callbacks (route.paramMap ->
 * entityService.getEntity() -> http.get()). This app runs
 * `provideZonelessChangeDetection()` (apps/datatug-app/src/main.ts), so a
 * plain-field write from an async callback never schedules a repaint on
 * its own — the page's own template has a literal "Loading..." placeholder
 * (`@if (!sourceData())`) that, before this fix, would never be replaced
 * once the real source data arrived.
 *
 * Uses `Subject`s, not `of(...)`, so the values arrive strictly after the
 * initial render — matching real HTTP timing — and never calls
 * `fixture.detectChanges()` again afterwards, relying only on
 * `fixture.whenStable()` to prove the signal writes alone re-render the
 * page with no manual intervention.
 */
describe('EntityPage replaces "Loading..." once the source data arrives (zoneless)', () => {
  let fixture: ComponentFixture<EntityPageComponent>;
  let paramMap$: Subject<{ get: (key: string) => string | null }>;
  let getEntity$: Subject<IRecord<IEntity>>;
  let httpGet$: Subject<unknown[][]>;

  beforeEach(async () => {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: { entity: undefined } },
      writable: true,
      configurable: true,
    });

    paramMap$ = new Subject();
    getEntity$ = new Subject<IRecord<IEntity>>();
    httpGet$ = new Subject<unknown[][]>();

    await TestBed.configureTestingModule({
      imports: [EntityPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: paramMap$.asObservable(),
            snapshot: { paramMap: { get: () => null } },
          },
        },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: EntityService,
          useValue: {
            getEntity: vi.fn(() => getEntity$.asObservable()),
            getAllEntities: vi.fn(),
          },
        },
        {
          provide: HttpClient,
          useValue: { get: vi.fn(() => httpGet$.asObservable()), post: vi.fn() },
        },
      ],
    })
      // Without this, `EntityService` resolves through the component's own
      // `DatatugServicesStoreModule`/`DatatugServicesUnsortedModule`
      // imports (nearer in the injector chain than this TestBed-level mock)
      // instead of the mock above, constructing the REAL service and its
      // own dependency chain instead — matching the file's other `describe`
      // block, which already blanks `imports` for the same reason.
      .overrideComponent(EntityPageComponent, {
        set: {
          imports: [],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EntityPageComponent);
  });

  it('replaces the Loading... placeholder with the source grid once it arrives, with no explicit detectChanges()', async () => {
    fixture.detectChanges(); // initial render — nothing has arrived yet
    expect(fixture.nativeElement.innerHTML).toContain('Loading...');

    const entity: IRecord<IEntity> = {
      id: 'customer',
      dbo: {
        fields: [],
        options: {
          sources: [
            {
              contentType: 'text/csv',
              url: '/assets/customer.csv',
              source: 'csv',
              mapping: {},
            },
          ],
        },
      },
    };

    // All three arrive strictly after the initial render — no
    // detectChanges() call between this and the assertions below; only
    // whenStable().
    paramMap$.next({
      get: (key) =>
        key === 'storeId' ? 's1' : key === 'projectId' ? 'p1' : 'customer',
    });
    getEntity$.next(entity);
    httpGet$.next([['region', 'alpha-2', 'alpha-3', 'name']]);
    await fixture.whenStable();

    expect(fixture.nativeElement.innerHTML).not.toContain('Loading...');
  });
});
