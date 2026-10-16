import { QueryType } from '../models/definition/query-def';
import { PUBLIC_CHINOOK_FIXTURE_SHA256 } from '../queries/public-sqlite-source-identity';
import { ContextCapabilities } from './session-context-contract';
import { queryContextScope } from './session-query-scope';
const chinook = {
  environmentId: 'demo',
  identityDomain: 'chinook-domain',
  title: 'Invoices',
  querySources: [
    {
      kind: 'public-sqlite' as const,
      connectionId: 'chinook-sqlite',
      databaseId: 'chinook',
      fixtureSha256: PUBLIC_CHINOOK_FIXTURE_SHA256,
    },
  ],
};
const embedded = {
  environmentId: 'demo',
  identityDomain: 'embedded-domain',
  title: 'Invoices',
  querySources: [
    {
      kind: 'hosted-embedded' as const,
      origin: 'https://detective-demo.internal',
      databaseId: 'invoices-db',
      fixtureSha256: 'a'.repeat(64),
      catalogRevision: 'b'.repeat(64),
    },
  ],
};
const caps: ContextCapabilities = {
  schemaVersion: 1,
  actorId: 'alice',
  databaseId: 'db',
  projectId: 'p',
  actions: [],
  environments: [embedded, chinook],
};
const query = {
  id: 'q',
  connectionId: 'chinook-sqlite',
  request: { queryType: QueryType.SQL, text: 'select InvoiceId from Invoice' },
};
it('selects concrete Chinook source among two identically labelled invoice domains in one environment', () => {
  expect(queryContextScope(caps, 'demo', query)).toEqual({
    environmentId: 'demo',
    identityDomain: 'chinook-domain',
  });
  expect(
    queryContextScope(
      { ...caps, environments: [chinook, embedded] },
      'demo',
      query,
    ),
  ).toEqual({ environmentId: 'demo', identityDomain: 'chinook-domain' });
});
it('fails closed for missing source mapping, changed fixture and duplicate concrete source domains', () => {
  expect(
    queryContextScope(
      { ...caps, environments: [{ ...chinook, querySources: [] }] },
      'demo',
      query,
    ),
  ).toBeUndefined();
  expect(
    queryContextScope(
      {
        ...caps,
        environments: [
          {
            ...chinook,
            querySources: [
              { ...chinook.querySources[0], fixtureSha256: 'c'.repeat(64) },
            ],
          },
        ],
      },
      'demo',
      query,
    ),
  ).toBeUndefined();
  expect(
    queryContextScope(
      {
        ...caps,
        environments: [chinook, { ...chinook, identityDomain: 'other' }],
      },
      'demo',
      query,
    ),
  ).toBeUndefined();
  expect(queryContextScope(caps, 'prod', query)).toBeUndefined();
});
it('does not use matching Invoice columns or display labels as source identity', () => {
  expect(
    queryContextScope(caps, 'demo', { ...query, connectionId: 'invoices-db' }),
  ).toBeUndefined();
});

it('preserves only the legacy single admitted domain for generic custom SQL adapters', () => {
  const custom = { environmentId: 'qa', identityDomain: 'sqlserver-orders' };
  const sql = { ...query, connectionId: 'configured-sqlserver' };
  expect(
    queryContextScope({ ...caps, environments: [custom] }, 'qa', sql),
  ).toEqual(custom);
  expect(
    queryContextScope(
      {
        ...caps,
        environments: [
          custom,
          { ...custom, identityDomain: 'other-custom-source' },
        ],
      },
      'qa',
      sql,
    ),
  ).toBeUndefined();
  expect(
    queryContextScope(
      { ...caps, environments: [{ ...custom, querySources: [] }] },
      'qa',
      sql,
    ),
  ).toBeUndefined();
});
