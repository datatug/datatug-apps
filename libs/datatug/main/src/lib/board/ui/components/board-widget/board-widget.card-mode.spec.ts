import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, of, throwError } from 'rxjs';
import type { BoardWidget } from '@datatug/board-models';
import { BoardPresentationSelection } from '../../../core/board-presentation-selection';
import { BoardQueryResults, PROJECT_CARD_RESULTS_OPTIONS } from '../../../core/board-query-results.service';
import { DatatugNavContextService } from '../../../../services/nav/datatug-nav-context.service';
import { QueriesService } from '../../../../queries/queries.service';
import { QueryDispatchService } from '../../../../queries/query-dispatch.service';
import { QueryType } from '../../../../models/definition/query-def';
import { BoardWidgetComponent } from './board-widget.component';

const ref = { storeId: 'localhost:8989', projectId: 'demo' };
const definition = {
  id: 'customers/by-id',
  title: 'Customer',
  request: { queryType: QueryType.SQL, text: 'select 1' },
  connectionId: 'c',
};
const customerRows = {
  recordset: {
    columns: [
      { name: 'Name', type: 'string' },
      { name: 'City', type: 'string' },
    ],
    rows: [
      [
        { type: 'string', value: 'Ann' },
        { type: 'string', value: 'Oslo' },
      ],
    ],
  },
  provenance: { source: 'test' },
  truncated: false,
};

describe('BoardWidgetComponent in card mode', () => {
  let fixture: ComponentFixture<BoardWidgetComponent>;
  const getQuery = vi.fn();
  const run = vi.fn();

  beforeEach(async () => {
    getQuery.mockReset().mockReturnValue(of(definition));
    run.mockReset().mockResolvedValue(customerRows);
    await TestBed.configureTestingModule({
      imports: [BoardWidgetComponent],
      providers: [
        BoardPresentationSelection,
        { provide: PLATFORM_ID, useValue: 'server' },
        provideRouter([]),
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: new BehaviorSubject(undefined),
            currentEnv: of(undefined),
          },
        },
        {
          provide: SneatAuthStateService,
          useValue: {
            authState: new BehaviorSubject({ status: 'notAuthenticated' }),
          },
        },
        { provide: QueriesService, useValue: { getQuery } },
        {
          provide: QueryDispatchService,
          useValue: {
            execute: run,
            executeHeld: async (...args: unknown[]) => ({
              result: await run(...args),
            }),
            runtimeRevision: signal(0).asReadonly(),
            availableWorkingCopies: async () => [],
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BoardWidgetComponent);
  });

  function render(
    widgetDef: BoardWidget,
    values: Record<string, unknown> = {},
  ): HTMLElement {
    fixture.componentRef.setInput('cardMode', true);
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('boardId', 'card:customer');
    fixture.componentRef.setInput('cardId', 'customer');
    fixture.componentRef.setInput('boardContext', {
      mode: 'view',
      parameters: Object.fromEntries(
        Object.entries(values).map(([id, value]) => [
          id,
          { type: 'string', value },
        ]),
      ),
    });
    fixture.componentRef.setInput('widgetDef', widgetDef);
    fixture.detectChanges();
    return fixture.nativeElement;
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await fixture.whenStable();
      await Promise.resolve();
      fixture.detectChanges();
    }
  }

  it('renders a text widget with placeholders substituted as plain text', async () => {
    const el = render(
      {
        name: 'text',
        data: { title: 'Notes', markdown: 'Hello {{who}} [x]({{who}})' },
      },
      { who: '](javascript:alert(1))' },
    );
    await settle();
    expect(el.textContent).toContain('Notes');
    expect(el.textContent).toContain('Hello ](javascript:alert(1))');
    expect(el.querySelector('a')).toBeNull();
  });

  it('renders a fields widget from a record parameter, picking and labelling columns', async () => {
    const el = render(
      {
        name: 'fields',
        data: {
          title: 'Customer',
          source: { parameter: 'row' },
          fields: [{ column: 'Name', label: 'Full name' }, { column: 'City' }],
        },
      },
      { row: { Name: 'Ann', City: 'Oslo', Secret: 'x' } },
    );
    await settle();
    const text = el.textContent ?? '';
    expect(text).toContain('Full name');
    expect(text).toContain('Ann');
    expect(text).toContain('City');
    expect(text).not.toContain('Secret');
  });

  it('says "No data" for a fields widget whose record parameter has no value', async () => {
    const el = render({
      name: 'fields',
      data: { source: { parameter: 'row' } },
    });
    await settle();
    expect(el.textContent).toContain('No data');
  });

  it('shows a skeleton while loading, then the first row of a saved query as fields', async () => {
    let release!: (value: unknown) => void;
    run.mockReturnValue(new Promise((r) => (release = r)));
    const el = render({
      name: 'fields',
      data: { source: { queryId: 'customers/by-id' } },
    });
    await settle();
    expect(el.querySelector('ion-skeleton-text')).not.toBeNull();
    release(customerRows);
    await settle();
    expect(el.querySelector('ion-skeleton-text')).toBeNull();
    expect(el.textContent).toContain('Ann');
    expect(el.textContent).toContain('Oslo');
    expect(run).toHaveBeenCalledOnce();
  });

  it('shows the error with a Retry that runs the query again', async () => {
    run.mockRejectedValueOnce(new Error('boom'));
    const el = render({
      name: 'SQL',
      data: { sql: { queryId: 'customers/by-id' } },
    });
    await settle();
    expect(el.querySelector('[role=alert]')?.textContent).toBeTruthy();
    const retry = [...el.querySelectorAll('ion-button')].find((b) =>
      b.textContent?.includes('Retry'),
    ) as HTMLElement;
    expect(retry).toBeTruthy();
    retry.click();
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[role=alert]')).toBeNull();
    expect(el.textContent).toContain('Ann');
  });

  const chartWidget: BoardWidget = {
    name: 'chart',
    data: {
      title: 'Customers by city',
      sources: [{ id: 'customers', queryId: 'customers/by-id' }],
      chart: { type: 'bar', categoryColumn: 'City', valueColumn: 'Name' },
    },
  };

  it('keeps Refresh chart and Open saved query in the chart body, without a duplicate title', async () => {
    run.mockResolvedValue({ ...customerRows, limitations: [] });
    fixture.componentRef.setInput('cardTitle', 'Customers by city');
    const el = render(chartWidget);
    await settle();
    expect(run).toHaveBeenCalledOnce();
    const buttons = [...el.querySelectorAll('.card-chart-actions ion-button')];
    const refresh = buttons.find((b) =>
      b.textContent?.includes('Refresh chart'),
    ) as HTMLElement;
    expect(refresh).toBeTruthy();
    const open = buttons.find((b) =>
      b.textContent?.includes('Open saved query'),
    );
    expect(open?.getAttribute('href')).toBe(
      '/store/localhost:8989/project/demo/query/customers%2Fby-id?id=customers%2Fby-id&runtime=project',
    );
    expect(el.querySelector('.chart-heading p')).toBeNull();
    refresh.click();
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('shows the chart title in the body when it differs from the card title', async () => {
    run.mockResolvedValue({ ...customerRows, limitations: [] });
    fixture.componentRef.setInput('cardTitle', 'Customer overview');
    const el = render(chartWidget);
    await settle();
    expect(el.querySelector('.chart-heading p')?.textContent).toContain(
      'Customers by city',
    );
  });

  it('does not repeat a SQL title that matches the card title', async () => {
    fixture.componentRef.setInput('cardTitle', 'Customer');
    const el = render({
      name: 'SQL',
      data: { title: 'Customer', sql: { queryId: 'customers/by-id' } },
    });
    await settle();
    expect(
      [...el.querySelectorAll('p')].some(
        (p) => p.textContent?.trim() === 'Customer',
      ),
    ).toBe(false);
  });

  it('shows "No data" for an empty result', async () => {
    run.mockResolvedValue({
      ...customerRows,
      recordset: { columns: customerRows.recordset.columns, rows: [] },
    });
    const el = render({
      name: 'SQL',
      data: { sql: { queryId: 'customers/by-id' } },
    });
    await settle();
    expect(el.textContent).toContain('No data');
  });

  it('shows "Query not found: <id>" when the saved query is missing', async () => {
    getQuery.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 404 })),
    );
    const el = render({
      name: 'SQL',
      data: { sql: { queryId: 'customers/gone' } },
    });
    await settle();
    expect(el.textContent).toContain('Query not found: customers/gone');
    expect(run).not.toHaveBeenCalled();
  });

  it('shows "Unsupported widget: <name>" for an unknown widget kind', async () => {
    const el = render({ name: 'carousel', data: {} });
    await settle();
    expect(el.textContent).toContain('Unsupported widget: carousel');
  });

  it('does not run on a board and never remembers a choice in card mode', async () => {
    render({ name: 'SQL', data: { sql: { queryId: 'customers/by-id' } } });
    await settle();
    expect(fixture.componentInstance.remembered()).toBe(false);
    expect(run).toHaveBeenCalledOnce();
  });

  it('binds a saved-query parameter to a card parameter', async () => {
    getQuery.mockReturnValue(
      of({
        ...definition,
        parameters: [{ id: 'id', type: 'string', isRequired: true }],
      }),
    );
    render(
      {
        name: 'fields',
        data: {
          source: {
            queryId: 'customers/by-id',
            parameters: [{ id: 'id', boardParameterId: 'customerId' }],
          },
        },
      },
      { customerId: 'ALFKI' },
    );
    await settle();
    expect(run).toHaveBeenCalledOnce();
    const request = run.mock.calls[0][0] as {
      parameters: Record<string, unknown>;
    };
    expect(request.parameters['id']).toEqual({ type: 'string', value: 'ALFKI' });
  });

  it('renders a recordset parameter as a grid without running any query', async () => {
    const el = render(
      {
        name: 'SQL',
        data: { title: 'Orders', source: { parameter: 'orders' } },
      },
      {
        orders: [
          { Id: 1, Total: 10 },
          { Id: 2, Total: 20 },
        ],
      },
    );
    await settle();
    expect(el.querySelectorAll('thead th').length).toBe(2);
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
    expect(el.textContent).toContain('Orders');
    expect(run).not.toHaveBeenCalled();
    expect(getQuery).not.toHaveBeenCalled();
  });

  it('shows No data for an empty recordset parameter', async () => {
    const el = render(
      { name: 'SQL', data: { source: { parameter: 'orders' } } },
      { orders: [] },
    );
    await settle();
    expect(el.textContent).toContain('No data');
  });

  it('does not share cached results across security contexts, execution targets or runtime bindings', async () => {
    getQuery.mockReturnValue(
      of({
        ...definition,
        parameters: [{ id: 'id', type: 'string', isRequired: true }],
      }),
    );
    const cache = new BoardQueryResults(PROJECT_CARD_RESULTS_OPTIONS);
    const widget: BoardWidget = {
      name: 'fields',
      data: {
        source: {
          queryId: 'customers/by-id',
          parameters: [{ id: 'id', boardParameterId: 'customerId' }],
        },
      },
    };
    const context = (extra: Record<string, unknown>) => ({
      mode: 'view',
      environment: 'LOCAL',
      parameters: { customerId: { type: 'string', value: 'ALFKI' } },
      ...extra,
    });
    fixture.componentRef.setInput('cardMode', true);
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('boardId', 'card:customer');
    fixture.componentRef.setInput('cardId', 'customer');
    fixture.componentRef.setInput('resultCache', cache);
    fixture.componentRef.setInput('widgetDef', widget);
    const show = async (extra: Record<string, unknown>) => {
      fixture.componentRef.setInput('boardContext', context(extra));
      fixture.detectChanges();
      await settle();
    };
    await show({ securityContextId: 'ctx-1' });
    expect(run).toHaveBeenCalledTimes(1);
    await show({ securityContextId: 'ctx-2' });
    expect(run).toHaveBeenCalledTimes(2);
    await show({ securityContextId: 'ctx-2', executionTarget: { kind: 'hosted-cloud' } });
    expect(run).toHaveBeenCalledTimes(3);
    await show({ securityContextId: 'ctx-2', executionTarget: { kind: 'hosted-cloud' }, runtimeBinding: { id: 'rb' } });
    expect(run).toHaveBeenCalledTimes(4);
    // back to the first context: its result is still cached
    await show({ securityContextId: 'ctx-1' });
    expect(run).toHaveBeenCalledTimes(4);
  });
});
