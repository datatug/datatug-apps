import { dataLicenseSummary, decodeDataLicenseDeclaration, decodeRightsInventory, type SourceRight, type DataLicenseDeclaration } from '@sneat/datatug-semantic';
import {
  readNativeGraphMetadata,
  type CheckedNativeGraphMetadata,
} from './native-graph-contract';
import Ajv2020 from 'ajv/dist/2020';
import { parseAllDocuments } from 'yaml';
import schema from './representation-contract.schema.json';
import schema2 from './representation-contract-2.schema.json';
import schema3 from './representation-contract-3.schema.json';
import type { VerifiedDeclaredSource } from './declared-source';
import { normalizeModel } from './model-vocabulary';
import { verifyNativeReceipt } from './native-receipt';
import {
  array,
  object,
  string,
  strictJson,
  immutableUrl,
  exactFields,
  type CanonicalIndexes,
  type CanonicalMetadataReader,
  type ImmutableFile,
  type MetadataObject,
} from './canonical-metadata';

export interface Reference {
  readonly path: string;
  readonly sha256: string;
  readonly repository?: string;
  readonly revision?: string;
}
export interface SourceField {
  readonly schema: ImmutableFile;
  /** Present only for an exact-artifact source, independently derived by configuration. */
  readonly data?: ImmutableFile;
  readonly module: string;
  readonly entity: string;
  readonly property: string;
  readonly datatype: 'string';
  readonly namespace: string;
}
export interface RepresentationContract {
  readonly execution?: 'label-bridge';
  readonly source: Omit<SourceField, 'schema' | 'data'> & {
    readonly schema: Reference;
    readonly data?: Reference;
  };
  readonly target: {
    readonly snapshot: Reference;
    readonly keys: Reference;
    readonly model: Reference;
    readonly module: string;
    readonly entity: string;
    readonly property: string;
    readonly datatype: 'string';
    readonly namespace: string;
    readonly binding: {
      readonly document: Reference;
      readonly concept: string;
      readonly role: 'identifier';
      readonly meaning: {
        readonly document: Reference;
        readonly concept: string;
      };
    };
  };
  readonly bridge: {
    readonly artifact: Reference;
    readonly table: string;
    readonly raw_label_column: string;
    readonly target_key_column: string;
    readonly serving_identity_column?: string;
  };
  readonly policy: {
    readonly transform: 'identity';
    readonly equality: 'utf8-byte-exact';
    readonly cardinality: 'zero-or-one';
    readonly unmatched: 'exception';
    readonly collision: 'ineligible';
  };
  readonly decision: { readonly document: Reference; readonly scope: string };
}
export interface NativeRepresentationContract extends Omit<
  RepresentationContract,
  'execution' | 'bridge' | 'target'
> {
  readonly execution: 'native-identifier';
  readonly target: Omit<RepresentationContract['target'], 'keys'>;
  readonly native: {
    readonly dataset: Reference;
    readonly provenance: Reference;
    readonly serving_identity_column?: string;
  };
}
export interface ExactNativeRepresentationContract extends NativeRepresentationContract {
  readonly source: NativeRepresentationContract['source'] & {
    readonly data: Reference;
  };
}
export type ScopedRepresentationContract =
  | RepresentationContract
  | NativeRepresentationContract
  | ExactNativeRepresentationContract;
export interface PublicDataSuggestion {
  readonly provider: MetadataObject;
  readonly attachment: ImmutableFile;
  readonly contract?: ScopedRepresentationContract;
  readonly graph?: CheckedNativeGraphMetadata;
  /** Structural compatibility is independent of runtime/semantic admission. */
  readonly compatibility?: 'compatible' | 'different-source' | 'incompatible';
  readonly sourceFacts?: SourceFacts;
  readonly matchesSource: boolean;
  readonly eligible: boolean;
  readonly reason: string;
  readonly snapshot?: MetadataObject;
  readonly sourceRights?: readonly SourceRight[];
  readonly rights?: {
    readonly source: string;
    readonly declaration?: DataLicenseDeclaration;
    readonly model: string;
    readonly meaning: string;
  };
}

export interface SourceFacts {
  readonly inputs?: readonly {
    readonly url?: string;
    readonly retrievedAt?: string;
    readonly modifiedAt?: string;
    readonly licence?: string;
  }[];
  readonly release?: string;
  readonly releaseDate?: string;
  readonly retrievedAt?: string;
  readonly records?: string;
  readonly sourceUrl?: string;
  readonly coverage: string;
  readonly confidence: string;
  readonly sourceLicences: readonly string[];
}
const validate2 = new Ajv2020({ allErrors: true, strict: true }).compile(
  schema2,
);
const validate3 = new Ajv2020({ allErrors: true, strict: true }).compile(
  schema3,
);
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
/** This consumer proposal does not make unfrozen companion metadata executable. */
export const REPRESENTATION_PUBLICATION_BLOCKER =
  'Scoped representation publication is pending independent contract review and canonical Directory/publisher support. Lookup is unavailable.';

export function sameSource(
  scope: SourceField,
  source: RepresentationContract['source'],
): boolean {
  const data = scope.data;
  const expected = source.data;
  return (
    scope.schema.repository === source.schema.repository &&
    scope.schema.revision === source.schema.revision &&
    scope.schema.path === source.schema.path &&
    scope.schema.sha256 === source.schema.sha256 &&
    (data === undefined || expected === undefined
      ? data === expected
      : data.repository === expected.repository &&
        data.revision === expected.revision &&
        data.path === expected.path &&
        data.sha256 === expected.sha256) &&
    scope.module === source.module &&
    scope.entity === source.entity &&
    scope.property === source.property &&
    scope.datatype === source.datatype &&
    scope.namespace === source.namespace
  );
}

export function referenceFile(
  reference: Reference,
  provider: MetadataObject,
  external: boolean,
): ImmutableFile {
  const owner = string(provider['repository'], 'provider repository');
  if (
    (external && (!reference.repository || !reference.revision)) ||
    (!external &&
      (reference.repository !== undefined ||
        reference.revision !== undefined)) ||
    reference.repository === owner
  )
    throw new Error(
      'Incorrect own-provider/external immutable reference scope.',
    );
  const file = {
    ...reference,
    repository: reference.repository ?? owner,
    revision:
      reference.revision ?? string(provider['commit'], 'provider commit'),
  };
  immutableUrl(file);
  return file;
}
function findRecord(
  records: readonly unknown[],
  repository: string,
  revision: string,
  description: string,
): MetadataObject {
  const matches = records
    .map((value) => {
      const record = object(value, description);
      exactFields(record, [
        'repository',
        'commit',
        'files',
        'id',
        'licence',
        'meaning_files',
        'meaning_licence',
        'depends',
      ]);
      return record;
    })
    .filter(
      (record) =>
        record['repository'] === repository && record['commit'] === revision,
    );
  if (matches.length !== 1)
    throw new Error(
      `Canonical ${description} is missing or ambiguous at this immutable revision.`,
    );
  return matches[0];
}
function modelProperty(
  model: MetadataObject,
  module: string,
  entity: string,
  property: string,
  datatype: string | undefined = 'string',
): MetadataObject {
  exactFields(model, ['modelspec', 'module', 'entities']);
  if (model['modelspec'] !== '1.0-draft')
    throw new Error('Unsupported canonical model format.');
  exactFields(object(model['module'], 'model module'), ['name']);
  if (object(model['module'], 'model module')['name'] !== module)
    throw new Error('Wrong canonical model module.');
  const entityRecord = object(
    object(model['entities'], 'entities')[entity],
    'entity',
  );
  exactFields(entityRecord, ['properties', 'key']);
  const value = object(entityRecord['properties'], 'properties')[property];
  const result = object(value, 'source-qualified property');
  exactFields(result, ['type', 'required']);
  if (datatype !== undefined && result['type'] !== datatype)
    throw new Error(
      'The exact model property does not declare the raw string representation.',
    );
  return result;
}
function verifyExactDeclaredModel(
  declared: VerifiedDeclaredSource,
  model: MetadataObject,
): void {
  const module = object(model['module'], 'exact source module');
  exactFields(module, ['name', 'id']);
  if (
    module['id'] !== declared.moduleId ||
    module['name'] !== declared.source.module
  )
    throw new Error(
      'Exact source module id/name differs from the selected configuration.',
    );
  const entity = object(
    object(model['entities'], 'exact source entities')[declared.source.entity],
    'exact source entity',
  );
  exactFields(entity, ['key', 'properties']);
  const keys = array(entity['key'], 'exact source grain');
  const grain = declared.table.fields.filter(
    (field) => field.name === declared.table.key,
  );
  if (
    keys.length !== 1 ||
    grain.length !== 1 ||
    keys[0] !== grain[0].property ||
    grain[0].name !== grain[0].property ||
    grain[0].datatype !== 'string' ||
    grain[0].nullable
  )
    throw new Error(
      'Exact source requires one identity-mapped required string grain.',
    );
  const selected = declared.field;
  if (selected.name !== selected.property || selected.datatype !== 'string')
    throw new Error(
      'Exact source identifier requires identity raw-member mapping.',
    );
  for (const field of [grain[0], selected]) {
    const property = object(
      object(entity['properties'], 'exact source properties')[field.property],
      'exact source property',
    );
    exactFields(property, ['type', 'required']);
    if (
      typeof property['required'] !== 'boolean' ||
      property['type'] !== 'string' ||
      property['required'] !== !field.nullable
    )
      throw new Error(
        'Exact source property required/type differs from the raw mapping.',
      );
  }
}
export function parseMeaningDocument(text: string): MetadataObject {
  const documents = parseAllDocuments(text, { uniqueKeys: true, strict: true });
  if (
    documents.length !== 1 ||
    documents[0].errors.length ||
    documents[0].warnings.length
  )
    throw new Error(
      'The canonical meaning document has invalid or multiple YAML documents.',
    );
  const value = object(
    strictJson(JSON.stringify(documents[0].toJS({ maxAliasCount: 0 }))),
    'meaning document',
  );
  exactFields(value, ['format', 'concepts']);
  for (const item of array(value['concepts'], 'meaning concepts')) {
    const concept = object(item, 'meaning concept');
    exactFields(concept, ['id', 'extends', 'bindings']);
    if (concept['bindings'])
      for (const binding of array(concept['bindings'], 'meaning bindings'))
        exactFields(object(binding, 'meaning binding'), [
          'model',
          'property',
          'role',
        ]);
  }
  return value;
}

export async function verifyRepresentationContract(
  contract: ScopedRepresentationContract,
  provider: MetadataObject,
  indexes: CanonicalIndexes,
  reader: CanonicalMetadataReader,
  attachment: ImmutableFile,
  declared?: VerifiedDeclaredSource,
): Promise<{
  snapshot: MetadataObject;
  rights: PublicDataSuggestion['rights'];
  sourceRights?: readonly SourceRight[];
  sourceFacts?: SourceFacts;
}> {
  const target = contract.target;
  const modelRecords = array(indexes.models['models'], 'model registry');
  const graphRecords = array(indexes.meanings['graphs'], 'meaning registry');
  const sourceFile = referenceFile(contract.source.schema, provider, true);
  if (contract.source.data) referenceFile(contract.source.data, provider, true);
  if (declared) {
    if (
      (contract.source.data &&
        (contract.execution !== 'native-identifier' ||
          !sameSource(declared.source, contract.source))) ||
      (!contract.source.data &&
        !sameSource({ ...declared.source, data: undefined }, contract.source))
    )
      throw new Error(
        'Declared configured source differs from exact contract scope.',
      );
  } else {
    const sourceRecord = findRecord(
      modelRecords,
      sourceFile.repository,
      sourceFile.revision,
      'source model',
    );
    if (
      object(sourceRecord['files'], 'source model files')['json'] !==
      sourceFile.path
    )
      throw new Error(
        'The source schema is not the registered canonical JSON model.',
      );
  }
  const providerRepository = string(
    provider['repository'],
    'provider repository',
  );
  const providerRevision = string(provider['commit'], 'provider commit');
  const targetRecord = findRecord(
    modelRecords,
    providerRepository,
    providerRevision,
    'target model',
  );
  const graphRecord = findRecord(
    graphRecords,
    providerRepository,
    providerRevision,
    'target meaning graph',
  );
  const modelFile = referenceFile(target.model, provider, false);
  if (
    object(targetRecord['files'], 'target model files')['json'] !==
    modelFile.path
  )
    throw new Error('Wrong registered target model path.');
  const bindingFile = referenceFile(target.binding.document, provider, false);
  if (
    !array(graphRecord['meaning_files'], 'meaning files').includes(
      bindingFile.path,
    )
  )
    throw new Error('Wrong registered meaning binding document.');
  const coreFile = referenceFile(
    target.binding.meaning.document,
    provider,
    true,
  );
  const coreRecord = findRecord(
    graphRecords,
    coreFile.repository,
    coreFile.revision,
    'canonical meaning',
  );
  const corePaths = array(coreRecord['meaning_files'], 'core meaning files');
  if (
    !corePaths.some(
      (path) =>
        path === coreFile.path ||
        (typeof path === 'string' &&
          path.startsWith('*') &&
          !coreFile.path.includes('/') &&
          coreFile.path.endsWith(path.slice(1))),
    )
  )
    throw new Error('Wrong canonical meaning file.');
  const dependencies = array(graphRecord['depends'], 'meaning dependencies');
  if (
    !dependencies.some((value) => {
      const record = object(value, 'meaning dependency');
      return (
        record['id'] === coreRecord['id'] &&
        record['commit'] === coreFile.revision
      );
    })
  )
    throw new Error('Unregistered pinned canonical meaning dependency.');
  const ancestry = [immutableUrl(attachment)];
  const source = normalizeModel(await reader.json(sourceFile, ancestry));
  const model = normalizeModel(await reader.json(modelFile, ancestry));
  if (declared && contract.source.data)
    verifyExactDeclaredModel(declared, source);
  modelProperty(
    source,
    contract.source.module,
    contract.source.entity,
    contract.source.property,
  );
  modelProperty(model, target.module, target.entity, target.property);
  if (contract.execution !== 'native-identifier') {
    for (const field of [
      contract.bridge.raw_label_column,
      contract.bridge.target_key_column,
    ])
      modelProperty(model, target.module, contract.bridge.table, field);
    if (contract.bridge.serving_identity_column)
      modelProperty(
        model,
        target.module,
        contract.bridge.table,
        contract.bridge.serving_identity_column,
        undefined,
      );
  }
  const binding = parseMeaningDocument(
    await reader.text(bindingFile, ancestry),
  );
  const core = parseMeaningDocument(await reader.text(coreFile, ancestry));
  if (
    binding['format'] !== 'meaning/draft-1' ||
    core['format'] !== 'meaning/draft-1'
  )
    throw new Error('Unsupported canonical meaning format.');
  if (
    !array(core['concepts'], 'canonical concepts').some(
      (value) =>
        object(value, 'canonical concept')['id'] ===
        target.binding.meaning.concept,
    )
  )
    throw new Error('Missing canonical target concept.');
  const concept = array(binding['concepts'], 'target concepts')
    .map((value) => object(value, 'concept'))
    .find((value) => value['id'] === target.binding.concept);
  const expectedMeaning = `meaning://${coreFile.repository.slice('https://'.length)}/${target.binding.meaning.concept}?ref=${coreFile.revision}`;
  if (
    !concept ||
    concept['extends'] !== expectedMeaning ||
    !array(concept['bindings'], 'bindings').some((value) => {
      const record = object(value, 'binding');
      return (
        record['model'] === `modelspec:///${target.module}.${target.entity}` &&
        record['property'] === target.property &&
        record['role'] === 'identifier'
      );
    })
  )
    throw new Error(
      'The binding does not implement this exact identifier property and canonical meaning.',
    );
  const snapshotFile = referenceFile(target.snapshot, provider, false);
  const snapshot = await reader.json(snapshotFile, ancestry);
  exactFields(snapshot, ['generator', 'artifacts']);
  const generator = object(snapshot['generator'], 'snapshot generator');
  exactFields(generator, ['repository', 'revision']);
  if (
    !/^https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(
      string(generator['repository'], 'generator repository'),
    ) ||
    !/^[a-f0-9]{40}$/.test(string(generator['revision'], 'generator revision'))
  )
    throw new Error('Mutable snapshot generator provenance.');
  const artifacts = array(snapshot['artifacts'], 'snapshot artifacts');
  if (artifacts.length > 10000)
    throw new Error('Snapshot artifact bound exceeded.');
  const paths = new Set<string>();
  for (const value of artifacts) {
    const artifact = object(value, 'artifact');
    exactFields(artifact, ['path', 'sha256']);
    const file = referenceFile(
      {
        path: string(artifact['path'], 'artifact path'),
        sha256: string(artifact['sha256'], 'artifact hash'),
      },
      provider,
      false,
    );
    if (paths.has(file.path)) throw new Error('Duplicate snapshot artifact.');
    paths.add(file.path);
  }
  const closed = (ref: Reference): boolean =>
    artifacts.some((value) => {
      const artifact = object(value, 'artifact');
      return (
        artifact['path'] === ref.path &&
        artifact['sha256'] === ref.sha256 &&
        ref.repository === undefined &&
        ref.revision === undefined
      );
    });
  // Decision bytes are provenance, never a free-prose acceptance parser.
  await reader.text(
    referenceFile(contract.decision.document, provider, true),
    ancestry,
  );
  const rights = {
    source: dataLicenseSummary(provider['licence']),
    declaration: decodeDataLicenseDeclaration(provider['licence']),
    model: string(targetRecord['licence'], 'model licence'),
    meaning: string(graphRecord['meaning_licence'], 'meaning licence'),
  };
  if (contract.execution === 'native-identifier') {
    for (const ref of [
      contract.native.dataset,
      contract.native.provenance,
      target.model,
      target.binding.document,
    ])
      if (!closed(ref))
        throw new Error(
          'Native dataset/model/binding/provenance closure mismatch.',
        );
    const sourceFacts = await verifyNativeReceipt(
      contract,
      model,
      snapshot,
      reader,
      (ref) => referenceFile(ref, provider, false),
      ancestry,
    );
    return { snapshot, rights, sourceFacts, sourceRights: decodeRightsInventory(provider) };
  }
  const keysFile = referenceFile(contract.target.keys, provider, false);
  const bridgeFile = referenceFile(contract.bridge.artifact, provider, false);
  for (const ref of [contract.target.keys, contract.bridge.artifact])
    if (!closed(ref))
      throw new Error('Snapshot does not pin the exact bridge/key artifact.');
  const keys = await reader.json(keysFile, ancestry);
  exactFields(keys, ['namespace', 'keys']);
  if (keys['namespace'] !== target.namespace)
    throw new Error('Wrong native-key namespace.');
  const nativeKeys = array(keys['keys'], 'native keys').map((value) =>
    string(value, 'native key'),
  );
  if (new Set(nativeKeys).size !== nativeKeys.length)
    throw new Error('Duplicate native identifier keys.');
  const bridge = await reader.json(bridgeFile, ancestry);
  exactFields(bridge, ['table', 'rows']);
  if (bridge['table'] !== contract.bridge.table)
    throw new Error('Wrong physical bridge table.');
  const labels = new Set<string>();
  for (const value of array(bridge['rows'], 'bridge rows')) {
    const row = object(value, 'bridge row');
    if (Object.keys(row).sort().join(',') !== 'raw_label,target_key')
      throw new Error('Unknown physical bridge export fields.');
    const raw = string(row['raw_label'], 'raw label');
    const key = string(row['target_key'], 'target key');
    if (labels.has(raw) || !nativeKeys.includes(key))
      throw new Error('Raw-label collision or missing native target.');
    labels.add(raw);
  }
  // Provenance only: immutable bytes do not parse or self-accept a semantic decision.
  await reader.text(
    referenceFile(contract.decision.document, provider, true),
    ancestry,
  );
  return {
    snapshot,
    sourceRights: decodeRightsInventory(provider),
    rights: {
      source: dataLicenseSummary(provider['licence']),
    declaration: decodeDataLicenseDeclaration(provider['licence']),
      model: string(targetRecord['licence'], 'model licence'),
      meaning: string(graphRecord['meaning_licence'], 'meaning licence'),
    },
  };
}

export function parseRepresentationContracts(
  document: MetadataObject,
): readonly ScopedRepresentationContract[] {
  if (
    !(document['format'] === 'ovdb-representation-contract/3'
      ? validate3(document)
      : document['format'] === 'ovdb-representation-contract/2'
        ? validate2(document)
        : validate(document))
  )
    throw new Error('Unsupported or malformed scoped representation schema.');
  return document['contracts'] as readonly ScopedRepresentationContract[];
}

/** Diagnostic discovery remains unavailable until reviewed canonical companion publication. */
export async function discoverRepresentations(
  scope: SourceField | undefined,
  indexes: CanonicalIndexes,
  reader: CanonicalMetadataReader,
  declaredSources: readonly VerifiedDeclaredSource[] = [],
): Promise<readonly PublicDataSuggestion[]> {
  if (scope) immutableUrl(scope.schema);
  const suggestions: PublicDataSuggestion[] = [];
  for (const value of array(
    indexes.directory['databases'],
    'Directory databases',
  )) {
    const provider = object(value, 'Directory provider');
    exactFields(provider, [
      'repository',
      'commit',
      'representation_contract',
      'licence',
      'sourceRights',
      'dataRights',
    ]);
    if (provider['representation_contract'] === undefined) continue;
    let attachment: ImmutableFile | undefined;
    try {
      const ref = object(
        provider['representation_contract'],
        'representation attachment',
      );
      if (Object.keys(ref).sort().join(',') !== 'path,sha256')
        throw new Error(
          'Unsupported Directory representation attachment envelope.',
        );
      attachment = referenceFile(
        {
          path: string(ref['path'], 'attachment path'),
          sha256: string(ref['sha256'], 'attachment hash'),
        },
        provider,
        false,
      );
      const document = await reader.json(attachment);
      if (document['format'] === 'ovdb-representation-contract/4') {
        const graph = await readNativeGraphMetadata(
          attachment,
          provider,
          indexes,
          reader,
          declaredSources.find((d) => scope && sameSource(scope, d.source)),
        );
        const matchesSource = scope
          ? sameSource(scope, graph.entrySource)
          : declaredSources.some((d) =>
              sameSource(d.source, graph.entrySource),
            );
        suggestions.push({
          provider,
          attachment,
          graph,
          sourceRights: decodeRightsInventory(provider),
          matchesSource,
          compatibility: matchesSource ? 'compatible' : 'different-source',
          eligible: false,
          reason: graph.reason,
        });
        continue;
      }
      if (
        !(document['format'] === 'ovdb-representation-contract/3'
          ? validate3(document)
          : document['format'] === 'ovdb-representation-contract/2'
            ? validate2(document)
            : validate(document))
      )
        throw new Error(
          'Unsupported or malformed scoped representation schema.',
        );
      const contracts = document[
        'contracts'
      ] as readonly ScopedRepresentationContract[];
      const sourceScopes = new Set<string>();
      for (const contract of contracts) {
        const source = contract.source;
        const sourceIdentity = JSON.stringify([
          source.schema.repository,
          source.schema.revision,
          source.schema.path,
          source.schema.sha256,
          source.data?.repository,
          source.data?.revision,
          source.data?.path,
          source.data?.sha256,
          source.module,
          source.entity,
          source.property,
          source.datatype,
          source.namespace,
        ]);
        if (sourceScopes.has(sourceIdentity))
          throw new Error('Duplicate contract source scope.');
        sourceScopes.add(sourceIdentity);
      }
      const verifiedSuggestions: PublicDataSuggestion[] = [];
      for (const contract of contracts) {
        const matchesSource = scope
          ? sameSource(scope, contract.source)
          : declaredSources.some((source) =>
              sameSource(source.source, contract.source),
            );
        const verified = await verifyRepresentationContract(
          contract,
          provider,
          indexes,
          reader,
          attachment,
          (() => {
            const matches = declaredSources.filter((source) =>
              sameSource(
                contract.source.data
                  ? source.source
                  : { ...source.source, data: undefined },
                contract.source,
              ),
            );
            if (matches.length > 1)
              throw new Error(
                'Ambiguous configured source mapping for this contract scope.',
              );
            return matches[0];
          })(),
        );
        verifiedSuggestions.push({
          provider,
          attachment,
          contract,
          matchesSource,
          eligible: false,
          compatibility:
            matchesSource || (!scope && !contract.source.data)
              ? 'compatible'
              : 'different-source',
          reason: matchesSource
            ? REPRESENTATION_PUBLICATION_BLOCKER
            : 'This contract belongs to a different exact source/schema/property/representation scope.',
          ...verified,
        });
      }
      suggestions.push(...verifiedSuggestions);
    } catch (error) {
      if (attachment)
        suggestions.push({
          provider,
          attachment,
          matchesSource: false,
          compatibility: 'incompatible',
          eligible: false,
          reason:
            error instanceof Error
              ? error.message
              : 'Canonical representation unavailable.',
        });
      else throw error;
    }
  }
  return suggestions;
}
