import { describe, expect, it } from 'vitest';
import type { IParameterDef } from '../../models/definition/parameter';
import type { QueryConnectionDescriptor } from '../../queries/query-dispatch';
import {
  columnKeyKind,
  isMeaningLookupParameter,
  isScalarLookupParameter,
  humanizeName,
  matchesNamePattern,
  resolveParameterMeaning,
  likeContainsPattern,
  lookupCandidates,
  lookupCellText,
  lookupConnection,
  lookupDisplayColumns,
  lookupEnvironment,
  lookupRowsSql,
  normalizeLookupFilter,
  orderCandidates,
  parameterAcceptsKey,
  pickedParameterValue,
  quoteSqlIdentifier,
  rawCellToTypedValue,
  rowMatchesFilter,
  type LookupEntity,
} from './parameter-lookup-model';

const customer: LookupEntity = {
  id: 'Customer',
  display: ['CompanyName', 'City'],
  fields: [
    null,
    {
      id: 'ID', type: 'string', mappings: [
        { source: 'northwind', collection: 'Customers', column: 'CustomerID' },
        { source: 'chinook', collection: 'Customer', column: 'CustomerId' },
      ],
    },
    { id: 'CompanyName', title: 'Company', type: 'string', mappings: [{ source: 'northwind', collection: 'Customers', column: 'CompanyName' }] },
    { id: 'City', type: 'string', mappings: [{ source: 'northwind', collection: 'Customers', column: 'City' }] },
  ],
};

const param = (patch: Partial<IParameterDef> = {}): IParameterDef => ({
  id: 'CustomerID', type: 'string', meta: { entity: 'Customer', field: 'ID' }, ...patch,
});

const schema = [
  { name: 'CustomerID', type: 'nchar(5)' },
  { name: 'CompanyName', type: 'nvarchar(40)' },
  { name: 'ContactName', type: 'nvarchar(30)' },
  { name: 'ContactTitle', type: 'nvarchar(30)' },
  { name: 'Address', type: 'nvarchar(60)' },
  { name: 'City', type: 'nvarchar(15)' },
];

const sqlite = (patch: Partial<QueryConnectionDescriptor>): QueryConnectionDescriptor => ({
  storage: 'sqlite', fixtureSha256: 'a'.repeat(64), browserFixture: { url: '/assets/x.sqlite', bytes: 1 }, ...patch,
});

describe('parameter lookup model', () => {
  it('classifies key columns by SQLite affinity', () => {
    expect(columnKeyKind('INTEGER')).toBe('integer');
    expect(columnKeyKind('nchar(5)')).toBe('string');
    expect(columnKeyKind('string')).toBe('string');
    expect(columnKeyKind('decimal(10,2)')).toBeUndefined();
    expect(columnKeyKind(undefined)).toBeUndefined();
  });

  it('lets string parameters hold both key kinds and integer parameters only integers', () => {
    expect(parameterAcceptsKey('string', 'integer')).toBe(true);
    expect(parameterAcceptsKey('GUID', 'string')).toBe(true);
    expect(parameterAcceptsKey('integer', 'integer')).toBe(true);
    expect(parameterAcceptsKey('integer', 'string')).toBe(false);
    expect(parameterAcceptsKey('number', 'integer')).toBe(false);
    expect(parameterAcceptsKey('string', undefined)).toBe(false);
  });

  it('admits only scalar parameters with a meaning', () => {
    expect(isMeaningLookupParameter(param())).toBe(true);
    expect(isMeaningLookupParameter(param({ meta: undefined }))).toBe(false);
    expect(isMeaningLookupParameter(param({ isMultiValue: true }))).toBe(false);
    expect(isMeaningLookupParameter(param({ type: 'record' as IParameterDef['type'] }))).toBe(false);
    expect(isMeaningLookupParameter(undefined)).toBe(false);
  });

  it('admits scalar parameters with or without a meaning', () => {
    expect(isScalarLookupParameter(param({ meta: undefined }))).toBe(true);
    expect(isScalarLookupParameter(param({ isMultiValue: true }))).toBe(false);
    expect(isScalarLookupParameter(param({ type: 'recordset' as IParameterDef['type'] }))).toBe(false);
    expect(isScalarLookupParameter(undefined)).toBe(false);
  });

  it('matches name patterns as Core semantic.Resolve does', () => {
    expect(matchesNamePattern({ type: 'exact', value: 'CustomerID', caseSensitive: true }, 'CustomerID')).toBe(true);
    expect(matchesNamePattern({ type: 'exact', value: 'CustomerID', caseSensitive: true }, 'customerid')).toBe(false);
    expect(matchesNamePattern({ type: 'exact', value: 'CustomerID' }, 'customerid')).toBe(true);
    expect(matchesNamePattern({ type: 'regexp', value: '\\w+CustomerID', caseSensitive: true }, 'ShipCustomerID')).toBe(true);
    expect(matchesNamePattern({ type: 'regexp', value: '\\w+CustomerID', caseSensitive: true }, 'CustomerID')).toBe(false);
    expect(matchesNamePattern({ type: 'regexp', value: 'customerid' }, 'ShipCustomerID')).toBe(true);
    expect(matchesNamePattern({ type: 'regexp', value: '(' }, 'x')).toBe(false);
    expect(matchesNamePattern({ type: 'glob', value: '*' }, 'x')).toBe(false);
    expect(matchesNamePattern({ type: 'exact' }, 'x')).toBe(false);
    expect(matchesNamePattern(null, 'x')).toBe(false);
  });

  it('resolves a declared meta, else one key field matched by name', () => {
    const keyed = (id: string, value: string, isKeyField = true): LookupEntity => ({
      id, fields: [null, { id: 'ID', type: 'string', isKeyField, namePatterns: [undefined, { type: 'regexp', value, caseSensitive: true }] }],
    });
    const nw = keyed('Customer', '^\\w*CustomerID$');
    expect(resolveParameterMeaning([nw], param())).toEqual({ entity: 'Customer', field: 'ID', provenance: 'declared' });
    expect(resolveParameterMeaning([undefined, { fields: [] }, { id: 'Empty' }, nw], { id: '@ShipCustomerID' })).toEqual({
      entity: 'Customer', field: 'ID', provenance: 'inferred', rule: 'namePattern:regexp:^\\w*CustomerID$',
    });
    expect(resolveParameterMeaning([nw], { id: 'Region' })).toBeUndefined();
    expect(resolveParameterMeaning([nw], { id: '@' })).toBeUndefined();
    expect(resolveParameterMeaning([keyed('Customer', 'CustomerID', false)], { id: 'CustomerID' })).toBeUndefined();
    expect(resolveParameterMeaning([nw, keyed('Account', 'CustomerID')], { id: 'CustomerID' })).toBeUndefined();
    expect(resolveParameterMeaning([{ id: 'X', fields: [{ id: 'ID', isKeyField: true, namePatterns: null }] }], { id: 'CustomerID' })).toBeUndefined();
  });

  it('lists declared mappings as candidates when the field type fits the parameter', () => {
    expect(lookupCandidates(customer, param())).toEqual([
      { source: 'northwind', collection: 'Customers', keyColumn: 'CustomerID', fieldKind: 'string' },
      { source: 'chinook', collection: 'Customer', keyColumn: 'CustomerId', fieldKind: 'string' },
    ]);
    expect(lookupCandidates(customer, param({ type: 'integer' }))).toEqual([]);
    expect(lookupCandidates(customer, param({ meta: { entity: 'Customer', field: 'Nope' } }))).toEqual([]);
    expect(lookupCandidates(undefined, param())).toEqual([]);
    const patternsOnly: LookupEntity = { fields: [{ id: 'ID', type: 'string' }] };
    expect(lookupCandidates(patternsOnly, param())).toEqual([]);
  });

  it('orders candidates host source first, then by source and collection', () => {
    const c = (source: string, collection: string) => ({ source, collection, keyColumn: 'k', fieldKind: 'string' as const });
    expect(orderCandidates([c('chinook', 'B'), c('northwind', 'Z'), c('chinook', 'A'), c('northwind', 'A')], 'northwind')
      .map((x) => `${x.source}/${x.collection}`))
      .toEqual(['northwind/A', 'northwind/Z', 'chinook/A', 'chinook/B']);
    expect(orderCandidates([c('a', 'x'), c('a', 'x')]).length).toBe(2);
  });

  it('uses declared display columns, skipping the key, unmapped and absent ones', () => {
    const key = { source: 'northwind', collection: 'Customers', keyColumn: 'CustomerID' };
    expect(lookupDisplayColumns({ ...customer, display: ['ID', 'Missing', 'City', 'CompanyName'] }, key, schema)).toEqual({
      columns: [
        { column: 'City', field: 'City', label: 'City' },
        { column: 'CompanyName', field: 'CompanyName', label: 'Company' },
      ],
      inferred: false,
    });
  });

  it('humanises schema and field names for column headers', () => {
    expect(humanizeName('CompanyName')).toBe('Company name');
    expect(humanizeName('CustomerID')).toBe('Customer ID');
    expect(humanizeName('ship_city')).toBe('Ship city');
    expect(humanizeName('HTTPStatusCode')).toBe('HTTP status code');
    expect(humanizeName('northwind')).toBe('Northwind');
    expect(humanizeName('OVDB')).toBe('OVDB');
    expect(humanizeName('  ')).toBe('');
  });

  it('infers up to three labelled display columns: mapped fields, then text columns', () => {
    const key = { source: 'northwind', collection: 'Customers', keyColumn: 'CustomerID' };
    expect(lookupDisplayColumns({ ...customer, display: undefined }, key, schema)).toEqual({
      columns: [
        { column: 'CompanyName', field: 'CompanyName', label: 'Company' },
        { column: 'City', field: 'City', label: 'City' },
        { column: 'ContactName', label: 'Contact name' },
      ],
      inferred: true,
    });
    const many: LookupEntity = {
      fields: ['A', 'B', 'C', 'D'].map((id) => ({ id, type: 'string', mappings: [{ source: 'northwind', collection: 'Customers', column: id }] })),
    };
    const cols = ['A', 'B', 'C', 'D'].map((name) => ({ name, type: 'text' }));
    expect(lookupDisplayColumns(many, key, cols).columns.map((c) => c.column)).toEqual(['A', 'B', 'C']);
    expect(lookupDisplayColumns({}, key, [{ name: 'CustomerID', type: 'text' }, { name: 'N', type: 'integer' }]))
      .toEqual({ columns: [], inferred: false });
  });

  it('caps declared display columns at six', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const entity: LookupEntity = {
      display: ids,
      fields: ids.map((id) => ({ id, mappings: [{ source: 's', collection: 'c', column: id }] })),
    };
    expect(lookupDisplayColumns(entity, { source: 's', collection: 'c', keyColumn: 'k' }, ids.map((name) => ({ name, type: 'text' }))).columns).toHaveLength(6);
  });

  it('quotes identifiers and escapes LIKE wildcards', () => {
    expect(quoteSqlIdentifier('Order Details')).toBe('"Order Details"');
    expect(quoteSqlIdentifier('a"; DROP TABLE x; --')).toBe('"a""; DROP TABLE x; --"');
    expect(likeContainsPattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
    expect(normalizeLookupFilter('  bott  ')).toBe('bott');
    expect(normalizeLookupFilter('x'.repeat(150))).toHaveLength(100);
    expect(normalizeLookupFilter(null)).toBe('');
  });

  it('builds a bounded, bound statement and omits WHERE for an empty filter', () => {
    const empty = lookupRowsSql('Customers', 'CustomerID', ['CompanyName'], '');
    expect(empty.sql).toBe('SELECT "CustomerID", "CompanyName" FROM "Customers" ORDER BY "CustomerID" LIMIT 51');
    expect(empty.parameters).toEqual([]);
    const filtered = lookupRowsSql('Customers', 'CustomerID', ['CompanyName'], '%');
    expect(filtered.sql).toBe(
      `SELECT "CustomerID", "CompanyName" FROM "Customers" WHERE CAST("CustomerID" AS TEXT) LIKE @filter ESCAPE '\\' OR CAST("CompanyName" AS TEXT) LIKE @filter ESCAPE '\\' ORDER BY "CustomerID" LIMIT 51`,
    );
    expect(filtered.values).toEqual({ filter: { type: 'string', value: '%\\%%' } });
    expect(filtered.sql).not.toContain("'%");
  });

  it('matches only browser-runnable connections, preferring the host and refusing ambiguity', () => {
    const catalog = [
      sqlite({ id: 'northwind-sqlite', dataset: 'northwind', environments: ['dev'] }),
      { id: 'northwind-postgresql', dataset: 'northwind', storage: 'postgresql', environments: ['dev', 'QA'] },
      { id: 'northwind-ingitdb', dataset: 'northwind', storage: 'ingitdb', environments: ['dev'] },
      sqlite({ id: 'chinook-a', dataset: 'chinook' }),
      sqlite({ id: 'chinook-b', dataset: 'chinook' }),
      sqlite({ id: 'pinned-elsewhere', dataset: 'pubs', environment: 'QA' }),
      sqlite({ id: 'no-fixture', dataset: 'sakila', browserFixture: undefined }),
    ];
    expect(lookupConnection(catalog, 'northwind', undefined, 'dev')?.id).toBe('northwind-sqlite');
    expect(lookupConnection(catalog, 'northwind', undefined, undefined)?.id).toBe('northwind-sqlite');
    expect(lookupConnection(catalog, 'northwind', undefined, 'QA')).toBeUndefined();
    expect(lookupConnection(catalog, 'chinook', undefined, undefined)).toBeUndefined();
    expect(lookupConnection(catalog, 'chinook', 'chinook-b', undefined)?.id).toBe('chinook-b');
    expect(lookupConnection(catalog, 'pubs', undefined, 'QA')?.id).toBe('pinned-elsewhere');
    expect(lookupConnection(catalog, 'sakila', undefined, undefined)).toBeUndefined();
    expect(lookupConnection(catalog, 'northwind-sqlite', undefined, 'dev')?.id).toBe('northwind-sqlite');
  });

  it('runs a connection in the host environment or its only one', () => {
    expect(lookupEnvironment(sqlite({ environments: ['dev'] }), undefined)).toBe('dev');
    expect(lookupEnvironment(sqlite({ environment: 'QA' }), undefined)).toBe('QA');
    expect(lookupEnvironment(sqlite({ environments: ['dev', 'QA'] }), undefined)).toBeUndefined();
    expect(lookupEnvironment(sqlite({}), 'UAT')).toBe('UAT');
  });

  it('matches rows in the page ASCII case-insensitively (explicit lookups)', () => {
    const row = [{ type: 'string', value: 'BOTTM' }, { type: 'string', value: 'Bottom-Dollar Markets' }] as const;
    expect(rowMatchesFilter(row, '')).toBe(true);
    expect(rowMatchesFilter(row, 'dollar')).toBe(true);
    expect(rowMatchesFilter(row, 'zzz')).toBe(false);
    expect(rowMatchesFilter([{ type: 'string', value: 'École' }], 'ÉCOLE')).toBe(true);
    expect(rowMatchesFilter([{ type: 'string', value: 'École' }], 'école')).toBe(false);
    expect(lookupCellText(undefined)).toBe('');
    expect(lookupCellText({ type: 'null', value: null })).toBe('');
  });

  it('turns a picked key into the parameter value or explains why not', () => {
    expect(pickedParameterValue({ id: 'CustomerID', type: 'string' }, { type: 'string', value: 'BOTTM' })).toEqual({ value: 'BOTTM' });
    expect(pickedParameterValue({ id: 'CustomerID', type: 'string' }, { type: 'integer', value: '42' })).toEqual({ value: '42' });
    expect(pickedParameterValue({ id: 'n', type: 'integer' }, { type: 'integer', value: '42' })).toEqual({ value: 42 });
    expect(pickedParameterValue({ id: 'n', title: 'Number', type: 'integer' }, { type: 'integer', value: '99999999999999999999' }))
      .toEqual({ error: "This record's key is too large for Number." });
    expect(pickedParameterValue({ id: 'n', type: 'integer' }, { type: 'string', value: 'BOTTM' }))
      .toEqual({ error: "This record's key cannot be used for n: expected integer." });
    expect(pickedParameterValue({ id: 'n', type: 'integer' }, { type: 'number', value: 1.5 }))
      .toEqual({ error: "This record's key cannot be used for n: expected integer." });
  });

  it('types raw agent cells', () => {
    expect(rawCellToTypedValue(null)).toEqual({ type: 'null', value: null });
    expect(rawCellToTypedValue(undefined)).toEqual({ type: 'null', value: null });
    expect(rawCellToTypedValue(7)).toEqual({ type: 'integer', value: '7' });
    expect(rawCellToTypedValue(1.5)).toEqual({ type: 'number', value: 1.5 });
    expect(rawCellToTypedValue(true)).toEqual({ type: 'boolean', value: true });
    expect(rawCellToTypedValue('x')).toEqual({ type: 'string', value: 'x' });
  });
});
