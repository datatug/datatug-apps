import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { ErrorLogger } from '@sneat/core';
import { of, Subject } from 'rxjs';

import { DbserverPageComponent } from './dbserver-page.component';
import { DbServerService } from '../../../services/unsorted/db-server.service';
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
  let component: DbserverPageComponent;
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
    }).compileComponents();

    fixture = TestBed.createComponent(DbserverPageComponent);
    component = fixture.componentInstance;
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
