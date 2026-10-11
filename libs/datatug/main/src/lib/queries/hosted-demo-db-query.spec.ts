import { isJoinedDTQLQuery, parseDTQL } from '@dalgo/core';
import { describe, expect, it } from 'vitest';
import {
  QueryType,
  type IQueryDef,
  type ITextQueryRequest,
} from '../models/definition/query-def';

function textRequest(definition: IQueryDef): string {
  if (definition.request.queryType !== QueryType.DTQL) {
    throw new Error('Expected a text-based DTQL definition.');
  }
  return (definition.request as ITextQueryRequest).text;
}
import {
  createHostedDemoDbQuery,
  HOSTED_DEMO_DB_OVDB_BASE_URL,
  HOSTED_DEMO_DB_SOURCES,
  hostedDemoDbSourceId,
  isHostedDemoDbStarterQuery,
  withHostedDemoDbSource,
} from './hosted-demo-db-query';

describe('hosted DemoDB query definitions', () => {
  it.each(HOSTED_DEMO_DB_SOURCES)('creates a reloadable DTQL definition for $id', (source) => {
    const initial = createHostedDemoDbQuery('query-1');
    const selected = withHostedDemoDbSource(initial, source.id);
    expect(isHostedDemoDbStarterQuery(selected)).toBe(true);
    const tables = selected.federation?.tables;
    if (!tables) throw new Error('Expected hosted source table metadata.');
    const parsed = parseDTQL(textRequest(selected), { tables });
    if (!isJoinedDTQLQuery(parsed)) throw new Error('Expected relation query model.');

    expect(selected.request.queryType).toBe(QueryType.DTQL);
    expect(selected.federation).toMatchObject({
      ovdbBaseUrl: HOSTED_DEMO_DB_OVDB_BASE_URL,
      tables: [{
        database: source.database,
        name: source.name,
        ...(source.schema ? { schema: source.schema } : {}),
        fields: source.fields,
      }],
    });
    expect(parsed.from).toMatchObject({
      database: source.database,
      name: source.name,
      ...(source.schema ? { schema: source.schema } : {}),
    });
    expect(parsed.from.joins).toHaveLength(0);

    // Model a query-definition reload: both selected source and executable body
    // come from the same persisted IQueryDef, with no client-only selector state.
    const reloaded = JSON.parse(JSON.stringify(selected)) as typeof selected;
    if (!reloaded.federation?.tables) throw new Error('Expected reloaded table metadata.');
    expect(hostedDemoDbSourceId(reloaded)).toBe(source.id);
    const reloadedQuery = parseDTQL(textRequest(reloaded), {
      tables: reloaded.federation.tables,
    });
    if (!isJoinedDTQLQuery(reloadedQuery)) throw new Error('Expected relation query model.');
    expect(reloadedQuery.from.name).toBe(source.name);
  });

  it('hides the destructive source picker after the user authors a custom or joined body', () => {
    const initial = withHostedDemoDbSource(
      createHostedDemoDbQuery('query-1'),
      'chinook.Customer',
    );
    const federation = initial.federation;
    if (!federation || initial.request.queryType !== QueryType.DTQL)
      throw new Error('Expected the hosted DemoDB starter definition');
    const custom = {
      ...initial,
      request: {
        queryType: QueryType.DTQL,
        text: `${textRequest(initial)}where:\n  field: Country\n  op: ==\n  value: IE\n`,
      } as ITextQueryRequest,
    };
    const joined = {
      ...initial,
      federation: {
        ...federation,
        tables: [...federation.tables, { database: 'chinook', name: 'Invoice', fields: ['InvoiceId'] }],
      },
    };

    expect(isHostedDemoDbStarterQuery(custom)).toBe(false);
    expect(hostedDemoDbSourceId(joined)).toBeUndefined();
    expect(isHostedDemoDbStarterQuery(joined)).toBe(false);
  });

  it.each([
    ['lookup', { lookups: [{ database: 'music', collection: 'Album', fromColumn: 'CustomerId', fields: [{ source: 'Title', target: 'AlbumTitle' }] }] }],
    ['bounds', { bounds: { runtime: { maxRows: 10 } } }],
    ['server identity', { expectedServerIdentity: { baseUrl: HOSTED_DEMO_DB_OVDB_BASE_URL, serverId: 'server-1' } }],
    ['source rights', { expectedSourceRights: [{ database: 'chinook', collection: 'Customer', right: 'read' }] }],
    ['native graph plan', { nativeGraph: { version: 1 } }],
    ['read receipt', { readReceipt: { status: 'complete' } }],
  ])('does not offer or apply source replacement when federation has %s metadata', (_label, metadata) => {
    const starter = createHostedDemoDbQuery('query-1');
    const enriched = {
      ...starter,
      federation: { ...starter.federation, ...metadata },
    } as typeof starter;

    expect(isHostedDemoDbStarterQuery(enriched)).toBe(false);
    expect(() => withHostedDemoDbSource(enriched, 'adventureworks.Person.Person')).toThrow(
      'Only an unchanged hosted DemoDB starter query can switch sources.',
    );
    expect(enriched.federation).toMatchObject(metadata);
  });

  it('rejects custom table field metadata before replacing a source', () => {
    const starter = createHostedDemoDbQuery('query-1');
    const federation = starter.federation;
    if (!federation) throw new Error('Expected starter federation metadata');
    const table = federation.tables[0];
    if (!table) throw new Error('Expected starter table metadata');
    const enriched = {
      ...starter,
      federation: {
        ...federation,
        tables: [{ ...table, fields: [...table.fields, 'CustomField'] }],
      },
    };

    expect(isHostedDemoDbStarterQuery(enriched)).toBe(false);
    expect(() => withHostedDemoDbSource(enriched, 'adventureworks.Person.Person')).toThrow();
    expect(enriched.federation?.tables[0].fields).toContain('CustomField');
  });
});
