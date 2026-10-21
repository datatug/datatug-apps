import { describe, it, expect } from 'vitest';
import {
  createSemanticModel,
  rebuildMeaningBindings,
  validateSemanticModel,
  detachUnusedProjectMeaningReferences,
} from './semantic-mapping';
import {
  savedMeaningChoices,
  copySavedMeaning,
  importMeaningDefinitions,
} from './semantic-meaning-reuse';
import { QueryType, type IQueryDef, type ITextQueryRequest } from '../models/definition/query-def';
const source = () => {
  const bundle = createSemanticModel({
    queryHash: 'a'.repeat(64),
    resultIndex: 0,
    columns: [
      { name: 'ID', dataType: 'integer' },
      { name: 'OtherID', dataType: 'integer' },
    ],
  });
  bundle.meaning.concepts = [
    {
      id: 'invoice',
      kind: 'entity',
      labels: { en: 'Invoice' },
      description: 'Source invoices',
    },
    {
      id: 'number',
      kind: 'property',
      labels: { en: 'Number' },
      description: 'Source invoice number',
      of: 'invoice',
    },
  ];
  bundle.bindings = [{ columnIndex: 0, field: 'column1', concept: 'number' }];
  return {
    id: 'source',
    title: 'Invoices',
    request: { queryType: QueryType.SQL, text: 'SELECT ID' } as ITextQueryRequest,
    semanticModel: rebuildMeaningBindings(bundle),
  };
};
describe('saved meaning reuse', () => {
  it('removing the last binding detaches canonical refs while retaining reusable definition snapshots', () => {
    const bundle = source().semanticModel;
    for (const concept of bundle.meaning.concepts) concept.meaningRef = {documentId:'project',conceptId:concept.id,scope:{storage:'local',project:'p1',branch:'main'}};
    expect(detachUnusedProjectMeaningReferences(bundle).meaning.concepts.every(concept => !!concept.meaningRef)).toBe(true);
    const detached = detachUnusedProjectMeaningReferences(rebuildMeaningBindings({...bundle,bindings:[]}));
    expect(detached.meaning.concepts.every(concept => !concept.meaningRef)).toBe(true);
    expect(detached.meaning.concepts.map(concept => concept.labels)).toEqual(bundle.meaning.concepts.map(concept => concept.labels));
    expect(bundle.meaning.concepts[0].meaningRef).toBeDefined();
  });
  it('excludes current query, labels the source and skips an invalid unrelated saved bundle', () => {
    const good = source(),
      invalid = source();
    invalid.id = 'bad';
    invalid.semanticModel.meaning.concepts[1].of = 'missing';
    const result = savedMeaningChoices(
      [good, { ...good, id: 'current' }, invalid, null as unknown as IQueryDef],
      'current',
    );
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].sourceTitle).toBe('Invoices');
    expect(result.skipped).toBe(2);
    expect(result.choices[0].property.bindings).toBeUndefined();
  });
  it('copies only the selected definitions, remaps conflicting IDs and leaves source/current bindings unchanged', () => {
    const query = source(),
      original = structuredClone(query),
      target = structuredClone(query.semanticModel);
    target.meaning.concepts[0].description = 'Different entity';
    target.meaning.concepts[1].description = 'Different property';
    target.bindings = [{ columnIndex: 1, field: 'column2', concept: 'number' }];
    const current = rebuildMeaningBindings(target),
      unchanged = structuredClone(current);
    const copied = copySavedMeaning(
      current,
      savedMeaningChoices([query], 'other').choices[0],
    );
    expect(copied.propertyId).toBe('number-item2');
    expect(
      copied.bundle.meaning.concepts.find((c) => c.id === copied.propertyId)
        ?.of,
    ).toBe('invoice-item2');
    expect(
      copied.bundle.meaning.concepts.find((c) => c.id === copied.propertyId)
        ?.bindings,
    ).toBeUndefined();
    expect(copied.bundle.bindings).toEqual(current.bindings);
    const edited = copied.bundle.meaning.concepts.find(
      (c) => c.id === copied.propertyId,
    );
    if (!edited) throw new Error('Copied property missing');
    edited.labels.en = 'Edited locally';
    expect(query).toEqual(original);
    expect(current).toEqual(unchanged);
    validateSemanticModel(copied.bundle);
    expect(copied.bundle.meaning.concepts).toHaveLength(4);
  });
  it('retains explicit file import validation and rejects malformed saved choices', () => {
    const query = source(),
      target = createSemanticModel(query.semanticModel.basis);
    const imported = importMeaningDefinitions(
      target,
      query.semanticModel.meaning,
    );
    expect(imported.bindings).toEqual([]);
    expect(imported.meaning.concepts[1].bindings).toBeUndefined();
    const choice = savedMeaningChoices([query], 'other').choices[0];
    expect(() =>
      copySavedMeaning(target, {
        ...choice,
        property: { ...choice.property, of: 'missing' },
      }),
    ).toThrow('invalid');
    expect(() =>
      importMeaningDefinitions(target, {
        ...query.semanticModel.meaning,
        unsupported: true,
      }),
    ).toThrow('invalid');
  });
  it('keeps all valid saved choices available without silently truncating', () => {
    const queries = Array.from({ length: 110 }, (_, index) => ({
      ...source(),
      id: `q${index}`,
    }));
    const result = savedMeaningChoices(queries, 'other');
    expect(result.choices).toHaveLength(110);
  });
});
