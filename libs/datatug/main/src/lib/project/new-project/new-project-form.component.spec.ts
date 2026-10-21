import { DemoProjectContinuationService } from './demo-project-continuation.service';
import { demoSqliteCatalog } from '../../queries/demo-sqlite-catalog';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { addIcons } from 'ionicons';
import { closeOutline, saveOutline } from 'ionicons/icons';
import { ErrorLogger, type SpaceType } from '@sneat/core';
import { SpaceService } from '@sneat/space-services';
import { SneatAuthStateService, SneatUserService } from '@sneat/auth-core';
import { readGithubProjectId } from '@datatug/project-address';
import type { IProjectRef } from '../../core/project-context';
import { isValidProjectRef } from '../../core/project-context';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { NewProjectFormComponent } from './new-project-form.component';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import { ProjectService } from '../../services/project/project.service';
import { ProjectQueryApiService } from '../../services/project/project-query-api.service';
import { GithubConnectionService } from '../../services/repo/github/github-connection.service';
import type {
  CreateGithubProject,
  PendingGithubProjectSetup,
} from '../../services/project/project-query-api.service';
import {
  saveBusinessGithubContinuation,
  takeBusinessGithubContinuation,
} from './business-github-continuation';

// The app registers its icon set in main.ts. Mirror the icons this real
// template uses so happy-dom renders embedded SVGs instead of fetching them.
addIcons({ closeOutline, saveOutline });

const repo = {
  id: 12,
  owner: 'owner',
  name: 'repo',
  defaultBranch: 'main',
  permission: 'write' as const,
};
const created = {
  operationID: 'operation-id',
  status: 'pending_merge',
  setupPR: {
    url: 'https://github.com/owner/repo/pull/42',
    number: 42,
    headBranch: 'datatug/setup-1',
    baseBranch: 'work',
    commit: 'abcdef0123456789',
    repositoryID: 12,
  },
};
const pendingSetup = {
  operationID: '11111111-1111-4111-8111-111111111111',
  status: 'initializing' as const,
  spaceID: 'space',
  projectID: 'project-id',
  title: 'Project',
  repositoryID: 12,
  owner: 'owner',
  name: 'repo',
  folder: 'datatug',
  branch: 'work',
  ciEnabled: true,
  expectedHead: 'abcdef0123456789',
  templateID: 'demo-project-1',
  templateCommit: '436350d41371103be11144ffa346c605f85e1342',
  billingIntent: 'personal_pro' as const,
  setupPR: undefined,
};
async function harness(
  freshUser = false,
  routeParams: Record<string, string | null> = {},
  authenticated = true,
  preserveDraft = false,
  initialStatus?: 'authenticating' | 'authenticated' | 'notAuthenticated',
  spaceRecords: Record<string, { title?: string; type?: SpaceType }> = freshUser
    ? {}
    : { space: { title: 'My Space' } },
  actorID = 'actor',
) {
  TestBed.resetTestingModule();
  if (!preserveDraft) sessionStorage.removeItem('datatug:new-project:draft');
  const create = vi.fn((...args: unknown[]) => {
    void args;
    return of(created);
  });
  const branches = vi.fn(() =>
    of({ branches: [{ name: 'main', head: 'main-head' }, { name: 'work', head: 'head' }], defaultBranch: 'main' }),
  );
  const createCloud = vi.fn(() => of('cloud-id'));
  const createStatus = vi.fn(() => of({ ...created, status: 'pending_merge' }));
  const pendingGithubProjectSetups = vi.fn(() => of({ setups: [] as PendingGithubProjectSetup[], truncated: false }));
  const githubReauthorizationRequired = new Subject<{ ref: IProjectRef; requiredScopes: readonly ('repo' | 'workflow')[] }>();
  const reportGithubReauthorizationRequired = vi.fn((ref: IProjectRef, requiredScopes: readonly ('repo' | 'workflow')[] = ['repo']) =>
    githubReauthorizationRequired.next({ ref, requiredScopes }));
  const spaceResult = new Subject<{ id: string; dbo: { title: string } }>();
  const startResult = new Subject<{ authorizationURL: string }>();
  const createSpace = vi.fn(() => spaceResult);
  const userState = new BehaviorSubject({
    status:
      initialStatus ?? (authenticated ? 'authenticated' : 'notAuthenticated'),
    user: authenticated ? { uid: actorID } : undefined,
    record: { spaces: spaceRecords },
  });
  const authState = new BehaviorSubject({
    status: authenticated ? 'authenticated' : 'notAuthenticated',
    user: authenticated ? { uid: actorID } : undefined,
  });
  const nav = { goProject: vi.fn() };
  const router = {
    navigate: vi.fn(() => Promise.resolve(true)),
    navigateByUrl: vi.fn(() => Promise.resolve(true)),
    parseUrl: vi.fn((path: string) => ({ path, queryParams: {} as Record<string, unknown> })),
    serializeUrl: vi.fn(),
  };
  const connection = {
    start: vi.fn(() => startResult),
    startOAuth: vi.fn(() => startResult),
    repositories: vi.fn(() => of({ repositories: [repo] })),
    oauthRepositories: vi.fn(() => of({ repositories: [repo] })),
    resolveOAuthRepository: vi.fn(() => of(repo)),
  };
  const signInWith = vi.fn(() => Promise.resolve(undefined));
  TestBed.configureTestingModule({
    imports: [NewProjectFormComponent],
    providers: [
      { provide: SpaceService, useValue: { createSpace } },
      {
        provide: ProjectQueryApiService,
        useValue: {
          create,
          branches,
          createStatus,
          pendingGithubProjectSetups,
          reportGithubReauthorizationRequired,
          githubReauthorizationRequired,
        },
      },
      { provide: ProjectService, useValue: { createNewProject: createCloud } },
      { provide: GithubConnectionService, useValue: connection },
      { provide: SneatAuthStateService, useValue: { signInWith, authState } },
      {
        provide: SneatUserService,
        useValue: { userState },
      },
      { provide: DatatugNavService, useValue: nav },
      { provide: Router, useValue: router },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: { get: (key: string) => routeParams[key] ?? null },
          },
        },
      },
      {
        provide: ErrorLogger,
        useValue: { logError: vi.fn(), logErrorHandler: vi.fn(() => vi.fn()) },
      },
    ],
  }).overrideComponent(NewProjectFormComponent, {
    set: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
  });
  TestBed.overrideProvider(SpaceService, { useValue: { createSpace } });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(NewProjectFormComponent);
  const component = fixture.componentInstance;
  const select = (selectedSpaceID = 'space') => {
    component.store.set('github');
    component.title.set('Project');
    component.spaceID.set(selectedSpaceID);
    component.loadGithubRepos();
    component.repositoryChanged(repo.id);
    component.branch.set('work');
  };
  return {
    fixture,
    component,
    create,
    branches,
    createCloud,
    createStatus,
    pendingGithubProjectSetups,
    reportGithubReauthorizationRequired,
    githubReauthorizationRequired,
    createSpace,
    spaceResult,
    startResult,
    userState,
    authState,
    connection,
    signInWith,
    nav,
    router,
    select,
  };
}

describe('New project through authenticated common API', () => {
  it('offers an explicit plan choice without changing the personal default', async () => {
    const h = await harness(false, { store: 'github' });
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    expect(h.component.billingIntent()).toBe('personal_pro');
    const choice = h.fixture.nativeElement.querySelector('ion-select[aria-label="Project plan"]');
    expect(choice).toBeTruthy();
    h.fixture.debugElement.query(By.css('ion-select[aria-label="Project plan"]')).triggerEventHandler('ngModelChange', 'space_business');
    await h.fixture.whenStable();
    expect(h.component.billingIntent()).toBe('space_business');
    h.component.billingIntentChanged('not-a-plan');
    expect(h.component.billingIntent()).toBe('space_business');
  });

  it('restores explicit Business, Space and edited-database continuation together after auth navigation', async () => {
    const source = { kind: 'github-project' as const, repositoryID: 42, owner: 'datatug', name: 'datatug-demo-project', folder: 'demo-project-1', branch: 'main', commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
    const token = new DemoProjectContinuationService().create({ dataset: 'chinook', canonicalSha256: demoSqliteCatalog.chinook.sha256, table: 'Artist', source });
    const before = await harness(false, { source: JSON.stringify(source), store: 'github', demoContinuation: token });
    before.component.ngOnInit();
    before.component.billingIntentChanged('space_business');
    const draft = JSON.parse(sessionStorage.getItem('datatug:new-project:draft') ?? '{}');
    expect(draft).toMatchObject({ billingIntent: 'space_business', spaceID: 'space', demoContinuation: token, source });
    const after = await harness(false, { store: 'github', oauthResult: 'denied' }, true, true);
    after.component.ngOnInit();
    expect(after.component.billingIntent()).toBe('space_business');
    expect(after.component.spaceID()).toBe('space');
    after.select();
    after.component.create();
    expect(after.create.mock.calls[0][0]).toMatchObject({ billingIntent: 'space_business', spaceID: 'space', source });
    expect(after.create.mock.calls[0][0]).not.toHaveProperty('demoContinuation');
    expect(TestBed.inject(DemoProjectContinuationService).read(token)).toBeDefined();
  });

  it('does not let another actor inherit the draft plan choice', async () => {
    const h = await harness();
    h.component.ngOnInit();
    h.component.billingIntentChanged('space_business');
    h.userState.next({ status: 'authenticated', user: { uid: 'another-actor' }, record: { spaces: { space: { title: 'My Space' } } } });
    expect(h.component.billingIntent()).toBe('personal_pro');
    expect(sessionStorage.getItem('datatug:new-project:draft')).toBeNull();
  });

  it('keeps explicit route billing intent ahead of a restored draft choice', async () => {
    const before = await harness();
    before.component.ngOnInit();
    before.component.billingIntentChanged('space_business');
    const after = await harness(false, { billingIntent: 'personal_pro' }, true, true);
    after.component.ngOnInit();
    expect(after.component.billingIntent()).toBe('personal_pro');
  });

  it.each(['current', 'rediscovered'] as const)('continues the edited database after %s setup reaches merged_ready', async (kind) => {
    const source = { kind: 'github-project' as const, repositoryID: 42, owner: 'datatug', name: 'datatug-demo-project', folder: 'demo-project-1', branch: 'main', commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
    const token = new DemoProjectContinuationService().create({ dataset: 'chinook', canonicalSha256: demoSqliteCatalog.chinook.sha256, table: 'Artist', source });
    const h = await harness(false, { source: JSON.stringify(source), store: 'github', demoContinuation: token });
    h.component.ngOnInit();
    expect(h.component.title()).toBe('Chinook project');
    expect(h.component.githubFolder()).toBe('chinook-datatug');
    expect(h.component.spaceID()).toBe('space');
    h.select();
    h.component.create();
    expect(h.create.mock.calls[0][0]).not.toHaveProperty('demoContinuation');
    expect(JSON.stringify(h.create.mock.calls[0][0])).not.toContain('runtime-');
    if (kind === 'current') {
      h.createStatus.mockReturnValue(of({ ...created, status: 'merged_ready' }) as never);
      h.component['refreshSetupStatus']();
    } else {
      const operation = h.component['operationID']();
      const pending = { ...pendingSetup, operationID: operation as string, source, status: 'pending_merge' as const, setupPR: created.setupPR };
      h.createStatus.mockReturnValue(of({ ...created, status: 'merged_ready' }) as never);
      h.component['pendingGithubSetups'].set([pending]);
      h.component['resumePendingSetup'](pending);
    }
    expect(h.nav.goProject).not.toHaveBeenCalled();
    expect(h.router.navigateByUrl).toHaveBeenCalledWith(expect.objectContaining({ queryParams: expect.objectContaining({ demoContinuation: token, branch: 'work', projectApi: 'cloud' }) }), { replaceUrl: true });
    const continued = TestBed.inject(DemoProjectContinuationService).read(token);
    expect(continued).toMatchObject({ actorID: 'actor', destination: { projectApi: 'cloud', branch: 'work' }, table: 'Artist' });
  });

  it('keeps missing browser continuation visible when a copied demo setup is rediscovered', async () => {
    const h = await harness();
    h.component.ngOnInit();
    const source = { kind: 'github-project' as const, repositoryID: 42, owner: 'datatug', name: 'datatug-demo-project', folder: 'demo-project-1', branch: 'main', commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
    const pending = { ...pendingSetup, source, status: 'pending_merge' as const, setupPR: created.setupPR };
    h.createStatus.mockReturnValue(of({ ...created, status: 'merged_ready' }) as never);
    h.component['pendingGithubSetups'].set([pending]);
    h.component['resumePendingSetup'](pending);
    expect(h.component['pendingGithubSetupErrors']()[pending.operationID]).toContain('continuation is unavailable');
    expect(h.component['pendingGithubSetups']()).toContain(pending);
    expect(h.nav.goProject).not.toHaveBeenCalled();
    expect(h.router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('copies the selected immutable source and restores it after refresh', async () => {
    const source = { kind: 'github-project', repositoryID: 42, owner: 'datatug', name: 'datatug-demo-project', folder: 'demo-project-1', branch: 'main', commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
    const h = await harness(false, { source: JSON.stringify(source), store: 'github' });
    h.component.ngOnInit();
    h.select();
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    expect(h.fixture.nativeElement.querySelector('ion-title').textContent).toBe('Copy DataTug Project');
    h.component.create();
    expect(h.create.mock.calls[0][0]).toMatchObject({ source });
    expect(h.create.mock.calls[0][0]).not.toHaveProperty('template');
    expect(JSON.parse(sessionStorage.getItem('datatug:new-project:draft') ?? 'null').source).toEqual(source);
    const restored = await harness(false, { store: 'github' }, true, true);
    restored.component.ngOnInit();
    expect(restored.component.copySource()).toEqual(source);
  });

  it('retains creation labels when no copy source is selected', async () => {
    const h = await harness();
    h.component.ngOnInit();
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    expect(h.fixture.nativeElement.querySelector('ion-title').textContent).toBe('New DataTug Project');
  });

  it('preserves the demo cancel path through denied OAuth and a refresh', async () => {
    const h = await harness(false, { store: 'github', returnUrl: '/demo/sqlite/chinook' });
    h.component.ngOnInit();
    h.select();
    h.component['saveDraft']();
    const callback = await harness(false, { store: 'github', oauthResult: 'denied' }, true, true);
    callback.component.ngOnInit();
    expect(JSON.parse(sessionStorage.getItem('datatug:new-project:draft') ?? 'null').returnUrl).toBe('/demo/sqlite/chinook');
    const refreshed = await harness(false, { store: 'github' }, true, true);
    refreshed.component.ngOnInit();
    refreshed.component.cancel();
    expect(refreshed.router.navigateByUrl).toHaveBeenCalledWith('/demo/sqlite/chinook', { replaceUrl: true });
  });

  it('keeps explicit copy intent after deferred actor draft restoration', async () => {
    const prior = await harness();
    prior.select();
    prior.component['saveDraft']();
    const source = { kind: 'github-project', repositoryID: 42, owner: 'datatug', name: 'demo', folder: 'demo-project-1', branch: 'main', commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
    const h = await harness(false, { source: JSON.stringify(source), store: 'github' }, false, true, 'authenticating');
    h.component.ngOnInit();
    expect(h.component.copySource()).toEqual(source);
    h.userState.next({ status: 'authenticated', user: { uid: 'actor' }, record: { spaces: { space: { title: 'My Space' } } } });
    h.select();
    h.component.create();
    expect(h.create.mock.calls[0][0]).toMatchObject({ source });
    expect(h.create.mock.calls[0][0]).not.toHaveProperty('template');
  });

  it('replays pending copies with the exact source and no template fallback', async () => {
    const source = { kind: 'github-project' as const, repositoryID: 42, owner: 'source', name: 'project', folder: 'demo', branch: 'main', commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
    const h = await harness();
    const setup = { ...pendingSetup, source, templateID: '', templateCommit: '' };
    h.pendingGithubProjectSetups.mockReturnValue(of({ setups: [setup], truncated: false }));
    h.component['reloadPendingGithubSetups']();
    h.component['resumePendingSetup'](setup);
    expect(h.create.mock.calls[0][0]).toMatchObject({ source });
    expect(h.create.mock.calls[0][0]).not.toHaveProperty('template');
  });

  it('rejects invalid copy intent instead of falling back to the template', async () => {
    const h = await harness(false, { source: '{}', store: 'github' });
    h.component.ngOnInit();
    h.select();
    h.component.create();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('rediscovers and replays the same initializing setup after session storage is gone', async () => {
    const h = await harness();
    h.pendingGithubProjectSetups.mockReturnValue(of({ setups: [pendingSetup], truncated: false }));
    h.component['reloadPendingGithubSetups']();
    h.fixture.detectChanges();

    expect(sessionStorage.getItem('datatug:new-project:draft')).toBeNull();
    expect(h.fixture.nativeElement.textContent).toContain('Pending GitHub project setups');
    expect(h.fixture.nativeElement.textContent).toContain('Resume setup request');
    h.component['resumePendingSetup'](pendingSetup);

    expect(h.create).toHaveBeenCalledWith({
      title: 'Project',
      spaceID: 'space',
      billingIntent: 'personal_pro',
      operationID: pendingSetup.operationID,
      ciEnabled: true,
      github: {
        repositoryID: 12,
        owner: 'owner',
        name: 'repo',
        folder: 'datatug',
        branch: 'work',
        expectedBranchHead: pendingSetup.expectedHead,
      },
      template: { id: 'demo-project-1', commit: '436350d41371103be11144ffa346c605f85e1342' },
    });
    expect(h.component['pendingGithubSetups']()[0]).toMatchObject({
      operationID: pendingSetup.operationID,
      status: 'pending_merge',
      setupPR: created.setupPR,
    });
  });

  it('checks proof for a rediscovered setup and opens the project only after merged_ready', async () => {
    const h = await harness();
    const pending = { ...pendingSetup, status: 'pending_merge' as const, setupPR: created.setupPR };
    h.pendingGithubProjectSetups.mockReturnValue(of({ setups: [pending], truncated: true }));
    h.createStatus.mockReturnValue(of({ ...created, status: 'merged_ready', projectID: 'project-id' }) as never);
    h.fixture.detectChanges();
    h.component['reloadPendingGithubSetups']();
    expect(h.component['pendingGithubSetups']()).toHaveLength(1);
    h.component['resumePendingSetup'](pending);

    expect(h.component['pendingGithubSetupErrors']()[pending.operationID]).toBeUndefined();
    expect(h.createStatus).toHaveBeenCalledWith({
      operationID: pending.operationID,
      repositoryID: pending.repositoryID,
      owner: pending.owner,
      name: pending.name,
    });
    expect(h.nav.goProject).toHaveBeenCalledWith(
      expect.objectContaining({ ref: expect.objectContaining({
        storeId: 'github.com',
        projectId: 'repo@owner@datatug',
        projectApi: 'cloud',
        branch: 'work',
      }) }),
      undefined,
      { replaceUrl: true },
    );
    expect(isValidProjectRef(h.nav.goProject.mock.calls[0][0].ref)).toBe(true);
    expect(h.component['pendingGithubSetups']()).toEqual([]);
  });

  it('requests combined scopes when replaying a CI setup requires workflow authorization', async () => {
    const h = await harness();
    h.pendingGithubProjectSetups.mockReturnValue(of({ setups: [pendingSetup], truncated: false }));
    h.create.mockReturnValue(throwError(() => ({
      status: 409,
      error: { error: { code: 'workflow_scope_required' } },
    })) as never);
    h.component['reloadPendingGithubSetups']();
    h.component['resumePendingSetup'](pendingSetup);

    expect(h.reportGithubReauthorizationRequired).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'github.com', projectId: 'repo@owner@datatug' }),
      ['repo', 'workflow'],
    );
    expect(h.component['isRefreshingPendingSetup'](pendingSetup)).toBe(false);
    const reauthRef = h.reportGithubReauthorizationRequired.mock.calls[0][0];
    expect(isValidProjectRef(reauthRef)).toBe(true);
    expect(reauthRef).not.toHaveProperty('spaceID');
  });

  it('ignores a delayed discovered status after the signed-in actor changes', async () => {
    const h = await harness();
    const delayedStatus = new Subject<typeof created>();
    const pending = { ...pendingSetup, status: 'pending_merge' as const, setupPR: created.setupPR };
    h.pendingGithubProjectSetups.mockReturnValue(of({ setups: [pending], truncated: false }));
    h.createStatus.mockReturnValue(delayedStatus as never);
    h.component['reloadPendingGithubSetups']();
    h.component['resumePendingSetup'](pending);
    h.pendingGithubProjectSetups.mockReturnValue(of({ setups: [], truncated: false }));
    h.userState.next({
      status: 'authenticated',
      user: { uid: 'actor-b' },
      record: { spaces: { space: { title: 'Other Space' } } },
    });
    delayedStatus.next({ ...created, status: 'merged_ready', projectID: 'project-id' } as never);

    expect(h.nav.goProject).not.toHaveBeenCalled();
    expect(h.component['pendingGithubSetups']()).toEqual([]);
  });

  it('ignores a delayed pending-setup discovery after the signed-in actor changes', async () => {
    const h = await harness();
    const delayedList = new Subject<{ setups: PendingGithubProjectSetup[]; truncated: boolean }>();
    h.pendingGithubProjectSetups.mockReturnValue(delayedList as never);
    h.component['reloadPendingGithubSetups']();
    h.pendingGithubProjectSetups.mockReturnValue(of({ setups: [], truncated: false }));
    h.userState.next({
      status: 'authenticated',
      user: { uid: 'actor-b' },
      record: { spaces: { space: { title: 'Other Space' } } },
    });
    delayedList.next({ setups: [pendingSetup], truncated: false });

    expect(h.component['pendingGithubSetups']()).toEqual([]);
  });

  it('ignores a delayed replay result after the signed-in actor changes', async () => {
    const h = await harness();
    const delayedCreate = new Subject<typeof created>();
    h.pendingGithubProjectSetups.mockReturnValue(of({ setups: [pendingSetup], truncated: false }));
    h.create.mockReturnValue(delayedCreate as never);
    h.component['reloadPendingGithubSetups']();
    h.component['resumePendingSetup'](pendingSetup);
    h.pendingGithubProjectSetups.mockReturnValue(of({ setups: [], truncated: false }));
    h.userState.next({
      status: 'authenticated',
      user: { uid: 'actor-b' },
      record: { spaces: { space: { title: 'Other Space' } } },
    });
    delayedCreate.next(created);

    expect(h.component['pendingGithubSetups']()).toEqual([]);
    expect(h.component['isRefreshingPendingSetup'](pendingSetup)).toBe(false);
    expect(h.nav.goProject).not.toHaveBeenCalled();
  });

  it('ignores a delayed replay error after the signed-in actor changes', async () => {
    const h = await harness();
    const delayedCreate = new Subject<typeof created>();
    h.pendingGithubProjectSetups.mockReturnValue(of({ setups: [pendingSetup], truncated: false }));
    h.create.mockReturnValue(delayedCreate as never);
    h.component['reloadPendingGithubSetups']();
    h.component['resumePendingSetup'](pendingSetup);
    h.pendingGithubProjectSetups.mockReturnValue(of({ setups: [], truncated: false }));
    h.userState.next({
      status: 'authenticated',
      user: { uid: 'actor-b' },
      record: { spaces: { space: { title: 'Other Space' } } },
    });
    delayedCreate.error({ status: 409, error: { error: { code: 'workflow_scope_required' } } });

    expect(h.component['pendingGithubSetupErrors']()).toEqual({});
    expect(h.reportGithubReauthorizationRequired).not.toHaveBeenCalled();
    expect(h.nav.goProject).not.toHaveBeenCalled();
  });

  it('renders nonblank Space labels using named title, type and exact ID fallbacks without changing selection', async () => {
    const h = await harness(false, { store: 'github', spaceID: 'personal-space' }, true, false, undefined, {
      named: { title: '  Team Data  ', type: 'group' },
      'personal-space': { title: '  ', type: 'personal' },
      'untitled-space': {},
    });
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    const picker = h.fixture.debugElement.queryAll(By.css('ion-select'))
      .find(select => select.componentInstance.value === 'personal-space');
    expect(picker).toBeTruthy();
    const options = Array.from(picker?.nativeElement.querySelectorAll('ion-select-option') ?? []) as HTMLElement[];
    expect(options.map(option => option.textContent?.trim())).toEqual(['Team Data', 'Personal', 'untitled-space']);
    expect(options.map(option => (option as unknown as { value: string }).value)).toEqual(['named', 'personal-space', 'untitled-space']);
    expect(h.component.spaceID()).toBe('personal-space');
  });

  it('keeps the untitled Space ID and existing Personal Pro intent in the create payload', async () => {
    const h = await harness(false, { store: 'github' }, true, false, undefined, {
      'personal-space': { title: '', type: 'personal' },
    });
    h.select('personal-space');
    h.component.create();
    await vi.waitFor(() => expect(h.create).toHaveBeenCalledOnce());
    expect(h.create.mock.calls[0][0]).toMatchObject({ spaceID: 'personal-space', billingIntent: 'personal_pro' });
  });

  it('preselects a requested checkout Space only when it belongs to the signed-in user', async () => {
    const h = await harness(false, { spaceID: 'space' });
    expect(h.component.spaceID()).toBe('space');

    const other = await harness(true, { spaceID: 'space' });
    expect(other.component.spaceID()).toBe('');
  });

  it('keeps a valid checkout Space over a same-actor draft for Cloud creation', async () => {
    sessionStorage.setItem(
      'datatug:new-project:draft',
      JSON.stringify({
        actorID: 'actor',
        store: 'cloud',
        title: 'Saved project',
        githubFolder: 'datatug',
        spaceID: 'B',
        spaceTitle: '',
      }),
    );
    const h = await harness(
      false,
      { spaceID: 'A', billingIntent: 'space_business' },
      true,
      true,
      undefined,
      { A: { title: 'Space A' }, B: { title: 'Space B' } },
    );
    h.fixture.detectChanges();
    expect(h.component.spaceID()).toBe('A');
    h.component.create();
    expect(h.createCloud).toHaveBeenCalledWith('firestore', {
      title: 'Saved project',
      userIDs: [],
      billingIntent: 'space_business',
      spaceID: 'A',
    });
  });

  it('keeps a valid checkout Space over a deferred same-actor draft for GitHub creation', async () => {
    sessionStorage.setItem(
      'datatug:new-project:draft',
      JSON.stringify({
        actorID: 'actor',
        store: 'github',
        title: 'Saved project',
        githubFolder: 'datatug',
        spaceID: 'B',
        spaceTitle: '',
      }),
    );
    const h = await harness(
      false,
      {
        store: 'github',
        spaceID: 'A',
        billingIntent: 'space_business',
      },
      false,
      true,
      'authenticating',
      {},
    );
    h.fixture.detectChanges();
    expect(h.component.spaceID()).toBe('');
    h.userState.next({
      status: 'authenticated',
      user: { uid: 'actor' },
      record: { spaces: { A: { title: 'Space A' }, B: { title: 'Space B' } } },
    });
    await h.fixture.whenStable();
    expect(h.component.spaceID()).toBe('A');
    h.select('A');
    h.component.create();
    expect(h.create.mock.calls[0][0]).toMatchObject({
      spaceID: 'A',
      billingIntent: 'space_business',
    });
  });

  it('saves actor-bound Business context before leaving for GitHub without storing credentials', async () => {
    const h = await harness(false, {
      store: 'github',
      spaceID: 'space',
      billingIntent: 'space_business',
    });
    h.component.title.set('Business project');
    h.component.githubFolder.set('demo-project-1');
    h.component.signInToGithub();

    expect(h.connection.start).toHaveBeenCalledTimes(1);
    expect(takeBusinessGithubContinuation('actor')).toEqual({
      billingIntent: 'space_business',
      spaceID: 'space',
    });
    expect(
      JSON.stringify(
        Object.keys(sessionStorage).map((key) => sessionStorage.getItem(key)),
      ),
    ).not.toMatch(/token|secret|authorizationURL/i);
  });

  it('clears abandoned Business context when the actor starts personal GitHub OAuth', async () => {
    expect(saveBusinessGithubContinuation('actor', 'space')).toBe(true);
    const h = await harness(false, { store: 'github' });

    h.component.signInToGithub();

    expect(h.connection.start).toHaveBeenCalledTimes(1);
    expect(takeBusinessGithubContinuation('actor')).toBeUndefined();
  });

  it('forwards the Business billing intent and selected Space to shared project creation', async () => {
    const h = await harness(false, {
      spaceID: 'space',
      billingIntent: 'space_business',
    });
    h.component.title.set('Business project');
    h.component.create();
    expect(h.createCloud).toHaveBeenCalledWith('firestore', {
      title: 'Business project',
      userIDs: [],
      billingIntent: 'space_business',
      spaceID: 'space',
    });
  });

  it('loads a GitHub deep link from URL context and returns to its safe internal page', async () => {
    const h = await harness(false, {
      store: 'github',
      returnUrl: '/store/github.com?code=must-not-replay#repos',
    });
    h.fixture.detectChanges();
    expect(h.component.store()).toBe('github');
    expect(h.connection.oauthRepositories).toHaveBeenCalledTimes(1);
    h.component.cancel();
    expect(h.router.navigateByUrl).toHaveBeenCalledWith('/store/github.com', {
      replaceUrl: true,
    });
  });

  it('lets a signed-out visitor fill, save and resume the form at the sign-in step', async () => {
    const h = await harness(false, { store: 'github' }, false);
    h.fixture.detectChanges();
    h.component.title.set('Saved project');
    h.component.githubFolder.set('demo-project-1');
    h.component.create();
    h.fixture.detectChanges();

    expect(h.create).not.toHaveBeenCalled();
    expect(h.createCloud).not.toHaveBeenCalled();
    expect(h.fixture.nativeElement.innerHTML).toContain(
      'Sign in to create your project',
    );
    const saved = JSON.parse(
      sessionStorage.getItem('datatug:new-project:draft') ?? 'null',
    );
    expect(saved).toMatchObject({
      store: 'github',
      title: 'Saved project',
      githubFolder: 'demo-project-1',
    });
    expect(saved.actorID).toBeUndefined();
    expect(JSON.stringify(saved)).not.toContain('token');

    const buttons = h.fixture.nativeElement.querySelectorAll(
      'ion-button',
    ) as NodeListOf<HTMLElement>;
    const signIn = Array.from(buttons).find((button) =>
      button.textContent?.includes('Sign in to continue'),
    ) as HTMLElement | undefined;
    signIn?.click();
    await h.fixture.whenStable();
    expect(h.signInWith).toHaveBeenCalledWith('google.com');

    const resumed = await harness(false, { store: 'github' }, true, true);
    resumed.fixture.detectChanges();
    expect(resumed.component.store()).toBe('github');
    expect(resumed.component.title()).toBe('Saved project');
    expect(resumed.component.githubFolder()).toBe('demo-project-1');
    expect(
      JSON.parse(sessionStorage.getItem('datatug:new-project:draft') ?? 'null')
        .actorID,
    ).toBe('actor');
  });

  it('keeps the saved Space name when sign-in completes in the same page', async () => {
    const h = await harness(false, {}, false);
    h.component.title.set('Shared project');
    h.component.spaceTitle.set('First Space');
    h.component.create();
    expect(h.component['signInMessage']()).toContain('Sign in to create');

    h.userState.next({
      status: 'authenticated',
      user: { uid: 'actor' },
      record: { spaces: {} },
    });

    expect(h.component.spaceTitle()).toBe('First Space');
  });

  it('clears account-bound draft state when the signed-in user changes', async () => {
    const h = await harness();
    sessionStorage.setItem(
      'datatug:new-project:draft',
      JSON.stringify({
        store: 'github',
        title: 'Account A project',
        githubFolder: 'private-folder',
        spaceID: 'space',
        spaceTitle: 'Private Space',
        repositoryID: 12,
        branch: 'work',
      }),
    );
    h.fixture.detectChanges();
    expect(h.component.title()).toBe('Account A project');
    expect(h.component.spaceID()).toBe('space');

    h.userState.next({
      status: 'authenticated',
      user: { uid: 'different-actor' },
      record: { spaces: {} },
    });

    expect(h.component.title()).toBe('');
    expect(h.component.spaceID()).toBe('');
    expect(h.component.spaceTitle()).toBe('');
    expect(sessionStorage.getItem('datatug:new-project:draft')).toBeNull();
  });

  it('discards another signed-in account draft on cold entry', async () => {
    sessionStorage.setItem(
      'datatug:new-project:draft',
      JSON.stringify({
        actorID: 'account-a',
        store: 'github',
        title: 'Account A project',
        githubFolder: 'private-folder',
        spaceID: 'space',
        spaceTitle: 'Private Space',
        repositoryID: 12,
        branch: 'work',
      }),
    );
    const h = await harness(false, {}, true, true);
    h.fixture.detectChanges();

    expect(h.component.title()).toBe('');
    expect(h.component.githubFolder()).toBe('datatug');
    expect(h.component.spaceTitle()).toBe('');
    expect(h.component.spaceID()).toBe('');
    expect(sessionStorage.getItem('datatug:new-project:draft')).toBeNull();
  });

  it('waits for auth restoration before showing an actor-bound draft', async () => {
    sessionStorage.setItem(
      'datatug:new-project:draft',
      JSON.stringify({
        actorID: 'actor',
        store: 'github',
        title: 'My private draft',
        githubFolder: 'datatug',
        spaceTitle: '',
      }),
    );
    const h = await harness(false, {}, false, true, 'authenticating');
    h.fixture.detectChanges();
    expect(h.component.title()).toBe('');
    expect(sessionStorage.getItem('datatug:new-project:draft')).not.toBeNull();

    h.userState.next({
      status: 'authenticated',
      user: { uid: 'actor' },
      record: { spaces: {} },
    });
    // Let the signal notify zoneless change detection; do not manually repaint.
    await h.fixture.whenStable();
    expect(h.component.title()).toBe('My private draft');
    expect(h.component.store()).toBe('github');
    expect(h.connection.oauthRepositories).toHaveBeenCalledTimes(1);
    const titleInput = h.fixture.nativeElement.querySelector(
      'ion-input[placeholder="is required"]',
    ) as (HTMLElement & { value?: string }) | null;
    expect(titleInput?.value).toBe('My private draft');
  });

  it('guides an empty GitHub repository list to a URL fallback and refresh', async () => {
    const h = await harness();
    h.component.store.set('github');
    h.connection.oauthRepositories.mockReturnValue(of({ repositories: [] }));
    h.component.loadGithubRepos();
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    h.fixture.detectChanges();
    expect(h.component['isGithubSignedIn']()).toBe(true);
    expect(h.component['githubRepos']()).toHaveLength(0);

    expect(
      h.fixture.nativeElement.querySelector(
        'ion-input[aria-label="GitHub repository URL"]',
      ),
    ).toBeTruthy();
    expect(h.fixture.nativeElement.innerHTML).toContain(
      'No connected repositories are listed yet',
    );
    expect(h.fixture.nativeElement.textContent).toContain(
      'Refresh connected repositories',
    );

    const pendingRefresh = new Subject<{
      repositories: (typeof repo)[];
    }>();
    h.connection.oauthRepositories.mockReturnValue(pendingRefresh as never);
    h.component.loadGithubRepos();
    h.fixture.detectChanges();
    expect(h.component['isGithubSignedIn']()).toBe(true);
    expect(h.component['isLoadingRepos']()).toBe(true);
    expect(h.fixture.nativeElement.innerHTML).not.toContain(
      'No connected repositories are listed yet',
    );

    pendingRefresh.error({ status: 503 });
    await h.fixture.whenStable();
    h.fixture.detectChanges();
    expect(h.component['githubReposError']()).toContain(
      'Could not load connected GitHub repositories',
    );
    expect(h.fixture.nativeElement.innerHTML).not.toContain(
      'No connected repositories are listed yet',
    );

    h.connection.oauthRepositories.mockReturnValue(of({ repositories: [] }));
    h.component.loadGithubRepos();
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    h.fixture.detectChanges();
    expect(h.fixture.nativeElement.innerHTML).toContain(
      'No connected repositories are listed yet',
    );

    h.connection.oauthRepositories.mockReturnValue(of({ repositories: [repo] }));
    h.component.loadGithubRepos();
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    h.fixture.detectChanges();
    expect(h.fixture.nativeElement.innerHTML).not.toContain(
      'No connected repositories are listed yet',
    );
    expect(h.fixture.nativeElement.textContent).toContain('owner/repo');
  });
  it('explains a failed GitHub repository refresh and clears only that error after a successful retry', async () => {
    const h = await harness();
    const repositories = new Subject<{ repositories: (typeof repo)[] }>();
    h.connection.oauthRepositories.mockReturnValue(repositories as never);
    h.component.store.set('github');
    h.fixture.detectChanges();

    repositories.error({ status: 503 });
    await h.fixture.whenStable();
    h.fixture.detectChanges();
    expect(h.fixture.nativeElement.textContent).toContain(
      'Could not load connected GitHub repositories',
    );
    expect(h.fixture.nativeElement.textContent).toContain(
      'Enter the repository URL',
    );
    expect(h.component['isGithubSignedIn']()).toBe(false);
    expect(h.component['isLoadingRepos']()).toBe(false);

    h.component['formError'].set('Branches could not be loaded.');
    h.connection.oauthRepositories.mockReturnValue(of({ repositories: [repo] }));
    h.component.loadGithubRepos();
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    expect(h.fixture.nativeElement.textContent).not.toContain(
      'Could not load connected GitHub repositories',
    );
    expect(h.fixture.nativeElement.textContent).toContain(
      'Branches could not be loaded.',
    );
    expect(h.component['githubReposError']()).toBeUndefined();
    expect(h.component['isGithubSignedIn']()).toBe(true);
    expect(h.fixture.nativeElement.textContent).toContain('owner/repo');
  });
  it('lets a fresh signed-in user create/select a top-level group Space through the existing Sneat API before GitHub project creation', async () => {
    const h = await harness(true);
    h.component.store.set('github');
    h.component.title.set('Project');
    h.component.loadGithubRepos();
    h.component.repositoryChanged(repo.id);
    h.component.branch.set('work');
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    expect(h.component.spaceID()).toBe('');
    expect(h.fixture.nativeElement.textContent).toContain('Create Space');
    h.component.create();
    expect(h.create).not.toHaveBeenCalled();
    h.component.spaceTitle.set('First Space');
    h.component.createSpace();
    expect(h.createSpace).toHaveBeenCalledWith({
      type: 'group',
      title: 'First Space',
    });
    h.spaceResult.next({ id: 'fresh-space', dbo: { title: 'First Space' } });
    await h.fixture.whenStable();
    expect(h.component.spaceID()).toBe('fresh-space');
    expect(h.fixture.nativeElement.textContent).toContain('First Space');
    h.component.create();
    expect(h.create.mock.calls[0][0]).toMatchObject({ spaceID: 'fresh-space' });
  });
  it('creates and selects a company Space for Business GitHub project setup', async () => {
    const h = await harness(true, { billingIntent: 'space_business' });
    h.select();
    await h.fixture.whenStable();

    expect(h.component['billingIntent']()).toBe('space_business');
    h.component.spaceTitle.set('Business Space');
    h.component.createSpace();
    expect(h.createSpace).toHaveBeenCalledWith({
      type: 'company',
      title: 'Business Space',
    });

    h.spaceResult.next({
      id: 'business-space',
      dbo: { title: 'Business Space' },
    });
    await h.fixture.whenStable();
    expect(h.component.spaceID()).toBe('business-space');

    h.component.create();
    expect(h.create.mock.calls[0][0]).toMatchObject({
      spaceID: 'business-space',
      billingIntent: 'space_business',
    });
  });
  it('shows a recoverable Space creation error without issuing a project write', async () => {
    const h = await harness(true);
    h.component.store.set('github');
    h.fixture.detectChanges();
    h.component.spaceTitle.set('First Space');
    h.component.createSpace();
    h.spaceResult.error({ status: 503 });
    await h.fixture.whenStable();
    expect(h.fixture.nativeElement.textContent).toContain(
      'Space could not be created',
    );
    expect(h.component.isCreatingSpace()).toBe(false);
    expect(h.create).not.toHaveBeenCalled();
  });
  it('preserves the existing personal Cloud create contract', async () => {
    const h = await harness();
    h.component.title.set('Cloud');
    h.component.create();
    expect(h.createCloud).toHaveBeenCalledWith('firestore', {
      title: 'Cloud',
      userIDs: [],
      billingIntent: 'personal_pro',
    });
    expect(h.nav.goProject.mock.calls[0][0].ref).toEqual({
      storeId: 'firestore',
      projectId: 'cloud-id',
    });
    expect(h.nav.goProject.mock.calls[0][2]).toEqual({ replaceUrl: true });
    expect(h.create).not.toHaveBeenCalled();
  });
  it('creates on the explicitly chosen repository/Space/branch and shows the pending setup pull request', async () => {
    const h = await harness();
    h.select();
    h.component.create();
    expect(h.create.mock.calls[0][0]).toMatchObject({
      title: 'Project',
      spaceID: 'space',
      billingIntent: 'personal_pro',
      operationID: expect.any(String),
      ciEnabled: true,
      github: {
        repositoryID: 12,
        owner: 'owner',
        name: 'repo',
        folder: 'datatug',
        branch: 'work',
        expectedBranchHead: 'head',
      },
      template: {
        id: 'demo-project-1',
        commit: '436350d41371103be11144ffa346c605f85e1342',
      },
    });
    expect(h.component['setupStatus']()).toBe('pending_merge');
    expect(h.component['setupPR']()).toEqual({
      url: created.setupPR.url,
      number: created.setupPR.number,
    });
    expect(h.nav.goProject).not.toHaveBeenCalled();
    expect(h.createCloud).not.toHaveBeenCalled();
    h.fixture.detectChanges();
    expect(h.fixture.nativeElement.textContent).toContain('Project setup awaiting merge');
    expect(h.fixture.nativeElement.textContent).toContain('Open setup pull request #42');
    expect(h.fixture.nativeElement.textContent).not.toContain('Create new project');
    h.component.create();
    expect(h.create).toHaveBeenCalledTimes(1);
    h.component.cancel();
    expect(sessionStorage.getItem('datatug:new-project:draft')).toBeTruthy();
  });

  it('starts a fresh operation and resolves a fresh branch head after a setup PR closes unmerged', async () => {
    const h = await harness();
    h.select();
    h.component.create();
    const firstRequest = h.create.mock.calls[0][0] as { operationID: string; github: { expectedBranchHead: string } };
    h.component['setupStatus'].set('closed_unmerged');
    h.branches.mockReturnValue(of({ branches: [{ name: 'work', head: 'new-head' }], defaultBranch: 'work' }));
    h.component['retryClosedSetup']();
    const retryRequest = h.create.mock.calls[1][0] as { operationID: string; github: { expectedBranchHead: string } };
    expect(retryRequest.operationID).not.toBe(firstRequest.operationID);
    expect(retryRequest.github.expectedBranchHead).toBe('new-head');
  });

  it('resolves a private repository URL after OAuth and sends one setup request with CI enabled', async () => {
    const h = await harness();
    h.component.store.set('github');
    h.component.title.set('Project');
    h.component.spaceID.set('space');
    h.component.githubRepositoryURL.set('https://github.com/owner/repo');
    h.component.create();

    expect(h.connection.resolveOAuthRepository).toHaveBeenCalledWith(
      'owner',
      'repo',
    );
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        operationID: expect.any(String),
        ciEnabled: true,
        github: expect.objectContaining({
          repositoryID: 12,
          branch: 'main',
          expectedBranchHead: 'main-head',
        }),
      }),
    );
    expect(h.component['setupStatus']()).toBe('pending_merge');
  });

  it('requests account-wide repo and workflow OAuth scopes together when CI is enabled', async () => {
    const h = await harness();
    h.select();
    h.connection.resolveOAuthRepository.mockReturnValue(
      throwError(() => ({ status: 401, error: { error: { code: 'authorization_required' } } })),
    );
    h.component.create();

    expect(h.connection.startOAuth).toHaveBeenCalledWith({
      operationID: expect.any(String),
      owner: 'owner',
      repository: 'repo',
      requiredScopes: ['repo', 'workflow'],
    });
    const draft = JSON.parse(
      sessionStorage.getItem('datatug:new-project:draft') ?? 'null',
    );
    expect(draft).toMatchObject({
      actorID: 'actor',
      ciEnabled: true,
      oauthResumePending: true,
      operationID: expect.any(String),
    });
  });

  it('restarts OAuth with both scopes when create discovers a missing workflow permission', async () => {
    const h = await harness();
    h.select();
    h.create.mockReturnValue(
      throwError(() => ({ status: 409, error: { error: { code: 'workflow_scope_required' } } })) as never,
    );
    h.component.create();

    expect(h.connection.startOAuth).toHaveBeenCalledWith({
      operationID: expect.any(String),
      owner: 'owner',
      repository: 'repo',
      requiredScopes: ['repo', 'workflow'],
    });
  });

  it('fails closed when the OAuth redirect draft cannot be persisted', async () => {
    const h = await harness();
    h.select();
    h.connection.resolveOAuthRepository.mockReturnValue(
      throwError(() => ({ status: 401, error: { error: { code: 'authorization_required' } } })),
    );
    const setItem = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('storage blocked', 'SecurityError');
    });
    h.component.create();

    expect(h.component['formError']()).toContain('could not be saved for the GitHub redirect');
    expect(h.component['oauthState']()).toBeUndefined();
    expect(h.component['oauthResumePending']()).toBe(false);
    expect(h.connection.startOAuth).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('reenables the form when saving the returned OAuth state fails', async () => {
    const h = await harness();
    h.select();
    h.connection.resolveOAuthRepository.mockReturnValue(
      throwError(() => ({ status: 401, error: { error: { code: 'authorization_required' } } })),
    );
    let writes = 0;
    const originalSetItem = sessionStorage.setItem.bind(sessionStorage);
    const setItem = vi.spyOn(sessionStorage, 'setItem').mockImplementation((key, value) => {
      writes++;
      if (writes === 4) throw new DOMException('storage blocked', 'SecurityError');
      originalSetItem(key, value);
    });
    h.component.create();
    h.startResult.next({
      authorizationURL: 'https://github.com/login/oauth/authorize?state=secure-state',
    });

    expect(writes).toBe(4);
    expect(h.component['isCreating']()).toBe(false);
    expect(h.component['oauthState']()).toBeUndefined();
    expect(h.component['formError']()).toContain('could not be saved for the GitHub redirect');
    setItem.mockRestore();
  });

  it('ignores a delayed OAuth start response after the Firebase actor changes', async () => {
    const h = await harness();
    h.select();
    h.connection.resolveOAuthRepository.mockReturnValue(
      throwError(() => ({ status: 401, error: { error: { code: 'authorization_required' } } })),
    );
    h.component.create();
    h.userState.next({
      status: 'authenticated',
      user: { uid: 'actor-b' },
      record: { spaces: { space: { title: 'Other Space' } } },
    });
    h.startResult.next({
      authorizationURL: 'https://github.com/login/oauth/authorize?state=secure-state',
    });

    expect(h.component['oauthState']()).toBeUndefined();
    expect(h.component['isCreating']()).toBe(false);
    expect(sessionStorage.getItem('datatug:new-project:draft')).toBeNull();
  });

  it('keeps the draft and explains when OAuth is not configured for the environment', async () => {
    const h = await harness();
    h.select();
    h.connection.resolveOAuthRepository.mockReturnValue(
      throwError(() => ({ status: 401, error: { error: { code: 'authorization_required' } } })),
    );
    h.component.create();
    h.startResult.error({ status: 503, error: { error: { code: 'unavailable' } } });

    expect(h.component['formError']()).toContain('not configured for this environment');
    expect(h.component['isCreating']()).toBe(false);
    expect(JSON.parse(sessionStorage.getItem('datatug:new-project:draft') ?? 'null')).toMatchObject({
      actorID: 'actor',
      operationID: expect.any(String),
      oauthResumePending: false,
    });
  });

  it('ignores a delayed workflow-scope create error after the Firebase actor changes', async () => {
    const h = await harness();
    h.select();
    const pendingCreate = new Subject<typeof created>();
    h.create.mockReturnValue(pendingCreate as never);
    h.component.create();
    h.userState.next({
      status: 'authenticated',
      user: { uid: 'actor-b' },
      record: { spaces: { space: { title: 'Other Space' } } },
    });
    pendingCreate.error({
      status: 409,
      error: { error: { code: 'workflow_scope_required' } },
    });

    expect(h.connection.startOAuth).not.toHaveBeenCalled();
    expect(h.component['oauthResumePending']()).toBe(false);
  });

  it('does not navigate from a delayed merged status after the Firebase actor changes', async () => {
    const h = await harness();
    h.select();
    h.component.create();
    const status = new Subject<{ operationID: string; status: 'merged_ready'; projectID: string; setupPR: typeof created.setupPR }>();
    h.createStatus.mockReturnValue(status as never);

    h.component['refreshSetupStatus']();
    h.userState.next({
      status: 'authenticated',
      user: { uid: 'actor-b' },
      record: { spaces: { space: { title: 'Other Space' } } },
    });
    status.next({ ...created, status: 'merged_ready', projectID: 'internal-id' });

    expect(h.nav.goProject).not.toHaveBeenCalled();
    expect(h.component['setupStatus']()).toBeUndefined();
    expect(h.component['isRefreshingSetup']()).toBe(false);
  });

  it('keeps a proof mismatch in review and never opens it as a ready project', async () => {
    const h = await harness();
    h.select();
    h.component.create();
    const status = new Subject<{ operationID: string; status: 'needs_review'; setupPR: typeof created.setupPR }>();
    h.createStatus.mockReturnValue(status as never);

    h.component['refreshSetupStatus']();
    status.next({ ...created, status: 'needs_review' });

    expect(h.nav.goProject).not.toHaveBeenCalled();
    expect(h.component['setupStatus']()).toBe('needs_review');
    expect(h.component['isSetupLocked']()).toBe(true);
    expect(h.component['setupStatusMessage']('needs_review')).toContain('could not be verified');
  });

  it('restores a submitted setup as locked while backend status is checked', async () => {
    sessionStorage.setItem('datatug:new-project:draft', JSON.stringify({
      actorID: 'actor', store: 'github', title: 'Project', githubFolder: 'datatug',
      spaceID: 'space', spaceTitle: '', githubRepositoryURL: 'https://github.com/owner/repo',
      ciEnabled: true, operationID: '33333333-3333-4333-8333-333333333333',
      operationPayload: '{}', projectCreateSubmitted: true,
      setupPR: { url: 'https://github.com/owner/repo/pull/42', number: 42 },
    }));
    const h = await harness(false, {}, true, true);
    h.fixture.detectChanges();

    h.component.create();

    expect(h.component['setupStatus']()).toBe('pending_merge');
    expect(h.component['isSetupLocked']()).toBe(true);
    expect(h.component['setupPR']()).toEqual({
      url: 'https://github.com/owner/repo/pull/42',
      number: 42,
    });
    expect(h.create).not.toHaveBeenCalled();
  });

  it('waits to resume a successful OAuth draft until Firebase restores the matching actor', async () => {
    sessionStorage.setItem('datatug:new-project:draft', JSON.stringify({
      actorID: 'actor', store: 'github', title: 'Project', githubFolder: 'datatug',
      spaceID: 'space', spaceTitle: '', githubRepositoryURL: 'https://github.com/owner/repo',
      ciEnabled: true, operationID: '33333333-3333-4333-8333-333333333333',
      operationPayload: JSON.stringify({ title: 'Project' }), oauthResumePending: true,
    }));
    const restored = await harness(false, { oauthResult: 'success' }, false, true, 'authenticating');
    restored.fixture.detectChanges();
    expect(restored.connection.resolveOAuthRepository).not.toHaveBeenCalled();
    restored.userState.next({
      status: 'authenticated',
      user: { uid: 'actor' },
      record: { spaces: { space: { title: 'My Space' } } },
    });
    await Promise.resolve();
    expect(restored.connection.resolveOAuthRepository).toHaveBeenCalledWith('owner', 'repo');
    expect(restored.create).toHaveBeenCalledTimes(1);
  });

  it('resumes the same actor-bound OAuth operation automatically and only once', async () => {
    const operationID = '33333333-3333-4333-8333-333333333333';
    const operationPayload = JSON.stringify({
      title: 'Project',
      spaceID: 'space',
      billingIntent: 'personal_pro',
      github: { owner: 'owner', name: 'repo', folder: 'datatug' },
      template: { id: 'demo-project-1', commit: '436350d41371103be11144ffa346c605f85e1342' },
      ciEnabled: true,
    });
    sessionStorage.setItem(
      'datatug:new-project:draft',
      JSON.stringify({
        actorID: 'actor',
        store: 'github',
        title: 'Project',
        githubFolder: 'datatug',
        spaceID: 'space',
        spaceTitle: '',
        githubRepositoryURL: 'https://github.com/owner/repo',
        ciEnabled: true,
        operationID,
        operationPayload,
        oauthResumePending: true,
      }),
    );
    const h = await harness(false, { oauthResult: 'success' }, true, true);
    h.fixture.detectChanges();
    await h.fixture.whenStable();

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create.mock.calls[0][0]).toMatchObject({ operationID });
    expect(JSON.parse(sessionStorage.getItem('datatug:new-project:draft') ?? 'null').oauthResumePending).toBe(false);
  });

  it('forwards Business-only callback intent and its purchased Space to GitHub project creation', async () => {
    const h = await harness(
      false,
      { spaceID: 'A', billingIntent: 'space_business' },
      true,
      false,
      undefined,
      { A: { title: 'Business Space' } },
      'business-only-actor',
    );
    h.select('A');
    h.component.create();
    expect(h.create.mock.calls[0][0]).toMatchObject({
      spaceID: 'A',
      billingIntent: 'space_business',
    });
  });
  it.each([
    ['', 'repo@owner@datatug', 'datatug'],
    ['datatug', 'repo@owner@datatug', 'datatug'],
    ['Folder/Nested/', 'repo@owner@Folder/Nested', 'Folder/Nested'],
  ])(
    'loads branches for folder %s through the canonical project id',
    async (typedFolder, projectId, folder) => {
      const h = await harness();
      h.component.githubFolder.set(typedFolder);
      h.select();
      expect(h.branches).toHaveBeenCalledWith({
        storeId: 'github.com',
        projectId,
      });
      expect(readGithubProjectId(projectId)).toEqual({
        ok: true,
        id: { repo: 'repo', org: 'owner', folder },
      });
      h.component.create();
      expect(h.create.mock.calls[0][0]).toMatchObject({
        github: { folder, branch: 'work' },
      });
    },
  );
  it('requires an explicit Space but can use the verified repository default branch', async () => {
    const h = await harness();
    h.select();
    h.component.spaceID.set('');
    h.component.create();
    expect(h.create).not.toHaveBeenCalled();
    h.component.spaceID.set('space');
    h.component.branch.set('');
    h.component.create();
    expect(h.create).toHaveBeenCalledTimes(1);
  });
  it('never creates for an unsafe folder', async () => {
    const h = await harness();
    h.select();
    h.component.githubFolder.set('../other');
    h.component.create();
    expect(h.create).not.toHaveBeenCalled();
  });
  it.each([
    'my project',
    'é',
    '.hidden',
    'a'.repeat(129),
    'a'.repeat(128) + '/' + 'b'.repeat(128),
  ])(
    'refuses backend-unsupported creation folder %j before branch or project requests',
    async (folder) => {
      const h = await harness();
      h.component.githubFolder.set(folder);
      h.select();
      h.component.create();
      expect(h.branches).not.toHaveBeenCalled();
      expect(h.create).not.toHaveBeenCalled();
    },
  );
  it('handles an invalid repository identity before branch lookup without throwing', async () => {
    const h = await harness();
    h.connection.oauthRepositories.mockReturnValue(
      of({ repositories: [{ ...repo, owner: 'bad@owner' }] }),
    );
    expect(() => h.select()).not.toThrow();
    expect(h.branches).not.toHaveBeenCalled();
    expect(h.component['formError']()).toContain('Choose a repository');
  });
  it('reuses an ambiguous operation and refuses changed details until that outcome is recovered', async () => {
    const h = await harness();
    h.select();
    h.create.mockImplementation(() => throwError(() => ({ status: 0 })));
    h.component.create();
    const request = h.create.mock.calls[0][0];
    const branchCallsAfterResolve = h.branches.mock.calls.length;
    expect(JSON.parse(sessionStorage.getItem('datatug:new-project:draft') ?? 'null').resolvedCreateRequest).toEqual(request);
    h.component.create();
    expect(h.create.mock.calls[1][0]).toEqual(request);
    expect(h.branches).toHaveBeenCalledTimes(branchCallsAfterResolve);
    h.component.title.set('Different');
    h.component.create();
    expect(h.create).toHaveBeenCalledTimes(2);
    expect(h.component['formError']()).toContain('Retry the saved operation');
  });
  it('starts a new request for a branch changed after a definitive create failure', async () => {
    const h = await harness();
    h.select();
    h.create.mockImplementationOnce(() =>
      throwError(() => ({ status: 403, error: { error: { code: 'repository_denied' } } })),
    );
    h.component.create();
    const firstRequest = h.create.mock.calls[0][0] as CreateGithubProject;

    h.component.branchChanged('main');
    expect(h.component.branch()).toBe('main');
    h.component.create();

    const retryRequest = h.create.mock.calls[1][0] as CreateGithubProject;
    expect(retryRequest.github.branch).toBe('main');
    expect(retryRequest.github.expectedBranchHead).toBe('main-head');
    expect(retryRequest.operationID).not.toBe(firstRequest.operationID);
  });
  it('explains a bounded private-source refusal and offers the CLI path', async () => {
    const h = await harness();
    h.select();
    h.create.mockImplementationOnce(() => throwError(() => ({ status: 413, error: { error: { code: 'source_too_large' } } })));
    h.component.create();
    expect(h.component['formError']()).toContain('DataTug CLI');
    expect(h.component['createNeedsSameOperationRetry']()).toBe(false);
  });

  it('unlocks a typed workflow conflict without reusing its stale branch request', async () => {
    const h = await harness();
    h.select();
    h.create.mockImplementationOnce(() =>
      throwError(() => ({ status: 409, error: { error: { code: 'workflow_conflict' } } })),
    );
    h.component.create();
    const firstRequest = h.create.mock.calls[0][0] as CreateGithubProject;

    h.component.branchChanged('main');
    h.component.create();

    expect((h.create.mock.calls[1][0] as CreateGithubProject).github).toMatchObject({
      branch: 'main',
      expectedBranchHead: 'main-head',
    });
    expect((h.create.mock.calls[1][0] as CreateGithubProject).operationID).not.toBe(firstRequest.operationID);
  });
  it('re-resolves the same branch and operation after typed not-found status without unlocking intent', async () => {
    const h = await harness();
    h.select();
    h.create.mockImplementationOnce(() =>
      throwError(() => ({ status: 409, error: { error: { code: 'conflict' } } })),
    );
    h.createStatus.mockReturnValue(
      throwError(() => ({ status: 404, error: { error: { code: 'not_found' } } })) as never,
    );
    h.branches.mockReturnValue(
      of({ branches: [{ name: 'main', head: 'main-head' }, { name: 'work', head: 'fresh-head' }], defaultBranch: 'main' }),
    );
    h.component.create();
    const firstRequest = h.create.mock.calls[0][0] as CreateGithubProject;
    h.component.create();
    expect(h.create).toHaveBeenCalledTimes(1);

    h.component.branchChanged('main');
    expect(h.component.branch()).toBe('work');
    h.component.create();

    expect((h.create.mock.calls[1][0] as CreateGithubProject).github).toMatchObject({
      branch: 'work',
      expectedBranchHead: 'fresh-head',
    });
    expect((h.create.mock.calls[1][0] as CreateGithubProject).operationID).toBe(firstRequest.operationID);
  });
  it('keeps the original implicit default branch when the repository default changes during recovery', async () => {
    const h = await harness();
    h.select();
    h.component.branchChanged('');
    h.branches
      .mockReturnValueOnce(of({ branches: [{ name: 'main', head: 'main-head' }], defaultBranch: 'main' }))
      .mockReturnValueOnce(of({ branches: [{ name: 'main', head: 'fresh-main-head' }, { name: 'other', head: 'other-head' }], defaultBranch: 'other' }));
    h.create.mockImplementationOnce(() =>
      throwError(() => ({ status: 409, error: { error: { code: 'conflict' } } })),
    );
    h.createStatus.mockReturnValue(
      throwError(() => ({ status: 404, error: { error: { code: 'not_found' } } })) as never,
    );
    h.branches.mockReturnValue(
      of({ branches: [{ name: 'main', head: 'fresh-main-head' }, { name: 'other', head: 'other-head' }], defaultBranch: 'other' }),
    );

    h.component.create();
    const firstRequest = h.create.mock.calls[0][0] as CreateGithubProject;
    expect(firstRequest.github.branch).toBe('main');
    h.component.create(); // conflict status lookup
    h.component.create(); // resolve fresh head on the same operation

    const recovered = h.create.mock.calls[1][0] as CreateGithubProject;
    expect(recovered.operationID).toBe(firstRequest.operationID);
    expect(recovered.github).toMatchObject({ branch: 'main', expectedBranchHead: 'fresh-main-head' });
    expect(h.component.branch()).toBe('main');
  });
  it('rediscovers canonical pending inputs when the original request wins recovery status', async () => {
    const h = await harness();
    h.select();
    h.create.mockImplementationOnce(() =>
      throwError(() => ({ status: 409, error: { error: { code: 'conflict' } } })),
    );
    h.component.create();
    h.createStatus.mockReturnValue(of({ ...created, status: 'initializing' }) as never);
    h.pendingGithubProjectSetups.mockReturnValue(of({ setups: [pendingSetup], truncated: false }));

    h.component.create();

    expect(h.pendingGithubProjectSetups).toHaveBeenCalled();
    expect(h.component['pendingGithubSetups']()).toEqual([pendingSetup]);
    expect(h.component['isCreateRetryLocked']()).toBe(true);
  });
  it('keeps a prior uncertain operation locked after a later definitive denial', async () => {
    const h = await harness();
    h.select();
    h.create.mockImplementationOnce(() => throwError(() => ({ status: 0 })));
    h.component.create();
    const firstRequest = h.create.mock.calls[0][0] as CreateGithubProject;
    h.create.mockImplementationOnce(() =>
      throwError(() => ({ status: 409, error: { error: { code: 'workflow_conflict' } } })),
    );
    h.createStatus.mockReturnValue(of({ ...created, status: 'initializing' }) as never);
    h.component.create();

    h.component.branchChanged('main');
    expect(h.component.branch()).toBe('work');
    h.component.create();
    expect(h.createStatus).toHaveBeenCalledWith({
      operationID: firstRequest.operationID,
      repositoryID: firstRequest.github.repositoryID,
      owner: firstRequest.github.owner,
      name: firstRequest.github.name,
    });
    expect(h.component['isCreateRetryLocked']()).toBe(true);
  });
  it('clears retry state after a closed operation so a fresh setup can start', async () => {
    const h = await harness();
    h.select();
    h.create.mockImplementationOnce(() => throwError(() => ({ status: 0 })));
    h.component.create();
    h.create.mockImplementationOnce(() =>
      throwError(() => ({ status: 409, error: { error: { code: 'conflict' } } })),
    );
    h.component.create();
    h.createStatus.mockReturnValue(of({ ...created, status: 'closed_unmerged' }) as never);
    h.component.create();
    expect(h.component['setupStatus']()).toBe('closed_unmerged');

    h.component['retryClosedSetup']();

    expect(h.create).toHaveBeenCalledTimes(3);
    expect(h.component['isCreateRetryLocked']()).toBe(false);
  });
  it('explains a restored uncertain copy without changing its retry identity', async () => {
    const source = {
      kind: 'github-project' as const,
      repositoryID: 42,
      owner: 'datatug',
      name: 'datatug-demo-project',
      folder: 'demo-project-1',
      branch: 'main',
      commit: 'a'.repeat(40),
      tree: 'b'.repeat(40),
    };
    const first = await harness(false, {
      store: 'github',
      source: JSON.stringify(source),
    });
    first.component.ngOnInit();
    first.select();
    first.create.mockImplementation(() => throwError(() => ({ status: 0 })));
    first.component.create();
    const request = first.create.mock.calls[0][0];
    const saved = sessionStorage.getItem('datatug:new-project:draft');

    const restored = await harness(false, { store: 'github' }, true, true);
    restored.fixture.detectChanges();
    await restored.fixture.whenStable();
    expect(restored.create).not.toHaveBeenCalled();
    expect(restored.component['formError']()).toBeUndefined();
    expect(
      restored.fixture.nativeElement.querySelector('[role="status"]')
        ?.textContent,
    ).toContain(
      'Your saved project request has not been confirmed. Retry the same operation before changing the destination.',
    );
    expect(restored.component.copySource()).toEqual(source);
    expect(restored.component['isCreateRetryLocked']()).toBe(true);
    expect(
      JSON.parse(sessionStorage.getItem('datatug:new-project:draft') ?? 'null')
        .resolvedCreateRequest,
    ).toEqual(JSON.parse(saved ?? 'null').resolvedCreateRequest);

    restored.create.mockReturnValue(new Subject<typeof created>());
    restored.component.create();
    await restored.fixture.whenStable();
    expect(restored.create.mock.calls[0][0]).toEqual(request);
    expect(
      restored.fixture.nativeElement.querySelector('[role="status"]'),
    ).toBeNull();
    expect(restored.component['isCreating']()).toBe(true);
  });
  it('does not show uncertainty guidance for a restored confirmed setup', async () => {
    const first = await harness();
    first.select();
    first.component.create();
    const restored = await harness(false, { store: 'github' }, true, true);
    restored.fixture.detectChanges();
    await restored.fixture.whenStable();
    expect(restored.component['setupStatus']()).toBe('pending_merge');
    expect(restored.fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
  });
  it('does not show saved-outcome guidance on an ordinary form', async () => {
    const h = await harness();
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    expect(h.fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
  });
  it('locks branch and repository refresh until an uncertain operation is retried unchanged', async () => {
    const h = await harness();
    h.select();
    h.create.mockImplementation(() => throwError(() => ({ status: 0 })));
    h.component.create();
    const request = h.create.mock.calls[0][0] as CreateGithubProject;
    h.fixture.detectChanges();
    const repositoryCalls = h.connection.oauthRepositories.mock.calls.length;

    h.component.branchChanged('main');
    h.component.loadGithubRepos();
    expect(h.component.branch()).toBe('work');
    expect(h.connection.oauthRepositories).toHaveBeenCalledTimes(repositoryCalls);
    const refresh = Array.from(
      h.fixture.nativeElement.querySelectorAll('ion-button') as NodeListOf<HTMLElement>,
    ).find((button) => button.textContent.includes('Refresh connected repositories')) as HTMLElement;
    expect((refresh as unknown as { disabled: boolean }).disabled).toBe(true);

    h.component.create();
    expect(h.create.mock.calls[1][0]).toEqual(request);
    h.component.cancel();
    expect(sessionStorage.getItem('datatug:new-project:draft')).not.toBeNull();
  });
  it('preserves the default-branch retry when restoration materializes its name', async () => {
    const h = await harness();
    h.select();
    h.component.branch.set('');
    h.create.mockImplementation(() => throwError(() => ({ status: 0 })));
    h.component.create();
    const request = h.create.mock.calls[0][0] as CreateGithubProject;
    expect(request.github.branch).toBe('main');

    h.component.branch.set('main');
    h.component.create();
    expect(h.create.mock.calls[1][0]).toEqual(request);
  });
  it('migrates a pre-branch-identity draft without changing its uncertain operation', async () => {
    const first = await harness();
    first.select();
    first.create.mockImplementation(() => throwError(() => ({ status: 0 })));
    first.component.create();
    const saved = JSON.parse(
      sessionStorage.getItem('datatug:new-project:draft') ?? 'null',
    );
    const request = first.create.mock.calls[0][0] as CreateGithubProject;
    delete saved.operationBranch;
    delete saved.createNeedsSameOperationRetry;
    const legacyIntent = JSON.parse(saved.operationPayload);
    delete legacyIntent.selectedBranch;
    saved.operationPayload = JSON.stringify(legacyIntent);
    sessionStorage.setItem('datatug:new-project:draft', JSON.stringify(saved));

    const restored = await harness(false, {}, true, true);
    restored.fixture.detectChanges();
    await restored.fixture.whenStable();
    restored.component.create();

    expect(restored.create).toHaveBeenCalledTimes(1);
    expect(restored.create.mock.calls[0][0]).toEqual(request);
    expect((restored.create.mock.calls[0][0] as CreateGithubProject).operationID).toBe(request.operationID);
  });
  it('does not send the create mutation when persisting its in-flight lock fails', async () => {
    const h = await harness();
    h.select();
    const originalSetItem = sessionStorage.setItem.bind(sessionStorage);
    let writes = 0;
    vi.spyOn(sessionStorage, 'setItem').mockImplementation((key, value) => {
      writes++;
      if (writes === 3) throw new DOMException('storage blocked', 'SecurityError');
      originalSetItem(key, value);
    });

    h.component.create();

    expect(h.create).not.toHaveBeenCalled();
    expect(h.component['isCreating']()).toBe(false);
    expect(h.component['formError']()).toContain('could not be saved');
  });
  it.each([
    [
      { status: 403, error: { error: { code: 'repository_denied' } } },
      'GitHub access',
    ],
    [
      { status: 409, error: { error: { code: 'reauthorization_required' } } },
      'Reconnect GitHub',
    ],
  ])(
    'explains a definitive create denial and preserves operation identity on retry',
    async (failure, notice) => {
      const h = await harness();
      h.select();
      h.fixture.detectChanges();
      const pending = new Subject();
      h.create.mockReturnValue(pending as never);
      h.component.create();
      const firstRequest = h.create.mock.calls[0][0];
      pending.error(failure);
      await h.fixture.whenStable();
      expect(h.fixture.nativeElement.textContent).toContain(notice);
      h.component.create();
      expect(h.create.mock.calls[1][0]).toEqual(firstRequest);
    },
  );
  it('keeps the same operation for an explicit uncertain outcome', async () => {
    const h = await harness();
    h.select();
    h.create.mockImplementation(() =>
      throwError(() => ({
        status: 409,
        error: { error: { code: 'outcome_uncertain' } },
      })),
    );
    h.component.create();
    const request = h.create.mock.calls[0][0] as CreateGithubProject;
    h.component.create();
    expect(h.create.mock.calls[1][0]).toEqual(request);
  });
  it.each([
    [
      { status: 409, error: { error: { code: 'conflict' } } },
      'branch, folder or shared-project limit',
    ],
    [{ status: 409 }, 'Creation was not confirmed'],
  ])(
    'retains the operation for a conflict that may follow a provider commit',
    async (failure, notice) => {
      const h = await harness();
      h.select();
      h.fixture.detectChanges();
      const pending = new Subject();
      h.create.mockReturnValue(pending as never);
      h.component.create();
      const request = h.create.mock.calls[0][0] as CreateGithubProject;
      pending.error(failure);
      await h.fixture.whenStable();
      expect(h.fixture.nativeElement.textContent).toContain(notice);
      h.component.create();
      if (failure && typeof failure === 'object' && 'error' in failure) {
        expect(h.create).toHaveBeenCalledTimes(1);
        expect(h.createStatus).toHaveBeenCalledWith({
          operationID: request.operationID,
          repositoryID: request.github.repositoryID,
          owner: request.github.owner,
          name: request.github.name,
        });
      } else {
        expect(h.create.mock.calls[1][0]).toEqual(request);
      }
    },
  );
  it('ignores out-of-order branch lists after repository selection changes', async () => {
    const h = await harness();
    h.select();
    const old = new Subject();
    h.branches.mockReturnValue(old as never);
    h.component.repositoryChanged(repo.id);
    h.component.repositoryChanged(999);
    old.next({ branches: [{ name: 'stale', head: 'stale' }] });
    h.component.branch.set('stale');
    h.component.create();
    expect(h.create).not.toHaveBeenCalled();
  });
  it('reenables the visible submit button on asynchronous failure without manual repaint', async () => {
    const h = await harness();
    h.select();
    const pending = new Subject();
    h.create.mockReturnValue(pending as never);
    h.fixture.detectChanges();
    h.component.create();
    await h.fixture.whenStable();
    pending.error({ status: 403 });
    await h.fixture.whenStable();
    expect(h.fixture.nativeElement.textContent).toContain(
      'Project creation was denied',
    );
    expect(
      h.fixture.nativeElement.querySelector('ion-button ion-label').textContent,
    ).toBe('Create new project');
  });
  it('does not let repository refresh invalidate an in-flight successful create', async () => {
    const h = await harness();
    h.select();
    const pendingCreate = new Subject<typeof created>();
    h.create.mockReturnValue(pendingCreate as never);
    const repositoryCalls = h.connection.oauthRepositories.mock.calls.length;

    h.component.create();
    expect(h.component['isCreating']()).toBe(true);
    h.component.loadGithubRepos();
    expect(h.connection.oauthRepositories).toHaveBeenCalledTimes(repositoryCalls);

    pendingCreate.next(created);
    expect(h.component['isCreating']()).toBe(false);
    expect(h.component['setupStatus']()).toBe('pending_merge');
  });
  it('disables the connected repository refresh control while create is active', async () => {
    const h = await harness();
    h.component.store.set('github');
    h.fixture.detectChanges();
    h.component['isCreating'].set(true);
    h.fixture.detectChanges();

    const refresh = Array.from(
      h.fixture.nativeElement.querySelectorAll('ion-button') as NodeListOf<HTMLElement>,
    ).find((button) => button.textContent.includes('Refresh connected repositories')) as HTMLElement;
    expect((refresh as unknown as { disabled: boolean }).disabled).toBe(true);
  });
  it('does not render a direct provider repository-create/write flow', async () => {
    const h = await harness();
    h.select();
    h.fixture.detectChanges();
    expect(
      h.fixture.nativeElement.querySelector(
        'ion-select-option[value="__new__"]',
      ),
    ).toBeNull();
    expect(
      h.fixture.nativeElement.querySelector('a[href="https://github.com/new"]'),
    ).toBeTruthy();
  });
});
