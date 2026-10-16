import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterLink } from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { of } from 'rxjs';
import { QueriesService } from '../../../../queries/queries.service';
import { PublicSqliteQueryService } from '../../../../queries/public-sqlite-query.service';
import { QueryType } from '../../../../models/definition/query-def';

import { BoardWidgetComponent } from './board-widget.component';

describe('BoardWidgetComponent', () => {
  let fixture: ComponentFixture<BoardWidgetComponent>;
  let router: Router;
  const getQuery = vi.fn();
  const run = vi.fn();

  beforeEach(async () => {
    getQuery.mockReset();
    run.mockReset();
    await TestBed.configureTestingModule({
      imports: [BoardWidgetComponent],
      providers: [
        provideRouter([]),
        {
          provide: SneatAuthStateService,
          useValue: { authState: of({ status: 'notAuthenticated' }) },
        },
        { provide: QueriesService, useValue: { getQuery } },
        { provide: PublicSqliteQueryService, useValue: { run } },
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

    expect(renderedQueryLink()).toBe(
      '/project/github.com/o/r/tree/feature/-/query/demodb%2Fq?projectApi=cloud&branch=feature&id=demodb%2Fq',
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

  it('re-reads board and query before rendering a real result and remembers the choice', async () => {
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
    expect(fixture.nativeElement.textContent).toContain('1 rows returned');
    expect(fixture.nativeElement.textContent).toContain('42');
    expect(fixture.nativeElement.textContent).toContain(
      'Last selected from this board in this browser',
    );
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
      expect.objectContaining({ projectId: 'r@o@@feature/demo' }),
      expect.anything(),
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
});
