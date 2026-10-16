import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterLink } from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { Board } from '@datatug/board-models';
import { QueriesService } from '../../../../queries/queries.service';
import { QueryDispatchService } from '../../../../queries/query-dispatch.service';
import { QueryDispatchError } from '../../../../queries/query-dispatch';
import { QueryType } from '../../../../models/definition/query-def';

import { BoardWidgetComponent } from './board-widget.component';
import { QualifiedLocalReadVersionError } from '../../../../services/project/project-query-api.service';

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
  const availableWorkingCopies = vi.fn(async () => [] as { selectionId: string; title: string }[]);
  let runtimeRevision = signal(0);
  let authState: BehaviorSubject<{
    status: 'notAuthenticated' | 'authenticated';
    user?: { uid: string };
  }>;

  beforeEach(async () => {
    getQuery.mockReset();
    run.mockReset();
    availableWorkingCopies.mockReset().mockResolvedValue([]);
    runtimeRevision = signal(0);
    authState = new BehaviorSubject<{
      status: 'notAuthenticated' | 'authenticated';
      user?: { uid: string };
    }>({ status: 'notAuthenticated' });
    await TestBed.configureTestingModule({
      imports: [BoardWidgetComponent],
      providers: [
        provideRouter([]),
        {
          provide: SneatAuthStateService,
          useValue: { authState: authState.asObservable() },
        },
        { provide: QueriesService, useValue: { getQuery } },
        { provide: QueryDispatchService, useValue: {
          execute: run, runtimeRevision: runtimeRevision.asReadonly(),
          availableWorkingCopies,
        } },
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
    getQuery.mockReturnValue(of({
      id: queryId,
      title: 'Active accounts',
      request: { queryType: QueryType.SQL, text: 'select count(*) from account' },
      connectionId: 'customer-ledger-v2',
    }));
    run.mockResolvedValue({
      recordset: { columns: [{ name: 'count', type: 'integer' }], rows: [[{ type: 'integer', value: '3' }]] },
      provenance: { source: 'test fixture' },
      truncated: false,
    });
    const ref = { storeId: 'github.com', projectId: 'r@o@@main' };
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'ledger');
    fixture.componentRef.setInput('readBoardForRun', () => of({
      id: 'board1', title: 'Board', rows: [{ cards: [{ id: 'ledger', widget: { name: 'SQL', data: { sql: { queryId } } } }] }],
    }));
    fixture.componentRef.setInput('widgetDef', { name: 'SQL', data: { sql: { queryId } } });
    fixture.detectChanges();

    await fixture.componentInstance.run();

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      projectRef: ref,
      definition: expect.objectContaining({ connectionId: 'customer-ledger-v2' }),
    }));
  });

  it('dispatches a structured card to an explicitly selected open working copy and fences a changed choice', async () => {
    const queryId = 'reports/customers';
    const ref = { storeId: 'github.com', projectId: 'r@o@@main' };
    getQuery.mockReturnValue(of({
      id: queryId, title: 'Customers', connectionId: 'logical-ledger-v7',
      request: { queryType: QueryType.DTQL, text: 'from:\n  name: "customers"\nlimit: 10\n' },
    }));
    availableWorkingCopies.mockResolvedValue([{ selectionId: 'runtime-17', title: 'Edited copy' }]);
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'customers');
    fixture.componentRef.setInput('readBoardForRun', () => of({
      id: 'board1', title: 'Board', rows: [{ cards: [{ id: 'customers', widget: { name: 'SQL', data: { sql: { queryId } } } }] }],
    }));
    fixture.componentRef.setInput('widgetDef', { name: 'SQL', data: { sql: { queryId } } });
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Edited copy');
    fixture.componentInstance.selectRuntime('runtime-17');
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    let complete!: (result: unknown) => void;
    run.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const pending = fixture.componentInstance.run();
    await vi.waitFor(() => expect(run).toHaveBeenCalledWith(expect.objectContaining({
      projectRef: ref, queryId, runtimeSelectionId: 'runtime-17',
      definition: expect.objectContaining({ connectionId: 'logical-ledger-v7' }),
    })));
    fixture.componentInstance.selectRuntime('snapshot');
    complete({ recordset: { columns: [], rows: [] }, truncated: false });
    await pending;
    fixture.detectChanges();
    expect(fixture.componentInstance.result()).toBeUndefined();
  });

  it('closes a selected working-copy option and fences its in-flight result on registry revision', async () => {
    const queryId = 'reports/customers';
    const ref = { storeId: 'github.com', projectId: 'r@o@@main' };
    getQuery.mockReturnValue(of({
      id: queryId, title: 'Customers', connectionId: 'logical-ledger-v7',
      request: { queryType: QueryType.DTQL, text: 'from:\n  name: "customers"\nlimit: 10\n' },
    }));
    availableWorkingCopies.mockResolvedValue([{ selectionId: 'runtime-17', title: 'Edited copy' }]);
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('boardId', 'board1');
    fixture.componentRef.setInput('cardId', 'customers');
    fixture.componentRef.setInput('readBoardForRun', () => of({
      id: 'board1', title: 'Board', rows: [{ cards: [{ id: 'customers', widget: { name: 'SQL', data: { sql: { queryId } } } }] }],
    }));
    fixture.componentRef.setInput('widgetDef', { name: 'SQL', data: { sql: { queryId } } });
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    fixture.componentInstance.selectRuntime('runtime-17');
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    let complete!: (value: unknown) => void;
    run.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const pending = fixture.componentInstance.run();
    await vi.waitFor(() => expect(run).toHaveBeenCalledWith(expect.objectContaining({ runtimeSelectionId: 'runtime-17' })));
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
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      projectRef: expect.objectContaining({ projectId: 'r@o@', branch: 'feature/demo' }),
      queryId,
    }));
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

    run.mockRejectedValueOnce(new QueryDispatchError('The query exceeds the 1,000-row browser limit.'));
    await fixture.componentInstance.run();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('The query exceeds the 1,000-row browser limit.');
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
});
