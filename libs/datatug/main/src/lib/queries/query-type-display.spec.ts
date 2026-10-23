import { describe, expect, it } from 'vitest';
import { QueryType } from '../models/definition/query-def';
import { queryTypeDisplayName } from './query-type-display';

describe('queryTypeDisplayName', () => {
  it('names each query type', () => {
    expect(queryTypeDisplayName(QueryType.TugQL)).toBe('TugQL');
    expect(queryTypeDisplayName(QueryType.SQL)).toBe('SQL');
    expect(queryTypeDisplayName(QueryType.HTTP)).toBe('HTTP');
  });

  it('shows a legacy DTQL definition as TugQL, as the queries list does (demo walk item 10)', () => {
    expect(queryTypeDisplayName('DTQL')).toBe('TugQL');
    expect(queryTypeDisplayName('dtql')).toBe('TugQL');
  });

  it('falls back to the raw value, or nothing, for anything else', () => {
    expect(queryTypeDisplayName('GraphQL')).toBe('GraphQL');
    expect(queryTypeDisplayName(undefined)).toBe('');
    expect(queryTypeDisplayName(null)).toBe('');
  });
});
