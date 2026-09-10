import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { map } from 'rxjs/operators';
import { SneatApiServiceFactory } from '@sneat/api';
import { STORE_ID_GITHUB_COM, STORE_TYPE_GITHUB } from '@sneat/core';
import { Board } from '@datatug/board-models';
import { CreateNamedRequest } from '../../dto/requests';
import { IProjBoard } from '../../models/definition/project';
import { ICreateProjectItemRequest } from '../../services/project/project.service';
import { GithubProjectReaderService } from '../../services/repo/github/github-project-reader.service';
import { GITHUB_READ_ONLY_MESSAGE } from '../../services/repo/store-api.service';

const isGithubStoreId = (storeId: string): boolean =>
  storeId === STORE_ID_GITHUB_COM || storeId === STORE_TYPE_GITHUB;

// `providedIn: 'root'` for the same reason DatatugNavService is (see the comment
// there): `DatatugFolderComponent` injects this service directly without importing
// `DatatugBoardCoreModule`, so a module-scoped-only provider threw `NG0201: No
// provider found for _DatatugBoardService` on any page that renders a folder list —
// including the project overview page, which crashed entirely (blocking journey e2e
// J1, discovered wiring stream S9b's semantic-foundation integration). Kept in
// `DatatugBoardCoreModule.providers` too; that's harmless (same class), matching the
// existing `DatatugNavService` precedent.
@Injectable({ providedIn: 'root' })
export class DatatugBoardService {
  private readonly sneatApiServiceFactory = inject(SneatApiServiceFactory);
  private readonly githubReader = inject(GithubProjectReaderService);

  getBoard(
    storeId: string,
    project: string,
    boardId: string,
  ): Observable<Board> {
    if (!boardId) {
      return throwError(
        () => 'required parameter "boardId" has not been provided',
      );
    }
    if (!storeId) {
      return throwError(
        () => 'required parameter "store" has not been provided',
      );
    }
    if (!project) {
      return throwError(
        () => 'required parameter "project" has not been provided',
      );
    }
    if (project === 'undefined') {
      return throwError(
        () => 'required parameter "project" has "undefined" string value',
      );
    }
    // GitHub-store: `boards/<id>/board.json` read directly off the repo —
    // every other store (`agent`/`firestore`) has no working board-read
    // route yet (this method's own pre-existing "not implemented" below;
    // see `agent-url.ts`'s client-call table: `/boards/board` is
    // registered server-side but this class never actually called it).
    if (isGithubStoreId(storeId)) {
      return this.githubReader
        .getBoard(project, boardId)
        .pipe(map((b) => b as unknown as Board));
    }
    return throwError(() => `not implemented ${project} ${storeId} ${boardId}`);
    // return this.repoProviderService.get(storeId, '/boards/board', {params: {id: boardId, project}});
  }

  createNewBoard(request: CreateNamedRequest): Observable<IProjBoard> {
    const { projectRef } = request;
    if (isGithubStoreId(projectRef.storeId)) {
      return throwError(() => new Error(GITHUB_READ_ONLY_MESSAGE));
    }
    const service = this.sneatApiServiceFactory.getSneatApiService(
      projectRef.storeId,
    );
    return service.post<ICreateProjectItemRequest, { id: string }>(
      `/datatug/boards/create_board?project=${projectRef.projectId}&store=${projectRef.storeId}`,
      { title: request.name, folder: '~' },
      {
        params: { project: projectRef.projectId },
      },
    );
    // return this.repoProviderService.post<IProjBoard>(projectRef.storeId, '/datatug/boards/create_board', {title}, {params: {project: projectRef.projectId}});
  }
}
