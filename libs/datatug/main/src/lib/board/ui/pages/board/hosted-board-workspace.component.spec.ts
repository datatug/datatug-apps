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
import { Board } from '@datatug/board-models';
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
    page: { ref: () => typeof ref; identity: () => string };
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
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    isNew = true;
    saved = JSON.parse(JSON.stringify(initial)) as Board;
    revision = 'rev1';
    writes = [];
    scope = {
      page: { ref: () => ref, identity: () => 'sarah/space/training' },
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
  async function mount() {
    const params = new BehaviorSubject(
      convertToParamMap({ board: isNew ? 'new' : 'saved' }),
    );
    await TestBed.configureTestingModule({
      imports: [HostedBoardWorkspaceComponent],
      providers: [
        { provide: ProjectAssetsApiService, useValue: api },
        {
          provide: ProjectQueryApiService,
          useValue: {
            folder: () =>
              of({
                id: '~',
                folders: [],
                items: [
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
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: params,
            snapshot: { paramMap: params.value, data: { createBoard: isNew } },
          },
        },
      ],
    })
      .overrideComponent(HostedBoardWorkspaceComponent, {
        remove: { providers: [HostedBoardScope], imports: [BoardComponent] },
        add: {
          providers: [{ provide: HostedBoardScope, useValue: scope }],
          imports: [BoardStub],
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
          f.nativeElement.querySelector('ion-input'),
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
      .querySelector('ion-input')
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
    const parameter = f.nativeElement.querySelector(
      'input[aria-label="order_id for Assignment"]',
    ) as HTMLInputElement;
    parameter.value = '11045';
    parameter.dispatchEvent(new Event('change', { bubbles: true }));
    await f.whenStable();
    button(f, 'Save board').click();
    await f.whenStable();
    expect(writes).toHaveLength(1);
    expect(writes[0].ifNoneMatch).toBe(true);
    expect(writes[0].ifMatch).toBeUndefined();
    expect(
      (writes[0].board.rows?.[0].cards?.[0].widget?.data as { sql: unknown }).sql,
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
