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
import { ProjectQueryApiService } from '../project/project-query-api.service';
import { githubProjectAddressForRef } from '../project/project-assets-read.service';
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
  private readonly queryApi = inject(ProjectQueryApiService);
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
      return this.getGithubDbServers(githubProjectAddressForRef(projectRef));
    }
    if (projectRef.spaceID || projectRef.projectApi === 'cloud')
      return throwError(
        () =>
          new Error(
            'Database server catalog is unavailable for this project connection.',
          ),
      );
    if (projectRef.branch || projectRef.projectApi)
      return this.queryApi
        .dbServers<
          {
            id?: string;
            tags?: string[];
            server: IDbServer;
            databases?: unknown[];
          }[]
        >(projectRef)
        .pipe(
          map((items) =>
            items.map((item) => ({
              dbServer: item.server,
              ...(item.id ? { id: item.id } : {}),
              tags: item.tags,
              databasesCount: item.databases?.length ?? 0,
            })),
          ),
        );
    return this.projectService.getFull(projectRef, true).pipe(
      map((p) => {
        if (
          ![p?.dbDrivers, p?.dbServers, p?.environments].some(Array.isArray) &&
          !p?.id
        )
          throw new Error(
            'Database server catalog is unavailable for this project connection.',
          );
        const byKey = new Map<
          string,
          {
            dbServer: IDbServer;
            declaredDatabasesCount: number;
            tags?: string[];
            id?: string;
            environments: Map<string, number>;
          }
        >();
        const addServer = (
          dbServer: IDbServer,
          declaredDatabasesCount: number,
          tags?: string[],
          id?: string,
        ) => {
          const key = serverKey(dbServer);
          const existing = byKey.get(key);
          if (existing) {
            existing.declaredDatabasesCount = Math.max(
              existing.declaredDatabasesCount,
              declaredDatabasesCount,
            );
            if (id) existing.id = id;
            if (tags)
              existing.tags = [...new Set([...(existing.tags ?? []), ...tags])];
            return existing;
          }
          const added = {
            dbServer,
            declaredDatabasesCount,
            ...(tags ? { tags } : {}),
            ...(id ? { id } : {}),
            environments: new Map<string, number>(),
          };
          byKey.set(key, added);
          return added;
        };

        for (const driver of p.dbDrivers ?? []) {
          for (const server of driver.servers ?? []) {
            addServer(
              {
                ...server.server,
                driver: server.server.driver || driver.id,
              },
              server.catalogs?.length ?? 0,
              server.tags,
              server.id,
            );
          }
        }
        for (const legacy of p.dbServers ?? []) {
          addServer(
            legacy.dbServer ?? legacy.server,
            legacy.databases?.length ?? 0,
            legacy.tags,
            legacy.id,
          );
        }
        for (const environment of p.environments ?? []) {
          for (const candidate of environment.dbServers ??
            environment.dbServer ??
            []) {
            const entry = addServer(
              {
                driver: candidate.driver,
                host: candidate.host ?? '',
                ...(candidate.port === undefined
                  ? {}
                  : { port: candidate.port }),
                ...(candidate.path === undefined
                  ? {}
                  : { path: candidate.path }),
              },
              0,
            );
            entry.environments.set(
              environment.id,
              (entry.environments.get(environment.id) ?? 0) +
                (candidate.catalogs?.length ?? 0),
            );
          }
        }

        return [...byKey.values()].map((entry) => {
          const environments = [...entry.environments].map(
            ([envId, databasesCount]) => ({ envId, databasesCount }),
          );
          return {
            dbServer: entry.dbServer,
            ...(entry.tags ? { tags: entry.tags } : {}),
            ...(entry.id ? { id: entry.id } : {}),
            databasesCount: environments.length
              ? environments.reduce(
                  (sum, environment) => sum + environment.databasesCount,
                  0,
                )
              : entry.declaredDatabasesCount,
            ...(environments.length ? { environments } : {}),
          };
        });
      }),
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
      switchMap((summaries) =>
        forkJoin({
          summaries: of(summaries),
          definitions: this.githubReader.getDbServerDefinitions(projectId),
        }),
      ),
      map(({ summaries, definitions }) => {
        const byKey = new Map<
          string,
          { dbServer: IDbServer; environments: IProjDbServerEnvironmentUsage[] }
        >();
        for (const summary of summaries) {
          for (const s of summary.dbServers || []) {
            const key = serverKey(s);

            const environments = byKey.get(key)?.environments ?? [];
            environments.push({
              envId: summary.id,
              databasesCount: s.catalogs?.length || 0,
            });
            byKey.set(key, {
              dbServer: {
                driver: s.driver,
                host: s.host,
                ...(s.port === undefined ? {} : { port: s.port }),
                ...(s.path === undefined ? {} : { path: s.path }),
              },
              environments,
            });
          }
        }
        const rows = [...byKey.values()].map(
          ({ dbServer, environments }): IProjDbServerSummary => ({
            dbServer,
            databasesCount: environments.reduce(
              (sum, e) => sum + e.databasesCount,
              0,
            ),
            environments,
          }),
        );
        const defined = new Set<string>();
        for (const definition of definitions) {
          const server = definition.server;
          if (
            !server ||
            typeof server.driver !== 'string' ||
            (server.host !== undefined && typeof server.host !== 'string')
          )
            throw new Error('Invalid database server definition.');
          const identity = serverKey(server);
          if (defined.has(identity))
            throw new Error('Duplicate database server definitions.');
          defined.add(identity);
          const row = rows.find((row) => serverKey(row.dbServer) === identity);
          if (row) {
            row.tags = definition.tags;
            row.id = definition.id;
          } else
            rows.push({
              dbServer: { ...server, host: server.host ?? '' },
              id: definition.id,
              tags: definition.tags,
              databasesCount: definition.databases?.length ?? 0,
            });
        }
        return rows;
      }),
    );
  }
}

const serverKey = (server: IDbServer): string =>
  [server.driver, server.host ?? '', server.port ?? '', server.path ?? ''].join(
    ':',
  );
