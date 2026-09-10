import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { ErrorLogger } from '@sneat/core';
import { of, Subject } from 'rxjs';

import { BoardPageComponent } from './board-page.component';
import { DatatugBoardService } from '../../../core/datatug-board.service';
import { ParameterLookupService } from '../../../../components/parameters/parameter-lookup.service';
import { routingParamBoard } from '../../../../core/datatug-routing-params';
import { DatatugNavContextService } from '../../../../services/nav/datatug-nav-context.service';
import { QueryParamsService } from '../../../../core/services/QueryParamsService';
import { Board } from '@datatug/board-models';

describe('BoardPage', () => {
  let component: BoardPageComponent;
  let fixture: ComponentFixture<BoardPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoardPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        { provide: DatatugBoardService, useValue: { getBoard: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null } },
          },
        },
        {
          provide: ParameterLookupService,
          useValue: { lookupParameterValue: vi.fn() },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(undefined),
            currentEnv: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
        {
          provide: QueryParamsService,
          useValue: { setQueryParameter: vi.fn() },
        },
      ],
    })
      .overrideComponent(BoardPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BoardPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

describe('BoardPage - currentProject navigation', () => {
  it('reads storeId/projectId from the project ref and requests the board', async () => {
    const logError = vi.fn();
    const getBoard = vi.fn().mockReturnValue(of(undefined));

    await TestBed.configureTestingModule({
      imports: [BoardPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: { logError, logErrorHandler: vi.fn(() => vi.fn()) },
        },
        { provide: DatatugBoardService, useValue: { getBoard } },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({
              get: (key: string) => (key === routingParamBoard ? 'b1' : null),
            }),
            snapshot: { paramMap: { get: () => null } },
          },
        },
        {
          provide: ParameterLookupService,
          useValue: { lookupParameterValue: vi.fn() },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of({
              ref: { storeId: 's1', projectId: 'p1' },
            }),
            currentEnv: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
        {
          provide: QueryParamsService,
          useValue: { setQueryParameter: vi.fn() },
        },
      ],
    })
      .overrideComponent(BoardPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    TestBed.createComponent(BoardPageComponent);

    expect(getBoard).toHaveBeenCalledWith(
      'http://localhost:8989',
      'p1',
      'b1',
    );
    expect(logError).not.toHaveBeenCalled();
  });
});

/**
 * Regression for the same "Loading..." bug class the founder reported
 * (2026-09-10) — same fix already established in
 * pages/signed-in/project/project-page.component.ts (PR #95), now guarded
 * fleet-wide by tools/check-zoneless-fields.mjs. `projBoard`, `boardDef`,
 * and `parameters` used to be plain fields, written from inside deeply
 * nested `.subscribe()` callbacks (currentProject -> route.paramMap ->
 * boardService.getBoard()). This app runs
 * `provideZonelessChangeDetection()` (apps/datatug-app/src/main.ts), so a
 * plain-field write from an async callback never schedules a repaint on its
 * own — the board title and parameter list would stay stuck on their
 * pre-load placeholders forever once the real board arrived, with no
 * unrelated event around to accidentally mask the gap.
 *
 * Uses `Subject`s, not `of(...)`, so the values arrive strictly after the
 * initial render — matching real HTTP/nav-context timing — and never calls
 * `fixture.detectChanges()` again afterwards, relying only on
 * `fixture.whenStable()` to prove the signal writes alone re-render the
 * page with no manual intervention.
 */
describe('BoardPage renders the board once it arrives asynchronously (zoneless)', () => {
  let component: BoardPageComponent;
  let fixture: ComponentFixture<BoardPageComponent>;
  let currentProject$: Subject<{ ref: { storeId: string; projectId: string } } | undefined>;
  let getBoard$: Subject<Board>;

  beforeEach(async () => {
    currentProject$ = new Subject();
    getBoard$ = new Subject<Board>();

    await TestBed.configureTestingModule({
      imports: [BoardPageComponent],
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
          provide: DatatugBoardService,
          useValue: { getBoard: vi.fn(() => getBoard$.asObservable()) },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => 'board-1' }),
            snapshot: { paramMap: { get: () => null } },
          },
        },
        {
          provide: ParameterLookupService,
          useValue: { lookupParameterValue: vi.fn() },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: currentProject$.asObservable(),
            currentEnv: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
        {
          provide: QueryParamsService,
          useValue: { setQueryParameter: vi.fn() },
        },
      ],
    })
      // Keep the real template; render EnvSelectorComponent/BoardComponent
      // as unknown (opaque) custom elements via CUSTOM_ELEMENTS_SCHEMA
      // instead of instantiating the real components — this test is only
      // about BoardPageComponent's own signal writes.
      .overrideComponent(BoardPageComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA], providers: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BoardPageComponent);
    component = fixture.componentInstance;
  });

  it('replaces the board title placeholder once the board arrives, with no explicit detectChanges()', async () => {
    fixture.detectChanges(); // initial render — nothing has arrived yet
    expect(fixture.nativeElement.innerHTML).toContain('Board title');

    const board: Board = {
      id: 'board-1',
      title: 'My Real Board',
      parameters: [{ id: 'p1', title: 'Param 1', type: 'string' }],
    };

    // Both arrive strictly after the initial render — no detectChanges()
    // call between this and the assertions below; only whenStable(). The
    // component now reads storeId/projectId straight off `ref` (merged
    // from main's "BoardPage - currentProject navigation" fix above,
    // 2026-09-10) instead of round-tripping through
    // `projectRefToString(ref).split('/')`, so a plain, realistic ref
    // works here directly.
    currentProject$.next({
      ref: { storeId: 'firestore', projectId: 'p1' },
    });
    getBoard$.next(board);
    await fixture.whenStable();

    expect(fixture.nativeElement.innerHTML).not.toContain('Board title');
    expect(fixture.nativeElement.innerHTML).toContain('My Real Board');
    expect(fixture.nativeElement.innerHTML).toContain('Param 1');
  });
});
