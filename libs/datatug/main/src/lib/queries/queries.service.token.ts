import { inject, InjectionToken } from '@angular/core';
import { Firestore } from 'firebase/firestore';
import { IQueryDef } from '../models/definition/query-def';
import {
  ProjectItemService,
  ProjectItemServiceFactory,
} from '../services/repo/project-item-service';
import { StoreApiService } from '../services/repo/store-api.service';

// `providedIn: 'root'` + inline `factory` (S157, same trap as
// `QueryEditorStateService`/`QueriesUiService` — see
// `query-editor-state-service.ts`'s own comment): this token used to be
// provided only via `DatatugQueriesServicesModule`'s `providers:` array
// (`{ provide: QUERY_PROJ_ITEM_SERVICE, deps: [...], useFactory: ... }`),
// which `QueriesService` (this file's own consumer) `inject()`s as an eager
// field initializer. `QueriesService` is root-provided too now (see its own
// file), and a `providedIn: 'root'` service's `inject()` calls always
// resolve against the ROOT injector, never against whichever leaf component
// happened to import the module that used to carry this token (confirmed
// live by this repo's own 2234728 "make ProjectService an app singleton
// too" follow-up fix) — so this token has to be root-resolvable on its own
// for `QueriesService` to construct from anywhere, not only from
// `QueryPageComponent`/`QueriesPageComponent`'s own `imports:`.
export const QUERY_PROJ_ITEM_SERVICE = new InjectionToken<
  ProjectItemService<IQueryDef>
>('QueryProjectItemService', {
  providedIn: 'root',
  factory: () =>
    inject(ProjectItemServiceFactory).newProjectItemService<IQueryDef>(
      inject(Firestore),
      inject(StoreApiService),
      'queries',
      'query',
    ),
});
