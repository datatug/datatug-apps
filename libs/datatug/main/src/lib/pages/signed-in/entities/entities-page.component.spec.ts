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
import { parseProjectUrl } from '../../../nav/nav-models';

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
  let component: EntitiesPageComponent;
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
    component = fixture.componentInstance;
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

  it('filters entity titles and IDs as the visitor types, then restores the list when cleared', async () => {
    fixture.detectChanges();
    currentProject$.next({ ref: { projectId: 'p1', storeId: 'firestore' } });
    getAllEntities$.next([
      { id: 'customer', dbo: { title: 'Customers', fields: [] } as IEntity },
      { id: 'order', dbo: { title: 'Orders', fields: [] } as IEntity },
    ]);
    await fixture.whenStable();

    const input = fixture.nativeElement.querySelector('ion-input');
    const type = async (value: string) => {
      input.dispatchEvent(new CustomEvent('ionInput', { detail: { value } }));
      await fixture.whenStable();
    };

    await type('  CUSTOMER  ');
    expect(fixture.nativeElement.innerHTML).toContain('Customers');
    expect(fixture.nativeElement.innerHTML).not.toContain('Orders');

    await type('missing');
    expect(fixture.nativeElement.innerHTML).toContain('No matching entities.');

    await type('');
    expect(fixture.nativeElement.innerHTML).toContain('Customers');
    expect(fixture.nativeElement.innerHTML).toContain('Orders');
  });

  it('hides unsupported entity mutations in a GitHub project while keeping the list readable', async () => {
    fixture.detectChanges();
    currentProject$.next({ ref: { projectId: 'demo', storeId: 'github.com' } });
    getAllEntities$.next([{ id: 'Album', dbo: { id: 'Album', fields: [] } }]);
    await fixture.whenStable();

    const html: string = fixture.nativeElement.innerHTML;
    expect(html).toContain('Album');
    expect(html).not.toContain('New entity');
    expect(html).not.toContain('Delete entity');
    expect(fixture.nativeElement.querySelector('ion-button')).toBeNull();
  });

  it('shows entities in the public HEAD demo route', async () => {
    const parsed = parseProjectUrl(
      '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/entities',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('Public demo route must parse');
    const getAllEntities = TestBed.inject(EntityService)
      .getAllEntities as unknown as ReturnType<typeof vi.fn>;
    fixture.detectChanges();
    currentProject$.next({
      ref: { storeId: parsed.storeId, projectId: parsed.projectId },
    });
    getAllEntities$.next([{ id: 'Album', dbo: { id: 'Album', fields: [] } }]);
    await fixture.whenStable();

    expect(getAllEntities).toHaveBeenCalledWith({
      storeId: parsed.storeId,
      projectId: parsed.projectId,
    });
    expect(component.unsupportedProject()).toBe(false);
    expect(fixture.nativeElement.innerHTML).toContain('Album');
    expect(fixture.nativeElement.innerHTML).not.toContain(
      'Entities are unavailable for this project connection or branch.',
    );
  });

  it('shows write actions only for a local agent project, not Firestore', async () => {
    fixture.detectChanges();
    currentProject$.next({ ref: { projectId: 'demo', storeId: 'firestore' } });
    getAllEntities$.next([{ id: 'Album', dbo: { id: 'Album', fields: [] } }]);
    await fixture.whenStable();
    expect(component.canMutateEntities()).toBe(false);
    expect(fixture.nativeElement.innerHTML).not.toContain('New entity');

    currentProject$.next({
      ref: { projectId: 'demo', storeId: 'http-localhost:8989' },
    });
    getAllEntities$.next([{ id: 'Album', dbo: { id: 'Album', fields: [] } }]);
    await fixture.whenStable();
    expect(component.canMutateEntities()).toBe(true);
    expect(fixture.nativeElement.innerHTML).toContain('New entity');
    expect(fixture.nativeElement.innerHTML).toContain('Delete entity');
  });

  it('shows branch-qualified entities without exposing write actions', async () => {
    const getAllEntities = TestBed.inject(EntityService)
      .getAllEntities as unknown as ReturnType<typeof vi.fn>;
    fixture.detectChanges();
    currentProject$.next({
      ref: {
        projectId: 'demo',
        storeId: 'http-localhost:8989',
        branch: 'work',
      },
    });
    getAllEntities$.next([]);
    await fixture.whenStable();

    expect(component.unsupportedProject()).toBe(false);
    expect(component.canMutateEntities()).toBe(false);
    expect(getAllEntities).toHaveBeenCalledWith({
      projectId: 'demo',
      storeId: 'http-localhost:8989',
      branch: 'work',
    });
    expect(fixture.nativeElement.innerHTML).not.toContain('Loading...');
    expect(fixture.nativeElement.innerHTML).not.toContain('New entity');
    expect(fixture.nativeElement.innerHTML).not.toContain('Delete entity');
  });

  it('ignores a previous project response after switching projects', async () => {
    const previousEntities$ = new Subject<IRecord<IEntity>[]>();
    const nextEntities$ = new Subject<IRecord<IEntity>[]>();
    const getAllEntities = TestBed.inject(EntityService)
      .getAllEntities as unknown as ReturnType<typeof vi.fn>;
    getAllEntities
      .mockReturnValueOnce(previousEntities$.asObservable())
      .mockReturnValueOnce(nextEntities$.asObservable());

    fixture.detectChanges();
    currentProject$.next({
      ref: { projectId: 'previous', storeId: 'github.com' },
    });
    currentProject$.next({ ref: { projectId: 'next', storeId: 'github.com' } });
    nextEntities$.next([{ id: 'Next', dbo: { id: 'Next', fields: [] } }]);
    await fixture.whenStable();
    expect(fixture.nativeElement.innerHTML).toContain('Next');

    previousEntities$.next([
      { id: 'Previous', dbo: { id: 'Previous', fields: [] } },
    ]);
    await fixture.whenStable();
    expect(component.entities()?.map((entity) => entity.id)).toEqual(['Next']);
    expect(fixture.nativeElement.innerHTML).not.toContain('Previous');
  });
});
