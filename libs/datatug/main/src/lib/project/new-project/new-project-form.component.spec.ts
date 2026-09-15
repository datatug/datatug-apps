import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PopoverController } from '@ionic/angular';
import { ErrorLogger } from '@sneat/core';
import { Subject, of } from 'rxjs';

import { NewProjectFormComponent } from './new-project-form.component';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import { ProjectService } from '../../services/project/project.service';
import { GithubProjectCreateService } from '../../services/repo/github/github-project-create.service';
import { GithubOAuthService } from '../../services/repo/github/github-oauth.service';
import { GithubReposService } from '../../services/repo/github/github-repos.service';

const githubProjectCreateMock = (): {
  createProject: ReturnType<typeof vi.fn>;
} => ({ createProject: vi.fn(() => new Subject()) });

const githubOAuthMock = (): {
  isSignedIn: boolean;
  accessToken: string | undefined;
  signIn: ReturnType<typeof vi.fn>;
} => ({ isSignedIn: false, accessToken: undefined, signIn: vi.fn() });

const githubReposMock = (): {
  listRepos: ReturnType<typeof vi.fn>;
  createRepo: ReturnType<typeof vi.fn>;
} => ({ listRepos: vi.fn(() => of([])), createRepo: vi.fn() });

describe('NewProjectFormComponent', () => {
  let component: NewProjectFormComponent;
  let fixture: ComponentFixture<NewProjectFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NewProjectFormComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ProjectService,
          useValue: { createNewProject: vi.fn(() => new Subject()) },
        },
        {
          provide: GithubProjectCreateService,
          useValue: githubProjectCreateMock(),
        },
        { provide: GithubOAuthService, useValue: githubOAuthMock() },
        { provide: GithubReposService, useValue: githubReposMock() },
        {
          provide: PopoverController,
          useValue: { dismiss: vi.fn(() => Promise.resolve(true)) },
        },
        { provide: DatatugNavService, useValue: { goProject: vi.fn() } },
      ],
    })
      .overrideComponent(NewProjectFormComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(NewProjectFormComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

/**
 * Regression for the zoneless bug class this repo hit in
 * pages/signed-in/project/project-page.component.ts (PR #95) and is now
 * guarded fleet-wide by tools/check-zoneless-fields.mjs: `isCreating` used to
 * be a plain field, set back to `false` from inside the `.subscribe()` error
 * callback in `create()`. This app runs `provideZonelessChangeDetection()`
 * (apps/datatug-app/src/main.ts), so a plain-field write from an async
 * callback never schedules a repaint on its own — the "Create new project"
 * and "Cancel" buttons would stay disabled forever after a failed create,
 * with no unrelated event around to accidentally mask the gap.
 *
 * Uses a `Subject`, not `throwError(...)`, so the error arrives strictly
 * after the click — matching real HTTP timing — and never calls
 * `fixture.detectChanges()` again after the click, relying only on
 * `fixture.whenStable()` to prove the signal write alone re-renders the
 * buttons with no manual intervention.
 */
describe('NewProjectFormComponent re-enables its buttons after a failed create (zoneless)', () => {
  let component: NewProjectFormComponent;
  let fixture: ComponentFixture<NewProjectFormComponent>;
  let createNewProject$: Subject<string>;

  beforeEach(async () => {
    createNewProject$ = new Subject<string>();

    await TestBed.configureTestingModule({
      imports: [NewProjectFormComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ProjectService,
          useValue: {
            createNewProject: vi.fn(() => createNewProject$.asObservable()),
          },
        },
        {
          provide: GithubProjectCreateService,
          useValue: githubProjectCreateMock(),
        },
        { provide: GithubOAuthService, useValue: githubOAuthMock() },
        { provide: GithubReposService, useValue: githubReposMock() },
        {
          provide: PopoverController,
          useValue: { dismiss: vi.fn(() => Promise.resolve(true)) },
        },
        { provide: DatatugNavService, useValue: { goProject: vi.fn() } },
      ],
    })
      // NewProjectFormComponent's own `imports` array pulls in
      // DatatugServicesProjectModule directly (the standalone-component/
      // NgModule DI-duplication pattern this repo has elsewhere — see S126's
      // report on project-page.component.ts, PR #95): that module provides
      // its own real ProjectService on the component's injector, which
      // would shadow the mock above and pull in a real Firestore dependency.
      // Drop it for this test the same way PR #95 does. FormsModule is
      // dropped too — without Ionic's own forms integration registered,
      // NgModel has no value accessor for the ion-* custom elements;
      // CUSTOM_ELEMENTS_SCHEMA is enough to let `[(ngModel)]` through as a
      // plain (inert, for this test) property/event binding instead.
      .overrideComponent(NewProjectFormComponent, {
        set: {
          imports: [],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(NewProjectFormComponent);
    component = fixture.componentInstance;
  });

  function findCreateButton(): (HTMLElement & { disabled?: boolean }) | null {
    // Not the first `ion-button` in DOM order — that's the header's Cancel
    // (X) icon button, which has no [disabled] binding at all.
    const buttons = fixture.nativeElement.querySelectorAll('ion-button');
    return Array.from(buttons).find((el) =>
      (el as HTMLElement).textContent?.includes('Create new project'),
    ) as (HTMLElement & { disabled?: boolean }) | null;
  }

  it('re-enables the Create button once the failed request completes, with no explicit detectChanges()', async () => {
    fixture.detectChanges(); // initial render — not creating yet
    expect(findCreateButton()?.disabled).toBeFalsy();

    component.create();
    await fixture.whenStable();
    expect(findCreateButton()?.disabled).toBe(true);

    // The error arrives strictly after the click — no detectChanges() call
    // between this and the assertion below; only whenStable().
    createNewProject$.error(new Error('boom'));
    await fixture.whenStable();

    expect(findCreateButton()?.disabled).toBe(false);
  });
});

describe('NewProjectFormComponent creating in a GitHub repo', () => {
  let component: NewProjectFormComponent;
  let fixture: ComponentFixture<NewProjectFormComponent>;
  let createProject$: Subject<{ repo: string; org: string; folder: string }>;
  let createProject: ReturnType<typeof vi.fn>;
  let oauth: {
    isSignedIn: boolean;
    accessToken: string | undefined;
    signIn: ReturnType<typeof vi.fn>;
  };
  let repos: {
    listRepos: ReturnType<typeof vi.fn>;
    createRepo: ReturnType<typeof vi.fn>;
  };
  let nav: { goProject: ReturnType<typeof vi.fn> };

  const formErrorOf = (c: NewProjectFormComponent): string | undefined =>
    (c as unknown as { formError: () => string | undefined }).formError();

  beforeEach(async () => {
    createProject$ = new Subject();
    createProject = vi.fn(() => createProject$.asObservable());
    oauth = { isSignedIn: false, accessToken: undefined, signIn: vi.fn() };
    repos = { listRepos: vi.fn(() => of([])), createRepo: vi.fn() };
    nav = { goProject: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [NewProjectFormComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: { logError: vi.fn(), logErrorHandler: vi.fn(() => vi.fn()) },
        },
        {
          provide: ProjectService,
          useValue: { createNewProject: vi.fn(() => new Subject()) },
        },
        { provide: GithubProjectCreateService, useValue: { createProject } },
        { provide: GithubOAuthService, useValue: oauth },
        { provide: GithubReposService, useValue: repos },
        {
          provide: PopoverController,
          useValue: { dismiss: vi.fn(() => Promise.resolve(true)) },
        },
        { provide: DatatugNavService, useValue: nav },
      ],
    })
      .overrideComponent(NewProjectFormComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(NewProjectFormComponent);
    component = fixture.componentInstance;
  });

  it('asks the user to sign in to GitHub instead of prompting for a token', () => {
    component.store = 'github';
    component.title = 'My project';

    component.create();

    expect(createProject).not.toHaveBeenCalled();
    expect(formErrorOf(component)).toContain('Sign in to GitHub');
  });

  it('signs in to GitHub and loads the repositories the user can push to', async () => {
    oauth.signIn = vi.fn(() => {
      oauth.isSignedIn = true;
      oauth.accessToken = 'gho_token';
      return Promise.resolve('gho_token');
    });
    repos.listRepos = vi.fn(() =>
      of([
        { fullName: 'datatug/demo-projects', private: false, defaultBranch: 'main' },
        { fullName: 'datatug/private-one', private: true, defaultBranch: 'main' },
      ]),
    );

    await component.signInToGithub();

    expect(oauth.signIn).toHaveBeenCalled();
    expect(repos.listRepos).toHaveBeenCalledWith('gho_token');
    expect(
      (component as unknown as { githubRepos: () => unknown[] }).githubRepos(),
    ).toHaveLength(2);
    // The first repository is preselected, so "Create" works without a pick.
    expect(
      (component as unknown as { selectedRepo: () => string }).selectedRepo(),
    ).toBe('datatug/demo-projects');
    expect(formErrorOf(component)).toBeUndefined();
  });

  it('commits to the selected repository and opens the new project', () => {
    oauth.isSignedIn = true;
    oauth.accessToken = 'gho_token';
    (component as unknown as { selectedRepo: { set: (v: string) => void } }).selectedRepo.set(
      'datatug/demo-projects',
    );
    component.store = 'github';
    component.title = 'My project';

    component.create();

    expect(createProject).toHaveBeenCalledWith(
      {
        org: 'datatug',
        repo: 'demo-projects',
        folder: 'datatug',
        title: 'My project',
      },
      'gho_token',
    );

    createProject$.next({ repo: 'demo-projects', org: 'datatug', folder: 'datatug' });
    createProject$.complete();

    expect(nav.goProject).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: { projectId: 'demo-projects@datatug@datatug', storeId: 'github.com' },
      }),
    );
  });

  it('creates a new repository first when the user asks for one', () => {
    oauth.isSignedIn = true;
    oauth.accessToken = 'gho_token';
    const signals = component as unknown as {
      selectedRepo: { set: (v: string) => void };
    };
    signals.selectedRepo.set('__new__');
    component.newRepoName = 'my-projects';
    component.makeRepoPrivate = true;
    repos.createRepo = vi.fn(() =>
      of({ fullName: 'datatug/my-projects', private: true, defaultBranch: 'main' }),
    );
    component.store = 'github';
    component.title = 'My project';

    component.create();

    expect(repos.createRepo).toHaveBeenCalledWith('gho_token', 'my-projects', true);
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ org: 'datatug', repo: 'my-projects' }),
      'gho_token',
    );
  });

  it('requires a name before creating a new repository', () => {
    oauth.isSignedIn = true;
    oauth.accessToken = 'gho_token';
    (component as unknown as { selectedRepo: { set: (v: string) => void } }).selectedRepo.set(
      '__new__',
    );
    component.store = 'github';

    component.create();

    expect(repos.createRepo).not.toHaveBeenCalled();
    expect(formErrorOf(component)).toContain('name');
  });

  it('still creates in the cloud store when Cloud is selected', () => {
    component.store = 'cloud';
    component.title = 'My project';

    component.create();

    expect(createProject).not.toHaveBeenCalled();
    expect(TestBed.inject(ProjectService).createNewProject).toHaveBeenCalledWith(
      'firestore',
      { title: 'My project', userIDs: [] },
    );
  });
});
