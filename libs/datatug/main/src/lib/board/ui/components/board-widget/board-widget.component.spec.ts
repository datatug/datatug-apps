import retainedFixture from '../../../../evidence/testdata/backend-v044-retained.json';
import { readRetainedQueryResponse } from '../../../../evidence/retained-evidence-contract';
import { DatatugNavContextService } from '../../../../services/nav/datatug-nav-context.service';
import { NativeQueryFailure } from '../../../../queries/native-query-failure';
import { BoardPresentationSelection } from '../../../core/board-presentation-selection';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CUSTOM_ELEMENTS_SCHEMA, PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterLink } from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import {
  Board,
  BoardWidget,
  ChartWidgetDef,
  TutorialBoardSession,
} from '@datatug/board-models';
import { TutorialBoardRuntime } from '../../../core/tutorial-board-runtime';
import { BarRaceChartComponent, type BarRaceChartViews } from '@datatug/charts';
import { HeldResultPresentationComponent } from '../held-result-presentation/held-result-presentation.component';
import { QueriesService } from '../../../../queries/queries.service';
import { QueryDispatchService } from '../../../../queries/query-dispatch.service';
import { QueryDispatchError } from '../../../../queries/query-dispatch';
import { QueryType } from '../../../../models/definition/query-def';

import { BoardWidgetComponent } from './board-widget.component';
import { QualifiedLocalReadVersionError } from '../../../../services/project/project-query-api.service';
import { TabsWidgetComponent } from '../widgets/tabs-widget/tabs-widget.component';

type QueryStub = {
  id: string;
  title: string;
  request: { queryType: QueryType; text: string };
  connectionId: string;
};

describe('BoardWidgetComponent', () => {
  let fixture: ComponentFixture<BoardWidgetComponent>;
  let router: Router;
  const getQuery = vi.fn();
  const run = vi.fn();
  const availableWorkingCopies = vi.fn(
    async () => [] as { selectionId: string; title: string }[],
  );
  let runtimeRevision = signal(0);
  let nativeProject: BehaviorSubject<{ref:{storeId:string;projectId:string;spaceID?:string}} | undefined>;
  let authState: BehaviorSubject<{
    status: 'notAuthenticated' | 'authenticated';
    user?: { uid: string };
  }>;

  beforeEach(async () => {
    getQuery.mockReset();
    run.mockReset();
    availableWorkingCopies.mockReset().mockResolvedValue([]);
    runtimeRevision = signal(0);
    nativeProject = new BehaviorSubject<{ref:{storeId:string;projectId:string;spaceID?:string}} | undefined>(undefined);
    authState = new BehaviorSubject<{
      status: 'notAuthenticated' | 'authenticated';
      user?: { uid: string };
    }>({ status: 'notAuthenticated' });
    await TestBed.configureTestingModule({
      imports: [BoardWidgetComponent],
      providers: [
        TutorialBoardRuntime,
        BoardPresentationSelection,
        { provide: PLATFORM_ID, useValue: 'server' },
        provideRouter([]),
        {provide:DatatugNavContextService,useValue:{currentProject:nativeProject,currentEnv:of(undefined)}},
        {
          provide: SneatAuthStateService,
          useValue: { authState: authState.asObservable() },
        },
        { provide: QueriesService, useValue: { getQuery } },
        {
          provide: QueryDispatchService,
          useValue: {
            execute: run,
            executeHeld: async (...args: Parameters<typeof run>) => ({ result: await run(...args) }),
            runtimeRevision: runtimeRevision.asReadonly(),
            availableWorkingCopies,
          },
        },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(BoardWidgetComponent);
    getQuery.mockReturnValue(
      of({
        id: 'chinook-top-customer-spend',
        title: 'Top spend',
        request: { queryType: QueryType.SQL, text: 'select 1' },
        connectionId: 'chinook-sqlite',
      }),
    );
  });

  // Ionic toolbar slot text is absent from the ancestor's textContent in the
  // test DOM. Inspect the rendered action labels themselves, including nested tabs.
  function renderedHeaderActions(): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('ion-buttons[slot="end"] .header-action-text') as NodeListOf<HTMLElement>,
      (label) => label.textContent?.trim() || '',
    );
  }

  function renderedQueryLink(): string {
    fixture.detectChanges();
    const button = fixture.debugElement.query(By.directive(RouterLink));
    expect(button).not.toBeNull();
    expect(button.nativeElement.textContent).toContain('Open saved query');
    const urlTree = button.injector.get(RouterLink).urlTree;
    if (!urlTree) throw new Error('Expected a saved-query RouterLink URL');
    return router.serializeUrl(urlTree);
  }

  it('renders a working anonymous demo query link', () => {
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'r@o@@v1.0.0',
    });
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId: 'demodb/chinook-top-customer-spend' } },
    });

    expect(renderedQueryLink()).toBe(
      '/project/github.com/o/r/query/demodb%2Fchinook-top-customer-spend?ref=v1.0.0&id=demodb%2Fchinook-top-customer-spend&runtime=project',
    );
  });

  it('preserves the cloud transport and branch in the actual router link', () => {
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'r@o@@feature',
      projectApi: 'cloud',
      branch: 'feature',
    });
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId: 'demodb/q' } },
    });
    fixture.componentRef.setInput('boardContext', { environment: 'dev' });

    expect(renderedQueryLink()).toBe(
      '/project/github.com/o/r/query/demodb%2Fq?ref=feature&projectApi=cloud&branch=feature&id=demodb%2Fq&env=dev&runtime=project',
    );
  });

  it('shows unavailable text instead of a dead link when the query is absent', () => {
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'r@o',
    });
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: {} },
    });
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.directive(RouterLink))).toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'This saved query is unavailable.',
    );
  });

  function renderBoardCard(queryId: string): void {
    fixture.componentRef.setInput('projectRef', { storeId: 'github.com', projectId: 'r@o' });
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'top');
    fixture.componentRef.setInput('readBoardForRun', vi.fn());
    fixture.componentRef.setInput('widgetDef', { name: 'SQL', data: { sql: { queryId } } });
    fixture.detectChanges();
  }

  it('asks a runnable board card to be run (demo walk item 5)', () => {
    renderBoardCard('demodb/chinook-top-customer-spend');
    expect(renderedHeaderActions()).toContain('Run on board');
    expect(fixture.nativeElement.textContent).toContain('Not run yet. Press ▶ Run on board to see its rows here.');
  });

  it('marks a saved SQL query with nowhere to run as browse-only instead of offering a failing Run (demo walk item 5)', () => {
    // The Northwind board's queries name no connection: a public project without an agent cannot run them.
    getQuery.mockReturnValue(
      of({
        id: 'northwind-reorder-watchlist',
        title: 'Reorder Watchlist',
        request: { queryType: QueryType.SQL, text: 'select 1' },
      }),
    );
    renderBoardCard('demodb/northwind-reorder-watchlist');
    expect(renderedHeaderActions()).not.toContain('Run on board');
    expect(renderedHeaderActions()).toContain('Open saved query');
    expect(fixture.nativeElement.textContent).toContain('Browse only: this saved query has no database it can run on here.');
    expect(fixture.nativeElement.textContent).not.toContain('Not run yet');
    expect(run).not.toHaveBeenCalled();
  });

  it('dispatches an arbitrary catalog connection after re-reading the board and query', async () => {
    const ref = { storeId: 'github.com', projectId: 'r@o@@v1.0.0' };
    const queryId = 'demodb/chinook-top-customer-spend';
    const readBoard = vi.fn(() =>
      of({
        id: 'board1',
        title: 'Board',
        rows: [
          {
            cards: [
              {
                id: 'top',
                title: 'Top spend',
                widget: { name: 'SQL', data: { sql: { queryId } } },
              },
            ],
          },
        ],
      }),
    );
    run.mockResolvedValue({
      recordset: {
        columns: [{ name: 'total', type: 'integer' }],
        rows: [[{ type: 'integer', value: '42' }]],
      },
      provenance: { source: 'Pinned public Chinook SQLite fixture' },
      truncated: false,
    });
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'top');
    fixture.componentRef.setInput('readBoardForRun', readBoard);
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId } },
    });
    fixture.detectChanges();
    expect(renderedHeaderActions()).toContain('Run on board');
    expect(fixture.nativeElement.querySelector('ion-toolbar ion-buttons[slot="end"] ion-button')?.getAttribute('aria-label')).toContain('Run on board');
    await fixture.componentInstance.run();
    fixture.detectChanges();
    expect(readBoard).toHaveBeenCalledWith(ref, 'board1');
    expect(getQuery).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.primaryActionLabel()).toBe('Refresh on board');
    expect(run.mock.calls[0][0]).toMatchObject({
      definition: { connectionId: 'chinook-sqlite' },
      projectRef: ref,
    });
    expect(fixture.nativeElement.textContent).toContain('1 rows returned');
    expect(fixture.nativeElement.textContent).toContain('42');
    expect(fixture.nativeElement.textContent).toContain(
      'Last selected from this board in this browser',
    );
  });

  it('does not restrict board dispatch to a named dataset connection', async () => {
    const queryId = 'demo/reports/active-accounts';
    getQuery.mockReturnValue(
      of({
        id: queryId,
        title: 'Active accounts',
        request: {
          queryType: QueryType.SQL,
          text: 'select count(*) from account',
        },
        connectionId: 'customer-ledger-v2',
      }),
    );
    run.mockResolvedValue({
      recordset: {
        columns: [{ name: 'count', type: 'integer' }],
        rows: [[{ type: 'integer', value: '3' }]],
      },
      provenance: { source: 'test fixture' },
      truncated: false,
    });
    const ref = { storeId: 'github.com', projectId: 'r@o@@main' };
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'ledger');
    fixture.componentRef.setInput('readBoardForRun', () =>
      of({
        id: 'board1',
        title: 'Board',
        rows: [
          {
            cards: [
              {
                id: 'ledger',
                widget: { name: 'SQL', data: { sql: { queryId } } },
              },
            ],
          },
        ],
      }),
    );
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId } },
    });
    fixture.detectChanges();

    await fixture.componentInstance.run();

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRef: ref,
        definition: expect.objectContaining({
          connectionId: 'customer-ledger-v2',
        }),
      }), { maxRows: 1000 },
    );
  });

  it('dispatches a structured card to an explicitly selected open working copy and fences a changed choice', async () => {
    const queryId = 'reports/customers';
    const ref = { storeId: 'github.com', projectId: 'r@o@@main' };
    getQuery.mockReturnValue(
      of({
        id: queryId,
        title: 'Customers',
        connectionId: 'logical-ledger-v7',
        request: {
          queryType: QueryType.TugQL,
          text: 'from:\n  name: "customers"\nlimit: 10\n',
        },
      }),
    );
    availableWorkingCopies.mockResolvedValue([
      { selectionId: 'runtime-17', title: 'Edited copy' },
    ]);
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'customers');
    fixture.componentRef.setInput('readBoardForRun', () =>
      of({
        id: 'board1',
        title: 'Board',
        rows: [
          {
            cards: [
              {
                id: 'customers',
                widget: { name: 'SQL', data: { sql: { queryId } } },
              },
            ],
          },
        ],
      }),
    );
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId } },
    });
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Edited copy');
    fixture.componentInstance.selectRuntime('runtime-17');
    fixture.detectChanges();
    expect(renderedQueryLink()).toContain('runtime=runtime-17');
    await Promise.resolve();
    fixture.detectChanges();
    let complete!: (result: unknown) => void;
    run.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = fixture.componentInstance.run();
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          projectRef: ref,
          queryId,
          runtimeSelectionId: 'runtime-17',
          definition: expect.objectContaining({
            connectionId: 'logical-ledger-v7',
          }),
        }), { maxRows: 1000 },
      ),
    );
    fixture.componentInstance.selectRuntime('snapshot');
    complete({ recordset: { columns: [], rows: [] }, truncated: false });
    await pending;
    fixture.detectChanges();
    expect(fixture.componentInstance.result()).toBeUndefined();
  });

  it('closes a selected working-copy option and fences its in-flight result on registry revision', async () => {
    const queryId = 'reports/customers';
    const ref = { storeId: 'github.com', projectId: 'r@o@@main' };
    getQuery.mockReturnValue(
      of({
        id: queryId,
        title: 'Customers',
        connectionId: 'logical-ledger-v7',
        request: {
          queryType: QueryType.TugQL,
          text: 'from:\n  name: "customers"\nlimit: 10\n',
        },
      }),
    );
    availableWorkingCopies.mockResolvedValue([
      { selectionId: 'runtime-17', title: 'Edited copy' },
    ]);
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'customers');
    fixture.componentRef.setInput('readBoardForRun', () =>
      of({
        id: 'board1',
        title: 'Board',
        rows: [
          {
            cards: [
              {
                id: 'customers',
                widget: { name: 'SQL', data: { sql: { queryId } } },
              },
            ],
          },
        ],
      }),
    );
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId } },
    });
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    fixture.componentInstance.selectRuntime('runtime-17');
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    let complete!: (value: unknown) => void;
    run.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = fixture.componentInstance.run();
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ runtimeSelectionId: 'runtime-17' }), { maxRows: 1000 },
      ),
    );
    const dispatchedSignal = run.mock.calls.at(-1)?.[0]?.signal as AbortSignal;
    availableWorkingCopies.mockResolvedValue([]);
    runtimeRevision.update((revision) => revision + 1);
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    expect(dispatchedSignal.aborted).toBe(true);
    expect(fixture.componentInstance.workingCopies()).toEqual([]);
    expect(fixture.componentInstance.selectedRuntimeId()).toBe('snapshot');
    complete({ recordset: { columns: [], rows: [] }, truncated: false });
    await pending;
    fixture.detectChanges();
    expect(fixture.componentInstance.result()).toBeUndefined();
  });

  it('does not dispatch a changed board card', async () => {
    const queryId = 'demodb/chinook-top-customer-spend';
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'r@o@@v1.0.0',
    });
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'top');
    fixture.componentRef.setInput('readBoardForRun', () =>
      of({ id: 'board1', title: 'Board', rows: [] }),
    );
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId } },
    });
    fixture.detectChanges();
    await fixture.componentInstance.run();
    fixture.detectChanges();
    expect(run).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'This board card changed.',
    );
  });

  it('runs only the selected nested widget in the freshly read board', async () => {
    const ref = { storeId: 'github.com', projectId: 'r@o@@v1.0.0' };
    const queryId = 'demodb/chinook-top-customer-spend';
    const board = {
      id: 'board1',
      title: 'Board',
      rows: [
        {
          cards: [
            {
              id: 'top',
              title: 'Top',
              widget: {
                name: 'tabs',
                data: {
                  tabs: [
                    {
                      id: 'chart',
                      title: 'Chart',
                      widget: { name: 'SQL', data: { sql: { queryId } } },
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    };
    const readBoard = vi.fn(() => of(board));
    run.mockResolvedValue({
      recordset: { columns: [], rows: [] },
      truncated: false,
      provenance: { source: 'test' },
    });
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'top');
    fixture.componentRef.setInput('widgetPath', ['id:chart']);
    fixture.componentRef.setInput('readBoardForRun', readBoard);
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId } },
    });
    fixture.detectChanges();
    await fixture.componentInstance.run();
    expect(run).toHaveBeenCalledTimes(1);
    board.rows[0].cards[0].widget.data.tabs[0].id = 'changed';
    await fixture.componentInstance.run();
    expect(run).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.runError()).toContain(
      'This board card changed.',
    );
  });

  it('renders one selected nested tab using stable IDs even when titles match', () => {
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'r@o@@v1.0.0',
    });
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'top');
    fixture.componentRef.setInput('widgetDef', {
      name: 'tabs',
      data: {
        tabs: [
          { id: 'chart', title: 'Data', widget: { name: 'HTTP' } },
          {
            id: 'grid',
            title: 'Data',
            widget: {
              name: 'SQL',
              data: { sql: { queryId: 'demodb/chinook-top-customer-spend' } },
            },
          },
        ],
      },
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Unsupported widget: HTTP',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Run on board');
    const tabs = fixture.debugElement.query(By.directive(TabsWidgetComponent))
      .componentInstance as TabsWidgetComponent;
    tabs.select('id:grid');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain(
      'Unsupported widget: HTTP',
    );
    expect(renderedHeaderActions()).toContain('Run on board');
    expect(tabs.activePath()).toEqual(['id:grid']);
  });

  it('does not persist saved-query choices in an active exact showcase session', async () => {
    await router.navigateByUrl('/?mode=tutorial');
    const ref = {
      storeId: 'github.com',
      projectId: 'datatug-demo-project@datatug@demo-project-1',
    };
    const queryId = 'demodb/chinook-top-customer-spend';
    const widget: BoardWidget = { name: 'SQL', data: { sql: { queryId } } };
    const canonical: Board = {
      id: 'showcase',
      title: 'Board',
      rows: [{ cards: [{ id: 'top', title: 'Top', widget }] }],
    };
    const session = await TutorialBoardSession.open(canonical, 'scope');
    session.dispatch({ type: 'add-card', cardId: 'top' });
    TestBed.inject(TutorialBoardRuntime).publish(ref, session, () => undefined);
    run.mockResolvedValue({
      recordset: { columns: [], rows: [] },
      truncated: false,
      provenance: { source: 'test' },
    });
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('boardId', 'showcase');
    fixture.componentRef.setInput('cardId', 'top');
    fixture.componentRef.setInput('widgetDef', widget);
    fixture.componentRef.setInput('readBoardForRun', () => of(canonical));
    const save = vi.spyOn(fixture.componentInstance.choices, 'selectQuery');
    fixture.detectChanges();
    expect(fixture.componentInstance.sessionOnly()).toBe(true);
    fixture.componentInstance.rememberChoice();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(fixture.componentInstance.running()).toBe(false),
    );
    expect(save).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'Choices stay in this tutorial session.',
    );
  });

  it.each(['tutorial', 'tutoril'])(
    'runs an ordinary board and retains preference behavior with stray mode=%s',
    async (mode) => {
      await router.navigateByUrl('/?mode=' + mode);
      const ref = { storeId: 'github.com', projectId: 'r@o@@v1.0.0' };
      const widget = {
        name: 'SQL',
        data: { sql: { queryId: 'demodb/chinook-top-customer-spend' } },
      };
      const read = vi.fn(() =>
        of({
          id: 'board1',
          title: 'Ordinary board',
          rows: [{ cards: [{ id: 'top', title: 'Top', widget }] }],
        }),
      );
      run.mockResolvedValue({
        recordset: { columns: [], rows: [] },
        truncated: false,
        provenance: { source: 'test' },
      });
      fixture.componentRef.setInput('projectRef', ref);
      fixture.componentRef.setInput('boardId', 'board1');
      fixture.componentRef.setInput('cardId', 'top');
      fixture.componentRef.setInput('widgetDef', widget);
      fixture.componentRef.setInput('readBoardForRun', read);
      const save = vi
        .spyOn(fixture.componentInstance.choices, 'selectQuery')
        .mockReturnValue(true);
      fixture.detectChanges();
      expect(fixture.componentInstance.sessionOnly()).toBe(false);
      expect(fixture.componentInstance.canRemember()).toBe(true);
      await fixture.componentInstance.run();
      expect(read).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance.runError()).toBeUndefined();
      expect(save).toHaveBeenCalledWith(
        ref,
        'board1',
        'demodb/chinook-top-customer-spend',
      );
    },
  );

  it('retains one card result while switching sibling tabs with the same query', async () => {
    const queryId = 'demodb/chinook-top-customer-spend';
    const queryWidget = { name: 'SQL', data: { sql: { queryId } } };
    const tabsWidget = {
      name: 'tabs',
      data: {
        tabs: [
          { id: 'chart', title: 'Chart', widget: queryWidget },
          { id: 'grid', title: 'Grid', widget: queryWidget },
        ],
      },
    };
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'r@o@@v1.0.0',
    });
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'top');
    fixture.componentRef.setInput('widgetDef', tabsWidget);
    fixture.componentRef.setInput('readBoardForRun', () =>
      of({
        id: 'board1',
        title: 'Board',
        rows: [{ cards: [{ id: 'top', title: 'Top', widget: tabsWidget }] }],
      }),
    );
    run.mockResolvedValue({
      recordset: { columns: [], rows: [] },
      truncated: false,
      provenance: { source: 'test' },
    });
    fixture.detectChanges();
    const child = () =>
      fixture.debugElement.query(By.directive(BoardWidgetComponent))
        .componentInstance as BoardWidgetComponent;
    await child().run();
    expect(run).toHaveBeenCalledTimes(1);
    const firstSnapshot = fixture.componentInstance.snapshotStore()();
    const tabs = fixture.debugElement.query(By.directive(TabsWidgetComponent))
      .componentInstance as TabsWidgetComponent;
    tabs.select('id:grid');
    fixture.detectChanges();
    expect(fixture.componentInstance.snapshotStore()()).toBe(firstSnapshot);
    expect(child().result()).toBe(firstSnapshot?.result);
  });

  it('shows safe CLI compatibility guidance when board revalidation is blocked', async () => {
    getQuery.mockReturnValue(
      of({
        id: 'demo/query',
        title: 'Demo query',
        request: { queryType: QueryType.SQL, text: 'select 1' },
        connectionId: 'chinook-sqlite',
      }),
    );
    fixture.componentRef.setInput('projectRef', {
      storeId: 'localhost:8989',
      projectId: 'demo',
      projectApi: 'local',
      branch: 'feature/demo',
    });
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'top');
    fixture.componentRef.setInput('readBoardForRun', () =>
      throwError(() => new QualifiedLocalReadVersionError()),
    );
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId: 'demo/query' } },
    });
    fixture.detectChanges();
    await fixture.componentInstance.run();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toMatch(
      /update DataTug CLI to v0\.97\.0 or later.*restart its agent/i,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('uses the existing alert for finite diagnostics and retains the original failure only locally', async () => {
    const cause = new Error('https://secret.test/token SQL auth body');
    const failure = new NativeQueryFailure({ stage: 'capability_discovery', reason: 'http_status', status: 403 }, { cause });
    getQuery.mockReturnValue(of({ id: 'demo/query', title: 'Demo query', request: { queryType: QueryType.SQL, text: 'select 1' }, connectionId: 'chinook-sqlite' }));
    fixture.componentRef.setInput('projectRef', { storeId: 'localhost:8989', projectId: 'demo', projectApi: 'local', branch: 'feature/demo' });
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'top');
    fixture.componentRef.setInput('readBoardForRun', () => throwError(() => failure));
    fixture.componentRef.setInput('widgetDef', { name: 'SQL', data: { sql: { queryId: 'demo/query' } } });
    fixture.detectChanges();
    await fixture.componentInstance.run();
    fixture.detectChanges();
    expect(fixture.componentInstance.runFailure()).toBe(failure);
    expect(fixture.componentInstance.runFailure()).toHaveProperty('cause', cause);
    expect(fixture.nativeElement.textContent).toContain('OVDB metadata request failed (HTTP 403)');
    expect(fixture.nativeElement.textContent).not.toMatch(/secret|SQL auth body/);
    expect(fixture.componentInstance.runError()).toContain('Retry');
  });

  it('keeps an unexpected board read error generic', async () => {
    getQuery.mockReturnValue(
      of({
        id: 'demo/query',
        title: 'Demo query',
        request: { queryType: QueryType.SQL, text: 'select 1' },
        connectionId: 'chinook-sqlite',
      }),
    );
    fixture.componentRef.setInput('projectRef', {
      storeId: 'localhost:8989',
      projectId: 'demo',
      projectApi: 'local',
      branch: 'feature/demo',
    });
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'top');
    fixture.componentRef.setInput('readBoardForRun', () =>
      throwError(() => new Error('private server response: token abc123')),
    );
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId: 'demo/query' } },
    });
    fixture.detectChanges();
    await fixture.componentInstance.run();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'The saved query could not run. Try again or open the saved query to inspect it.',
    );
    expect(fixture.nativeElement.textContent).not.toContain('abc123');
  });

  it('uses the pinned branch for public query reads and browser execution', async () => {
    const ref = {
      storeId: 'github.com',
      projectId: 'r@o@',
      branch: 'feature/demo',
    };
    const queryId = 'demodb/chinook-top-customer-spend';
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'top');
    fixture.componentRef.setInput('readBoardForRun', () =>
      of({
        id: 'board1',
        title: 'Board',
        rows: [
          {
            cards: [
              {
                id: 'top',
                title: 'Top',
                widget: { name: 'SQL', data: { sql: { queryId } } },
              },
            ],
          },
        ],
      }),
    );
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId } },
    });
    run.mockResolvedValue({
      recordset: { columns: [], rows: [] },
      truncated: false,
    });
    fixture.detectChanges();
    expect(getQuery).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'r@o@@feature/demo' }),
      queryId,
    );
    await fixture.componentInstance.run();
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRef: expect.objectContaining({
          projectId: 'r@o@',
          branch: 'feature/demo',
        }),
        queryId,
      }), { maxRows: 1000 },
    );
  });

  it('shows the completed empty state and a retryable execution error', async () => {
    const queryId = 'demodb/chinook-top-customer-spend';
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'r@o@@v1.0.0',
    });
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'top');
    fixture.componentRef.setInput('readBoardForRun', () =>
      of({
        id: 'board1',
        title: 'Board',
        rows: [
          {
            cards: [
              {
                id: 'top',
                title: 'Top',
                widget: { name: 'SQL', data: { sql: { queryId } } },
              },
            ],
          },
        ],
      }),
    );
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId } },
    });
    fixture.detectChanges();
    run.mockResolvedValueOnce({
      recordset: { columns: [], rows: [] },
      truncated: false,
      provenance: { source: 'Pinned public Chinook SQLite fixture' },
    });
    await fixture.componentInstance.run();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Query completed with no rows.',
    );
    run.mockRejectedValueOnce(new Error('secret service detail'));
    await fixture.componentInstance.run();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'The saved query could not run. Try again',
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'secret service detail',
    );

    run.mockRejectedValueOnce(
      new QueryDispatchError('The query exceeds the 1,000-row browser limit.'),
    );
    await fixture.componentInstance.run();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'The query exceeds the 1,000-row browser limit.',
    );
  });

  it('keeps the saved-query action for a qualified ref when its query is not admitted', () => {
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'r@o@@feature',
      projectApi: 'cloud',
      branch: 'feature',
    });
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId: 'demodb/q' } },
    });
    fixture.detectChanges();
    expect(renderedHeaderActions()).toContain('Open saved query');
    expect(renderedHeaderActions()).not.toContain('Run on board');
    expect(getQuery).toHaveBeenCalledTimes(1);
  });

  it('never reads or dispatches an old query after a delayed board reply and project switch', async () => {
    const queryId = 'demodb/chinook-top-customer-spend';
    const oldRef = { storeId: 'github.com', projectId: 'r@o@@one' };
    const board$ = new Subject<Board>();
    fixture.componentRef.setInput('projectRef', oldRef);
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'top');
    fixture.componentRef.setInput('readBoardForRun', () =>
      board$.asObservable(),
    );
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId } },
    });
    fixture.detectChanges();
    getQuery.mockClear();
    const pending = fixture.componentInstance.run();
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'r@o@@two',
    });
    fixture.detectChanges();
    board$.next({
      id: 'board1',
      title: 'Board',
      rows: [
        {
          cards: [
            {
              id: 'top',
              title: 'Top',
              widget: { name: 'SQL', data: { sql: { queryId } } },
            },
          ],
        },
      ],
    });
    board$.complete();
    await pending;
    expect(getQuery.mock.calls.filter(([ref]) => ref === oldRef)).toHaveLength(
      0,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('never dispatches SQLite after a delayed query reply and account switch', async () => {
    const queryId = 'demodb/chinook-top-customer-spend';
    const pendingQuery$ = new Subject<QueryStub>();
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'r@o@@one',
    });
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'top');
    fixture.componentRef.setInput('readBoardForRun', () =>
      of({
        id: 'board1',
        title: 'Board',
        rows: [
          {
            cards: [
              {
                id: 'top',
                title: 'Top',
                widget: { name: 'SQL', data: { sql: { queryId } } },
              },
            ],
          },
        ],
      }),
    );
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId } },
    });
    fixture.detectChanges();
    getQuery.mockReturnValueOnce(pendingQuery$.asObservable());
    const pending = fixture.componentInstance.run();
    await Promise.resolve();
    authState.next({
      status: 'authenticated',
      user: { uid: 'another-person' },
    });
    pendingQuery$.next({
      id: 'chinook-top-customer-spend',
      title: 'Top',
      request: { queryType: QueryType.SQL, text: 'select 1' },
      connectionId: 'chinook-sqlite',
    });
    pendingQuery$.complete();
    await pending;
    expect(run).not.toHaveBeenCalled();
  });

  it('never dispatches SQLite after a delayed query reply and card switch', async () => {
    const queryId = 'demodb/chinook-top-customer-spend';
    const pendingQuery$ = new Subject<QueryStub>();
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'r@o@@one',
    });
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'top');
    fixture.componentRef.setInput('readBoardForRun', () =>
      of({
        id: 'board1',
        title: 'Board',
        rows: [
          {
            cards: [
              {
                id: 'top',
                title: 'Top',
                widget: { name: 'SQL', data: { sql: { queryId } } },
              },
            ],
          },
        ],
      }),
    );
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId } },
    });
    fixture.detectChanges();
    getQuery.mockReturnValueOnce(pendingQuery$.asObservable());
    const pending = fixture.componentInstance.run();
    await Promise.resolve();
    fixture.componentRef.setInput('cardId', 'different');
    fixture.detectChanges();
    pendingQuery$.next({
      id: 'chinook-top-customer-spend',
      title: 'Top',
      request: { queryType: QueryType.SQL, text: 'select 1' },
      connectionId: 'chinook-sqlite',
    });
    pendingQuery$.complete();
    await pending;
    expect(run).not.toHaveBeenCalled();
  });
  const publicQueryId = 'reports/shipping-counts';
  const countryWidget: BoardWidget = {
    name: 'chart',
    data: {
      title: 'Shipping countries',
      sources: [{ id: 'countries', queryId: publicQueryId }],
      chart: {
        type: 'bar',
        categoryColumn: 'ShipCountry',
        valueColumn: 'orders',
        unit: 'orders',
      },
    },
  };
  function configureShowcase(widget: BoardWidget = countryWidget) {
    const definition = {
      id: publicQueryId,
      title: 'Countries',
      connectionId: 'northwind-sqlite',
      request: { queryType: QueryType.SQL, text: 'SELECT ShipCountry, COUNT(*) AS orders FROM Orders GROUP BY ShipCountry' },
    };
    getQuery.mockReturnValue(of(definition));
    const board = {
      id: 'showcase',
      title: 'Showcase',
      rows: [{ cards: [{ id: 'countries', title: 'Countries', widget }] }],
    };
    const readBoard = vi.fn(() => of(board));
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'datatug-demo-project@datatug@demo-project-1',
    });
    fixture.componentRef.setInput('boardId', 'showcase');
    fixture.componentRef.setInput('cardId', 'countries');
    fixture.componentRef.setInput('widgetDef', widget);
    fixture.componentRef.setInput('readBoardForRun', readBoard);
    return { board, readBoard, definition };
  }
  function countryResult() {
    const rights = JSON.parse(readFileSync(resolve(process.cwd(), 'libs/datatug/main/src/lib/queries/test-fixtures/browser-sqlite/northwind-source-rights.json'), 'utf8'));
    return {
      runtime: 'browser-sqlite' as const,
      complete: true,
      hasMore: false,
      truncated: false,
      recordset: {
        columns: [
          { name: 'ShipCountry', type: 'string' },
          { name: 'orders', type: 'integer' },
        ],
        rows: [
          [
            { type: 'string' as const, value: 'France' },
            { type: 'integer' as const, value: '77' },
          ],
        ],
      },
      limitations: [],
      bindingsApplied: [],
      sourceRights: rights.sourceRights,
      usedSourceIds: rights.usedSourceIds,
      provenance: {
        source: 'northwind',
        collection: 'Orders',
        queryId: publicQueryId,
        mode: 'snapshot' as const,
        observedAt: '2026-10-16T14:00:00Z',
        endpoint: 'https://demodb.dev/ovdb/v1/databases/northwind/tugql',
        databaseId: 'northwind',
      },
      sqliteReceipt: {
        fixtureSha256: rights.sourceRights[0].pins[0].sha256, fixtureBytes: 602112,
        sourceId: rights.usedSourceIds[0], queryId: publicQueryId, rowsReturned: 1,
        observedAt: '2026-10-16T14:00:00Z',
      },
    };
  }

  it('clears a chart producer without interpreting chart data as a SQL definition', () => {
    const data = countryWidget.data as ChartWidgetDef;
    configureShowcase({ ...countryWidget, data: { ...data, chart: { ...data.chart, selectionId: 'country' } } });
    const component = fixture.componentInstance;
    expect(component.sqlWidgetDef()).toBeUndefined();
    component.selectCountry('Canada');
    expect(component.selectedCountry()).toBe('Canada');
    expect(() => component.clearCountry()).not.toThrow();
    expect(component.selectedCountry()).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });

  it('dispatches a native-demo TugQL saved query from the canonical SQL widget to the explicit hosted target', async () => {
    const queryId = 'detective/invoice-detail';
    const { board, readBoard } = configureShowcase({
      name: 'SQL',
      data: { sql: { queryId, parameters: [{ id: 'invoice_id', value: 7 }] } },
    });
    const ref = {
      storeId: 'firestore',
      spaceID: 'space',
      projectId: 'training',
    };
    const definition = {
      id: 'invoice-detail',
      title: 'Invoice totals and customer',
      request: {
        queryType: QueryType.TugQL,
        text: 'from: {database: invoices-db, name: InvoiceDetail}',
      },
      parameters: [{ id: 'invoice_id', type: 'integer', isRequired: true }],
    };
    getQuery.mockReturnValue(of(definition));
    authState.next({ status: 'authenticated', user: { uid: 'sarah' } });
    nativeProject.next({ref});
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('boardContext', {
      environment: 'demo',
      executionTarget: { kind: 'hosted-cloud' },
    });
    run.mockRejectedValue(
      new QueryDispatchError('Current source unavailable.'),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    await fixture.componentInstance.run();
    expect(fixture.componentInstance.unsupportedReason()).toBeUndefined();
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRef: ref,
        queryId,
        definition,
        environment: 'demo',
        target: { kind: 'hosted-cloud' },
        parameters: { invoice_id: { type: 'integer', value: '7' } },
      }),
      { maxRows: 1000 },
    );
    expect(fixture.componentInstance.runError()).toContain(
      'Current source unavailable',
    );
    const changed = JSON.parse(JSON.stringify(board)) as typeof board;
    changed.rows[0].cards[0].widget = {
      name: 'SQL',
      data: { sql: { queryId, parameters: [{ id: 'invoice_id', value: 8 }] } },
    };
    readBoard.mockReturnValue(of(changed));
    run.mockClear();
    await fixture.componentInstance.run();
    expect(run).not.toHaveBeenCalled();
    expect(fixture.componentInstance.runError()).toContain(
      'board card changed',
    );
  });

  it('pairs authenticated provider identity with the complete held Result, never trusts a sidecar alone, and clears both on native actor change', async () => {
    const queryId='shipping/receipt',ref={storeId:'firestore',spaceID:'fixture-space',projectId:'fixture-project'};
    configureShowcase({name:'SQL',data:{sql:{queryId}}});
    getQuery.mockReturnValue(of({id:'receipt',title:'Request received',request:{queryType:QueryType.SQL,text:'SELECT request_id FROM shipping_requests'}}));
    authState.next({status:'authenticated',user:{uid:'sarah'}});nativeProject.next({ref});
    fixture.componentRef.setInput('projectRef',ref);fixture.componentRef.setInput('boardContext',{environment:'demo',executionTarget:{kind:'hosted-cloud'}});
    const response=await readRetainedQueryResponse(retainedFixture.query,{projectRef:ref,environment:'demo',actor:'sarah'},queryId);
    const execute=vi.spyOn(TestBed.inject(QueryDispatchService),'executeHeld').mockResolvedValue({result:response.result,hostedResponse:response});
    fixture.detectChanges();await fixture.whenStable();await fixture.componentInstance.run();
    expect(fixture.componentInstance.result()).toMatchObject({rowEvidence:response.result.rowEvidence});
    expect(fixture.componentInstance.heldSnapshot()?.evidenceIdentity?.source.generation).toBe(response.sourcePin?.revision.generation);
    execute.mockResolvedValue({result:response.result});await fixture.componentInstance.run();
    expect(fixture.componentInstance.heldSnapshot()?.evidenceIdentity).toBeUndefined();
    authState.next({status:'authenticated',user:{uid:'maya'}});
    expect(fixture.componentInstance.result()).toBeUndefined();expect(fixture.componentInstance.heldSnapshot()).toBeUndefined();
  });

  it('runs a saved server TugQL definition by default without choosing a working copy', async () => {
    configureShowcase();
    getQuery.mockReturnValue(of({ id: publicQueryId, title: 'Server countries',
      request: { queryType: QueryType.TugQL, text: 'from: {database: northwind, name: Orders, alias: orders}' },
      federation: { ovdbBaseUrl: 'https://ovdb.demodb.dev', tables: [{ database: 'northwind', name: 'Orders', fields: ['ShipCountry'] }] } }));
    run.mockResolvedValue(countryResult());
    fixture.detectChanges();
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(fixture.componentInstance.unsupportedReason()).toBeUndefined();
    expect(fixture.componentInstance.runError()).toBeUndefined();
    expect(run.mock.calls[0][0]).not.toHaveProperty('runtimeSelectionId');
    fixture.componentInstance.setChartView('grid'); fixture.componentInstance.setChartView('chart');
    expect(run).toHaveBeenCalledOnce();
  });

  it('automatically executes a visible saved showcase chart once and switches held chart/grid without fetching', async () => {
    const { readBoard } = configureShowcase();
    run.mockResolvedValue(countryResult());
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.running()).toBe(false),
    );
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledTimes(1),
    );
    await fixture.whenStable();
    expect(readBoard).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    const held = fixture.debugElement.query(
      By.directive(HeldResultPresentationComponent),
    ).componentInstance as HeldResultPresentationComponent;
    expect(held.bars[0].category).toBe('France');
    held.view.set('grid');
    fixture.detectChanges();
    held.view.set('chart');
    fixture.detectChanges();
    expect(run).toHaveBeenCalledTimes(1);
    expect(getQuery).toHaveBeenCalledTimes(2);
  });

  it('revalidates the exact saved chart before its automatic public request', async () => {
    const { board } = configureShowcase();
    board.rows[0].cards[0].widget = {
      ...countryWidget,
      data: {
        ...(countryWidget.data as object),
        sources: [{ id: 'changed', queryId: publicQueryId }],
      },
    };
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.runError()).toContain(
        'This board card changed.',
      ),
    );
    expect(run).not.toHaveBeenCalled();
    expect(fixture.componentInstance.runError()).toContain(
      'This board card changed.',
    );
  });

  it('aborts a stale public chart and ignores its late completion after environment changes', async () => {
    configureShowcase();
    let finish!: (result: ReturnType<typeof countryResult>) => void;
    run.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledTimes(1),
    );
    const signal = run.mock.calls[0][0]?.signal;
    fixture.componentRef.setInput('boardContext', { environment: 'different' });
    fixture.detectChanges();
    expect(signal?.aborted).toBe(true);
    finish(countryResult());
    await Promise.resolve();
    await Promise.resolve();
    expect(fixture.componentInstance.result()).toBeUndefined();
  });

  it('shares cached automatic results only within the card and does not rerun a revisited sibling query', async () => {
    const sql = { name: 'SQL', data: { sql: { queryId: publicQueryId } } };
    const widget = {
      name: 'tabs',
      data: {
        tabs: [
          { id: 'first', title: 'First', widget: sql },
          { id: 'second', title: 'Second', widget: sql },
        ],
      },
    };
    configureShowcase(widget);
    run.mockResolvedValue(countryResult());
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledTimes(1),
    );
    await fixture.whenStable();
    const tabs = fixture.debugElement.query(By.directive(TabsWidgetComponent))
      .componentInstance as TabsWidgetComponent;
    tabs.select('id:second');
    fixture.detectChanges();
    await fixture.whenStable();
    tabs.select('id:first');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(run).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('cardId', 'different-card');
    fixture.detectChanges();
    expect(fixture.componentInstance.result()).toBeUndefined();
  });

  it('does not automatically execute charts from another project', async () => {
    configureShowcase();
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'fork@someone@demo-project-1',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(run).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
  it('dispatches saved SQL with the selected browser target', async () => {
    configureShowcase();
    fixture.componentRef.setInput('boardContext', {
      environment: 'dev',
      executionTarget: { kind: 'browser-sqlite' },
    });
    run.mockResolvedValue(countryResult());
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledTimes(1),
    );
  });

  it('dispatches an explicit target and displays its runtime validation failure', async () => {
    configureShowcase();
    fixture.componentRef.setInput('boardContext', { environment: 'dev', executionTarget: { kind: 'hosted-cloud' } });
    run.mockRejectedValue(new QueryDispatchError('Hosted execution requires a shared cloud project.'));
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.runError()).toContain('Hosted execution requires'));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: 'hosted-cloud' } }), { maxRows: 1000 });
  });

  it('runs a separate saved inspector query through the dispatcher with no bar controls', async () => {
    const queryId = 'reports/country-inspector';
    configureShowcase({ name: 'SQL', data: { sql: { queryId } } });
    getQuery.mockReturnValue(
      of({
        id: queryId,
        title: 'Country inspector',
        connectionId: 'northwind-sqlite',
        request: { queryType: QueryType.SQL, text: 'SELECT ShipCountry, COUNT(*) AS orders FROM Orders GROUP BY ShipCountry' },
      }),
    );
    run.mockResolvedValue(countryResult());
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledTimes(1),
    );
    await vi.waitFor(() =>
      expect(fixture.componentInstance.running()).toBe(false),
    );
    await fixture.whenStable();
    const presentation = fixture.debugElement.query(
      By.directive(HeldResultPresentationComponent),
    ).componentInstance as HeldResultPresentationComponent;
    expect(presentation.fields).toBeNull();
    expect(presentation.view()).toBe('grid');
    expect(fixture.nativeElement.textContent).toContain(
      'Source and usage details',
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps the race visible before accessible source terms and preserves playback across chart/source row switches', async () => {
    configureShowcase({
      name: 'chart',
      data: {
        sources: [{ id: 'source', queryId: publicQueryId }],
        chart: {
          type: 'bar-race',
          periodColumn: 'period',
          categoryColumn: 'category',
          valueColumn: 'value',
          unit: 'orders',
          onDuplicate: 'reject',
          grain: 'month',
          mode: 'cumulative',
          topN: 15,
        },
      },
    });
    const frame = (period: string) => ({
      period,
      entries: [{ category: 'France', value: 4, rank: 1, color: '#123456' }],
    });
    const mode = (mode: 'period' | 'cumulative') => ({
      runtime: 'browser-public-api',
      limitations: [],
      bindingsApplied: [],
      truncated: false,
      spec: { kind: 'bar-race', mode, topN: 20 },
      frames: [frame('2026-01'), frame('2026-02')],
    });
    vi.spyOn(fixture.componentInstance, 'preparedRace').mockReturnValue({
      views: {
        period: mode('period'),
        cumulative: mode('cumulative'),
      } as unknown as BarRaceChartViews,
    });
    run.mockResolvedValue(countryResult());
    fixture.detectChanges();
    const chart = fixture.debugElement.query(
      By.directive(BarRaceChartComponent),
    ).componentInstance as BarRaceChartComponent;
    expect(chart.mode()).toBe('cumulative');
    expect(chart.topN()).toBe(15);
    chart.next();
    chart.topN.set(7);
    const switchGroup = fixture.nativeElement.querySelector(
      '[aria-label="Chart result view"]',
    ) as HTMLElement;
    const chartElement = fixture.nativeElement.querySelector(
      'datatug-bar-race-chart',
    ) as HTMLElement;
    expect(
      switchGroup.compareDocumentPosition(chartElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    (switchGroup.querySelectorAll('button')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(chart.active).toBe(false);
    expect(
      switchGroup.querySelectorAll('button')[1].getAttribute('aria-pressed'),
    ).toBe('true');
    (switchGroup.querySelectorAll('button')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(
      fixture.debugElement.query(By.directive(BarRaceChartComponent))
        .componentInstance,
    ).toBe(chart);
    expect(chart.frameIndex()).toBe(1);
    expect(chart.mode()).toBe('cumulative');
    expect(chart.topN()).toBe(7);
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledTimes(1),
    );
    await vi.waitFor(() =>
      expect(fixture.componentInstance.result()).toBeDefined(),
    );
    fixture.detectChanges();
    const terms = fixture.nativeElement.querySelector('details.chart-source-terms') as HTMLDetailsElement;
    expect(chartElement.compareDocumentPosition(terms) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(terms.open).toBe(false);
    const summary = terms.querySelector('summary') as HTMLElement;
    expect(summary.textContent?.trim()).toBe('Source data terms');
    summary.click();
    expect(terms.open).toBe(true);
    expect(terms.querySelector('[aria-label="Source data terms"]')?.textContent).toContain('MIT');
  });

  function configureBoundChart(bindings: unknown, countryType = 'string') {
    const queryId = 'reports/bound';
    const definition = {
      id: queryId,
      title: 'Bound query',
      connectionId: 'custom-connection',
      request: { queryType: QueryType.SQL, text: 'select :country, :limit' },
      parameters: [
        { id: 'country', type: countryType },
        { id: 'limit', type: 'integer' },
      ],
    };
    getQuery.mockReturnValue(of(definition));
    const widget = {
      name: 'chart',
      data: {
        sources: [{ id: 'source', queryId, parameters: bindings }],
        chart: {
          type: 'bar',
          categoryColumn: 'ShipCountry',
          valueColumn: 'orders',
        },
      },
    };
    fixture.componentRef.setInput('projectRef', {
      storeId: 'localhost:8989',
      projectId: 'demo',
      projectApi: 'local',
      branch: 'main',
    });
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'bound');
    fixture.componentRef.setInput('widgetDef', widget);
    fixture.componentRef.setInput('boardContext', {
      executionTarget: { kind: 'local-agent', agentStoreId: 'localhost:8989' },
      parameters: { selectedCountry: { type: 'string', value: 'France' } },
    });
    fixture.componentRef.setInput('readBoardForRun', () =>
      of({
        id: 'board1',
        title: 'Board',
        rows: [{ cards: [{ id: 'bound', widget }] }],
      }),
    );
    run.mockResolvedValue(countryResult());
    fixture.detectChanges();
    return widget;
  }

  it('resolves source constants and explicitly named board parameters for dispatcher execution', async () => {
    configureBoundChart([
      { id: 'country', boardParameterId: 'selectedCountry' },
      { id: 'limit', value: 5 },
    ]);
    await fixture.componentInstance.run();
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: {
          country: { type: 'string', value: 'France' },
          limit: { type: 'integer', value: '5' },
        },
        target: { kind: 'local-agent', agentStoreId: 'localhost:8989' },
      }), { maxRows: 1000 },
    );
  });

  it.each([
    [{ id: 'country', value: 'France', boardParameterId: 'selectedCountry' }],
    [{ id: 'country', boardParameterId: 'missing' }],
    [{ id: 'unknown', value: 'France' }],
    [
      { id: 'country', value: 'France' },
      { id: 'country', value: 'Germany' },
    ],
    [
      { id: 'country', value: 'France' },
      { id: 'limit', value: 1.5 },
    ],
    [{ id: 'country', value: undefined }],
    [],
  ])(
    'fails closed on malformed or missing source parameter bindings %j',
    async (...bindings) => {
      configureBoundChart(bindings);
      await fixture.componentInstance.run();
      expect(run).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
      expect(fixture.componentInstance.runError()).toBeTruthy();
    },
  );

  it('dispatches declared saved SQL parameters without a query-ID-specific profile', async () => {
    configureShowcase({
      name: 'chart',
      data: {
        ...(countryWidget.data as object),
        sources: [
          {
            id: 'source',
            queryId: publicQueryId,
            parameters: [{ id: 'limit', value: 5 }],
          },
        ],
      },
    });
    getQuery.mockReturnValue(
      of({
        id: publicQueryId,
        title: 'Bound public query',
        connectionId: 'northwind-sqlite',
        request: { queryType: QueryType.SQL, text: 'SELECT ShipCountry, COUNT(*) AS orders FROM Orders GROUP BY ShipCountry' },
        parameters: [{ id: 'limit', type: 'integer' }],
      }),
    );
    run.mockResolvedValue(countryResult());
    fixture.detectChanges();
    await vi.waitFor(() => expect(run).toHaveBeenCalledWith(expect.objectContaining({
      parameters: { limit: { type: 'integer', value: '5' } },
    }), { maxRows: 1000 }));
  });
  it('rejects unsupported chart parameter types rather than relabeling them as strings', async () => {
    configureBoundChart(
      [
        { id: 'country', value: 'bytes' },
        { id: 'limit', value: 5 },
      ],
      'binary',
    );
    await fixture.componentInstance.run();
    expect(run).not.toHaveBeenCalled();
    expect(fixture.componentInstance.runError()).toContain(
      'chart parameter type',
    );
  });
  it('invalidates a held chart after a board parameter edit and passes the new value on refresh', async () => {
    configureBoundChart([
      { id: 'country', boardParameterId: 'selectedCountry' },
      { id: 'limit', value: 5 },
    ]);
    await fixture.componentInstance.run();
    expect(fixture.componentInstance.result()).toBeTruthy();
    fixture.componentRef.setInput('boardContext', {
      executionTarget: { kind: 'local-agent', agentStoreId: 'localhost:8989' },
      parameters: { selectedCountry: { type: 'string', value: 'Germany' } },
    });
    fixture.detectChanges();
    expect(fixture.componentInstance.result()).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
    await fixture.componentInstance.run();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0].parameters.country).toEqual({
      type: 'string',
      value: 'Germany',
    });
  });
  it('executes a session-authored saved-query tab after canonical replay, and refuses remote revision drift', async () => {
    run.mockResolvedValue(countryResult());
    await router.navigateByUrl('/?mode=tutoril');
    const root: BoardWidget = {
      name: 'tabs',
      data: {
        tabs: [
          {
            id: 'saved',
            title: 'Saved',
            widget: { name: 'SQL', data: { sql: { queryId: publicQueryId } } },
          },
        ],
      },
    };
    const canonical = {
      id: 'showcase',
      title: 'Showcase',
      rows: [
        { cards: [{ id: 'countries', title: 'Countries', widget: root }] },
      ],
    };
    const session = await TutorialBoardSession.open(canonical, 'scope');
    const { board } = configureShowcase(root);
    const ref = fixture.componentInstance.projectRef();
    if (!ref) throw new Error('Missing project');
    session.dispatch({ type: 'add-card', cardId: 'countries' });
    session.dispatch({
      type: 'add-tab',
      cardId: 'countries',
      tabId: 'mine',
      title: 'My query',
      queryId: publicQueryId,
    });
    TestBed.inject(TutorialBoardRuntime).publish(ref, session, () => undefined);
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId: publicQueryId } },
    });
    fixture.componentRef.setInput('widgetPath', ['id:mine']);
    await router.navigateByUrl('/?mode=tutoril');
    run.mockResolvedValue(countryResult());
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.result()).toBeTruthy(),
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.sessionOnly()).toBe(true);
    board.title = 'Changed remotely';
    await fixture.componentInstance.run();
    expect(fixture.componentInstance.runError()).toContain(
      'This board card changed.',
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps the admitted snapshot for session views and invalidates it when leaving the active tutorial', async () => {
    run.mockResolvedValue(countryResult());
    await router.navigateByUrl('/?mode=tutorial');
    const canonical = {
      id: 'showcase',
      title: 'Showcase',
      rows: [
        {
          cards: [
            { id: 'countries', title: 'Countries', widget: countryWidget },
          ],
        },
      ],
    };
    const session = await TutorialBoardSession.open(canonical, 'scope');
    configureShowcase();
    const ref = fixture.componentInstance.projectRef();
    if (!ref) throw new Error('Missing project');
    session.dispatch({ type: 'add-card', cardId: 'countries' });
    const runtime = TestBed.inject(TutorialBoardRuntime);
    runtime.publish(ref, session, () => undefined);
    await router.navigateByUrl('/?mode=tutorial');
    run.mockResolvedValue(countryResult());
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.result()).toBeTruthy(),
    );
    const held = fixture.componentInstance.result();
    for (const view of ['grid', 'chart'] as const) {
      session.dispatch({ type: 'set-view', cardId: 'countries', view });
      runtime.publish(ref, session, () => undefined);
      fixture.componentRef.setInput(
        'widgetDef',
        session.board.rows?.[0].cards?.[0].widget,
      );
      fixture.detectChanges();
      await fixture.whenStable();
      expect(fixture.componentInstance.result()).toBe(held);
    }
    expect(run).toHaveBeenCalledTimes(1);
    expect(getQuery).toHaveBeenCalledTimes(2);
    let resolveNormal:
      | ((result: ReturnType<typeof countryResult>) => void)
      | undefined;
    run.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNormal = resolve;
        }),
    );
    // BoardPage restores the canonical widget when leaving the session overlay.
    fixture.componentRef.setInput('widgetDef', countryWidget);
    await router.navigateByUrl('/');
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledTimes(2),
    );
    expect(fixture.componentInstance.sessionOnly()).toBe(false);
    expect(fixture.componentInstance.result()).toBeUndefined();
    resolveNormal?.(countryResult());
    await vi.waitFor(() =>
      expect(fixture.componentInstance.running()).toBe(false),
    );
    expect(fixture.componentInstance.result()).toBeTruthy();
  });

  it('aborts an old source binding, ignores its late reply, and ignores stray mode on an ordinary board', async () => {
    const widget = configureBoundChart([
      { id: 'country', value: 'France' },
      { id: 'limit', value: 5 },
    ]);
    let resolveOld:
      | ((result: ReturnType<typeof countryResult>) => void)
      | undefined;
    let oldSignal: AbortSignal | undefined;
    run.mockImplementationOnce((request: { signal: AbortSignal }) => {
      oldSignal = request.signal;
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    });
    const pending = fixture.componentInstance.run();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const edited = {
      ...widget,
      data: {
        ...widget.data,
        sources: [
          {
            ...widget.data.sources[0],
            parameters: [
              { id: 'country', value: 'Spain' },
              { id: 'limit', value: 5 },
            ],
          },
        ],
      },
    };
    // The freshly read canonical board now supplies the changed saved binding.
    widget.data.sources = edited.data.sources;
    fixture.componentRef.setInput('widgetDef', edited);
    fixture.detectChanges();
    expect(oldSignal?.aborted).toBe(true);
    resolveOld?.(countryResult());
    await pending;
    expect(fixture.componentInstance.result()).toBeUndefined();
    run.mockResolvedValue(countryResult());
    await fixture.componentInstance.run();
    expect(run.mock.calls[1][0].parameters.country.value).toBe('Spain');
    const held = fixture.componentInstance.result();
    expect(held).toBeTruthy();
    await router.navigateByUrl('/?mode=tutorial');
    fixture.detectChanges();
    expect(fixture.componentInstance.result()).toBe(held);
    expect(fixture.componentInstance.sessionOnly()).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('runs independent bindings through existing widgets, retains the first snapshot when adding a sibling and exposes title and raw source inspection', async () => {
    await router.navigateByUrl('/?mode=tutorial');
    const n = { id: 'northwind', queryId: 'reports/n' }, c = { id: 'chinook', queryId: 'reports/c' };
    const data: ChartWidgetDef = { title: 'Null countries excluded; source observations remain separate.', sources: [n, c], chart: { type: 'bar', categoryColumn: 'country', valueColumn: 'customers', unit: 'customer records' } };
    const widget: BoardWidget = { name: 'chart', data };
    const board = { id: 'showcase', title: 'Showcase', rows: [{ cards: [{ id: 'countries', title: 'Countries', widget }] }] };
    const fixtureTerms = (database: string) => ({ sourceRights: [{ sourceId: `ovdb:fixture-server/${database}/Customer`, source: { serverId: 'fixture-server', databaseId: database, recordset: 'Customer' }, declaration: { text: 'Fixture reuse terms' }, declarationScope: 'server', declaredAt: { serverId: 'fixture-server' }, evidenceOrigin: 'server-declared', pins: [], transformations: [] }], usedSourceIds: [`ovdb:fixture-server/${database}/Customer`] });
    run.mockImplementation(async ({ queryId }: { queryId: string }) => ({ ...fixtureTerms(queryId.endsWith('/n') ? 'northwind' : 'chinook'), nativeDirect: true, ordinaryComplete: true, totalRows: 1, hasMore: false, truncated: false, limitations: [], bindingsApplied: [], ordinarySources: [{ database: queryId.endsWith('/n') ? 'northwind' : 'chinook', collection: 'Customer' }], provenance: { source: `https://cloud.openvaultdb.com/v1/databases/${queryId.endsWith('/n') ? 'northwind' : 'chinook'} (direct OVDB)`, queryId, collection: 'Customer', mode: 'live', observedAt: '2026-10-21T00:00:00Z' }, recordset: { columns: [{ name: 'country', type: 'string' }, { name: 'customers', type: 'integer' }], rows: [[{ type: 'string', value: 'Canada' }, { type: 'integer', value: queryId.endsWith('/n') ? '3' : '8' }]] } }));
    // Seed via real session action and admission; no synthetic single-source saved board.
    const session = await TutorialBoardSession.open(board, 'independent-test');
    session.dispatch({ type: 'add-card', cardId: 'countries', initialSourceIds: ['northwind'] });
    const seeded = session.board.rows?.[0].cards?.[0].widget;
    if (!seeded) throw new Error('Missing seeded widget');
    const { readBoard } = configureShowcase(seeded);
    readBoard.mockReturnValue(of(board));
    getQuery.mockImplementation((_ref, id: string) => of({ id, title: id, request: { queryType: QueryType.TugQL, text: 'from: { name: Customer }' }, federation: { ovdbBaseUrl: 'https://cloud.openvaultdb.com', tables: [{ database: id.endsWith('/n') ? 'northwind' : 'chinook', name: 'Customer', fields: ['Country'] }] } }));
    const runtime = TestBed.inject(TutorialBoardRuntime);
    const ref = fixture.componentInstance.projectRef();
    if (!ref) throw new Error('Missing project reference');
    runtime.publish(ref, session, (action) => { session.dispatch(action); });
    fixture.componentRef.setInput('widgetDef', seeded);
    fixture.detectChanges();
    await vi.waitFor(() => {
      const children = fixture.debugElement.queryAll(By.directive(BoardWidgetComponent)).map((item) => item.componentInstance as BoardWidgetComponent);
      expect(run.mock.calls.length, JSON.stringify({ independent: fixture.componentInstance.independent(), controllers: fixture.componentInstance.sourceControllers().length, children: children.map((child) => ({ binding: child.sourceBindingId(), query: child.queryId(), executionOnly: child.executionOnly(), session: child.sessionOnly(), error: child.runError(), unsupported: child.unsupportedReason(), definition: child.definition()?.id })) })).toBe(1);
    });
    await fixture.whenStable();
    const before = fixture.componentInstance.sourceControllers()[0].state().snapshot;
    expect(before?.queryId).toBe('reports/n');
    expect(session.dispatch({ type: 'add-chart-source', cardId: 'countries', sourceId: 'chinook', queryId: 'reports/c' })).toBe(true);
    if (!ref) throw new Error('Missing project reference');
    runtime.publish(ref, session, (action) => { session.dispatch(action); });
    fixture.componentRef.setInput('widgetDef', session.board.rows?.[0].cards?.[0].widget);
    fixture.detectChanges();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    await fixture.whenStable();
    expect(fixture.componentInstance.sourceControllers()[0].state().snapshot).toBe(before);
    expect(run.mock.calls.map(([request]) => request.queryId)).toEqual(['reports/n', 'reports/c']);
    expect(fixture.nativeElement.textContent).toContain(data.title);
    expect(fixture.nativeElement.textContent).toContain('Declared unit: customer records');
    expect(fixture.nativeElement.textContent).toContain('Inspect chinook source rows and terms');
    expect(fixture.componentInstance.independentBars().data?.groups[0].observations.map((value) => value?.value)).toEqual([3, 8]);
    expect(readBoard).toHaveBeenCalledTimes(2);
    const children = fixture.debugElement.queryAll(By.directive(BoardWidgetComponent)).map((item) => item.componentInstance as BoardWidgetComponent);
    const second = children.find((child) => child.sourceBindingId() === 'chinook');
    if (!second) throw new Error('Missing second source controller');
    let complete: ((value: unknown) => void) | undefined;
    run.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const secondSnapshot = second.heldSnapshot();
    const pending = second.run();
    await vi.waitFor(() => expect(complete).toBeDefined());
    second.cancelSource();
    expect(second.running()).toBe(false);
    if (!complete) throw new Error('Missing pending completion');
    complete({ ...second.result() });
    await pending;
    expect(second.runError()).toContain('cancelled');
    expect(second.heldSnapshot()).toBe(secondSnapshot);
    if (!secondSnapshot) throw new Error('Missing source snapshot');
    run.mockResolvedValueOnce(secondSnapshot.result);
    await second.run();
    expect(second.runError()).toBeUndefined();
    // Inside a card the chart's own disclosure stays; only an exact repeat of the card title is dropped.
    fixture.componentRef.setInput('embedded', true);
    fixture.componentRef.setInput('cardTitle', 'Countries');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chart-disclosure')?.textContent).toBe(data.title);
    fixture.componentRef.setInput('cardTitle', data.title);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chart-disclosure')).toBeNull();
  });

});
