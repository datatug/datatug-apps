import { semanticValidationState } from './semantic-mapping';
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


describe('asynchronous meaning validation', () => {
  it('keeps delayed fingerprints neutral and only marks resolved differences for review', () => {
    const basis = { queryHash: 'a'.repeat(64), resultIndex: 0, columns: [{ name: 'ID', dataType: 'integer' }] };
    const saved = createSemanticModel(basis);
    expect(semanticValidationState(saved, undefined, '', false)).toBe('checking');
    expect(semanticValidationState(saved, basis, '', false)).toBe('checking');
    expect(semanticValidationState(saved, basis, basis.queryHash, false)).toBe('confirmed');
    expect(semanticValidationState(saved, basis, 'b'.repeat(64), false)).toBe('review');
    expect(semanticValidationState(saved, { ...basis, columns: [{ name: 'Changed', dataType: 'integer' }] }, basis.queryHash, false)).toBe('review');
    expect(semanticValidationState(saved, basis, basis.queryHash, true)).toBe('review');
  });
});
