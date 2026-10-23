import { describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/repository-demo.json';
import {
  enrichRepositoryMeanings,
  type MeaningDiscoveryInput,
  type MeaningRepository,
} from './repository-meanings';
import {
  validateProjectMeaningsCatalog,
  type ProjectMeaningsCatalog,
} from './project-meanings-contract';
import { projectMeaningChoices } from '../queries/semantic-meaning-reuse';
const demo = 'https://github.com/datatug/datatug-demo-project';
const repos = fixture as Record<
  string,
  { revision: string; files: Record<string, string> }
>;
const base: ProjectMeaningsCatalog = {
  version: 1,
  scope: {
    storage: 'github.com',
    project: 'datatug-demo-project@datatug@demo-project-1',
  },
  revision: 'provider-revision',
  writable: true,
  referencesComplete: true,
  entities: [],
};
const repo = (repository: string): MeaningRepository => ({
  repository,
  revision: repos[repository].revision,
  files: Object.entries(repos[repository].files)
    .filter(([path]) => path.endsWith('.meaning.yaml'))
    .map(([path, text]) => ({ path, text })),
});
function input(): {
  -readonly [K in keyof MeaningDiscoveryInput]: MeaningDiscoveryInput[K];
} {
  const files = repos[demo].files,
    locations = [
      'customers/customer-invoices',
      'invoices/invoice-lines',
      'demodb/chinook-top-customer-spend',
    ];
  const metadata = (location: string) =>
    JSON.parse(files[`demo-project-1/queries/${location}.query.json`]);
  return {
    catalog: base,
    own: repo(demo),
    projectFolder: 'demo-project-1',
    legacy: ['Customer', 'Invoice', 'Country'].map((id) =>
      JSON.parse(files[`demo-project-1/entities/${id}/${id}.entity.json`]),
    ),
    queries: locations.map((location) => ({
      location,
      query: metadata(location),
    })),
    boards: [
      {
        ...JSON.parse(files['demo-project-1/boards/board1/board.json']),
        id: 'board1',
      },
    ],
    uses: JSON.parse(files['demo-project-1/datatug-meaning-uses.json']),
    readLegacy: vi.fn(async () => ({
      source: {
        repository: 'https://github.com/datatug/datatug-meta-iso',
        revision: repos['https://github.com/datatug/datatug-meta-iso'].revision,
        path: 'geo/country/country.json',
        kind: 'custom' as const,
      },
      definition: JSON.parse(
        repos['https://github.com/datatug/datatug-meta-iso'].files[
          'geo/country/country.json'
        ],
      ),
    })),
    readRepository: vi.fn(async (repository, revision) => {
      expect(revision).toBe(repos[repository]?.revision);
      return repo(repository);
    }),
    queryBody: vi.fn(async (location) => {
      const query = metadata(location);
      return {
        ...query,
        text:
          files[`demo-project-1/queries/${location}.query.tugql.yaml`] ??
          files[
            `demo-project-1/queries/${location}.query.${query.type.toLowerCase()}`
          ],
      };
    }),
  };
}
const graph = (repository: string, concepts: unknown[]): MeaningRepository => ({
  repository,
  revision: 'a'.repeat(40),
  files: [
    {
      path: 'main.meaning.yaml',
      text: JSON.stringify({ format: 'meaning/draft-1', concepts }),
    },
  ],
});
const concept = (
  id: string,
  kind = 'entity',
  extra: Record<string, unknown> = {},
) => ({
  id,
  kind,
  labels: { en: id },
  description: `Meaning of ${id}`,
  ...extra,
});
describe('repository meanings from immutable real project/core/custom fixtures', () => {
  it('shows actual legacy mappings plus repo meanings and only used borrowed closure with qualified identities', async () => {
    const source = input(),
      result = await enrichRepositoryMeanings(source);
    validateProjectMeaningsCatalog(result);
    expect(
      result.entities.some(
        (value) =>
          value.conceptId === 'Customer' && value.origin === 'repository',
      ),
    ).toBe(true);
    for (const kind of ['project', 'core', 'custom'])
      expect(result.entities.some((value) => value.source?.kind === kind)).toBe(
        true,
      );
    const customers = result.entities.filter(
      (value) => value.conceptId === 'customer',
    );
    expect(customers.length).toBeGreaterThanOrEqual(3);
    expect(new Set(customers.map((value) => value.documentId)).size).toBe(
      customers.length,
    );
    const own = required(
      customers.find((value) => value.source?.repository === demo),
    );
    expect(
      own.fields.find((value) => value.conceptId === 'customer-id')?.resources,
    ).toContainEqual(
      expect.objectContaining({
        kind: 'query',
        id: 'customers/customer-invoices',
      }),
    );
    expect(
      own.fields.find((value) => value.conceptId === 'customer-country')
        ?.resources,
    ).toContainEqual(expect.objectContaining({ kind: 'board', id: 'board1' }));
    expect(
      result.entities
        .find((value) => value.conceptId === 'Customer')
        ?.fields.find((value) => value.conceptId === 'Email')?.resources,
    ).toEqual([]);
    expect(result.revision).toBe(base.revision);
    expect(result.referencesComplete).toBe(base.referencesComplete);
    expect(result.writable).toBe(true);
    expect(projectMeaningChoices(result, result.scope)).toEqual([]);
    expect(source.queryBody).toHaveBeenCalledTimes(3);
  });
  it('rejects stale query use without associating the new query with borrowed definitions', async () => {
    const source = input();
    source.queryBody = vi.fn(async () => ({
      type: 'SQL',
      text: 'SELECT changed',
    }));
    const result = await enrichRepositoryMeanings(source);
    expect(result.discoveryComplete).toBe(false);
    expect(result.notices?.join(' ')).toContain('stale');
    expect(
      result.entities
        .filter((value) => value.source?.repository !== demo)
        .every(
          (value) =>
            !value.resources.length &&
            value.fields.every((field) => !field.resources.length),
        ),
    ).toBe(true);
  });
  it.each(['missing', 'duplicate'])(
    'refuses %s declared column targets',
    async (mode) => {
      const source = input(),
        uses = structuredClone(source.uses) as {
          bindings: { query: string; column?: { name: string } }[];
        };
      const target = required(uses.bindings.find((value) => value.column));
      if (mode === 'missing') required(target.column).name = 'NotAColumn';
      else {
        const query = required(
          source.queries.find((value) => value.location === target.query),
        ).query as unknown as {
          recordsets: { columns: { name: string }[] }[];
        };
        query.recordsets[0].columns.push({
          ...required(
            query.recordsets[0].columns.find(
              (value) => value.name === required(target.column).name,
            ),
          ),
        });
      }
      source.uses = uses;
      const result = await enrichRepositoryMeanings(source);
      expect(result.discoveryComplete).toBe(false);
      expect(result.notices?.join(' ')).toContain('undeclared column');
    },
  );
  it('keeps native IDs stable when files move and rejects duplicate IDs across graph files', async () => {
    const source = input();
    source.own = graph(demo, [concept('customer')]);
    source.uses = undefined;
    source.legacy = [];
    const first = await enrichRepositoryMeanings(source);
    source.own = {
      ...source.own,
      files: source.own.files.map((value) => ({
        ...value,
        path: 'moved.meaning.yaml',
      })),
    };
    expect(
      (await enrichRepositoryMeanings(source)).entities[0].documentId,
    ).toBe(first.entities[0].documentId);
    source.own = {
      ...source.own,
      files: [
        ...source.own.files,
        { path: 'duplicate.meaning.yaml', text: source.own.files[0].text },
      ],
    };
    const duplicate = await enrichRepositoryMeanings(source);
    expect(duplicate.discoveryComplete).toBe(false);
    expect(duplicate.notices?.join(' ')).toContain('Ambiguous');
  });
  it('preserves cross-repository field identity and visits dimension-only dependencies', async () => {
    const source = input(),
      external = 'https://github.com/other/custom';
    source.uses = undefined;
    source.legacy = [];
    source.own = graph(demo, [
      concept('field', 'attribute', {
        of: `meaning://github.com/other/custom/owner?ref=${'a'.repeat(40)}`,
      }),
      concept('ratio', 'measure', {
        measure: {
          formula: 'x',
          inputs: [],
          dimensions: [
            `meaning://github.com/other/custom/dimension?ref=${'a'.repeat(40)}`,
          ],
        },
      }),
    ]);
    source.readRepository = async () =>
      graph(external, [concept('owner'), concept('dimension', 'dimension')]);
    const result = await enrichRepositoryMeanings(source),
      owner = required(
        result.entities.find((value) => value.conceptId === 'owner'),
      );
    expect(owner.fields[0].documentId).not.toBe(owner.documentId);
    expect(
      result.entities.find((value) => value.conceptId === 'dimension')
        ?.conceptKind,
    ).toBe('dimension');
    validateProjectMeaningsCatalog(result);
  });
  it.each(['unresolved', 'cycle', 'conflict', 'draft'])(
    'reports %s native graph honestly without changing durable authority',
    async (mode) => {
      const source = input();
      source.uses = undefined;
      source.legacy = [];
      source.own = graph(
        demo,
        mode === 'cycle'
          ? [concept('customer', 'entity', { extends: 'customer' })]
          : mode === 'conflict'
            ? [
                concept('customer', 'entity', {
                  extends: `meaning://github.com/other/custom/owner?ref=${'a'.repeat(40)}`,
                }),
                concept('invoice', 'entity', {
                  extends: `meaning://github.com/other/custom/owner?ref=${'b'.repeat(40)}`,
                }),
              ]
            : mode === 'draft'
              ? [concept('customer', 'property')]
              : [concept('customer', 'entity', { extends: 'missing' })],
      );
      source.readRepository = async () =>
        graph('https://github.com/other/custom', [concept('owner')]);
      const result = await enrichRepositoryMeanings(source);
      expect(result.discoveryComplete).toBe(false);
      expect(result.notices?.length).toBeGreaterThan(0);
      expect(result.referencesComplete).toBe(true);
      expect(result.revision).toBe(base.revision);
    },
  );
  it('does not infer databases from catalog names on unrelated hosts or drivers', async () => {
    const source = input();
    source.databases = [
      {
        environment: 'local',
        id: 'chinook-local',
        driver: 'sqlite3',
        host: 'one',
      },
      {
        environment: 'prod',
        id: 'chinook-local',
        driver: 'postgres',
        host: 'two',
      },
    ];
    const result = await enrichRepositoryMeanings(source);
    expect(
      result.entities
        .flatMap((value) => [
          ...value.resources,
          ...value.fields.flatMap((field) => field.resources),
        ])
        .some((value) => value.kind === 'database'),
    ).toBe(false);
  });
  it('refuses future usage schema and bounded oversized metadata without inventing empty success', async () => {
    const source = input();
    source.uses = { version: 2, bindings: [] };
    const future = await enrichRepositoryMeanings(source);
    expect(future.discoveryComplete).toBe(false);
    expect(future.entities.length).toBeGreaterThan(0);
    source.uses = {
      version: 1,
      bindings: Array.from({ length: 1001 }, () => ({})),
    };
    const bounded = await enrichRepositoryMeanings(source);
    expect(bounded.discoveryComplete).toBe(false);
    expect(bounded.notices?.join(' ')).toContain('bound');
  });
});

it('keeps legacy fields distinct across entities and resolves explicit external inheritance without replacing or case-matching fields', async () => {
  const source = input(),
    result = await enrichRepositoryMeanings(source);
  const customer = required(
      result.entities.find((entity) => entity.conceptId === 'Customer'),
    ),
    invoice = required(
      result.entities.find((entity) => entity.conceptId === 'Invoice'),
    );
  expect(
    required(customer.fields.find((field) => field.conceptId === 'ID'))
      .documentId,
  ).not.toBe(
    required(invoice.fields.find((field) => field.conceptId === 'ID'))
      .documentId,
  );
  const own = required(
      result.entities.find((entity) => entity.conceptId === 'Country'),
    ),
    borrowed = required(
      result.entities.find((entity) =>
        entity.documentId.startsWith('legacy-file:'),
      ),
    );
  expect(own.fields.some((field) => field.conceptId === 'Name')).toBe(true);
  expect(borrowed.source).toMatchObject({
    revision: '068db7d8fd0a74c341f5a7ac6ed795f491f9db17',
    path: 'geo/country/country.json',
  });
  expect(borrowed.fields.map((field) => field.conceptId)).toEqual([
    'region',
    'alpha2',
    'alpha3',
    'name',
  ]);
  expect(
    required(borrowed.fields.find((field) => field.conceptId === 'name'))
      .resources,
  ).toEqual([]);
  expect(source.readLegacy).toHaveBeenCalledTimes(1); // options.sources datasets are not discovery references
  validateProjectMeaningsCatalog(result);
});
it('bounds cyclic, duplicate and unavailable inherited declarations and preserves managed authority', async () => {
  for (const mode of ['cycle', 'duplicate', 'unavailable']) {
    const source = input();
    source.readLegacy = vi.fn(async (url) => {
      if (mode === 'unavailable')
        throw new Error('External definition unavailable');
      return {
        source: {
          repository: 'https://github.com/example/legacy',
          revision: 'a'.repeat(40),
          path: 'country.json',
          kind: 'custom' as const,
        },
        definition: {
          title: 'Country',
          fields:
            mode === 'duplicate'
              ? [
                  { id: 'x', type: 'string' as const },
                  { id: 'x', type: 'string' as const },
                ]
              : [],
          ...(mode === 'cycle' ? { extends: { def: url } } : {}),
        },
      };
    });
    const result = await enrichRepositoryMeanings(source);
    expect(result.discoveryComplete).toBe(false);
    expect(result.referencesComplete).toBe(true);
    expect(result.writable).toBe(true);
    expect(source.readLegacy).toHaveBeenCalledTimes(1);
  }
});

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error('Required meaning declaration is missing.');
  return value;
}

it('resolves copied usage adapters at an older same-repository pin without rebasing their meaning identity', async () => {
  const source = input(),
    previous = source.own;
  source.own = {
    ...graph(demo, [concept('customer')]),
    revision: 'b'.repeat(40),
  };
  const uses = source.uses as {
    version: number;
    bindings: { meaning: string }[];
  };
  source.uses = {
    version: 1,
    bindings: [
      {
        ...uses.bindings[0],
        meaning: `meaning://github.com/datatug/datatug-demo-project/customer-id?ref=${previous.revision}`,
      },
    ],
  };
  source.readRepository = vi.fn(async (repository) =>
    repository === demo ? previous : repo(repository),
  );
  const result = await enrichRepositoryMeanings(source);
  const previousCustomer = required(
    result.entities.find(
      (entity) =>
        entity.conceptId === 'customer' &&
        entity.source?.revision === previous.revision,
    ),
  );
  expect(previousCustomer.documentId).toContain(previous.revision);
  expect(
    previousCustomer.fields.find((field) => field.conceptId === 'customer-id')
      ?.resources,
  ).toContainEqual(
    expect.objectContaining({
      kind: 'query',
      id: 'customers/customer-invoices',
    }),
  );
  const currentCustomer = required(
    result.entities.find(
      (entity) =>
        entity.conceptId === 'customer' &&
        entity.source?.revision === source.own.revision,
    ),
  );
  expect(currentCustomer.resources).toEqual([]);
  expect(result.notices ?? []).toEqual([]);
  validateProjectMeaningsCatalog(result);
});
it('continues rejecting pinned self-addresses inside native graph declarations', async () => {
  const source = input();
  source.legacy = [];
  source.uses = undefined;
  source.own = {
    ...graph(demo, [
      concept('customer', 'entity', {
        extends: `meaning://github.com/datatug/datatug-demo-project/customer?ref=${source.own.revision}`,
      }),
    ]),
    revision: 'b'.repeat(40),
  };
  const result = await enrichRepositoryMeanings(source);
  expect(result.notices?.join(' ')).toContain('native self-reference');
  expect(source.readRepository).not.toHaveBeenCalled();
});
