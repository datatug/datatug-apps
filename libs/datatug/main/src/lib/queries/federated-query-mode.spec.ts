import { describe, expect, it } from 'vitest';
import { federatedVisibleMode } from './federated-query-executor';
import { QueryType, type IQueryDef } from '../models/definition/query-def';

const tables = [
  { database: 'sales', name: 'Invoice', fields: ['id', 'country_id', 'amount'] },
  { database: 'geo', name: 'Country', fields: ['id', 'name'] },
];

function definition(query: object, lookups?: NonNullable<IQueryDef['federation']>['lookups']): IQueryDef {
  return {
    id: 'sales', name: 'Sales',
    request: { queryType: QueryType.DTQL, text: JSON.stringify(query) },
    federation: { ovdbBaseUrl: 'https://ovdb.example.test', tables, ...(lookups ? { lookups } : {}) },
  } as IQueryDef;
}

const joined = (type: 'left' | 'inner') => ({
  from: { database: 'sales', name: 'Invoice', alias: 'i', joins: [{
    type, from: { database: 'geo', name: 'Country', alias: 'c' },
    on: [{ left: { field: 'country_id', source: 'i' }, op: '==', right: { field: 'id', source: 'c' } }],
  }] },
  columns: [{ field: 'id', source: 'i' }, { field: 'name', source: 'c' }],
});

describe('browser query result mode', () => {
  it('defaults a per-row HTTP lookup to visible rows', () => {
    const query = { from: { database: 'sales', name: 'Invoice' } };
    const lookups = [{ database: 'geo', collection: 'Country', fromColumn: 'country_id', fields: [{ source: 'name', target: 'country' }] }];
    expect(federatedVisibleMode(definition(query, lookups))).toMatchObject({ supported: true, defaultMode: 'visible' });
  });
  it('defaults a flat left join to visible rows and allows an explicit full run', () => {
    expect(federatedVisibleMode(definition(joined('left')))).toMatchObject({ supported: true, defaultMode: 'visible' });
  });

  it('defaults an inner join to full result while allowing visible rows', () => {
    expect(federatedVisibleMode(definition(joined('inner')))).toMatchObject({ supported: true, defaultMode: 'full' });
  });

  it('requires full processing for a global order', () => {
    expect(federatedVisibleMode(definition({ ...joined('left'), orderBy: [{ field: 'id', source: 'i', desc: true }] }))).toMatchObject({ supported: false, defaultMode: 'full' });
  });
});
