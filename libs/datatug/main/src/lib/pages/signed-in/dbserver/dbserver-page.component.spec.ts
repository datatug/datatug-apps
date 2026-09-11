import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { ErrorLogger } from '@sneat/core';
import { of, Subject, throwError } from 'rxjs';

import { DbserverPageComponent } from './dbserver-page.component';
import {
  DbServerService,
  GITHUB_DBSERVER_DETAIL_MESSAGE,
} from '../../../services/unsorted/db-server.service';
import { ProjectContextService } from '../../../services/project/project-context.service';
import { IDbServerSummary } from '../../../models/definition/apis/database';

describe('DbserverPage', () => {
  let component: DbserverPageComponent;
  let fixture: ComponentFixture<DbserverPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DbserverPageComponent],
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
            snapshot: { paramMap: { get: () => null } },
          },
        },
        {
          provide: DbServerService,
          useValue: {
            getDbServerSummary: vi.fn(),
            getServerDatabases: vi.fn(),
          },
        },
        {
          provide: ProjectContextService,
          useValue: {
            current$: of(undefined),
            current: undefined,
            setCurrent: vi.fn(),
          },
        },
      ],
    })
      .overrideComponent(DbserverPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DbserverPageComponent);
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
 * fleet-wide by tools/check-zoneless-fields.mjs. `loadingSummary`,
 * `dbServerSummary`, and `envs` used to be plain fields, written from
 * inside `.subscribe()` callbacks. This app runs
 * `provideZonelessChangeDetection()` (apps/datatug-app/src/main.ts), so a
 * plain-field write from an async callback never schedules a repaint on
 * its own — the page's own template has TWO literal "Loading..."
 * placeholders (Environments card and Databases > Known tab) that, before
 * this fix, would never be replaced once the real DB server summary
 * arrived.
 *
 * Uses `Subject`s, not `of(...)`, so the values arrive strictly after the
 * initial render — matching real HTTP/nav-context timing — and never calls
 * `fixture.detectChanges()` again afterwards, relying only on
 * `fixture.whenStable()` to prove the signal writes alone re-render the
 * page with no manual intervention.
 */
describe('DbserverPage replaces "Loading..." once the summary arrives (zoneless)', () => {
  let fixture: ComponentFixture<DbserverPageComponent>;
  let current$: Subject<unknown>;
  let getDbServerSummary$: Subject<IDbServerSummary>;

  beforeEach(async () => {
    current$ = new Subject<unknown>();
    getDbServerSummary$ = new Subject<IDbServerSummary>();

    await TestBed.configureTestingModule({
      imports: [DbserverPageComponent],
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
            paramMap: of({
              get: (key: string) =>
                key === 'dbServerId'
                  ? 'db1'
                  : key === 'dbDriver'
                    ? 'sqlserver'
                    : null,
            }),
            snapshot: { paramMap: { get: () => null } },
          },
        },
        {
          provide: DbServerService,
          useValue: {
            getDbServerSummary: vi.fn(() => getDbServerSummary$.asObservable()),
            getServerDatabases: vi.fn(() => new Subject()),
          },
        },
        {
          provide: ProjectContextService,
          useValue: {
            current$: current$.asObservable(),
            current: undefined,
            setCurrent: vi.fn(),
          },
        },
      ],
    })
      // Without this, `DbServerService` resolves through the component's
      // own `DatatugServicesUnsortedModule` import (nearer in the injector
      // chain than this TestBed-level mock) instead of the mock above,
      // constructing the REAL service and its full dependency chain
      // (`ProjectService` -> `DatatugStoreServiceFactory` ->
      // `DatatugStoreFirestoreService` -> `Firestore`, none of which are
      // provided here) — `NG0201: No provider found for Firestore`. Blanking
      // the component's own `imports` forces every dependency to resolve
      // from this TestBed's own providers instead, matching the file's
      // other `describe` block.
      .overrideComponent(DbserverPageComponent, {
        set: {
          imports: [],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DbserverPageComponent);
  });

  it('replaces the Loading... placeholder with the DB server summary once it arrives, with no explicit detectChanges()', async () => {
    fixture.detectChanges(); // initial render — nothing has arrived yet
    expect(fixture.nativeElement.innerHTML).toContain('Loading...');

    const summary: IDbServerSummary = {
      host: 'db1',
      driver: 'sqlserver',
      databases: [{ id: 'AdventureWorks', environments: ['prod'] }],
    };

    // Both arrive strictly after the initial render — no detectChanges()
    // call between this and the assertions below; only whenStable().
    current$.next({ id: 'target-1' });
    getDbServerSummary$.next(summary);
    await fixture.whenStable();

    expect(fixture.nativeElement.innerHTML).not.toContain('Loading...');
    expect(fixture.nativeElement.innerHTML).toContain('AdventureWorks');
    expect(fixture.nativeElement.innerHTML).toContain('prod');
  });
});

/**
 * S161 — root cause: `route.paramMap` (-> `dbServer` signal) and
 * `projectContextService.current$` (-> `loadData()`) used to be two
 * independent `constructor()` subscriptions. `loadData()` ran off
 * `current$` alone and read `this.dbServer()`'s value at that instant —
 * whichever stream happened to deliver first decided the outcome. This test
 * reproduces the losing order directly: `paramMap` as a `Subject` that has
 * not emitted yet (asserted via a first check straight after construction),
 * and `current$` as an already-resolved, synchronously-replaying
 * `BehaviorSubject`-like source — the realistic "already in this
 * GitHub-store project" case for both an in-app nav from the Servers list
 * and a cold top-level load where a resolver upstream set the project
 * context before this route activated. On unfixed code, `current$`'s
 * synchronous replay ran `loadData()` while `dbServer` was still
 * `undefined`, so `loadSummary()`/`loadCatalogs()`'s own
 * `if (!dbServer) return;` guard exited silently — no HTTP call, no
 * `.subscribe()` error callback, and nothing ever reran `loadData()` once
 * `paramMap` did emit — `loadingSummary`/`loadingCatalogs` stuck at their
 * initial `true` forever, matching the founder's live-introspection
 * findings (S161 brief): neither `next` nor `error` fired, no
 * `dbserver-summary`/`dbserver-databases` request, no
 * `ErrorLoggerService.logError` entry, both cards permanently "Loading...".
 *
 * `DbServerService` here mirrors its own GitHub-store guard
 * (`db-server.service.ts`): `getDbServerSummary()`/`getServerDatabases()`
 * reject with exactly `new Error(GITHUB_DBSERVER_DETAIL_MESSAGE)`, never
 * issuing an HTTP call.
 */
describe('DbserverPage on a GitHub-store project (S161)', () => {
  let component: DbserverPageComponent;
  let fixture: ComponentFixture<DbserverPageComponent>;
  let paramMap$: Subject<{ get: (key: string) => string | null }>;
  let logError: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    paramMap$ = new Subject();
    logError = vi.fn();

    await TestBed.configureTestingModule({
      imports: [DbserverPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: { logError, logErrorHandler: vi.fn(() => vi.fn()) },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            // Deliberately NOT yet emitted at `TestBed.createComponent()`
            // time — the losing side of the race (see doc comment above).
            paramMap: paramMap$.asObservable(),
            snapshot: { paramMap: { get: () => null } },
          },
        },
        {
          provide: DbServerService,
          useValue: {
            getDbServerSummary: vi.fn(() =>
              throwError(() => new Error(GITHUB_DBSERVER_DETAIL_MESSAGE)),
            ),
            getServerDatabases: vi.fn(() =>
              throwError(() => new Error(GITHUB_DBSERVER_DETAIL_MESSAGE)),
            ),
          },
        },
        {
          provide: ProjectContextService,
          useValue: {
            // Already resolved and replays synchronously on subscribe —
            // the winning side of the race.
            current$: of({ storeId: 'github.com', projectId: 'demo' }),
            current: { storeId: 'github.com', projectId: 'demo' },
            setCurrent: vi.fn(),
          },
        },
      ],
    })
      .overrideComponent(DbserverPageComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DbserverPageComponent);
    component = fixture.componentInstance;
  });

  it('stops loading and shows the read-only notice once dbServerId/dbDriver arrive, instead of loading forever', async () => {
    fixture.detectChanges(); // current$ replays synchronously here

    // dbServerId/dbDriver route params — sqlite3's host-less placeholder id
    // (S160, DB_SERVER_ID_NO_HOST) — arrive strictly after the initial
    // render, matching real Router/nav timing.
    paramMap$.next({
      get: (key: string) =>
        key === 'dbServerId' ? '-' : key === 'dbDriver' ? 'sqlite3' : null,
    });
    await fixture.whenStable();

    expect(component.loadingSummary()).toBe(false);
    expect(component.loadingCatalogs()).toBe(false);
    expect(component.readOnlyNotice()).toBe(GITHUB_DBSERVER_DETAIL_MESSAGE);

    // `.textContent`, not `.innerHTML` — the message's own literal
    // `<path>` (backtick-quoted in `GITHUB_DBSERVER_DETAIL_MESSAGE`) comes
    // back HTML-entity-escaped (`&lt;path&gt;`) in serialized markup even
    // though it renders correctly as text in a real browser.
    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Loading...');
    // Rendered twice — once in the Environments card, once in the
    // Databases > Known tab (both loaders hit the identical GitHub guard).
    expect(
      text.split(GITHUB_DBSERVER_DETAIL_MESSAGE).length - 1,
    ).toBeGreaterThanOrEqual(2);

    // Expected, not-a-bug outcome — no error toast for this case; real
    // errors still go through ErrorLogger (untouched by this fix).
    expect(logError).not.toHaveBeenCalled();
  });

  it('passes "(no host)" as the page title for the host-less sqlite3 placeholder', async () => {
    // `<sneat-datatug-page-title>` itself isn't instantiated under this
    // TestBed's `overrideComponent({ imports: [] })` (needed so
    // `DbServerService` et al. resolve from this file's own mocks rather
    // than the component's real `DatatugServicesUnsortedModule` import,
    // see the "replaces Loading..." describe block's own comment above) —
    // Angular still sets the `[pageTitle]` property binding directly on the
    // plain DOM element under `CUSTOM_ELEMENTS_SCHEMA`, so it's readable
    // straight off the element without the child component ever rendering.
    fixture.detectChanges();
    paramMap$.next({
      get: (key: string) =>
        key === 'dbServerId' ? '-' : key === 'dbDriver' ? 'sqlite3' : null,
    });
    await fixture.whenStable();

    const titleEl = fixture.nativeElement.querySelector(
      'sneat-datatug-page-title',
    ) as { pageTitle?: string };
    expect(titleEl.pageTitle).toBe('DB server: (no host)');
  });
});
