import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController, NavController } from '@ionic/angular';
import { ErrorLogger, STORE_ID_GITHUB_COM } from '@sneat/core';
import { of, Subject } from 'rxjs';

import { ServersPageComponent } from './servers-page.component';
import { ProjectContextService } from '../../../services/project/project-context.service';
import { ProjectService } from '../../../services/project/project.service';
import { DbServerService } from '../../../services/unsorted/db-server.service';
import { EnvironmentService } from '../../../services/unsorted/environment.service';
import { IProjectRef } from '../../../core/project-context';
import { IEnvironmentFull } from '../../../models/definition/environments';
import {
  DB_SERVER_ID_NO_HOST,
  IProjDbServerSummary,
} from '../../../models/definition/apis/database';

// Every describe block below provides these two — `EnvironmentService` and
// `ProjectService` — because the constructor unconditionally calls
// `inject()` for both (loadEnvironments() alongside loadDbServers(), S153),
// regardless of whether an individual test cares about the environment
// list. Their return values are irrelevant to blocks that don't; only the
// dedicated "numbers add up" describe block below overrides them.
const noopEnvironmentServiceProvider = {
  provide: EnvironmentService,
  useValue: { listEnvironments: vi.fn(() => of([])) },
};
const noopProjectServiceProvider = {
  provide: ProjectService,
  useValue: { getFull: vi.fn(() => of({})) },
};

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
        noopEnvironmentServiceProvider,
        noopProjectServiceProvider,
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
        noopEnvironmentServiceProvider,
        noopProjectServiceProvider,
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
        noopEnvironmentServiceProvider,
        noopProjectServiceProvider,
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

/**
 * S153 — the founder's ruling against the GitHub-store demo project
 * (`store/github.com/project/datatug-demo-projects@datatug@demo-project-1/servers`):
 * "Total 1 database servers, tab DB Servers has [2] badge, and there is [5]
 * badge next to sqlite3 - all this does not add up".
 *
 * The fixture below mirrors what `DbServerService`'s own
 * `getGithubDbServers()` (db-server.service.ts) actually aggregates from
 * that demo project's real `environments/*.env.json` files (verified live
 * via the GitHub API, 2026-09-10): one `sqlite3` server declared with no
 * `host` (sqlite3 is file-based, not network-addressed) across five
 * environments — `QA`, `UAT`, `dev`, `local`, `prod` — each contributing
 * exactly one catalog, for a `databasesCount` of 5. Built by hand here
 * (rather than driven through the real `GithubProjectReaderService`) so this
 * spec exercises `ServersPageComponent` in isolation, the same idiom every
 * other describe block in this file already uses.
 *
 * These tests interact only through the component's public surface — the
 * DOM the real template renders, plus `ProjectContextService.current$`/the
 * injected service mocks — never a protected field, so they also prove the
 * template is actually wired up (not just the underlying signals).
 */
describe('ServersPage numbers add up (S153 — GitHub-store demo project)', () => {
  let fixture: ComponentFixture<ServersPageComponent>;

  const target: IProjectRef = {
    storeId: STORE_ID_GITHUB_COM,
    projectId: 'datatug-demo-projects@datatug@demo-project-1',
  };
  const environmentIds = ['QA', 'UAT', 'dev', 'local', 'prod'];
  const environments: IEnvironmentFull[] = environmentIds.map((id) => ({
    id,
    title: id,
  }));
  const dbServers: IProjDbServerSummary[] = [
    {
      dbServer: { driver: 'sqlite3', host: '' },
      databasesCount: 5,
      environments: environmentIds.map((envId) => ({
        envId,
        databasesCount: 1,
      })),
    },
  ];

  function environmentCheckboxes(): NodeListOf<Element> {
    return fixture.nativeElement.querySelectorAll('ion-checkbox');
  }

  /** Dispatches a real `ionChange` DOM event on one environment's checkbox
   * — the same event Ionic's real `<ion-checkbox>` fires — so this exercises
   * the template's `(ionChange)="toggleEnvironment(...)"` binding rather
   * than calling a component method directly. Works under
   * `CUSTOM_ELEMENTS_SCHEMA` because Angular's `(ionChange)` binding is just
   * a plain `addEventListener('ionChange', ...)` on the host DOM node, which
   * exists (inert, un-upgraded) regardless of whether Ionic's own JS ever
   * loads. */
  function uncheckEnvironment(envId: string): void {
    const index = environmentIds.indexOf(envId);
    environmentCheckboxes()
      .item(index)
      .dispatchEvent(
        new CustomEvent('ionChange', { detail: { checked: false } }),
      );
  }

  // `innerHTML` substring checks, not `.textContent` — this test environment
  // loads Ionic's REAL web components (unlike this file's other describe
  // blocks, which strip the component's own `imports:` so those never
  // upgrade). A just-rendered `<ion-label>`/`<ion-item>` that hasn't
  // finished its own async custom-element upgrade yet reports an EMPTY
  // `.textContent` here (a happy-dom/Stencil timing quirk — verified live
  // against this exact fixture: `innerHTML` reliably shows the real
  // `>Total: 1 database servers<` text at the same instant `.textContent`
  // reports none of it), while `innerHTML` always serializes the true light
  // DOM regardless of upgrade timing.
  function html(): string {
    return fixture.nativeElement.innerHTML as string;
  }

  /** Strips Angular's `<!---->` structural-directive anchor comments so an
   * element's own text can be compared exactly (`rowLabelText()` below). */
  function stripComments(value: string): string {
    return value.replace(/<!--[\s\S]*?-->/g, '').trim();
  }

  function dbTabBadgeText(): string | undefined {
    return fixture.nativeElement
      .querySelector('ion-segment-button[value="db"] ion-badge')
      ?.textContent?.trim();
  }

  // Scoped to `ion-item[tappable]` (the attribute the template's own DB
  // server row carries, `deleteDbServer($event, dbServer)`'s sibling
  // `<ion-item>`) rather than a generic `ion-list ion-item`, so these never
  // accidentally match the list's own trailing "Total: ..." row once every
  // server row has been filtered out (see the last test below).
  function rowDatabasesBadgeText(): string | undefined {
    return fixture.nativeElement
      .querySelector('ion-item[tappable] ion-badge.ion-margin-start')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim();
  }

  function rowLabelText(): string | undefined {
    const innerHtml = fixture.nativeElement.querySelector(
      'ion-item[tappable] ion-label',
    )?.innerHTML;
    return innerHtml === undefined ? undefined : stripComments(innerHtml);
  }

  beforeEach(async () => {
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
            getDbServers: vi.fn(() => of(dbServers)),
            deleteDbServer: vi.fn(),
          },
        },
        {
          provide: EnvironmentService,
          useValue: { listEnvironments: vi.fn(() => of(environments)) },
        },
        noopProjectServiceProvider,
      ],
    })
      // Same idiom as every other describe block in this file: keep the
      // real template, strip the component's own `imports:` so its real
      // FormsModule/Ionic directives never shadow the test-double services.
      .overrideComponent(ServersPageComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA], providers: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ServersPageComponent);
  });

  it('badge and footer total both equal the one row shown — never the old hard-coded "2" — and the row is unambiguously labeled "5 databases", not a bare "5"', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(dbTabBadgeText()).toBe('1');
    expect(rowDatabasesBadgeText()).toBe('5 databases');
    expect(html()).toContain('Total: 1 database servers');
  });

  it('shows an explicit "(no host)" placeholder for the demo project\'s host-less sqlite3 row, never a blank label', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(rowLabelText()).toBe('(no host)');
  });

  it('narrows the row\'s database count once the environment filter excludes some — but not all — of its contributing environments, keeping the badge/total in sync', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    uncheckEnvironment('prod');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(rowDatabasesBadgeText()).toBe('4 databases');
    // The row itself still counts as one server — only its own database
    // count narrowed, not the server list.
    expect(dbTabBadgeText()).toBe('1');
    expect(html()).toContain('Total: 1 database servers');
  });

  it('drops the row — and both the badge and the total fall to 0 — once every environment contributing to it is unchecked', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    for (const envId of environmentIds) {
      uncheckEnvironment(envId);
      fixture.detectChanges();
    }
    await fixture.whenStable();

    expect(dbTabBadgeText()).toBe('0');
    expect(html()).toContain('Total: 0 database servers');
    expect(
      fixture.nativeElement.querySelector('ion-item[tappable]'),
    ).toBeNull();
  });
});

/**
 * S160 — `goDbServer()` used to `navigateForward(['project', '.@' +
 * storeId, 'servers', 'db', driver, host])`: an ABSOLUTE array starting at
 * a bare `'project'` segment (no `store/:storeId` prefix at all), and a
 * `host` segment left blank/`NaN`-producing for a host-less server — never
 * matched the real route (`/store/:storeId/project/:projectId/servers/
 * db/:dbDriver/:dbServerId`), so clicking any DB server row threw
 * `NG04002` for every store/project (founder report, 2026-09-10, 100%
 * reproducible). These tests call the component method directly (not a
 * dispatched DOM click) and assert the exact array now passed to
 * `NavController.navigateForward()`.
 */
describe('ServersPage.goDbServer() navigation target (S160, NG04002 regression)', () => {
  let component: ServersPageComponent;
  let fixture: ComponentFixture<ServersPageComponent>;
  let navigateForward: ReturnType<typeof vi.fn>;

  const target: IProjectRef = {
    storeId: STORE_ID_GITHUB_COM,
    projectId: 'datatug-demo-projects@datatug@demo-project-1',
  };

  beforeEach(async () => {
    navigateForward = vi.fn(() => Promise.resolve(true));

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
        { provide: NavController, useValue: { navigateForward } },
        {
          provide: DbServerService,
          useValue: { getDbServers: vi.fn(() => of([])), deleteDbServer: vi.fn() },
        },
        noopEnvironmentServiceProvider,
        noopProjectServiceProvider,
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
    fixture.detectChanges();
  });

  it('navigates to /store/<storeId>/project/<projectId>/servers/db/<driver>/<host:port> for a server with a host and a port', () => {
    const dbServer: IProjDbServerSummary = {
      dbServer: { driver: 'sqlserver', host: 'localhost', port: 1433 },
      databasesCount: 1,
    };

    component.goDbServer(dbServer);

    expect(navigateForward).toHaveBeenCalledWith([
      'store',
      STORE_ID_GITHUB_COM,
      'project',
      'datatug-demo-projects@datatug@demo-project-1',
      'servers',
      'db',
      'sqlserver',
      'localhost:1433',
    ]);
  });

  it('navigates with the host-less placeholder id for the GitHub demo project\'s sqlite3 server (no host at all)', () => {
    const dbServer: IProjDbServerSummary = {
      dbServer: { driver: 'sqlite3', host: '' },
      databasesCount: 5,
    };

    component.goDbServer(dbServer);

    expect(navigateForward).toHaveBeenCalledWith([
      'store',
      STORE_ID_GITHUB_COM,
      'project',
      'datatug-demo-projects@datatug@demo-project-1',
      'servers',
      'db',
      'sqlite3',
      DB_SERVER_ID_NO_HOST,
    ]);
  });
});
