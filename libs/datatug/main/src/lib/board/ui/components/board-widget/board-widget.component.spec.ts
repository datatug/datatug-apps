import { CUSTOM_ELEMENTS_SCHEMA, PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterLink } from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { Board, BoardWidget } from '@datatug/board-models';
import { BarRaceChartComponent, type BarRaceChartViews } from '@datatug/charts';
import {
  executeSavedPublicChartQuery,
  executeSavedPublicInspectQuery,
} from '../../../../queries/public-data/public-chart-query';
import { HeldResultPresentationComponent } from '../held-result-presentation/held-result-presentation.component';

vi.mock('../../../../queries/public-data/public-chart-query', () => ({
  isSavedPublicChartQueryId: (id: string) =>
    [
      'demodb/northwind-orders-full-sqlite',
      'demodb/northwind-shipping-country-count-sqlite',
    ].includes(id),
  isSavedPublicInspectQueryId: (id: string) =>
    id === 'demodb/northwind-shipping-country-count-postgresql',
  executeSavedPublicChartQuery: vi.fn(),
  executeSavedPublicInspectQuery: vi.fn(),
}));
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
  let authState: BehaviorSubject<{
    status: 'notAuthenticated' | 'authenticated';
    user?: { uid: string };
  }>;

  beforeEach(async () => {
    getQuery.mockReset();
    run.mockReset();
    vi.mocked(executeSavedPublicChartQuery).mockReset();
    vi.mocked(executeSavedPublicInspectQuery).mockReset();
    availableWorkingCopies.mockReset().mockResolvedValue([]);
    runtimeRevision = signal(0);
    authState = new BehaviorSubject<{
      status: 'notAuthenticated' | 'authenticated';
      user?: { uid: string };
    }>({ status: 'notAuthenticated' });
    await TestBed.configureTestingModule({
      imports: [BoardWidgetComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        provideRouter([]),
        {
          provide: SneatAuthStateService,
          useValue: { authState: authState.asObservable() },
        },
        { provide: QueriesService, useValue: { getQuery } },
        {
          provide: QueryDispatchService,
          useValue: {
            execute: run,
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
      '/project/github.com/o/r/tree/v1.0.0/-/query/demodb%2Fchinook-top-customer-spend?id=demodb%2Fchinook-top-customer-spend',
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
      '/project/github.com/o/r/tree/feature/-/query/demodb%2Fq?projectApi=cloud&branch=feature&id=demodb%2Fq&env=dev',
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
    expect(fixture.nativeElement.textContent).toContain('Run on board');
    await fixture.componentInstance.run();
    fixture.detectChanges();
    expect(readBoard).toHaveBeenCalledWith(ref, 'board1');
    expect(getQuery).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(1);
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
      }),
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
          queryType: QueryType.DTQL,
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
        }),
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
          queryType: QueryType.DTQL,
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
        expect.objectContaining({ runtimeSelectionId: 'runtime-17' }),
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
      'To be implemented: HTTP',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Run on board');
    const tabs = fixture.debugElement.query(By.directive(TabsWidgetComponent))
      .componentInstance as TabsWidgetComponent;
    tabs.select('id:grid');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain(
      'To be implemented: HTTP',
    );
    expect(fixture.nativeElement.textContent).toContain('Run on board');
    expect(tabs.activePath()).toEqual(['id:grid']);
  });

  it('does not persist saved-query choices in tutorial mode', async () => {
    const ref = { storeId: 'github.com', projectId: 'r@o@@v1.0.0' };
    const queryId = 'demodb/chinook-top-customer-spend';
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'top');
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId } },
    });
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
    fixture.detectChanges();
    await router.navigateByUrl('/?mode=tutorial');
    fixture.detectChanges();
    expect(fixture.componentInstance.sessionOnly()).toBe(true);
    const save = vi.spyOn(fixture.componentInstance.choices, 'selectQuery');
    fixture.componentInstance.rememberChoice();
    run.mockResolvedValue({
      recordset: { columns: [], rows: [] },
      truncated: false,
      provenance: { source: 'test' },
    });
    await fixture.componentInstance.run();
    expect(save).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'Choices stay in this tutorial session.',
    );
  });

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
      }),
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
    expect(fixture.nativeElement.textContent).toContain('Open saved query');
    expect(fixture.nativeElement.textContent).not.toContain('Run on board');
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
  const publicQueryId = 'demodb/northwind-shipping-country-count-sqlite';
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
      request: { queryType: QueryType.DTQL, text: 'saved DTQL' },
    };
    getQuery.mockReturnValue(of(definition));
    const board = {
      id: 'showcase',
      title: 'Showcase',
      rows: [{ cards: [{ id: 'countries', widget }] }],
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
    return {
      runtime: 'browser-public-api' as const,
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
      sourceRights: [],
      usedSourceIds: [],
      provenance: {
        source: 'northwind',
        collection: 'Orders',
        queryId: publicQueryId,
        mode: 'live' as const,
        observedAt: '2026-10-16T14:00:00Z',
        endpoint: 'https://demodb.dev/ovdb/v1/databases/northwind/dtql',
        databaseId: 'northwind',
      },
      publicApiReceipt: {
        endpoint: 'https://demodb.dev/ovdb/v1/databases/northwind/dtql',
        serverId: 'https://demodb.dev/ovdb',
        databaseId: 'northwind',
        logicalCollection: 'Orders',
        collectionId: 'Orders',
        queryId: publicQueryId,
        rowsReturned: 1,
        observedAt: '2026-10-16T14:00:00Z',
        sourceVerification: {
          kind: 'execution-source' as const,
          executionSources: [{ database: 'northwind', collection: 'Orders' }],
        },
      },
    };
  }

  it('automatically executes a visible saved showcase chart once and switches held chart/grid without fetching', async () => {
    const { readBoard } = configureShowcase();
    vi.mocked(executeSavedPublicChartQuery).mockResolvedValue(countryResult());
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.running()).toBe(false),
    );
    await vi.waitFor(() =>
      expect(executeSavedPublicChartQuery).toHaveBeenCalledTimes(1),
    );
    await fixture.whenStable();
    expect(readBoard).toHaveBeenCalledTimes(1);
    expect(executeSavedPublicChartQuery).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    const held = fixture.debugElement.query(
      By.directive(HeldResultPresentationComponent),
    ).componentInstance as HeldResultPresentationComponent;
    expect(held.bars[0].category).toBe('France');
    held.view.set('grid');
    fixture.detectChanges();
    held.view.set('chart');
    fixture.detectChanges();
    expect(executeSavedPublicChartQuery).toHaveBeenCalledTimes(1);
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
    expect(executeSavedPublicChartQuery).not.toHaveBeenCalled();
    expect(fixture.componentInstance.runError()).toContain(
      'This board card changed.',
    );
  });

  it('aborts a stale public chart and ignores its late completion after environment changes', async () => {
    configureShowcase();
    let finish!: (result: ReturnType<typeof countryResult>) => void;
    vi.mocked(executeSavedPublicChartQuery).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(executeSavedPublicChartQuery).toHaveBeenCalledTimes(1),
    );
    const signal = vi.mocked(executeSavedPublicChartQuery).mock.calls[0][2]
      ?.signal;
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
    vi.mocked(executeSavedPublicChartQuery).mockResolvedValue(countryResult());
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(executeSavedPublicChartQuery).toHaveBeenCalledTimes(1),
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
    expect(executeSavedPublicChartQuery).toHaveBeenCalledTimes(1);
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
    expect(executeSavedPublicChartQuery).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
  it('uses the verified public API when the selected environment has a browser default target', async () => {
    configureShowcase();
    fixture.componentRef.setInput('boardContext', {
      environment: 'dev',
      executionTarget: { kind: 'browser-sqlite' },
    });
    vi.mocked(executeSavedPublicChartQuery).mockResolvedValue(countryResult());
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(executeSavedPublicChartQuery).toHaveBeenCalledTimes(1),
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects an incompatible explicit target without silently dispatching a public chart elsewhere', async () => {
    configureShowcase();
    fixture.componentRef.setInput('boardContext', {
      environment: 'dev',
      executionTarget: { kind: 'hosted-cloud' },
    });
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.runError()).toContain(
        'requires the public API runtime',
      ),
    );
    expect(executeSavedPublicChartQuery).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the PostgreSQL inspector independently with no SQLite rights or bar controls', async () => {
    const queryId = 'demodb/northwind-shipping-country-count-postgresql';
    configureShowcase({ name: 'SQL', data: { sql: { queryId } } });
    getQuery.mockReturnValue(
      of({
        id: queryId,
        title: 'PostgreSQL countries',
        connectionId: 'northwind-postgresql',
        request: { queryType: QueryType.DTQL, text: 'saved postgres DTQL' },
      }),
    );
    vi.mocked(executeSavedPublicInspectQuery).mockResolvedValue({
      ...countryResult(),
      sourceRights: [],
      usedSourceIds: ['postgresql-orders'],
      rightsStatus: 'unavailable',
      rightsUnavailableReason:
        'No verified publisher source rights are available for this PostgreSQL result.',
    });
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(executeSavedPublicInspectQuery).toHaveBeenCalledTimes(1),
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
      'Source usage rights are unavailable',
    );
    expect(executeSavedPublicChartQuery).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps the same race instance and playback choices across chart/source row switches', async () => {
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
    vi.mocked(executeSavedPublicChartQuery).mockResolvedValue(countryResult());
    fixture.detectChanges();
    const chart = fixture.debugElement.query(
      By.directive(BarRaceChartComponent),
    ).componentInstance as BarRaceChartComponent;
    expect(chart.mode()).toBe('cumulative');
    expect(chart.topN()).toBe(15);
    chart.next();
    chart.topN.set(7);
    fixture.componentInstance.chartView.set('grid');
    fixture.detectChanges();
    expect(chart.active).toBe(false);
    fixture.componentInstance.chartView.set('chart');
    fixture.detectChanges();
    expect(
      fixture.debugElement.query(By.directive(BarRaceChartComponent))
        .componentInstance,
    ).toBe(chart);
    expect(chart.frameIndex()).toBe(1);
    expect(chart.mode()).toBe('cumulative');
    expect(chart.topN()).toBe(7);
    await vi.waitFor(() =>
      expect(executeSavedPublicChartQuery).toHaveBeenCalledTimes(1),
    );
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
      }),
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
      expect(executeSavedPublicChartQuery).not.toHaveBeenCalled();
      expect(fixture.componentInstance.runError()).toBeTruthy();
    },
  );

  it('rejects parameterized pinned public execution before requesting an unbound query', async () => {
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
        request: { queryType: QueryType.DTQL, text: 'saved DTQL' },
        parameters: [{ id: 'limit', type: 'integer' }],
      }),
    );
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.runError()).toContain(
        'does not support chart parameter bindings',
      ),
    );
    expect(executeSavedPublicChartQuery).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
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
});
