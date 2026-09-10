import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of, throwError } from 'rxjs';
import { catchError, map, shareReplay, switchMap } from 'rxjs/operators';
import { IParameterDef } from '../../../models/definition/parameter';
import { IRecordsetDef } from '../../../models/definition/recordset';

/**
 * `projectId` format every GitHub-store caller already relies on:
 * `"repo@org"` or `"repo@org@folder"` — `folder` is the repo-relative
 * directory the project's `datatug-project.json` lives in, defaulting to
 * `"datatug"` for the historical convention (see
 * `datatug-store.service.github.ts`'s own `buildGithubProjectSummaryUrl`,
 * which this supersedes as the ONE place this split happens — that
 * function, and `entity.service.ts`'s old `getEntityFromGithub`, each used
 * to do their own two-part `split('@')`, silently dropping a third
 * `@folder` segment where present).
 */
export interface IGithubProjectId {
  readonly repo: string;
  readonly org: string;
  readonly folder: string;
}

export function parseGithubProjectId(projectId: string): IGithubProjectId {
  const [repo, org, folder = 'datatug'] = projectId.split('@');
  return { repo, org, folder };
}

/** Raw-content URL for one file at `relativePath` (repo-relative, project-folder-prefixed). */
export function buildGithubRawUrl(
  projectId: string,
  relativePath: string,
): string {
  const { repo, org, folder } = parseGithubProjectId(projectId);
  const path = relativePath ? `${folder}/${relativePath}` : folder;
  return `https://raw.githubusercontent.com/${org}/${repo}/main/${path}`;
}

/** One entry of a directory listing, as {@link GithubProjectReaderService.listDirectory} reports it. */
export interface IGithubDirEntry {
  readonly name: string;
  /** Repo-relative path (project-folder-prefixed), e.g. `"demo-project-1/entities/Album"`. */
  readonly path: string;
  readonly type: 'file' | 'dir';
}

interface IGithubGitTreeEntry {
  readonly path: string;
  readonly type: 'blob' | 'tree' | 'commit';
}

interface IGithubGitTreeResponse {
  readonly tree?: IGithubGitTreeEntry[];
  readonly truncated?: boolean;
}

/** Shown to the user (via `ErrorLoggerService`) instead of GitHub's own opaque
 * `403` body — `handleApiError`'s own doc comment explains why 403 specifically
 * means "rate limited" for this unauthenticated, read-only client. */
export const GITHUB_RATE_LIMIT_MESSAGE =
  'GitHub API rate limit reached for this browser — please wait a few minutes and try again (unauthenticated requests to api.github.com are capped at 60/hour).';

/** Wire shape one query item's own `.query.json` (or legacy `.sql.json`) file decodes
 * to — deliberately the SAME flat shape `queries.service.ts`'s own (un-exported)
 * `IWireQueryItem` declares (structurally compatible, so `toQueryDef()`/`toQueryFolder()`
 * there accept values built from this file's types with no adapter of their own needed
 * here): datatug-cli's `GET /queries/all_queries`/`get_query` responses, and this
 * GitHub reader, both ultimately describe the same on-disk `datatug.QueryDef` JSON. */
export interface IGithubWireQueryItem {
  id: string;
  title?: string;
  type: string;
  text?: string;
  draft?: boolean;
  parameters?: IParameterDef[];
  dbModel?: string;
  recordsets?: IRecordsetDef[];
}

export interface IGithubWireQueryFolder {
  id: string;
  title?: string;
  folders?: IGithubWireQueryFolder[];
  items?: IGithubWireQueryItem[];
}

export interface IGithubTableEntry {
  schema: string;
  name: string;
  dbType: string;
}

export interface IGithubCatalogTables {
  tables: IGithubTableEntry[];
  views: IGithubTableEntry[];
}

export interface IGithubEnvDbServer {
  id: string;
  driver: string;
  host: string;
  catalogs?: string[];
}

export interface IGithubEnvironmentSummary {
  id: string;
  title: string;
  dbServers?: IGithubEnvDbServer[];
}

interface IGithubEnvDbServerFile {
  driver: string;
  host?: string;
  catalogs?: string[];
}

interface IGithubEnvFile {
  id?: string;
  title?: string;
  dbServers?: IGithubEnvDbServerFile[];
}

interface IGithubCatalogFile {
  driver?: string;
  dbModel?: string;
}

interface IGithubBoardFile {
  title?: string;
  folder?: string;
  tags?: string[];
  rows?: unknown[];
  parameters?: unknown[];
  requiredParams?: string[][];
}

interface IGithubEntityFile {
  id?: string;
  extends?: { def: string };
  fields?: unknown[];
  [key: string]: unknown;
}

/**
 * Read-only project-file reader for the GitHub store (`STORE_ID_GITHUB_COM`
 * / `STORE_TYPE_GITHUB`) — every project page's data source when a project
 * lives at `store/github.com/project/<repo>@<org>@<folder>`, since there is
 * no CLI agent to ask. `DatatugStoreGithubService` (this directory's own
 * `IDatatugStoreService` implementation) and each per-domain service that
 * already switches on store type (`EnvironmentService`, `EntityService`,
 * `QueriesService`, `DatatugBoardService`, `DbServerService`) inject this
 * directly for their GitHub branch, rather than duplicating URL-building or
 * directory-walking logic — this is the ONE place both live (founder
 * ruling 2026-09-11: "Not a single page is loading from side menu without
 * error").
 *
 * Two request shapes only:
 *  - ONE `api.github.com` call per repo ({@link getTree} — the git Trees
 *    API, recursive), giving every file/folder path in the repo up front;
 *    every subsequent "list a directory" ({@link listDirectory}) is then a
 *    pure in-memory filter over that cached tree, not a further API call.
 *    This is deliberately NOT the contents API (`GET .../contents/<path>`),
 *    which would cost one `api.github.com` call PER FOLDER — this app's own
 *    side menu alone visits a dozen-plus folders (environments, each
 *    catalog's dbmodel schema/tables, entities, six query folders, boards),
 *    and unauthenticated `api.github.com` access is capped at 60
 *    requests/hour per client IP (shared across every viewer behind that
 *    IP, e.g. a CI runner) — {@link GITHUB_RATE_LIMIT_MESSAGE}.
 *  - `raw.githubusercontent.com` for every file's actual content
 *    ({@link getRawJson}/{@link getRawText}) — a CDN, not the rate-limited
 *    core API.
 * Both are cached per `(org/repo)` or `(projectId, path)` for the lifetime
 * of this singleton (`providedIn: 'root'`), so navigating between project
 * pages never re-fetches the same directory or file twice in one session.
 */
@Injectable({ providedIn: 'root' })
export class GithubProjectReaderService {
  private readonly http = inject(HttpClient);

  private readonly treeCache = new Map<
    string,
    Observable<IGithubGitTreeEntry[]>
  >();
  private readonly fileCache = new Map<string, Observable<unknown>>();

  // ---------------------------------------------------------------------
  // Low-level: tree (directory listing) + raw file content
  // ---------------------------------------------------------------------

  private getTree(projectId: string): Observable<IGithubGitTreeEntry[]> {
    const { org, repo } = parseGithubProjectId(projectId);
    const key = `${org}/${repo}`;
    let cached = this.treeCache.get(key);
    if (!cached) {
      const url = `https://api.github.com/repos/${org}/${repo}/git/trees/main?recursive=1`;
      cached = this.http.get<IGithubGitTreeResponse>(url).pipe(
        map((res) => res.tree || []),
        catchError((err) => this.handleApiError<IGithubGitTreeEntry[]>(err, [])),
        shareReplay(1),
      );
      this.treeCache.set(key, cached);
    }
    return cached;
  }

  /**
   * Lists the immediate children of `relativePath` (repo-relative to the
   * project's own folder, `""` for the project root) — folders AND files,
   * like the GitHub contents API, but computed from the one cached
   * recursive tree (see this class's own doc comment) rather than a fresh
   * `api.github.com` call every time. A path that doesn't exist in the repo
   * (e.g. this project has no `widgets/` folder at all) resolves to an
   * empty list, never an error — the caller's page renders its own empty
   * state (founder ruling item 2).
   */
  public listDirectory(
    projectId: string,
    relativePath: string,
  ): Observable<IGithubDirEntry[]> {
    const { folder } = parseGithubProjectId(projectId);
    const base = relativePath ? `${folder}/${relativePath}` : folder;
    const prefix = `${base}/`;
    return this.getTree(projectId).pipe(
      map((tree) => {
        const children = new Map<string, 'file' | 'dir'>();
        for (const entry of tree) {
          if (!entry.path.startsWith(prefix) || entry.type === 'commit') {
            continue;
          }
          const rest = entry.path.slice(prefix.length);
          if (!rest) {
            continue;
          }
          const slashIndex = rest.indexOf('/');
          if (slashIndex === -1) {
            children.set(rest, entry.type === 'tree' ? 'dir' : 'file');
          } else {
            const childName = rest.slice(0, slashIndex);
            if (!children.has(childName)) {
              children.set(childName, 'dir');
            }
          }
        }
        return [...children.entries()]
          .map(([name, type]) => ({ name, path: `${base}/${name}`, type }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }),
    );
  }

  /**
   * `GET`s and JSON-decodes one file at `relativePath` (project-folder-relative)
   * from `raw.githubusercontent.com`. A missing file resolves to `undefined`
   * (never an error) — most callers here treat that as "this project doesn't
   * have one", not a failure.
   */
  public getRawJson<T>(
    projectId: string,
    relativePath: string,
  ): Observable<T | undefined> {
    const key = `json:${projectId}:${relativePath}`;
    let cached = this.fileCache.get(key) as Observable<T | undefined> | undefined;
    if (!cached) {
      const url = buildGithubRawUrl(projectId, relativePath);
      cached = this.http.get<T>(url).pipe(
        catchError((err) => this.handleFileError<T>(err)),
        shareReplay(1),
      );
      this.fileCache.set(key, cached);
    }
    return cached;
  }

  /** Same as {@link getRawJson}, but for a plain-text body (a query's `.sql`/`.dtql`/`.http` sidecar). */
  public getRawText(
    projectId: string,
    relativePath: string,
  ): Observable<string | undefined> {
    const key = `text:${projectId}:${relativePath}`;
    let cached = this.fileCache.get(key) as Observable<string | undefined> | undefined;
    if (!cached) {
      const url = buildGithubRawUrl(projectId, relativePath);
      cached = this.http.get(url, { responseType: 'text' }).pipe(
        catchError((err) => this.handleFileError<string>(err)),
        shareReplay(1),
      );
      this.fileCache.set(key, cached);
    }
    return cached;
  }

  /**
   * `404` (a folder/file this project simply doesn't have) maps to the
   * caller's own "empty" fallback — never an error, so an absent
   * `widgets/`/`servers/`... folder renders that page's empty state, per
   * founder ruling item 2. `403` (this unauthenticated client's
   * `api.github.com` quota exhausted, `GITHUB_RATE_LIMIT_MESSAGE`) and
   * every other status propagate as a real, user-visible error.
   */
  private handleApiError<T>(err: unknown, emptyValue: T): Observable<T> {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 404) {
        return of(emptyValue);
      }
      if (err.status === 403) {
        return throwError(() => new Error(GITHUB_RATE_LIMIT_MESSAGE));
      }
    }
    return throwError(() => err);
  }

  private handleFileError<T>(err: unknown): Observable<T | undefined> {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 404) {
        return of(undefined);
      }
      if (err.status === 403) {
        return throwError(() => new Error(GITHUB_RATE_LIMIT_MESSAGE));
      }
    }
    return throwError(() => err);
  }

  // ---------------------------------------------------------------------
  // Environments
  // ---------------------------------------------------------------------

  /** `environments/<id>/` directory names — the project's real environment
   * list (deliberately NOT `datatug-project.json`'s own `environments`
   * array, which demo-project-1 confirms can be stale/incomplete: it lists
   * only `local`/`dev`/`prod`, missing the `QA`/`UAT` folders that do
   * exist). Titles are the folder name — no `.env.json` file in this
   * project carries its own `title`. */
  public listEnvironmentIds(projectId: string): Observable<string[]> {
    return this.listDirectory(projectId, 'environments').pipe(
      map((entries) =>
        entries.filter((e) => e.type === 'dir').map((e) => e.name),
      ),
    );
  }

  public getEnvironmentSummary(
    projectId: string,
    envId: string,
  ): Observable<IGithubEnvironmentSummary> {
    return this.getRawJson<IGithubEnvFile>(
      projectId,
      `environments/${envId}/${envId}.env.json`,
    ).pipe(
      map((file) => ({
        id: envId,
        title: file?.title || envId,
        dbServers: file?.dbServers?.map((s, i) => ({
          id: [s.driver, ...(s.catalogs || [])].join(':') || `server-${i}`,
          driver: s.driver,
          host: s.host || '',
          catalogs: s.catalogs,
        })),
      })),
    );
  }

  // ---------------------------------------------------------------------
  // Catalog tables (environment -> catalog -> tables/views)
  // ---------------------------------------------------------------------

  /**
   * `ICatalogTables`-shaped: the table/view identity list for one
   * environment's catalog, read from `dbmodels/<dbModel>/<schema>/{tables,
   * views}/<name>/` folder names — no column/key detail (this project's own
   * `main.<Table>.columns.json` files carry that, deliberately not fetched
   * here to keep this listing to a handful of requests; `EnvDbTablePageComponent`,
   * a table's row-level view, needs an agent anyway — see this task's PR body).
   */
  public getCatalogTables(
    projectId: string,
    envId: string,
    catalogId: string,
  ): Observable<IGithubCatalogTables> {
    return this.getRawJson<IGithubCatalogFile>(
      projectId,
      `environments/${envId}/catalogs/${catalogId}/${catalogId}.db.json`,
    ).pipe(
      switchMap((catalogFile) => {
        const dbModel = catalogFile?.dbModel;
        if (!dbModel) {
          return of<IGithubCatalogTables>({ tables: [], views: [] });
        }
        return this.catalogTablesForModel(projectId, dbModel);
      }),
    );
  }

  private catalogTablesForModel(
    projectId: string,
    dbModel: string,
  ): Observable<IGithubCatalogTables> {
    return this.listDirectory(projectId, `dbmodels/${dbModel}`).pipe(
      switchMap((entries) => {
        const schemas = entries
          .filter((e) => e.type === 'dir')
          .map((e) => e.name);
        if (!schemas.length) {
          return of<IGithubCatalogTables>({ tables: [], views: [] });
        }
        return forkJoin(
          schemas.map((schema) =>
            forkJoin({
              tables: this.listDirectory(
                projectId,
                `dbmodels/${dbModel}/${schema}/tables`,
              ),
              views: this.listDirectory(
                projectId,
                `dbmodels/${dbModel}/${schema}/views`,
              ),
            }).pipe(
              map(({ tables, views }) => ({
                tables: tables
                  .filter((e) => e.type === 'dir')
                  .map((e) => ({ schema, name: e.name, dbType: 'BASE TABLE' })),
                views: views
                  .filter((e) => e.type === 'dir')
                  .map((e) => ({ schema, name: e.name, dbType: 'VIEW' })),
              })),
            ),
          ),
        ).pipe(
          map((perSchema) => ({
            tables: perSchema
              .flatMap((r) => r.tables)
              .sort((a, b) => a.name.localeCompare(b.name)),
            views: perSchema
              .flatMap((r) => r.views)
              .sort((a, b) => a.name.localeCompare(b.name)),
          })),
        );
      }),
    );
  }

  // ---------------------------------------------------------------------
  // Entities
  // ---------------------------------------------------------------------

  /** `entities/<id>/` directory names — the full entity list (deliberately not
   * `entities/entities-summary.json`, which only annotates a *subset* of entities
   * with a `note`, per demo-project-1: 2 of this project's 8 real entity folders). */
  public listEntityIds(projectId: string): Observable<string[]> {
    return this.listDirectory(projectId, 'entities').pipe(
      map((entries) =>
        entries.filter((e) => e.type === 'dir').map((e) => e.name),
      ),
    );
  }

  /** One entity's full definition — `entities/<id>/<id>.entity.json`
   * (mirrors `entity.service.ts`'s pre-existing `getEntityFromGithub`, now
   * routed through this shared reader instead of its own ad hoc URL/split
   * that silently ignored a project id's `@folder` segment). */
  public getEntity(
    projectId: string,
    entityId: string,
  ): Observable<IGithubEntityFile> {
    return this.getRawJson<IGithubEntityFile>(
      projectId,
      `entities/${entityId}/${entityId}.entity.json`,
    ).pipe(map((data) => data || { id: entityId, fields: [] }));
  }

  // ---------------------------------------------------------------------
  // Boards
  // ---------------------------------------------------------------------

  public getBoard(
    projectId: string,
    boardId: string,
  ): Observable<IGithubBoardFile & { id: string }> {
    return this.getRawJson<IGithubBoardFile>(
      projectId,
      `boards/${boardId}/board.json`,
    ).pipe(map((file) => ({ id: boardId, title: boardId, ...file })));
  }

  // ---------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------

  /** File-name suffixes this reader recognizes as a query DEFINITION file
   * (as opposed to a sidecar body file like `.sql`/`.dtql`/`.http`, or a
   * body file that happens to share a definition's own stem, e.g. the
   * legacy `<id>.sql` next to `<id>.sql.json`). Deliberately wider than
   * datatug-cli's own `all_queries`/`get_query` (which only recognize
   * `.query.json` — `pkg/api/query_id.go`'s `QueryFileSuffix`): this
   * project's `albums`/`artists`/`tracks` folders only have the legacy
   * `<id>.sql.json` shape, and the founder's own ruling names all six
   * query folders (including those three) as pages that must load. */
  private static isQueryDefFile(name: string): boolean {
    return name.endsWith('.query.json') || name.endsWith('.sql.json');
  }

  /** Derives a definition file's own bare id from its name —
   * `<id>.query.json` -> `<id>`; `<id>.sql.json` -> `<id>` — see this
   * file's own tests for the exact filenames this was reverse-engineered
   * from (demo-project-1's real `queries/` tree). */
  private static defFileBareId(name: string): string {
    if (name.endsWith('.query.json')) {
      return name.slice(0, -'.query.json'.length);
    }
    return name.slice(0, -'.sql.json'.length);
  }

  /** The sidecar BODY file for one definition file — `<id>.query.json` ->
   * `<id>.query.<ext>` (ext from `type`: sql/dtql/http); `<id>.sql.json` ->
   * `<id>.sql` (the def filename itself, minus only the trailing `.json` —
   * the legacy convention already spells the body's own extension into its
   * "sql" segment). */
  private static bodyFileNameFor(defFileName: string, type: string): string {
    if (defFileName.endsWith('.sql.json')) {
      return defFileName.slice(0, -'.json'.length);
    }
    const stem = defFileName.slice(0, -'.json'.length);
    const ext = type === 'HTTP' ? 'http' : type === 'DTQL' ? 'dtql' : 'sql';
    return `${stem}.${ext}`;
  }

  /** The full, recursively-nested query folder tree under `queries/` — one
   * `IGithubWireQueryFolder` per subfolder (a query directly under `queries/`,
   * with no subfolder, lands under the root `"~"` folder's own `items`).
   * Every item's `text` (the query body) is deliberately left unset here —
   * matching datatug-cli's own `all_queries` (queries.service.ts's own doc
   * comment: "text is absent from all_queries' own response") — so this one
   * call stays cheap (one raw fetch per DEFINITION file only, no body
   * fetches) and the query PAGE ({@link getQuery}) remains the only place a
   * body is ever read. */
  public getQueriesFolder(
    projectId: string,
  ): Observable<IGithubWireQueryFolder> {
    return this.listDirectory(projectId, 'queries').pipe(
      switchMap((entries) => {
        const subfolders = entries
          .filter((e) => e.type === 'dir')
          .map((e) => e.name);
        const rootItemFiles = entries
          .filter(
            (e) => e.type === 'file' && GithubProjectReaderService.isQueryDefFile(e.name),
          )
          .map((e) => e.name);

        const rootItems$ = this.loadQueryItems(projectId, '', rootItemFiles);
        const folders$: Observable<IGithubWireQueryFolder[]> = subfolders.length
          ? forkJoin(
              subfolders.map((folderName) =>
                this.listDirectory(projectId, `queries/${folderName}`).pipe(
                  switchMap((folderEntries) => {
                    const itemFiles = folderEntries
                      .filter(
                        (e) =>
                          e.type === 'file' &&
                          GithubProjectReaderService.isQueryDefFile(e.name),
                      )
                      .map((e) => e.name);
                    return this.loadQueryItems(projectId, folderName, itemFiles).pipe(
                      map(
                        (items): IGithubWireQueryFolder => ({
                          id: folderName,
                          items: items.length ? items : undefined,
                        }),
                      ),
                    );
                  }),
                ),
              ),
            )
          : of([]);

        return forkJoin([rootItems$, folders$]).pipe(
          map(([rootItems, folders]) => ({
            id: '~',
            folders: folders.length
              ? folders.sort((a, b) => a.id.localeCompare(b.id))
              : undefined,
            items: rootItems.length ? rootItems : undefined,
          })),
        );
      }),
    );
  }

  private loadQueryItems(
    projectId: string,
    folderName: string,
    defFileNames: string[],
  ): Observable<IGithubWireQueryItem[]> {
    if (!defFileNames.length) {
      return of([]);
    }
    return forkJoin(
      defFileNames.map((fileName) => {
        const relPath = folderName
          ? `queries/${folderName}/${fileName}`
          : `queries/${fileName}`;
        return this.getRawJson<IGithubWireQueryItem>(projectId, relPath).pipe(
          map((def): IGithubWireQueryItem => {
            const bareId = GithubProjectReaderService.defFileBareId(fileName);
            return {
              id: def?.id || bareId,
              title: def?.title,
              type: def?.type || 'SQL',
              parameters: def?.parameters,
              recordsets: def?.recordsets,
              dbModel: def?.dbModel,
              draft: def?.draft,
            };
          }),
        );
      }),
    ).pipe(map((items) => items.sort((a, b) => a.id.localeCompare(b.id))));
  }

  /**
   * One query's full definition, body included — `id` may be bare
   * (`"customer-invoices"`) or folder-qualified (`"customers/customer-invoices"`,
   * the same convention `ResolveQueryID`/datatug-cli#219 use). Resolved against
   * the cached tree (no extra `api.github.com` call), then the definition +
   * sidecar body files are fetched from `raw.githubusercontent.com`.
   */
  public getQuery(
    projectId: string,
    id: string,
  ): Observable<IGithubWireQueryItem> {
    return this.getTree(projectId).pipe(
      switchMap((tree) => {
        const { folder } = parseGithubProjectId(projectId);
        const queriesPrefix = `${folder}/queries/`;
        const wantsFolder = id.includes('/');
        const wantFolderName = wantsFolder ? id.slice(0, id.lastIndexOf('/')) : '';
        const wantBareId = wantsFolder ? id.slice(id.lastIndexOf('/') + 1) : id;

        const match = tree.find((e) => {
          if (e.type !== 'blob' || !e.path.startsWith(queriesPrefix)) {
            return false;
          }
          const relFromQueries = e.path.slice(queriesPrefix.length);
          const slashIdx = relFromQueries.indexOf('/');
          const folderName = slashIdx === -1 ? '' : relFromQueries.slice(0, slashIdx);
          const fileName = slashIdx === -1 ? relFromQueries : relFromQueries.slice(slashIdx + 1);
          if (!GithubProjectReaderService.isQueryDefFile(fileName)) {
            return false;
          }
          const bareId = GithubProjectReaderService.defFileBareId(fileName);
          return wantsFolder
            ? folderName === wantFolderName && bareId === wantBareId
            : bareId === wantBareId;
        });

        if (!match) {
          return throwError(
            () => new Error(`Query not found in GitHub project: ${id}`),
          );
        }

        const relFromQueries = match.path.slice(queriesPrefix.length);
        const slashIdx = relFromQueries.indexOf('/');
        const folderName = slashIdx === -1 ? '' : relFromQueries.slice(0, slashIdx);
        const fileName = slashIdx === -1 ? relFromQueries : relFromQueries.slice(slashIdx + 1);
        const defRelPath = folderName
          ? `queries/${folderName}/${fileName}`
          : `queries/${fileName}`;

        return this.getRawJson<IGithubWireQueryItem>(projectId, defRelPath).pipe(
          switchMap((def) => {
            const bareId = GithubProjectReaderService.defFileBareId(fileName);
            const type = def?.type || 'SQL';
            const bodyFileName = GithubProjectReaderService.bodyFileNameFor(
              fileName,
              type,
            );
            const bodyRelPath = folderName
              ? `queries/${folderName}/${bodyFileName}`
              : `queries/${bodyFileName}`;
            return this.getRawText(projectId, bodyRelPath).pipe(
              map(
                (text): IGithubWireQueryItem => ({
                  id: def?.id || bareId,
                  title: def?.title,
                  type,
                  text,
                  parameters: def?.parameters,
                  recordsets: def?.recordsets,
                  dbModel: def?.dbModel,
                  draft: def?.draft,
                }),
              ),
            );
          }),
        );
      }),
    );
  }
}
