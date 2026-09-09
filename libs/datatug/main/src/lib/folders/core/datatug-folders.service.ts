import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { IProjectItemRef } from '../../core/project-context';
import { IFolder } from '../../models/definition/folder';
import { DatatugStoreServiceFactory } from '../../services/repo/datatug-store-service-factory.service';

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

  watchFolder(ref: IProjectItemRef): Observable<IFolder | null | undefined> {
    const storeService = this.storeServiceFactory.getDatatugStoreService(
      ref.storeId,
    );
    return storeService.watchProjectItem<IFolder>(
      ref.projectId,
      `/folders/${ref.id}`,
    );
  }
}
