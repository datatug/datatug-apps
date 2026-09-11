import { Observable } from 'rxjs';
import { map, startWith, take, tap } from 'rxjs/operators';
import { Injectable } from '@angular/core';
import { IProjectRef } from '../../core/project-context';
import {
  IProjItemBrief,
  IProjItemsFolder,
} from '../../models/definition/project';
import { StoreApiService } from './store-api.service';
import {
  collection,
  doc,
  Firestore,
} from 'firebase/firestore';
import { docSnapshots } from './firestore-observables';

// const notImplemented = 'not implemented';

// `providedIn: 'root'` (S157, same trap as `QueryEditorStateService`/
// `QueriesUiService` — see `query-editor-state-service.ts`'s own comment):
// `QUERY_PROJ_ITEM_SERVICE` (`queries/queries.service.token.ts`) needs this
// factory resolvable from the ROOT injector — a `providedIn: 'root'` token's
// own factory always runs its `inject()` calls against the root injector,
// never against whichever leaf component happened to trigger its first
// construction (confirmed live by this repo's own 2234728 "make
// ProjectService an app singleton too" follow-up fix). This class has no
// constructor dependencies of its own and is purely stateless (one factory
// method wrapping `new ProjectItemService(...)`), so rooting it is safe —
// no shared-state semantics to preserve either way.
@Injectable({ providedIn: 'root' })
export class ProjectItemServiceFactory {
  // Explicitly generic (S157): none of the constructor params reference
  // `ProjItem`, so TypeScript cannot infer it from a call site — without
  // this, every call silently widened to the generic's own constraint
  // (`ProjectItemService<IProjItemBrief>`), which only went unnoticed
  // before because the two call sites (this file's old
  // `datatug-queries-services.module.ts` factory provider,
  // `queries.service.token.ts` now) both READ the result through an
  // explicit `inject<ProjectItemService<IQueryDef>>(...)` cast rather than
  // relying on this method's own return type. `QUERY_PROJ_ITEM_SERVICE`'s
  // new `InjectionToken<ProjectItemService<IQueryDef>>` (S157) type-checks
  // its `factory`'s return against that generic for real, so it needs the
  // explicit `<IQueryDef>` type argument at the call site to type-check.
  public readonly newProjectItemService = <
    ProjItem extends IProjItemBrief,
  >(
    db: Firestore,
    storeApiService: StoreApiService,
    itemsPath: string,
    itemPath: string,
  ): ProjectItemService<ProjItem> =>
    new ProjectItemService<ProjItem>(db, storeApiService, itemsPath, itemPath);
}

// TODO: why it's complaining about TS1219?
export class ProjectItemService<ProjItem extends IProjItemBrief> {
  private cache: Record<string, ProjItem> = {};

  constructor(
    private readonly db: Firestore,
    private readonly storeApiService: StoreApiService,
    private readonly itemsPath: string,
    private readonly itemPath: string,
  ) {}

  public getProjItems(
    from: IProjectRef,
    folderPath: string,
  ): Observable<ProjItem[]> {
    return this.storeApiService
      .get<ProjItem[]>(
        from.storeId,
        `/${this.itemsPath}/all_${this.itemsPath}`,
        {
          params: {
            project: from.projectId,
            folder: folderPath,
          },
        },
      )
      .pipe(
        tap((items) => {
          const folder: IProjItemsFolder = {
            id: (folderPath && folderPath.split('/').pop()) || folderPath,
            items,
          };
          this.putProjItemsToCache(folder, folderPath);
        }),
      );
  }

  // S174: `root` is the wire `?root=personal` param datatug-cli v0.24.0's
  // `GET /datatug/queries/all_queries` adds (api-contract.md, PR #55) — a
  // missing/blank `root` (this param simply omitted) is byte-identical to
  // every pre-v0.24.0 request and resolves to the SHARED tree, so callers
  // must only ever pass `'personal'` here, never `'shared'`, to keep the
  // shared-tab request wire-identical to before this fix. `getFolder` stays
  // generic over `itemsPath` (this class has no other consumer today — see
  // `queries.service.token.ts`'s own `QUERY_PROJ_ITEM_SERVICE` — but nothing
  // here assumes "queries" specifically), so an unset `root` is simply never
  // added to `params` rather than the class asserting itemsPath === 'queries'
  // itself. The Firestore branch (DataTug Cloud) is untouched — this
  // contract is CLI-agent-only (AGENTS.md's zoneless note aside, this is a
  // plain data-layer change, no template/signal involvement).
  public getFolder<T extends IProjItemsFolder>(
    from: IProjectRef,
    folderPath: string,
    root?: 'personal',
  ): Observable<T | null | undefined> {
    if (from.storeId === 'firestore') {
      return this.watchFirestoreFolder<T>(from.projectId).pipe(
        take(1),
      );
    }
    const params: Record<string, string> = {
      project: from.projectId,
      folder: folderPath,
    };
    if (root === 'personal') {
      params['root'] = root;
    }
    return this.storeApiService
      .get<T>(from.storeId, `/${this.itemsPath}/all_${this.itemsPath}`, {
        params,
      })
      .pipe(
        tap((folder) => {
          if (!this.cache) {
            this.cache = {};
          }
          this.putProjItemsToCache(folder, folderPath);
        }),
      );
  }

  private watchFirestoreFolder<T>(projectId: string): Observable<T | null | undefined> {
    const datatugProjects = collection(this.db, 'datatug_projects');
    const project = doc(datatugProjects, projectId);
    const queries = collection(project, 'queries');
    const d = doc(queries, '~');

    return docSnapshots(d).pipe(
      map((changes) => {
        if (!changes) {
          return undefined;
        }
        if (!changes.exists()) {
          return null;
        }
        return changes.data() as unknown as T;
      }),
    );
  }

  private putProjItemsToCache(folder: IProjItemsFolder, path: string): void {
    if (!this.cache) {
      this.cache = {};
    }
    if (folder?.items) {
      const keyPrefix = path ? path + '/' : '';
      folder.items.forEach((item) =>
        this.putProjItemToCache(item as ProjItem, keyPrefix + item.id),
      );
    }
  }

  private putProjItemToCache = (item: ProjItem, key: string): void => {
    if (item.id || key) {
      this.cache[item.id || key] = item;
    }
  };

  public getProjItem(
    projectRef: IProjectRef,
    id: string,
  ): Observable<ProjItem> {
    let o = this.storeApiService.get<ProjItem>(
      projectRef.storeId,
      `/${this.itemsPath}/get_${this.itemPath}`,
      {
        params: {
          project: projectRef.projectId,
          [this.itemPath]: id,
        },
      },
    );
    const cached = this.cache[id];
    if (cached) {
      o = o.pipe(startWith(cached as ProjItem));
    }
    return o;
  }

  public createProjItem(
    projectRef: IProjectRef,
    projItem: ProjItem,
    itemPath = this.itemPath,
  ): Observable<ProjItem> {
    const params: Record<string, string | string[]> = {
      project: projectRef.projectId,
      id: projItem.id,
    };
    if (projectRef.storeId === 'firestore') {
      params['store'] = projectRef.storeId;
    }
    return this.storeApiService.put(
      projectRef.storeId,
      `/${this.itemsPath}/create_${itemPath}`,
      projItem,
      { params },
    );
  }

  public updateProjItem(
    projectRef: IProjectRef,
    projItem: ProjItem,
  ): Observable<ProjItem> {
    return this.storeApiService.put(
      projectRef.storeId,
      `/${this.itemsPath}/update_${this.itemPath}`,
      projItem,
      {
        params: {
          project: projectRef.projectId,
          id: projItem.id,
        },
      },
    );
  }

  public deleteProjItem(
    projectRef: IProjectRef,
    id: string,
    itemPath = this.itemPath,
  ): Observable<void> {
    return this.storeApiService.delete(
      projectRef.storeId,
      `/${this.itemsPath}/delete_${itemPath}`,
      {
        params: {
          project: projectRef.projectId,
          id,
        },
      },
    );
  }
}
