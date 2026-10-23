/* eslint-disable @typescript-eslint/no-explicit-any -- each case mutates a JSON copy of the declaration */
import { describe, expect, it } from 'vitest';
import {
  identifierValue, parseLogSources, recordRoute, relatedLogEvidenceLinks, splitOvdbDatabaseUrl,
} from './log-source-declarations';
import { declaredLogSourcesFile, declaredShippingLogs } from './log-source-declarations.spec-helper';

const clone = () => JSON.parse(JSON.stringify(declaredLogSourcesFile));

describe('declared log sources', () => {
  it('reads the demo project declaration: database, allowlisted collections, merged roles, typed identifiers', () => {
    const [shipping, local] = declaredShippingLogs;
    expect(shipping).toMatchObject({ id: 'shipping-logs', baseUrl: 'https://ovdb.demodb.dev', databaseId: 'shipping-logs', synthetic: true });
    expect(shipping.collections.map((c) => c.id)).toEqual(['baseline', 'carrierGateway']);
    expect(shipping.collections[0].fields).toEqual({ timestamp: 'occurred_at', sequence: 'sequence', message: 'kind', reference: 'event_id' });
    expect(shipping.collections[1].fields).toMatchObject({ correlation: 'correlation_id', service: 'stream', timestamp: 'occurred_at' });
    expect(shipping.identifiers.map((i) => [i.param, i.type])).toEqual([['order', 'integer'], ['attempt', 'string']]);
    expect(local).toMatchObject({ baseUrl: 'http://127.0.0.1:6832', databaseId: 'northwind_evidence' });
  });

  it('never offers recovery collections: only declared collections exist for the viewer', () => {
    const ids = declaredShippingLogs.flatMap((source) => source.collections.map((c) => c.id));
    expect(ids.some((id) => /recovery/i.test(id))).toBe(false);
  });

  it.each([
    ['a non-loopback http database', (f: any) => { f.sources[0].database = 'http://ovdb.example.test/v1/databases/x'; }],
    ['a database URL with credentials', (f: any) => { f.sources[0].database = 'https://u:p@ovdb.example.test/v1/databases/x'; }],
    ['a database URL with a query', (f: any) => { f.sources[0].database = 'https://ovdb.example.test/v1/databases/x?y=1'; }],
    ['a reserved identifier param', (f: any) => { f.sources[0].identifiers[0].param = 'collection'; }],
    ['a repeated identifier param', (f: any) => { f.sources[0].identifiers[1].param = 'order'; }],
    ['an unknown identifier type', (f: any) => { f.sources[0].identifiers[0].type = 'number'; }],
    ['an unknown role', (f: any) => { f.sources[0].fields.level = 'kind'; }],
    ['a missing message role', (f: any) => { delete f.sources[0].fields.message; }],
    ['a window with an offset', (f: any) => { f.sources[0].window.from = '2018-04-01T00:00:00+02:00'; }],
    ['a record mapped to an undeclared identifier', (f: any) => { f.sources[0].records[0].param = 'customer'; }],
    ['a repeated source id', (f: any) => { f.sources[1].id = 'shipping-logs'; }],
    ['an unknown format', (f: any) => { f.format = 'datatug-log-sources/v2'; }],
  ])('refuses the whole file for %s', (_name, change) => {
    const file = clone();
    change(file);
    expect(() => parseLogSources(file)).toThrow();
  });

  it('splits only https or loopback-http OVDB database URLs', () => {
    expect(splitOvdbDatabaseUrl('https://ovdb.demodb.dev/v1/databases/shipping-logs')).toEqual({ baseUrl: 'https://ovdb.demodb.dev', databaseId: 'shipping-logs' });
    expect(splitOvdbDatabaseUrl('http://[::1]:6832/v1/databases/x')).toEqual({ baseUrl: 'http://[::1]:6832', databaseId: 'x' });
    expect(splitOvdbDatabaseUrl('javascript:alert(1)//v1/databases/x')).toBeUndefined();
  });

  it('converts typed identifier values and refuses an integer that does not parse', () => {
    const [order, attempt] = declaredShippingLogs[0].identifiers;
    expect(identifierValue(order, '11045')).toBe(11045);
    expect(identifierValue(order, '11045x')).toBeUndefined();
    expect(identifierValue(attempt, 'attempt-11045-1')).toBe('attempt-11045-1');
  });

  it('links records to logs by database and collection, accepting the legacy DemoDB base', () => {
    expect(relatedLogEvidenceLinks(declaredShippingLogs, 'https://demodb.dev/ovdb/v1/databases/shipping/', 'requests')).toEqual([{
      collection: 'requests', field: 'order_id', path: '/demo/logs', queryParam: 'order',
      queryParams: { source: 'shipping-logs' }, label: 'Related log evidence · Shipping logs',
    }]);
    expect(relatedLogEvidenceLinks(declaredShippingLogs, 'https://ovdb.demodb.dev/v1/databases/northwind', 'requests')).toEqual([]);
    expect(relatedLogEvidenceLinks(declaredShippingLogs, undefined, 'requests')).toEqual([]);
  });

  it('links logs back to a record only when the app has a page for its database', () => {
    const [northwindOrders, shippingRequests] = declaredShippingLogs[0].records;
    expect(recordRoute(northwindOrders, '11045')).toEqual({ commands: ['/demo', 'sqlite', 'northwind', 'table', 'Orders'], queryParams: { record: '11045' } });
    expect(recordRoute(shippingRequests, '11045')).toBeUndefined();
    expect(recordRoute(northwindOrders, '')).toBeUndefined();
  });
});
