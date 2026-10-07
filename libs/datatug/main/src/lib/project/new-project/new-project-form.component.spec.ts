import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PopoverController } from '@ionic/angular';
import { ErrorLogger } from '@sneat/core';
import { SpaceService } from '@sneat/space-services';
import { SneatUserService } from '@sneat/auth-core';
import { Subject, of, throwError } from 'rxjs';
import { NewProjectFormComponent } from './new-project-form.component';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import { ProjectService } from '../../services/project/project.service';
import { ProjectQueryApiService } from '../../services/project/project-query-api.service';
import { GithubConnectionService } from '../../services/repo/github/github-connection.service';

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
async function harness(freshUser = false) {
  TestBed.resetTestingModule();
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
  const nav = { goProject: vi.fn() };
  const connection = {
    start: vi.fn(),
    repositories: vi.fn(() => of({ repositories: [repo] })),
  };
  TestBed.configureTestingModule({
    imports: [NewProjectFormComponent],
    providers: [
      { provide: SpaceService, useValue: { createSpace } },
      { provide: ProjectQueryApiService, useValue: { create, branches } },
      { provide: ProjectService, useValue: { createNewProject: createCloud } },
      { provide: GithubConnectionService, useValue: connection },
      {
        provide: SneatUserService,
        useValue: {
          userState: of({
            user: { uid: 'actor' },
            record: {
              spaces: freshUser ? {} : { space: { title: 'My Space' } },
            },
          }),
        },
      },
      { provide: DatatugNavService, useValue: nav },
      {
        provide: PopoverController,
        useValue: { dismiss: vi.fn(() => Promise.resolve(true)) },
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
    component.store = 'github';
    component.title = 'Project';
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
    connection,
    nav,
    select,
  };
}

describe('New project through authenticated common API', () => {
  it('lets a fresh signed-in user create/select a Space through the existing Sneat API before GitHub project creation', async () => {
    const h = await harness(true);
    h.component.store = 'github';
    h.component.title = 'Project';
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
      type: 'team',
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
    h.component.store = 'github';
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
    h.component.title = 'Cloud';
    h.component.create();
    expect(h.createCloud).toHaveBeenCalledWith('firestore', {
      title: 'Cloud',
      userIDs: [],
    });
    expect(h.nav.goProject.mock.calls[0][0].ref).toEqual({
      storeId: 'firestore',
      projectId: 'cloud-id',
    });
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
        commit: '51716f3a4d682d5cb7ef70a7fd37f42e5418fd3d',
      },
    });
    expect(h.nav.goProject.mock.calls[0][0].ref).toEqual({
      storeId: 'github.com',
      projectId: created.project,
      projectApi: 'cloud',
      branch: 'work',
    });
    expect(h.createCloud).not.toHaveBeenCalled();
  });
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
    h.component.githubFolder = '../other';
    h.component.create();
    expect(h.create).not.toHaveBeenCalled();
  });
  it('reuses the operation after an ambiguous failure but changes it for a changed payload', async () => {
    const h = await harness();
    h.select();
    h.create.mockImplementation(() => throwError(() => ({ status: 0 })));
    h.component.create();
    const request = h.create.mock.calls[0][0];
    h.component.create();
    expect(h.create.mock.calls[1][0]).toEqual(request);
    h.component.title = 'Different';
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
