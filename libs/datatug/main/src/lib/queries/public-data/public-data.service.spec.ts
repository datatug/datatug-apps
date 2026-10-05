import { describe, expect, it } from 'vitest';
import document from '../fixtures/public-data-fabric/representation/contract.json';
import { INITIAL_CANONICAL_PINS } from './canonical-metadata';
import {
  PublicDataService,
  type PublicDataDiscovery,
} from './public-data.service';
import type {
  PublicDataSuggestion,
  RepresentationContract,
  SourceField,
} from './representation-discovery';

const contract = document.contracts[0] as RepresentationContract;
const source = contract.source as SourceField;
const driver = {
  name: 'Customer',
  modelEntity: 'Customer',
  fields: [{ name: 'Country' }],
};
const sourceProvider = {
  repository: source.schema.repository,
  commit: source.schema.revision,
  localId: 'source',
  apiUrl: 'https://demodb.dev/ovdb/v1/databases/source',
  recordsets: [driver],
};
const suggestion: PublicDataSuggestion = {
  contract,
  matchesSource: true,
  eligible: false,
  reason: 'Staged fixture',
  attachment: INITIAL_CANONICAL_PINS.directory,
  rights: { source: 'fixture', model: 'fixture', meaning: 'fixture' },
  snapshot: {},
  provider: {
    repository: 'https://github.com/example/public',
    commit: 'a'.repeat(40),
    localId: 'public',
    apiUrl: 'https://demodb.dev/ovdb/v1/databases/public',
    recordsets: [
      {
        name: 'CustomerCountries',
        fields: [{ name: 'raw_label' }, { name: 'target_key' }],
      },
      {
        name: 'countries_physical',
        modelEntity: 'Countries',
        fields: [{ name: 'iso' }],
      },
    ],
  },
};
const discovery: PublicDataDiscovery = {
  metadataBytes: 0,
  suggestions: [suggestion],
  indexes: {
    pins: INITIAL_CANONICAL_PINS,
    bytes: 0,
    directory: { databases: [sourceProvider] },
    models: {},
    meanings: {},
  },
};

describe('pending bounded scenario factory', () => {
  it('uses explicit modelEntity mappings and a separately declared physical bridge table', () => {
    const query = new PublicDataService().scenario(
      source,
      discovery,
      suggestion,
      { userRows: 1000, userOffset: 0 },
    );
    expect(query.federation?.tables.map((value) => value.name)).toEqual([
      'Customer',
      'CustomerCountries',
      'countries_physical',
    ]);
    expect(query.publicData?.eligible).toBe(false);
  });
  it('rejects name-only model guesses, mismatched source claims and out-of-bound saved scenarios', () => {
    const changed = structuredClone(discovery);
    changed.indexes.directory['databases'] = [
      {
        ...sourceProvider,
        recordsets: [{ name: 'Customer', fields: driver.fields }],
      },
    ];
    const service = new PublicDataService();
    expect(() =>
      service.scenario(source, changed, suggestion, {
        userRows: 1000,
        userOffset: 0,
      }),
    ).toThrow(/exact model entity/);
    expect(() =>
      service.scenario(
        { ...source, property: 'InvoiceCountry' },
        discovery,
        suggestion,
        { userRows: 1000, userOffset: 0 },
      ),
    ).toThrow(/exact verified source/);
    expect(() =>
      service.scenario(source, discovery, suggestion, {
        userRows: 1001,
        userOffset: 0,
      }),
    ).toThrow(/user rows/);
  });
});
