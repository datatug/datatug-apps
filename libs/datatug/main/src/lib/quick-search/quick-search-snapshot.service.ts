import { QuickSearchApiService } from './quick-search-api.service';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, take, filter, timeout } from 'rxjs';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import {
  formatGithubProjectId,
  readGithubProjectId,
} from '@datatug/project-address';
import {
  SchemaIndexModel,
  inlineSchemaModel,
  schemaTableMetadata,
} from './quick-search-schema-metadata';
import { IProjectRef, isSharedProjectRef } from '../core/project-context';
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

/** Pure projection: deliberately never spreads definitions, SQL, configuration or rows. */
export function schemaDocuments(
  models: readonly SchemaIndexModel[],
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
  /** Read-only public fallback for one exact Check. Private scopes always use authenticated preview. */
  async publicCheckMetadata(
    ref: IProjectRef,
    objectId: string,
    isCurrent: () => boolean = () => true,
  ): Promise<SearchDocument | undefined> {
    const assertCurrent = () => {
      if (!isCurrent()) throw new Error('Check metadata request changed');
    };
    assertCurrent();
    if (
      !['github', 'github.com'].includes(ref.storeId) ||
      ref.projectApi ||
      ref.spaceID ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(objectId)
    )
      throw new Error('Unsupported check metadata scope');
    const address = readGithubProjectId(ref.projectId);
    if (
      !address.ok ||
      (ref.branch && address.id.ref && ref.branch !== address.id.ref)
    )
      throw new Error('Invalid project branch');
    const pinned = {
      ...ref,
      projectId: formatGithubProjectId({
        ...address.id,
        ...(ref.branch ? { ref: ref.branch } : {}),
      }),
    };
    const publicAccess = async () => {
      assertCurrent();
      const status = await firstValueFrom(
        this.quickSearch.status(ref).pipe(timeout(15000)),
      );
      assertCurrent();
      if (!status.eligible || status.audience !== 'public')
        throw new Error('Public metadata unavailable');
    };
    await publicAccess();
    const initial = await firstValueFrom(
      this.github.readInfo(pinned.projectId),
    );
    assertCurrent();
    if (!initial.commit || !/^[a-f0-9]{40}$/i.test(initial.commit))
      throw new Error('Pinned check metadata unavailable');
    const epoch = this.github.visitEpoch(pinned.projectId);
    const raw = await firstValueFrom(
      this.github
        .getRawJson<{
          id?: string;
          title?: string;
          tags?: string[];
        }>(pinned.projectId, `checks/${objectId}.json`)
        .pipe(timeout(15000)),
    );
    assertCurrent();
    const final = await firstValueFrom(this.github.readInfo(pinned.projectId));
    assertCurrent();
    await publicAccess();
    if (
      epoch !== this.github.visitEpoch(pinned.projectId) ||
      initial.commit !== final.commit
    )
      throw new Error('Project metadata changed during read');
    if (raw === undefined || raw === null) return undefined;
    if (
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      (raw.id !== undefined && raw.id !== objectId) ||
      (raw.title !== undefined && typeof raw.title !== 'string') ||
      ('tags' in raw &&
        (!Array.isArray(raw.tags) ||
          raw.tags.some((tag) => typeof tag !== 'string')))
    )
      throw new Error('Invalid check metadata');
    return {
      kind: 'check',
      id: objectId,
      name: raw.title || objectId,
      tags: metadataTags(raw),
      reference: { objectId },
    };
  }
  async preview(
    ref: IProjectRef,
    environmentId?: string,
  ): Promise<SearchSnapshot> {
    // One authorized immutable server snapshot; never mix private cloud metadata
    // with cached summaries, browser GitHub reads, or a second reader's commit.
    if (
      ref.storeId === 'firestore' &&
      ref.spaceID !== undefined &&
      !isSharedProjectRef(ref)
    )
      throw new Error('Invalid project scope');
    if (
      isSharedProjectRef(ref) ||
      (ref.projectApi === 'cloud' &&
        ['github', 'github.com'].includes(ref.storeId))
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
    const github =
      ['github', 'github.com'].includes(ref.storeId) && !ref.projectApi;
    const initialRead = github
      ? await firstValueFrom(this.github.readInfo(ref.projectId))
      : undefined;
    const epoch = github ? this.github.visitEpoch(ref.projectId) : undefined;
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
    if (github) {
      const finalRead = await firstValueFrom(
        this.github.readInfo(ref.projectId),
      );
      if (
        epoch !== this.github.visitEpoch(ref.projectId) ||
        initialRead?.commit !== finalRead.commit
      )
        throw new Error('Project metadata changed during preview');
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
  private async githubModels(ref: IProjectRef): Promise<SchemaIndexModel[]> {
    const directory = (path: string) =>
      firstValueFrom(
        this.github.listDirectory(ref.projectId, path, {
          requireComplete: true,
        }),
      );
    const raw = (path: string) =>
      firstValueFrom(this.github.getRawJson<unknown>(ref.projectId, path));
    const entries = await directory('dbmodels');
    const candidates = new Map<
      string,
      {
        inline: SchemaIndexModel[];
        split?: SchemaIndexModel;
        descriptor: boolean;
      }
    >();
    const candidate = (id: string) => {
      if (!id || id.includes('/')) throw new Error('Invalid model identity');
      let value = candidates.get(id);
      if (!value) {
        value = { inline: [], descriptor: false };
        candidates.set(id, value);
      }
      return value;
    };
    const inline = async (id: string, path: string) => {
      const model = inlineSchemaModel(await raw(path), id),
        value = candidate(id);
      if (model) value.inline.push(model);
      else value.descriptor = true;
    };
    for (const entry of entries) {
      if (entry.type === 'file' && entry.name.endsWith('.dbmodel.json'))
        await inline(entry.name.slice(0, -13), `dbmodels/${entry.name}`);
      if (entry.type !== 'dir') continue;
      const value = candidate(entry.name),
        children = await directory(`dbmodels/${entry.name}`);
      for (const child of children.filter(
        (c) => c.type === 'file' && c.name.endsWith('.dbmodel.json'),
      )) {
        if (child.name !== entry.name + '.dbmodel.json')
          throw new Error('Conflicting model filename');
        await inline(entry.name, `dbmodels/${entry.name}/${child.name}`);
      }
      const schemas = children.filter((c) => c.type === 'dir');
      if (schemas.length) {
        const model: SchemaIndexModel = { id: entry.name, schemas: [] };
        for (const schema of schemas) {
          const inventory = await directory(
            `dbmodels/${entry.name}/${schema.name}`,
          );
          if (
            !inventory.some(
              (item) =>
                item.type === 'dir' && ['tables', 'views'].includes(item.name),
            )
          )
            throw new Error('Schema inventory unavailable');
          const target = {
            id: schema.name,
            tables: [] as NonNullable<
              NonNullable<SchemaIndexModel['schemas']>[number]['tables']
            >,
            views: [] as NonNullable<
              NonNullable<SchemaIndexModel['schemas']>[number]['views']
            >,
          };
          for (const category of ['tables', 'views'] as const) {
            for (const table of await directory(
              `dbmodels/${entry.name}/${schema.name}/${category}`,
            )) {
              if (table.type === 'file' && table.name === '.gitkeep') continue;
              if (table.type !== 'dir')
                throw new Error('Unsupported schema inventory');
              const path = `dbmodels/${entry.name}/${schema.name}/${category}/${table.name}/${schema.name}.${table.name}.columns.json`;
              target[category].push(
                schemaTableMetadata(table.name, await raw(path)),
              );
            }
          }
          model.schemas?.push(target);
        }
        value.split = model;
      }
    }
    const models: SchemaIndexModel[] = [];
    const canonical = (model: SchemaIndexModel, split = false) => ({
      schemas: (model.schemas || []).map((s) => s.id).sort(),
      documents: schemaDocuments([model])
        .map((d) => ({ ...d, ...(split ? { sourceName: model.id } : {}) }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
    for (const value of candidates.values()) {
      if (value.descriptor && !value.split)
        throw new Error('Schema descriptor has no complete split inventory');
      const chosen = value.split || value.inline[0];
      if (!chosen) throw new Error('Schema inventory unavailable');
      const expected = JSON.stringify(canonical(chosen, !!value.split));
      for (const model of value.inline)
        if (JSON.stringify(canonical(model, !!value.split)) !== expected)
          throw new Error('Conflicting schema representations');
      models.push(chosen);
    }
    return models;
  }
}
