import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController, NavController } from '@ionic/angular';
import { ErrorLogger } from '@sneat/core';
import { of, Subject } from 'rxjs';

import { ServersPageComponent } from './servers-page.component';
import { ProjectContextService } from '../../../services/project/project-context.service';
import { DbServerService } from '../../../services/unsorted/db-server.service';
import { IProjectRef } from '../../../core/project-context';
import { IProjDbServerSummary } from '../../../models/definition/apis/database';

describe('ServersPage', () => {
  let component: ServersPageComponent;
  let fixture: ComponentFixture<ServersPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServersPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ProjectContextService,
          useValue: {
            current$: of(undefined),
            current: undefined,
            setCurrent: vi.fn(),
          },
        },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        { provide: ModalController, useValue: { create: vi.fn() } },
        {
          provide: NavController,
          useValue: { navigateForward: vi.fn(() => Promise.resolve(true)) },
        },
        {
          provide: DbServerService,
          useValue: { getDbServers: vi.fn(), deleteDbServer: vi.fn() },
        },
      ],
    })
      .overrideComponent(ServersPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ServersPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

/**
 * Regression for the same "Loading..." bug class the founder reported
 * (2026-09-10) on the boards page, and already fixed in this repo's
 * pages/signed-in/project/project-page.component.ts (PR #95) — now guarded
 * fleet-wide by tools/check-zoneless-fields.mjs: `dbServers` used to be a
 * plain field, written from inside `.subscribe()` callbacks. This app runs
 * `provideZonelessChangeDetection()` (apps/datatug-app/src/main.ts), so a
 * plain-field write from an async callback never schedules a repaint on its
 * own — the page's own template has a literal "Loading..." placeholder
 * (`@else` of `@if (dbServers())`) that, before this fix, would never be
 * replaced once the real DB server list arrived.
 *
 * Uses `Subject`s, not `of(...)`, so the values arrive strictly after the
 * initial render — matching real HTTP/nav-context timing — and never calls
 * `fixture.detectChanges()` again afterwards, relying only on
 * `fixture.whenStable()` to prove the signal writes alone re-render the
 * list with no manual intervention.
 */
describe('ServersPage replaces "Loading..." once DB servers arrive (zoneless)', () => {
  let component: ServersPageComponent;
  let fixture: ComponentFixture<ServersPageComponent>;
  let current$: Subject<IProjectRef | undefined>;
  let getDbServers$: Subject<IProjDbServerSummary[]>;

  beforeEach(async () => {
    current$ = new Subject<IProjectRef | undefined>();
    getDbServers$ = new Subject<IProjDbServerSummary[]>();

    const projectContextServiceMock = {
      current$: current$.asObservable(),
      current: undefined,
      setCurrent: vi.fn(),
    };
    const dbServerServiceMock = {
      getDbServers: vi.fn(() => getDbServers$.asObservable()),
      deleteDbServer: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ServersPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: ProjectContextService, useValue: projectContextServiceMock },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        { provide: ModalController, useValue: { create: vi.fn() } },
        {
          provide: NavController,
          useValue: { navigateForward: vi.fn(() => Promise.resolve(true)) },
        },
        { provide: DbServerService, useValue: dbServerServiceMock },
      ],
    })
      // Keep the real template so the Loading -> list transition is
      // genuinely exercised, but strip the component's own `imports:`
      // (FormsModule — this page's tab `[(ngModel)]`, the Ionic
      // components) so those real Angular directives never get
      // instantiated against a template that only provides test-double
      // services — CUSTOM_ELEMENTS_SCHEMA then renders every `<ion-*>` tag
      // as an inert custom element. Same idiom already used successfully
      // by board/ui/pages/boards/boards-page.component.spec.ts and
      // board/ui/pages/board/board-page.component.spec.ts.
      .overrideComponent(ServersPageComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA], providers: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ServersPageComponent);
    component = fixture.componentInstance;
  });

  it('replaces the Loading... placeholder with the DB server list once it arrives, with no explicit detectChanges()', async () => {
    fixture.detectChanges(); // initial render — nothing has arrived yet
    expect(fixture.nativeElement.innerHTML).toContain('Loading...');

    const target: IProjectRef = { storeId: 'firestore', projectId: 'p1' };
    const dbServers: IProjDbServerSummary[] = [
      {
        dbServer: { driver: 'sqlserver', host: 'db1' },
        databasesCount: 3,
      },
    ];

    // Both arrive strictly after the initial render — no detectChanges()
    // call between this and the assertions below; only whenStable().
    current$.next(target);
    getDbServers$.next(dbServers);
    await fixture.whenStable();

    expect(fixture.nativeElement.innerHTML).not.toContain('Loading...');
    expect(fixture.nativeElement.innerHTML).toContain('db1');
  });
});

/**
 * Regression for the in-place-mutation zoneless bug flagged in the S138
 * report and fixed here (S147): `isDeletingServer` used to be a plain
 * `Record<string, boolean>` mutated in place (`this.isDeletingServer[id] =
 * true` synchronously, `delete this.isDeletingServer[id]` from inside
 * `deleteDbServer()`'s `.subscribe()` callback) instead of being a signal —
 * tools/check-zoneless-fields.mjs's original AST walk only looked for
 * `this.<field> = ...` reassignment, so it didn't catch this shape, and it
 * was left unconverted in fix/zoneless-batch-a. The delete button's
 * `[disabled]="isDeleting(dbServer.dbServer)"` binding read that mutated
 * Record, so under `provideZonelessChangeDetection()` the disabled state
 * set from the `.subscribe()` callback (both on success and on error) never
 * scheduled a repaint on its own.
 *
 * Never calls `fixture.detectChanges()` between resolving `deleteDbServer$`
 * and the final assertion — only `whenStable()` — so this only passes if
 * `isDeletingServer`'s `.update()` call alone (from inside the async
 * callback) is what causes Angular to re-render.
 */
describe('ServersPage clears the delete button\'s disabled state once deletion completes (zoneless)', () => {
  let component: ServersPageComponent;
  let fixture: ComponentFixture<ServersPageComponent>;
  let deleteDbServer$: Subject<void>;
  const target: IProjectRef = { storeId: 'firestore', projectId: 'p1' };
  const dbServer: IProjDbServerSummary = {
    dbServer: { driver: 'sqlserver', host: 'db1' },
    databasesCount: 1,
  };

  beforeEach(async () => {
    deleteDbServer$ = new Subject<void>();

    await TestBed.configureTestingModule({
      imports: [ServersPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ProjectContextService,
          useValue: {
            current$: of(target),
            current: target,
            setCurrent: vi.fn(),
          },
        },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        { provide: ModalController, useValue: { create: vi.fn() } },
        {
          provide: NavController,
          useValue: { navigateForward: vi.fn(() => Promise.resolve(true)) },
        },
        {
          provide: DbServerService,
          useValue: {
            getDbServers: vi.fn(() => of([dbServer])),
            deleteDbServer: vi.fn(() => deleteDbServer$.asObservable()),
          },
        },
      ],
    })
      // See the identical override + comment in the "Loading..." describe
      // block above: strips the component's own `imports:` so its real
      // FormsModule/Ionic directives never get instantiated against a
      // module that only provides test-double services (which would
      // otherwise shadow the mocks above — see fix/zoneless-batch-a's
      // "stabilize entities/servers regression specs" commit).
      .overrideComponent(ServersPageComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA], providers: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ServersPageComponent);
    component = fixture.componentInstance;
  });

  function deleteButton(): (HTMLElement & { disabled?: boolean }) | null {
    const icon = fixture.nativeElement.querySelector(
      'ion-icon[name="trash-outline"]',
    );
    return icon?.closest('ion-button') ?? null;
  }

  it('disables the row while deleting, then clears it on success with no explicit detectChanges()', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    expect(deleteButton()?.disabled).toBeFalsy();

    // A direct method call, not a dispatched DOM click event, so this
    // detectChanges() only renders the synchronous part of deleteDbServer()
    // (the `setDeleting(id, true)` call) — the same way Angular's own event
    // binding would after a real click.
    component.deleteDbServer(new Event('click'), dbServer);
    fixture.detectChanges();
    expect(deleteButton()?.disabled).toBe(true);

    // Resolves strictly after the click above — no detectChanges() call
    // between this and the assertions below; only whenStable(). Removing
    // the server from `dbServers()` also removes its row/button entirely,
    // which is itself proof the success handler's signal writes propagated.
    deleteDbServer$.next();
    deleteDbServer$.complete();
    await fixture.whenStable();

    expect(deleteButton()).toBeNull();
    expect(fixture.nativeElement.innerHTML).not.toContain('db1');
  });

  it('clears the disabled state on error, with no explicit detectChanges()', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    component.deleteDbServer(new Event('click'), dbServer);
    fixture.detectChanges();
    expect(deleteButton()?.disabled).toBe(true);

    deleteDbServer$.error(new Error('boom'));
    await fixture.whenStable();

    expect(deleteButton()?.disabled).toBeFalsy();
  });
});
