import { TitleCasePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { CUSTOM_ELEMENTS_SCHEMA, Provider } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { NavController } from '@ionic/angular';
import { ErrorLogger } from '@sneat/core';
import { Firestore } from 'firebase/firestore';
import { of, Subject, throwError } from 'rxjs';

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
      provide: ErrorLogger,
      useValue: {
        logError: doubles.logError,
        logErrorHandler: vi.fn(() => vi.fn()),
      },
    },
    {
      provide: ActivatedRoute,
      useValue: {
        queryParamMap: of(convertToParamMap({})),
        paramMap: of(paramMap),
        snapshot: { paramMap, params: routeParams },
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
  ): Promise<ComponentFixture<ProjectPageComponent>> => {
    await TestBed.configureTestingModule({
      imports: [ProjectPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        ...baseProviders(doubles, { storeId, projectId: summary.id }),
        { provide: HttpClient, useValue: { get: vi.fn(() => of({})) } },
        { provide: Firestore, useValue: {} },
        { provide: DatatugBoardService, useValue: {} },
      ],
    })
      // Real page template + real folder child; Ionic elements and the
      // card list render as unknown elements (no Ionic runtime needed).
      .overrideComponent(ProjectPageComponent, {
        set: {
          imports: [DatatugFolderComponent],
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
      const title = fixture.nativeElement.querySelector(
        'ion-input',
      ) as HTMLElement & { value?: string };
      expect(title.value).toBe('DataTug Demo Project 1');
      const context = fixture.nativeElement.querySelector(
        '.project-context-card',
      ) as HTMLElement;
      expect(context).toBeTruthy();
      expect(context.querySelector('ion-select')).toBeTruthy();
      expect(doubles.logError).not.toHaveBeenCalled();
    },
  );

  it('settles the Boards folder card out of its loading state (no folder on a local agent = empty list, not a spinner)', async () => {
    const fixture = await createPage('localhost:8989');
    fixture.detectChanges();
    const boardsCard = fixture.nativeElement.querySelector(
      'sneat-card-list',
    ) as HTMLElement & { isLoading?: boolean; items?: unknown[] };
    expect(boardsCard.isLoading).toBe(false);
    expect(boardsCard.items).toEqual([]);
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
 * the response arrives once the Title `ion-input` already shows
 * "Loading..."). Deliberately never calls `fixture.detectChanges()` again
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
 * title stays "Loading..." even after `whenStable()` resolves.
 */
describe('ProjectPage commits the title once it arrives asynchronously (zoneless)', () => {
  const summary: IProjectSummary = {
    id: 'datatug-demo-project',
    title: 'DataTug Demo Project 1',
    access: 'private',
  };

  it('updates the Title textbox with no explicit detectChanges() call after the summary arrives', async () => {
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
          imports: [DatatugFolderComponent],
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

    const title = fixture.nativeElement.querySelector(
      'ion-input',
    ) as HTMLElement & { value?: string };
    expect(title.value).toBe('Loading...');

    // The summary arrives strictly after the initial render — the real
    // HTTP-response timing this flake reproduced.
    summary$.next(summary);

    // No `fixture.detectChanges()` here — see this describe block's own
    // header comment for why.
    await fixture.whenStable();

    expect(title.value).toBe('DataTug Demo Project 1');
    expect(doubles.logError).not.toHaveBeenCalled();
  });
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
          provide: EnvironmentService,
          useValue: { listEnvironments: vi.fn(() => of([])) },
        },
        {
          provide: EntityService,
          useValue: {
            getAllEntities: vi.fn(() => throwError(() => new Error('offline'))),
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
    );
  });

  it('drops delayed data from the previous project and navigates using the current project', async () => {
    const oldEnvironments = new Subject<{ id: string; title: string }[]>();
    const oldEntities = new Subject<{ id: string; dbo: { title: string } }[]>();
    const listEnvironments = vi.fn((projectId: string) =>
      projectId === 'old'
        ? oldEnvironments.asObservable()
        : of([{ id: 'qa', title: 'QA' }]),
    );
    const getAllEntities = vi.fn((ref: { projectId: string }) =>
      ref.projectId === 'old'
        ? oldEntities.asObservable()
        : of([{ id: 'Album', dbo: { title: 'Album' } }]),
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
        { provide: EnvironmentService, useValue: { listEnvironments } },
        { provide: EntityService, useValue: { getAllEntities } },
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
    oldEntities.next([{ id: 'Stale', dbo: { title: 'Stale' } }]);
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
