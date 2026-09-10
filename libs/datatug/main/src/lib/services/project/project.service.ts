import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { SneatApiServiceFactory } from '@sneat/api';
import { PrivateTokenStoreService } from '@sneat/auth-core';
import {
  GITLAB_REPO_PREFIX,
  STORE_ID_GITHUB_COM,
  STORE_TYPE_GITHUB,
} from '@sneat/core';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import {
  map,
  Observable,
  ReplaySubject,
  shareReplay,
  take,
  tap,
  throwError,
} from 'rxjs';
import {
  IProjectRef,
  isValidProjectRef,
  projectRefToString,
} from '../../core/project-context';
import { IProjectFull, IProjectSummary } from '../../models/definition/project';
import { buildAgentUrl } from '../repo/agent-url';
import { DatatugStoreServiceFactory } from '../repo/datatug-store-service-factory.service';

// `providedIn: 'root'` — this service caches project summaries per project
// ref (`projSummary`) so every consumer shares one request and one result.
// A module-listed provider gave each importing standalone component its
// own copy and its own HTTP GET (confirmed live, S126). It must also stay
// root-resolvable because root-provided `DatatugNavContextService` and
// `EnvironmentService` inject it.
@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly http = inject(HttpClient);
  private readonly privateTokenStoreService = inject(PrivateTokenStoreService);
  private readonly sneatApiServiceFactory = inject(SneatApiServiceFactory);
  private readonly datatugStoreServiceFactory = inject(
    DatatugStoreServiceFactory,
  );

  private projects: Record<string, Observable<IProjectFull>> = {};
  // One entry per project, keyed only by projectRefToString(). Only
  // watchProjectSummary() writes to it; getSummary() reads through it.
  private projSummary: Record<
    string,
    ReplaySubject<IProjectSummary | undefined>
  > = {};
  // private readonly projectsCollection: AngularFirestoreCollection;

  constructor() {
    // this.projectsCollection =
    // 	db.collection<IProjectSummary>('datatug_projects');
  }

  public watchProjectSummary(
    projectRef: IProjectRef,
  ): Observable<IProjectSummary | undefined> {
    if (!isValidProjectRef(projectRef)) {
      return throwError(
        () => 'Can not watch project by empty target parameter',
      );
    }
    if (projectRef.storeId === 'agent') {
      throw new Error('TEMP DEBUG: storeId === agent, expected firestore');
    }
    const id = projectRefToString(projectRef);
    if (!id) {
      throw new Error('project id is undefined');
    }
    let subj = this.projSummary[id];
    if (subj) {
      console.log(
        'ProjectService.watchProjectSummary() => reusing existing subject',
      );
    } else {
      console.log(
        'ProjectService.watchProjectSummary() => creating new subject for',
        id,
      );
      this.projSummary[id] = subj = new ReplaySubject(1);
      const summary$ =
        projectRef.storeId === 'firestore'
          ? this.firestoreChanges().pipe(
              tap((summary) =>
                console.log(
                  `ProjectService.watchProject(${id}) => summary:`,
                  summary,
                ),
              ),
            )
          : this.getProjectSummaryRequest(projectRef);
      summary$.subscribe(subj);
    }
    return subj.asObservable();
  }

  private firestoreChanges(): Observable<IProjectSummary | undefined> {
    return throwError(() => 'Not implemented');
    // return this.projectsCollection
    // 	.doc(id)
    // 	.snapshotChanges()
    // 	.pipe(
    // 		tap((v) => console.log(`project[${id}] snapshotChange:`, v)),
    // 		map((value) =>
    // 			value.type === 'removed'
    // 				? undefined
    // 				: (value.payload.data() as IProjectSummary),
    // 		),
    // 		shareReplay(1),
    // 	);
  }

  public getFull(projectRef: IProjectRef): Observable<IProjectFull> {
    console.warn('The getFull() method should not be called from UI');
    if (!projectRef) {
      throw new Error('target is a required parameter for getFull()');
    }
    let $project = this.projects[projectRef.projectId];
    if ($project) {
      return $project;
    }
    $project = this.http
      .get<IProjectFull>(
        buildAgentUrl(projectRef.storeId, '/projects/project_full'),
        {
          params: { id: projectRef.projectId },
        },
      )
      .pipe(shareReplay(1));
    this.projects[projectRef.projectId] = $project;
    return $project;
  }

  /** One-shot read of the same cached summary watchProjectSummary() serves. */
  public getSummary(
    projectRef: IProjectRef,
  ): Observable<IProjectSummary | undefined> {
    return this.watchProjectSummary(projectRef).pipe(take(1));
  }

  private getProjectSummaryRequest(
    projectRef: IProjectRef,
  ): Observable<IProjectSummary> {
    if (!projectRef) {
      return throwError(() => 'target is a required parameter');
    }
    const { storeId, projectId } = projectRef;
    if (!storeId) {
      return throwError(() => 'target.storeId is a required parameter');
    }
    if (
      storeId === STORE_ID_GITHUB_COM ||
      storeId === STORE_TYPE_GITHUB ||
      storeId.startsWith(GITLAB_REPO_PREFIX)
    ) {
      const storeService =
        this.datatugStoreServiceFactory.getDatatugStoreService(storeId);
      return storeService.getProjectSummary(projectId);
    }
    return this.http.get<IProjectSummary>(
      buildAgentUrl(storeId, '/projects/project_summary'),
      {
        params: { id: projectId },
      },
    );
  }

  public createNewProject(
    storeId: string,
    projData: ICreateProjectData,
  ): Observable<string> {
    const sneatApiService =
      this.sneatApiServiceFactory.getSneatApiService(storeId);
    return sneatApiService
      .post<
        ICreateProjectData,
        { id: string }
      >('/datatug/projects/create_project?store=firestore', projData)
      .pipe(map((response) => response.id));
  }
}

export interface ICreateProjectData {
  title: string;
  userIDs: string[];
  spaceID?: string;
}

export interface ICreateProjectItemRequest {
  title: string;
  folder: '~' | string;
}
