import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ResultsGridComponent } from '../../components/results-grid/results-grid.component';
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { DATATUG_AGENT_BASE_URL } from '@sneat/datatug-semantic';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  QueryResultPageComponent,
  isLoopbackStore,
  rerunErrorText,
} from './query-result.page';
import { DatatugNavContextService } from '../../services/nav/datatug-nav-context.service';
import { ProjectService } from '../../services/project/project.service';
import { ROW_MARKER, invoiceCustomerResult } from './query-result.spec-helper';

/** The shared results grid as the page drives it (the grid itself does not render in this test environment). */
@Component({
  selector: 'sneat-datatug-results-grid',
  template: '<div data-testid="grid-stub"></div>',
})
class GridStubComponent {
  readonly columnDefs = input<unknown>();
  readonly rowData = input<unknown>();
  readonly snapshotKey = input<unknown>();
  readonly analyticsScope = input<unknown>();
  readonly exportName = input<unknown>();
  readonly rowClicked = output<unknown>();
}

const STORE = 'http-127.0.0.1:8989';
const AGENT = 'http://127.0.0.1:8989/datatug';
const AGENT_INFO = {
  version: 'v0.94.0',
  principal: { id: 'me', roles: [], groups: [] },
  securityContextId: 'sc-7',
  projects: [{ id: 'demo' }],
  capabilities: { protectedQueries: true, opaqueReadOnly: false },
};

function routeStub(resultId: string, query: Record<string, string>) {
  const root = {
    paramMap: convertToParamMap({}),
    queryParamMap: convertToParamMap({}),
  };
  const store = {
    paramMap: convertToParamMap({ storeId: STORE }),
    queryParamMap: convertToParamMap({}),
  };
  const snapshot = {
    paramMap: convertToParamMap({ resultId }),
    queryParamMap: convertToParamMap(query),
    pathFromRoot: [] as unknown[],
  };
  snapshot.pathFromRoot = [root, store, snapshot];
  return {
    snapshot,
    paramMap: new BehaviorSubject(snapshot.paramMap),
    queryParamMap: new BehaviorSubject(convertToParamMap(query)),
  };
}

interface Mounted {
  fixture: ComponentFixture<QueryResultPageComponent>;
  page: QueryResultPageComponent;
  ctrl: HttpTestingController;
  route: ReturnType<typeof routeStub>;
  navigate: ReturnType<typeof vi.fn>;
  selectResultProject: ReturnType<typeof vi.fn>;
  getSummary: ReturnType<typeof vi.fn>;
  el: () => HTMLElement;
  text: () => string;
  render: () => Promise<void>;
}

/** What the agent answers for the project of the result: its summary, nothing, or a failure. */
type ProjectAnswer = Observable<unknown>;
const KNOWN_PROJECT: ProjectAnswer = of({
  id: 'demo',
  environments: [{ id: 'local' }],
});

function mount(
  resultId: string,
  query: Record<string, string> = {},
  project: ProjectAnswer = KNOWN_PROJECT,
): Mounted {
  const route = routeStub(resultId, query);
  const selectResultProject = vi.fn();
  const getSummary = vi.fn(() => project);
  TestBed.configureTestingModule({
    imports: [QueryResultPageComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: DATATUG_AGENT_BASE_URL, useValue: AGENT },
      { provide: ActivatedRoute, useValue: route },
      { provide: DatatugNavContextService, useValue: { selectResultProject } },
      { provide: ProjectService, useValue: { getSummary } },
    ],
  });
  TestBed.overrideComponent(QueryResultPageComponent, {
    remove: { imports: [ResultsGridComponent] },
    add: { imports: [GridStubComponent] },
  });
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;
  const fixture = TestBed.createComponent(QueryResultPageComponent);
  fixture.detectChanges();
  const el = () => fixture.nativeElement as HTMLElement;
  return {
    fixture,
    page: fixture.componentInstance,
    ctrl: TestBed.inject(HttpTestingController),
    route,
    navigate,
    selectResultProject,
    getSummary,
    el,
    text: () => el().textContent ?? '',
    render: async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    },
  };
}

/** Answers the page's one read of the result. */
function answer(m: Mounted, body: object = invoiceCustomerResult()): void {
  const req = m.ctrl.expectOne(`${AGENT}/results/t4`);
  expect(req.request.method).toBe('GET');
  expect(req.request.body).toBeNull();
  req.flush(body);
}

function setQuery(m: Mounted, query: Record<string, string>): void {
  m.route.snapshot.queryParamMap = convertToParamMap(query);
  m.route.queryParamMap.next(convertToParamMap(query));
}

const problem = (m: Mounted) =>
  m
    .el()
    .querySelector('[data-testid="link-problem"]')
    ?.getAttribute('data-problem');

describe('QueryResultPageComponent', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  it('reads the result once and shows its rows in the Table view by default', async () => {
    const m = mount('t4');
    answer(m);
    await m.render();
    expect(m.el().querySelector('[data-testid="result-table"]')).not.toBeNull();
    expect(m.page.gridColumns().map((c) => c.headerName)).toEqual([
      'InvoiceId',
      'CustomerId',
      'FirstName',
    ]);
    expect(m.page.gridRows()[0]).toEqual({
      c0: '9007199254740993',
      c1: '2',
      c2: ROW_MARKER,
    });
    expect(m.text()).toContain('2 saved rows');
    expect(m.text()).toContain('more rows exist');
    // The grid remembers its layout under a key of ids only: the project and the stored result.
    expect(m.page.gridStateKey()).toMatch(
      /^datatug\.grid\.v1:demo:t4:result$/,
    );
  });

  it('selects the project of the result as the current one, with its environment', async () => {
    const m = mount('t4');
    answer(m);
    await m.render();
    expect(m.getSummary).toHaveBeenCalledWith({
      projectId: 'demo',
      storeId: STORE,
    });
    // With no history, Back goes to the project of the result.
    expect(m.page.backHref()).toBe(`/store/${STORE}/project/demo`);
    expect(m.selectResultProject).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ ref: { projectId: 'demo', storeId: STORE } }),
      'local',
    );
  });

  it('selects the project without an environment the project does not have', async () => {
    const m = mount('t4', {}, of({ id: 'demo', environments: [] }));
    answer(m);
    await m.render();
    expect(m.selectResultProject).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ ref: { projectId: 'demo', storeId: STORE } }),
      undefined,
    );
  });

  it('selects the environment of the result when the agent lists no environments to check it against', async () => {
    const m = mount('t4', {}, of({ id: 'demo' }));
    answer(m);
    await m.render();
    expect(m.selectResultProject).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ ref: { projectId: 'demo', storeId: STORE } }),
      'local',
    );
  });

  it.each([
    [
      'a project the agent does not know (error)',
      () => throwError(() => new Error('404')),
    ],
    ['a project with no summary', () => of(undefined)],
  ])(
    'selects no project for %s, and the result still shows',
    async (_n, answerOf) => {
      const m = mount('t4', {}, answerOf());
      answer(m);
      await m.render();
      expect(m.selectResultProject).toHaveBeenLastCalledWith(
        expect.any(String),
      );
      expect(
        m.el().querySelector('[data-testid="result-table"]'),
      ).not.toBeNull();
    },
  );

  it('selects no project, and asks the agent for none, for a database outside any project', async () => {
    const m = mount('t4');
    answer(
      m,
      invoiceCustomerResult({
        db: { ref: null, project: null, env: null, source: null },
      }),
    );
    await m.render();
    expect(m.getSummary).not.toHaveBeenCalled();
    expect(m.selectResultProject).toHaveBeenLastCalledWith(expect.any(String));
  });

  it('clears the project when the result cannot be read', async () => {
    const m = mount('t4');
    m.ctrl
      .expectOne(`${AGENT}/results/t4`)
      .flush({}, { status: 404, statusText: 'Not Found' });
    await m.render();
    expect(m.getSummary).not.toHaveBeenCalled();
    expect(m.selectResultProject).toHaveBeenLastCalledWith(expect.any(String));
  });

  it('shows the row of the address in the Record view and moves by position', async () => {
    const m = mount('t4', { view: 'record', row: '2' });
    answer(m);
    await m.render();
    // Ionic's elements hide their light DOM from textContent here; plain elements inside them do not.
    const values = [
      ...m.el().querySelectorAll('.author-current-row-value'),
    ].map((f) => f.textContent);
    expect(values).toEqual(['2', '4', 'second-row']);
    expect(
      m.el().querySelector('[data-testid="author-current-row"] p')?.textContent,
    ).toContain('Position 2');
    // The record view offers no filter: there is no query here to filter.
    expect(m.el().querySelector('[aria-label$="as filter"]')).toBeNull();
    m.page.selectRow(1);
    expect(m.page.row()).toBe(1);
    expect(m.navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { row: '1' }, replaceUrl: true }),
    );
    m.page.selectRow(99);
    expect(m.page.row()).toBe(2);
  });

  describe('the Table view is the query editor', () => {
    it('replaces the page by the editor of the project, opened from this result, when the address names the table', async () => {
      const m = mount('t4', { view: 'table' });
      answer(m);
      await m.render();
      expect(m.navigate).toHaveBeenCalledOnce();
      const [commands, extras] = m.navigate.mock.calls[0] as [string[], Record<string, unknown>];
      expect(commands.join('/')).toContain('project');
      expect(commands.join('/')).toMatch(/\/query$/);
      expect(commands.join('/')).toContain(encodeURIComponent('demo'));
      // no history entry, so Back goes where it went before; the id travels as the one `result` parameter
      expect(extras).toEqual({ queryParams: { result: 't4' }, replaceUrl: true });
    });

    it('stays on the page for the other views, for an address without a view, and for a project the agent does not know', async () => {
      for (const query of [{ view: 'record' }, { view: 'columns' }, { view: 'sources' }, {}] as Record<string, string>[]) {
        const m = mount('t4', query);
        answer(m);
        await m.render();
        expect(m.navigate).not.toHaveBeenCalled();
        TestBed.inject(HttpTestingController).verify();
        TestBed.resetTestingModule();
      }
      const unknown = mount('t4', { view: 'table' }, of(undefined));
      answer(unknown);
      await unknown.render();
      expect(unknown.navigate).not.toHaveBeenCalled();
      expect(unknown.el().querySelector('[data-testid="result-table"]')).not.toBeNull();
    });

    // https://github.com/datatug/datatug-apps/issues/411: the read-only grid used to be drawn, then destroyed ~0.4 s
    // later when the project lookup answered and the page was replaced by the editor, which lost a selection, a
    // resized column or a sort made in that window.
    describe('the read-only grid is not drawn only to be replaced', () => {
      const grid = (m: Mounted) => m.el().querySelector('[data-testid="result-table"]');
      const opening = (m: Mounted) => m.el().querySelector('[data-testid="result-opening-editor"]');

      it('waits for the project lookup instead of drawing the grid, and never draws it when the editor opens', async () => {
        const lookup = new Subject<unknown>();
        const m = mount('t4', { view: 'table' }, lookup);
        answer(m);
        await m.render();
        expect(grid(m)).toBeNull();
        expect(opening(m)).not.toBeNull();
        expect(m.navigate).not.toHaveBeenCalled();
        lookup.next({ id: 'demo', environments: [{ id: 'local' }] });
        await m.render();
        expect(m.navigate).toHaveBeenCalledOnce();
        expect(grid(m)).toBeNull();
      });

      it('draws the grid at once when the agent does not know the project', async () => {
        const lookup = new Subject<unknown>();
        const m = mount('t4', { view: 'table' }, lookup);
        answer(m);
        await m.render();
        expect(grid(m)).toBeNull();
        lookup.next(undefined);
        await m.render();
        expect(grid(m)).not.toBeNull();
        expect(opening(m)).toBeNull();
        expect(m.navigate).not.toHaveBeenCalled();
      });

      it('draws the grid when the lookup fails', async () => {
        const lookup = new Subject<unknown>();
        const m = mount('t4', { view: 'table' }, lookup);
        answer(m);
        await m.render();
        lookup.error(new Error('down'));
        await m.render();
        expect(grid(m)).not.toBeNull();
      });

      it('draws the grid when the editor cannot be opened', async () => {
        const m = mount('t4', { view: 'table' });
        m.navigate.mockResolvedValue(false);
        answer(m);
        await m.render();
        await new Promise((resolve) => setTimeout(resolve));
        await m.render();
        expect(m.navigate).toHaveBeenCalledOnce();
        expect(grid(m)).not.toBeNull();
      });

      it('draws the grid when the lookup takes too long', async () => {
        vi.useFakeTimers();
        try {
          const m = mount('t4', { view: 'table' }, new Subject<unknown>());
          answer(m);
          m.fixture.detectChanges();
          expect(grid(m)).toBeNull();
          vi.advanceTimersByTime(3001);
          m.fixture.detectChanges();
          expect(grid(m)).not.toBeNull();
        } finally {
          vi.useRealTimers();
        }
      });

      it('draws the grid at once for an address that does not ask for the table, with no wait for the lookup', async () => {
        const m = mount('t4', {}, new Subject<unknown>());
        answer(m);
        await m.render();
        expect(grid(m)).not.toBeNull();
        expect(opening(m)).toBeNull();
      });
    });

    it('also leaves for the editor when the Table view is picked later', async () => {
      const m = mount('t4', { view: 'record' });
      answer(m);
      await m.render();
      expect(m.navigate).not.toHaveBeenCalled();
      setQuery(m, { view: 'table' });
      expect(m.navigate).toHaveBeenCalledOnce();
      expect(m.navigate.mock.calls[0][1]).toEqual({ queryParams: { result: 't4' }, replaceUrl: true });
    });
  });

  it('selects a row from the table by its position', async () => {
    const m = mount('t4');
    answer(m);
    await m.render();
    const rows = m.page.gridRows();
    // The position is the row's place in the saved rows, whatever its place on a sorted or filtered screen.
    m.page.gridRowClicked({ data: rows[1], rowIndex: 0 } as never);
    expect(m.page.row()).toBe(2);
    m.page.gridRowClicked({ data: undefined, rowIndex: 0 } as never);
    expect(m.page.row()).toBe(2);
    m.page.gridRowClicked({ data: { c0: 'other' }, rowIndex: 1 } as never);
    expect(m.page.row()).toBe(2);
    m.page.gridRowClicked({ data: rows[0], rowIndex: 1 } as never);
    expect(m.page.row()).toBe(1);
  });

  it('lists the sources, each name opening its table and records pages', async () => {
    const m = mount('t4', { view: 'sources' });
    answer(m);
    await m.render();
    const links = [
      ...m
        .el()
        .querySelectorAll(
          '[data-testid="result-source"] [data-testid="result-table-link"]',
        ),
    ];
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      'Invoice',
      'Customer',
    ]);
    expect(links[1].getAttribute('href')).toBe(
      `/store/${STORE}/project/demo/env/local/db/chinook/table/Customer?schema=`,
    );
    const records = m
      .el()
      .querySelectorAll('[data-testid="result-records-link"]');
    expect(records[1].getAttribute('href')).toBe(
      `/store/${STORE}/project/demo/env/local/db/chinook/table/Customer/records?schema=`,
    );
    expect(m.text()).toContain('inner on i.CustomerId = c.CustomerId');
  });

  it('lists every related table with its join columns and cardinality', async () => {
    const m = mount('t4', { view: 'related' });
    answer(m);
    await m.render();
    const rows = [
      ...m.el().querySelectorAll('[data-testid="result-related-row"]'),
    ].map((r) => r.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('InvoiceLine');
    expect(rows[0]).toContain('i.InvoiceId = InvoiceLine.InvoiceId');
    expect(rows[0]).toContain('one-to-many');
    expect(rows[1]).toContain('many-to-one');
  });

  it('says No related tables found, with the reason, when there are none', async () => {
    const m = mount('t4', { view: 'related' });
    answer(
      m,
      invoiceCustomerResult({
        meta: {
          related: [],
          unavailable: { related: 'no-relationship-metadata' },
        },
      }),
    );
    await m.render();
    expect(
      m.el().querySelector('[data-testid="result-no-related"]')?.textContent,
    ).toBe('No related tables found');
    expect(m.text()).toContain('no relationship metadata');
  });

  it('describes the columns, and names no link for a database outside a project', async () => {
    const m = mount('t4', { view: 'columns' });
    answer(
      m,
      invoiceCustomerResult({
        db: { ref: null, project: null, env: null, source: null },
      }),
    );
    await m.render();
    expect(
      m.el().querySelectorAll('[data-testid="result-column"]'),
    ).toHaveLength(3);
    expect(
      m.el().querySelector('[data-testid="result-table-link"]'),
    ).toBeNull();
    expect(
      m.el().querySelector('[data-testid="result-not-in-project"]'),
    ).not.toBeNull();
    expect(m.text()).toContain('Customer.CustomerId');
  });

  it('shows why sources are missing for a native SQL query', async () => {
    const m = mount('t4', { view: 'sources' });
    answer(
      m,
      invoiceCustomerResult({
        query: { kind: 'saved', savedQueryId: 'q', savedQueryType: 'sql' },
        meta: {
          participants: [],
          related: [],
          unavailable: { participants: 'native-sql', related: 'native-sql' },
        },
      }),
    );
    await m.render();
    expect(m.text()).toContain('native SQL');
    expect(m.el().querySelector('[data-testid="result-sources"]')).toBeNull();
  });

  it('follows a switch of view, which reads nothing again', async () => {
    const m = mount('t4');
    answer(m);
    await m.render();
    m.page.selectView('columns');
    expect(m.navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { view: 'columns' } }),
    );
    await m.render();
    expect(
      m.el().querySelector('[data-testid="result-columns"]'),
    ).not.toBeNull();
    setQuery(m, { view: 'related' });
    await m.render();
    expect(
      m.el().querySelector('[data-testid="result-related"]'),
    ).not.toBeNull();
    m.page.selectView(42);
    expect(m.page.view()).toBe('table');
    m.ctrl.verify();
  });

  describe('named states', () => {
    const refusal = async (status: number, message: string) => {
      const m = mount('t4');
      m.ctrl
        .expectOne(`${AGENT}/results/t4`)
        .flush(
          { error: { code: 'X', message, field: 'id', requestId: 'r' } },
          { status, statusText: 'x' },
        );
      await m.render();
      return m;
    };

    it('result-not-found for an absent or expired result', async () => {
      const m = await refusal(404, 'result-not-found');
      expect(problem(m)).toBe('result-not-found');
      expect(m.text()).toContain('Run the query again in Claude Code');
    });

    it('result-incomplete', async () => {
      expect(problem(await refusal(404, 'result-incomplete'))).toBe(
        'result-incomplete',
      );
    });

    it('result-refused for a linked folder', async () => {
      expect(problem(await refusal(403, 'result-refused'))).toBe(
        'result-refused',
      );
    });

    it('link-expired without a valid session token', async () => {
      expect(problem(await refusal(401, 'UNAUTHENTICATED'))).toBe(
        'link-expired',
      );
    });

    it('version-unsupported for metadata the page does not read', async () => {
      const m = mount('t4');
      answer(m, invoiceCustomerResult({ meta: { version: 2 } }));
      await m.render();
      expect(problem(m)).toBe('version-unsupported');
    });

    it('agent-unreachable, with Check again reading it again', async () => {
      const m = mount('t4');
      m.ctrl
        .expectOne(`${AGENT}/results/t4`)
        .error(new ProgressEvent('error'), { status: 0 });
      await m.render();
      expect(problem(m)).toBe('agent-unreachable');
      expect(m.text()).toContain('127.0.0.1:8989');
      (
        m.el().querySelector('[data-testid="link-check-again"]') as HTMLElement
      ).click();
      answer(m);
      await m.render();
      expect(problem(m)).toBeFalsy();
    });

    it('an id outside the grammar is not found, and nothing is requested', async () => {
      const m = mount('..');
      await m.render();
      expect(problem(m)).toBe('result-not-found');
      m.ctrl.expectNone(() => true);
    });
  });

  describe('Run again', () => {
    const press = async (m: Mounted) => {
      (
        m.el().querySelector('[data-testid="result-run-again"]') as HTMLElement
      ).click();
      await m.render();
    };
    const agentInfo = (m: Mounted) =>
      m.ctrl.expectOne(`${AGENT}/agent-info`).flush(AGENT_INFO);

    it('sends nothing before the press, then exactly the query page request', async () => {
      const m = mount('t4');
      answer(m);
      await m.render();
      m.page.selectView('sources');
      m.page.selectView('table');
      await m.render();
      m.ctrl.expectNone(() => true);

      await press(m);
      agentInfo(m);
      const run = m.ctrl.expectOne(`${AGENT}/exec/run_query`);
      expect(run.request.method).toBe('POST');
      expect(run.request.body).toEqual({
        project: 'demo',
        environment: 'local',
        securityContextId: 'sc-7',
        source: 'chinook',
        dtql: 'from: Invoice i\njoin: Customer c on i.CustomerId = c.CustomerId\n',
        parameters: {},
        bindingOrigins: [],
        mode: 'live',
        limit: 500,
      });
      run.flush({
        recordset: {
          columns: [{ name: 'InvoiceId', type: 'integer' }],
          rows: [[{ type: 'integer', value: '7' }]],
        },
        limitations: [],
        bindingsApplied: [],
        provenance: { source: 'chinook' },
        truncated: true,
      });
      await m.render();
      expect(
        m.el().querySelector('[data-testid="result-fresh"]')?.textContent,
      ).toContain("first 500 rows (the agent's limit)");
      expect(m.page.gridRows()).toEqual([{ c0: '7' }]);
      (
        m
          .el()
          .querySelector('[data-testid="result-back-to-saved"]') as HTMLElement
      ).click();
      await m.render();
      expect(m.page.gridRows()[0]['c2']).toBe(ROW_MARKER);
      expect(m.el().querySelector('[data-testid="result-fresh"]')).toBeNull();
    });

    it('runs a saved query by its id with its parameters', async () => {
      const m = mount('t4');
      answer(
        m,
        invoiceCustomerResult({
          query: {
            kind: 'saved',
            dtql: undefined,
            savedQueryId: 'customer-invoices',
            savedQueryType: 'dtql',
            parameters: { CustomerId: { type: 'integer', value: '2' } },
          },
        }),
      );
      await m.render();
      await press(m);
      agentInfo(m);
      const run = m.ctrl.expectOne(`${AGENT}/exec/run_query`);
      expect(run.request.body).toMatchObject({
        queryId: 'customer-invoices',
        parameters: { CustomerId: { type: 'integer', value: '2' } },
        bindingOrigins: [{ parameterId: 'CustomerId', origin: 'manual' }],
        mode: 'live',
        limit: 500,
      });
      expect(run.request.body).not.toHaveProperty('dtql');
      run.flush({
        recordset: { columns: [], rows: [] },
        limitations: [],
        bindingsApplied: [],
        provenance: { source: 'chinook' },
        truncated: false,
      });
      await m.render();
      expect(m.text()).toContain('0 rows');
    });

    it("shows the agent's refusal as it worded it, and keeps the saved rows", async () => {
      const m = mount('t4');
      answer(m);
      await m.render();
      await press(m);
      agentInfo(m);
      m.ctrl.expectOne(`${AGENT}/exec/run_query`).flush(
        {
          error: {
            code: 'ACCESS_DENIED',
            message: 'the agent is read-only: writes are refused',
            requestId: 'r1',
          },
        },
        { status: 403, statusText: 'Forbidden' },
      );
      await m.render();
      expect(
        m.el().querySelector('[data-testid="result-run-error"]')?.textContent,
      ).toBe('ACCESS_DENIED: the agent is read-only: writes are refused');
      expect(m.page.gridRows()[0]['c2']).toBe(ROW_MARKER);
    });

    it('is disabled with its reason where the agent cannot run it', async () => {
      const m = mount('t4');
      answer(
        m,
        invoiceCustomerResult({
          meta: { unavailable: { query: 'too-large' } },
        }),
      );
      await m.render();
      const button = m
        .el()
        .querySelector(
          '[data-testid="result-run-again"]',
        ) as HTMLIonButtonElement;
      expect(button.disabled).toBe(true);
      expect(m.text()).toContain('too large to keep');
      m.page.runAgain();
      m.ctrl.expectNone(() => true);
    });
  });
});

describe('isLoopbackStore', () => {
  it('takes only a local agent', () => {
    expect(isLoopbackStore('http-127.0.0.1:8989')).toBe(true);
    expect(isLoopbackStore('localhost:8989')).toBe(true);
    expect(isLoopbackStore('github.com')).toBe(false);
    expect(isLoopbackStore('http-example.com')).toBe(false);
    expect(isLoopbackStore('')).toBe(false);
  });
});

describe('rerunErrorText', () => {
  it('words errors of a run plainly', () => {
    expect(rerunErrorText(new HttpErrorResponse({ status: 0 }))).toContain(
      'could not be reached',
    );
    expect(rerunErrorText(new HttpErrorResponse({ status: 401 }))).toContain(
      'fresh link',
    );
    expect(
      rerunErrorText(
        new HttpErrorResponse({
          status: 400,
          error: {
            error: { code: 'TIMEOUT', message: 'took too long', extra: 1 },
          },
        }),
      ),
    ).toBe('TIMEOUT: took too long');
    expect(rerunErrorText(new Error('x'))).toBe(
      'The DataTug agent could not run the query.',
    );
  });
});
