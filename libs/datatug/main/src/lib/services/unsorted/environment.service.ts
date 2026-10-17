import { Injectable, inject } from '@angular/core';
import { IRecord } from '@sneat/data';
import { Observable, of, throwError, forkJoin } from 'rxjs';

import { DatatugApiService } from '../base/datatug-api.service';
import { STORE_ID_GITHUB_COM, STORE_TYPE_GITHUB } from '@sneat/core';
import { switchMap, startWith, tap } from 'rxjs/operators';
import { IProjectRef } from '../../core/project-context';
import { CreateNamedRequest } from '../../dto/requests';
import { IOptionallyTitled } from '../../models/core';
import {
  IEnvironmentFull,
  IEnvironmentSummary,
} from '../../models/definition/environments';
import { ICatalogTables } from '../../models/definition/apis/database';
import { createProjItem } from '../base/create-object';
import { ProjectContextService } from '../project/project-context.service';
import { ProjectService } from '../project/project.service';
import { StoreApiService } from '../repo/store-api.service';
import { GithubProjectReaderService } from '../repo/github/github-project-reader.service';

const isGithubStoreId = (storeId: string): boolean =>
  storeId === STORE_ID_GITHUB_COM || storeId === STORE_TYPE_GITHUB;

const getEnvCacheKey = (projectRef: IProjectRef, env: string): string => {
  return JSON.stringify([
    projectRef.storeId,
    projectRef.projectId,
    projectRef.branch,
    projectRef.spaceID,
    projectRef.projectApi,
    env,
  ]);
};

const envSummaryCache: Record<string, IEnvironmentSummary> = {};

// `providedIn: 'root'` — `DatatugNavContextService` (also root-provided)
// injects this directly, so it must be root-resolvable too, not only
// available to components that happen to import
// `DatatugServicesUnsortedModule`.
@Injectable({ providedIn: 'root' })
export class EnvironmentService {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly api = inject(DatatugApiService);
  private readonly projectService = inject(ProjectService);
  private readonly storeApiService = inject(StoreApiService);
  private readonly githubReader = inject(GithubProjectReaderService);

  /** Load folder identities and their optional presentation metadata together. */
  public listEnvironments(projectId: string): Observable<IEnvironmentFull[]> {
    return this.githubReader
      .listEnvironmentIds(projectId)
      .pipe(
        switchMap((ids) =>
          ids.length
            ? forkJoin(
                ids.map((id) =>
                  this.githubReader.getEnvironmentSummary(projectId, id),
                ),
              )
            : of([]),
        ),
      );
  }

  createEnvironment = (
    request: CreateNamedRequest,
  ): Observable<IRecord<IOptionallyTitled>> =>
    createProjItem<IEnvironmentSummary>(
      this.api,
      'datatug/environment/create_environment',
      request,
    );

  putConnection(): Observable<IEnvironmentSummary> {
    return throwError(() => '');
  }

  public getEnvSummary(
    projectRef: IProjectRef,
    env: string,
    forceReload = false,
  ): Observable<IEnvironmentSummary> {
    if (!projectRef) {
      return throwError(() => '"projRef" is a required parameter');
    }
    if (!env) {
      return throwError(() => '"env" is a required parameter');
    }
    const cacheKey = getEnvCacheKey(projectRef, env);
    const cached = envSummaryCache[cacheKey];
    if (cached && !forceReload) {
      return of(cached);
    }
    const request$: Observable<IEnvironmentSummary> = isGithubStoreId(
      projectRef.storeId,
    )
      ? (this.githubReader.getEnvironmentSummary(
          projectRef.projectId,
          env,
        ) as unknown as Observable<IEnvironmentSummary>)
      : this.storeApiService.get<IEnvironmentSummary>(
          projectRef.storeId,
          '/environment-summary',
          {
            params: {
              proj: projectRef.projectId,
              env,
            },
          },
        );
    const result = request$.pipe(
      tap((envSummary) => {
        envSummaryCache[cacheKey] = envSummary;
      }),
    );
    return cached ? result.pipe(startWith(cached)) : result;
  }

  /**
   * GET /datatug/catalog-tables (Task 17 item A.2, S121) — the catalog's
   * table/view identity list `EnvDbPageComponent` needs. Param names
   * (proj/env/catalog) match the server's own `paramAlias` widening
   * (`getCatalogTablesHandler`, datatug-cli).
   */
  public getCatalogTables(
    projectRef: IProjectRef,
    env: string,
    catalog: string,
  ): Observable<ICatalogTables> {
    if (isGithubStoreId(projectRef.storeId)) {
      return this.githubReader.getCatalogTables(
        projectRef.projectId,
        env,
        catalog,
      ) as unknown as Observable<ICatalogTables>;
    }
    return this.storeApiService.get<ICatalogTables>(
      projectRef.storeId,
      '/catalog-tables',
      {
        params: {
          proj: projectRef.projectId,
          env,
          catalog,
        },
      },
    );
  }
}
