import { Injectable } from '@angular/core';
import {
  NATIVE_GRAPH_PUBLICATION_BLOCKER,
  readNativeGraphMetadata,
} from './native-graph-contract';
import { graphStableIdentity, verifyNativeGraphPlan, type NativeGraphPlan } from './native-graph-executor';
import type { IQueryDef } from '../../models/definition/query-def';
import { QueryType } from '../../models/definition/query-def';
import {
  PUBLIC_DATA_OVDB_BASES,
  validateBounds,
  type BoundedFederation,
} from './bounded-federation';
import {
  array,
  object,
  string,
  CanonicalMetadataCache,
  CanonicalMetadataReader,
  readCanonicalIndexes,
  sha256,
  INITIAL_CANONICAL_PINS,
  immutableUrl,
  type CanonicalIndexes,
  type CanonicalPins,
  type ImmutableFile,
  type MetadataObject,
} from './canonical-metadata';
import {
  discoverRepresentations,
  sameSource,
  parseRepresentationContracts,
  referenceFile,
  type PublicDataSuggestion,
  type SourceField,
} from './representation-discovery';
import {
  verifyDeclaredCatalog,
  type DeclaredCatalogContext,
  type VerifiedDeclaredSource,
} from './declared-source';
import type { PublicDataScenario } from './public-data-scenario';
import {
  savedPlanIdentity,
  savedPinChanges,
  type SavedPlanRevalidation,
} from './saved-plan-revalidation';

export interface PublicDataDiscovery {
  readonly indexes: CanonicalIndexes;
  readonly suggestions: readonly PublicDataSuggestion[];
  readonly metadataBytes: number;
  readonly declaredSources?: readonly VerifiedDeclaredSource[];
}

function recordset(
  provider: MetadataObject,
  identity: string,
  field: 'modelEntity' | 'name' = 'modelEntity',
): MetadataObject {
  const matches = array(provider['recordsets'], 'recordsets')
    .map((value) => object(value, 'recordset'))
    .filter((value) => value[field] === identity);
  if (matches.length !== 1)
    throw new Error(
      'The exact model entity has no unambiguous Directory recordset.',
    );
  return matches[0];
}
function ownFile(
  reference: { path: string; sha256: string },
  provider: MetadataObject,
): ImmutableFile {
  return {
    ...reference,
    repository: string(provider['repository'], 'provider repository'),
    revision: string(provider['commit'], 'provider commit'),
  };
}

@Injectable({ providedIn: 'root' })
export class PublicDataService {
  private readonly cache = new CanonicalMetadataCache();
  readonly currentPins = INITIAL_CANONICAL_PINS;
  async verifyGraphForSave(plan: NativeGraphPlan): Promise<void> {
    await verifyNativeGraphPlan(plan, (input, init) => fetch(input, init), AbortSignal.timeout(10000));
  }
  async discoverAll(
    signal: AbortSignal,
    pins: CanonicalPins = this.currentPins,
  ): Promise<PublicDataDiscovery> {
    this.cache.begin(pins);
    const reader = new CanonicalMetadataReader(
      (input, init) => fetch(input, init),
      this.cache,
      signal,
    );
    const indexes = await readCanonicalIndexes(pins, reader);
    const suggestions = await discoverRepresentations(
      undefined,
      indexes,
      reader,
    );
    return { indexes, suggestions, metadataBytes: reader.bytes };
  }
  async discover(
    source: SourceField,
    signal: AbortSignal,
    pins: CanonicalPins = this.currentPins,
  ): Promise<PublicDataDiscovery> {
    this.cache.begin(pins);
    const reader = new CanonicalMetadataReader(
      (input, init) => fetch(input, init),
      this.cache,
      signal,
    );
    const indexes = await readCanonicalIndexes(pins, reader);
    const suggestions = await discoverRepresentations(source, indexes, reader);
    return { indexes, suggestions, metadataBytes: reader.bytes };
  }
  async discoverDeclared(
    input: DeclaredCatalogContext,
    signal: AbortSignal,
    pins: CanonicalPins = this.currentPins,
  ): Promise<PublicDataDiscovery> {
    this.cache.begin(pins);
    const reader = new CanonicalMetadataReader(
      (url, init) => fetch(url, init),
      this.cache,
      signal,
    );
    const declaredSources = await verifyDeclaredCatalog(input, reader);
    const indexes = await readCanonicalIndexes(pins, reader);
    const suggestions = await discoverRepresentations(
      undefined,
      indexes,
      reader,
      declaredSources,
    );
    return {
      indexes,
      suggestions,
      metadataBytes: reader.bytes,
      declaredSources,
    };
  }
  /** Explicit user action: fresh bounded metadata only, never a data lookup. */
  async revalidate(
    definition: IQueryDef,
    signal: AbortSignal,
    pins: CanonicalPins = this.currentPins,
    configured?: DeclaredCatalogContext,
  ): Promise<SavedPlanRevalidation> {
    const saved = definition.publicData;
    if (!saved)
      throw new Error('This query has no saved public-data provenance.');
    if (saved.declaredSource && !saved.graph) {
      const bounds = definition.federation?.bounds;
      const driver = bounds?.driver;
      const selected = saved.declaredSource.field.name;
      const fields = saved.declaredSource.table.fields.filter((field) =>
        [saved.declaredSource?.table.key, selected].includes(field.name),
      );
      if (
        !driver ||
        !bounds ||
        !saved.source.data ||
        !sameSource({ ...saved.source, data: driver.data }, saved.source) ||
        bounds.sources[0]?.database !== driver.database ||
        bounds.sources[0]?.name !== driver.name ||
        bounds.sources[0]?.keyField !== selected ||
        bounds.sources[1]?.parent?.field !== selected ||
        driver.key !== saved.declaredSource.table.key ||
        driver.selected !== selected ||
        JSON.stringify(driver.fields) !== JSON.stringify(fields)
      )
        throw new Error(
          'Saved source transport differs from its declared exact data and mapping.',
        );
    }
    const originalPlan = savedPlanIdentity(definition);
    this.cache.begin(pins);
    const reader = new CanonicalMetadataReader(
      (input, init) => fetch(input, init),
      this.cache,
      signal,
    );
    if (saved.declaredSource && !configured)
      throw new Error(
        'Re-resolve this saved configured user source before checking current metadata.',
      );
    const declaredSources = configured
      ? await verifyDeclaredCatalog(configured, reader)
      : undefined;
    const observed =
      saved.declaredSource &&
      declaredSources?.find(
        (context) =>
          sameSource(
            { ...saved.source, data: undefined },
            { ...context.source, data: undefined },
          ) &&
          context.table.name === saved.declaredSource?.table.name &&
          context.table.schema === saved.declaredSource?.table.schema &&
          context.field.name === saved.declaredSource?.field.name,
      );
    const declared =
      observed && sameSource(saved.source, observed.source)
        ? observed
        : undefined;
    if (
      saved.declaredSource &&
      (!observed ||
        JSON.stringify(observed.connection) !==
          JSON.stringify(saved.declaredSource.connection))
    )
      throw new Error(
        'Current configured source identity/schema/physical mapping differs from the saved plan.',
      );
    const indexes = await readCanonicalIndexes(pins, reader);
    if (saved.graph) {
      const graph = definition.federation?.nativeGraph;
      if (
        !graph ||
        graphStableIdentity(graph) !== graphStableIdentity(saved.graph) ||
        graphStableIdentity(graph.canonical) !==
          graphStableIdentity(saved.canonical) ||
        graphStableIdentity(graph.attachment) !==
          graphStableIdentity(saved.attachment)
      )
        throw new Error('Saved graph transport and provenance differ.');
      const checked = await readNativeGraphMetadata(
        saved.attachment,
        {
          repository: saved.attachment.repository,
          commit: saved.attachment.revision,
        },
        indexes,
        reader,
        declared,
      );
      if (
        graphStableIdentity(checked.envelope) !==
          graphStableIdentity(graph.envelope) ||
        !sameSource(checked.entrySource, saved.source)
      )
        throw new Error(
          'Saved graph differs from its immutable original metadata.',
        );
      for (const reference of graph.references)
        await reader.text(reference, [immutableUrl(saved.attachment)]);
      const suggestions = await discoverRepresentations(
        saved.source,
        indexes,
        reader,
        declaredSources,
      );
      const checkedAt = new Date().toISOString();
      return {
        originalPlan,
        fingerprint: await sha256(
          JSON.stringify({ originalPlan, pins, checkedAt }),
        ),
        checkedAt,
        compatible: false,
        changes: [],
        discovery: {
          indexes,
          suggestions,
          metadataBytes: reader.bytes,
          declaredSources,
        },
        reason: NATIVE_GRAPH_PUBLICATION_BLOCKER,
      };
    }
    const originals = parseRepresentationContracts(
      await reader.json(saved.attachment),
    ).filter((contract) => sameSource(saved.source, contract.source));
    if (originals.length !== 1)
      throw new Error('Saved attachment has no unique exact source scope.');
    const original = originals[0];
    if (saved.declaredSource && !original.source.data)
      throw new Error(
        'A legacy attachment cannot authorize exact declared source data.',
      );
    const oldProvider = {
      repository: saved.attachment.repository,
      commit: saved.attachment.revision,
    };
    const exact = (a: ImmutableFile, b: ImmutableFile): boolean =>
      a.repository === b.repository &&
      a.revision === b.revision &&
      a.path === b.path &&
      a.sha256 === b.sha256;
    for (const [reference, stored, external] of [
      [original.target.model, saved.model, false],
      [original.target.snapshot, saved.snapshot, false],
      [original.target.binding.meaning.document, saved.meaning, true],
      [original.decision.document, saved.decision, true],
    ] as const)
      if (!exact(referenceFile(reference, oldProvider, external), stored))
        throw new Error(
          'Saved provenance does not match its immutable original attachment.',
        );
    if (
      original.source.data &&
      (!saved.source.data ||
        !exact(
          saved.source.data,
          saved.declaredSource?.data ?? saved.source.data,
        ) ||
        !exact(
          referenceFile(original.source.data, oldProvider, true),
          saved.source.data,
        ))
    )
      throw new Error(
        'Saved exact source data differs from its attachment/configuration.',
      );
    if (
      saved.namespace !== original.target.namespace ||
      saved.decisionScope !== original.decision.scope ||
      saved.projection !== original.policy.transform ||
      saved.equality !== original.policy.equality ||
      (saved.execution ?? 'label-bridge') !==
        (original.execution ?? 'label-bridge')
    )
      throw new Error('Saved scope/policy differs from original attachment.');
    if (
      original.execution === 'native-identifier' &&
      (!saved.native ||
        !exact(
          referenceFile(original.native.dataset, oldProvider, false),
          saved.native.dataset,
        ) ||
        !exact(
          referenceFile(original.native.provenance, oldProvider, false),
          saved.native.provenance,
        ))
    )
      throw new Error('Saved native refs differ from original attachment.');
    if (saved.declaredSource && observed && !declared) {
      const checkedAt = new Date().toISOString();
      return {
        originalPlan,
        fingerprint: await sha256(
          JSON.stringify({ originalPlan, pins, observed, checkedAt }),
        ),
        checkedAt,
        compatible: false,
        changes: ['configured source/schema/data/mapping'],
        discovery: {
          indexes,
          suggestions: [],
          metadataBytes: reader.bytes,
          declaredSources,
        },
        observedDeclared: observed,
        reason:
          'The checked selected data differs from the saved exact source-data attachment. A new reviewed admission is required before this data can be saved as a lookup plan.',
      };
    }
    const suggestions = await discoverRepresentations(
      saved.source,
      indexes,
      reader,
      declaredSources,
    );
    const discovery = {
      indexes,
      suggestions,
      metadataBytes: reader.bytes,
      declaredSources,
    };
    const compatible = suggestions.filter((suggestion) => {
      const contract = suggestion.contract;
      return (
        suggestion.compatibility === 'compatible' &&
        contract &&
        suggestion.provider['repository'] === saved.model.repository &&
        (contract.execution ?? 'label-bridge') ===
          (original.execution ?? 'label-bridge') &&
        ['module', 'entity', 'property', 'datatype', 'namespace'].every(
          (name) =>
            contract.target[name as keyof typeof contract.target] ===
            original.target[name as keyof typeof original.target],
        ) &&
        contract.decision.scope === saved.decisionScope &&
        original.decision.scope === saved.decisionScope
      );
    });
    const checkedAt = new Date().toISOString();
    const suggestion = compatible.length === 1 ? compatible[0] : undefined;
    const fingerprint = await sha256(
      JSON.stringify({
        originalPlan,
        pins,
        attachment: suggestion?.attachment,
        checkedAt,
      }),
    );
    if (!suggestion)
      return {
        originalPlan,
        fingerprint,
        checkedAt,
        compatible: false,
        changes: [],
        discovery,
        reason:
          'No unique structurally compatible current contract for the saved exact target and decision scope. Original plan and results are retained.',
      };
    if (suggestion.graph) throw new Error(NATIVE_GRAPH_PUBLICATION_BLOCKER);
    const contract = suggestion.contract;
    if (!contract || !suggestion.rights)
      throw new Error('Missing verified metadata.');
    const provider = suggestion.provider;
    const fresh: PublicDataScenario = {
      ...saved,
      canonical: pins,
      declaredSource: declared || undefined,
      attachment: suggestion.attachment,
      model: referenceFile(contract.target.model, provider, false),
      snapshot: referenceFile(contract.target.snapshot, provider, false),
      meaning: referenceFile(
        contract.target.binding.meaning.document,
        provider,
        true,
      ),
      decision: referenceFile(contract.decision.document, provider, true),
      native:
        contract.execution === 'native-identifier'
          ? {
              dataset: referenceFile(contract.native.dataset, provider, false),
              provenance: referenceFile(
                contract.native.provenance,
                provider,
                false,
              ),
            }
          : undefined,
      sourceFacts: suggestion.sourceFacts,
      rights: { ...saved.rights, ...suggestion.rights },
      observedAt: checkedAt,
      eligible: false,
      unavailableReason: suggestion.reason,
    };
    const changes = savedPinChanges(saved, fresh);
    let copy: IQueryDef | undefined,
      mappingReason = '';
    try {
      const bounds = definition.federation?.bounds;
      if (!bounds)
        throw new Error(
          'Saved plan has no explicit bounded execution configuration.',
        );
      copy = this.scenario(
        saved.source,
        discovery,
        suggestion,
        {
          userRows: bounds.userRows,
          userOffset: bounds.userOffset,
        },
        declared,
      );
      copy = {
        ...copy,
        title: `${definition.title || 'Public-data plan'} (metadata checked copy)`,
        publicData: fresh,
      };
    } catch (error) {
      mappingReason =
        error instanceof Error
          ? error.message
          : 'Pending runtime mapping unavailable.';
    }
    return {
      originalPlan,
      fingerprint,
      checkedAt,
      compatible: true,
      changes,
      discovery,
      suggestion,
      copy,
      reason: `Metadata is structurally compatible. Execution remains unavailable pending canonical semantic and runtime admission.${mappingReason ? ` A new plan cannot yet be saved: ${mappingReason}` : ' Save a separate pending copy to retain the original plan and results.'}`,
    };
  }
  clearCache(): void {
    this.cache.clear();
  }

  /** Saves the exact pending plan in the existing query shape, without running it. */
  scenario(
    source: SourceField,
    discovery: PublicDataDiscovery,
    suggestion: PublicDataSuggestion,
    bounds: Pick<BoundedFederation, 'userRows' | 'userOffset'> & {
      readonly aliases?: boolean;
    },
    declared?: VerifiedDeclaredSource,
  ): IQueryDef {
    if (suggestion.graph) throw new Error(NATIVE_GRAPH_PUBLICATION_BLOCKER);
    const contract = suggestion.contract;
    if (
      !contract ||
      !suggestion.matchesSource ||
      !sameSource(source, contract.source) ||
      !suggestion.rights ||
      !suggestion.snapshot
    )
      throw new Error(
        'An exact verified source contract is needed before saving its pending scenario.',
      );
    if (contract.execution === 'native-identifier')
      return this.nativeScenario(
        source,
        discovery,
        suggestion,
        bounds,
        declared,
      );
    const sourceProvider = array(
      discovery.indexes.directory['databases'],
      'source databases',
    )
      .map((value) => object(value, 'database'))
      .find(
        (value) =>
          value['repository'] === source.schema.repository &&
          value['commit'] === source.schema.revision,
      );
    if (!sourceProvider)
      throw new Error(
        'This declared user source has no pinned Directory runtime mapping.',
      );
    const driver = recordset(sourceProvider, source.entity);
    const bridge = recordset(
      suggestion.provider,
      contract.bridge.table,
      'name',
    );
    const target = recordset(suggestion.provider, contract.target.entity);
    const sourceDatabase = string(sourceProvider['localId'], 'user database');
    const targetDatabase = string(
      suggestion.provider['localId'],
      'public database',
    );
    const base = PUBLIC_DATA_OVDB_BASES.find(
      (value) =>
        sourceProvider['apiUrl'] ===
          `${value}/v1/databases/${sourceDatabase}` &&
        suggestion.provider['apiUrl'] ===
          `${value}/v1/databases/${targetDatabase}`,
    );
    if (!base)
      throw new Error(
        'The sources have no jointly approved bounded OVDB route.',
      );
    const userName = string(driver['name'], 'user recordset');
    const bridgeName = string(bridge['name'], 'bridge recordset');
    const targetName = string(target['name'], 'target recordset');
    const physicalFields = (set: MetadataObject): string[] =>
      array(set['fields'], 'physical fields').map((value) =>
        string(object(value, 'physical field')['name'], 'physical field name'),
      );
    const boundsConfig: BoundedFederation = {
      ...bounds,
      identifierKind: 'place',
      identifierLimit: 100,
      resultRows: 5000,
      bytes: 5 * 1024 * 1024,
      timeoutMs: 10000,
      sources: [
        { database: sourceDatabase, name: userName, keyField: source.property },
        {
          database: targetDatabase,
          name: bridgeName,
          keyField: contract.bridge.raw_label_column,
          parent: {
            database: sourceDatabase,
            name: userName,
            field: source.property,
          },
        },
        {
          database: targetDatabase,
          name: targetName,
          keyField: contract.target.property,
          parent: {
            database: targetDatabase,
            name: bridgeName,
            field: contract.bridge.target_key_column,
          },
        },
      ],
    };
    validateBounds(boundsConfig);
    const query = {
      from: {
        database: sourceDatabase,
        name: userName,
        alias: 'u',
        joins: [
          {
            type: 'left',
            from: {
              database: targetDatabase,
              name: bridgeName,
              alias: 'b',
              joins: [
                {
                  type: 'left',
                  from: {
                    database: targetDatabase,
                    name: targetName,
                    alias: 'p',
                  },
                  on: [
                    {
                      left: {
                        source: 'b',
                        field: contract.bridge.target_key_column,
                      },
                      op: '==',
                      right: { source: 'p', field: contract.target.property },
                    },
                  ],
                },
              ],
            },
            on: [
              {
                left: { source: 'u', field: source.property },
                op: '==',
                right: { source: 'b', field: contract.bridge.raw_label_column },
              },
            ],
          },
        ],
      },
    };
    const decision = contract.decision.document;
    const meaning = contract.target.binding.meaning.document;
    if (
      !decision.repository ||
      !decision.revision ||
      !meaning.repository ||
      !meaning.revision
    )
      throw new Error('External decision/meaning revisions are missing.');
    return {
      id: `public-data-${crypto.randomUUID()}`,
      title: `${source.entity}.${source.property} public lookup`,
      request: {
        queryType: QueryType.DTQL,
        text: JSON.stringify(query, null, 2),
      } as IQueryDef['request'],
      federation: {
        ovdbBaseUrl: base,
        bounds: boundsConfig,
        tables: [
          {
            database: sourceDatabase,
            name: userName,
            fields: physicalFields(driver),
          },
          {
            database: targetDatabase,
            name: bridgeName,
            fields: physicalFields(bridge),
          },
          {
            database: targetDatabase,
            name: targetName,
            fields: physicalFields(target),
          },
        ],
      },
      publicData: {
        source,
        canonical: discovery.indexes.pins,
        attachment: suggestion.attachment,
        snapshot: ownFile(contract.target.snapshot, suggestion.provider),
        model: ownFile(contract.target.model, suggestion.provider),
        meaning: {
          ...meaning,
          repository: meaning.repository,
          revision: meaning.revision,
        },
        decision: {
          ...decision,
          repository: decision.repository,
          revision: decision.revision,
        },
        decisionScope: contract.decision.scope,
        namespace: contract.target.namespace,
        projection: 'identity',
        equality: 'utf8-byte-exact',
        rights: {
          ...suggestion.rights,
          attribution: JSON.stringify(
            suggestion.snapshot['licences'] ??
              suggestion.snapshot['licenses'] ??
              'See the pinned source snapshot and source licence.',
          ),
        },
        observedAt: new Date().toISOString(),
        eligible: false,
        unavailableReason: suggestion.reason,
      },
    };
  }

  private nativeScenario(
    source: SourceField,
    discovery: PublicDataDiscovery,
    suggestion: PublicDataSuggestion,
    bounds: Pick<BoundedFederation, 'userRows' | 'userOffset'> & {
      readonly aliases?: boolean;
    },
    declared?: VerifiedDeclaredSource,
  ): IQueryDef {
    if (suggestion.graph) throw new Error(NATIVE_GRAPH_PUBLICATION_BLOCKER);
    const contract = suggestion.contract;
    if (
      !contract ||
      contract.execution !== 'native-identifier' ||
      !suggestion.rights
    )
      throw new Error('Verified native contract required.');
    if (
      declared &&
      (!sameSource(source, declared.source) ||
        !discovery.declaredSources?.some(
          (value) => JSON.stringify(value) === JSON.stringify(declared),
        ))
    )
      throw new Error(
        'Native source context was not verified in this discovery operation.',
      );
    if (
      declared &&
      (!contract.source.data ||
        !source.data ||
        !sameSource(declared.source, contract.source))
    )
      throw new Error(
        'Exact declared data requires the independently matched format-3 native attachment.',
      );
    if (contract.source.data && !declared)
      throw new Error(
        'Exact source data requires a checked selected configuration.',
      );
    const target = recordset(suggestion.provider, contract.target.entity);
    const publicDatabase = string(
      suggestion.provider['localId'],
      'native database',
    );
    const targetBase = PUBLIC_DATA_OVDB_BASES.find(
      (value) =>
        suggestion.provider['apiUrl'] ===
        `${value}/v1/databases/${publicDatabase}`,
    );
    if (!targetBase)
      throw new Error(
        'Canonical native target has no approved bounded OVDB route.',
      );
    let database: string,
      name: string,
      rawField: string,
      sourceFields: string[];
    if (declared) {
      database = 'declared_user';
      name = declared.table.name;
      rawField = declared.field.name;
      sourceFields = [...new Set([declared.table.key, declared.field.name])];
    } else {
      const providers = array(
        discovery.indexes.directory['databases'],
        'source databases',
      )
        .map((value) => object(value, 'source provider'))
        .filter(
          (value) =>
            value['repository'] === source.schema.repository &&
            value['commit'] === source.schema.revision,
        );
      if (providers.length !== 1)
        throw new Error(
          'Exact native user source runtime mapping unavailable.',
        );
      const provider = providers[0],
        driver = recordset(provider, source.entity);
      database = string(provider['localId'], 'source database');
      if (provider['apiUrl'] !== `${targetBase}/v1/databases/${database}`)
        throw new Error('No jointly approved bounded native OVDB route.');
      name = string(driver['name'], 'source recordset');
      rawField = source.property;
      sourceFields = array(driver['fields'], 'physical fields').map((value) =>
        string(object(value, 'field')['name'], 'field name'),
      );
    }
    const base = targetBase,
      publicName = string(target['name'], 'native recordset');
    const ror = contract.target.namespace === 'ROR:URL';
    const limits: BoundedFederation = {
      ...bounds,
      ...(declared
        ? {
            driver: {
              kind: 'https-json' as const,
              database,
              name,
              data: declared.data,
              key: declared.table.key,
              selected: declared.field.name,
              fields: declared.table.fields.filter((field) =>
                sourceFields.includes(field.name),
              ),
            },
          }
        : {}),
      identifierKind: ror ? 'ror' : 'place',
      ...(ror ? { nativeNamespace: 'ROR:URL' as const } : {}),
      identifierLimit: ror ? 50 : 100,
      resultRows: 5000,
      bytes: 5 * 1024 * 1024,
      timeoutMs: 10000,
      sources: [
        { database, name, keyField: rawField },
        {
          database: publicDatabase,
          name: publicName,
          keyField: contract.target.property,
          parent: { database, name, field: rawField },
        },
      ],
    };
    validateBounds(limits);
    const fields = (set: MetadataObject): string[] =>
      array(set['fields'], 'physical fields').map((value) =>
        string(object(value, 'physical field')['name'], 'physical field name'),
      );
    const publicData: PublicDataScenario = {
      source,
      declaredSource: declared,
      canonical: discovery.indexes.pins,
      attachment: suggestion.attachment,
      execution: 'native-identifier',
      sourceFacts: suggestion.sourceFacts,
      native: {
        dataset: referenceFile(
          contract.native.dataset,
          suggestion.provider,
          false,
        ),
        provenance: referenceFile(
          contract.native.provenance,
          suggestion.provider,
          false,
        ),
      },
      model: referenceFile(contract.target.model, suggestion.provider, false),
      snapshot: referenceFile(
        contract.target.snapshot,
        suggestion.provider,
        false,
      ),
      meaning: referenceFile(
        contract.target.binding.meaning.document,
        suggestion.provider,
        true,
      ),
      decision: referenceFile(
        contract.decision.document,
        suggestion.provider,
        true,
      ),
      decisionScope: contract.decision.scope,
      namespace: contract.target.namespace,
      projection: 'identity',
      equality: 'utf8-byte-exact',
      rights: {
        ...suggestion.rights,
        attribution:
          'Inspect the pinned original source receipt and licence scope.',
      },
      observedAt: new Date().toISOString(),
      eligible: false,
      unavailableReason:
        'Native metadata is structurally compatible; canonical semantic and runtime publication admission are unavailable.',
    };
    return {
      id: `public-data-${crypto.randomUUID()}`,
      title: `${source.entity}.${source.property} native lookup`,
      request: {
        queryType: QueryType.DTQL,
        text: JSON.stringify(
          {
            columns: [
              ...sourceFields.map((field) => ({ source: 'u', field })),
              { source: 'p', field: contract.target.property },
            ],
            from: {
              database,
              name,
              alias: 'u',
              joins: [
                {
                  type: 'left',
                  from: {
                    database: publicDatabase,
                    name: publicName,
                    alias: 'p',
                  },
                  on: [
                    {
                      left: { source: 'u', field: rawField },
                      op: '==',
                      right: { source: 'p', field: contract.target.property },
                    },
                  ],
                },
              ],
            },
          },
          null,
          2,
        ),
      } as IQueryDef['request'],
      federation: {
        ovdbBaseUrl: base,
        bounds: limits,
        tables: [
          { database, name, fields: sourceFields },
          {
            database: publicDatabase,
            name: publicName,
            fields: fields(target),
          },
        ],
      },
      publicData,
    };
  }
}
