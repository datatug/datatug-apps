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

    await TestBed.configureTestingModule({
      imports: [ServersPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ProjectContextService,
          useValue: {
            current$: current$.asObservable(),
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
          useValue: {
            getDbServers: vi.fn(() => getDbServers$.asObservable()),
            deleteDbServer: vi.fn(),
          },
        },
      ],
    }).compileComponents();

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
