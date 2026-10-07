import { TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { BehaviorSubject, Subject, firstValueFrom, of, throwError } from 'rxjs';
import { QueryEditorStateService } from './query-editor-state-service';
import { QueriesService } from './queries.service';
import { ProjectService } from '../services/project/project.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import {
  createHostedDemoDbQuery,
  withHostedDemoDbSource,
} from './hosted-demo-db-query';
import { toProjectQueryWire } from './project-query-contract';
import { type IProjectContext } from '../nav/nav-models';

const ref = {
  storeId: 'github.com',
  projectId: 'repo@owner@folder',
  projectApi: 'cloud' as const,
  branch: 'work',
};
const draft = createHostedDemoDbQuery('q');
const response = {
  query: toProjectQueryWire(draft),
  revision: 'revision-2',
  branchHead: 'head-2',
  saveSupported: true,
};
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture value');
  return value;
}
function harness() {
  TestBed.resetTestingModule();
  const project = new BehaviorSubject<IProjectContext | undefined>({ ref });
  const auth = new BehaviorSubject({
    status: 'authenticated',
    user: {
      uid: 'actor',
      providerData: [{ providerId: 'google.com', uid: 'actor' }],
    },
  });
  const read = new Subject<typeof response>();
  const save = new Subject<typeof response>();
  const queries = {
    authentication: () => auth,
    getRevision: vi.fn(() => read),
    saveRevision: vi.fn((...args: unknown[]) => {
      void args;
      return save;
    }),
    capabilities: vi.fn(() => of({ querySave: true })),
    branches: vi.fn(() => of({ branches: [{ name: 'work', head: 'head-1' }] })),
    getQuery: vi.fn(),
    createQuery: vi.fn(),
    updateQuery: vi.fn(),
  };
  const getFull = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      QueryEditorStateService,
      { provide: ErrorLogger, useValue: { logError: vi.fn() } },
      { provide: QueriesService, useValue: queries },
      { provide: ProjectService, useValue: { getFull } },
      {
        provide: DatatugNavContextService,
        useValue: { currentProject: project, currentEnv: of(undefined) },
      },
    ],
  });
  const service = TestBed.inject(QueryEditorStateService);
  const add = () =>
    service.newQuery({
      id: 'q',
      isNew: true,
      title: draft.title,
      queryType: draft.request.queryType,
      def: draft,
      request: draft.request,
      federation: draft.federation,
    });
  return { service, queries, project, auth, read, save, add, getFull };
}

describe('Common API query editor journey', () => {
  it.each(['chinook.Customer', 'adventureworks.Person.Person'])(
    'saves and cold-reloads the hosted demo source %s without a CLI definition',
    async (source) => {
      const h = harness();
      const definition = withHostedDemoDbSource(draft, source);
      const state = h.service.newQuery({
        id: 'q',
        isNew: true,
        queryType: definition.request.queryType,
        title: definition.title,
        def: definition,
        request: definition.request,
        federation: definition.federation,
      });
      const result = { ...response, query: toProjectQueryWire(definition) };
      h.queries.saveRevision.mockImplementation(() => of(result) as never);
      await firstValueFrom(h.service.saveQuery(state, ref));
      expect(h.queries.saveRevision.mock.calls[0][1]).toMatchObject({
        ifNoneMatch: true,
        query: result.query,
      });
      h.service.reloadQuery('q');
      h.read.next(result);
      expect(h.service.getQueryState('q')?.def).toEqual(definition);
      expect(h.getFull).not.toHaveBeenCalled();
    },
  );
  it('uses only the actual local current branch and captured head for a first save', async () => {
    const h = harness();
    const local = {
      storeId: 'http-localhost:8989',
      projectId: 'local',
      projectApi: 'local' as const,
      branch: 'work',
    };
    h.project.next({ ref: local });
    h.queries.branches.mockImplementation(
      () =>
        of({
          currentBranch: 'work',
          branches: [{ name: 'work', head: 'actual-local-head' }],
        }) as never,
    );
    h.queries.saveRevision.mockImplementation(() => of(response) as never);
    await firstValueFrom(h.service.saveQuery(h.add(), local));
    expect(h.queries.saveRevision.mock.calls[0][1]).toMatchObject({
      branch: 'work',
      expectedBranchHead: 'actual-local-head',
      ifNoneMatch: true,
    });
    h.queries.branches.mockImplementation(
      () =>
        of({
          currentBranch: 'other',
          branches: [{ name: 'work', head: 'stale-head' }],
        }) as never,
    );
    const second = h.service.newQuery({
      id: 'second',
      isNew: true,
      queryType: draft.request.queryType,
      def: { ...draft, id: 'second' },
      request: draft.request,
      federation: draft.federation,
    });
    await expect(
      firstValueFrom(h.service.saveQuery(second, local)),
    ).rejects.toThrow('current local branch');
    expect(h.queries.saveRevision).toHaveBeenCalledTimes(1);
  });
  it('retains the exact operation and captured head after a lost response', async () => {
    const h = harness();
    const state = h.add();
    h.queries.saveRevision.mockImplementation(() =>
      throwError(() => ({ status: 0 })),
    );
    await expect(
      firstValueFrom(h.service.saveQuery(state, ref)),
    ).rejects.toBeDefined();
    const first = h.queries.saveRevision.mock.calls[0][1];
    h.queries.saveRevision.mockImplementation(() => of(response) as never);
    await firstValueFrom(
      h.service.saveQuery(required(h.service.getQueryState('q')), ref),
    );
    expect(h.queries.saveRevision.mock.calls[1][1]).toEqual(first);
    expect(h.queries.branches).toHaveBeenCalledTimes(1);
    expect(h.service.getQueryState('q')).toMatchObject({
      isNew: false,
      revision: 'revision-2',
      branchHead: 'head-2',
      isSaving: false,
    });
  });
  it('preserves body/title edits arriving while a save is pending and uses a new operation afterward', async () => {
    const h = harness();
    const state = h.add();
    const completion = firstValueFrom(h.service.saveQuery(state, ref));
    const initial = h.queries.saveRevision.mock.calls[0][1] as {
      operationId: string;
    };
    h.service.updateQueryState({
      ...required(h.service.getQueryState('q')),
      title: 'Later title',
      request: { ...draft.request, text: 'later body' } as typeof draft.request,
    });
    h.save.next(response);
    await completion;
    const current = required(h.service.getQueryState('q'));
    expect(current.title).toBe('Later title');
    expect(current.request).toMatchObject({ text: 'later body' });
    h.queries.saveRevision.mockImplementation(() => of(response) as never);
    await firstValueFrom(h.service.saveQuery(current, ref));
    expect(h.queries.saveRevision.mock.calls[1][1]).toMatchObject({
      ifMatch: 'revision-2',
      expectedBranchHead: 'head-2',
    });
    expect(
      (h.queries.saveRevision.mock.calls[1][1] as { operationId: string })
        .operationId,
    ).not.toBe(initial.operationId);
  });
  it('preserves a conflicted draft and never reads a private fallback', async () => {
    const h = harness();
    const state = h.add();
    h.queries.saveRevision.mockImplementation(() =>
      throwError(() => ({ status: 409 })),
    );
    await expect(
      firstValueFrom(h.service.saveQuery(state, ref)),
    ).rejects.toBeDefined();
    expect(h.service.getQueryState('q')).toMatchObject({
      request: draft.request,
      isNew: true,
      isSaving: false,
    });
    expect(h.service.getQueryState('q')?.saveError).toContain(
      'draft is preserved',
    );
    expect(h.getFull).not.toHaveBeenCalled();
    expect(h.queries.getQuery).not.toHaveBeenCalled();
  });
  it.each([
    { ...ref, branch: 'other' },
    { ...ref, projectId: 'other@owner@folder' },
    {
      storeId: 'http-localhost:8989',
      projectId: ref.projectId,
      projectApi: 'local' as const,
      branch: 'work',
    },
  ])('ignores old query responses after scope changes: %j', (nextRef) => {
    const h = harness();
    h.service.openQuery('q');
    h.project.next({ ref: nextRef });
    h.read.next(response);
    expect(h.service.getQueryState('q')).toBeUndefined();
    expect(h.getFull).not.toHaveBeenCalled();
  });
  it('clears loaded data on an authentication transition and cancels pending saves before submission', () => {
    const h = harness();
    h.service.openQuery('q');
    h.read.next(response);
    expect(h.service.getQueryState('q')?.def).toBeDefined();
    const caps = new Subject<{ querySave: boolean }>();
    h.queries.capabilities.mockImplementation(() => caps as never);
    h.service
      .saveQuery(required(h.service.getQueryState('q')), ref)
      .subscribe();
    h.auth.next({
      status: 'notAuthenticated',
      user: { uid: 'actor', providerData: [] },
    });
    caps.next({ querySave: true });
    expect(h.service.getQueryState('q')).toBeUndefined();
    expect(h.queries.saveRevision).not.toHaveBeenCalled();
  });
  it('refuses a lossy rich definition before any API write, with an inline explanation', async () => {
    const h = harness();
    const state = h.add();
    const enriched = {
      ...state,
      def: { ...required(state.def), parameters: [] },
    };
    h.service.updateQueryState(enriched);
    await expect(
      firstValueFrom(h.service.saveQuery(enriched, ref)),
    ).rejects.toThrow('cannot preserve');
    expect(h.queries.saveRevision).not.toHaveBeenCalled();
    expect(h.service.getQueryState('q')?.saveError).toContain(
      'cannot preserve',
    );
  });
  it('refuses unsupported capabilities without dropping a new draft', async () => {
    const h = harness();
    const state = h.add();
    h.queries.capabilities.mockReturnValue(of({ querySave: false }));
    await expect(
      firstValueFrom(h.service.saveQuery(state, ref)),
    ).rejects.toThrow('does not currently allow');
    expect(h.queries.saveRevision).not.toHaveBeenCalled();
    expect(h.service.getQueryState('q')).toMatchObject({
      isSaving: false,
      request: draft.request,
    });
  });
});
