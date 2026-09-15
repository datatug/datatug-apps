import { Observable } from 'rxjs';
import { IProjectSummary } from '../../models/definition/project';

export interface IDatatugStoreService {
  /**
   * Watches one project's summary. `undefined` means "no such project" (e.g. a
   * Firestore record that does not exist) — stores that fail loudly instead
   * simply never emit it.
   */
  getProjectSummary(
    projectId: string,
  ): Observable<IProjectSummary | undefined>;

  watchProjectItem<T>(
    projectId: string,
    path: string,
  ): Observable<T | null | undefined>;
}
