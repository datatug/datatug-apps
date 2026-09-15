import { Injectable, inject } from '@angular/core';
import { doc, Firestore } from 'firebase/firestore';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, switchMap } from 'rxjs/operators';
import { ISneatUserState, SneatUserService } from '@sneat/auth-core';
import { newRandomId } from '@sneat/random';
import { IDatatugBriefForUser, IDatatugUser } from '../../models/interfaces';
import { docData } from '../repo/firestore-observables';

export interface IDatatugUserState extends ISneatUserState {
  record?: IDatatugUser;
}

/**
 * Firestore path of the DataTug extension-owned user document. Extension data
 * belongs to `users/{uid}/ext/{extID}` — never inline in the core
 * `users/{uid}` document — and the DataTug backend writes the user's project
 * index through exactly this path.
 */
export const datatugUserExtPath = (userID: string): string =>
  `users/${userID}/ext/datatug`;

/**
 * Merges the user's DataTug extension document into the Sneat user state.
 *
 * The extension document is authoritative; `record.datatug` is read only as a
 * fallback for records written before the index moved to
 * `users/{uid}/ext/datatug`. Pure function so the merge rules stay testable
 * without a Firestore session.
 */
export function withDatatugUserData(
  sneatUserState: ISneatUserState,
  datatugExt?: IDatatugBriefForUser,
): IDatatugUserState {
  const record = sneatUserState?.record as IDatatugUser | null | undefined;
  if (record === undefined) {
    // The user record has not loaded yet — report "loading" unchanged.
    return sneatUserState as IDatatugUserState;
  }
  // `record === null` means the user document does not exist yet.
  const datatugUser: IDatatugUser = record || { title: '' };
  const datatug = datatugExt || datatugUser.datatug;
  return {
    ...sneatUserState,
    record: {
      ...datatugUser,
      datatug: datatug?.stores ? datatug : { stores: {} },
    },
  };
}

// `providedIn: 'root'`: this service holds no per-store or per-project
// state — it is a derived mapping of the global, root-provided
// `SneatUserService.userState` plus the user's DataTug extension document,
// cached with `shareReplay(1)`. It was previously provided only as a
// component-local `providers:` entry, which meant every new route/component
// that injects it (directly or through a shared component like
// `ProjectMenuTopComponent`) needed its own copy of the same fix:
// `DatatugHomePageComponent`, `DatatugStorePageComponent` (for a direct hit on
// `/store/:storeId`) and `DatatugMenuComponent` (the persistent side menu, a
// sibling branch of any routed page) each already carried one. The J1 journey's
// project deep link (`/store/:storeId/project/:projectId`, a route sibling of
// `DatatugStorePageComponent`) needed a fourth copy before this fix — see
// `apps/datatug-app/e2e/journey/README.md` and lane S79's report for the
// NG0201 this closes. `providedIn: 'root'` closes the whole class of bug for
// this service in one place instead of adding a fifth (and future sixth,
// seventh...) local `providers:` entry.
@Injectable({ providedIn: 'root' })
export class DatatugUserService {
  readonly sneatUserService = inject(SneatUserService);
  private readonly db = inject(Firestore);

  public datatugUserState: Observable<IDatatugUserState>;

  private readonly id = newRandomId({ len: 5 });

  constructor() {
    const sneatUserService = this.sneatUserService;

    if (!sneatUserService) {
      throw new Error('sneatUserService is not injected');
    }
    this.datatugUserState = sneatUserService.userState.pipe(
      switchMap((sneatUserState) => {
        const userID = sneatUserState?.user?.uid;
        if (!userID || sneatUserState.record === undefined) {
          return of(withDatatugUserData(sneatUserState));
        }
        const ref = doc(this.db, datatugUserExtPath(userID));
        return docData<IDatatugBriefForUser>(ref).pipe(
          catchError((err: unknown) => {
            // A missing or unreadable extension document must not break the
            // app: fall back to whatever the user record carries.
            console.error(
              'DatatugUserService: failed to read the DataTug user document',
              err,
            );
            return of(undefined);
          }),
          map((datatug) => withDatatugUserData(sneatUserState, datatug)),
        );
      }),
      shareReplay(1),
    );
  }
}
