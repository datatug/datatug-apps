import { ErrorStateComponent } from '../../../components/error-state/error-state.component';
import { TitleCasePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { CUSTOM_ELEMENTS_SCHEMA, Provider } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  DefaultUrlSerializer,
  Router,
  RouterLink,
  convertToParamMap,
} from '@angular/router';
import { NavController } from '@ionic/angular';
import { SneatAuthStateService } from '@sneat/auth-core';
import { ErrorLogger } from '@sneat/core';
import { Firestore } from 'firebase/firestore';
import { Observable, of, Subject, throwError } from 'rxjs';

import { QueriesService } from '../../../queries/queries.service';
import { ProjectPageComponent } from './project-page.component';
import { DatatugBoardService } from '../../../board/core/datatug-board.service';
import { DatatugFolderComponent } from '../../../folders/ui/datatug-folder.component';
import { IProjectSummary } from '../../../models/definition/project';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { ProjectService } from '../../../services/project/project.service';
import { SchemaService } from '../../../services/unsorted/schema.service';
import { EnvironmentService } from '../../../services/unsorted/environment.service';
import { EntityService } from '../../../services/unsorted/entity.service';
import { ProjectAssetsReadService } from '../../../services/project/project-assets-read.service';
import { QualifiedLocalReadVersionError } from '../../../services/project/project-query-api.service';

interface TestDoubles {
  readonly logError: ReturnType<typeof vi.fn>;
  readonly watchProjectSummary: ReturnType<typeof vi.fn>;
}

function baseProviders(
  doubles: TestDoubles,
  routeParams: Record<string, string> = {},
): Provider[] {
  const paramMap = convertToParamMap(routeParams);
  return [
    {
      provide: QueriesService,
      useValue: {
        getQueriesFolder: vi.fn(() => of({ id: '~', items: [], folders: [] })),
      },
    },
    {
      provide: ErrorLogger,
      useValue: {
        logError: doubles.logError,
        logErrorHandler: vi.fn(() => vi.fn()),
      },
    },
    {
      provide: SneatAuthStateService,
      useValue: {
        authState: of({ status: 'notAuthenticated', user: undefined }),
      },
    },
    {
      provide: ActivatedRoute,
      useValue: {
        queryParamMap: of(convertToParamMap({})),
        paramMap: of(paramMap),
        snapshot: {
          paramMap,
          queryParamMap: convertToParamMap({}),
          params: routeParams,
        },
      },
    },
    {
      provide: Router,
      useValue: {
        parseUrl: (url: string) => new DefaultUrlSerializer().parse(url),
        serializeUrl: (url: unknown) =>
          new DefaultUrlSerializer().serialize(url as never),
        navigateByUrl: vi.fn(() => Promise.resolve(true)),
      },
    },
    {
      provide: DatatugNavService,
      useValue: {
        goEnvironment: vi.fn(),
        goEntity: vi.fn(),
        goBoard: vi.fn(),
        goProjPage: vi.fn(),
        goProject: vi.fn(),
        projectPageUrl: vi.fn(),
      },
    },
    {
      provide: DatatugNavContextService,
      useValue: {
        currentProject: of(undefined),
        currentEnv: of(undefined),
        setCurrentEnvironment: vi.fn(),
      },
    },
    {
      provide: ProjectService,
      useValue: {
        watchProjectSummary: doubles.watchProjectSummary,
        getFull: vi.fn(() => of({ environments: [] })),
      },
    },
    { provide: SchemaService, useValue: {} },
    {
      provide: EnvironmentService,
      useValue: {
        getEnvSummary: vi.fn(),
        listEnvironments: vi.fn(() => of([])),
      },
    },
    {
      provide: EntityService,
      useValue: { getAllEntities: vi.fn(() => of([])) },
    },
    {
      provide: ProjectAssetsReadService,
      useValue: {
        boards: vi.fn(() => of([])),
        environments: vi.fn(() => of([])),
        entities: vi.fn(() => of([])),
      },
    },
    {
      provide: NavController,
      useValue: {
        navigateForward: vi.fn(() => Promise.resolve(true)),
        navigateRoot: vi.fn(),
      },
    },
  ];
}

describe('ProjectPage', () => {
  let component: ProjectPageComponent;
  let fixture: ComponentFixture<ProjectPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: baseProviders({
        logError: vi.fn(),
        watchProjectSummary: vi.fn(() => of()),
      }),
    })
      .overrideComponent(ProjectPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ProjectPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
  it('submits the overview query to Quick Search while preserving project qualifiers', () => {
    const page = component as unknown as {
      setProjRef(ref: {
        storeId: string;
        projectId: string;
        projectApi: 'cloud';
        branch: string;
      }): void;
    };
    page.setProjRef({
      storeId: 'github.com',
      projectId: 'repo@owner@',
      projectApi: 'cloud',
      branch: 'main',
    });
    component.quickSearchQuery.set(' Customers ');
    const event = new Event('submit', { cancelable: true });
    component.submitQuickSearch(event);
    expect(event.defaultPrevented).toBe(true);
    const router = TestBed.inject(Router),
      navigate = vi.mocked(router.navigateByUrl);
    expect(navigate).toHaveBeenCalledOnce();
    expect(router.serializeUrl(navigate.mock.calls[0][0] as never)).toBe(
      '/project/github.com/owner/repo/quick-search?projectApi=cloud&branch=main&q=Customers',
    );
  });
  it('does not navigate with an empty overview query', () => {
    component.quickSearchQuery.set('  ');
    component.submitQuickSearch(new Event('submit'));
    expect(TestBed.inject(Router).navigateByUrl).not.toHaveBeenCalled();
  });

  it('offers the private sandbox route only for the canonical DemoDB project', () => {
    const page = component as unknown as {
      setProjRef(ref: {
        storeId: string;
        projectId: string;
        spaceID?: string;
      }): void;
      sandboxHref(): string | undefined;
      activeTab(): string;
    };
    page.setProjRef({
      storeId: 'github.com',
      projectId: 'datatug-demo-project@datatug@demo-project-1',
    });
    expect(page.sandboxHref()).toBe(
      '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/demo-db-sandbox',
    );
    expect(page.activeTab()).toBe('queries');
    page.setProjRef({
      storeId: 'github.com',
      projectId: 'datatug-demo-project@datatug@other',
    });
    expect(page.sandboxHref()).toBeUndefined();
    page.setProjRef({
      storeId: 'firestore',
      projectId: 'datatug-demo-project@datatug@demo-project-1',
      spaceID: 'space-1',
    });
    expect(page.sandboxHref()).toBeUndefined();
  });

  it('preserves project API and branch context in the public data URL tree', () => {
    const page = component as unknown as {
      project: { set(project: { ref: Record<string, string> }): void };
      publicDataHref(): { queryParams: Record<string, string> } | undefined;
    };
    page.project.set({
      ref: {
        storeId: 'github.com',
        projectId: 'owner@repo',
        projectApi: 'cloud',
        branch: 'feature/ref',
      },
    });

    expect(page.publicDataHref()?.queryParams).toEqual({
      projectApi: 'cloud',
      branch: 'feature/ref',
    });
  });

  // G-A1c: the page of a project's items folder is at the address `projectUrl()` writes (this method has no caller
  // yet; its old path, `project/<id>/<items>`, matched no route).
  describe('goProjFolder', () => {
    const goProjFolder = (item: string) =>
      (
        component as unknown as { goProjFolder(item: string): void }
      ).goProjFolder(item);
    const setProject = (ref: { storeId: string; projectId: string }) =>
      (
        component as unknown as {
          project: { set(project: { ref: typeof ref }): void };
        }
      ).project.set({ ref });

    it.each([
      [
        'an agent project',
        { storeId: 'localhost:8989', projectId: 'p1' },
        '/store/localhost:8989/project/p1/entitys',
      ],
      [
        'a GitHub project',
        { storeId: 'github.com', projectId: 'chinook-demo@datatug@' },
        '/project/github.com/datatug/chinook-demo/entitys',
      ],
    ])('opens the folder of %s at its address', (_name, ref, address) => {
      const navController = TestBed.inject(NavController) as unknown as {
        navigateForward: ReturnType<typeof vi.fn>;
      };
      setProject(ref);

      goProjFolder('entity');

      expect(navController.navigateForward).toHaveBeenCalledWith(address, {
        state: { project: { ref } },
      });
    });

    it('opens the shared Space query list at its own address', () => {
      const ref = { storeId: 'firestore', spaceID: 'S1', projectId: 'P1' };
      const navController = TestBed.inject(NavController) as unknown as {
        navigateForward: ReturnType<typeof vi.fn>;
      };
      setProject(ref);
      goProjFolder('query');
      expect(navController.navigateForward).toHaveBeenCalledWith(
        '/space/S1/store/firestore/project/P1/queries',
        { state: { project: { ref } } },
      );
    });

    it('navigates nowhere, and says so, for a project that has no exact address', () => {
      const navController = TestBed.inject(NavController) as unknown as {
        navigateForward: ReturnType<typeof vi.fn>;
      };
      setProject({ storeId: 'localhost:8989', projectId: '50%' });

      goProjFolder('entity');

      expect(navController.navigateForward).not.toHaveBeenCalled();
      expect(
        (
          TestBed.inject(ErrorLogger) as unknown as {
            logError: ReturnType<typeof vi.fn>;
          }
        ).logError,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('no exact address'),
        }),
        'Failed to navigate to project item page: entity',
      );
    });

    it('does nothing for a page with no project', () => {
      const navController = TestBed.inject(NavController) as unknown as {
        navigateForward: ReturnType<typeof vi.fn>;
      };
      goProjFolder('entity');
      expect(navController.navigateForward).not.toHaveBeenCalled();
    });
  });
});

describe('ProjectPage qualified summary errors', () => {
  it('renders trusted CLI guidance and clears it when the project ref changes', async () => {
    const lateFirstSummary$ = new Subject<IProjectSummary>();
    let repeatedRefCalls = 0;
    const watchProjectSummary = vi.fn((ref: { projectId: string }) => {
      if (ref.projectId === 'old')
        return throwError(() => new QualifiedLocalReadVersionError());
      if (ref.projectId === 'repeat' && repeatedRefCalls++ === 0)
        return lateFirstSummary$.asObservable();
      return of({ id: ref.projectId, title: 'Current project' });
    });
    await TestBed.configureTestingModule({
      imports: [ProjectPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: baseProviders({ logError: vi.fn(), watchProjectSummary }),
    })
      .overrideComponent(ProjectPageComponent, {
        set: {
          imports: [],
          template: '<p role="alert">{{ metadataReadError() || "" }}</p>',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(ProjectPageComponent);
    const page = fixture.componentInstance as unknown as {
      setProjRef(ref: {
        storeId: string;
        projectId: string;
        branch?: string;
      }): void;
    };
    page.setProjRef({
      storeId: 'localhost:8989',
      projectId: 'old',
      branch: 'feature',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toMatch(
      /update DataTug CLI to v0\.97\.0 or later.*restart its agent/i,
    );

    page.setProjRef({ storeId: 'github.com', projectId: 'new' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('v0.97.0');

    page.setProjRef({
      storeId: 'localhost:8989',
      projectId: 'repeat',
      branch: 'feature',
    });
    page.setProjRef({ storeId: 'github.com', projectId: 'latest' });
    page.setProjRef({
      storeId: 'localhost:8989',
      projectId: 'repeat',
      branch: 'feature',
    });
    lateFirstSummary$.error(new QualifiedLocalReadVersionError());
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('v0.97.0');
  });
});

/**
 * Regression for the blank project page against a local `datatug serve`
 * agent: `GET /datatug/projects/project_summary` succeeded and
 * `onProjectSummaryChanged()` received the title, yet nothing rendered,
 * because the page's `<sneat-datatug-folder>` child asked
 * `DatatugStoreServiceFactory` for the `localhost:<port>` store and it threw
 * `unknown store: ...` out of `ngOnChanges`, aborting the change-detection
 * pass that would have committed the title. This is the first assertion of
 * the e2e journey J1 (`apps/datatug-app/e2e/journey/journey.spec.ts`), here
 * with the real page template, the real folder child, the real
 * `DatatugFoldersService` and the real store-service factory — only the
 * leaf I/O (HTTP, Firestore) and unrelated services are doubles.
 */
describe('ProjectPage rendering a local-agent store project', () => {
  const summary: IProjectSummary = {
    id: 'datatug-demo-project',
    title: 'DataTug Demo Project 1',
    access: 'private',
  };
  let doubles: TestDoubles;

  const createPage = async (
    storeId: string,
    projectId = summary.id,
    authState: Observable<{
      status: string;
      user?: { uid?: string; isAnonymous?: boolean } | undefined;
    }> = of({ status: 'notAuthenticated', user: undefined }),
  ): Promise<ComponentFixture<ProjectPageComponent>> => {
    await TestBed.configureTestingModule({
      imports: [ProjectPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        ...baseProviders(doubles, { storeId, projectId }),
        { provide: SneatAuthStateService, useValue: { authState } },
        { provide: HttpClient, useValue: { get: vi.fn(() => of({})) } },
        { provide: Firestore, useValue: {} },
        { provide: DatatugBoardService, useValue: {} },
      ],
    })
      // Real page template + real folder child; Ionic elements and the
      // card list render as unknown elements (no Ionic runtime needed).
      .overrideComponent(ProjectPageComponent, {
        set: {
          imports: [DatatugFolderComponent, RouterLink],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .overrideComponent(DatatugFolderComponent, {
        set: { imports: [TitleCasePipe], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    return TestBed.createComponent(ProjectPageComponent);
  };

  beforeEach(() => {
    doubles = {
      logError: vi.fn(),
      watchProjectSummary: vi.fn(() => of(summary)),
    };
  });

  it.each(['localhost:8989', '127.0.0.1:8989', 'http-localhost:8989'])(
    'renders the project title for store %s without throwing',
    async (storeId) => {
      const fixture = await createPage(storeId);
      expect(() => fixture.detectChanges()).not.toThrow();
      const title = fixture.nativeElement.querySelector('h1.project-title');
      expect(title.textContent).toContain('DataTug Demo Project 1');
      const context = fixture.nativeElement.querySelector(
        '.project-context-meta',
      ) as HTMLElement;
      expect(context).toBeTruthy();
      expect(doubles.logError).not.toHaveBeenCalled();
    },
  );

  it('shows one set of four overview tabs and opens the selected content', async () => {
    const fixture = await createPage('localhost:8989');
    fixture.detectChanges();
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('.overview-tabs button'),
    ) as HTMLButtonElement[];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      'Boards',
      'Queries 0',
      'Entities',
      'Databases',
    ]);
    expect(buttons[1].querySelector('ion-chip')?.textContent?.trim()).toBe('0');
    expect(fixture.nativeElement.querySelector('ion-segment')).toBeNull();
    buttons[1].click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        'sneat-datatug-project-queries-preview',
      ),
    ).not.toBeNull();
  });

  it('updates the query count on another tab and cancels stale project counts', async () => {
    const fixture = await createPage('localhost:8989');
    fixture.detectChanges();
    const get = TestBed.inject(QueriesService).getQueriesFolder as ReturnType<
      typeof vi.fn
    >;
    const first = new Subject<unknown>();
    const second = new Subject<unknown>();
    get.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const page = fixture.componentInstance as unknown as {
      setProjRef: (ref: { storeId: string; projectId: string }) => void;
    };
    page.setProjRef({ storeId: 'localhost:8989', projectId: 'first' });
    first.next({
      id: '~',
      items: [{ id: 'a' }],
      folders: [{ id: 'nested', items: [{ id: 'b' }] }],
    });
    await fixture.whenStable();
    expect(
      fixture.nativeElement
        .querySelector('.overview-tabs ion-chip')
        ?.textContent?.trim(),
    ).toBe('2');
    expect(
      fixture.nativeElement.querySelector(
        'sneat-datatug-project-queries-preview',
      ),
    ).toBeNull();
    page.setProjRef({ storeId: 'localhost:8989', projectId: 'second' });
    first.next({ id: '~', items: [{ id: 'stale' }] });
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('.overview-tabs ion-chip'),
    ).toBeNull();
    second.next({ id: '~', items: [] });
    await fixture.whenStable();
    expect(
      fixture.nativeElement
        .querySelector('.overview-tabs ion-chip')
        ?.textContent?.trim(),
    ).toBe('0');
  });

  it('uses sandbox setup copy for an existing signed-in session', async () => {
    const fixture = await createPage(
      'github.com',
      'datatug-demo-project@datatug@demo-project-1',
      of({ status: 'authenticated', user: { uid: 'registered-user' } }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Create a private, writable clone',
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'Sign in to create',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Set up private sandbox',
    );
  });

  const expectSandboxSignInCopy = async (
    authState: Observable<{
      status: string;
      user?: { uid?: string; isAnonymous?: boolean } | undefined;
    }>,
  ): Promise<void> => {
    const fixture = await createPage(
      'github.com',
      'datatug-demo-project@datatug@demo-project-1',
      authState,
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sign in to create');
    expect(fixture.nativeElement.textContent).not.toContain(
      'Create a private, writable clone',
    );
  };

  it('keeps sign-in copy for an anonymous user', async () => {
    await expectSandboxSignInCopy(
      of({
        status: 'authenticated',
        user: { uid: 'anonymous-user', isAnonymous: true },
      }),
    );
  });

  it('keeps sign-in copy while authentication is still resolving', async () => {
    await expectSandboxSignInCopy(
      of({ status: 'authenticating', user: { uid: 'pending-user' } }),
    );
  });

  it('settles the Boards asset list out of its loading state for a local agent', async () => {
    const fixture = await createPage('localhost:8989');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(
      TestBed.inject(ProjectAssetsReadService).boards,
    ).toHaveBeenCalledWith({
      storeId: 'localhost:8989',
      projectId: summary.id,
    });
  });

  it('uses the asset reader after selecting a branch', async () => {
    const fixture = await createPage('localhost:8989');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ion-list')).not.toBeNull();
    const getFull = TestBed.inject(ProjectService).getFull as ReturnType<
      typeof vi.fn
    >;
    const assets = TestBed.inject(ProjectAssetsReadService);
    const entityReads = (assets.entities as ReturnType<typeof vi.fn>).mock.calls
      .length;
    const fullReads = getFull.mock.calls.length;
    const summaryReads = doubles.watchProjectSummary.mock.calls.length;

    const page = fixture.componentInstance as unknown as {
      setProjRef(ref: {
        storeId: string;
        projectId: string;
        projectApi: 'local';
        branch: string;
      }): void;
    };
    page.setProjRef({
      storeId: 'localhost:8989',
      projectId: summary.id,
      projectApi: 'local',
      branch: 'feature',
    });
    await fixture.whenStable();
    expect(getFull).toHaveBeenCalledTimes(fullReads);
    expect(assets.entities).toHaveBeenCalledTimes(entityReads + 1);
    expect(doubles.watchProjectSummary).toHaveBeenCalledTimes(summaryReads + 1);
    expect(doubles.watchProjectSummary).toHaveBeenLastCalledWith({
      storeId: 'localhost:8989',
      projectId: summary.id,
      projectApi: 'local',
      branch: 'feature',
    });
    expect(
      fixture.nativeElement.querySelector('h1.project-title')?.textContent,
    ).toContain('DataTug Demo Project 1');
    expect(fixture.nativeElement.textContent).not.toContain(
      'Project metadata is unavailable',
    );
    expect(
      fixture.nativeElement.querySelector(
        '[aria-label="Loading environments"]',
      ),
    ).toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'Environment shortcuts are unavailable',
    );

    expect(
      fixture.nativeElement.querySelector('sneat-datatug-folder'),
    ).toBeNull();
    expect(assets.boards).toHaveBeenCalledWith({
      storeId: 'localhost:8989',
      projectId: summary.id,
      projectApi: 'local',
      branch: 'feature',
    });

    for (const [tab, label] of [
      [2, 'Entities'],
      [3, 'Databases'],
    ] as const) {
      (
        fixture.nativeElement.querySelectorAll('.overview-tabs button')[
          tab
        ] as HTMLButtonElement
      ).click();
      await fixture.whenStable();
      if (label === 'Databases') {
        expect(fixture.nativeElement.textContent).toContain(
          'Databases are unavailable',
        );
      } else {
        expect(fixture.nativeElement.textContent).not.toContain(
          `${label} are unavailable`,
        );
      }
    }
  });
});

/**
 * Regression for the journey e2e title-load flake (S126 — datatug/datatug
 * spec/plans/2026-09-09-phase-1-core-investigation-loop.md Task 3's note;
 * journey.spec.ts J1 and epilogues.spec.ts Epilogue A both assert the Title
 * textbox's value). Unlike the suite above — which double-provides
 * `watchProjectSummary` with `of(summary)`, a SYNCHRONOUS observable that
 * already delivers the title before the very first `fixture.detectChanges()`
 * call, so that first (real, TestBed-driven) change-detection pass renders
 * the correct value regardless of whether the fix is present — this double
 * uses a `Subject` so the summary arrives strictly AFTER the page has
 * already rendered once (matching the real HTTP timing the e2e flake hit:
 * the response arrives after the address-derived project heading renders).
 * Deliberately never calls `fixture.detectChanges()` again
 * after that: this app is zoneless (`provideZonelessChangeDetection()`,
 * apps/datatug-app/src/main.ts), so a manual `detectChanges()` call would
 * force a check regardless of whether the underlying state is wired to
 * notify Angular's own scheduler — masking exactly the gap this test exists
 * to catch. `fixture.whenStable()` instead awaits only what Angular's own
 * zoneless scheduler has actually queued, the same idiom already used for
 * this identical class of gap elsewhere in this codebase
 * (context-panel.component.spec.ts, investigation-context-page.component
 * .spec.ts). Fails without the fix: with `project` as a plain mutable field,
 * `onProjectSummaryChanged()`'s assignment never schedules a repaint, so the
 * heading stays at its fallback identity even after `whenStable()` resolves.
 */
describe('ProjectPage commits the title once it arrives asynchronously (zoneless)', () => {
  const summary: IProjectSummary = {
    id: 'datatug-demo-project',
    title: 'DataTug Demo Project 1',
    access: 'private',
  };

  it('updates the project heading with no explicit detectChanges() call after the summary arrives', async () => {
    const summary$ = new Subject<IProjectSummary>();
    const doubles: TestDoubles = {
      logError: vi.fn(),
      watchProjectSummary: vi.fn(() => summary$.asObservable()),
    };

    await TestBed.configureTestingModule({
      imports: [ProjectPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        ...baseProviders(doubles, {
          storeId: 'localhost:8989',
          projectId: summary.id,
        }),
        { provide: HttpClient, useValue: { get: vi.fn(() => of({})) } },
        { provide: Firestore, useValue: {} },
        { provide: DatatugBoardService, useValue: {} },
      ],
    })
      .overrideComponent(ProjectPageComponent, {
        set: {
          imports: [DatatugFolderComponent, RouterLink],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .overrideComponent(DatatugFolderComponent, {
        set: { imports: [TitleCasePipe], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(ProjectPageComponent);
    fixture.detectChanges(); // initial render — no summary has arrived yet

    const title = fixture.nativeElement.querySelector('h1.project-title');
    expect(title.textContent).toContain(summary.id);

    // The summary arrives strictly after the initial render — the real
    // HTTP-response timing this flake reproduced.
    summary$.next(summary);

    // No `fixture.detectChanges()` here — see this describe block's own
    // header comment for why.
    await fixture.whenStable();

    expect(title.textContent).toContain('DataTug Demo Project 1');
    expect(doubles.logError).not.toHaveBeenCalled();
  });

  it('keeps the URL project summary live after a different history-state project emits first', async () => {
    const savedState = window.history.state;
    const savedUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const historyRef = { storeId: 'github.com', projectId: 'cached-project' };
    const routeRef = { storeId: 'github.com', projectId: 'current-project' };
    const summary$ = new Subject<IProjectSummary>();
    const watchProjectSummary = vi.fn((ref: { projectId: string }) =>
      ref.projectId === 'current-project'
        ? summary$.asObservable()
        : of(undefined),
    );
    let fixture: ComponentFixture<ProjectPageComponent> | undefined;
    window.history.replaceState({ project: { ref: historyRef } }, '', savedUrl);
    try {
      await TestBed.configureTestingModule({
        imports: [ProjectPageComponent],
        schemas: [CUSTOM_ELEMENTS_SCHEMA],
        providers: [
          ...baseProviders(
            { logError: vi.fn(), watchProjectSummary },
            routeRef,
          ),
          { provide: HttpClient, useValue: { get: vi.fn(() => of({})) } },
          { provide: Firestore, useValue: {} },
          { provide: DatatugBoardService, useValue: {} },
        ],
      })
        .overrideComponent(ProjectPageComponent, {
          set: {
            imports: [RouterLink],
            schemas: [CUSTOM_ELEMENTS_SCHEMA],
            providers: [],
          },
        })
        .compileComponents();
      fixture = TestBed.createComponent(ProjectPageComponent);
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('h1.project-title')?.textContent,
      ).toContain('current-project');

      summary$.next({
        id: 'current-project',
        title: 'Current route project',
        access: 'private',
      });
      await fixture.whenStable();

      expect(watchProjectSummary).toHaveBeenCalledWith(routeRef);
      expect(
        fixture.nativeElement.querySelector('h1.project-title')?.textContent,
      ).toContain('Current route project');
    } finally {
      fixture?.destroy();
      window.history.replaceState(savedState, '', savedUrl);
    }
  });

  it.each([
    ['empty', () => of()],
    ['unavailable', () => of(undefined)],
    ['error', () => throwError(() => new Error('offline'))],
  ])(
    'shows the address identity when metadata is %s',
    async (_state, source) => {
      const ref = {
        storeId: 'github.com',
        projectId: 'datatug-demo-project@datatug@demo-project-1',
      };
      await TestBed.configureTestingModule({
        imports: [ProjectPageComponent],
        schemas: [CUSTOM_ELEMENTS_SCHEMA],
        providers: [
          ...baseProviders(
            { logError: vi.fn(), watchProjectSummary: vi.fn(source) },
            ref,
          ),
          { provide: HttpClient, useValue: { get: vi.fn(() => of({})) } },
          { provide: Firestore, useValue: {} },
          { provide: DatatugBoardService, useValue: {} },
        ],
      })
        .overrideComponent(ProjectPageComponent, {
          set: {
            imports: [RouterLink, ErrorStateComponent],
            schemas: [CUSTOM_ELEMENTS_SCHEMA],
            providers: [],
          },
        })
        .compileComponents();
      const fixture = TestBed.createComponent(ProjectPageComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(
        fixture.nativeElement.querySelector('h1.project-title')?.textContent,
      ).toContain('demo-project-1');
      expect(fixture.nativeElement.textContent).not.toContain('Loading...');
      if (_state === 'empty' || _state === 'unavailable') {
        expect(fixture.nativeElement.textContent).toContain(
          'Project details are unavailable',
        );
      } else {
        expect(
          fixture.nativeElement.querySelector('[role="alert"]')?.textContent,
        ).toContain('Something went wrong');
      }
    },
  );
});

describe('ProjectPage overview lists', () => {
  it('settles empty environments and reports an entity read error without leaving a spinner', async () => {
    const logError = vi.fn();
    await TestBed.configureTestingModule({
      imports: [ProjectPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        ...baseProviders({ logError, watchProjectSummary: vi.fn(() => of()) }),
        {
          provide: ProjectAssetsReadService,
          useValue: {
            boards: vi.fn(() => of([])),
            environments: vi.fn(() => of([])),
            entities: vi.fn(() => throwError(() => new Error('offline'))),
          },
        },
      ],
    })
      .overrideComponent(ProjectPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();
    const page = TestBed.createComponent(ProjectPageComponent)
      .componentInstance as unknown as {
      setProjRef(ref: { storeId: string; projectId: string }): void;
      environments: { (): { id: string }[] | undefined };
      entities: { (): { id: string }[] | undefined };
      entityError: { (): boolean };
      environmentError: { (): boolean };
    };
    page.setProjRef({ storeId: 'github.com', projectId: 'empty' });
    expect(page.environments()).toEqual([]);
    expect(page.environmentError()).toBe(false);
    expect(page.entities()).toBeUndefined();
    expect(page.entityError()).toBe(true);
    expect(logError).toHaveBeenCalledWith(
      expect.any(Error),
      'Failed to load overview entities',
      { show: false },
    );
  });

  it('drops delayed data from the previous project and navigates using the current project', async () => {
    const oldEnvironments = new Subject<{ id: string; title: string }[]>();
    const oldEntities = new Subject<{ id: string; title: string }[]>();
    const listEnvironments = vi.fn((ref: { projectId: string }) =>
      ref.projectId === 'old'
        ? oldEnvironments.asObservable()
        : of([{ id: 'qa', title: 'QA' }]),
    );
    const getAllEntities = vi.fn((ref: { projectId: string }) =>
      ref.projectId === 'old'
        ? oldEntities.asObservable()
        : of([{ id: 'Album', title: 'Album' }]),
    );
    const nav = {
      goEnvironment: vi.fn(),
      goEntity: vi.fn(),
      goBoard: vi.fn(),
      goProjPage: vi.fn(),
      goProject: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [ProjectPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        ...baseProviders({
          logError: vi.fn(),
          watchProjectSummary: vi.fn(() => of()),
        }),
        {
          provide: ProjectAssetsReadService,
          useValue: {
            boards: vi.fn(() => of([])),
            environments: listEnvironments,
            entities: getAllEntities,
          },
        },
        { provide: DatatugNavService, useValue: nav },
      ],
    })
      .overrideComponent(ProjectPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();
    const page = TestBed.createComponent(ProjectPageComponent)
      .componentInstance as unknown as {
      setProjRef(ref: { storeId: string; projectId: string }): void;
      environments: { (): { id: string }[] | undefined };
      entities: { (): { id: string }[] | undefined };
      goEnvironment(value: { id: string }): void;
      goEntity(value: { id: string }): void;
    };
    page.setProjRef({ storeId: 'github.com', projectId: 'old' });
    page.setProjRef({ storeId: 'github.com', projectId: 'new' });
    oldEnvironments.next([{ id: 'stale', title: 'Stale' }]);
    oldEntities.next([{ id: 'Stale', title: 'Stale' }]);
    expect(page.environments()?.map((value) => value.id)).toEqual(['qa']);
    expect(page.entities()?.map((value) => value.id)).toEqual(['Album']);
    page.goEnvironment({ id: 'qa' });
    page.goEntity({ id: 'Album' });
    expect(nav.goEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: { storeId: 'github.com', projectId: 'new' },
      }),
      { id: 'qa' },
    );
    expect(nav.goEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: { storeId: 'github.com', projectId: 'new' },
      }),
      { id: 'Album' },
    );
  });
});
