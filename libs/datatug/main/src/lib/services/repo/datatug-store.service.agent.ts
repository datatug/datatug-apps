import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { IProjectSummary } from '../../models/definition/project';
import { buildAgentUrl } from './agent-url';
import { IDatatugStoreService } from './datatug-store.service.interface';

/**
 * `IDatatugStoreService` for a project served by a DataTug CLI agent
 * (`datatug serve`). One instance per agent store id — the id carries the
 * host (and scheme) every request goes to, so unlike the Firestore/GitHub
 * services this cannot be a single root singleton; `DatatugStoreServiceFactory`
 * owns the per-store instances and is the only place that constructs this.
 */
export class DatatugStoreAgentService implements IDatatugStoreService {
  constructor(
    private readonly http: HttpClient,
    private readonly storeId: string,
  ) {}

  getProjectSummary(projectId: string): Observable<IProjectSummary> {
    return this.http.get<IProjectSummary>(
      buildAgentUrl(this.storeId, '/projects/project_summary'),
      { params: { id: projectId } },
    );
  }

  /**
   * The CLI agent has no route to read (let alone watch) a folder or any
   * other generic project item — `register.go` only registers
   * `/folders/create_folder` and `/folders/delete_folder`, and nothing in
   * this app calls even those (see the client-call table in `agent-url.ts`).
   * So every item is reported as absent: `null`, the same value the
   * Firestore service emits for a missing document, which lets the Boards /
   * Queries folder cards settle on an empty list instead of throwing
   * `unknown store` out of `DatatugFolderComponent.ngOnChanges` and taking
   * the whole project page down with it. When datatug-cli grows a folder
   * read route, this is the place to turn into an HTTP call.
   */
  watchProjectItem<T>(): Observable<T | null | undefined> {
    return of(null);
  }
}
