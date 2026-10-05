import { Injectable } from '@angular/core';
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
  INITIAL_CANONICAL_PINS,
  type CanonicalIndexes,
  type CanonicalPins,
  type ImmutableFile,
  type MetadataObject,
} from './canonical-metadata';
import {
  discoverRepresentations,
  sameSource,
  type PublicDataSuggestion,
  type SourceField,
} from './representation-discovery';

export interface PublicDataDiscovery {
  readonly indexes: CanonicalIndexes;
  readonly suggestions: readonly PublicDataSuggestion[];
  readonly metadataBytes: number;
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
  clearCache(): void {
    this.cache.clear();
  }

  /** Saves the exact pending plan in the existing query shape, without running it. */
  scenario(
    source: SourceField,
    discovery: PublicDataDiscovery,
    suggestion: PublicDataSuggestion,
    bounds: Pick<BoundedFederation, 'userRows' | 'userOffset'>,
  ): IQueryDef {
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
        eligible: suggestion.eligible,
        unavailableReason: suggestion.reason,
      },
    };
  }
}
