import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of, throwError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { map, switchMap } from 'rxjs/operators';
import { STORE_ID_GITHUB_COM, STORE_TYPE_GITHUB } from '@sneat/core';
import { buildAgentUrl } from '../repo/agent-url';
import { GITHUB_READ_ONLY_MESSAGE } from '../repo/store-api.service';
import { GithubProjectReaderService } from '../repo/github/github-project-reader.service';
import { IProjectRef } from '../../core/project-context';
import { GetServerDatabasesRequest } from '../../dto/requests';
import {
  IDbCatalogSummary,
  IDbServer,
  IDbServerSummary,
  IProjDbServerEnvironmentUsage,
  IProjDbServerSummary,
} from '../../models/definition/apis/database';
import { ProjectContextService } from '../project/project-context.service';
import { ProjectService } from '../project/project.service';

const isGithubStoreId = (storeId: string): boolean =>
  storeId === STORE_ID_GITHUB_COM || storeId === STORE_TYPE_GITHUB;

/**
 * `getDbServerSummary()`/`getServerDatabases()` (below) both call a live
 * DataTug agent's own HTTP endpoints (`/dbserver-summary`,
 * `/dbserver-databases`) — there is no equivalent static file in a GitHub
 * repo to read instead (datatug-core's own file layout has no per-server
 * "live database list" artifact; `getGithubDbServers()`, above, already
 * covers everything a GitHub repo *can* answer — the distinct
 * `{driver, host}` pairs declared across `environments/<id>/<id>.env.json`). A
 * GitHub-store project reaching `DbserverPageComponent` (by clicking a
 * server row on the Servers page, which this task's own
 * `getGithubDbServers()` populates) would otherwise hit `buildAgentUrl()`
 * with a GitHub store id, producing a raw failed-fetch/404 rather than an
 * explanatory message — guarded the same way `query-page.component.ts`'s own
 * `GITHUB_QUERY_RUN_MESSAGE` guards running a query.
 */
export const GITHUB_DBSERVER_DETAIL_MESSAGE =
  'This project is browsed read-only from GitHub — live database details need a DataTug agent. Clone the repo and run `datatug serve --project <path>` to see them.';

@Injectable()
export class DbServerService {
  private readonly http = inject(HttpClient);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly githubReader = inject(GithubProjectReaderService);

  public getDbServerSummary(dbServer: IDbServer): Observable<IDbServerSummary> {
    const target = this.projectContextService?.current;
    if (!target) {
      return throwError(new Error('projectContextService.current is not set'));
    }
    if (isGithubStoreId(target.storeId)) {
      return throwError(() => new Error(GITHUB_DBSERVER_DETAIL_MESSAGE));
    }
    const params = {
      proj: target.projectId,
      ...dbServer,
    };
    return this.http.get<IDbServerSummary>(
      buildAgentUrl(target.storeId, '/dbserver-summary'),
      { params },
    );
  }

  public getServerDatabases(
    request: GetServerDatabasesRequest,
  ): Observable<IDbCatalogSummary[]> {
    const target = this.projectContextService.current;
    if (!target) {
      throw new Error('projectContextService.current is not defined');
    }
    if (isGithubStoreId(target.storeId)) {
      return throwError(() => new Error(GITHUB_DBSERVER_DETAIL_MESSAGE));
    }
    const params = {
      ...request.dbServer,
      proj: request.project || target.projectId,
    };
    return this.http.get<IDbCatalogSummary[]>(
      buildAgentUrl(target.storeId, '/dbserver-databases'),
      { params },
    );
  }

  public addDbServer(dbServer: IDbServer): Observable<IDbServerSummary> {
    const target = this.projectContextService.current;
    if (!target) {
      throw new Error('this.projectContextService.current is not defined');
    }
    if (isGithubStoreId(target.storeId)) {
      return throwError(() => new Error(GITHUB_READ_ONLY_MESSAGE));
    }
    const params = { proj: target.projectId, ...dbServer };
    return this.http.post<IDbServerSummary>(
      buildAgentUrl(target.storeId, '/dbserver-add'),
      undefined,
      { params },
    );
  }

  public deleteDbServer(dbServer: IDbServer): Observable<void> {
    const target = this.projectContextService.current;
    if (!target) {
      throw new Error('this.projectContextService.current is not defined');
    }
    if (isGithubStoreId(target.storeId)) {
      return throwError(() => new Error(GITHUB_READ_ONLY_MESSAGE));
    }
    const params = { proj: target.projectId, ...dbServer };
    return this.http.delete<void>(
      buildAgentUrl(target.storeId, '/dbserver-delete'),
      { params },
    );
  }

  public getDbServers(
    projectRef: IProjectRef,
  ): Observable<IProjDbServerSummary[]> {
    if (isGithubStoreId(projectRef.storeId)) {
      return this.getGithubDbServers(projectRef.projectId);
    }
    return this.projectService.getFull(projectRef).pipe(
      map((p) =>
        p.dbServers?.map((dbServerFull) => ({
          dbServer: dbServerFull.dbServer,
          databasesCount: dbServerFull.databases?.length || 0,
        })),
      ),
    );
  }

  /**
   * Aggregates the distinct `{driver, host}` db servers this project's
   * environments declare (unioned across every `environments/<id>/<id>.env.json`)
   * — GitHub has no project-level "servers" concept of its own (each
   * environment file declares its own `dbServers` independently), so this is
   * this task's own read of what `GET /projects/project_full`'s
   * `dbServers` field would otherwise have supplied.
   */
  private getGithubDbServers(
    projectId: string,
  ): Observable<IProjDbServerSummary[]> {
    return this.githubReader.listEnvironmentIds(projectId).pipe(
      switchMap((envIds) =>
        envIds.length
          ? forkJoin(
              envIds.map((envId) =>
                this.githubReader.getEnvironmentSummary(projectId, envId),
              ),
            )
          : of([]),
      ),
      map((summaries) => {
        const byKey = new Map<
          string,
          { dbServer: IDbServer; environments: IProjDbServerEnvironmentUsage[] }
        >();
        for (const summary of summaries) {
          for (const s of summary.dbServers || []) {
            const key = `${s.driver}:${s.host}`;
            const environments = byKey.get(key)?.environments ?? [];
            environments.push({
              envId: summary.id,
              databasesCount: s.catalogs?.length || 0,
            });
            byKey.set(key, {
              dbServer: { driver: s.driver, host: s.host },
              environments,
            });
          }
        }
        return [...byKey.values()].map(
          ({ dbServer, environments }): IProjDbServerSummary => ({
            dbServer,
            databasesCount: environments.reduce(
              (sum, e) => sum + e.databasesCount,
              0,
            ),
            environments,
          }),
        );
      }),
    );
  }
}
