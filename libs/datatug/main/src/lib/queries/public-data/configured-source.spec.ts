import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import directory from '../fixtures/public-data-fabric/representation/directory.pinned.json';
import models from '../fixtures/public-data-fabric/representation/models.pinned.json';
import contractDocument from '../fixtures/public-data-fabric/representation/contract.json';
import {
  INITIAL_CANONICAL_PINS,
  sha256,
  type CanonicalIndexes,
} from './canonical-metadata';
import {
  configuredFieldChoices,
  type ConfiguredPublicSource,
} from './configured-source';
import { ConfiguredPublicDataSourcesService } from './configured-public-data-sources.service';
import { PublicDataService } from './public-data.service';
import { ProjectService } from '../../services/project/project.service';
import { EnvironmentService } from '../../services/unsorted/environment.service';
import { GithubProjectReaderService } from '../../services/repo/github/github-project-reader.service';
import type {
  RepresentationContract,
  PublicDataSuggestion,
} from './representation-discovery';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing pinned fixture member.');
  return value;
}
const provider = required(
  directory.databases.find((value) => value.localId === 'chinook'),
);
const model = required(
  models.models.find(
    (value) =>
      value.repository === provider.repository &&
      value.commit === provider.commit,
  ),
);
const contract = structuredClone(
  contractDocument.contracts[0],
) as RepresentationContract;
Object.assign(contract.source, {
  module: model.module,
  entity: 'Customer',
  property: 'Country',
  namespace: 'fixture-only-exact-labels',
  schema: {
    repository: provider.repository,
    revision: provider.commit,
    path: model.files.json,
    sha256: '5e81f79ae02760bbdc372985022ab94209b97aaa76bf456fb59e040a99476870',
  },
});
const suggestion: PublicDataSuggestion = {
  provider: {},
  attachment: INITIAL_CANONICAL_PINS.directory,
  contract,
  matchesSource: false,
  eligible: false,
  reason: 'Synthetic bounded consumer fixture, pending publication',
  rights: { source: 'MIT', model: 'MIT', meaning: 'fixture' },
  snapshot: {},
};
const indexes: CanonicalIndexes = {
  pins: INITIAL_CANONICAL_PINS,
  bytes: 0,
  directory,
  models,
  meanings: {},
};
const table = { schema: '', name: 'Customer', dbType: 'BASE TABLE' };
const connection: ConfiguredPublicSource = {
  id: 'web/ovdb/chinook',
  title: 'Configured Chinook',
  environment: 'web',
  catalog: 'chinook',
  driver: 'ovdb',
  host: provider.apiUrl,
};

describe('configured source adapter using pinned actual Directory and registry fixtures', () => {
  it('retains exact immutable fixture bytes', async () => {
    for (const [name, pin] of [
      ['directory', INITIAL_CANONICAL_PINS.directory],
      ['models', INITIAL_CANONICAL_PINS.models],
    ] as const)
      expect(
        await sha256(
          readFileSync(
            resolve(
              `libs/datatug/main/src/lib/queries/fixtures/public-data-fabric/representation/${name}.pinned.json`,
            ),
            'utf8',
          ),
        ),
      ).toBe(pin.sha256);
  });
  it('resolves provider→explicit recordset modelEntity→property scope without user-authored hashes', () => {
    const result = configuredFieldChoices(connection, [table], indexes, [
      suggestion,
    ]);
    const field = result.find((value) => value.property === 'Country');
    expect(field?.source).toEqual(contract.source);
    expect(field?.source?.schema.revision).toBe(provider.commit);
    expect(
      result.find((value) => value.property === 'FirstName')?.source,
    ).toBeUndefined();
  });
  it('rejects wrong origin/revision, API-base identity guessing, wrong entity mapping and ambiguous schema selection', () => {
    for (const invalid of [
      { ...connection, host: 'https://unexpected.example/api' },
      { ...connection, host: provider.serverId },
      {
        ...connection,
        upstream: { repository: provider.repository, revision: 'b'.repeat(40) },
      },
    ])
      expect(
        configuredFieldChoices(invalid, [table], indexes, [suggestion]).every(
          (value) => !value.source,
        ),
      ).toBe(true);
    expect(
      configuredFieldChoices(
        connection,
        [{ ...table, schema: 'guessed-main' }],
        indexes,
        [suggestion],
      )[0].source,
    ).toBeUndefined();
    const changed = structuredClone(directory);
    const record = required(
      changed.databases.find((value) => value.localId === 'chinook'),
    );
    required(
      record.recordsets.find((value) => value.name === 'Customer'),
    ).modelEntity = 'Invoice';
    expect(
      configuredFieldChoices(
        connection,
        [table],
        { ...indexes, directory: changed },
        [suggestion],
      ).every((value) => !value.source),
    ).toBe(true);
    expect(
      configuredFieldChoices(
        {
          ...connection,
          driver: 'https-json',
          host: 'chinook.demodb.dev',
          upstream: {
            repository: 'https://github.com/lerocha/chinook-database',
            revision: '7f67772503d71ba90f19283c38e93923addb43fa',
          },
        },
        [table],
        indexes,
        [suggestion],
      )[0].reason,
    ).toMatch(/original upstream/);
  });
  describe('reads the newer index keys beside the earlier ones', () => {
    type Entry = Record<string, unknown>;
    const choicesWith = (change: {
      directory?: CanonicalIndexes['directory'];
      models?: CanonicalIndexes['models'];
    }) =>
      configuredFieldChoices(
        connection,
        [table],
        {
          ...indexes,
          directory: change.directory ?? directory,
          models: change.models ?? models,
        },
        [suggestion],
      );
    // Every recordset's mapping, spelled as `spell` says (see `directoryWith` callers).
    const directoryWith = (spell: (set: Entry) => Entry) => ({
      ...directory,
      databases: directory.databases.map((db) => ({
        ...db,
        recordsets: db.recordsets.map((set) => spell(set)),
      })),
    });
    const modelsWith = (spell: (record: Entry) => Entry) => ({
      ...models,
      models: models.models.map((entry) => ({
        ...entry,
        ...spell(entry),
      })),
    });
    const renamed = (set: Entry): Entry => {
      const { modelEntity, ...rest } = set;
      return { ...rest, modelRecordType: modelEntity };
    };
    // The registry's index entry with its record types and their members under the newer keys.
    const current = (entry: Entry): Entry => {
      const { entities, ...rest } = entry;
      return {
        ...rest,
        records: (entities as Entry[]).map((record) => {
          const { properties, ...others } = record;
          return { ...others, fields: properties };
        }),
      };
    };
    const earlier = choicesWith({});

    it('gives the same choices as before for modelRecordType, and for records with fields', () => {
      expect(
        earlier.find((value) => value.property === 'Country')?.source,
      ).toBeDefined();
      expect(choicesWith({ directory: directoryWith(renamed) })).toEqual(
        earlier,
      );
      expect(
        choicesWith({
          models: modelsWith((entry) => ({
            ...current(entry),
            entities: undefined,
          })),
        }),
      ).toEqual(earlier);
      expect(
        choicesWith({
          directory: directoryWith(renamed),
          models: modelsWith((entry) => ({
            ...current(entry),
            entities: undefined,
          })),
        }),
      ).toEqual(earlier);
    });
    it('lets modelRecordType win over modelEntity where both are present', () => {
      expect(
        choicesWith({
          directory: directoryWith((set) => ({
            ...renamed(set),
            modelEntity: 'Invoice',
          })),
        }),
      ).toEqual(earlier);
      expect(
        choicesWith({
          directory: directoryWith((set) => ({
            ...set,
            modelRecordType: 'Invoice',
          })),
        }).every((value) => !value.source),
      ).toBe(true);
    });
    it('lets records and fields win over entities and properties where both are present', () => {
      const emptied = (record: Entry): Entry => ({ ...record, properties: [] });
      expect(
        choicesWith({
          models: modelsWith((entry) => ({
            ...current(entry),
            entities: (entry['entities'] as Entry[]).map(emptied),
          })),
        }),
      ).toEqual(earlier);
    });
  });
  it('uses existing project/environment/catalog services to resolve selected source metadata without querying rows', async () => {
    const environments = {
      getEnvSummary: vi.fn(() =>
        of({
          id: 'web',
          title: 'Web',
          dbServers: [
            {
              id: 'ovdb',
              driver: 'ovdb',
              host: provider.apiUrl,
              catalogs: ['chinook'],
            },
          ],
        }),
      ),
      getCatalogTables: vi.fn(() => of({ tables: [table], views: [] })),
    };
    const github = { getRawJson: vi.fn(() => of({})) };
    const metadata = {
      discoverAll: vi.fn(async () => ({
        indexes,
        suggestions: [suggestion],
        metadataBytes: 257101,
      })),
    };
    TestBed.configureTestingModule({
      providers: [
        ConfiguredPublicDataSourcesService,
        { provide: ProjectService, useValue: { getSummary: vi.fn() } },
        { provide: EnvironmentService, useValue: environments },
        { provide: GithubProjectReaderService, useValue: github },
        { provide: PublicDataService, useValue: metadata },
      ],
    });
    const service = TestBed.inject(ConfiguredPublicDataSourcesService);
    const project = {
      ref: { storeId: 'github.com', projectId: 'fixture@example@' },
      summary: {
        id: 'fixture',
        title: 'Fixture',
        access: 'public' as const,
        environments: [{ id: 'web' }],
      },
    };
    const [selected] = await service.list(project);
    const result = await service.inspect(
      project,
      selected,
      new AbortController().signal,
    );
    expect(
      result.fields.find((value) => value.property === 'Country')?.source,
    ).toEqual(contract.source);
    expect(environments.getCatalogTables).toHaveBeenCalledWith(
      project.ref,
      'web',
      'chinook',
    );
    expect(github.getRawJson).toHaveBeenCalledWith(
      project.ref.projectId,
      'environments/web/catalogs/chinook/chinook.db.json',
    );
    expect(metadata.discoverAll).toHaveBeenCalledOnce();
  });
});
