import { HttpParams, HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Board, validateHostedBoardDefinition } from '@datatug/board-models';
import { defer, map, Observable } from 'rxjs';
import { IProjectRef, isSharedProjectRef } from '../../core/project-context';
import { DatatugApiService } from '../base/datatug-api.service';

export interface BoardAssetSnapshot {
  readonly board: Board;
  readonly revision: string;
}
export interface BoardAssetSaved extends BoardAssetSnapshot {
  readonly receipt: string;
}
export interface BoardAssetWrite {
  readonly operationId: string;
  readonly ifNoneMatch?: true;
  readonly ifMatch?: string;
  readonly board: Board;
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
  boards(
    ref: IProjectRef,
    environment: string,
  ): Observable<{ id: string; title?: string }[]> {
    return defer(() =>
      this.api.get<{ id: string; title?: string }[]>(
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
      return this.api.getResponse<Board>(
        'datatug/boards/board',
        new HttpParams({
          fromObject: { ...hostedAssetScope(ref, environment), id },
        }),
      );
    }).pipe(
      map((response) => {
        if (!(response instanceof HttpResponse) || !response.body)
          throw new Error('Board detail response is unavailable.');
        const revision = response.headers.get('X-Datatug-Asset-Revision');
        if (!revision || response.headers.get('ETag') !== `"${revision}"`)
          throw new Error('Reload this board to obtain its current revision.');
        validateHostedBoardDefinition(response.body);
        if (response.body.id !== id)
          throw new Error('Board detail identity mismatch.');
        return { board: response.body, revision };
      }),
    );
  }
  saveBoard(
    ref: IProjectRef,
    environment: string,
    write: BoardAssetWrite,
  ): Observable<BoardAssetSaved> {
    return defer(() => {
      validateHostedBoardDefinition(write.board);
      if (!write.operationId || !!write.ifNoneMatch === !!write.ifMatch)
        throw new Error(
          'Board save requires one revision condition and an operation.',
        );
      const body = { ...hostedAssetScope(ref, environment), ...write };
      if (new TextEncoder().encode(JSON.stringify(body)).length > 256 * 1024)
        throw new Error('Board definition exceeds the save limit.');
      return this.api.post<BoardAssetSaved>('datatug/boards/save_board', body, {
        retryUnauthorizedOnce: true,
      });
    }).pipe(
      map((saved) => {
        if (
          !saved ||
          saved.receipt !== write.operationId ||
          !saved.revision ||
          saved.board?.id !== write.board.id
        )
          throw new Error(
            'Board save receipt could not be verified. Retry the original operation.',
          );
        validateHostedBoardDefinition(saved.board);
        return saved;
      }),
    );
  }
}
