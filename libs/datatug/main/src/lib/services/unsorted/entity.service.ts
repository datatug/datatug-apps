import { Injectable, inject } from '@angular/core';
import { catchError, Observable, of, take } from 'rxjs';
import { map, mergeMap, tap } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { IEntity } from '../../models/definition/metapedia/entity';
import { StoreApiService } from '../repo/store-api.service';
import { ProjectItemsByAgent } from './caching';
import { IRecord, mapToRecord } from '@sneat/data';
import { STORE_ID_GITHUB_COM, STORE_TYPE_GITHUB } from '@sneat/core';
import { IHttpRequestOptions } from '@sneat/api';
import { IProjectRef } from '../../core/project-context';
import { GithubProjectReaderService } from '../repo/github/github-project-reader.service';

const isGithubStoreId = (storeId: string): boolean =>
  storeId === STORE_ID_GITHUB_COM || storeId === STORE_TYPE_GITHUB;

@Injectable()
export class EntityService {
  private readonly agentProvider = inject(StoreApiService);
  private readonly http = inject(HttpClient);
  private readonly githubReader = inject(GithubProjectReaderService);

  private cache = new ProjectItemsByAgent<IRecord<IEntity>>();

  public getEntity = (
    store: string,
    project: string,
    entityId: string,
  ): Observable<IRecord<IEntity>> => {
    switch (store) {
      case STORE_ID_GITHUB_COM:
      case STORE_TYPE_GITHUB:
        return this.getEntityFromGithub(project, entityId);
      default: {
        const options: IHttpRequestOptions = {
          params: { project, id: entityId },
        };
        const $ = this.agentProvider.get<IEntity>(
          store,
          '/entities/entity',
          options,
        );
        return $.pipe(mapToRecord<IEntity>());
      }
    }
  };

  // Routed through `GithubProjectReaderService.getEntity()` (which reads
  // `entities/<id>/<id>.entity.json`, respecting `projectId`'s full
  // `"repo@org@folder"` form) rather than this method's own old ad hoc
  // `project.split('@')` — that used to destructure only the first two
  // parts, silently dropping a third `@folder` segment (e.g.
  // `demo-project-1` in `datatug-demo-projects@datatug@demo-project-1`) and
  // building a URL one directory level too shallow, a 404 on every real
  // entity in this project.
  private getEntityFromGithub(
    project: string,
    entityId: string,
  ): Observable<IRecord<IEntity>> {
    return this.githubReader.getEntity(project, entityId).pipe(
      mergeMap((data) => {
        const entity = data as unknown as IEntity;
        if (!entity.extends?.def) {
          return of(entity);
        }
        return this.http.get<IEntity>(entity.extends.def).pipe(
          map((def) => ({
            ...entity,
            fields: def.fields,
            options: def.options,
          })),
        );
      }),
      mapToRecord<IEntity>(),
    );
  }

  public getAllEntities = (
    from: IProjectRef,
    forceReload?: boolean,
  ): Observable<IRecord<IEntity>[]> => {
    let o = this.cache.getItems$(from);
    if (!o || forceReload) {
      const entities$ = this.cache.byRepo$[from.storeId]?.[from.projectId];
      const records = entities$?.getValue();
      const withState = (entities: { id: string }[]) =>
        entities.map((entity) => ({
          id: entity.id,
          dbo: entity as IEntity,
          state: records?.find((v) => v.id === entity.id)?.state,
        }));
      o = isGithubStoreId(from.storeId)
        ? this.githubReader.listEntityIds(from.projectId).pipe(
            map((ids) => withState(ids.map((id) => ({ id })))),
          )
        : this.agentProvider
            .get<IEntity[]>(from.storeId, '/entities/all_entities', {
              params: { project: from.projectId },
            })
            .pipe(
              map((entities) => {
                for (const entity of entities) {
                  if (!entity.id) {
                    throw 'entity is missing required attribute: id';
                  }
                }
                return withState(entities as { id: string }[]);
              }),
            );
      o = this.cache.setItems$(from, o);
    }
    return o;
  };

  public createEntity = (
    projectRef: IProjectRef,
    entity: IEntity,
  ): Observable<IRecord<IEntity>> => {
    const { storeId, projectId } = projectRef;
    const entities$ = this.cache.byRepo$[storeId][projectId];
    return this.agentProvider
      .post<IRecord<IEntity>>(storeId, '/entities/create_entity', entity, {
        params: { project: projectId },
      })
      .pipe(
        tap(() => {
          const { id } = entity;
          if (!id) {
            throw new Error('entity has no ID');
          }
          entities$.next([...entities$.getValue(), { id, dbo: entity }]);
        }),
      );
  };

  public saveEntity = (
    repo: string,
    project: string,
    request: IEntity,
  ): Observable<IRecord<IEntity>> =>
    this.agentProvider.put(repo, '/entities/save_entity', request, {
      params: { project },
    });

  public deleteEntity = (
    from: IProjectRef,
    entityId: string,
  ): Observable<void> => {
    const entities$ = this.cache.byRepo$[from.storeId][from.projectId];
    const hasEntity = (entities: { id: string }[]) =>
      entities.some((v) => v.id === entityId);
    entities$.pipe(take(1)).subscribe((entities) => {
      if (hasEntity(entities)) {
        entities$.next(
          entities.map((entity) =>
            entity.id === entityId
              ? {
                  ...entity,
                  state: 'deleting',
                }
              : entity,
          ),
        );
      }
    });

    return this.agentProvider
      .delete<void>(from.storeId, '/entities/delete_entity', {
        params: { project: from.projectId, entity: entityId },
      })
      .pipe(
        // delay(1000),
        tap(() => {
          entities$.pipe(take(1)).subscribe((entities) => {
            if (hasEntity(entities)) {
              entities$.next(
                entities.filter((entity) => entity.id !== entityId),
              );
            }
          });
        }),
        catchError((err /*, caught*/) => {
          entities$.pipe(take(1)).subscribe((entities) => {
            if (hasEntity(entities)) {
              entities$.next(
                entities.map((entity) => {
                  if (entity.id === entityId && entity.state === 'deleting') {
                    throw new Error('not implemented');
                    // const v = { ...entity };

                    // delete v.state;
                    // return v;
                  }
                  return entity;
                }),
              );
            }
          });
          throw err;
        }),
      );
  };
}
