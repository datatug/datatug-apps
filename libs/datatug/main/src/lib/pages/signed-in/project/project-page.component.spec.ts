import { TitleCasePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { CUSTOM_ELEMENTS_SCHEMA, Provider } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { NavController } from '@ionic/angular';
import { ErrorLogger } from '@sneat/core';
import { Firestore } from 'firebase/firestore';
import { of } from 'rxjs';

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
        getFull: vi.fn(),
      },
    },
    { provide: SchemaService, useValue: {} },
    { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn() } },
    { provide: EntityService, useValue: {} },
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
