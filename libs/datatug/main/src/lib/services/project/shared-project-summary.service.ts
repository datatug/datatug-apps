import { Injectable, inject } from '@angular/core';
import { SneatAuthStateService } from '@sneat/auth-core';
import {
  Observable,
  catchError,
  finalize,
  of,
  shareReplay,
  startWith,
  switchMap,
  throwError,
} from 'rxjs';
import {
  IProjectRef,
  isSharedProjectRef,
  projectRefToString,
} from '../../core/project-context';
import { IProjectSummary } from '../../models/definition/project';
import { DatatugStoreFirestoreService } from '../repo/datatug-store.service.firestore';

/** Rules-gated metadata only. Read success grants no mutation, execution or paid entitlement. */
@Injectable({ providedIn: 'root' })
export class SharedProjectSummaryService {
  private readonly auth = inject(SneatAuthStateService);
  private readonly store = inject(DatatugStoreFirestoreService);
  private readonly watches = new Map<
    string,
    Observable<IProjectSummary | undefined>
  >();

  watch(ref: IProjectRef): Observable<IProjectSummary | undefined> {
    if (!isSharedProjectRef(ref))
      return throwError(() => new Error('Invalid shared project reference'));
    const frozenRef = Object.freeze({ ...ref });
    const key = projectRefToString(frozenRef);
    if (!key)
      return throwError(() => new Error('Invalid shared project reference'));
    let watch = this.watches.get(key);
    if (!watch) {
      watch = this.auth.authState.pipe(
        // Every session/auth transition cancels old delivery and clears its replay, even for the same UID.
        switchMap((state) =>
          state.status === 'authenticated' && state.user?.uid
            ? this.store.getSharedProjectSummary(frozenRef).pipe(
                startWith(undefined),
                catchError(() => of(undefined)),
              )
            : of(undefined),
        ),
        finalize(() => {
          if (this.watches.get(key) === watch) this.watches.delete(key);
        }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
      this.watches.set(key, watch);
    }
    return watch;
  }
}
