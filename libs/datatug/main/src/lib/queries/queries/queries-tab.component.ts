import { TitleCasePipe } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  effect,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonIcon,
  IonInput,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonText,
} from '@ionic/angular';
import { Subscription } from 'rxjs';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SqlEditorComponent } from '../../components/sqleditor/sql-editor.component';
import { IProjectRef } from '../../core/project-context';
import { IProjItemBrief } from '../../models/definition/project';
import {
  IQueryDef,
  IQueryFolder,
  IQueryFolderContext,
  ISqlQueryRequest,
  QueryItem,
} from '../../models/definition/query-def';
import { IProjectContext } from '../../nav/nav-models';
import { DatatugNavContextService } from '../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import { GITHUB_PERSONAL_QUERIES_MESSAGE, QueriesService } from '../queries.service';

interface FilteredItem {
  //TODO: make readonly
  folders: string[];
  query: IQueryDef;
}

interface IParentFolder extends IQueryFolder {
  path: string;
}

type QueryType = 'SQL' | 'GraphQL' | 'HTTP';

@Component({
  selector: 'sneat-datatug-queries-tab',
  templateUrl: 'queries-tab.component.html',
  imports: [
    SqlEditorComponent,
    IonItem,
    IonLabel,
    IonInput,
    FormsModule,
    IonIcon,
    IonButton,
    IonButtons,
    IonItemDivider,
    IonBadge,
    IonText,
    TitleCasePipe,
  ],
})
export class QueriesTabComponent {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly queriesService = inject(QueriesService);
  private readonly dataTugNavContextService = inject(DatatugNavContextService);
  private readonly dataTugNavService = inject(DatatugNavService);
  // This app runs zoneless (provideZonelessChangeDetection(), main.ts —
  // see env-db-table.page.ts's own comment on the same class of gap):
  // `currentFolder`/`allQueries`/`parentFolders`/`filteredItems` below are
  // plain fields, not signals, and every one of them is mutated from an
  // RxJS `.subscribe()` callback (loadQueries()'s HTTP response,
  // newFolder()/deleteFolder()'s own writes) — a write Angular's zoneless
  // change detector has no way to notice on its own. Confirmed live (S121,
  // Task 17): the real folder tree loads correctly (verified via
  // `ng.getComponent(...).currentFolder`) but the template never repaints —
  // the page shows only its static SQL/HTTP toolbar forever. `markForCheck()`
  // after each such mutation is the same fix this codebase already applies
  // elsewhere for the identical gap (env-db-table.page.ts converted its own
  // async-mutated fields to signals instead; `markForCheck()` here is the
  // narrower, no-template-rewrite equivalent for this component's several
  // interrelated fields).
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  readonly rootFolder = input<'shared' | 'personal' | 'bookmarked'>();
  // TODO: Skipped for migration because:
  //  Your application code writes to the input. This prevents migration.
  // TODO: Skipped for migration because:
  //  Your application code writes to the input. This prevents migration.
  readonly project = model<IProjectContext>();

  public isDeletingFolders: string[] = [];
  public type: QueryType | '*' = '*';

  public filter = '';

  public readonly codemirrorOptions = {
    lineNumbers: false,
    readOnly: true,
    mode: 'text/x-sql',
    viewportMargin: Infinity,
    style: { height: 'auto' },
  };

  public allQueries?: QueryItem[];

  public parentFolders: IParentFolder[] = [];

  public filteredItems?: FilteredItem[];

  private queriesSub?: Subscription;

  // Set instead of populating `currentFolder`/`allQueries` when the
  // "Personal" tab of a GitHub-store project has no live agent to read a
  // real personal folder from (`QueriesService.getQueriesFolder()` rejects
  // with exactly `GITHUB_PERSONAL_QUERIES_MESSAGE` for that case — see its
  // own doc comment) — an expected, not-a-bug outcome that gets its own
  // friendly card notice instead of the "Shared" tree it used to silently
  // fall back to (S163, founder-reported follow-up), and instead of an
  // `ErrorLogger.logError()` toast.
  public readonly personalQueriesNotice = signal<string | undefined>(undefined);

  // Tracks which `rootFolder` value `currentFolder`/`allQueries` currently
  // reflect — see this class's own `effect()` (below, in the constructor)
  // for why comparing against this (not just re-fetching unconditionally
  // on every signal read) matters: it is what tells a genuine tab switch
  // (reset the folder browsing position back to the root) apart from an
  // unrelated re-run of the same effect (e.g. `project()` changing while
  // `rootFolder()` stays the same, where the current browsing position
  // should be preserved, matching this component's pre-existing behaviour
  // for any other `currentProject` re-emission).
  private rootFolderPrimed = false;
  private lastFetchedRootFolder?: 'shared' | 'personal' | 'bookmarked';

  public currentFolder: IQueryFolderContext = { path: '~', id: '' };

  // Regression found live while wiring real navigation to the Queries page
  // (Task 17 item B.1, S121): navigating here with NO `folder` query param
  // (the real, persistent-side-menu "Queries" link —
  // project-menu-top.component.html — produces exactly this URL) used to
  // call `updateUrlWithCurrentFolder()`, which writes `this.currentFolder.
  // path` ("~") straight into the `folder` URL param UNCHANGED (its own
  // `.replace('~/', '')` only strips a "~/" PREFIX, and the bare root value
  // "~" has none to strip) — producing `?folder=~`, a URL this component's
  // OWN reader then re-parses as folder id `"~"` (not empty), setting
  // `currentFolder = { path: '~/~', id: '~' }`. That extra round trip (a
  // second `queryParamMap` emission, asynchronous) can complete BEFORE the
  // in-flight `loadQueries()` fetch's response arrives; when it does,
  // `onFolderRetrieved()`'s own guard (`path !== this.currentFolder.path`)
  // compares the fetch's original "~" against the now-mutated "~/~" and
  // silently discards the correctly-loaded folder tree — confirmed live
  // against a real agent: the page renders its filter/type-badge toolbar
  // (proving no crash) but NEVER the customers/reference folders it just
  // fetched. Root cause: this round trip was pointless to begin with — an
  // empty `folder` param is already exactly what `currentFolder`'s own field
  // default (`{ path: '~', id: '' }`) represents, so there was never
  // anything here to "correct" by rewriting the URL. Always taking the
  // straightforward branch (dropped the `if (!id)` special case entirely)
  // makes the id-empty path a no-op instead of a race: `(id && ...) || '~'`
  // already resolves to the same `path: '~'` the field default already had.
  constructor() {
    this.route.queryParamMap.subscribe({
      next: (queryParams) => {
        const id = queryParams.get('folder') || '';
        // `cd()` below already computes the FULL `currentFolder` (real
        // `folders`/`items`, walked out of the already-fetched tree) before
        // pushing that same `id` into the URL via `updateUrlWithCurrentFolder()`
        // — a query-param-only `router.navigate()`, which re-emits THIS SAME
        // `queryParamMap` subscription with the identical `id`. Rebuilding
        // `currentFolder` as a bare `{path, id}` stub on that echo wiped out
        // the folders/items `cd()` had just resolved, and nothing re-fetches
        // them (loadQueries() below runs exactly once, on construction) —
        // confirmed live (S121, Task 17): clicking into "customers" left the
        // subfolder view showing only its `..` row forever, though
        // `ng.getComponent(...).parentFolders` proved the real
        // customer-invoices/customer-purchases-by-genre items were sitting in
        // memory the whole time, just no longer referenced by `currentFolder`.
        // Skipping the reset when `id` hasn't actually changed treats the
        // echo as the no-op it is; a genuinely new `id` (a direct deep link,
        // or browser back/forward — neither of which routes through `cd()`)
        // still updates normally below, unchanged from before this fix.
        //
        // S154: this component is never routed on its own — it's a plain
        // child embedded in QueriesPageComponent's template
        // (queries-page.component.html), so `inject(ActivatedRoute)` above
        // resolves to that SAME page's ActivatedRoute. Any query-param-only
        // navigation on THAT route — not just this component's own
        // `updateUrlWithCurrentFolder()` above, but also the PAGE's own
        // `updateUrlWithCurrentTab()`/`updateUrlWithOrderTagsBy()` (the
        // "Personal"/"Shared" segment and the "Order by" select, both
        // `router.navigate([], {queryParamsHandling: 'merge'})`) — re-emits
        // `queryParamMap` to THIS subscription too, with `folder` unchanged.
        // The no-op guard above compares the URL's `id` sentinel for "no
        // folder" (`''`, `queryParams.get('folder') || ''`) against
        // `currentFolder.id` — but once a folder has actually loaded,
        // `currentFolder.id` is the SERVER's own id for that folder, and for
        // the root folder that id is the literal string `'~'`
        // (GithubProjectReaderService.getQueriesFolder()'s `{id: '~', ...}`,
        // same for the CLI-agent path — see onFolderRetrieved() below), not
        // `''`. `'' !== '~'` defeats the guard, and the handler wipes the
        // just-loaded root folder back to the empty `{path: '~', id: ''}`
        // stub — confirmed live (S154, build a7eaf10): switching the Queries
        // page from "Personal" to "Shared" and back left BOTH tabs showing
        // zero items, although the folder tree had loaded correctly moments
        // before and no new fetch ever ran (this component is never
        // destroyed by that tab switch either — `queries-page.component.html`
        // renders one `sneat-datatug-queries-tab` for both tabs, so this is
        // the SAME instance, same in-memory `allQueries`/`currentFolder`,
        // the whole time). `'~'` is this app's own reserved root-path
        // marker everywhere else (getFolderAndUpdateParents() below already
        // filters it out of `path.split('/')` as "not a real segment"), so
        // normalizing it to the URL's own `''` root sentinel before
        // comparing treats both spellings of "no folder" as the same value
        // — fixing this bug, and, as a side effect, the equivalent stale
        // `?folder=~` URL `updateUrlWithCurrentFolder()` can itself produce
        // for `cd('~')` (path `'~'`, `.replace('~/', '')` leaves the leading
        // `~` untouched).
        const normalizedId = id === '~' ? '' : id;
        const normalizedCurrentId =
          this.currentFolder.id === '~' ? '' : this.currentFolder.id;
        if (normalizedId === normalizedCurrentId) {
          return;
        }
        this.currentFolder = {
          path: (normalizedId && `~/${normalizedId}`) || '~',
          id: normalizedId,
        };
        this.displayCurrentFolder();
      },
      error: this.errorLogger.logErrorHandler(
        'Failed to get query params map from activate route',
      ),
    });
    this.trackCurrentProject();

    // `rootFolder` is a signal `input()` — unlike an `@Input()`-decorated
    // property, its value is not readable in the constructor (Angular only
    // applies a signal input's value once the directive has already been
    // constructed — confirmed live against this exact class: reading
    // `this.rootFolder()` here returns `undefined` even when the parent
    // template already binds `[rootFolder]="tab"='personal'`) and it never
    // fires `ngOnChanges` either (that lifecycle hook only observes
    // decorator-based `@Input()`s), so an `effect()` is the only
    // signal-safe way to notice BOTH its true initial value and any later
    // change — e.g. toggling the Queries page's Personal/Shared segment,
    // which rebinds `[rootFolder]="tab"` on this SAME long-lived component
    // instance (`queries-page.component.html` keeps ONE
    // `<sneat-datatug-queries-tab>` alive across that whole branch — see
    // this class's own S154 history above). `project()` is read here too
    // (rather than closing over the `currentProject` value from
    // `trackCurrentProject()`'s own subscribe callback) so this effect also
    // reruns once the project resolves asynchronously, without a second,
    // separate subscription.
    //
    // Before this fix, the query FETCH never depended on `rootFolder` at
    // all — `loadQueries()`'s old body called
    // `queriesService.getQueriesFolder(ref, path)` with no rootFolder
    // argument, so a GitHub-store project's "Personal" tab silently showed
    // the exact same shared folder tree as "Shared" (S163, founder-reported
    // follow-up; `QueriesService.getQueriesFolder()`'s own doc comment
    // explains why the GitHub reader can only ever return that one shared
    // tree).
    //
    // Regression found live (journey e2e, direct-nav.spec.ts, "resolves the
    // project into its outgoing request"): a direct URL load of
    // `?folder=customers` (no `tab`) sets `currentFolder.path = '~/customers'`
    // SYNCHRONOUSLY via the `queryParamMap` subscription above, BEFORE this
    // effect ever gets a real `project()` to run with (a REAL agent's
    // `currentProject` resolves asynchronously — unlike this class's own
    // synchronous-`of()`-backed unit tests). This effect's FIRST successful
    // run (once `project()` finally arrives) must NOT reset `currentFolder`
    // back to root just because it is priming `lastFetchedRootFolder` for
    // the first time — that discarded the already-correct `'~/customers'`
    // path, sending the outgoing `all_queries` request `folder=~` instead of
    // `folder=~/customers`. Only an ACTUAL rootFolder value change on a
    // LATER run (a genuine Personal/Shared tab switch on the SAME already-
    // primed instance) resets the browsing position — gated on
    // `rootFolderPrimed` already being `true` before this run.
    effect(() => {
      const rootFolder = this.rootFolder();
      const project = this.project();
      if (!project) {
        return;
      }
      if (this.rootFolderPrimed && rootFolder !== this.lastFetchedRootFolder) {
        this.currentFolder = { path: '~', id: '' };
        this.parentFolders = [];
      }
      this.rootFolderPrimed = true;
      this.lastFetchedRootFolder = rootFolder;
      this.fetchFolder(project.ref, this.currentFolder.path, rootFolder);
    });
  }

  private trackCurrentProject(): void {
    this.dataTugNavContextService.currentProject.subscribe({
      next: (currentProject) => this.project.set(currentProject),
      error: this.errorLogger.logErrorHandler('failed to get current project'),
    });
  }

  public isFiltering(): boolean {
    return !!this.filter && this.type !== '*';
  }

  getText(query: IQueryDef): string {
    return (query.request as ISqlQueryRequest).text;
  }

  public readonly trackById = (_: number, v: IProjItemBrief) => v.id;

  public clearFilter(): void {
    this.filter = '';
    this.type = '*';
  }

  public get isRoot(): boolean {
    return !!this.currentFolder.id;
  }

  // Folder-qualifies `q.id` before navigating (S97's one saved-query id
  // convention — GET /queries/get_query needs `customers/customer-invoices`,
  // not the bare `customer-invoices` this component's own items carry).
  // `folders` is only ever supplied by the *filtered/search* click path
  // (`item.folders`, built by populateFilteredItems() below); a plain
  // browse-mode click on `currentFolder.items` (queries-tab.component.html's
  // `(click)="goQuery(query)"`) passes none at all. The OLD code assumed
  // `folders` was always given — `undefined?.join('/')` produced the
  // literal string `"undefined/<id>"`, so clicking a query normally (not
  // via the filter box) navigated to a nonsense id and 404'd. Found while
  // wiring real navigation for Task 17's journey e2e (S121): defaults to
  // this.currentFolder.path (always populated, the same "~"-prefixed path
  // the folder-tree walk already tracks) when the caller supplies nothing.
  goQuery(q: IQueryDef, action?: 'execute' | 'edit', folders?: string[]): void {
    const segments = folders ?? this.currentFolder.path.split('/');
    const folderId = segments.filter((s) => s && s !== '~').join('/');
    q = { ...q, id: folderId ? `${folderId}/${q.id}` : q.id };
    const project = this.project();
    if (project) {
      this.dataTugNavService.goQuery(project, q, action);
    }
  }

  applyFilter(): void {
    if (!this.filter) {
      this.filteredItems = undefined;
    }
    this.filteredItems = [];
    this.populateFilteredItems(
      this.currentFolder.path.split('/'),
      this.currentFolder,
    );
  }

  setQueryType(type: QueryType): void {
    this.type = type === this.type ? '*' : type;
    this.applyFilter();
  }

  private populateFilteredItems(path: string[], folder: IQueryFolder): void {
    const f = this.filter.toLowerCase();
    folder?.items?.forEach((item) => {
      if ((item.title || item.id).toLowerCase().includes(f)) {
        this.filteredItems?.push({ query: item, folders: path });
      }
    });
    folder?.folders?.forEach((subFolder) => {
      this.populateFilteredItems([...path, subFolder.id], subFolder);
    });
  }

  cd(path: string): void {
    if (path === '~') {
      this.currentFolder = {
        ...this.parentFolders[0],
        path: '~',
      };
      this.parentFolders = [];
    } else if (path === '..') {
      const p = this.currentFolder.path.split('/');
      p.pop();
      const parentFolder: IParentFolder | undefined = this.parentFolders.pop();
      if (parentFolder) {
        this.currentFolder = {
          ...parentFolder,
          path: p.join('/'),
        };
      }
    } else if (path) {
      this.currentFolder = {
        ...this.getFolderAndUpdateParents(path, this.currentFolder),
        path: this.currentFolder.path + '/' + path,
      };
    } else if (!path) {
      throw new Error('can not change directory to a folder with empty name');
    }
    this.updateUrlWithCurrentFolder();
    this.displayCurrentFolder();
  }

  private updateUrlWithCurrentFolder(): void {
    this.setUrlParam('folder', this.currentFolder.path.replace('~/', ''));
  }

  private setUrlParam(name: string, value: string): void {
    this.router
      .navigate([], {
        queryParams: { [name]: value },
        replaceUrl: true,
      })
      .catch(
        this.errorLogger.logErrorHandler(
          `Failed to set url parameter "${name}"`,
        ),
      );
  }

  /** The one place `QueriesService.getQueriesFolder()` is ever called from
   * — both the constructor's own `effect()` (initial load, and any later
   * `project`/`rootFolder` change) and `newFolder()`/`deleteFolder()`
   * indirectly go through this for a fresh fetch. `rootFolder === 'personal'`
   * on a GitHub-store project rejects with exactly
   * `GITHUB_PERSONAL_QUERIES_MESSAGE` (see that constant's own doc comment,
   * `queries.service.ts`) — an expected, not-a-bug outcome that gets its
   * own friendly `personalQueriesNotice` instead of an `ErrorLogger.
   * logError()` toast (the same `isGithubReadOnlyError`-style pattern
   * `dbserver-page.component.ts` already establishes for its own
   * `GITHUB_DBSERVER_DETAIL_MESSAGE`). */
  private fetchFolder(
    projRef: IProjectRef,
    path: string,
    rootFolder: 'shared' | 'personal' | 'bookmarked' | undefined,
  ): void {
    if (this.queriesSub) {
      this.queriesSub.unsubscribe();
    }
    this.personalQueriesNotice.set(undefined);
    this.queriesSub = this.queriesService
      .getQueriesFolder(projRef, path, rootFolder)
      .subscribe({
        next: (folder: IQueryFolder | null | undefined) => {
          this.onFolderRetrieved(path, folder);
        },
        error: (err: unknown) => {
          if (isGithubPersonalQueriesError(err)) {
            this.allQueries = [];
            this.currentFolder = { path: '~', id: '~', folders: [], items: [] };
            this.parentFolders = [];
            this.personalQueriesNotice.set(GITHUB_PERSONAL_QUERIES_MESSAGE);
            // Zoneless: this callback only ever runs from an RxJS
            // `.subscribe()` error (this class's own `changeDetectorRef`
            // doc comment).
            this.changeDetectorRef.markForCheck();
            return;
          }
          this.errorLogger.logError(err, 'Failed to load queries');
        },
      });
  }

  private onFolderRetrieved(path: string, folder?: IQueryFolder | null): void {
    if (!path) {
      throw new Error('path is a required parameter');
    }
    if (!folder) {
      throw new Error('folder argument expected to have value or be null');
    }
    if (path !== this.currentFolder.path) {
      return;
    }
    if (!folder && path === '~') {
      folder = { id: '~', folders: [], items: [] };
    }
    this.allQueries = folder?.items || [];
    if (folder) {
      this.currentFolder = {
        ...this.getFolderAndUpdateParents(path, folder),
        path,
      };
    }
    this.displayCurrentFolder();
    // Zoneless: this whole method only ever runs from an RxJS subscribe
    // callback (loadQueries()'s HTTP response) — see this class's own
    // `changeDetectorRef` doc comment.
    this.changeDetectorRef.markForCheck();
  }

  // S121c (Task 17, exposed by a direct/deep-link load of a non-root
  // folder — direct-nav.spec.ts's own queries-list test, and any
  // `?folder=<id>` URL): the original `while`/`p.pop()` loop walked EVERY
  // segment of `path`, including the leading "~" root marker, as a child id
  // to look up in `folder.folders` — but "~" names `folder` itself (the
  // starting point, already resolved by the caller: `onFolderRetrieved`
  // passes the just-fetched ROOT tree; `cd()` passes `this.currentFolder`),
  // never one of its own children. `folder.folders.find(id => id === '~')`
  // therefore always failed on the very first step of any multi-segment
  // path (`onFolderRetrieved`'s own "~/customers" — `cd()`'s own
  // single-segment calls, e.g. "customers" with no leading "~", never hit
  // this because they had nothing to skip), leaving `folder` `undefined`
  // before it ever reached the REAL target segment — confirmed live: a
  // fresh `/queries?folder=customers` load left `currentFolder` empty
  // (`allQueries: []`, no `id`/`items`) although the fetched tree, sitting
  // right there in `parentFolders[0]`, had `customers`'s two saved queries
  // the whole time. Fix: strip the leading "~" (and any stray empty
  // segment) before walking, then walk forward in path order — `path`'s
  // own segments are already root-to-leaf, so no reversal was ever needed
  // either.
  private getFolderAndUpdateParents(
    path: string,
    folder: IQueryFolder,
  ): IQueryFolder {
    if (path === '~') {
      return folder;
    }
    const segments = path.split('/').filter((s) => s && s !== '~');
    let ancestorPath = '~';
    for (const id of segments) {
      if (!folder) {
        break;
      }
      this.parentFolders.push({ ...folder, path: ancestorPath });
      folder = folder.folders?.find((item) => item.id === id) as IQueryFolder;
      ancestorPath = `${ancestorPath}/${id}`;
    }
    return folder;
  }

  private displayCurrentFolder(): void {
    this.currentFolder?.folders?.sort((a, b) => {
      if (a.id < b.id) {
        return -1;
      }
      if (a.id > b.id) {
        return 1;
      }
      return 0;
    });
    this.currentFolder?.items?.sort((a, b) => {
      const ac = a.title || a.id,
        bc = b.title || b.id;
      if (ac < bc) {
        return -1;
      }
      if (ac > bc) {
        return 1;
      }
      return 0;
    });
    this.applyFilter();
  }

  newFolder(): void {
    const name = prompt('Name of a new folder?');
    if (!name) {
      return;
    }
    const parentFolder = this.currentFolder;
    const project = this.project();
    if (parentFolder && project) {
      this.queriesService
        .createQueryFolder(project.ref, parentFolder.path, name)
        .subscribe({
          next: (folder) => {
            const existing = parentFolder.folders?.find((f) => f.id === name);
            if (existing) {
              existing.folders = folder.folders;
              existing.items = folder.items;
            } else {
              if (parentFolder.folders) {
                // This smells, should use readonly props?
                parentFolder.folders.push(folder);
              } else {
                parentFolder.folders = [folder];
              }
            }
            this.cd(`${parentFolder.path}/${name}`);
            // Zoneless (this class's own `changeDetectorRef` doc comment):
            // this whole callback runs from an RxJS subscribe, not a
            // tracked DOM event.
            this.changeDetectorRef.markForCheck();
          },
          error: this.errorLogger.logErrorHandler(
            'Failed to create new folder',
          ),
        });
    }
  }

  public deleteFolder(): void {
    const m =
      this.currentFolder.path === '~'
        ? 'Are you sure you want to delete all queries and sub-folder?'
        : `Are you sure you want to delete this folder?\n\n  /${this.currentFolder.path}`;
    if (!confirm(m)) {
      return;
    }
    const folder = this.currentFolder;
    const folderPath = folder.path;
    const parent = this.parentFolders[this.parentFolders.length - 1];
    this.isDeletingFolders.push(folderPath);
    const project = this.project();
    if (project) {
      this.queriesService.deleteQueryFolder(project.ref, folderPath).subscribe({
        next: () => {
          this.isDeletingFolders = this.isDeletingFolders.filter(
            (f) => f !== folderPath,
          );
          parent.folders = parent.folders?.filter((f) => f.id !== folder.id);
          if (
            this.currentFolder.path === folderPath &&
            this.currentFolder.id === folder.id
          ) {
            this.cd('..');
          }
          // Zoneless (this class's own `changeDetectorRef` doc comment).
          this.changeDetectorRef.markForCheck();
        },
        error: (err) => {
          this.isDeletingFolders = this.isDeletingFolders.filter(
            (f) => f !== folderPath,
          );
          this.errorLogger.logError(err, 'Failed to delete queries folder');
          this.changeDetectorRef.markForCheck();
        },
      });
    }
  }
}

/**
 * `QueriesService.getQueriesFolder()` rejects with exactly `new
 * Error(GITHUB_PERSONAL_QUERIES_MESSAGE)` for the "Personal" tab of a
 * GitHub-store project (own doc comment, `queries.service.ts`) — an
 * expected, not-a-bug outcome that gets its own friendly card notice
 * instead of an `ErrorLogger.logError()` toast.
 */
function isGithubPersonalQueriesError(err: unknown): boolean {
  return err instanceof Error && err.message === GITHUB_PERSONAL_QUERIES_MESSAGE;
}
