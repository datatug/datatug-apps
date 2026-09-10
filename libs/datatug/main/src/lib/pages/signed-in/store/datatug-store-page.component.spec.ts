import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, RouterLink, provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/provide';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
  IonMenuButton,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { SneatErrorCardComponent } from '@sneat/components';
import { ErrorLogger } from '@sneat/core';
import { BehaviorSubject, of } from 'rxjs';

import {
  DatatugStorePageComponent,
  GITHUB_DEMO_PROJECTS,
} from './datatug-store-page.component';
import { DatatugStoreService } from '../../../services/repo/datatug-store.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import {
  AgentStateService,
  IAgentState,
} from '../../../services/repo/agent-state.service';
import { NewProjectService } from '../../../project/new-project/new-project.service';
import {
  DatatugUserService,
  IDatatugUserState,
} from '../../../services/base/datatug-user-service';

const DEMO_PROJECT_ID = 'datatug-demo-projects@datatug@demo-project-1';

// Real-template imports for the `describe('project list gating ...')` block
// below, minus `DatatugServicesStoreModule` (the real component's own
// import): that module's `providers` — `DatatugStoreService`,
// `AgentStateService`, `DatatugStoreServiceFactory`,
// `DatatugStoreFirestoreService` (which itself needs a real `Firestore`
// injectable, `provideFirestore()`, not set up in any spec here), ... — are
// scoped to the component's own injector and would shadow the root-level
// mocks configured per test below. Every other real template dependency
// (Ionic components, `RouterLink`, `SneatErrorCardComponent`) is kept so the
// actual template (not a stand-in) is what's under test.
const REAL_TEMPLATE_IMPORTS = [
  SneatErrorCardComponent,
  RouterLink,
  IonHeader,
  IonToolbar,
  IonButtons,
  IonMenuButton,
  IonBackButton,
  IonTitle,
  IonContent,
  IonCard,
  IonList,
  IonItemDivider,
  IonLabel,
  IonButton,
  IonIcon,
  IonItem,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonInput,
];

/** Matches `db-model-page.component.spec.ts`'s own `window.history` mock
 * pattern (this file's `store` is the analogue of that spec's `dbmodel`). */
function setHistoryState(state: unknown): void {
  Object.defineProperty(window, 'history', {
    value: { ...window.history, state },
    writable: true,
    configurable: true,
  });
}

describe('StorePageComponent', () => {
  let component: DatatugStorePageComponent;
  let fixture: ComponentFixture<DatatugStorePageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DatatugStorePageComponent],
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
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null }, params: {} },
          },
        },
        { provide: DatatugStoreService, useValue: { getProjects: vi.fn() } },
        {
          provide: DatatugNavService,
          useValue: { goProject: vi.fn(), goStore: vi.fn() },
        },
        {
          provide: AgentStateService,
          useValue: { watchAgentInfo: vi.fn(() => of()) },
        },
        {
          provide: NewProjectService,
          useValue: { openNewProjectDialog: vi.fn() },
        },
        {
          provide: DatatugUserService,
          useValue: {
            datatugUserState: of({ status: undefined, record: null }),
          },
        },
      ],
    })
      .overrideComponent(DatatugStorePageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DatatugStorePageComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    // `window.history` is a shared global — clear it after every test so a
    // state left behind here can't leak into an unrelated test/spec file.
    setHistoryState(null);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('storeDisplayId', () => {
    it('shows an http- prefixed host:port storeId as a real URL', () => {
      component.storeId = 'http-localhost:8989';
      expect(component.storeDisplayId).toBe('http://localhost:8989');
    });

    it('shows a bare host:port storeId unchanged, with no scheme to display', () => {
      component.storeId = 'localhost:8989';
      expect(component.storeDisplayId).toBe('localhost:8989');
    });

    it('shows firestore unchanged, which has no url', () => {
      component.storeId = 'firestore';
      expect(component.storeDisplayId).toBe('firestore');
    });

    it('is empty when storeId is not yet set', () => {
      component.storeId = undefined;
      expect(component.storeDisplayId).toBe('');
    });
  });

  describe('processStoreId', () => {
    it('applies the agentState watchAgentInfo emits (a bare-array merge() argument makes takeUntil complete before the source ever subscribes, e2e/journey/store-id-scheme.spec.ts)', () => {
      const emittedState: IAgentState = {
        isNotAvailable: true,
        lastCheckedAt: new Date(),
      };
      const agentStateService = TestBed.inject(AgentStateService) as {
        watchAgentInfo: (storeId: string) => ReturnType<typeof of<IAgentState>>;
      };
      agentStateService.watchAgentInfo = () => of(emittedState);

      component.processStoreId('http-localhost:8989');

      expect(component.agentState).toEqual(emittedState);
    });
  });

  describe('constructor with a GitHub store passed via window.history.state', () => {
    // Reproduces the founder's report: the home page's "Project stores" card
    // (`MyStoresComponent.goStore()`) navigates with
    // `state: { store: { ref, brief } }`; the constructor used to
    // unconditionally `throw new Error('Not implemented yet')` for ANY
    // truthy `store`, matching the reported
    // `ErrorLoggerService.logError: Failed to navigate to store page`.
    beforeEach(() => {
      setHistoryState({
        store: {
          ref: { type: 'github', id: 'github.com' },
          brief: { type: 'github', title: 'GitHub.com', projects: {} },
        },
      });
      fixture = TestBed.createComponent(DatatugStorePageComponent);
      component = fixture.componentInstance;
    });

    it('does not throw and sets storeId to github.com', () => {
      expect(component.storeId).toBe('github.com');
    });

    it('lists the known GitHub demo project', () => {
      expect(component.projects?.some((p) => p.id === DEMO_PROJECT_ID)).toBe(
        true,
      );
    });

    it('also lists a project carried in the state brief, merged alongside the demo project', () => {
      setHistoryState({
        store: {
          ref: { type: 'github', id: 'github.com' },
          brief: {
            type: 'github',
            title: 'GitHub.com',
            projects: {
              'my-repo@my-org@my-folder': { title: 'My repo', access: 'public' },
            },
          },
        },
      });
      const f = TestBed.createComponent(DatatugStorePageComponent);
      const c = f.componentInstance;
      const ids = c.projects?.map((p) => p.id);
      expect(ids).toContain('my-repo@my-org@my-folder');
      expect(ids).toContain(DEMO_PROJECT_ID);
    });
  });

  describe('constructor with a firestore store passed via window.history.state', () => {
    it('does not throw and sets projects from the state brief, without the GitHub demo project', () => {
      setHistoryState({
        store: {
          ref: { type: 'firestore' },
          brief: {
            type: 'firestore',
            title: 'DataTug cloud',
            projects: {
              'my-project': { title: 'My project', access: 'private' },
            },
          },
        },
      });
      expect(() => {
        fixture = TestBed.createComponent(DatatugStorePageComponent);
        component = fixture.componentInstance;
      }).not.toThrow();
      expect(component.storeId).toBe('firestore');
      const ids = component.projects?.map((p) => p.id);
      expect(ids).toContain('my-project');
      expect(ids).not.toContain(DEMO_PROJECT_ID);
    });
  });

  describe('constructor with an agent store passed via window.history.state', () => {
    // Agent stores are explicitly unchanged: their project list has to come
    // from the live agent (the existing `watchAgentInfo`/`loadProjects` path
    // in `processStoreId`), not from state, so the constructor must not
    // throw for one but also must not fabricate a project list for it.
    beforeEach(() => {
      setHistoryState({
        store: {
          ref: { type: 'agent', url: 'http://localhost:8989' },
          brief: { type: 'agent', title: 'localhost:8989', projects: {} },
        },
      });
    });

    it('does not throw, and leaves storeId/projects unset for route-driven tracking to fill in', () => {
      expect(() => {
        fixture = TestBed.createComponent(DatatugStorePageComponent);
        component = fixture.componentInstance;
      }).not.toThrow();
      expect(component.storeId).toBeUndefined();
      expect(component.projects).toBeUndefined();
    });
  });

  describe('isGithubStore', () => {
    it('is true for the canonical github.com id', () => {
      component.storeId = 'github.com';
      expect(component.isGithubStore).toBe(true);
    });

    it('is true for the bare github id (the route sometimes carries this instead — see MyStoresComponent.goStore())', () => {
      component.storeId = 'github';
      expect(component.isGithubStore).toBe(true);
    });

    it('is false for firestore and agent ids', () => {
      component.storeId = 'firestore';
      expect(component.isGithubStore).toBe(false);
      component.storeId = 'http-localhost:8989';
      expect(component.isGithubStore).toBe(false);
    });
  });

  describe('openGithubProject', () => {
    beforeEach(() => {
      component.storeId = 'github.com';
    });

    it('builds <repository>@<owner>@<folder> from the form fields (defaults) and navigates to the project page', () => {
      const nav = TestBed.inject(DatatugNavService) as {
        goProject: ReturnType<typeof vi.fn>;
      };

      component.openGithubProject(new Event('submit'));

      expect(nav.goProject).toHaveBeenCalledTimes(1);
      const projectContext = nav.goProject.mock.calls[0][0];
      expect(projectContext.ref).toEqual({
        projectId: DEMO_PROJECT_ID,
        storeId: 'github.com',
      });
      expect(component.githubFormError()).toBeUndefined();
    });

    it('builds the id from edited owner/repository/folder fields', () => {
      const nav = TestBed.inject(DatatugNavService) as {
        goProject: ReturnType<typeof vi.fn>;
      };

      component.updateGithubField('owner', 'my-org');
      component.updateGithubField('repository', 'my-repo');
      component.updateGithubField('folder', 'my-folder');
      component.openGithubProject(new Event('submit'));

      const projectContext = nav.goProject.mock.calls[0][0];
      expect(projectContext.ref.projectId).toBe('my-repo@my-org@my-folder');
    });

    it('rejects an empty field without navigating', () => {
      const nav = TestBed.inject(DatatugNavService) as {
        goProject: ReturnType<typeof vi.fn>;
      };

      component.updateGithubField('owner', '');
      component.openGithubProject(new Event('submit'));

      expect(nav.goProject).not.toHaveBeenCalled();
      expect(component.githubFormError()).toBeTruthy();
    });

    it('rejects a field containing "@" without navigating', () => {
      const nav = TestBed.inject(DatatugNavService) as {
        goProject: ReturnType<typeof vi.fn>;
      };

      component.updateGithubField('repository', 'bad@repo');
      component.openGithubProject(new Event('submit'));

      expect(nav.goProject).not.toHaveBeenCalled();
      expect(component.githubFormError()).toBeTruthy();
    });
  });

  // Founder ruling 2026-09-11 (post-PR-#102 production check): GitHub is a
  // public, read-only store — its known projects (the demo project, merged
  // in by `withGithubDemoProjects()`) and the "Open a GitHub project" form
  // must render for anonymous visitors, not sit behind "Please sign in to
  // see projects". firestore (DataTug Cloud) and agent stores are
  // unchanged. Every other `describe` above overrides the component to an
  // empty template (`set: { template: '' }`), which cannot catch a
  // template-level gating regression like this one — that gap is exactly
  // how the bug shipped in #102. These render the real, un-stubbed
  // template instead.
  describe('project list gating in the real template', () => {
    let authState: BehaviorSubject<IDatatugUserState>;

    beforeEach(async () => {
      // The outer `describe`'s own `beforeEach` (runs before this one, per
      // Jasmine/Vitest nesting order) already calls
      // `TestBed.createComponent()`, which instantiates the module — after
      // that, `TestBed.configureTestingModule()` throws ("test module has
      // already been instantiated"). Reset first so this block can
      // configure its own module from a clean slate.
      TestBed.resetTestingModule();

      authState = new BehaviorSubject<IDatatugUserState>({
        status: 'notAuthenticated',
        record: null,
      });

      await TestBed.configureTestingModule({
        imports: [DatatugStorePageComponent],
        schemas: [CUSTOM_ELEMENTS_SCHEMA],
        providers: [
          provideRouter([]),
          provideIonicAngular(),
          {
            provide: ErrorLogger,
            useValue: {
              logError: vi.fn(),
              logErrorHandler: vi.fn(() => vi.fn()),
            },
          },
          {
            provide: ActivatedRoute,
            useValue: {
              queryParamMap: of({ get: () => null }),
              paramMap: of({ get: () => null }),
              snapshot: { paramMap: { get: () => null }, params: {} },
            },
          },
          { provide: DatatugStoreService, useValue: { getProjects: vi.fn() } },
          {
            provide: DatatugNavService,
            useValue: { goProject: vi.fn(), goStore: vi.fn() },
          },
          {
            provide: AgentStateService,
            useValue: { watchAgentInfo: vi.fn(() => of()) },
          },
          {
            provide: NewProjectService,
            useValue: { openNewProjectDialog: vi.fn() },
          },
          { provide: DatatugUserService, useValue: { datatugUserState: authState } },
        ],
      })
        .overrideComponent(DatatugStorePageComponent, {
          set: {
            imports: REAL_TEMPLATE_IMPORTS,
            providers: [],
            schemas: [CUSTOM_ELEMENTS_SCHEMA],
          },
        })
        .compileComponents();
    });

    function render(
      storeId: string,
      projects: typeof GITHUB_DEMO_PROJECTS | undefined,
    ): ComponentFixture<DatatugStorePageComponent> {
      const f = TestBed.createComponent(DatatugStorePageComponent);
      f.componentInstance.storeId = storeId;
      f.componentInstance.projects = projects;
      f.detectChanges();
      return f;
    }

    // `ion-label`'s real Stencil shadow-DOM implementation does not reliably
    // surface a BARE text-node child (e.g. "Please sign in to see
    // projects") through `Element.textContent` read on any ancestor in this
    // vitest/happy-dom environment — verified empirically: the same text is
    // present in `innerHTML`'s serialized markup, and an ELEMENT child
    // inside an `ion-label` (e.g. this template's project-title `<h3>`) DOES
    // come through `textContent` fine, so this is specifically a bare-text-
    // node-in-`ion-label` quirk of this test environment, not a real
    // rendering bug. `innerHTML` is unaffected (it's a markup serialization,
    // not the same runtime aggregation), so assert against it instead.
    const html = (f: ComponentFixture<DatatugStorePageComponent>): string =>
      (f.nativeElement as HTMLElement).innerHTML;

    it('anonymous + GitHub store: lists the demo project and shows the "Open a GitHub project" form, no sign-in prompt', () => {
      authState.next({ status: 'notAuthenticated', record: null });

      const f = render('github.com', [...GITHUB_DEMO_PROJECTS]);

      expect(html(f)).not.toContain('Please sign in to see projects');
      expect(f.nativeElement.querySelector('h3')?.textContent).toBe(
        'DataTug Demo Project @ GitHub',
      );
      expect(
        f.nativeElement.querySelector('ion-card-title')?.textContent,
      ).toContain('Open a GitHub project');
      expect(f.nativeElement.querySelectorAll('ion-input').length).toBe(3);
    });

    it('anonymous + firestore: still shows "Please sign in to see projects" (unchanged)', () => {
      authState.next({ status: 'notAuthenticated', record: null });

      const f = render('firestore', undefined);

      expect(html(f)).toContain('Please sign in to see projects');
      expect(html(f)).not.toContain('Open a GitHub project');
      expect(f.nativeElement.querySelector('h3')).toBeNull();
    });

    it('anonymous + agent store: still shows "Please sign in to see projects" (current behaviour preserved)', () => {
      authState.next({ status: 'notAuthenticated', record: null });

      const f = render('http-localhost:8989', undefined);

      expect(html(f)).toContain('Please sign in to see projects');
      expect(html(f)).not.toContain('Open a GitHub project');
      expect(f.nativeElement.querySelector('h3')).toBeNull();
    });

    it('authenticated + firestore: shows the project list, not the sign-in prompt (sanity check the gate still opens)', () => {
      authState.next({ status: 'authenticated', record: null });

      const f = render('firestore', []);

      expect(html(f)).not.toContain('Please sign in to see projects');
      expect(html(f)).toContain('No projects yet');
    });
  });
});
