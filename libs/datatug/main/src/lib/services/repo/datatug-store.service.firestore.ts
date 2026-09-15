import { IProjectSummary } from '../../models/definition/project';
import { IDatatugStoreService } from './datatug-store.service.interface';
import { Observable, throwError } from 'rxjs';
import {
  doc,
  Firestore,
} from 'firebase/firestore';
import { map } from 'rxjs/operators';
import { Injectable, inject } from '@angular/core';
import { docData, docSnapshots } from './firestore-observables';

/**
 * Collection the DataTug cloud backend writes projects to
 * (`datatug_projects/{projectID}` — see `datatug/backend`'s
 * `models4datatug.ProjectsCollection`).
 */
export const FIRESTORE_PROJECTS_COLLECTION = 'datatug_projects';

// `providedIn: 'root'` — needed so `DatatugStoreServiceFactory` (also
// root-provided) can resolve this dependency regardless of which route
// requested it.
@Injectable({ providedIn: 'root' })
export class DatatugStoreFirestoreService implements IDatatugStoreService {
  private readonly db = inject(Firestore);

  /**
   * Watches the project record the cloud backend writes. It carries the
   * project's own metadata (title, access, userIDs, created); boards, entities
   * and environments are separate documents, so a fresh project legitimately
   * has none. A record that does not exist (or is not readable under the
   * user's Firestore rules) yields `undefined` — the pages treat that as
   * "no such project" rather than as a failure.
   */
  getProjectSummary(
    projectId: string,
  ): Observable<IProjectSummary | undefined> {
    if (!projectId) {
      return throwError(() => 'projectId is a required parameter');
    }
    const projectDoc = doc(this.db, FIRESTORE_PROJECTS_COLLECTION, projectId);
    return docData<IProjectSummary>(projectDoc).pipe(
      map((project) => (project ? { ...project, id: projectId } : undefined)),
    );
  }

  watchProjectItem<T>(
    projectId: string,
    path?: string,
  ): Observable<T | null | undefined> {
    if (path && !path.startsWith('/')) {
      return throwError(() => 'path should start with a "/", got: ' + path);
    }
    path = `datatug_projects/${projectId}${path || ''}`;
    const d = doc(this.db, path);

    return docSnapshots(d).pipe(
      map((changes) => {
        if (!changes.exists()) {
          return null;
        }
        return changes.data() as unknown as T;
      }),
    );
  }
}
