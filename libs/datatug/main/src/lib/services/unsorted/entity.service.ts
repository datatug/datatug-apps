import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, Observable, of, take } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';
import { IEntity } from '../../models/definition/metapedia/entity';
import { StoreApiService } from '../repo/store-api.service';
import { ProjectItemsByAgent } from './caching';
import { IRecord, mapToRecord } from '@sneat/data';
import { IProjectRef } from '../../core/project-context';
import { ProjectAssetsReadService } from '../project/project-assets-read.service';

@Injectable()
export class EntityService {
  private readonly agentProvider = inject(StoreApiService);
  private readonly http = inject(HttpClient);
  private readonly assets = inject(ProjectAssetsReadService);

  private cache = new ProjectItemsByAgent<IRecord<IEntity>>();

  public getEntity = (
    ref: IProjectRef,
    entityId: string,
  ): Observable<IRecord<IEntity>> =>
    this.assets.entity(ref, entityId).pipe(
      switchMap((entity) => this.withInheritedDefinition(entity)),
      mapToRecord<IEntity>(),
    );

  private withInheritedDefinition(entity: IEntity): Observable<IEntity> {
    const source = entity.extends?.def;
    if (!source) return of(entity);
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      return of(entity);
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'raw.githubusercontent.com' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      url.pathname.length > 2048
    ) {
      return of(entity);
    }
    return this.http.get<Partial<IEntity>>(url.toString()).pipe(
      map((definition) => ({
        ...entity,
        fields: Array.isArray(definition.fields)
          ? definition.fields
          : entity.fields,
        options: definition.options ?? entity.options,
      })),
    );
  }

  public getAllEntities = (
    from: IProjectRef,
    forceReload?: boolean,
  ): Observable<IRecord<IEntity>[]> => {
    if (
      from.projectApi ||
      from.branch ||
      from.spaceID ||
      from.storeId === 'firestore'
    ) {
      return this.assets.entities(from).pipe(
        map((entities) =>
          entities.map((entity) => ({
            id: entity.id,
            dbo: entity as IEntity,
          })),
        ),
      );
    }
    const cached = this.cache.getItems$(from);
    if (cached && !forceReload) return cached;
    const previous = this.cache.getSubject(from)?.getValue() ?? [];
    const loaded = this.assets.entities(from).pipe(
      map((entities) =>
        entities.map((entity) => ({
          id: entity.id,
          dbo: entity as IEntity,
          state: previous.find((item) => item.id === entity.id)?.state,
        })),
      ),
    );
    return this.cache.setItems$(from, loaded);
  };

  public createEntity = (
    projectRef: IProjectRef,
    entity: IEntity,
  ): Observable<IRecord<IEntity>> => {
    const { storeId, projectId } = projectRef;
    const entities$ = this.cache.getSubject(projectRef);
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
          entities$?.next([
            ...(entities$?.getValue() ?? []),
            { id, dbo: entity },
          ]);
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
    const entities$ = this.cache.getSubject(from);
    const hasEntity = (entities: { id: string }[]) =>
      entities.some((v) => v.id === entityId);
    entities$?.pipe(take(1)).subscribe((entities) => {
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
          entities$?.pipe(take(1)).subscribe((entities) => {
            if (hasEntity(entities)) {
              entities$.next(
                entities.filter((entity) => entity.id !== entityId),
              );
            }
          });
        }),
        catchError((err /*, caught*/) => {
          entities$?.pipe(take(1)).subscribe((entities) => {
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
