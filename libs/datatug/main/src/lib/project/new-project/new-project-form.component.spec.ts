import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { addIcons } from 'ionicons';
import { closeOutline, saveOutline } from 'ionicons/icons';
import { ErrorLogger } from '@sneat/core';
import { SpaceService } from '@sneat/space-services';
import { SneatAuthStateService, SneatUserService } from '@sneat/auth-core';
import { readGithubProjectId } from '@datatug/project-address';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { NewProjectFormComponent } from './new-project-form.component';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import { ProjectService } from '../../services/project/project.service';
import { ProjectQueryApiService } from '../../services/project/project-query-api.service';
import { GithubConnectionService } from '../../services/repo/github/github-connection.service';

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
  id: 'server-id',
  storage: 'github.com',
  project: 'repo@owner@datatug',
  branch: 'work',
  branchHead: 'new-head',
  revision: 'revision',
  spaceID: 'space',
  sharedProjectID: 'server-id',
};
async function harness(
  freshUser = false,
  routeParams: Record<string, string | null> = {},
  authenticated = true,
  preserveDraft = false,
  initialStatus?: 'authenticating' | 'authenticated' | 'notAuthenticated',
) {
  TestBed.resetTestingModule();
  if (!preserveDraft) sessionStorage.removeItem('datatug:new-project:draft');
  const create = vi.fn((...args: unknown[]) => {
    void args;
    return of(created);
  });
  const branches = vi.fn(() =>
    of({ branches: [{ name: 'work', head: 'head' }], defaultBranch: 'main' }),
  );
  const createCloud = vi.fn(() => of('cloud-id'));
  const spaceResult = new Subject<{ id: string; dbo: { title: string } }>();
  const createSpace = vi.fn(() => spaceResult);
  const userState = new BehaviorSubject({
    status:
      initialStatus ?? (authenticated ? 'authenticated' : 'notAuthenticated'),
    user: authenticated ? { uid: 'actor' } : undefined,
    record: { spaces: freshUser ? {} : { space: { title: 'My Space' } } },
  });
  const nav = { goProject: vi.fn() };
  const router = {
    navigate: vi.fn(() => Promise.resolve(true)),
    navigateByUrl: vi.fn(() => Promise.resolve(true)),
    parseUrl: vi.fn(),
    serializeUrl: vi.fn(),
  };
  const connection = {
    start: vi.fn(),
    repositories: vi.fn(() => of({ repositories: [repo] })),
  };
  const signInWith = vi.fn(() => Promise.resolve(undefined));
  TestBed.configureTestingModule({
    imports: [NewProjectFormComponent],
    providers: [
      { provide: SpaceService, useValue: { createSpace } },
      { provide: ProjectQueryApiService, useValue: { create, branches } },
      { provide: ProjectService, useValue: { createNewProject: createCloud } },
      { provide: GithubConnectionService, useValue: connection },
      { provide: SneatAuthStateService, useValue: { signInWith } },
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
  const select = () => {
    component.store.set('github');
    component.title.set('Project');
    component.spaceID.set('space');
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
    createSpace,
    spaceResult,
    userState,
    connection,
    signInWith,
    nav,
    router,
    select,
  };
}

describe('New project through authenticated common API', () => {
  it('loads a GitHub deep link from URL context and returns to its safe internal page', async () => {
    const h = await harness(false, {
      store: 'github',
      returnUrl: '/store/github.com?code=must-not-replay#repos',
    });
    h.fixture.detectChanges();
    expect(h.component.store()).toBe('github');
    expect(h.connection.repositories).toHaveBeenCalledTimes(1);
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

    const signIn = Array.from(
      h.fixture.nativeElement.querySelectorAll('ion-button'),
    ).find((button: Element) =>
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
    expect(h.connection.repositories).toHaveBeenCalledTimes(1);
    const titleInput = h.fixture.nativeElement.querySelector(
      'ion-input[placeholder="is required"]',
    ) as (HTMLElement & { value?: string }) | null;
    expect(titleInput?.value).toBe('My private draft');
  });

  it('guides an empty GitHub repository list through App installation and refresh', async () => {
    const h = await harness();
    h.component.store.set('github');
    h.connection.repositories.mockReturnValue(of({ repositories: [] }));
    h.component.loadGithubRepos();
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    h.fixture.detectChanges();
    expect(h.component.isGithubSignedIn()).toBe(true);
    expect(h.component['githubRepos']()).toHaveLength(0);

    const install = h.fixture.nativeElement.querySelector(
      'a[href="https://github.com/apps/datatug/installations/new"]',
    ) as HTMLAnchorElement | null;
    expect(install?.textContent).toContain('Install DataTug App');
    expect(install?.target).toBe('_blank');
    expect(install?.rel).toContain('noopener');
    expect(h.fixture.nativeElement.innerHTML).toContain(
      'No repositories with write access are available yet',
    );
    expect(h.fixture.nativeElement.textContent).toContain(
      'Refresh repositories',
    );

    const pendingRefresh = new Subject<{
      repositories: (typeof repo)[];
    }>();
    h.connection.repositories.mockReturnValue(pendingRefresh as never);
    h.component.loadGithubRepos();
    h.fixture.detectChanges();
    expect(h.component.isGithubSignedIn()).toBe(true);
    expect(h.component['isLoadingRepos']()).toBe(true);
    expect(h.fixture.nativeElement.innerHTML).not.toContain(
      'No repositories with write access are available yet',
    );

    pendingRefresh.error({ status: 503 });
    await h.fixture.whenStable();
    h.fixture.detectChanges();
    expect(h.component['githubReposError']()).toContain(
      'Could not load GitHub repositories',
    );
    expect(h.fixture.nativeElement.innerHTML).not.toContain(
      'No repositories with write access are available yet',
    );

    h.connection.repositories.mockReturnValue(of({ repositories: [] }));
    h.component.loadGithubRepos();
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    h.fixture.detectChanges();
    expect(h.fixture.nativeElement.innerHTML).toContain(
      'No repositories with write access are available yet',
    );

    h.connection.repositories.mockReturnValue(of({ repositories: [repo] }));
    h.component.loadGithubRepos();
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    h.fixture.detectChanges();
    expect(h.fixture.nativeElement.innerHTML).not.toContain(
      'No repositories with write access are available yet',
    );
    expect(h.fixture.nativeElement.textContent).toContain('owner/repo');
  });
  it('explains a failed GitHub repository refresh and clears only that error after a successful retry', async () => {
    const h = await harness();
    const repositories = new Subject<{ repositories: (typeof repo)[] }>();
    h.connection.repositories.mockReturnValue(repositories as never);
    h.component.store.set('github');
    h.fixture.detectChanges();

    repositories.error({ status: 503 });
    await h.fixture.whenStable();
    h.fixture.detectChanges();
    expect(h.fixture.nativeElement.textContent).toContain(
      'Could not load GitHub repositories',
    );
    expect(h.fixture.nativeElement.textContent).toContain(
      'Connect or reconnect GitHub',
    );
    expect(h.component.isGithubSignedIn()).toBe(false);
    expect(h.component.isLoadingRepos()).toBe(false);

    h.component['formError'].set('Branches could not be loaded.');
    h.connection.repositories.mockReturnValue(of({ repositories: [repo] }));
    h.component.loadGithubRepos();
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    expect(h.fixture.nativeElement.textContent).not.toContain(
      'Could not load GitHub repositories',
    );
    expect(h.fixture.nativeElement.textContent).toContain(
      'Branches could not be loaded.',
    );
    expect(h.component['githubReposError']()).toBeUndefined();
    expect(h.component.isGithubSignedIn()).toBe(true);
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
    });
    expect(h.nav.goProject.mock.calls[0][0].ref).toEqual({
      storeId: 'firestore',
      projectId: 'cloud-id',
    });
    expect(h.nav.goProject.mock.calls[0][2]).toEqual({ replaceUrl: true });
    expect(h.create).not.toHaveBeenCalled();
  });
  it('creates on the explicitly chosen repository/Space/branch and navigates with cold-load transport', async () => {
    const h = await harness();
    h.select();
    h.component.create();
    expect(h.create.mock.calls[0][0]).toMatchObject({
      title: 'Project',
      spaceID: 'space',
      operationId: expect.any(String),
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
    expect(h.nav.goProject.mock.calls[0][0].ref).toEqual({
      storeId: 'github.com',
      projectId: created.project,
      projectApi: 'cloud',
      branch: 'work',
    });
    expect(h.nav.goProject.mock.calls[0][2]).toEqual({ replaceUrl: true });
    expect(h.createCloud).not.toHaveBeenCalled();
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
  it('requires explicit Space and branch before any creation', async () => {
    const h = await harness();
    h.select();
    h.component.spaceID.set('');
    h.component.create();
    expect(h.create).not.toHaveBeenCalled();
    h.component.spaceID.set('space');
    h.component.branch.set('');
    h.component.create();
    expect(h.create).not.toHaveBeenCalled();
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
    h.connection.repositories.mockReturnValue(
      of({ repositories: [{ ...repo, owner: 'bad@owner' }] }),
    );
    expect(() => h.select()).not.toThrow();
    expect(h.branches).not.toHaveBeenCalled();
    expect(h.component['formError']()).toContain('Choose a repository');
  });
  it('reuses the operation after an ambiguous failure but changes it for a changed payload', async () => {
    const h = await harness();
    h.select();
    h.create.mockImplementation(() => throwError(() => ({ status: 0 })));
    h.component.create();
    const request = h.create.mock.calls[0][0];
    h.component.create();
    expect(h.create.mock.calls[1][0]).toEqual(request);
    h.component.title.set('Different');
    h.component.create();
    expect(h.create.mock.calls[2][0]).not.toEqual(request);
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
    'explains a definitive create denial and starts a new operation on retry',
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
      expect(h.create.mock.calls[1][0]).not.toEqual(firstRequest);
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
    const request = h.create.mock.calls[0][0];
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
      const request = h.create.mock.calls[0][0];
      pending.error(failure);
      await h.fixture.whenStable();
      expect(h.fixture.nativeElement.textContent).toContain(notice);
      h.component.create();
      expect(h.create.mock.calls[1][0]).toEqual(request);
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
