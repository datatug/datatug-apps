import { describe, expect, it } from 'vitest';
import type { Board } from '@datatug/board-models';
import {
  createSemanticModel,
  rebuildMeaningBindings,
  type SemanticMeaningScope,
} from '../queries/semantic-mapping';
import {
  copySavedMeaning,
  importMeaningDefinitions,
  projectMeaningChoices,
} from '../queries/semantic-meaning-reuse';
import {
  locatedMeaningQueries,
  projectQueryMeanings,
  mergeStandaloneProjectMeanings,
  standaloneProjectMeanings,
} from './project-meanings';
import {
  validateProjectMeaningsCatalog,
  type MeaningEntity,
} from './project-meanings-contract';

const scope: SemanticMeaningScope = {
  storage: 'github.com',
  project: 'repo@owner@datatug',
  branch: 'main',
};
const definitions: MeaningEntity[] = [
  {
    documentId: 'project',
    conceptId: 'customer',
    name: 'Customer',
    description: 'A buyer',
    origin: 'project',
    resources: [],
    fields: [
      {
        documentId: 'project',
        conceptId: 'customer-id',
        name: 'Customer ID',
        description: 'Buyer identifier',
        resources: [],
      },
    ],
  },
];
const model = () => {
  const value = createSemanticModel({
    queryHash: 'a'.repeat(64),
    resultIndex: 0,
    columns: [{ name: 'ID', dataType: 'integer' }],
  });
  value.meaning.concepts = [
    {
      id: 'customer',
      kind: 'entity',
      labels: { en: 'Customer' },
      description: 'Buyer',
    },
    {
      id: 'customer-id',
      kind: 'property',
      labels: { en: 'Customer ID' },
      description: 'ID',
      of: 'customer',
    },
  ];
  value.bindings = [
    { columnIndex: 0, field: 'column1', concept: 'customer-id' },
  ];
  return rebuildMeaningBindings(value);
};
const query = () => ({
  location: 'sales/customers',
  query: { id: 'customers', title: 'Customer list', semanticModel: model() },
});
const board: Board = {
  id: 'sales',
  title: 'Sales dashboard',
  rows: [
    {
      cards: [
        {
          id: 'ids',
          title: 'Buyer IDs',
          widget: {
            name: 'tabs',
            data: {
              tabs: [
                {
                  title: 'IDs',
                  widget: {
                    name: 'SQL',
                    data: { sql: { queryId: 'sales/customers' } },
                  },
                },
              ],
            },
          },
        },
      ],
    },
  ],
};

describe('project MeaningGraph catalog identity and resources', () => {
  it('keeps duplicate labels and concept IDs separate across query documents', () => {
    const one = query(),
      two = { ...query(), location: 'support/customers' };
    const catalog = projectQueryMeanings([one, two], [board], scope);
    expect(catalog.entities).toHaveLength(2);
    expect(
      new Set(catalog.entities.map((entity) => entity.documentId)).size,
    ).toBe(2);
    expect(
      catalog.entities
        .find((entity) => entity.documentId.includes('sales/customers'))
        ?.fields[0].resources.map((resource) => resource.kind),
    ).toEqual(['query', 'board']);
    expect(
      catalog.entities
        .find((entity) => entity.documentId.includes('support/customers'))
        ?.resources.map((resource) => resource.kind),
    ).toEqual(['query']);
    expect(catalog.writable).toBe(false);
  });
  it('indexes full folder locations and refuses duplicate or traversal identities', () => {
    expect(
      locatedMeaningQueries({
        id: '~',
        folders: [{ id: 'sales', items: [{ id: 'customers' }] }],
      })[0].location,
    ).toBe('sales/customers');
    expect(() =>
      locatedMeaningQueries({ id: '~', items: [{ id: '../escape' }] }),
    ).toThrow('invalid');
    expect(() =>
      locatedMeaningQueries({
        id: '~',
        items: [{ id: 'same' }, { id: 'same' }],
      }),
    ).toThrow('invalid');
  });
  it('never treats matching labels/IDs as references to standalone definitions', () => {
    const queries = [query()],
      catalog = projectQueryMeanings(queries, [board], scope);
    const merged = mergeStandaloneProjectMeanings(
      catalog,
      definitions,
      queries,
      scope,
    );
    expect(
      merged.entities.find((entity) => entity.origin === 'project')?.resources,
    ).toEqual([]);
  });
  it('preserves canonical project references on reuse and protects parent/field resource projection', () => {
    const empty = projectQueryMeanings([], [], scope);
    const choices = projectMeaningChoices(
      { ...empty, entities: definitions },
      scope,
    );
    const reused = copySavedMeaning(model(), choices[0]);
    expect(
      reused.bundle.meaning.concepts.find(
        (concept) => concept.id === reused.propertyId,
      )?.meaningRef,
    ).toEqual({ documentId: 'project', conceptId: 'customer-id', scope });
    const queries = [
      { ...query(), query: { ...query().query, semanticModel: reused.bundle } },
    ];
    const merged = mergeStandaloneProjectMeanings(
      projectQueryMeanings(queries, [board], scope),
      definitions,
      queries,
      scope,
    );
    const entity = merged.entities.find(
      (entity) => entity.origin === 'project',
    );
    expect(entity?.resources.map((resource) => resource.kind)).toEqual([
      'query',
      'board',
    ]);
    expect(entity?.fields[0].resources).toEqual(entity?.resources);
    expect(() =>
      importMeaningDefinitions(model(), reused.bundle.meaning),
    ).toThrow('must be selected');
  });
  it('does not rebase cross-project refs and refuses unresolved same-project targets', () => {
    const queries = [query()];
    queries[0].query.semanticModel.meaning.concepts[0].meaningRef = {
      documentId: 'project',
      conceptId: 'customer',
      scope: { ...scope, project: 'other@owner@datatug' },
    };
    const merged = mergeStandaloneProjectMeanings(
      projectQueryMeanings(queries, [], scope),
      definitions,
      queries,
      scope,
    );
    expect(
      merged.entities.find((entity) => entity.origin === 'project')?.resources,
    ).toEqual([]);
    expect(merged.notices).toHaveLength(1);
    queries[0].query.semanticModel.meaning.concepts[0].meaningRef = {
      documentId: 'project',
      conceptId: 'missing',
      scope,
    };
    expect(() =>
      mergeStandaloneProjectMeanings(
        projectQueryMeanings(queries, [], scope),
        definitions,
        queries,
        scope,
      ),
    ).toThrow('missing');
  });
  it('refuses malformed catalog and standalone files rather than authorizing changes', () => {
    const catalog = projectQueryMeanings([], [], scope);
    expect(() =>
      validateProjectMeaningsCatalog({ ...catalog, writable: 'yes' }),
    ).toThrow('invalid');
    expect(() => standaloneProjectMeanings(undefined, scope)).toThrow(
      'invalid',
    );
    expect(
      standaloneProjectMeanings({ version: 1, entities: definitions }, scope),
    ).toEqual(definitions);
    expect(() =>
      standaloneProjectMeanings(
        {
          version: 1,
          entities: [
            {
              ...definitions[0],
              resources: [{ kind: 'query', id: 'invented', title: 'Invented' }],
            },
          ],
        },
        scope,
      ),
    ).toThrow('invalid');
  });
});
