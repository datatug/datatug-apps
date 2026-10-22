import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AgentContextService, DATATUG_AGENT_BASE_URL } from '@sneat/datatug-semantic';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { ErrorLogger } from '@sneat/core';
import { of, Subject, throwError } from 'rxjs';

import { BoardPageComponent } from './board-page.component';
import { ProjectAssetsReadService } from '../../../../services/project/project-assets-read.service';
import { routingParamBoard } from '../../../../core/datatug-routing-params';
import { DatatugNavContextService } from '../../../../services/nav/datatug-nav-context.service';
import { QueryParamsService } from '../../../../core/services/QueryParamsService';
import { Board } from '@datatug/board-models';
import { IProjectContext } from '../../../../nav/nav-models';
import { QualifiedLocalReadVersionError } from '../../../../services/project/project-query-api.service';
import { provideMockErrorLogger } from '../../../../testing/error-logger.spec-helper';

describe('BoardPage', () => {
  let component: BoardPageComponent;
  let fixture: ComponentFixture<BoardPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoardPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideMockErrorLogger(),
        { provide: ProjectAssetsReadService, useValue: { board: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null } },
          },
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
        { provide: ProjectAssetsReadService, useValue: { board: getBoard } },
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

    // The full selected project ref flows to the read facade.
    expect(getBoard).toHaveBeenCalledWith(
      { storeId: 's1', projectId: 'p1' },
      'b1',
      undefined,
      { requireExisting: true },
    );
    expect(logError).not.toHaveBeenCalled();
  });
});

describe('BoardPage - qualified read errors', () => {
  async function renderLoadError(error: unknown): Promise<string> {
    const project = {
      ref: {
        storeId: 'http-localhost:8989',
        projectId: 'demo',
        branch: 'feature/demo',
      },
      brief: { title: 'Demo' },
    };
    await TestBed.configureTestingModule({
      imports: [BoardPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideMockErrorLogger(),
        {
          provide: ProjectAssetsReadService,
          useValue: { board: vi.fn(() => throwError(() => error)) },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({
              get: (key: string) => (key === routingParamBoard ? 'b1' : null),
            }),
            snapshot: { paramMap: { get: () => 'b1' } },
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(project),
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
          template: '<p role="alert">{{ loadError() }}</p>',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(BoardPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement.textContent.trim();
  }

  it('renders the update and restart guidance for an old CLI', async () => {
    expect(await renderLoadError(new QualifiedLocalReadVersionError())).toMatch(
      /update DataTug CLI to v0\.97\.0 or later.*restart its agent/i,
    );
  });

  it('keeps unexpected server text out of the rendered error', async () => {
    const rendered = await renderLoadError(
      new Error('private server response: internal token abc123'),
    );
    expect(rendered).toBe(
      'This board could not be loaded. Try opening it again from Boards.',
    );
    expect(rendered).not.toContain('abc123');
  });
});

describe('BoardPage switches board reads with the full project context', () => {
  it('clears the old board and ignores a late response after a project switch', async () => {
    const projects = new Subject<{
      ref: { storeId: string; projectId: string };
    }>();
    const firstBoard = new Subject<Board>();
    const secondBoard = new Subject<Board>();
    const getBoard = vi
      .fn()
      .mockReturnValueOnce(firstBoard.asObservable())
      .mockReturnValueOnce(secondBoard.asObservable());

    await TestBed.configureTestingModule({
      imports: [BoardPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: ErrorLogger, useValue: { logError: vi.fn() } },
        { provide: ProjectAssetsReadService, useValue: { board: getBoard } },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({
              get: (key: string) =>
                key === routingParamBoard ? 'board1' : null,
            }),
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: projects.asObservable(),
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

    const fixture = TestBed.createComponent(BoardPageComponent);
    const page = fixture.componentInstance;
    projects.next({
      ref: { storeId: 'github.com', projectId: 'first@owner@' },
    });
    firstBoard.next({ id: 'board1', title: 'First project' });
    expect(page.boardDef()?.title).toBe('First project');

    projects.next({
      ref: { storeId: 'github.com', projectId: 'second@owner@' },
    });
    expect(page.boardDef()).toBeUndefined();
    expect(page.loading()).toBe(true);
    firstBoard.next({ id: 'board1', title: 'Stale response' });
    expect(page.boardDef()).toBeUndefined();
    secondBoard.next({ id: 'board1', title: 'Second project' });

    expect(page.boardDef()?.title).toBe('Second project');
    expect(page.loading()).toBe(false);
    expect(getBoard).toHaveBeenNthCalledWith(
      2,
      { storeId: 'github.com', projectId: 'second@owner@' },
      'board1',
      undefined,
      { requireExisting: true },
    );
    fixture.destroy();
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
  let fixture: ComponentFixture<BoardPageComponent>;
  let currentProject$: Subject<IProjectContext | undefined>;
  let getBoard$: Subject<Board>;

  beforeEach(async () => {
    currentProject$ = new Subject();
    getBoard$ = new Subject<Board>();

    await TestBed.configureTestingModule({
      imports: [BoardPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideMockErrorLogger(),
        {
          provide: ProjectAssetsReadService,
          useValue: { board: vi.fn(() => getBoard$.asObservable()) },
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
  });

  it('replaces the board title placeholder once the board arrives, with no explicit detectChanges()', async () => {
    fixture.detectChanges(); // initial render — nothing has arrived yet
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain(
      'Board',
    );

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

    expect(fixture.nativeElement.querySelector('h1')?.textContent).not.toBe(
      'Board',
    );
    expect(fixture.nativeElement.innerHTML).toContain('My Real Board');
    expect(fixture.nativeElement.innerHTML).toContain('Param 1');
  });

  it('requests the selected branch after a qualified branch is selected', async () => {
    fixture.detectChanges();
    const getBoard = TestBed.inject(ProjectAssetsReadService).board;
    currentProject$.next({
      ref: { storeId: 'github.com', projectId: 'demo' },
    });
    getBoard$.next({ id: 'board-1', title: 'Demo board' });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Demo board');

    currentProject$.next({
      ref: {
        storeId: 'github.com',
        projectId: 'demo',
        projectApi: 'cloud',
        branch: 'feature',
      },
    });
    await fixture.whenStable();
    expect(getBoard).toHaveBeenCalledTimes(2);
    expect(getBoard).toHaveBeenLastCalledWith(
      {
        storeId: 'github.com',
        projectId: 'demo',
        projectApi: 'cloud',
        branch: 'feature',
      },
      'board-1',
      undefined,
      { requireExisting: true },
    );
  });

  it('keeps manual parameter entry but never sends a qualified lookup through the legacy unqualified agent API', async () => {
    fixture.detectChanges();
    currentProject$.next({
      ref: {
        storeId: 'github.com',
        projectId: 'demo',
        projectApi: 'cloud',
        branch: 'feature',
      },
    });
    const board: Board = {
      id: 'board-1',
      title: 'Qualified board',
      parameters: [
        {
          id: 'customer',
          title: 'Customer',
          type: 'string',
          lookup: { db: 'chinook', sql: 'select 1', keyFields: ['id'] },
        },
      ],
    };
    getBoard$.next(board);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(
      'Enter parameter values manually.',
    );
    expect(fixture.nativeElement.querySelector('ion-input')).not.toBeNull();
    // The explicit lookup's agent is withheld, so its pick button never appears.
    expect(fixture.componentInstance.lookupContext().explicitAgent).toBeUndefined();
    expect(
      fixture.nativeElement.querySelector('[data-testid="parameter-lookup-button"]'),
    ).toBeNull();
  });
  it('publishes manually entered local board parameters as typed execution context and removes invalid values', async () => {
    fixture.detectChanges();
    currentProject$.next({
      ref: {
        storeId: 'localhost:8989',
        projectId: 'demo',
        projectApi: 'local',
        branch: 'main',
      },
    });
    getBoard$.next({
      id: 'board-1',
      title: 'Local parameter board',
      parameters: [
        { id: 'count', title: 'Count', type: 'integer' },
        { id: 'enabled', title: 'Enabled', type: 'boolean' },
        { id: 'date', title: 'Date', type: 'date' },
        { id: 'country', title: 'Country', type: 'string' },
      ],
    });
    await fixture.whenStable();
    const input = (type: string) => {
      const element = Array.from(
        fixture.nativeElement.querySelectorAll('ion-input') as NodeListOf<HTMLIonInputElement>,
      ).find((element) => element.placeholder === type);
      if (!element) throw new Error(`Missing ${type} parameter input`);
      return element;
    };
    const enter = (type: string, value: string) =>
      input(type).dispatchEvent(
        new CustomEvent('ionInput', { detail: { value }, bubbles: true }),
      );
    const parameterSection = fixture.nativeElement.querySelector('section.board-parameters');
    expect(parameterSection.getAttribute('aria-label')).toBe('Board parameters');
    expect(parameterSection.querySelector('ion-card')).toBeNull();
    expect(input('integer').label).toBe('Count');
    expect(input('integer').labelPlacement).toBe('fixed');
    const original = fixture.componentInstance.boardContext();
    enter('integer', '42');
    enter('boolean', 'false');
    enter('date', '2026-10-16');
    enter('string', 'France');
    await fixture.whenStable();
    expect(fixture.componentInstance.boardContext()).not.toBe(original);
    expect(fixture.componentInstance.boardContext().parameters).toEqual({
      count: { type: 'integer', value: 42 },
      enabled: { type: 'boolean', value: false },
      date: { type: 'date', value: '2026-10-16' },
      country: { type: 'string', value: 'France' },
    });
    const validContext = fixture.componentInstance.boardContext();
    enter('integer', '1.5');
    enter('date', '2026-02-30');
    await fixture.whenStable();
    expect(fixture.componentInstance.boardContext()).not.toBe(validContext);
    expect(
      fixture.componentInstance.boardContext().parameters['count'],
    ).toBeUndefined();
    expect(
      fixture.componentInstance.boardContext().parameters['date'],
    ).toBeUndefined();
    expect(fixture.nativeElement.textContent).toContain('Enter a whole number');
    expect(fixture.nativeElement.textContent).toContain('Enter an ISO date');
  });

  it('initializes validated saved defaults and clears board parameter values on navigation', async () => {
    fixture.detectChanges();
    currentProject$.next({
      ref: { storeId: 'github.com', projectId: 'first@owner@' },
    });
    getBoard$.next({
      id: 'board-1',
      title: 'Defaults',
      parameters: [{ id: 'count', type: 'integer', defaultValue: 5 }],
    });
    await fixture.whenStable();
    expect(
      fixture.componentInstance.boardContext().parameters['count'],
    ).toEqual({ type: 'integer', value: 5 });
    currentProject$.next({
      ref: { storeId: 'github.com', projectId: 'second@owner@' },
    });
    await fixture.whenStable();
    expect(fixture.componentInstance.boardContext().parameters).toEqual({});
    expect(fixture.componentInstance.parameterErrors()).toEqual({});
  });
});


describe('BoardPage local agent context', () => {
  it('uses the route agent identity reactively and clears it outside that local scope', async () => {
    const project = new Subject<IProjectContext | undefined>();
    await TestBed.configureTestingModule({
      imports: [BoardPageComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: DATATUG_AGENT_BASE_URL, useValue: 'about:blank' },
        { provide: ErrorLogger, useValue: { logError: vi.fn(), logErrorHandler: vi.fn(() => vi.fn()) } },
        { provide: ProjectAssetsReadService, useValue: { board: vi.fn(() => of(undefined)) } },
        { provide: QueryParamsService, useValue: { setQueryParameter: vi.fn() } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: () => null }), paramMap: of({ get: () => 'board' }), snapshot: { paramMap: { get: () => null } } } },
        { provide: DatatugNavContextService, useValue: { currentProject: project, currentEnv: of(undefined), setCurrentEnvironment: vi.fn() } },
      ],
    }).overrideComponent(BoardPageComponent, {
      set: { imports: [], providers: [], template: '<output>{{boardContext().securityContextId}}</output>' },
    }).compileComponents();
    const fixture = TestBed.createComponent(BoardPageComponent);
    const http = TestBed.inject(HttpTestingController);
    const agent = TestBed.inject(AgentContextService);
    fixture.detectChanges();
    const ref = { storeId: 'http-127.0.0.1:18989', projectId: 'demo' };
    project.next({ ref });
    await fixture.whenStable();
    const info = { version: '1', principal: { id: 'local-reader', roles: [], groups: [] }, securityContextId: 'connected-context-1', projects: [{ id: 'demo' }], capabilities: { protectedQueries: true, opaqueReadOnly: false } };
    const url = 'http://127.0.0.1:18989/datatug';
    http.expectOne(url + '/agent-info').flush(info);
    await fixture.whenStable();
    expect(fixture.componentInstance.boardContext().executionTarget).toEqual({ kind: 'local-agent', agentStoreId: ref.storeId });
    expect(fixture.nativeElement.textContent).toContain('connected-context-1');
    const previous = fixture.componentInstance.boardContext();
    agent.refresh(url).subscribe();
    http.expectOne(url + '/agent-info').flush({ ...info, securityContextId: 'connected-context-2' });
    await fixture.whenStable();
    expect(fixture.componentInstance.boardContext()).not.toBe(previous);
    expect(fixture.nativeElement.textContent).toContain('connected-context-2');
    expect(fixture.nativeElement.textContent).not.toContain('connected-context-1');
    for (const other of [
      { storeId: 'github.com', projectId: 'o/r' },
      { storeId: 'github.com', projectId: 'o/r', projectApi: 'cloud' as const, branch: 'main' },
      { storeId: 'firestore', projectId: 'demo', spaceID: 'space' },
      { storeId: 'firestore', projectId: 'demo' },
    ]) {
      project.next({ ref: other });
      await fixture.whenStable();
      expect(fixture.componentInstance.boardContext().securityContextId).toBeUndefined();
      expect(fixture.nativeElement.textContent).not.toContain('connected-context');
    }
    project.next(undefined);
    await fixture.whenStable();
    expect(fixture.componentInstance.boardContext().securityContextId).toBeUndefined();
    expect(fixture.componentInstance.boardContext().executionTarget).toBeUndefined();
    http.verify();
    fixture.destroy();
  });
});
