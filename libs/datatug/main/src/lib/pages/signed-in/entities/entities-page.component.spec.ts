import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { NavController, ToastController } from '@ionic/angular';
import { ErrorLogger } from '@sneat/core';
import { IRecord } from '@sneat/data';
import { of, Subject } from 'rxjs';

import { EntitiesPageComponent } from './entities-page.component';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { EntityService } from '../../../services/unsorted/entity.service';
import { IEntity } from '../../../models/definition/metapedia/entity';
import { IProjectContext } from '../../../nav/nav-models';

describe('EntitiesPage', () => {
  let component: EntitiesPageComponent;
  let fixture: ComponentFixture<EntitiesPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntitiesPageComponent],
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
          provide: NavController,
          useValue: { navigateForward: vi.fn(() => Promise.resolve(true)) },
        },
        {
          provide: DatatugNavService,
          useValue: {
            goEntity: vi.fn(),
            goProjPage: vi.fn(),
            projectPageUrl: vi.fn(),
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(undefined),
            currentEnv: of(undefined),
          },
        },
        {
          provide: EntityService,
          useValue: {
            getAllEntities: vi.fn(() => of([])),
            deleteEntity: vi.fn(),
          },
        },
        { provide: ToastController, useValue: { create: vi.fn() } },
      ],
    })
      .overrideComponent(EntitiesPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EntitiesPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

/**
 * Regression for the exact bug reported by the founder (2026-09-10, "it
 * looks like this page has zoneless bug - it does not show data until I
 * click dropdown") and the same bug class this repo already fixed in
 * pages/signed-in/project/project-page.component.ts (PR #95), now guarded
 * fleet-wide by tools/check-zoneless-fields.mjs: `project` and `entities`
 * used to be plain fields, written from inside `.subscribe()` callbacks.
 * This app runs `provideZonelessChangeDetection()`
 * (apps/datatug-app/src/main.ts), so a plain-field write from an async
 * callback never schedules a repaint on its own — the page's own template
 * has a literal "Loading..." placeholder (`@else` branch of `@if
 * (entities())`) that, before this fix, would never be replaced once the
 * real entity list arrived.
 *
 * Uses `Subject`s, not `of(...)`, so the values arrive strictly after the
 * initial render — matching real HTTP timing — and never calls
 * `fixture.detectChanges()` again afterwards, relying only on
 * `fixture.whenStable()` to prove the signal writes alone re-render the list
 * with no manual intervention (no dropdown click, unlike the reported bug).
 */
describe('EntitiesPage replaces "Loading..." once entities arrive (zoneless)', () => {
  let fixture: ComponentFixture<EntitiesPageComponent>;
  let currentProject$: Subject<IProjectContext | undefined>;
  let getAllEntities$: Subject<IRecord<IEntity>[]>;

  beforeEach(async () => {
    currentProject$ = new Subject<IProjectContext | undefined>();
    getAllEntities$ = new Subject<IRecord<IEntity>[]>();

    await TestBed.configureTestingModule({
      imports: [EntitiesPageComponent],
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
          provide: NavController,
          useValue: { navigateForward: vi.fn(() => Promise.resolve(true)) },
        },
        {
          provide: DatatugNavService,
          useValue: {
            goEntity: vi.fn(),
            goProjPage: vi.fn(),
            projectPageUrl: vi.fn(),
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: currentProject$.asObservable(),
            currentEnv: of(undefined),
          },
        },
        {
          provide: EntityService,
          useValue: {
            getAllEntities: vi.fn(() => getAllEntities$.asObservable()),
            deleteEntity: vi.fn(),
          },
        },
        { provide: ToastController, useValue: { create: vi.fn() } },
      ],
    })
      // Keep the real template so the Loading -> list transition is
      // genuinely exercised, but strip the component's own `imports:`
      // (FormsModule, RouterLink, the Ionic components) so those real
      // Angular directives never get instantiated against a template that
      // only provides test-double services — CUSTOM_ELEMENTS_SCHEMA then
      // renders every `<ion-*>` tag and the `[routerLink]` bindings as
      // inert DOM properties. Same idiom already used successfully by
      // board/ui/pages/boards/boards-page.component.spec.ts and
      // board/ui/pages/board/board-page.component.spec.ts.
      .overrideComponent(EntitiesPageComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA], providers: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EntitiesPageComponent);
  });

  it('replaces the Loading... placeholder with the entity list once it arrives, with no explicit detectChanges()', async () => {
    fixture.detectChanges(); // initial render — nothing has arrived yet
    expect(fixture.nativeElement.innerHTML).toContain('Loading...');

    const project: IProjectContext = {
      ref: { projectId: 'p1', storeId: 'firestore' },
    };
    const entities: IRecord<IEntity>[] = [
      { id: 'customer', dbo: { title: 'Customer', fields: [] } as IEntity },
      { id: 'order', dbo: { title: 'Order', fields: [] } as IEntity },
    ];

    // Both arrive strictly after the initial render — no detectChanges()
    // call between this and the assertions below; only whenStable().
    currentProject$.next(project);
    getAllEntities$.next(entities);
    await fixture.whenStable();

    expect(fixture.nativeElement.innerHTML).not.toContain('Loading...');
    expect(fixture.nativeElement.innerHTML).toContain('Customer');
    expect(fixture.nativeElement.innerHTML).toContain('Order');
  });
});
