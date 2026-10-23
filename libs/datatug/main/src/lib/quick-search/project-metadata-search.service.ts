import { inject, Injectable } from '@angular/core';
import {
  Observable,
  ReplaySubject,
  catchError,
  combineLatest,
  defer,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  forkJoin,
  from,
  map,
  mergeMap,
  of,
  shareReplay,
  startWith,
  switchMap,
  take,
  timeout,
  toArray,
} from 'rxjs';
import { SneatAuthStateService } from '@sneat/auth-core';
import { IProjectRef } from '../core/project-context';
import { projectPageHref } from '../nav/project-page-href';
import { IQueryFolder } from '../models/definition/query-def';
import { IProjectSummary } from '../models/definition/project';
import { ProjectService } from '../services/project/project.service';
import { QueriesService } from '../queries/queries.service';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { searchItemHref } from './quick-search-model';
import { schemaTableMetadata } from './quick-search-schema-metadata';
import { metadataTags, schemaDocuments } from './quick-search-snapshot.service';
import { SchemaIndexModel } from './quick-search-schema-metadata';
import {
  MetadataItem,
  fold,
  fromSearchDocument,
  tagHref,
} from './project-metadata-search';

/** One metadata source: still loading, read, or failed (with what it read before failing, if anything). */
export interface MetadataSourceState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly items: readonly MetadataItem[];
  readonly error?: unknown;
}
export interface ProjectMetadataState {
  readonly items: readonly MetadataItem[];
  /** True while any source is still being read. */
  readonly loading: boolean;
  /** The first failure, when a source could not be read; the other sources still answer. */
  readonly error?: unknown;
}

const SOURCE_TIMEOUT_MS = 30_000;
/** Column files are read only for this many tables, so a huge catalog never floods the file host. */
export const MAX_COLUMN_TABLES = 120;

const cacheKey = (ref: IProjectRef) =>
  JSON.stringify([
    ref.storeId,
    ref.projectId,
    ref.spaceID,
    ref.branch,
    ref.projectApi,
  ]);

const isGithub = (ref: IProjectRef) =>
  ['github', 'github.com'].includes(ref.storeId) && !ref.projectApi;

/** Merges per-source states into one searchable list, adding tag items for every tag seen. */
export function mergeSources(
  ref: IProjectRef,
  sources: readonly MetadataSourceState[],
  summaryTags?: Record<string, number>,
): ProjectMetadataState {
  const items = sources.flatMap((s) => s.items);
  const tags = new Map<string, { name: string; count: number }>();
  for (const [name, count] of Object.entries(summaryTags || {}))
    tags.set(fold(name), { name, count });
  for (const item of items)
    for (const name of item.tags) {
      const key = fold(name),
        known = tags.get(key);
      if (!known) tags.set(key, { name, count: 1 });
      else if (!summaryTags) known.count++;
    }
  const tagItems: MetadataItem[] = [...tags.values()].map(
    ({ name, count }) => ({
      kind: 'tag',
      id: name,
      title: name,
      context: count === 1 ? '1 item' : `${count} items`,
      tags: [],
      href: tagHref(ref, name),
    }),
  );
  return {
    items: [...items, ...tagItems],
    loading: sources.some((s) => s.status === 'loading'),
    error: sources.find((s) => s.status === 'error')?.error,
  };
}

export function queryItems(
  ref: IProjectRef,
  folder: IQueryFolder | null | undefined,
  path = '',
): MetadataItem[] {
  if (!folder) return [];
  const here =
    folder.id === '~' || !folder.id
      ? path
      : [path, folder.id].filter(Boolean).join('/');
  return [
    ...(folder.items || []).map((query): MetadataItem => {
      const id =
        query.id.includes('/') || !here ? query.id : `${here}/${query.id}`;
      const description = (query as { purpose?: unknown }).purpose;
      return {
        kind: 'query',
        id,
        title: query.title || id.split('/').pop() || id,
        ...(here ? { context: here } : {}),
        ...(typeof description === 'string' && description
          ? { description }
          : {}),
        tags: metadataTags(query),
        ...(query.request?.queryType
          ? { queryType: query.request.queryType }
          : {}),
        ...(query.createdAt ? { createdAt: query.createdAt } : {}),
        href: searchItemHref(ref, {
          kind: 'query',
          id,
          name: id,
          tags: [],
          reference: {},
        }),
      };
    }),
    ...(folder.folders || []).flatMap((child) => queryItems(ref, child, here)),
  ];
}

export function summaryItems(
  ref: IProjectRef,
  summary: IProjectSummary,
): MetadataItem[] {
  const brief = (
    kind: 'board' | 'entity' | 'database' | 'source',
    page: string,
    list: readonly { id: string; title?: string }[] | undefined,
    context?: (item: { id: string; title?: string }) => string | undefined,
  ): MetadataItem[] =>
    (list || []).map((item) => ({
      kind,
      id: item.id,
      title: item.title || item.id,
      ...(context?.(item) ? { context: context(item) } : {}),
      tags: metadataTags(item),
      href: projectPageHref(ref, [page, item.id]),
    }));
  return [
    ...brief('board', 'board', summary.boards),
    ...brief('entity', 'entity', summary.entities),
    ...brief('database', 'dbmodel', summary.dbModels, (item) => {
      const tables = (summary.dbModels || []).find((m) => m.id === item.id)
        ?.numberOf?.tables;
      return tables === undefined
        ? undefined
        : tables === 1
          ? '1 table'
          : `${tables} tables`;
    }),
    ...brief('source', 'env', summary.environments),
  ];
}

interface CatalogTable {
  readonly dbModel: string;
  readonly schema: string;
  readonly name: string;
  readonly view: boolean;
}

export function tableItem(ref: IProjectRef, t: CatalogTable): MetadataItem {
  return {
    kind: 'table',
    id: [t.dbModel, t.schema, t.name].join('/'),
    title: t.name,
    context: [t.dbModel, t.schema].filter(Boolean).join(' · '),
    tags: [],
    ...(t.view ? { icon: 'eye-outline' } : {}),
    href: searchItemHref(ref, {
      kind: t.view ? 'view' : 'table',
      id: t.name,
      name: t.name,
      tags: [],
      reference: { dbModelId: t.dbModel, schema: t.schema, table: t.name },
    }),
  };
}

const loading: MetadataSourceState = { status: 'loading', items: [] };
const asSource = (items$: Observable<MetadataItem[]>) =>
  items$.pipe(
    map((items): MetadataSourceState => ({ status: 'ready', items })),
    timeout(SOURCE_TIMEOUT_MS),
    catchError((error: unknown) =>
      of<MetadataSourceState>({ status: 'error', items: [], error }),
    ),
    startWith(loading),
  );

/**
 * Reads the project metadata the app already loads for its own pages, through the existing readers (each caches
 * per session, so a second search costs no request). Nothing is uploaded.
 */
@Injectable({ providedIn: 'root' })
export class ProjectMetadataSearchService {
  private readonly projects = inject(ProjectService);
  private readonly queries = inject(QueriesService);
  private readonly github = inject(GithubProjectReaderService);
  private readonly auth = inject(SneatAuthStateService);
  private readonly cache = new Map<string, Observable<ProjectMetadataState>>();
  private viewer?: string;
  private readonly wanted = new Map<string, ReplaySubject<true>>();

  /**
   * The metadata of `ref` as the current viewer may read it. A sign-in, sign-out or account switch drops everything
   * read for the previous viewer and reads again.
   */
  metadata(ref: IProjectRef): Observable<ProjectMetadataState> {
    return this.auth.authState.pipe(
      map((auth) =>
        auth.status === 'authenticating'
          ? undefined
          : JSON.stringify([auth.status, auth.user?.uid]),
      ),
      filter((viewer): viewer is string => viewer !== undefined),
      distinctUntilChanged(),
      switchMap((viewer) => {
        if (viewer !== this.viewer) {
          this.viewer = viewer;
          this.cache.clear();
          this.wanted.clear();
        }
        const key = cacheKey(ref);
        let state = this.cache.get(key);
        if (!state) {
          state = this.read(ref, key).pipe(
            shareReplay({ bufferSize: 1, refCount: true }),
          );
          this.cache.set(key, state);
        }
        return state;
      }),
    );
  }

  /** Starts reading column files for `ref` (once): call it when someone actually searches. */
  includeColumns(ref: IProjectRef): void {
    this.columnsWanted(cacheKey(ref)).next(true);
  }

  private columnsWanted(key: string) {
    let wanted = this.wanted.get(key);
    if (!wanted) {
      wanted = new ReplaySubject<true>(1);
      this.wanted.set(key, wanted);
    }
    return wanted;
  }

  /** Drops what was read for `ref`, so Retry reads again. */
  forget(ref: IProjectRef): void {
    for (const key of this.cache.keys())
      if (key.includes(JSON.stringify(ref.projectId))) this.cache.delete(key);
  }

  private read(
    ref: IProjectRef,
    key: string,
  ): Observable<ProjectMetadataState> {
    const summary$ = this.projects.watchProjectSummary(ref).pipe(
      filter((summary): summary is IProjectSummary => !!summary),
      take(1),
      shareReplay(1),
    );
    const summarySource = asSource(
      summary$.pipe(map((summary) => summaryItems(ref, summary))),
    );
    const querySource = asSource(
      this.queries
        .getQueriesFolder(ref, '~', 'shared')
        .pipe(map((folder) => queryItems(ref, folder))),
    );
    const sources = [summarySource, querySource];
    if (isGithub(ref)) {
      const tables$ = this.githubTables(ref).pipe(shareReplay(1));
      sources.push(
        asSource(
          tables$.pipe(map((tables) => tables.map((t) => tableItem(ref, t)))),
        ),
        // Column files are new reads (one per table), so they start only after the first search.
        this.columnsWanted(key).pipe(
          take(1),
          switchMap(() =>
            asSource(
              tables$.pipe(
                switchMap((tables) => this.githubColumns(ref, tables)),
              ),
            ),
          ),
          startWith<MetadataSourceState>({ status: 'ready', items: [] }),
        ),
      );
    }
    // A local agent serves its catalog (tables and columns) in the full project; no other store does it cheaply.
    if (
      !ref.spaceID &&
      !ref.projectApi &&
      !ref.branch &&
      !['github', 'github.com', 'firestore'].includes(ref.storeId)
    )
      sources.push(
        asSource(
          this.projects.getFull(ref).pipe(
            take(1),
            map((full) =>
              schemaDocuments((full.dbModels || []) as SchemaIndexModel[])
                .map((doc) => fromSearchDocument(ref, doc))
                .filter((item): item is MetadataItem => !!item),
            ),
          ),
        ),
      );
    const tags$ = summary$.pipe(
      map((summary) => summary.tags),
      catchError(() => of(undefined)),
      startWith(undefined),
    );
    return combineLatest([combineLatest(sources), tags$]).pipe(
      map(([states, tags]) => mergeSources(ref, states, tags)),
    );
  }

  /** Table and view names come from the repository listing the reader already holds: no file is read. */
  private githubTables(ref: IProjectRef): Observable<CatalogTable[]> {
    const dir = (path: string) =>
      this.github.listDirectory(ref.projectId, path);
    const dirs = (path: string) =>
      dir(path).pipe(
        map((entries) =>
          entries.filter((e) => e.type === 'dir').map((e) => e.name),
        ),
      );
    return defer(() => dirs('dbmodels')).pipe(
      switchMap((models) =>
        models.length
          ? forkJoin(
              models.map((dbModel) =>
                dirs(`dbmodels/${dbModel}`).pipe(
                  switchMap((schemas) =>
                    schemas.length
                      ? forkJoin(
                          schemas.map((schema) =>
                            forkJoin([
                              dirs(`dbmodels/${dbModel}/${schema}/tables`),
                              dirs(`dbmodels/${dbModel}/${schema}/views`),
                            ]).pipe(
                              map(([tables, views]) => [
                                ...tables.map((name) => ({
                                  dbModel,
                                  schema,
                                  name,
                                  view: false,
                                })),
                                ...views.map((name) => ({
                                  dbModel,
                                  schema,
                                  name,
                                  view: true,
                                })),
                              ]),
                            ),
                          ),
                        ).pipe(map((all) => all.flat()))
                      : of([]),
                  ),
                ),
              ),
            ).pipe(map((all) => all.flat()))
          : of([]),
      ),
    );
  }

  /** Column names from each table's columns file (file host or mirror, not the GitHub API). */
  private githubColumns(
    ref: IProjectRef,
    tables: readonly CatalogTable[],
  ): Observable<MetadataItem[]> {
    return from(tables.slice(0, MAX_COLUMN_TABLES)).pipe(
      mergeMap(async (t) => {
        const category = t.view ? 'views' : 'tables';
        let columns;
        try {
          const raw = await firstValueFrom(
            this.github.getRawJson<unknown>(
              ref.projectId,
              `dbmodels/${t.dbModel}/${t.schema}/${category}/${t.name}/${t.schema}.${t.name}.columns.json`,
            ),
          );
          if (!raw) return [];
          columns = schemaTableMetadata(t.name, raw).Columns || [];
        } catch {
          // One unreadable or malformed file drops that table's columns, never the whole group.
          return [];
        }
        return columns.map(
          (column): MetadataItem => ({
            kind: 'column',
            id: [t.dbModel, t.schema, t.name, column.name].join('/'),
            title: column.name,
            context: `${t.name} · ${t.dbModel}`,
            tags: column.tags || [],
            href: searchItemHref(ref, {
              kind: 'column',
              id: column.name,
              name: column.name,
              tags: [],
              reference: {
                dbModelId: t.dbModel,
                schema: t.schema,
                table: t.name,
                column: column.name,
              },
            }),
          }),
        );
      }, 4),
      toArray(),
      map((all) => all.flat()),
    );
  }
}
