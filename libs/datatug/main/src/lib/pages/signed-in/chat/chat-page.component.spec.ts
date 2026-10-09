import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { ChatInterpretService } from '../../../chat/chat-interpret.service';
import { ChatJoinService } from '../../../chat/chat-join.service';
import { ChatProviderService } from '../../../chat/chat-provider.service';
import { ChatSessionService } from '../../../chat/chat-session.service';
import { ChatTurn } from '../../../chat/chat.types';
import { emptyChatWorkspace } from '../../../chat/chat-workspace';
import { ChinookChatDataService } from '../../../chat/chinook-chat-data.service';
import { ChatPageComponent } from './chat-page.component';
import { ProjectAIEligibilityService } from '../../../services/project/project-ai-eligibility.service';

const engineError = 'join_aggregate at orderBy[0]: c.Country is neither aggregated nor present in GROUP BY';
const session = {
  id: 's1',
  title: 'Chat',
  updatedAt: '2026-10-02T00:00:00Z',
  workspace: emptyChatWorkspace(),
};
const failedTurn: ChatTurn = {
  id: 'old',
  question: 'Sales by country?',
  state: 'error',
  error: engineError,
};

describe('ChatPageComponent failed turns', () => {
  let fixture: ComponentFixture<ChatPageComponent>;
  let restored: ChatTurn[];
  const store = {
    list: vi.fn(async () => [session]),
    create: vi.fn(async () => session),
    load: vi.fn(async () => ({ session, turns: restored })),
    listBookmarks: vi.fn(async () => []),
    context: vi.fn(() => ''),
    appendQuestion: vi.fn(async (_scope: string, _session: string, question: string): Promise<ChatTurn> => ({ id: 'new', question, state: 'loading' })),
    bindRecordSet: vi.fn(async (_scope: string, _session: string, dtql: string) => ({
      dtql,
      parentRecordSetId: undefined,
    })),
    failQuestion: vi.fn(
      async (_scope: string, _session: string, id: string, message: string): Promise<ChatTurn> => ({
        id,
        question: 'Sales by country?',
        state: 'error',
        error: message,
      }),
    ),
    completeWorkspaceAction: vi.fn(async (_scope: string, _session: string, id: string) => ({
      workspace: emptyChatWorkspace(),
      turn: { id, question: 'Sales by country?', state: 'result' as const },
    })),
  };
  const data = { ensureSeed: vi.fn(async () => undefined), query: vi.fn() };
  const joiner = { candidates: vi.fn((): unknown[] => []) };
  const interpreter = {
    interpret: vi.fn<ChatInterpretService['interpret']>(async () => ({
      dtql: '{}',
      metrics: { requestBytes: 0, responseBytes: 0, interpretMs: 0 },
    })),
  };
  const eligibility = { read: vi.fn(() => of({ aiAllowed: true })) };
  let routeParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let deferredRouteParams: Subject<ReturnType<typeof convertToParamMap>> | undefined;
  let routeQuery: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let authState: BehaviorSubject<{ status: string; user?: { uid: string } }>;

  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const details = (): HTMLDetailsElement | null => (fixture.nativeElement as HTMLElement).querySelector('details.error-detail');

  async function render(
    turns: ChatTurn[],
    params: Record<string, string> = {
      storeId: 'store',
      projectId: 'datatug-demo-project',
    },
    query: Record<string, string> = {},
    deferProjectRef = false,
  ): Promise<void> {
    restored = turns;
    routeParams = new BehaviorSubject(convertToParamMap(params));
    deferredRouteParams = deferProjectRef ? new Subject() : undefined;
    routeQuery = new BehaviorSubject(convertToParamMap(query));
    authState = new BehaviorSubject<{ status: string; user?: { uid: string } }>({ status: 'authenticated', user: { uid: 'actor-1' } });
    const route = {
      get snapshot() {
        return { paramMap: routeParams.value, queryParamMap: routeQuery.value };
      },
      paramMap: deferredRouteParams?.asObservable() || routeParams.asObservable(),
      queryParamMap: routeQuery.asObservable(),
    };
    TestBed.configureTestingModule({
      imports: [ChatPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ActivatedRoute, useValue: route },
        { provide: ChatSessionService, useValue: store },
        { provide: ChinookChatDataService, useValue: data },
        { provide: ChatInterpretService, useValue: interpreter },
        { provide: ChatJoinService, useValue: joiner },
        { provide: ProjectAIEligibilityService, useValue: eligibility },
        {
          provide: SneatAuthStateService,
          useValue: { authState: authState.asObservable() },
        },
        {
          provide: ChatProviderService,
          useValue: {
            providers: signal([
              {
                id: 'p1',
                name: 'Test',
                protocol: 'openai-chat',
                baseUrl: 'https://ai.example.test',
                model: 'm',
                apiKey: 'k',
              },
            ]),
            selectedId: signal('p1'),
          },
        },
      ],
    }).overrideComponent(ChatPageComponent, {
      set: {
        imports: [DecimalPipe, NgTemplateOutlet],
        schemas: [CUSTOM_ELEMENTS_SCHEMA],
      },
    });
    fixture = TestBed.createComponent(ChatPageComponent);
    await fixture.whenStable();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    joiner.candidates.mockImplementation(() => []);
    eligibility.read.mockImplementation(() => of({ aiAllowed: true }));
    interpreter.interpret.mockImplementation(async () => ({
      dtql: '{}',
      metrics: { requestBytes: 0, responseBytes: 0, interpretMs: 0 },
    }));
  });

  it('shows a saved engine failure in plain language, with the engine text behind an expandable detail', async () => {
    await render([failedTurn]);
    expect(text()).toMatch(/needs totals or counts/);
    expect(details()).not.toBeNull();
    expect(details()?.open).toBe(false);
    expect(details()?.querySelector('summary')?.textContent).toContain('Technical details');
    expect(details()?.querySelector('pre')?.textContent).toBe(engineError);
    // The raw text is only inside the collapsed detail, never the headline.
    const headline = (fixture.nativeElement as HTMLElement).querySelector('.turn-error ion-text')?.textContent ?? '';
    expect(headline).not.toContain('join_aggregate');
  });

  it('starts local seed and session restore when the initial project reference arrives asynchronously', async () => {
    await render([], { storeId: 'store', projectId: 'datatug-demo-project' }, {}, true);
    const component = fixture.componentInstance;

    expect(component.projectRef()).toBeUndefined();
    expect(component.seedState()).toBe('loading');
    expect(component.sessionState()).toBe('loading');
    expect(data.ensureSeed).not.toHaveBeenCalled();
    expect(store.list).not.toHaveBeenCalled();

    deferredRouteParams?.next(convertToParamMap({ storeId: 'store', projectId: 'datatug-demo-project' }));
    await fixture.whenStable();
    await vi.waitFor(() => expect(component.sessionState()).toBe('ready'));

    expect(component.seedState()).toBe('ready');
    expect(component.sessionState()).toBe('ready');
    expect(data.ensureSeed).toHaveBeenCalledWith('store', 'datatug-demo-project');
    expect(store.list).toHaveBeenCalledWith(JSON.stringify(['store', 'datatug-demo-project']));
  });

  it('shows an already plain message as it is, with no technical detail', async () => {
    await render([
      {
        ...failedTurn,
        error: 'The AI provider rejected the request (HTTP 401).',
      },
    ]);
    expect(text()).toContain('The AI provider rejected the request (HTTP 401).');
    expect(details()).toBeNull();
  });

  it('keeps the engine message on the stored turn and shows the friendly text when a question fails', async () => {
    data.query.mockRejectedValue(new TypeError(engineError));
    await render([]);
    const component = fixture.componentInstance;
    component.question.set('Sales by country?');
    await component.submit();
    await fixture.whenStable();
    expect(store.failQuestion).toHaveBeenCalledWith(expect.any(String), 's1', 'new', engineError, undefined);
    expect(text()).toMatch(/needs totals or counts/);
    expect(details()?.querySelector('pre')?.textContent).toBe(engineError);
  });

  it('does not create a pending turn when a shared project sponsor has expired', async () => {
    eligibility.read.mockReturnValueOnce(of({ aiAllowed: false, reason: 'plan_ended' }));
    await render([], { storeId: 'github.com', projectId: 'datatug-demo-project' }, { projectApi: 'cloud', branch: 'main' });
    const component = fixture.componentInstance;
    component.question.set('Sales by country?');
    await component.submit();
    expect(eligibility.read).toHaveBeenCalledWith({
      storeId: 'github.com',
      projectId: 'datatug-demo-project',
      projectApi: 'cloud',
      branch: 'main',
    });
    expect(interpreter.interpret).not.toHaveBeenCalled();
    expect(store.appendQuestion).not.toHaveBeenCalled();
    expect(store.failQuestion).not.toHaveBeenCalled();
    expect(component.question()).toBe('Sales by country?');
    expect(component.sessionError()).toBe('The sponsor plan for this shared project has ended.');
    expect(component.submitting()).toBe(false);
  });

  it('fails closed on an unavailable eligibility read without exposing its server error', async () => {
    eligibility.read.mockReturnValueOnce(throwError(() => new Error('private backend detail')));
    await render([], {
      storeId: 'firestore',
      projectId: 'project_1',
      spaceId: 'space_1',
    });
    const component = fixture.componentInstance;
    component.question.set('Sales by country?');
    await component.submit();
    expect(interpreter.interpret).not.toHaveBeenCalled();
    expect(store.appendQuestion).not.toHaveBeenCalled();
    expect(store.failQuestion).not.toHaveBeenCalled();
    expect(component.question()).toBe('Sales by country?');
    expect(text()).not.toContain('private backend detail');
  });

  it('fails closed when the eligibility response has no boolean decision', async () => {
    eligibility.read.mockReturnValueOnce(of({} as { aiAllowed: boolean }));
    await render([], {
      storeId: 'firestore',
      projectId: 'project_1',
      spaceId: 'space_1',
    });
    const component = fixture.componentInstance;
    component.question.set('Sales by country?');
    await component.submit();
    expect(interpreter.interpret).not.toHaveBeenCalled();
    expect(store.appendQuestion).not.toHaveBeenCalled();
    expect(store.failQuestion).not.toHaveBeenCalled();
    expect(component.sessionError()).toBe('Project AI access could not be verified.');
  });

  it('resolves an already-created pending turn when fresh eligibility expires before interpretation', async () => {
    eligibility.read.mockReturnValueOnce(of({ aiAllowed: true })).mockReturnValueOnce(of({ aiAllowed: false, reason: 'plan_ended' }));
    await render([], { storeId: 'github.com', projectId: 'datatug-demo-project' }, { projectApi: 'cloud', branch: 'main' });
    const component = fixture.componentInstance;
    component.question.set('Sales by country?');
    await component.submit();
    expect(store.appendQuestion).toHaveBeenCalledTimes(1);
    expect(store.failQuestion).toHaveBeenCalledWith(expect.any(String), 's1', 'new', 'The sponsor plan for this shared project has ended.');
    expect(interpreter.interpret).not.toHaveBeenCalled();
    expect(component.turns().find((turn) => turn.id === 'new')?.state).toBe('error');
  });

  it('allows read-only project AI while the sponsor remains paid even when query saving is disabled', async () => {
    eligibility.read.mockReturnValueOnce(of({ aiAllowed: true })).mockReturnValueOnce(of({ aiAllowed: true }));
    interpreter.interpret.mockResolvedValueOnce({
      workspaceAction: {
        kind: 'attach',
        reference: {
          kind: 'project',
          projectId: 'datatug-demo-project',
          objectId: 'datatug-demo-project',
          title: 'Project',
        },
      },
      metrics: { requestBytes: 0, responseBytes: 0, interpretMs: 0 },
    });
    await render([], { storeId: 'github.com', projectId: 'datatug-demo-project' }, { projectApi: 'cloud', branch: 'main' });
    const component = fixture.componentInstance;
    component.question.set('Show me this project');
    await component.submit();
    expect(interpreter.interpret).toHaveBeenCalledTimes(1);
    expect(store.completeWorkspaceAction).toHaveBeenCalled();
  });

  it.each([
    ['local', 'local-project'],
    ['github.com', 'public-repo'],
    ['firestore', 'private-firestore-project'],
  ])('keeps ordinary %s BYOK interpretation outside shared sponsorship', async (storeId, projectId) => {
    await render([], { storeId, projectId });
    const component = fixture.componentInstance;
    component.question.set('Sales by country?');
    await component.submit();
    expect(eligibility.read).not.toHaveBeenCalled();
    expect(interpreter.interpret).toHaveBeenCalledTimes(1);
  });

  it('ignores a restore failure from the previous full project ref', async () => {
    await render([{ ...failedTurn, id: 'current', question: 'Current session' }]);
    const deferred = new Subject<(typeof session)[]>();
    store.list.mockReturnValueOnce(deferred as unknown as Promise<(typeof session)[]>);
    const component = fixture.componentInstance;
    const staleRestore = (component as unknown as { restoreSessions(): Promise<void> }).restoreSessions();
    await Promise.resolve();
    routeQuery.next(convertToParamMap({ projectApi: 'cloud', branch: 'other' }));
    await fixture.whenStable();
    deferred.error(new Error('stale restore failure'));
    await staleRestore;
    await fixture.whenStable();
    expect(component.sessionError()).toBeUndefined();
    expect(component.sessionState()).toBe('ready');
  });

  it('discards a deferred eligibility response after the full project ref changes', async () => {
    const deferred = new Subject<{ aiAllowed: boolean }>();
    eligibility.read.mockReturnValueOnce(deferred);
    await render([], { storeId: 'github.com', projectId: 'datatug-demo-project' }, { projectApi: 'cloud', branch: 'main' });
    const component = fixture.componentInstance;
    component.question.set('Sales by country?');
    const pending = component.submit();
    await Promise.resolve();
    routeQuery.next(convertToParamMap({ projectApi: 'cloud', branch: 'other' }));
    deferred.next({ aiAllowed: true });
    deferred.complete();
    await pending;
    expect(interpreter.interpret).not.toHaveBeenCalled();
  });

  it.each([
    [{ projectApi: 'cloud', branch: 'other' }, 'branch'],
    [{ projectApi: 'private', branch: 'main' }, 'API'],
  ])('discards a denied eligibility response after a full ref %s change', async (nextQuery) => {
    const deferred = new Subject<{ aiAllowed: boolean; reason?: string }>();
    eligibility.read.mockReturnValueOnce(deferred);
    await render([], { storeId: 'github.com', projectId: 'datatug-demo-project' }, { projectApi: 'cloud', branch: 'main', spaceId: 'space-1' });
    const component = fixture.componentInstance;
    component.question.set('Sales by country?');
    const pending = component.submit();
    await Promise.resolve();
    routeQuery.next(convertToParamMap(nextQuery));
    deferred.next({ aiAllowed: false, reason: 'plan_ended' });
    deferred.complete();
    await pending;
    expect(store.appendQuestion).not.toHaveBeenCalled();
    expect(store.failQuestion).not.toHaveBeenCalled();
    expect(interpreter.interpret).not.toHaveBeenCalled();
    expect(component.sessionError()).not.toBe('The sponsor plan for this shared project has ended.');
  });

  it('discards a denied eligibility response after the Space changes during the read', async () => {
    const deferred = new Subject<{ aiAllowed: boolean; reason?: string }>();
    eligibility.read.mockReturnValueOnce(deferred);
    await render([], {
      storeId: 'firestore',
      projectId: 'project_1',
      spaceId: 'space-1',
    });
    const component = fixture.componentInstance;
    component.question.set('Sales by country?');
    const pending = component.submit();
    await Promise.resolve();
    routeParams.next(
      convertToParamMap({
        storeId: 'firestore',
        projectId: 'project_1',
        spaceId: 'space-2',
      }),
    );
    deferred.next({ aiAllowed: false, reason: 'plan_ended' });
    deferred.complete();
    await pending;
    expect(store.appendQuestion).not.toHaveBeenCalled();
    expect(store.failQuestion).not.toHaveBeenCalled();
    expect(interpreter.interpret).not.toHaveBeenCalled();
    expect(component.sessionError()).not.toBe('The sponsor plan for this shared project has ended.');
  });

  it('terminalizes a persisted pending question when the branch changes during fresh eligibility', async () => {
    const deferred = new Subject<{ aiAllowed: boolean }>();
    eligibility.read.mockReturnValueOnce(of({ aiAllowed: true })).mockReturnValueOnce(deferred);
    await render([], { storeId: 'github.com', projectId: 'datatug-demo-project' }, { projectApi: 'cloud', branch: 'main' });
    const component = fixture.componentInstance;
    component.question.set('Sales by country?');
    const pendingSubmit = component.submit();
    await vi.waitFor(() => expect(eligibility.read).toHaveBeenCalledTimes(2));

    routeQuery.next(convertToParamMap({ projectApi: 'cloud', branch: 'other' }));
    deferred.next({ aiAllowed: true });
    deferred.complete();
    await pendingSubmit;
    await fixture.whenStable();

    expect(store.appendQuestion).toHaveBeenCalledTimes(1);
    expect(store.failQuestion).toHaveBeenCalledWith(
      JSON.stringify(['github.com', 'datatug-demo-project']),
      's1',
      'new',
      'This request was interrupted. Ask it again to retry.',
    );
    expect(interpreter.interpret).not.toHaveBeenCalled();
    expect(data.query).not.toHaveBeenCalled();
    expect(component.turns().some((turn) => turn.id === 'new')).toBe(false);
    expect(component.sessionError()).toBeUndefined();
  });

  it('terminalizes a pending question when the provider rejects after the branch changes', async () => {
    let rejectInterpret!: (error: Error) => void;
    interpreter.interpret.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectInterpret = reject)),
    );
    await render([], { storeId: 'github.com', projectId: 'datatug-demo-project' }, { projectApi: 'cloud', branch: 'main' });
    const component = fixture.componentInstance;
    component.question.set('Sales by country?');
    const pendingSubmit = component.submit();
    await vi.waitFor(() => expect(interpreter.interpret).toHaveBeenCalledTimes(1));

    routeQuery.next(convertToParamMap({ projectApi: 'cloud', branch: 'other' }));
    rejectInterpret(new Error('stale provider detail'));
    await pendingSubmit;
    await fixture.whenStable();

    expect(store.failQuestion).toHaveBeenCalledWith(
      JSON.stringify(['github.com', 'datatug-demo-project']),
      's1',
      'new',
      'This request was interrupted. Ask it again to retry.',
    );
    expect(data.query).not.toHaveBeenCalled();
    expect(component.turns().some((turn) => turn.id === 'new')).toBe(false);
    expect(component.sessionError()).toBeUndefined();
  });

  it('re-seeds after auth changes while an older local seed is still loading', async () => {
    await render([]);
    const component = fixture.componentInstance;
    component.seedState.set('loading');
    let resolveOldSeed!: () => void;
    const oldSeedResult = new Promise<void>((resolve) => (resolveOldSeed = resolve));
    data.ensureSeed.mockImplementationOnce(() => oldSeedResult);
    const oldSeed = (component as unknown as { seed(): Promise<void> }).seed();
    await Promise.resolve();

    authState.next({ status: 'anonymous' });
    authState.next({ status: 'authenticated', user: { uid: 'actor-2' } });
    await fixture.whenStable();
    expect(component.seedState()).toBe('ready');

    resolveOldSeed();
    await oldSeed;
    expect(component.seedState()).toBe('ready');
  });

  it('discards a deferred eligibility response after the authenticated actor changes', async () => {
    const deferred = new Subject<{ aiAllowed: boolean }>();
    eligibility.read.mockReturnValueOnce(deferred);
    await render([], { storeId: 'github.com', projectId: 'datatug-demo-project' }, { projectApi: 'cloud', branch: 'main' });
    const component = fixture.componentInstance;
    component.question.set('Sales by country?');
    const pending = component.submit();
    await Promise.resolve();
    authState.next({ status: 'authenticated', user: { uid: 'actor-2' } });
    deferred.next({ aiAllowed: true });
    deferred.complete();
    await pending;
    expect(interpreter.interpret).not.toHaveBeenCalled();
  });

  describe('when the related tables cannot be built for a saved result', () => {
    const result: ChatTurn = {
      id: 'r1',
      question: 'Customers?',
      state: 'result',
      recordSetId: 'rs1',
      dtql: '{}',
      rows: [{ CustomerId: 1 }],
    };
    const relatedError = (): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector('.join-candidates .turn-error');

    it('explains an engine error in plain language, with the engine text behind an expandable detail', async () => {
      const raw = 'join_scope at from.joins[0].on[0].left: forward alias c';
      joiner.candidates.mockImplementation(() => {
        throw new Error(raw);
      });
      await render([result]);
      expect(relatedError()?.querySelector('ion-text')?.textContent).toMatch(/table or column that is not available/);
      expect(relatedError()?.querySelector('ion-text')?.textContent).not.toContain('join_scope');
      expect(relatedError()?.querySelector('details.error-detail summary')?.textContent).toContain('Technical details');
      expect(relatedError()?.querySelector('details.error-detail pre')?.textContent).toBe(raw);
      expect(text()).not.toContain('No further foreign-key relationships');
    });

    it('shows an already plain failure as it is, with no technical detail', async () => {
      joiner.candidates.mockImplementation(() => {
        throw 'not an Error';
      });
      await render([result]);
      expect(relatedError()?.querySelector('ion-text')?.textContent).toContain('The saved query cannot be read with the current schema.');
      expect(relatedError()?.querySelector('details')).toBeNull();
    });
  });

  describe('when the chat session or the local data cannot be loaded', () => {
    const alert = (): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector('.chat-history > .ion-padding .turn-error');

    it('shows a library failure while restoring the session in plain language, with the raw text on demand', async () => {
      store.list.mockRejectedValueOnce(new Error('Failed to execute transaction on IDBDatabase: closing'));
      await render([]);
      expect(alert()?.querySelector('ion-text')?.textContent).toBe('Something went wrong with this chat session.');
      expect(alert()?.querySelector('details.error-detail pre')?.textContent).toBe('Failed to execute transaction on IDBDatabase: closing');
    });

    it('shows a failure of the local Chinook data in plain language, with the raw text on demand', async () => {
      data.ensureSeed.mockRejectedValueOnce(new Error('QuotaExceededError: the quota has been exceeded'));
      await render([]);
      expect(alert()?.querySelector('ion-text')?.textContent).toBe('The local Chinook data could not be loaded.');
      expect(alert()?.querySelector('details.error-detail pre')?.textContent).toBe('QuotaExceededError: the quota has been exceeded');
    });

    it('shows DataTug’s own sentence as it is, with no technical detail', async () => {
      data.ensureSeed.mockRejectedValueOnce(new Error('The local Chinook seed fixture is unavailable.'));
      await render([]);
      expect(alert()?.querySelector('ion-text')?.textContent).toBe('The local Chinook seed fixture is unavailable.');
      expect(alert()?.querySelector('details')).toBeNull();
    });
  });
});
