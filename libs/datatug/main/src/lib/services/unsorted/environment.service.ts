import { Injectable, inject } from '@angular/core';
import { IRecord } from '@sneat/data';
import { Observable, of, throwError } from 'rxjs';

import { SneatApiService } from '@sneat/api';
import { STORE_ID_GITHUB_COM, STORE_TYPE_GITHUB } from '@sneat/core';
import { map, startWith, tap } from 'rxjs/operators';
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
  return `${projectRef.projectId}@${projectRef.storeId}/${env}`;
};

const envSummaryCache: Record<string, IEnvironmentSummary> = {};

@Injectable()
export class EnvironmentService {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly api = inject(SneatApiService);
  private readonly projectService = inject(ProjectService);
  private readonly storeApiService = inject(StoreApiService);
  private readonly githubReader = inject(GithubProjectReaderService);

  /**
   * `environments/<id>/` directory names as `IEnvironmentFull[]` —
   * `EnvironmentsPageComponent` (pages/signed-in/environments) uses this for
   * a GitHub-store project instead of `ProjectService.getFull()` (which
   * unconditionally calls `buildAgentUrl(storeId, ...)`, an invalid URL for
   * `storeId="github.com"` — the exact "Failed to load project
   * environments" console error the founder's ruling names). Titles are the
   * folder name — no per-environment title exists in this project's files.
   */
  public listEnvironments(projectId: string): Observable<IEnvironmentFull[]> {
    return this.githubReader
      .listEnvironmentIds(projectId)
      .pipe(map((ids) => ids.map((id) => ({ id, title: id }))));
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
