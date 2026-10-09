import Ajv2020 from 'ajv/dist/2020';
import schema4 from './representation-contract-4.schema.json';
import profile from './native-graph-profile.json';
import historicalProfile from './native-graph-historical-profile.json';
export const NATIVE_GRAPH_ORIGINAL_DECISION = historicalProfile.decision.document;
export const NATIVE_GRAPH_CURRENT_DECISION = profile.decision.document;
import {
  array,
  immutableUrl,
  object,
  string,
  strictJson,
  type CanonicalIndexes,
  type CanonicalMetadataReader,
  type ImmutableFile,
  type MetadataObject,
} from './canonical-metadata';
import {
  parseMeaningDocument,
  parseRepresentationContracts,
  referenceFile,
  sameSource,
  verifyRepresentationContract,
  type SourceField,
} from './representation-discovery';
import type { VerifiedDeclaredSource } from './declared-source';
import { normalizeModel } from './model-vocabulary';

export const NATIVE_GRAPH_PUBLICATION_BLOCKER =
  'The native organization/location graph awaits canonical graph, collection mapping and runtime admission. Metadata and saved eligibility do not authorize queries.';
export const NATIVE_GRAPH_ID = 'w1-ror-geonames-context/1' as const;
export type NativeStageId =
  | 'organizations'
  | 'locations'
  | 'places'
  | 'countries'
  | 'admin1'
  | 'aliases';
export type NativeProjection =
  | 'exact-string/1'
  | 'ror-positive-int-geonames-decimal/1'
  | 'geonames-country-admin1/1';
export interface NativeGraphSource {
  readonly model: ImmutableFile;
  readonly binding: ImmutableFile;
  readonly snapshot: ImmutableFile;
  readonly dataset: ImmutableFile;
  readonly module: string;
}
export interface NativeGraphStage {
  readonly id: NativeStageId;
  readonly source: 'ror' | 'geo';
  readonly entity: string;
  readonly grain: readonly string[];
}
export interface NativeGraphEdge {
  readonly id: string;
  readonly from: NativeStageId;
  readonly fields: readonly string[];
  readonly to: NativeStageId;
  readonly lookupField: string;
  readonly projection: NativeProjection;
  readonly cardinality: 'zero-or-one' | 'zero-or-many';
  readonly optional?: true;
}
export interface NativeGraph {
  readonly execution: 'native-graph';
  readonly id: typeof NATIVE_GRAPH_ID;
  readonly entry: {
    readonly attachment: ImmutableFile;
    readonly contractIndex: 0;
    readonly decisionScope: string;
    readonly source: Omit<SourceField, 'schema' | 'data'>;
    readonly targetStage: 'organizations';
  };
  readonly decision: {
    readonly document: ImmutableFile;
    readonly scope: string;
  };
  readonly sources: Readonly<Record<'ror' | 'geo', NativeGraphSource>>;
  readonly stages: readonly NativeGraphStage[];
  readonly edges: readonly NativeGraphEdge[];
  readonly resultShape: 'affiliations-location-context-aliases/1';
}
export interface NativeGraphEnvelope {
  readonly format: 'ovdb-representation-contract/4';
  readonly legacy?: { readonly path: string; readonly sha256: string };
  readonly graphs: readonly [NativeGraph];
}
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );
const validateGraphEnvelope = new Ajv2020({
  allErrors: true,
  strict: true,
}).compile(schema4);
const equal = (a: unknown, b: unknown): boolean => stable(a) === stable(b);
function closed(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): MetadataObject {
  const record = object(value, 'closed graph member');
  if (
    required.some((name) => !Object.hasOwn(record, name)) ||
    Object.keys(record).some(
      (name) => !required.includes(name) && !optional.includes(name),
    )
  )
    throw new Error('Unknown or missing native graph member.');
  return record;
}
function file(value: unknown): ImmutableFile {
  const record = closed(value, ['repository', 'revision', 'path', 'sha256']);
  const result = Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, string(value, key)]),
  ) as unknown as ImmutableFile;
  immutableUrl(result);
  return result;
}
/** Finite source-qualified capability. This profile is support, never publication authority. */
export function parseNativeGraphEnvelope(value: unknown): NativeGraphEnvelope {
  return parseKnownNativeGraphEnvelope(value, profile);
}
/** Offline reader only: this does not produce checked execution/admission authority. */
export function parseHistoricalNativeGraphEnvelope(value: unknown): NativeGraphEnvelope {
  try { return parseKnownNativeGraphEnvelope(value, profile); }
  catch { return parseKnownNativeGraphEnvelope(value, historicalProfile); }
}
function parseKnownNativeGraphEnvelope(value: unknown, profile: typeof historicalProfile): NativeGraphEnvelope {
  if (
    typeof value === 'string' &&
    new TextEncoder().encode(value).byteLength > 2 * 1024 * 1024
  )
    throw new Error('Graph attachment exceeds2MiB.');
  const parsed = typeof value === 'string' ? strictJson(value) : value;
  // AJV object-const equality expects ordinary prototypes; strict parsing has already refused duplicate keys.
  const plain: unknown = JSON.parse(JSON.stringify(parsed));
  if (!validateGraphEnvelope(plain))
    throw new Error('Malformed closed format4 graph schema.');
  const doc = closed(plain, ['format', 'graphs'], ['legacy']);
  if (doc['format'] !== 'ovdb-representation-contract/4')
    throw new Error('Unsupported native graph format.');
  if (doc['legacy'] !== undefined) {
    const legacy = closed(doc['legacy'], ['path', 'sha256']);
    immutableUrl({
      repository: profile.sources.geo.model.repository,
      revision: profile.sources.geo.model.revision,
      path: string(legacy['path'], 'legacy path'),
      sha256: string(legacy['sha256'], 'legacy hash'),
    });
  }
  const graphs = array(doc['graphs'], 'graphs');
  if (graphs.length !== 1)
    throw new Error('Exactly one finite graph is supported.');
  const graph = closed(graphs[0], Object.keys(profile));
  for (const name of ['execution', 'id', 'resultShape'] as const)
    if (graph[name] !== profile[name])
      throw new Error('Unknown native graph capability.');
  const entry = closed(graph['entry'], [
    'attachment',
    'contractIndex',
    'decisionScope',
    'source',
    'targetStage',
  ]);
  file(entry['attachment']);
  if (!equal(entry, profile.entry))
    throw new Error('The original ROR entry must remain unchanged.');
  const decision = closed(graph['decision'], ['document', 'scope']);
  file(decision['document']);
  if (!equal(decision, profile.decision))
    throw new Error('The graph decision pin differs from accepted provenance.');
  const sources = closed(graph['sources'], ['ror', 'geo']);
  for (const name of ['ror', 'geo'] as const) {
    const source = closed(sources[name], [
      'model',
      'binding',
      'snapshot',
      'dataset',
      'module',
    ]);
    for (const kind of ['model', 'binding', 'snapshot', 'dataset'] as const)
      file(source[kind]);
    if (!equal(source, profile.sources[name]))
      throw new Error('Unreviewed native source pins are unsupported.');
  }
  for (const name of ['stages', 'edges'] as const) {
    const actual = array(graph[name], name),
      expected = profile[name];
    if (
      new Set(actual.map((item) => object(item, 'graph item')['id'])).size !==
        expected.length ||
      actual.length !== expected.length
    )
      throw new Error('Unknown native graph topology.');
    for (let i = 0; i < expected.length; i++) {
      const match = expected.find(
        (item) => item.id === object(actual[i], 'graph member')['id'],
      );
      if (!match) throw new Error('Unknown native graph member ID.');
      const member = closed(actual[i], Object.keys(match));
      if (!equal(member, match))
        throw new Error(
          'Unknown native graph field, grain, edge or projection.',
        );
    }
  }
  return structuredClone(doc) as unknown as NativeGraphEnvelope;
}
export interface CheckedNativeGraphMetadata {
  readonly envelope: NativeGraphEnvelope;
  readonly attachment: ImmutableFile;
  readonly references: readonly ImmutableFile[];
  readonly bytes: number;
  readonly entrySource: SourceField;
  readonly eligible: false;
  readonly reason: string;
}
/** Resolve one declared entity reference only; never coerce the canonical model. */
function propertyType(
  model: MetadataObject,
  entityName: string,
  field: string,
  referenced = false,
): string {
  const entities = object(model['entities'], 'entities');
  const property = object(
    object(object(entities[entityName], 'entity')['properties'], 'properties')[
      field
    ],
    'property',
  );
  if (property['entity'] !== undefined) {
    if (referenced || property['type'] !== undefined)
      throw new Error('Cyclic or ambiguous model entity reference.');
    const target = string(property['entity'], 'entity reference');
    const keys = array(
      object(entities[target], 'referenced entity')['key'],
      'referenced key',
    );
    if (keys.length !== 1)
      throw new Error('An entity reference needs one native key.');
    const key = string(keys[0], 'native key');
    const targetProperty = object(
      object(object(entities[target], 'entity')['properties'], 'properties')[
        key
      ],
      'key',
    );
    if (targetProperty['required'] !== true)
      throw new Error('Entity reference key is not required.');
    return propertyType(model, target, key, true);
  }
  return string(property['type'], 'property type');
}
/** Dedicated selected-entry metadata operation; reader also owns its canonical-index budget. */
export async function readNativeGraphMetadata(
  attachment: ImmutableFile,
  provider: MetadataObject,
  indexes: CanonicalIndexes,
  reader: CanonicalMetadataReader,
  declared?: VerifiedDeclaredSource,
): Promise<CheckedNativeGraphMetadata> {
  const envelope = parseNativeGraphEnvelope(await reader.json(attachment));
  const graph = envelope.graphs[0],
    refs: ImmutableFile[] = [attachment],
    ancestry = [immutableUrl(attachment)];
  if (envelope.legacy) {
    const legacyFile = referenceFile(envelope.legacy, provider, false);
    if (immutableUrl(legacyFile) === immutableUrl(attachment))
      throw new Error('A graph cannot refer to itself.');
    refs.push(legacyFile);
    const legacy = await reader.json(legacyFile, ancestry);
    for (const contract of parseRepresentationContracts(legacy))
      await verifyRepresentationContract(
        contract,
        provider,
        indexes,
        reader,
        legacyFile,
        declared && sameSource(declared.source, contract.source)
          ? declared
          : undefined,
      );
  }
  const entryFile = graph.entry.attachment;
  refs.push(entryFile);
  const entryDoc = await reader.json(entryFile, ancestry);
  if (
    ![
      'ovdb-representation-contract/2',
      'ovdb-representation-contract/3',
    ].includes(String(entryDoc['format']))
  )
    throw new Error('The graph entry must be one original format2/3 document.');
  const contracts = parseRepresentationContracts(entryDoc),
    entry = contracts[graph.entry.contractIndex];
  if (
    !entry ||
    entry.execution !== 'native-identifier' ||
    !sameSource(
      {
        ...entry.source,
        schema: entry.source.schema as ImmutableFile,
        data: entry.source.data as ImmutableFile | undefined,
      },
      { ...entry.source, ...graph.entry.source },
    ) ||
    entry.decision.scope !== graph.entry.decisionScope ||
    entry.target.entity !== 'organizations' ||
    entry.target.model.sha256 !== graph.sources.ror.model.sha256 ||
    entry.native.dataset.sha256 !== graph.sources.ror.dataset.sha256
  )
    throw new Error('The graph differs from its original native ROR entry.');
  const providers = array(indexes.directory['databases'], 'providers')
    .map((p) => object(p, 'provider'))
    .filter(
      (p) =>
        p['repository'] === entryFile.repository &&
        p['commit'] === entryFile.revision,
    );
  if (providers.length !== 1)
    throw new Error('The exact entry provider is unregistered or ambiguous.');
  await verifyRepresentationContract(
    entry,
    providers[0],
    indexes,
    reader,
    entryFile,
    declared,
  );
  const models = new Map<string, MetadataObject>();
  for (const name of ['ror', 'geo'] as const) {
    const source = graph.sources[name];
    refs.push(source.model, source.binding, source.snapshot);
    const registered = array(indexes.models['models'], 'models')
      .map((m) => object(m, 'model'))
      .filter(
        (m) =>
          m['repository'] === source.model.repository &&
          m['commit'] === source.model.revision &&
          object(m['files'], 'model files')['json'] === source.model.path,
      );
    const meanings = array(indexes.meanings['graphs'], 'meanings')
      .map((m) => object(m, 'meaning'))
      .filter(
        (m) =>
          m['repository'] === source.binding.repository &&
          m['commit'] === source.binding.revision &&
          array(m['meaning_files'], 'meaning files').includes(
            source.binding.path,
          ),
      );
    if (registered.length !== 1 || meanings.length !== 1)
      throw new Error(
        'Graph native model/binding is unregistered or ambiguous.',
      );
    const model = normalizeModel(await reader.json(source.model, ancestry));
    if (
      model['modelspec'] !== '1.0-draft' ||
      object(model['module'], 'module')['name'] !== source.module
    )
      throw new Error('Wrong graph model module.');
    models.set(name, model);
    const binding = parseMeaningDocument(
      await reader.text(source.binding, ancestry),
    );
    if (binding['format'] !== 'meaning/draft-1')
      throw new Error('Unsupported graph meaning format.');
    // These existing canonical files are already pinned by the unchanged ROR entry
    // and Geo legacy bridges. Their bytes cover the two finite inherited concepts.
    const coreFiles: readonly ImmutableFile[] = [
      {
        repository: 'https://github.com/meaninggraph/core',
        revision: '982916d73f0a35ff2558b0062f58aa3ac4f24d97',
        path: 'geo.meaning.yaml',
        sha256:
          'ee6eeea2e8038e016433a72dd15d45b6eaf89d3ae6e45893d4e5eeb7be61f4e9',
      },
      {
        repository: 'https://github.com/meaninggraph/core',
        revision: '982916d73f0a35ff2558b0062f58aa3ac4f24d97',
        path: 'identity.meaning.yaml',
        sha256:
          'b0eb207d1e2e68572a47b4a08d02aa10389e2788c20a9796c812a4fcda894c33',
      },
    ];
    const core = coreFiles[name === 'ror' ? 1 : 0],
      dependencies = array(
        meanings[0]['depends'],
        'graph meaning dependencies',
      ),
      coreRecords = array(indexes.meanings['graphs'], 'core meaning registry')
        .map((m) => object(m, 'core meaning'))
        .filter(
          (m) =>
            m['repository'] === core.repository &&
            m['commit'] === core.revision,
        );
    if (
      coreRecords.length !== 1 ||
      dependencies.length !== 1 ||
      !dependencies.every((item) => {
        const dependency = object(item, 'meaning dependency');
        return (
          dependency['id'] === coreRecords[0]['id'] &&
          dependency['commit'] === core.revision
        );
      })
    )
      throw new Error('Unregistered exact graph meaning dependency.');
    const corePaths = array(
      coreRecords[0]['meaning_files'],
      'core meaning files',
    );
    if (
      !corePaths.some((path) => path === core.path || path === '*.meaning.yaml')
    )
      throw new Error('Unregistered graph core meaning path.');
    refs.push(core);
    const meaning = parseMeaningDocument(
      await reader.text(core, [...ancestry, immutableUrl(source.binding)]),
    );
    const expectedConcept = name === 'ror' ? 'organization' : 'country';
    if (
      meaning['format'] !== 'meaning/draft-1' ||
      !array(meaning['concepts'], 'core concepts').some(
        (item) => object(item, 'core concept')['id'] === expectedConcept,
      )
    )
      throw new Error('Missing finite graph core meaning concept.');
    const expectedAddress = `meaning://github.com/meaninggraph/core/${expectedConcept}?ref=${core.revision}`;
    for (const item of array(binding['concepts'], 'source concepts')) {
      const concept = object(item, 'source concept');
      for (const field of ['extends', 'values-of'] as const) {
        const dependency = concept[field];
        if (
          typeof dependency === 'string' &&
          dependency.startsWith('meaning://') &&
          dependency !== expectedAddress
        )
          throw new Error(
            'An unbounded graph meaning dependency is unsupported.',
          );
      }
    }
    if (
      !array(binding['concepts'], 'source concepts').some(
        (item) => object(item, 'source concept')['extends'] === expectedAddress,
      )
    )
      throw new Error(
        'Graph binding differs from its exact inherited meaning.',
      );
    const snapshot = await reader.json(source.snapshot, ancestry);
    const sqlite = object(snapshot['sqlite'], 'native decoded descriptor');
    if (
      sqlite['path'] !== source.dataset.path ||
      sqlite['decodedSha256'] !== source.dataset.sha256 ||
      !Number.isSafeInteger(sqlite['decodedBytes']) ||
      Number(sqlite['decodedBytes']) <= 0
    )
      throw new Error('Native decoded dataset descriptor mismatch.');
    const artifacts = array(snapshot['artifacts'], 'native artifacts');
    const paths = new Set<string>();
    for (const value of artifacts) {
      const artifact = object(value, 'native artifact');
      const ref = {
        repository: source.model.repository,
        revision: source.model.revision,
        path: string(artifact['path'], 'artifact path'),
        sha256: string(artifact['sha256'], 'artifact hash'),
      };
      immutableUrl(ref);
      if (paths.has(ref.path))
        throw new Error('Duplicate native snapshot artifact.');
      paths.add(ref.path);
      // Finite small proof/provenance documents only. Never traverse source archives or SQLite chunks.
      if (
        [
          'source/validation.json',
          'source/generation-snapshot.json',
          'source/generation-validation.json',
          'source/native-key-evidence.json',
          'DATA-LICENSE.md',
          'ATTRIBUTION.txt',
          'source/ror-v2.13.json',
        ].includes(ref.path)
      ) {
        refs.push(ref);
        await reader.text(ref, [...ancestry, immutableUrl(source.snapshot)]);
      }
    }
    for (const ref of [source.model, source.binding, source.dataset])
      if (
        !artifacts.some((a) => {
          const item = object(a, 'artifact');
          return item['path'] === ref.path && item['sha256'] === ref.sha256;
        })
      )
        throw new Error('Incomplete native snapshot closure.');
    const generator = object(snapshot['generator'], 'generator');
    immutableUrl({
      repository: string(generator['repository'], 'generator repository'),
      revision: string(generator['revision'], 'generator revision'),
      path: string(generator['script'], 'generator script'),
      sha256: string(generator['sha256'], 'generator hash'),
    });
    const generation = {
      repository: string(generator['repository'], 'generator repository'),
      revision: string(generator['revision'], 'generator revision'),
      path: string(generator['script'], 'generator script'),
      sha256: string(generator['sha256'], 'generator hash'),
    };
    refs.push(generation);
    await reader.text(generation, [...ancestry, immutableUrl(source.snapshot)]);
  }
  for (const stage of graph.stages) {
    const model = models.get(stage.source) as MetadataObject;
    const entity = object(
      object(model['entities'], 'entities')[stage.entity],
      'stage entity',
    );
    if (!equal(entity['key'], stage.grain))
      throw new Error('Graph grain differs from native model key.');
    for (const field of stage.grain)
      if (
        propertyType(model, stage.entity, field) !==
        (field === 'ordinal' ? 'int' : 'string')
      )
        throw new Error('Wrong native grain type.');
  }
  for (const edge of graph.edges) {
    const from = graph.stages.find(
        (s) => s.id === edge.from,
      ) as NativeGraphStage,
      to = graph.stages.find((s) => s.id === edge.to) as NativeGraphStage;
    for (const field of edge.fields)
      if (
        propertyType(
          models.get(from.source) as MetadataObject,
          from.entity,
          field,
        ) !==
        (edge.projection === 'ror-positive-int-geonames-decimal/1'
          ? 'int'
          : 'string')
      )
        throw new Error('Wrong native projection input type.');
    if (
      propertyType(
        models.get(to.source) as MetadataObject,
        to.entity,
        edge.lookupField,
      ) !== 'string'
    )
      throw new Error('Wrong native lookup type.');
  }
  refs.push(graph.decision.document);
  const addendum = object(await reader.json(graph.decision.document, ancestry), 'P1 addendum');
  const original = closed(addendum['original_decision'], ['repository', 'revision', 'path', 'sha256']);
  if (addendum['kind'] !== 'accepted-w1-p1-json-wire-semantic-addendum' || !equal(original, { ...NATIVE_GRAPH_ORIGINAL_DECISION, repository: 'datatug/datatug' }))
    throw new Error('The P1 addendum does not bind its exact original decision.');
  refs.push(NATIVE_GRAPH_ORIGINAL_DECISION);
  await reader.text(NATIVE_GRAPH_ORIGINAL_DECISION, [...ancestry, immutableUrl(graph.decision.document)]);
  return {
    envelope,
    attachment,
    references: reader.files,
    bytes: reader.bytes,
    entrySource: {
      ...entry.source,
      schema: entry.source.schema as ImmutableFile,
      data: entry.source.data as ImmutableFile | undefined,
    },
    eligible: false,
    reason: NATIVE_GRAPH_PUBLICATION_BLOCKER,
  };
}
