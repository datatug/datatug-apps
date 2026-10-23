import { IProjBoard } from '../../models/definition/project';
import {
  EntitySnapshot,
  decodeEntity,
  entityRevision,
  nativeID,
  object,
  text,
} from '../../shipping/native-semantic-contract';
import { HttpParams, HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  Board,
  ProjectCard,
  ProjectCardBrief,
  parseHostedBoardDefinition,
  parseProjectCard,
  validateHostedBoardDefinition,
  validateProjectCard,
} from '@datatug/board-models';
import { defer, map, Observable } from 'rxjs';
import { IProjectRef, isSharedProjectRef } from '../../core/project-context';
import { DatatugApiService } from '../base/datatug-api.service';

export interface BoardAssetSnapshot {
  readonly board: Board;
  readonly revision: string;
}
export interface BoardSaveAck {
  readonly boardId: string;
  readonly revision: string;
  readonly receipt: string;
}
export interface BoardAssetWrite {
  readonly operationId: string;
  readonly ifNoneMatch?: true;
  readonly ifMatch?: string;
  readonly board: Board;
}
export interface CardAssetSnapshot {
  readonly card: ProjectCard;
  readonly revision: string;
}
export interface CardSaveAck {
  readonly cardId: string;
  readonly revision: string;
  readonly receipt: string;
}
export interface CardAssetWrite {
  readonly operationId: string;
  readonly ifNoneMatch?: true;
  readonly ifMatch?: string;
  readonly card: ProjectCard;
}
export function hostedAssetScope(ref: IProjectRef, environment: string) {
  if (
    !isSharedProjectRef(ref) ||
    ref.branch !== undefined ||
    ref.projectApi !== undefined ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(environment)
  )
    throw new Error('Choose an admitted environment for this shared project.');
  return {
    storage: 'firestore',
    spaceID: ref.spaceID,
    project: ref.projectId,
    environment,
  } as const;
}
@Injectable({ providedIn: 'root' })
export class ProjectAssetsApiService {
  private readonly api = inject(DatatugApiService);
  entities(
    ref: IProjectRef,
    environment: string,
  ): Observable<{ id: string; title?: string }[]> {
    return defer(() =>
      this.api.get<unknown>(
        'datatug/entities/all_entities',
        new HttpParams({ fromObject: hostedAssetScope(ref, environment) }),
      ),
    ).pipe(
      map((value) => {
        if (!Array.isArray(value) || value.length > 1000)
          throw new Error('Entity list is unavailable.');
        const items = value.map((v) => {
          const o = object(v);
          if (!nativeID(o['id']))
            throw new Error('Entity identity is unavailable.');
          return {
            id: o['id'],
            ...(o['title'] !== undefined ? { title: text(o['title']) } : {}),
          };
        });
        if (new Set(items.map((e) => e.id)).size !== items.length)
          throw new Error('Entity identities are ambiguous.');
        return items;
      }),
    );
  }
  entity(
    ref: IProjectRef,
    environment: string,
    id: string,
  ): Observable<EntitySnapshot> {
    return defer(() => {
      if (!nativeID(id)) throw new Error('Invalid entity identity.');
      return this.api.getResponse<unknown>(
        'datatug/entities/entity',
        new HttpParams({
          fromObject: { ...hostedAssetScope(ref, environment), id },
        }),
      );
    }).pipe(
      map((response) => {
        if (!(response instanceof HttpResponse))
          throw new Error('Entity response is unavailable.');
        const entity = decodeEntity(response.body);
        if (entity.id !== id)
          throw new Error('Entity detail identity differs.');
        const revision = response.headers.get('X-Datatug-Asset-Revision'),
          etag = response.headers.get('ETag');
        return entityRevision(revision) && etag === `"${revision}"`
          ? { entity, revision }
          : {
              entity,
              revisionError:
                'Entity revision headers are missing or do not match. Saving is blocked.',
            };
      }),
    );
  }

  boards(
    ref: IProjectRef,
    environment: string): Observable<IProjBoard[]> {
    return defer(() =>
      this.api.get<IProjBoard[]>(
        'datatug/boards/all_boards',
        new HttpParams({ fromObject: hostedAssetScope(ref, environment) }),
      ),
    );
  }
  board(
    ref: IProjectRef,
    environment: string,
    id: string,
  ): Observable<BoardAssetSnapshot> {
    return defer(() => {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id))
        throw new Error('Invalid board identity.');
      return this.api.getResponse<string>(
        'datatug/boards/board',
        new HttpParams({
          fromObject: { ...hostedAssetScope(ref, environment), id },
        }),
        'text',
      );
    }).pipe(
      map((response) => {
        if (
          !(response instanceof HttpResponse) ||
          typeof response.body !== 'string'
        )
          throw new Error('Board detail response is unavailable.');
        const revision = response.headers.get('X-Datatug-Asset-Revision');
        if (!revision)
          throw new Error(
            'Board revision header is missing. Saving is blocked. Retry loading; if this persists, the server must expose its revision header.',
          );
        const etag = response.headers.get('ETag');
        if (!etag)
          throw new Error(
            'Board ETag header is missing. Saving is blocked. Retry loading; if this persists, the server must expose its ETag header.',
          );
        if (etag !== `"${revision}"`)
          throw new Error(
            'Board revision headers do not match a strong ETag. Saving is blocked. Retry loading; if this persists, the server must return matching revision headers.',
          );
        const board = parseHostedBoardDefinition(response.body);
        if (board.id !== id) throw new Error('Board detail identity mismatch.');
        return { board, revision };
      }),
    );
  }
  saveBoard(
    ref: IProjectRef,
    environment: string,
    write: BoardAssetWrite,
  ): Observable<BoardSaveAck> {
    return defer(() => {
      validateHostedBoardDefinition(write.board);
      if (!write.operationId || !!write.ifNoneMatch === !!write.ifMatch)
        throw new Error(
          'Board save requires one revision condition and an operation.',
        );
      const body = { ...hostedAssetScope(ref, environment), ...write };
      if (new TextEncoder().encode(JSON.stringify(body)).length > 256 * 1024)
        throw new Error('Board definition exceeds the save limit.');
      return this.api.post<{
        board?: { id?: unknown };
        revision?: unknown;
        receipt?: unknown;
      }>('datatug/boards/save_board', body, {
        retryUnauthorizedOnce: false,
      });
    }).pipe(
      map((saved) => {
        if (
          !saved ||
          saved.receipt !== write.operationId ||
          typeof saved.revision !== 'string' ||
          !saved.revision ||
          saved.board?.id !== write.board.id
        )
          throw new Error(
            'Board save receipt could not be verified. Retry the original operation.',
          );
        return {
          boardId: write.board.id,
          revision: saved.revision,
          receipt: write.operationId,
        };
      }),
    );
  }
  cards(ref: IProjectRef, environment: string): Observable<ProjectCardBrief[]> {
    return defer(() =>
      this.api.get<ProjectCardBrief[]>(
        'datatug/cards/all_cards',
        new HttpParams({ fromObject: hostedAssetScope(ref, environment) }),
      ),
    );
  }
  card(
    ref: IProjectRef,
    environment: string,
    id: string,
  ): Observable<CardAssetSnapshot> {
    return defer(() => {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id))
        throw new Error('Invalid card identity.');
      return this.api.getResponse<string>(
        'datatug/cards/card',
        new HttpParams({
          fromObject: { ...hostedAssetScope(ref, environment), id },
        }),
        'text',
      );
    }).pipe(
      map((response) => {
        if (
          !(response instanceof HttpResponse) ||
          typeof response.body !== 'string'
        )
          throw new Error('Card detail response is unavailable.');
        const revision = response.headers.get('X-Datatug-Asset-Revision');
        if (!revision)
          throw new Error(
            'Card revision header is missing. Saving is blocked. Retry loading; if this persists, the server must expose its revision header.',
          );
        const etag = response.headers.get('ETag');
        if (!etag)
          throw new Error(
            'Card ETag header is missing. Saving is blocked. Retry loading; if this persists, the server must expose its ETag header.',
          );
        if (etag !== `"${revision}"`)
          throw new Error(
            'Card revision headers do not match a strong ETag. Saving is blocked. Retry loading; if this persists, the server must return matching revision headers.',
          );
        const card = parseProjectCard(response.body);
        if (card.id !== id) throw new Error('Card detail identity mismatch.');
        return { card, revision };
      }),
    );
  }
  saveCard(
    ref: IProjectRef,
    environment: string,
    write: CardAssetWrite,
  ): Observable<CardSaveAck> {
    return defer(() => {
      validateProjectCard(write.card);
      if (!write.operationId || !!write.ifNoneMatch === !!write.ifMatch)
        throw new Error(
          'Card save requires one revision condition and an operation.',
        );
      const body = { ...hostedAssetScope(ref, environment), ...write };
      if (new TextEncoder().encode(JSON.stringify(body)).length > 256 * 1024)
        throw new Error('Card definition exceeds the save limit.');
      return this.api.post<{
        card?: { id?: unknown };
        revision?: unknown;
        receipt?: unknown;
      }>('datatug/cards/save_card', body, {
        retryUnauthorizedOnce: false,
      });
    }).pipe(
      map((saved) => {
        if (
          !saved ||
          saved.receipt !== write.operationId ||
          typeof saved.revision !== 'string' ||
          !saved.revision ||
          saved.card?.id !== write.card.id
        )
          throw new Error(
            'Card save receipt could not be verified. Retry the original operation.',
          );
        return {
          cardId: write.card.id,
          revision: saved.revision,
          receipt: write.operationId,
        };
      }),
    );
  }
}
