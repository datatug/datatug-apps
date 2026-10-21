import type { Board, BoardWidget } from '@datatug/board-models';
import type { IQueryDef } from '../models/definition/query-def';
import { validateSemanticModel } from '../queries/semantic-mapping';
import { validateProjectMeaningsCatalog } from './project-meanings-contract';
import type { SemanticMeaningScope } from '../queries/semantic-mapping';
import type {
  MeaningEntity,
  MeaningResource,
  ProjectMeaningsCatalog,
} from './project-meanings-contract';

export type MeaningQuery = Pick<IQueryDef, 'id' | 'title' | 'semanticModel'>;
export interface MeaningQueryFolder {
  readonly id: string;
  readonly items?: readonly MeaningQuery[];
  readonly folders?: readonly MeaningQueryFolder[];
}
export interface LocatedMeaningQuery {
  readonly location: string;
  readonly query: MeaningQuery;
}

/** Project-local query locations preserve folder identity; labels never establish identity. */
export function locatedMeaningQueries(
  folder: MeaningQueryFolder,
): LocatedMeaningQuery[] {
  const queries: LocatedMeaningQuery[] = [];
  const seen = new Set<string>();
  const walk = (
    value: MeaningQueryFolder,
    parent: string,
    depth: number,
  ): void => {
    if (depth > 16 || queries.length > 1000)
      throw new Error('The meanings query catalog exceeds its read limit.');
    const path =
      value.id === '~' ? parent : [parent, value.id].filter(Boolean).join('/');
    for (const query of value.items ?? []) {
      const location = [path, query.id].filter(Boolean).join('/');
      if (
        !query.id ||
        location
          .split('/')
          .some((part) => !part || part === '.' || part === '..') ||
        seen.has(location)
      )
        throw new Error(
          'The meanings query catalog contains an invalid query identity.',
        );
      seen.add(location);
      queries.push({ location, query });
    }
    for (const child of value.folders ?? []) walk(child, path, depth + 1);
  };
  walk(folder, '', 0);
  if (queries.length > 1000)
    throw new Error('The meanings query catalog exceeds its read limit.');
  return queries;
}

/** Only typed persisted widget query references establish a dashboard association. */
export function boardMeaningQueryIds(board: Board): ReadonlySet<string> {
  const ids = new Set<string>();
  const walk = (widget: BoardWidget | undefined, depth: number): void => {
    if (
      !widget ||
      depth > 16 ||
      !widget.data ||
      typeof widget.data !== 'object'
    )
      return;
    const data = widget.data as Record<string, unknown>;
    if (widget.name === 'SQL') {
      const sql = data['sql'] as { queryId?: unknown } | undefined;
      if (typeof sql?.queryId === 'string') ids.add(sql.queryId);
    } else if (widget.name === 'chart' && Array.isArray(data['sources'])) {
      for (const source of data['sources'])
        if (source && typeof source.queryId === 'string')
          ids.add(source.queryId);
    } else if (widget.name === 'tabs' && Array.isArray(data['tabs'])) {
      for (const tab of data['tabs'])
        if (tab && typeof tab === 'object') walk(tab.widget, depth + 1);
    }
  };
  for (const row of board.rows ?? [])
    for (const card of row.cards ?? []) walk(card.widget, 0);
  return ids;
}

/** Read-only projection of real saved MeaningGraph definitions; no structural-entity guessing. */
export function projectQueryMeanings(
  queries: readonly LocatedMeaningQuery[],
  boards: readonly Board[],
  scope: SemanticMeaningScope,
): ProjectMeaningsCatalog {
  const entities: MeaningEntity[] = [];
  const dashboardQueries = boards.map((board) => ({
    board,
    ids: boardMeaningQueryIds(board),
  }));
  for (const { location, query } of queries) {
    const model = query.semanticModel;
    if (!model) continue;
    validateSemanticModel(model);
    const resources: MeaningResource[] = [
      { kind: 'query', id: location, title: query.title || location },
      ...dashboardQueries
        .filter((value) => value.ids.has(location))
        .map(({ board }) => ({
          kind: 'board' as const,
          id: board.id,
          title: board.title || board.id,
        })),
    ];
    // Tuple encoding makes query location/document identity unambiguous even when either contains ':'.
    const documentId = `query:${JSON.stringify([location, model.meaning.id])}`;
    for (const entity of model.meaning.concepts.filter(
      (concept) => concept.kind === 'entity',
    )) {
      entities.push({
        documentId,
        conceptId: entity.id,
        name: entity.labels.en,
        description: entity.description,
        origin: 'query',
        resources,
        fields: model.meaning.concepts
          .filter(
            (concept) =>
              concept.kind === 'property' && concept.of === entity.id,
          )
          .map((field) => ({
            documentId,
            conceptId: field.id,
            name: field.labels.en,
            description: field.description,
            resources,
          })),
      });
    }
  }
  return {
    version: 1,
    scope,
    revision: 'public-read-only',
    writable: false,
    referencesComplete: false,
    entities: entities.sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.documentId.localeCompare(b.documentId) ||
        a.conceptId.localeCompare(b.conceptId),
    ),
  };
}

/** Standalone file admission never treats a malformed or unreadable listed file as an empty catalog. */
export function standaloneProjectMeanings(
  value: unknown,
  scope: SemanticMeaningScope,
): readonly MeaningEntity[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('The standalone meanings document is invalid.');
  const file = value as Record<string, unknown>;
  const catalog = {
    scope,
    version: file['version'],
    revision: 'public-read-only',
    writable: false,
    referencesComplete: false,
    entities: file['entities'],
  };
  validateProjectMeaningsCatalog(catalog);
  if (
    catalog.entities.some(
      (entity) =>
        entity.documentId !== 'project' ||
        entity.origin !== 'project' ||
        entity.resources.length ||
        entity.fields.some((field) => field.resources.length),
    )
  )
    throw new Error(
      'The standalone meanings document contains invalid definitions.',
    );
  return catalog.entities;
}

export function mergeStandaloneProjectMeanings(
  catalog: ProjectMeaningsCatalog,
  standalone: readonly MeaningEntity[],
  queries: readonly LocatedMeaningQuery[],
  scope: SemanticMeaningScope,
): ProjectMeaningsCatalog {
  const definitions = structuredClone(standalone) as MeaningEntity[];
  let foreign = false;
  for (const { location, query } of queries) {
    const model = query.semanticModel;
    if (!model) continue;
    const source = catalog.entities.find(
      (entity) =>
        entity.documentId ===
        `query:${JSON.stringify([location, model.meaning.id])}`,
    );
    for (const concept of model.meaning.concepts) {
      const ref = concept.meaningRef;
      if (!ref) continue;
      if (
        ref.scope.storage !== scope.storage ||
        ref.scope.project !== scope.project ||
        ref.scope.spaceID !== scope.spaceID ||
        ref.scope.branch !== scope.branch
      ) {
        foreign = true;
        continue;
      }
      const owner = model.meaning.concepts.find(
        (entity) => entity.id === concept.of,
      )?.meaningRef;
      const entity = definitions.find((entity) =>
        concept.kind === 'entity'
          ? entity.conceptId === ref.conceptId
          : entity.fields.some((field) => field.conceptId === ref.conceptId),
      );
      if (
        !entity ||
        (concept.kind === 'property' &&
          (!owner ||
            owner.scope.storage !== scope.storage ||
            owner.scope.project !== scope.project ||
            owner.scope.spaceID !== scope.spaceID ||
            owner.scope.branch !== scope.branch ||
            owner.conceptId !== entity.conceptId))
      )
        throw new Error(
          'A query references a missing or mismatched project meaning.',
        );
      const resources = source?.resources ?? [];
      const append = (
        target: readonly MeaningResource[],
      ): MeaningResource[] => [
        ...target,
        ...resources.filter(
          (resource) =>
            !target.some(
              (item) =>
                item.kind === resource.kind &&
                item.id === resource.id &&
                item.environment === resource.environment,
            ),
        ),
      ];
      const index = definitions.indexOf(entity);
      definitions[index] = {
        ...entity,
        resources: append(entity.resources),
        fields: entity.fields.map((field) =>
          concept.kind === 'property' && field.conceptId === ref.conceptId
            ? { ...field, resources: append(field.resources) }
            : field,
        ),
      };
    }
  }
  return {
    ...catalog,
    entities: [...definitions, ...catalog.entities].sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.documentId.localeCompare(b.documentId),
    ),
    ...(foreign
      ? {
          notices: [
            'Some query definitions retain a meaning reference to another project scope. Their source identities are preserved; they are not linked to this project’s standalone definitions.',
          ],
        }
      : {}),
  };
}
