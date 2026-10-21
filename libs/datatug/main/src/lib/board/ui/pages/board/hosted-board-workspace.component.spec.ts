import { DetectiveClientService } from '../../../../detective/detective-client.service';
import { DatatugNavContextService } from '../../../../services/nav/datatug-nav-context.service';
import { AgentContextService } from '@sneat/datatug-semantic';
import { QueriesService } from '../../../../queries/queries.service';
import { QueryDispatchService } from '../../../../queries/query-dispatch.service';
import { SneatAuthStateService } from '@sneat/auth-core';
import { QueryType } from '../../../../models/definition/query-def';
import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  Router,
  provideRouter,
} from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { Board, ChartWidgetDef } from '@datatug/board-models';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const chartFixture = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      '../../../../../../../board-models/src/lib/testdata/shipping-board.core-v063.json',
    ),
    'utf8',
  ),
) as Board;
const chartDefinitions =
  chartFixture.rows
    ?.flatMap((r) => r.cards ?? [])
    .map((c) => c.widget?.data as ChartWidgetDef) ?? [];
const mappingFields = (data: ChartWidgetDef) => {
  if (data.chart.type === 'timeline') return data.chart.timeline;
  if (data.chart.type === 'heatmap') return data.chart.heatmap;
  if (data.chart.type === 'timing-bars') return data.chart.timing;
  throw new Error('fixture');
};

import { HostedBoardWorkspaceComponent } from './hosted-board-workspace.component';
import { HostedBoardScope } from '../../../core/hosted-board-scope';
import { BoardComponent } from '../../components/board/board.component';
import {
  ProjectAssetsApiService,
  BoardAssetWrite,
} from '../../../../services/project/project-assets-api.service';
import { ProjectQueryApiService } from '../../../../services/project/project-query-api.service';
@Component({
  selector: 'sneat-datatug-board',
  template: '<p>Canonical renderer {{boardDef()?.title}}</p>',
})
class BoardStub {
  boardDef = input<Board>();
  projectRef = input<unknown>();
  boardContext = input<unknown>();
  readBoardForRun = input<unknown>();
}
const ref = { storeId: 'firestore', spaceID: 'space', projectId: 'training' };
const initial: Board = {
  id: 'saved',
  title: 'Saved shipping',
  rows: [
    {
      cards: [
        {
          id: 'receipt',
          title: 'Receipt',
          widget: { name: 'SQL', data: { sql: { queryId: 'receipt' } } },
        },
      ],
    },
  ],
};
describe('HostedBoardWorkspaceComponent DOM authoring', () => {
  let scope: {
    page: {
      ref: () => typeof ref;
      identity: () => string;
      scopeChanges$: Subject<string>;
    };
    identity: ReturnType<typeof signal<string>>;
    admitted: ReturnType<typeof signal<boolean>>;
    canWrite: ReturnType<typeof signal<boolean>>;
    loading: ReturnType<typeof signal<boolean>>;
    error: ReturnType<typeof signal<string>>;
    environment: () => string;
    environments: () => string[];
    refresh: ReturnType<typeof vi.fn>;
    choose: ReturnType<typeof vi.fn>;
    deny: ReturnType<typeof vi.fn>;
  };
  const api = { board: vi.fn(), saveBoard: vi.fn() };
  let navigate: ReturnType<typeof vi.fn>;
  let isNew: boolean;
  let saved: Board;
  let revision: string;
  let writes: BoardAssetWrite[];
  const dispatch = vi.fn();
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    isNew = true;
    saved = JSON.parse(JSON.stringify(initial)) as Board;
    revision = 'rev1';
    writes = [];
    scope = {
      page: {
        ref: () => ref,
        identity: () => 'sarah/space/training',
        scopeChanges$: new Subject<string>(),
      },
      identity: signal('sarah/space/training/demo'),
      admitted: signal(true),
      canWrite: signal(true),
      loading: signal(false),
      error: signal(''),
      environment: () => 'demo',
      environments: () => ['demo'],
      refresh: vi.fn(),
      choose: vi.fn(),
      deny: vi.fn(),
    };
    api.board.mockImplementation(() => of({ board: saved, revision }));
    api.saveBoard.mockImplementation((_ref, _env, write: BoardAssetWrite) => {
      writes.push(JSON.parse(JSON.stringify(write)) as BoardAssetWrite);
      saved = write.board;
      revision = 'rev2';
      return of({ board: saved, revision, receipt: write.operationId });
    });
  });
  afterEach(() => TestBed.resetTestingModule());
  async function mount(realRenderer = false) {
    const params = new BehaviorSubject(
      convertToParamMap({ board: isNew ? 'new' : 'saved' }),
    );
    await TestBed.configureTestingModule({
      imports: [HostedBoardWorkspaceComponent],
      providers: [
        {provide:DatatugNavContextService,useValue:{currentProject:of({ref}),currentEnv:of({id:'demo'})}},
        {provide:DetectiveClientService,useValue:{projectIncidents:vi.fn(()=>of({incidents:[]}))}},
        {provide:AgentContextService,useValue:{}},
        { provide: ProjectAssetsApiService, useValue: api },
        {
          provide: ProjectQueryApiService,
          useValue: {
            folder: () =>
              of({
                id: '~',
                folders: [
                  {
                    id: 'detective',
                    items: [
                      {
                        id: 'invoice-detail',
                        title: 'Invoice totals and customer',
                        type: 'DTQL',
                        parameters: [
                          {
                            id: 'invoice_id',
                            type: 'integer',
                            isRequired: true,
                          },
                        ],
                      },
                    ],
                  },
                ],
                items: [
                  {
                    id: 'legacy-structured',
                    title: 'Structured query',
                    type: 'TugQL',
                  },
                  { id: 'http', title: 'Unsupported HTTP', type: 'HTTP' },
                  { id: 'future', title: 'Unknown language', type: 'future' },
                  { id: 'receipt', title: 'Receipt', type: 'SQL' },
                  {
                    id: 'assignment',
                    title: 'Assignment',
                    type: 'SQL',
                    parameters: [
                      { id: 'order_id', type: 'integer', isRequired: true },
                    ],
                  },
                ],
              }),
          },
        },
        {
          provide: QueriesService,
          useValue: {
            getQuery: () =>
              of({
                id: 'receipt',
                title: 'Receipt',
                request: {
                  queryType: QueryType.DTQL,
                  text: 'from: {database: invoices-db, name: InvoiceDetail}',
                },
                parameters: [
                  { id: 'order_id', type: 'integer', isRequired: true },
                ],
                recordsets: [
                  {
                    name: 'declared',
                    columns: Array.from(
                      new Set(
                        chartDefinitions.flatMap((data) =>
                          Object.values(mappingFields(data)),
                        ),
                      ),
                    ).map((name) => ({ name, type: 'string' })),
                  },
                ],
              }),
          },
        },
        {
          provide: QueryDispatchService,
          useValue: {
            execute: dispatch,
            executeHeld: async (...args: Parameters<typeof dispatch>) => ({result:await dispatch(...args)}),
            runtimeRevision: signal(0),
            availableWorkingCopies: () => Promise.resolve([]),
          },
        },
        {
          provide: SneatAuthStateService,
          useValue: {
            authState: of({ status: 'authenticated', user: { uid: 'sarah' } }),
          },
        },
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: params,
            queryParamMap: of(convertToParamMap({ environment: 'demo' })),
            snapshot: {
              paramMap: params.value,
              queryParamMap: convertToParamMap({ environment: 'demo' }),
              data: { createBoard: isNew },
            },
          },
        },
      ],
    })
      .overrideComponent(HostedBoardWorkspaceComponent, {
        remove: {
          providers: [HostedBoardScope],
          imports: realRenderer ? [] : [BoardComponent],
        },
        add: {
          providers: [{ provide: HostedBoardScope, useValue: scope }],
          imports: realRenderer ? [] : [BoardStub],
        },
      })
      .compileComponents();
    navigate = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
    const f = TestBed.createComponent(HostedBoardWorkspaceComponent);
    f.detectChanges();
    await f.whenStable();
    if (scope.admitted())
      await vi.waitFor(() =>
        expect(
          f.nativeElement.querySelector(
            isNew ? '.board-editor ion-input' : 'sneat-datatug-board',
          ),
          f.nativeElement.textContent,
        ).not.toBeNull(),
      );
    return f;
  }
  function inputTitle(
    f: ComponentFixture<HostedBoardWorkspaceComponent>,
    text: string,
  ) {
    f.nativeElement
      .querySelector('.board-editor ion-input')
      .dispatchEvent(
        new CustomEvent('ionInput', { detail: { value: text }, bubbles: true }),
      );
  }
  function button(
    f: ComponentFixture<HostedBoardWorkspaceComponent>,
    text: string,
  ): HTMLElement {
    const found = Array.from(
      f.nativeElement.querySelectorAll('ion-button'),
    ).find((node) => (node as HTMLElement).textContent?.trim() === text);
    expect(found).toBeTruthy();
    return found as HTMLElement;
  }
  it('authors three chart kinds and a dynamic board input through DOM, saves, and cold reloads the exact definition', async () => {
    const f = await mount();
    inputTitle(f, 'Shipping evidence dashboard');
    await f.whenStable();
    const parameter = f.nativeElement.querySelector(
      'input[aria-label="Parameter ID"]',
    ) as HTMLInputElement;
    parameter.value = 'order_id';
    parameter.dispatchEvent(new Event('input'));
    await f.whenStable();
    button(f, 'Add or update required input').click();
    await f.whenStable();
    for (const data of chartDefinitions) {
      const add = f.nativeElement.querySelector(
        'select[aria-label="Add saved query"]',
      ) as HTMLSelectElement;
      add.value = 'assignment';
      add.dispatchEvent(new Event('change'));
      await f.whenStable();
      button(f, 'Add query widget').click();
      await f.whenStable();
      const editors = Array.from(
        f.nativeElement.querySelectorAll('sneat-datatug-board-chart-editor'),
      ) as HTMLElement[];
      const editor = editors[editors.length - 1];
      const change = async (name: string, value: string) => {
        const select = editor.querySelector(
          `select[aria-label="${name}"]`,
        ) as HTMLSelectElement;
        expect(select).not.toBeNull();
        select.value = value;
        select.dispatchEvent(new Event('change'));
        await f.whenStable();
      };
      await change('Chart kind', data.chart.type);
      for (const [role, column] of Object.entries(mappingFields(data)))
        await change(role, column);
      await change('Board input for order_id', 'order_id');
      const apply = editor.querySelector('button') as HTMLButtonElement;
      expect(apply.disabled).toBe(false);
      apply.click();
      await f.whenStable();
    }
    button(f, 'Save board').click();
    await f.whenStable();
    expect(writes, f.nativeElement.textContent).toHaveLength(1);
    const authored = writes[0].board;
    expect(authored.parameters).toEqual([
      { id: 'order_id', type: 'integer', isRequired: true },
    ]);
    const authoredCharts =
      authored.rows
        ?.flatMap((row) => row.cards ?? [])
        .map((card) => card.widget?.data as ChartWidgetDef) ?? [];
    expect(authoredCharts.map((data) => data.chart.type)).toEqual([
      'timeline',
      'timing-bars',
      'heatmap',
    ]);
    for (const data of authoredCharts)
      expect(data.sources[0].parameters).toEqual([
        { id: 'order_id', boardParameterId: 'order_id' },
      ]);
    expect(navigate).toHaveBeenCalled();
    f.destroy();
    TestBed.resetTestingModule();
    isNew = false;
    const cold = await mount();
    expect(cold.componentInstance.draft()).toEqual(authored);
    expect(
      cold.nativeElement.querySelector(
        'section[aria-label="Edit board definition"]',
      ),
    ).toBeNull();
    button(cold, 'Edit board').click();
    await cold.whenStable();
    expect(
      cold.nativeElement.querySelectorAll('sneat-datatug-board-chart-editor')
        .length,
    ).toBe(3);
    expect(writes, f.nativeElement.textContent).toHaveLength(1);
  });
  it('opens saved deep links in canonical view, explicitly edits and cancels the complete definition', async () => {
    isNew = false;
    const f = await mount();
    expect(f.nativeElement.textContent).toContain(
      'Canonical renderer Saved shipping',
    );
    expect(f.nativeElement.querySelector('.board-editor ion-input')).toBeNull();
    button(f, 'Edit board').click();
    await f.whenStable();
    inputTitle(f, 'Unsaved title');
    f.componentInstance.edit({ type: 'remove-card', cardId: 'receipt' });
    f.componentInstance.edit({
      type: 'set-parameter',
      parameter: { id: 'unsaved', type: 'string', isRequired: true },
    });
    await f.whenStable();
    button(f, 'Cancel').click();
    await f.whenStable();
    expect(f.componentInstance.draft()).toEqual(initial);
    expect(f.nativeElement.querySelector('.board-editor ion-input')).toBeNull();
    expect(api.saveBoard).not.toHaveBeenCalled();
    expect(f.nativeElement.textContent).toContain(
      'Canonical renderer Saved shipping',
    );
  });
  it('stays editing after a failed save and keeps the original pending operation reachable without Cancel', async () => {
    isNew = false;
    api.saveBoard.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 503 })),
    );
    const f = await mount();
    button(f, 'Edit board').click();
    await f.whenStable();
    inputTitle(f, 'Pending title');
    button(f, 'Save board').click();
    await f.whenStable();
    expect(f.componentInstance.editing()).toBe(true);
    expect(f.nativeElement.textContent).toContain('Retry original save');
    expect(
      f.nativeElement.querySelector(
        'section[aria-label="Edit board definition"]',
      ),
    ).not.toBeNull();
    expect(
      Array.from(f.nativeElement.querySelectorAll('ion-button')).some(
        (b) => (b as HTMLElement).textContent?.trim() === 'Cancel',
      ),
    ).toBe(false);
    f.componentInstance.cancelEdit();
    expect(f.componentInstance.pending()).toBeDefined();
    expect(f.componentInstance.draft()?.title).toBe('Pending title');
  });
  it('returns to saved view after acknowledgement, and hides edit for read-only access', async () => {
    isNew = false;
    const f = await mount();
    button(f, 'Edit board').click();
    await f.whenStable();
    inputTitle(f, 'Acknowledged');
    button(f, 'Save board').click();
    await f.whenStable();
    expect(f.componentInstance.editing()).toBe(false);
    expect(f.nativeElement.querySelector('.board-editor ion-input')).toBeNull();
    expect(f.nativeElement.textContent).toContain('Board saved.');
    scope.canWrite.set(false);
    await f.whenStable();
    expect(
      Array.from(f.nativeElement.querySelectorAll('ion-button')).some(
        (b) => (b as HTMLElement).textContent?.trim() === 'Edit board',
      ),
    ).toBe(false);
  });
  it('creates from DOM saved-query controls, saves actual scoped conditions and cold-loads current detail', async () => {
    const f = await mount();
    inputTitle(f, 'Shipping incident');
    await f.whenStable();
    const select = f.nativeElement.querySelector(
      'select[aria-label="Add saved query"]',
    ) as HTMLSelectElement;
    select.value = 'assignment';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await f.whenStable();
    button(f, 'Add query widget').click();
    await f.whenStable();
    const currentQuery = f.nativeElement.querySelector(
      'select[aria-label="Saved query for Assignment"]',
    ) as HTMLSelectElement;
    expect(currentQuery.value).toBe('assignment');
    expect(currentQuery.selectedOptions[0]?.value).toBe('assignment');
    const parameter = f.nativeElement.querySelector(
      'input[aria-label="order_id for Assignment"]',
    ) as HTMLInputElement;
    parameter.value = '11045';
    parameter.dispatchEvent(new Event('change', { bubbles: true }));
    await f.whenStable();
    button(f, 'Save board').click();
    await f.whenStable();
    expect(writes, f.nativeElement.textContent).toHaveLength(1);
    expect(writes[0].ifNoneMatch).toBe(true);
    expect(writes[0].ifMatch).toBeUndefined();
    expect(
      (writes[0].board.rows?.[0].cards?.[0].widget?.data as { sql: unknown })
        .sql,
    ).toEqual({
      queryId: 'assignment',
      parameters: [{ id: 'order_id', value: 11045 }],
    });
    expect(api.saveBoard).toHaveBeenCalledWith(
      ref,
      'demo',
      expect.objectContaining({
        board: expect.objectContaining({ title: 'Shipping incident' }),
      }),
    );
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining('/board/board-'),
      { replaceUrl: true },
    );
  });
  it('cold-loads saved board defaults and sends viewer inputs through the canonical renderer without persisting runtime values', async () => {
    isNew = false;
    scope.canWrite.set(false);
    saved = {
      ...initial,
      parameters: [{ id: 'order', type: 'integer', defaultValue: 7 }],
      rows: [
        {
          cards: [
            {
              id: 'receipt',
              title: 'Receipt',
              widget: {
                name: 'SQL',
                data: {
                  sql: {
                    queryId: 'receipt',
                    parameters: [{ id: 'order_id', boardParameterId: 'order' }],
                  },
                },
              },
            },
          ],
        },
      ],
    };
    dispatch.mockRejectedValue(new Error('Current source unavailable.'));
    const f = await mount(true);
    await vi.waitFor(() =>
      expect(f.nativeElement.textContent).toContain('Run on board'),
    );
    const input = f.nativeElement.querySelector(
      'section[aria-label="Board runtime parameters"] ion-input',
    );
    expect(input.value).toBe('7');
    expect(input.label).toBe('order');
    expect(input.labelPlacement).toBe('fixed');
    expect(input.closest('.runtime-parameter')).not.toBeNull();
    button(f, 'Run on board').click();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(dispatch.mock.calls[0][0].parameters).toEqual({
      order_id: { type: 'integer', value: '7' },
    });
    button(f, 'Review current board access').click();
    await vi.waitFor(()=>expect(f.nativeElement.textContent).toContain('Abandon original retry'));
    button(f, 'Abandon original retry').click();
    let rejectOldRun: ((reason: Error) => void) | undefined;
    dispatch.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOldRun = reject;
        }),
    );
    input.dispatchEvent(
      new CustomEvent('ionInput', {
        detail: { value: '11062' },
        bubbles: true,
      }),
    );
    await f.whenStable();
    button(f, 'Run on board').click();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
    expect(dispatch.mock.calls[1][0].parameters).toEqual({
      order_id: { type: 'integer', value: '11062' },
    });
    input.dispatchEvent(
      new CustomEvent('ionInput', {
        detail: { value: '9007199254740993' },
        bubbles: true,
      }),
    );
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain('supported integer range');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('hosted-board-parameter-error-order');
    expect(f.nativeElement.querySelector('#hosted-board-parameter-error-order')?.textContent).toContain('supported integer range');
    expect(f.componentInstance.boardContext().parameters).toEqual({});
    expect(dispatch.mock.calls[1][0].signal.aborted).toBe(true);
    button(f, 'Run on board').click();
    await f.whenStable();
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(saved.parameters?.[0].defaultValue).toBe(7);
    expect(sessionStorage.length).toBe(1);
    const retryKey=sessionStorage.key(0);expect(retryKey).toMatch(/^datatug-retained-run\/1\/[a-f0-9]{64}$/);
    expect(sessionStorage.getItem(retryKey || '')).toMatch(/^operation-/);
    expect(JSON.stringify([retryKey,sessionStorage.getItem(retryKey || '')])).not.toContain('11062');
    scope.admitted.set(false);
    scope.identity.set('maya/other/prod');
    await f.whenStable();
    expect(f.componentInstance.boardContext().parameters).toEqual({});
    expect(
      f.nativeElement.querySelector(
        'section[aria-label="Board runtime parameters"]',
      ),
    ).toBeNull();
    expect(f.componentInstance.parameterErrors()).toEqual({});
    if (!rejectOldRun) throw new Error('Expected pending old run.');
    rejectOldRun(new Error('Old scope failure'));
    await f.whenStable();
    expect(f.nativeElement.textContent).not.toContain('Old scope failure');
  });
  it('authors a native-demo DTQL saved query using the canonical SQL widget and excludes unsupported languages', async () => {
    const f = await mount();
    inputTitle(f, 'Invoice investigation');
    await f.whenStable();
    const select = f.nativeElement.querySelector(
      'select[aria-label="Add saved query"]',
    ) as HTMLSelectElement;
    const choices = Array.from(select.options).map((option) => option.value);
    expect(choices).toEqual(
      expect.arrayContaining([
        'receipt',
        'assignment',
        'legacy-structured',
        'detective/invoice-detail',
      ]),
    );
    expect(choices).not.toContain('http');
    expect(choices).not.toContain('future');
    select.value = 'detective/invoice-detail';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await f.whenStable();
    button(f, 'Add query widget').click();
    await f.whenStable();
    const parameter = f.nativeElement.querySelector(
      'input[aria-label="invoice_id for Invoice totals and customer"]',
    ) as HTMLInputElement;
    parameter.value = '7';
    parameter.dispatchEvent(new Event('change', { bubbles: true }));
    await f.whenStable();
    button(f, 'Save board').click();
    await f.whenStable();
    expect(writes[0].board.rows?.[0].cards?.[0].widget).toEqual({
      name: 'SQL',
      data: {
        sql: {
          queryId: 'detective/invoice-detail',
          parameters: [{ id: 'invoice_id', value: 7 }],
        },
      },
    });
    expect(f.nativeElement.textContent).toContain('Board saved');
  });
  it('retains the exact lost-response operation across remount and refreshes a newer current projection after replay', async () => {
    let original: BoardAssetWrite | undefined;
    api.saveBoard.mockImplementationOnce(
      (_ref, _env, write: BoardAssetWrite) => {
        original = write;
        return throwError(() => new HttpErrorResponse({ status: 0 }));
      },
    );
    const first = await mount();
    inputTitle(first, 'Original intent');
    await first.whenStable();
    button(first, 'Save board').click();
    await first.whenStable();
    expect(first.nativeElement.textContent).toContain(
      'may already have completed',
    );
    first.destroy();
    TestBed.resetTestingModule();
    const f = await mount();
    expect(f.nativeElement.querySelector('ion-input').value).toBe(
      'Original intent',
    );
    if (!original) throw new Error('Expected original save intent.');
    saved = { ...original.board, title: 'Newer current board' };
    revision = 'rev3';
    api.saveBoard.mockReturnValueOnce(
      of({
        board: original.board,
        revision: 'rev2',
        receipt: original.operationId,
      }),
    );
    button(f, 'Retry original save').click();
    await f.whenStable();
    expect(api.saveBoard.mock.calls[1][2]).toEqual(original);
    expect(f.nativeElement.textContent).toContain('Newer current board');
  });
  it('holds a409 draft until current definition review and only then permits a new operation with current revision', async () => {
    isNew = false;
    api.saveBoard.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 409 })),
    );
    const f = await mount();
    button(f, 'Edit board').click();
    await f.whenStable();
    inputTitle(f, 'My draft');
    await f.whenStable();
    button(f, 'Save board').click();
    await f.whenStable();
    const original = api.saveBoard.mock.calls[0][2] as BoardAssetWrite;
    expect(
      (button(f, 'Retry original save') as HTMLElement & { disabled: boolean })
        .disabled,
    ).toBe(true);
    saved = { ...initial, title: 'Colleague update' };
    revision = 'rev3';
    button(f, 'Review current saved board').click();
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain('Colleague update');
    button(f, 'Keep draft and start a new save').click();
    await f.whenStable();
    button(f, 'Save board').click();
    await f.whenStable();
    const next = api.saveBoard.mock.calls[1][2] as BoardAssetWrite;
    expect(next.operationId).not.toBe(original.operationId);
    expect(next.ifMatch).toBe('rev3');
    expect(next.board.title).toBe('My draft');
  });
  it('keeps an uncertain create retry intact until an authorized missing-board review permits a new intent', async () => {
    api.saveBoard.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 0 })),
    );
    const f = await mount();
    inputTitle(f, 'Pending create');
    await f.whenStable();
    button(f, 'Save board').click();
    await f.whenStable();
    const original = api.saveBoard.mock.calls[0][2] as BoardAssetWrite;
    api.board.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 404 })),
    );
    button(f, 'Review current saved board').click();
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain(
      'may have completed before it was deleted',
    );
    expect(api.saveBoard).toHaveBeenCalledTimes(1);
    button(f, 'Review draft and start a new create').click();
    await f.whenStable();
    inputTitle(f, 'Reviewed create');
    await f.whenStable();
    button(f, 'Save board').click();
    await f.whenStable();
    const next = api.saveBoard.mock.calls[1][2] as BoardAssetWrite;
    expect(next.operationId).not.toBe(original.operationId);
    expect(next.ifNoneMatch).toBe(true);
    expect(next.board.title).toBe('Reviewed create');
  });
  it('does not publish a late save into a changed scope, and missing admitted environment performs no reads', async () => {
    scope.admitted.set(false);
    const f = await mount();
    expect(api.board).not.toHaveBeenCalled();
    expect(f.nativeElement.textContent).toContain(
      'Choose an available environment',
    );
    scope.admitted.set(true);
    await f.whenStable();
    inputTitle(f, 'Before switch');
    await f.whenStable();
    const reply = new Subject<unknown>();
    api.saveBoard.mockReturnValueOnce(reply);
    button(f, 'Save board').click();
    await f.whenStable();
    scope.admitted.set(false);
    scope.identity.set('maya/other/prod');
    await f.whenStable();
    reply.next({});
    reply.complete();
    await f.whenStable();
    expect(f.nativeElement.textContent).not.toContain('Before switch');
    expect(navigate).not.toHaveBeenCalled();
  });
});
