import type { Board } from '@datatug/board-models';
import type { IEntity } from '../models/definition/metapedia/entity';
import type { IParameterDef } from '../models/definition/parameter';
import type { IRecordsetDef } from '../models/definition/recordset';
import { semanticQueryHash } from '../queries/semantic-mapping';
import { parseMeaningDocument } from '../queries/public-data/representation-discovery';
import {
  array,
  object,
  string,
  exactFields,
  type MetadataObject,
} from '../queries/public-data/canonical-metadata';
import {
  boardMeaningQueryIds,
  type LocatedMeaningQuery,
} from './project-meanings';
import type {
  MeaningEntity,
  MeaningField,
  MeaningResource,
  MeaningSource,
  ProjectMeaningsCatalog,
} from './project-meanings-contract';

export interface RepositoryMeaningFile {
  readonly path: string;
  readonly text: string;
}
export interface MeaningRepository {
  readonly repository: string;
  readonly revision: string;
  readonly files: readonly RepositoryMeaningFile[];
}
export interface MeaningDiscoveryInput {
  readonly catalog: ProjectMeaningsCatalog;
  readonly own: MeaningRepository;
  readonly projectFolder: string;
  readonly legacy: readonly IEntity[];
  readonly legacyPaths?: Readonly<Record<string, string>>;
  readonly queries: readonly LocatedMeaningQuery[];
  readonly boards: readonly Board[];
  readonly uses?: unknown;
  readonly databases?: readonly {
    environment: string;
    id: string;
    driver?: string;
    host?: string;
    port?: number;
  }[];
  readonly readLegacy?: (
    url: string,
  ) => Promise<{ source: MeaningSource; definition: IEntity }>;
  readonly readRepository: (
    repository: string,
    revision: string,
  ) => Promise<MeaningRepository>;
  readonly queryBody: (location: string) => Promise<{
    type: string;
    text: string;
    connectionId?: string;
    federation?: unknown;
  }>;
}
interface Concept {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly description: string;
  readonly source: MeaningSource;
  readonly raw: MetadataObject;
  readonly repository: MeaningRepository;
}
const key = (value: Concept) =>
  JSON.stringify([value.source.repository, value.source.revision, value.id]);
const nativeDoc = (source: MeaningSource) =>
  `meaning:${JSON.stringify([source.repository, source.revision])}`;
const safeId = (value: unknown): string => {
  const id = string(value, 'meaning concept id');
  if (!/^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/.test(id) || id.length > 80)
    throw new Error('Invalid native meaning concept ID.');
  return id;
};
const resourceKey = (value: MeaningResource) =>
  JSON.stringify([value.kind, value.id, value.environment]);
const uniqueResources = (
  values: readonly MeaningResource[],
): MeaningResource[] => [
  ...new Map(values.map((value) => [resourceKey(value), value])).values(),
];
function related(
  location: string,
  title: string,
  input: MeaningDiscoveryInput,
): MeaningResource[] {
  const targets =
    (
      input.queries.find((query) => query.location === location)?.query as {
        targets?: readonly {
          catalog?: string;
          driver?: string;
          host?: string;
          port?: number;
          environment?: string;
        }[];
      }
    )?.targets ?? [];
  return uniqueResources([
    { kind: 'query', id: location, title },
    ...(input.databases ?? [])
      .filter((database) =>
        targets.some(
          (target) =>
            !!target.driver &&
            !!target.host &&
            target.catalog === database.id &&
            target.driver === database.driver &&
            target.host === database.host &&
            target.port === database.port &&
            target.environment === database.environment,
        ),
      )
      .map((database) => ({
        kind: 'database' as const,
        id: database.id,
        environment: database.environment,
        title: database.id,
      })),
    ...input.boards
      .filter((board) => boardMeaningQueryIds(board).has(location))
      .map((board) => ({
        kind: 'board' as const,
        id: board.id,
        title: board.title || board.id,
      })),
  ]);
}
function queryMeta(
  query: LocatedMeaningQuery,
): readonly { entity?: string; field?: string }[] {
  const value = query.query as {
    parameters?: readonly IParameterDef[];
    recordsets?: readonly IRecordsetDef[];
  };
  return [
    ...(value.parameters ?? []).map((parameter) => parameter.meta),
    ...(value.recordsets ?? []).flatMap((recordset) =>
      recordset.columns.map((column) => column.meta),
    ),
  ].filter((value) => !!value);
}
/** Project entity declarations keep their own identity; only explicit metadata associates resources. */
export function legacyRepositoryMeanings(
  input: MeaningDiscoveryInput,
  notices: Set<string>,
): MeaningEntity[] {
  const definitions = new Map(
      input.legacy.map((entity) => [entity.id, entity]),
    ),
    index = new Map<string, Map<string, MeaningResource>>();
  let conceptCount = 0,
    metaCount = 0,
    associations = 0;
  for (const entity of input.legacy) {
    conceptCount += 1 + (entity.fields?.length ?? 0);
    if (conceptCount > 4096)
      throw new Error(
        'Project meaning declarations exceed their concept bound.',
      );
  }
  for (const query of input.queries) {
    const linked = related(
      query.location,
      query.query.title || query.location,
      input,
    );
    for (const meta of queryMeta(query)) {
      if (++metaCount > 20000)
        throw new Error('Project meaning metadata exceeds its work bound.');
      const entity = meta.entity ? definitions.get(meta.entity) : undefined;
      if (
        !entity ||
        (meta.field && !entity.fields?.some((field) => field.id === meta.field))
      ) {
        notices.add(
          'Some query entity or field references have no declared project definition. Their missing definitions were not invented.',
        );
        continue;
      }
      for (const field of [undefined, meta.field]) {
        const identity = JSON.stringify([meta.entity, field]),
          resources = index.get(identity) ?? new Map<string, MeaningResource>();
        for (const resource of linked)
          if (!resources.has(resourceKey(resource))) {
            if (++associations > 20000)
              throw new Error(
                'Project meaning associations exceed their capacity bound.',
              );
            resources.set(resourceKey(resource), resource);
          }
        index.set(identity, resources);
      }
    }
  }
  return input.legacy.flatMap((entity) => {
    const id = entity.id;
    if (!id) {
      notices.add('A project entity declaration has no identity.');
      return [];
    }
    const path = input.legacyPaths?.[id];
    const source: MeaningSource = {
      repository: input.own.repository,
      revision: input.own.revision,
      ...(path ? { path } : {}),
      kind: 'project',
    };
    const documentId = `legacy:${JSON.stringify([input.own.repository, input.own.revision, input.projectFolder, id])}`;
    const forField = (field?: string) => [
      ...(index.get(JSON.stringify([id, field]))?.values() ?? []),
    ];
    return [
      {
        documentId,
        conceptId: id,
        name: entity.title || id,
        description: 'Declared project entity mapping.',
        origin: 'repository' as const,
        conceptKind: 'entity',
        source,
        resources: forField(),
        fields: (entity.fields ?? []).map((field) => ({
          documentId,
          conceptId: field.id,
          name: field.id,
          description: `Declared ${field.type} field.`,
          conceptKind: 'attribute',
          source,
          resources: forField(field.id),
        })),
      },
    ];
  });
}

/** Read-only native closure. Addresses, revisions and files establish identity; labels never do. */
export async function enrichRepositoryMeanings(
  input: MeaningDiscoveryInput,
): Promise<ProjectMeaningsCatalog> {
  const notices = new Set(input.catalog.notices ?? []),
    concepts = new Map<string, Concept>(),
    repos = new Map<string, Promise<Map<string, Concept>>>(),
    selected = new Map<string, Concept>(),
    edges = new Map<string, Concept[]>(),
    owners = new Map<string, Concept>(),
    resources = new Map<string, MeaningResource[]>();
  let graphEdges = 0,
    projectionWork = 0,
    resourceAssociations = 0,
    resourceBytes = 0,
    queryBytes = 0;
  const queryHashes = new Map<string, Promise<string>>();
  const read = async (
    repository: MeaningRepository,
  ): Promise<Map<string, Concept>> => {
    const values = new Map<string, Concept>();
    if (repository.files.length > 64)
      throw new Error('Meaning graph exceeds its file bound.');
    for (const file of repository.files) {
      const value = parseMeaningDocument(file.text);
      if (value['format'] !== 'meaning/draft-1')
        throw new Error('Unsupported native MeaningGraph format.');
      for (const item of array(value['concepts'], 'meaning concepts')) {
        const raw = object(item, 'meaning concept');
        exactFields(raw, [
          'id',
          'kind',
          'labels',
          'description',
          'of',
          'extends',
          'values-of',
          'units-of',
          'measure',
        ]);
        const id = safeId(raw['id']),
          kind = string(raw['kind'], 'meaning kind'),
          name = string(
            object(raw['labels'], 'meaning labels')['en'],
            'meaning label',
          ),
          description = string(raw['description'], 'meaning description');
        if (!['entity', 'attribute', 'measure', 'dimension'].includes(kind))
          throw new Error('Unsupported native meaning kind.');
        if (values.has(id))
          throw new Error(
            `Ambiguous meaning ID ${id} in ${repository.repository}.`,
          );
        const source: MeaningSource = {
          repository: repository.repository,
          revision: repository.revision,
          path: file.path,
          kind:
            repository.repository === input.own.repository
              ? 'project'
              : repository.repository === 'https://github.com/meaninggraph/core'
                ? 'core'
                : 'custom',
        };
        const concept = {
          id,
          kind,
          name,
          description,
          source,
          raw,
          repository,
        };
        values.set(id, concept);
        concepts.set(key(concept), concept);
        if (concepts.size > 4096)
          throw new Error('Meaning discovery exceeds its concept bound.');
      }
    }
    return values;
  };
  repos.set(
    JSON.stringify([input.own.repository, input.own.revision]),
    read(input.own),
  );
  const pins = new Map<string, string>();
  const resolve = async (
    reference: unknown,
    owner: MeaningRepository,
  ): Promise<Concept> => {
    const text = string(reference, 'meaning reference');
    let repository = owner.repository,
      revision = owner.revision,
      id = text;
    if (text.startsWith('meaning://')) {
      const match =
        /^meaning:\/\/github\.com\/([a-z0-9_.-]+\/[a-z0-9_.-]+)\/([a-z][a-z0-9-]*)(?:\?ref=([a-f0-9]{40}))?$/.exec(
          text,
        );
      if (!match)
        throw new Error('Unsupported or unpinned MeaningGraph address.');
      repository = `https://github.com/${match[1]}`;
      id = match[2];
      if (repository === owner.repository) {
        if (match[3])
          throw new Error('A native self-reference cannot carry a revision.');
      } else {
        if (!match[3])
          throw new Error('External meanings require a full immutable commit.');
        revision = match[3];
        const pinKey = JSON.stringify([
          owner.repository,
          owner.revision,
          repository,
        ]);
        if (pins.has(pinKey) && pins.get(pinKey) !== revision)
          throw new Error(
            'Conflicting revisions for the same borrowed meaning repository.',
          );
        pins.set(pinKey, revision);
      }
    }
    safeId(id);
    const identity = JSON.stringify([repository, revision]);
    let loaded = repos.get(identity);
    if (!loaded) {
      if (repos.size >= 8)
        throw new Error('Meaning graph exceeds its repository bound.');
      loaded = input.readRepository(repository, revision).then(read);
      repos.set(identity, loaded);
    }
    const concept = (await loaded).get(id);
    if (!concept)
      throw new Error(
        `Unresolved meaning ${id} in ${repository}@${revision.slice(0, 7)}.`,
      );
    return concept;
  };
  const visit = async (
    concept: Concept,
    ancestry: readonly string[] = [],
  ): Promise<void> => {
    const identity = key(concept);
    if (ancestry.includes(identity) || ancestry.length > 24)
      throw new Error(
        'Meaning references contain a cycle or exceed their depth bound.',
      );
    if (selected.has(identity)) return;
    selected.set(identity, concept);
    if (concept.raw['of'])
      owners.set(
        identity,
        await resolve(concept.raw['of'], concept.repository),
      );
    const references: unknown[] = [];
    for (const name of ['extends', 'of', 'values-of', 'units-of'])
      if (concept.raw[name]) references.push(concept.raw[name]);
    if (concept.raw['measure'])
      references.push(
        ...array(
          object(concept.raw['measure'], 'meaning measure')['inputs'] ?? [],
          'meaning measure inputs',
        ),
        ...array(
          object(concept.raw['measure'], 'meaning measure')['dimensions'] ?? [],
          'meaning measure dimensions',
        ),
      );
    const targets: Concept[] = [];
    for (const reference of references) {
      if (++graphEdges > 8192)
        throw new Error('Meaning discovery exceeds its reference work bound.');
      const target = await resolve(reference, concept.repository);
      targets.push(target);
      await visit(target, [...ancestry, identity]);
    }
    edges.set(identity, targets);
  };
  try {
    for (const concept of (
      await required(
        repos.get(JSON.stringify([input.own.repository, input.own.revision])),
      )
    ).values()) {
      try {
        await visit(concept);
      } catch (error) {
        notices.add((error as Error).message);
      }
    }
  } catch (error) {
    notices.add((error as Error).message);
  }
  try {
    if (input.uses !== undefined) {
      const document = object(input.uses, 'meaning uses');
      if (
        document['version'] !== 1 ||
        Object.keys(document).some(
          (name) => !['version', 'bindings'].includes(name),
        )
      )
        throw new Error('Unsupported project meaning uses document.');
      const bindings = array(document['bindings'], 'meaning uses');
      if (bindings.length > 1000)
        throw new Error('Meaning uses exceed their read bound.');
      for (const value of bindings)
        try {
          const binding = object(value, 'meaning use');
          if (
            Object.keys(binding).some(
              (name) =>
                ![
                  'query',
                  'queryHash',
                  'parameter',
                  'column',
                  'meaning',
                ].includes(name),
            )
          )
            throw new Error('Unsupported project meaning use.');
          if (
            (binding['parameter'] !== undefined) ===
            (binding['column'] !== undefined)
          )
            throw new Error('A meaning use requires one parameter or column.');
          const location = string(binding['query'], 'meaning query'),
            query = input.queries.find((query) => query.location === location);
          if (!query)
            throw new Error(
              `Meaning use references missing query ${location}.`,
            );
          let fingerprint = queryHashes.get(location);
          if (!fingerprint) {
            fingerprint = input.queryBody(location).then((full) => {
              queryBytes += new TextEncoder().encode(full.text).length;
              if (queryBytes > 2 * 1024 * 1024)
                throw new Error(
                  'Meaning query bodies exceed their aggregate read bound.',
                );
              return semanticQueryHash(
                full.type,
                full.text,
                full.connectionId,
                full.federation,
              );
            });
            queryHashes.set(location, fingerprint);
          }
          if (binding['queryHash'] !== (await fingerprint))
            throw new Error(
              `Meaning use is stale for query ${location}; its saved query fingerprint changed.`,
            );
          const metadata = query.query as {
            parameters?: readonly IParameterDef[];
            recordsets?: readonly IRecordsetDef[];
          };
          if (binding['parameter'] !== undefined) {
            if (
              !(
                metadata.parameters?.filter(
                  (parameter) => parameter.id === binding['parameter'],
                ).length === 1
              )
            )
              throw new Error(
                `Meaning use references an undeclared parameter in ${location}.`,
              );
          } else {
            const column = object(binding['column'], 'meaning column');
            if (
              Object.keys(column).some(
                (name) => !['recordset', 'name'].includes(name),
              ) ||
              !Number.isSafeInteger(column['recordset']) ||
              (column['recordset'] as number) < 0 ||
              metadata.recordsets?.[
                column['recordset'] as number
              ]?.columns.filter((field) => field.name === column['name'])
                .length !== 1
            )
              throw new Error(
                `Meaning use references an undeclared column in ${location}.`,
              );
          }
          const concept = await resolve(binding['meaning'], input.own);
          await visit(concept);
          const linked = related(
            location,
            query.query.title || location,
            input,
          );
          const propagate = (target: Concept, seen = new Set<string>()) => {
            if (++projectionWork > 25000)
              throw new Error('Meaning associations exceed their work bound.');
            const id = key(target);
            if (seen.has(id)) return;
            seen.add(id);
            const previous = resources.get(id) ?? [],
              known = new Set(previous.map(resourceKey)),
              added = linked.filter(
                (resource) => !known.has(resourceKey(resource)),
              );
            resourceAssociations += added.length;
            resourceBytes += new TextEncoder().encode(
              JSON.stringify(added),
            ).length;
            if (
              previous.length + added.length > 4096 ||
              resourceAssociations > 20000 ||
              resourceBytes > 4 * 1024 * 1024
            )
              throw new Error(
                'Meaning associations exceed their capacity bound.',
              );
            resources.set(id, [...previous, ...added]);
            for (const parent of edges.get(id) ?? []) propagate(parent, seen);
          };
          propagate(concept);
        } catch (error) {
          notices.add((error as Error).message);
        }
    }
  } catch (error) {
    notices.add((error as Error).message);
  }
  const fields = new Map<string, MeaningField[]>(),
    entries: MeaningEntity[] = [];
  for (const concept of selected.values()) {
    const base = {
      documentId: nativeDoc(concept.source),
      conceptId: concept.id,
      name: concept.name,
      description: concept.description,
      conceptKind: concept.kind,
      source: concept.source,
      resources: resources.get(key(concept)) ?? [],
    };
    const parent = owners.get(key(concept));
    if (concept.kind !== 'entity' && parent) {
      const list = fields.get(key(parent)) ?? [];
      list.push(base);
      fields.set(key(parent), list);
    } else
      entries.push({
        ...base,
        origin: concept.source.kind === 'project' ? 'repository' : 'external',
        fields: [],
      });
  }
  const native = entries.map((entity) => ({
    ...entity,
    fields: (
      fields.get(
        JSON.stringify([
          required(entity.source).repository,
          required(entity.source).revision,
          entity.conceptId,
        ]),
      ) ?? []
    ).sort((a, b) => a.name.localeCompare(b.name)),
  }));
  const legacy = legacyRepositoryMeanings(input, notices);
  const inherited = await inheritedLegacyMeanings(input, legacy, notices);
  return {
    ...input.catalog,
    entities: [...input.catalog.entities, ...legacy, ...inherited, ...native],
    referencesComplete: input.catalog.referencesComplete,
    discoveryComplete: notices.size === 0,
    ...(notices.size ? { notices: [...notices] } : {}),
  };
}

/** Only explicit legacy inheritance is followed. Child declarations are never replaced. */
async function inheritedLegacyMeanings(
  input: MeaningDiscoveryInput,
  children: readonly MeaningEntity[],
  notices: Set<string>,
): Promise<MeaningEntity[]> {
  const entries = new Map<string, MeaningEntity>();
  let concepts = children.reduce(
      (count, child) => count + 1 + child.fields.length,
      0,
    ),
    associations = 0;
  const visit = async (
    url: string,
    child: MeaningEntity,
    trail: ReadonlySet<string>,
    depth: number,
  ): Promise<void> => {
    try {
      if (depth > 12 || trail.has(url))
        throw new Error(
          'Legacy meaning inheritance is cyclic or exceeds its depth bound.',
        );
      if (!input.readLegacy)
        throw new Error(
          'A declared external project definition could not be checked for this project source.',
        );
      const { source, definition } = await input.readLegacy(url);
      const documentId = `legacy-file:${JSON.stringify([source.repository, source.revision, source.path])}`;
      if (trail.has(documentId))
        throw new Error('Legacy meaning inheritance is cyclic.');
      let entity = entries.get(documentId);
      if (!entity) {
        if (
          !Array.isArray(definition.fields) ||
          definition.fields.some(
            (field) => typeof field.id !== 'string' || !field.id,
          )
        )
          throw new Error(
            'The external project definition has invalid fields.',
          );
        if (
          new Set(definition.fields.map((field) => field.id)).size !==
          definition.fields.length
        )
          throw new Error(
            'The external project definition has duplicate fields.',
          );
        concepts += 1 + definition.fields.length;
        if (concepts > 4096)
          throw new Error(
            'Legacy meaning inheritance exceeds its concept bound.',
          );
        entity = {
          documentId,
          conceptId: definition.id || 'definition',
          name: definition.title || required(source.path),
          description:
            'External project definition used through declared inheritance.',
          source,
          origin: 'external',
          conceptKind: 'entity',
          resources: [],
          fields: definition.fields.map((field) => ({
            documentId,
            conceptId: field.id,
            name: field.id,
            description: `Declared ${field.type || 'external'} field.`,
            conceptKind: 'attribute',
            source,
            resources: [],
          })),
        };
        entries.set(documentId, entity);
      }
      const combine = (
        previous: readonly MeaningResource[],
        additional: readonly MeaningResource[],
      ) => {
        const merged = uniqueResources([...previous, ...additional]);
        associations += merged.length - previous.length;
        if (merged.length > 4096 || associations > 20000)
          throw new Error(
            'Legacy meaning inheritance exceeds its association bound.',
          );
        return merged;
      };
      const projected = {
        ...entity,
        resources: combine(entity.resources, child.resources),
        fields: entity.fields.map((field) => ({
          ...field,
          resources: combine(
            field.resources,
            child.fields.find(
              (candidate) => candidate.conceptId === field.conceptId,
            )?.resources ?? [],
          ),
        })),
      };
      entries.set(documentId, projected);
      if (definition.extends?.def)
        await visit(
          definition.extends.def,
          projected,
          new Set([...trail, url, documentId]),
          depth + 1,
        );
    } catch (error) {
      notices.add((error as Error).message);
    }
  };
  for (const definition of input.legacy) {
    const child = children.find((entity) => entity.conceptId === definition.id);
    if (child && definition.extends?.def)
      await visit(definition.extends.def, child, new Set(), 0);
  }
  return [...entries.values()];
}

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error('Required meaning declaration is missing.');
  return value;
}
