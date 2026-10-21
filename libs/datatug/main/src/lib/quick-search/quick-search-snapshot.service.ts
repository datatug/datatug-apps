import { QuickSearchApiService } from './quick-search-api.service';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, take, filter, timeout } from 'rxjs';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import {
  formatGithubProjectId,
  readGithubProjectId,
} from '@datatug/project-address';
import { IColumn } from '../models/definition/apis/database';
import { IProjectRef } from '../core/project-context';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { ProjectService } from '../services/project/project.service';
import { QueriesService } from '../queries/queries.service';
import {
  SearchDocument,
  SearchKind,
  SearchSnapshot,
  searchKinds,
} from './quick-search-model';
import { IQueryFolder } from '../models/definition/query-def';
import { IDbModelFull } from '../models/definition/dbmodels';

/** Pure projection: deliberately never spreads definitions, SQL, configuration or rows. */
export function schemaDocuments(
  models: readonly IDbModelFull[],
): SearchDocument[] {
  const documents: SearchDocument[] = [];
  for (const model of models)
    for (const schema of model.schemas || []) {
      for (const [kind, tables] of [
        ['table', schema.tables],
        ['view', schema.views],
      ] as const)
        for (const table of tables || []) {
          const id = [model.id, schema.id, kind, table.name].join('/');
          const reference = {
            dbModelId: model.id,
            schema: schema.id,
            table: table.name,
          };
          documents.push({
            kind,
            id,
            name: table.name,
            qualifiedName: [schema.id, table.name].filter(Boolean).join('.'),
            sourceName: model.title || model.id,
            tags: metadataTags(table),
            reference,
          });
          for (const column of table.Columns || [])
            documents.push({
              kind: 'column',
              id: id + '/' + column.name,
              name: column.name,
              parentId: id,
              parentName: table.name,
              qualifiedName: [schema.id, table.name, column.name]
                .filter(Boolean)
                .join('.'),
              sourceName: model.title || model.id,
              tags: metadataTags(column),
              reference: { ...reference, column: column.name },
            });
        }
    }
  return documents;
}
export function metadataTags(value: unknown): string[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !('tags' in value) ||
    !Array.isArray(value.tags)
  )
    return [];
  return [
    ...new Set(
      value.tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}
export function queryDocuments(
  folder: IQueryFolder,
  parentPath = '',
): SearchDocument[] {
  const path =
    folder.id === '~'
      ? parentPath
      : [parentPath, folder.id].filter(Boolean).join('/');
  return [
    ...(folder.items || []).map((item) => {
      const id =
        item.id.includes('/') || !path ? item.id : path + '/' + item.id;
      return {
        kind: 'query' as const,
        id,
        name: item.title || id.split('/').pop() || id,
        tags: metadataTags(item),
        reference: { objectId: id.split('/').pop() || id, folder: path || '~' },
      };
    }),
    ...(folder.folders || []).flatMap((child) => queryDocuments(child, path)),
  ];
}
@Injectable({ providedIn: 'root' })
export class QuickSearchSnapshotService {
  private readonly quickSearch = inject(QuickSearchApiService);
  private readonly projects = inject(ProjectService);
  private readonly queries = inject(QueriesService);
  private readonly github = inject(GithubProjectReaderService);
  private readonly projectApi = inject(ProjectQueryApiService);
  async preview(
    ref: IProjectRef,
    environmentId?: string,
  ): Promise<SearchSnapshot> {
    // One authorized immutable server snapshot; never mix private cloud metadata
    // with cached summaries, browser GitHub reads, or a second reader's commit.
    if (
      ref.projectApi === 'cloud' &&
      ['github', 'github.com'].includes(ref.storeId)
    )
      return firstValueFrom(
        this.quickSearch.preview(ref, environmentId).pipe(timeout(15000)),
      );
    if (['github', 'github.com'].includes(ref.storeId) && ref.branch) {
      const address = readGithubProjectId(ref.projectId);
      if (!address.ok || (address.id.ref && address.id.ref !== ref.branch))
        throw new Error('Invalid project branch');
      ref = {
        ...ref,
        projectId: formatGithubProjectId({ ...address.id, ref: ref.branch }),
      };
    }
    const documents: SearchDocument[] = [];
    const complete = new Set<SearchKind>();
    const summary = await firstValueFrom(
      this.projects.watchProjectSummary(ref).pipe(
        filter((value) => !!value),
        take(1),
        timeout(15000),
      ),
    );
    if (!summary) throw new Error('Project metadata is unavailable.');
    for (const [kind, items] of [
      ['dashboard', summary.boards],
      ['entity', summary.entities],
      ['environment', summary.environments],
    ] as const) {
      // Brief inventories identify objects; only their full source owns names/tags.
      if (items && (!ref.spaceID || kind === 'environment' || environmentId)) {
        try {
          const category: SearchDocument[] = [];
          for (const brief of items) {
            let item: { id?: string; title?: string } = brief;
            if (
              ['github', 'github.com'].includes(ref.storeId) &&
              !ref.projectApi
            ) {
              const raw = await firstValueFrom(
                kind === 'dashboard'
                  ? this.github.getBoard(ref.projectId, brief.id, {
                      requireExisting: true,
                    })
                  : this.github.getRawJson<{
                      id?: string;
                      title?: string;
                      tags?: string[];
                    }>(
                      ref.projectId,
                      kind === 'entity'
                        ? `entities/${brief.id}/${brief.id}.entity.json`
                        : `environments/${brief.id}/${brief.id}.env.json`,
                    ),
              );
              if (
                !raw ||
                Array.isArray(raw) ||
                typeof raw !== 'object' ||
                (raw.id !== undefined && raw.id !== brief.id) ||
                (raw.title !== undefined && typeof raw.title !== 'string')
              )
                throw new Error('Object metadata unavailable');
              if (
                'tags' in raw &&
                (!Array.isArray(raw.tags) ||
                  raw.tags.some((tag) => typeof tag !== 'string'))
              )
                throw new Error('Invalid object tags');
              item = raw;
            }
            category.push({
              kind,
              id: brief.id,
              name: item.title || brief.id,
              tags: metadataTags(item),
              reference: {
                objectId: brief.id,
                ...(ref.spaceID && environmentId ? { environmentId } : {}),
                ...(kind === 'environment' ? { environmentId: brief.id } : {}),
              },
            });
          }
          documents.push(...category);
          complete.add(kind);
        } catch {
          // Never publish a partial category or manufacture empty completeness.
        }
      }
    }
    if (summary.tags && ['github', 'github.com'].includes(ref.storeId)) {
      complete.add('tag');
      for (const name of Object.keys(summary.tags))
        documents.push({
          kind: 'tag',
          id: name,
          name,
          tags: [name],
          reference: { objectId: name },
        });
    }
    try {
      const folder = await firstValueFrom(
        (ref.spaceID || ref.projectApi === 'cloud'
          ? this.projectApi.folder<IQueryFolder>(ref)
          : this.queries.getQueriesFolder(ref, '~', 'shared')
        ).pipe(take(1), timeout(15000)),
      );
      if (folder && (!ref.spaceID || environmentId)) {
        documents.push(
          ...queryDocuments(folder).map((item) => ({
            ...item,
            reference: {
              ...item.reference,
              ...(ref.spaceID ? { environmentId } : {}),
            },
          })),
        );
        complete.add('query');
      }
    } catch {
      /* Coverage below exposes the unavailable reader. */
    }
    if (['github', 'github.com'].includes(ref.storeId) && !ref.projectApi) {
      try {
        const models = await this.githubModels(ref);
        documents.push(...schemaDocuments(models));
        for (const kind of ['table', 'column', 'view'] as const)
          complete.add(kind);
      } catch {
        /* A partial schema inventory is never uploaded. */
      }
    }
    if (
      !ref.spaceID &&
      !ref.projectApi &&
      !ref.branch &&
      !['github', 'github.com', 'firestore'].includes(ref.storeId)
    ) {
      try {
        const full = await firstValueFrom(this.projects.getFull(ref));
        if (full.dbModels) {
          documents.push(...schemaDocuments(full.dbModels));
          for (const kind of ['table', 'column', 'view'] as const)
            complete.add(kind);
        }
      } catch {
        /* No SQL or row fallback. */
      }
    }
    return {
      documents,
      sourceCoverage: searchKinds.map((kind) => ({
        kind,
        status: complete.has(kind) ? 'complete' : 'unavailable',
        count: documents.filter((item) => item.kind === kind).length,
      })),
    };
  }
  private async githubModels(ref: IProjectRef): Promise<IDbModelFull[]> {
    // Reader pins all these fixed relative paths to its verified project commit.
    const entries = await firstValueFrom(
      this.github.listDirectory(ref.projectId, 'dbmodels'),
    );
    const models: IDbModelFull[] = [];
    for (const entry of entries.filter((item) => item.type === 'dir')) {
      const schemas = await firstValueFrom(
        this.github.listDirectory(ref.projectId, `dbmodels/${entry.name}`),
      );
      const model: IDbModelFull = { id: entry.name, schemas: [] };
      for (const schema of schemas.filter((item) => item.type === 'dir')) {
        const target = {
          id: schema.name,
          tables: [] as NonNullable<
            NonNullable<IDbModelFull['schemas']>[number]['tables']
          >,
          views: [] as NonNullable<
            NonNullable<IDbModelFull['schemas']>[number]['views']
          >,
        };
        for (const category of ['tables', 'views'] as const) {
          const tables = await firstValueFrom(
            this.github.listDirectory(
              ref.projectId,
              `dbmodels/${entry.name}/${schema.name}/${category}`,
            ),
          );
          for (const table of tables.filter((item) => item.type === 'dir')) {
            const columns = await firstValueFrom(
              this.github.getRawJson<{ columns?: IColumn[]; tags?: string[] }>(
                ref.projectId,
                `dbmodels/${entry.name}/${schema.name}/${category}/${table.name}/${schema.name}.${table.name}.columns.json`,
              ),
            );
            if (!Array.isArray(columns?.columns))
              throw new Error('Schema snapshot unavailable');
            target[category].push({
              name: table.name,
              Columns: columns.columns,
              ...(metadataTags(columns).length
                ? { tags: metadataTags(columns) }
                : {}),
            });
          }
        }
        model.schemas?.push(target);
      }
      models.push(model);
    }
    return models;
  }
}
