import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { ISneatUserState, SneatUserService } from '@sneat/auth-core';
import { newRandomId } from '@sneat/random';
import { IDatatugUser } from '../../models/interfaces';

export interface IDatatugUserState extends ISneatUserState {
  record?: IDatatugUser;
}

// `providedIn: 'root'`: this service holds no per-store or per-project
// state — it is a pure derived mapping of the global, root-provided
// `SneatUserService.userState`, cached with `shareReplay(1)`. It was
// previously provided only as a component-local `providers:` entry, which
// meant every new route/component that injects it (directly or through a
// shared component like `ProjectMenuTopComponent`) needed its own copy of
// the same fix: `DatatugHomePageComponent`, `DatatugStorePageComponent` (for
// a direct hit on `/store/:storeId`) and `DatatugMenuComponent` (the
// persistent side menu, a sibling branch of any routed page) each already
// carried one. The J1 journey's project deep link
// (`/store/:storeId/project/:projectId`, a route sibling of
// `DatatugStorePageComponent`) needed a fourth copy before this fix — see
// `apps/datatug-app/e2e/journey/README.md` and lane S79's report for the
// NG0201 this closes. `providedIn: 'root'` closes the whole class of bug for
// this service in one place instead of adding a fifth (and future sixth,
// seventh...) local `providers:` entry.
@Injectable({ providedIn: 'root' })
export class DatatugUserService {
  readonly sneatUserService = inject(SneatUserService);

  public datatugUserState: Observable<IDatatugUserState>;

  private readonly id = newRandomId({ len: 5 });

  constructor() {
    const sneatUserService = this.sneatUserService;

    if (!sneatUserService) {
      throw new Error('sneatUserService is not injected');
    }
    this.datatugUserState = sneatUserService.userState.pipe(
      map((sneatUserState) => {
        // console.log(`DatatugUserService(id=${this.id}) => sneatUserState:`, sneatUserState);
        let datatugUser =
          (sneatUserState?.record as IDatatugUser) ||
          (sneatUserState?.record === null && { title: '' });
        if (!datatugUser) {
          return sneatUserState as IDatatugUserState;
        }
        if (!datatugUser.datatug) {
          datatugUser = {
            ...datatugUser,
            datatug: { stores: {} },
          };
        }
        if (!datatugUser?.datatug?.stores) {
          datatugUser = {
            ...datatugUser,
            datatug: { stores: {} },
          };
        }
        const datatugUserState: IDatatugUserState = {
          ...sneatUserState,
          record: datatugUser,
        };
        return datatugUserState;
      }),
      shareReplay(1),
    );
  }
}
