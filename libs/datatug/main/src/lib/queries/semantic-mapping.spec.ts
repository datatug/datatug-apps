import { describe, it, expect } from 'vitest';
import {
  createSemanticModel,
  semanticQueryHash,
  conceptId,
  rebuildMeaningBindings,
  sameSemanticBasis,
} from './semantic-mapping';
describe('query semantic mapping', () => {
  const basis = {
    queryHash: 'a'.repeat(64),
    resultIndex: 0,
    columns: [
      { name: 'Duplicate', dataType: 'integer' },
      { name: 'Duplicate', dataType: 'unknown' },
    ],
  };
  it('declares every output field without sample constraints or collision', () => {
    const model = createSemanticModel(basis);
    expect(model.model.records.QueryResult.fields).toEqual({
      column1: { type: 'int' },
      column2: { type: 'any' },
    });
    expect(JSON.stringify(model)).not.toMatch(/required|unique|primaryKey/);
  });
  it('hashes query text, connection and federation, never row samples', async () => {
    const original = await semanticQueryHash('SQL', 'SELECT email', 'source');
    expect(original).toMatch(/^[a-f0-9]{64}$/);
    expect(await semanticQueryHash('SQL', 'SELECT email', 'source')).toBe(
      original,
    );
    expect(await semanticQueryHash('SQL', 'SELECT email', 'other')).not.toBe(
      original,
    );
    expect(await semanticQueryHash('SQL', 'SELECT name', 'source')).not.toBe(
      original,
    );
    expect(
      sameSemanticBasis(basis, {
        ...basis,
        columns: [...basis.columns].reverse(),
      }),
    ).toBe(false);
  });
  it('removes mappings without deleting definitions and creates value-only MG bindings', () => {
    const bundle = createSemanticModel(basis);
    bundle.meaning.concepts = [
      {
        id: 'customer',
        kind: 'entity',
        labels: { en: 'Customer' },
        description: 'Customer',
      },
      {
        id: 'email',
        kind: 'property',
        labels: { en: 'Email' },
        description: 'Email',
        of: 'customer',
      },
    ];
    bundle.bindings = [
      { columnIndex: 0, field: 'column1', concept: 'email', role: 'Billing' },
    ];
    const mapped = rebuildMeaningBindings(bundle);
    expect(mapped.meaning.concepts[1].bindings).toEqual([
      {
        model: 'modelspec:///query.QueryResult',
        field: 'column1',
        role: 'value',
      },
    ]);
    expect(
      rebuildMeaningBindings({ ...mapped, bindings: [] }).meaning.concepts,
    ).toEqual(bundle.meaning.concepts);
    expect(conceptId('Email', bundle.meaning.concepts)).toBe('email-item2');
  });
});
