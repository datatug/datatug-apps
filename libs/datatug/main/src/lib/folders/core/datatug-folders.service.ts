import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { IProjectItemRef } from '../../core/project-context';
import { IFolder } from '../../models/definition/folder';
import { DatatugStoreServiceFactory } from '../../services/repo/datatug-store-service-factory.service';
import { IDatatugStoreService } from '../../services/repo/datatug-store.service.interface';

// `providedIn: 'root'` — `DatatugFoldersCoreModule` (the NgModule that used
// to provide this) was never imported anywhere, so `DatatugFolderComponent`
// (rendered directly from `ProjectPageComponent`'s template) crashed with
// `NullInjectorError: No provider for DatatugFoldersService` on every
// project page, including the "click the demo project" journey — see
// `spec/research/2026-09-09-web-ui-audit.md`. Its dependency chain
// (`DatatugStoreServiceFactory` -> `DatatugStoreFirestoreService` /
// `DatatugStoreGithubService` -> `Firestore` / `HttpClient`) is root-provided
// too, so this resolves cleanly from the application root.
@Injectable({ providedIn: 'root' })
export class DatatugFoldersService {
  private readonly storeServiceFactory = inject(DatatugStoreServiceFactory);

  /**
   * Never throws synchronously: a store-lookup failure is delivered through
   * the returned observable's error channel. `DatatugFolderComponent` calls
   * this from `ngOnChanges`, so a synchronous throw would abort the whole
   * change-detection pass that was rendering the project page — the title
   * bound moments earlier never reached the DOM (the blank-project-page bug
   * against a local `datatug serve` agent, before `DatatugStoreServiceFactory`
   * learned about agent store ids).
   */
  watchFolder(ref: IProjectItemRef): Observable<IFolder | null | undefined> {
    let storeService: IDatatugStoreService;
    try {
      storeService = this.storeServiceFactory.getDatatugStoreService(
        ref.storeId,
      );
    } catch (err) {
      return throwError(() => err);
    }
    return storeService.watchProjectItem<IFolder>(
      ref.projectId,
      `/folders/${ref.id}`,
    );
  }
}
