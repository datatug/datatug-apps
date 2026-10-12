import { parseTugQL } from '@dalgo/core';
import type { IQueryRelationshipBinding } from '../../../models/definition/query-def';
import { inspectAuthorParticipatingSources, removeAuthorCustomerJoin } from './author-participating-sources';

const binding: IQueryRelationshipBinding = {
  id: 'FK_Invoice_Customer_CustomerId',
  version: 'fixture:Invoice.CustomerId->Customer.CustomerId:v1',
  from: { schema: 'main', table: 'Invoice' },
  to: { schema: 'main', table: 'Customer' },
  pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
};

const joined = `parameters (
  @CustomerId integer required
)
from Invoice as i
join Customer as c
  on i.CustomerId = c.CustomerId
where i.CustomerId = @CustomerId
order by i.InvoiceId
limit 100
select i.InvoiceId, i.InvoiceDate, c.FirstName, c.Email
`;

it('lists actual current FROM and JOIN occurrences from the draft', () => {
  const inventory = inspectAuthorParticipatingSources(joined);
  expect(inventory.available).toBe(true);
  expect(inventory.customerJoined).toBe(true);
  expect(inventory.sources.map(({ kind, name, alias }) => ({ kind, name, alias }))).toEqual([
    { kind: 'main', name: 'Invoice', alias: 'i' },
    { kind: 'join', name: 'Customer', alias: 'c' },
  ]);
  expect(inventory.sources[1]?.removable).toBe(true);
});
it('shows named structural sources but refuses to invent source ranges for their removal', () => {
  const inventory = inspectAuthorParticipatingSources(`with Recent as (
  from Invoice as i
  limit 2
  select i.InvoiceId
)
from Recent as r
select r.InvoiceId
`);
  expect(inventory.available).toBe(true);
  expect(inventory.sources.map((source) => source.kind)).toContain('cte');
  expect(inventory.sources).toContainEqual(expect.objectContaining({
    kind: 'main',
    name: 'Invoice',
    alias: 'i',
    description: expect.stringContaining('Main FROM source'),
  }));
  expect(inventory.sources.find((source) => source.kind === 'cte')?.removable).toBe(false);
});

it('includes source occurrences inside scalar query joins and CTE bodies', () => {
  const source = [
    'WITH Recent AS (',
    '  FROM Invoice AS i',
    '  LIMIT 1',
    '  SELECT i.InvoiceId',
    ')',
    'FROM Invoice AS r',
    'JOIN Customer AS outerCustomer',
    '  ON r.CustomerId = outerCustomer.CustomerId',
    'SELECT (',
    '  Latest AS (',
    '    FROM Customer AS c',
    '    JOIN Invoice AS i2',
    '      ON c.CustomerId = i2.CustomerId',
    '    LIMIT 1',
    '    SELECT c.CustomerId',
    '  )',
    ')',
  ].join('\n');
  const inventory = inspectAuthorParticipatingSources(source);
  expect(inventory.available).toBe(true);
  expect(inventory.sources.map(({ name }) => name)).toEqual(
    expect.arrayContaining(['Recent', 'Invoice', 'Customer']),
  );
  // The outer query has already found a Customer join before it reaches the
  // scalar SELECT and WITH body. Traversal must still visit both later bodies.
  expect(inventory.sources.filter(({ name }) => name === 'Invoice')).toHaveLength(3);
  expect(inventory.sources.filter(({ name }) => name === 'Customer')).toHaveLength(1);
  expect(inventory.sources.find(({ scope }) => scope === 'Within WITH Recent')).toBeDefined();
  expect(inventory.sources.find(({ scope }) => scope === 'Within scalar Latest')).toBeDefined();
  expect(inventory.sources.find(({ kind, name }) => kind === 'subquery' && name === 'Latest'))
    .toMatchObject({ description: expect.stringContaining('FROM Customer as c') });
});

it('does not present a partial ON predicate as complete source metadata', () => {
  const source = joined.replace(
    'on i.CustomerId = c.CustomerId',
    'on i.CustomerId = c.CustomerId and i.InvoiceId = c.CustomerId',
  );
  const inventory = inspectAuthorParticipatingSources(source);
  expect(inventory.available).toBe(true);
  expect(inventory.sources.find(({ kind }) => kind === 'join')?.description)
    .toContain('Predicate details unavailable for this structure');
  expect(inventory.sources.find(({ kind }) => kind === 'join')?.removable).toBe(false);
});

it.each([
  ['CustomerId', false],
  ['Customer.CustomerId', true],
])('admits an unaliased Customer join only with an explicit Customer qualifier (%s)', (qualifier, removable) => {
  const inventory = inspectAuthorParticipatingSources(`from Invoice as i
join Customer
  on i.CustomerId = ${qualifier}
select i.InvoiceId
`);
  expect(inventory.customerJoined).toBe(removable);
  expect(inventory.sources.find(({ kind }) => kind === 'join')?.removable).toBe(removable);
});

it('refuses to advertise a Customer join as removable for an unadmitted main table', () => {
  const inventory = inspectAuthorParticipatingSources(`from Other as i
join Customer as c
  on i.CustomerId = c.CustomerId
limit 2
select i.InvoiceId, c.FirstName
`);
  expect(inventory.sources[1]).toMatchObject({ removable: false });
});

it.each([
  ['from other.Invoice as i\njoin Customer as c\n  on i.CustomerId = c.CustomerId\nselect i.InvoiceId', 'main'],
  ['from Invoice as i\njoin other.Customer as c\n  on i.CustomerId = c.CustomerId\nselect i.InvoiceId', 'join'],
  ['from other.Invoice as i\njoin other.Customer as c\n  on i.CustomerId = c.CustomerId\nselect i.InvoiceId', 'both'],
])('keeps qualified non-main table identities out of admitted metadata (%s)', (source, _caseName) => {
  const inventory = inspectAuthorParticipatingSources(source);
  expect(inventory.available).toBe(true);
  const main = inventory.sources.find((item) => item.kind === 'main');
  const join = inventory.sources.find((item) => item.kind === 'join');
  if (_caseName !== 'join') expect(main?.schema).toBe('other');
  if (_caseName !== 'main') expect(join?.schema).toBe('other');
  expect(inventory.sources.filter((item) => item.kind === 'join').every((item) => !item.removable)).toBe(true);
});

it('walks definitions nested inside CTE query bodies', () => {
  const source = `with RecentAlbums as (
  with NestedAlbums as (
    from Album as a
    limit 1
    select (
      a.AlbumId
    )
  )
  from NestedAlbums as albumRows
  limit 1
  select (
    albumRows.AlbumId
  )
)
from RecentAlbums as recentRows
limit 1
select (
  recentRows.AlbumId
)
`;
  const inventory = inspectAuthorParticipatingSources(source);
  expect(inventory.available, JSON.stringify(parseTugQL(source).diagnostics)).toBe(true);
  expect(inventory.sources).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'cte', name: 'NestedAlbums', scope: 'Within WITH RecentAlbums' }),
    expect.objectContaining({ kind: 'main', name: 'Album', scope: 'Within WITH NestedAlbums' }),
  ]));
});

it('removes the admitted join and all dependent direct Customer outputs atomically', () => {
  const result = removeAuthorCustomerJoin(joined, binding);
  expect(result).toMatchObject({
    ok: true,
    removedOutputs: ['FirstName', 'Email'],
  });
  if (!result.ok) throw new Error(result.reason);
  expect(result.after).toBe(`parameters (
  @CustomerId integer required
)
from Invoice as i
where i.CustomerId = @CustomerId
order by i.InvoiceId
limit 100
select i.InvoiceId, i.InvoiceDate
`);
});

it('supports exact line removal in a block projection while preserving CRLF', () => {
  const source = `parameters (\r\n  @CustomerId integer required\r\n)\r\nfrom Invoice as i\r\njoin Customer as c\r\n  on i.CustomerId = c.CustomerId\r\nwhere i.CustomerId = @CustomerId\r\nlimit 10\r\nselect (\r\n  i.InvoiceId\r\n  i.InvoiceDate\r\n  c.FirstName\r\n)\r\n`;
  const result = removeAuthorCustomerJoin(source, binding);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  expect(result.after).toContain('  i.InvoiceDate\r\n)\r\n');
  expect(result.after).not.toContain('c.FirstName');
  expect(result.after.includes('\n') && !result.after.includes('\r\n')).toBe(false);
});

it('preserves standalone comments between removed Customer projection lines', () => {
  const source = joined.replace(
    'select i.InvoiceId, i.InvoiceDate, c.FirstName, c.Email',
    'select (\n  i.InvoiceId\n  i.InvoiceDate\n  c.FirstName as GivenName\n  -- keep this query note\n  c.Email as Contact\n)',
  );
  const result = removeAuthorCustomerJoin(source, binding);
  expect(result).toMatchObject({ ok: true, removedOutputs: ['GivenName', 'Contact'] });
  if (!result.ok) throw new Error(result.reason);
  expect(result.after).toContain('  -- keep this query note\n');
  expect(result.after).toContain('  i.InvoiceDate\n  -- keep this query note\n)');
});

it('reports aliased output names for compact projections', () => {
  const source = joined.replace(
    'c.FirstName, c.Email',
    'c.FirstName as GivenName, c.Email as Contact',
  );
  const result = removeAuthorCustomerJoin(source, binding);
  expect(result).toMatchObject({ ok: true, removedOutputs: ['GivenName', 'Contact'] });
});

it.each([
  [joined.replace('where i.CustomerId = @CustomerId', 'where c.Email = @CustomerId'), 'Only the admitted Invoice.CustomerId filter'],
  [joined.replace('order by i.InvoiceId', 'group by i.InvoiceId\nhaving count(*) > 1'), 'Filters, grouping'],
  [joined.replace('order by i.InvoiceId', 'order by c.FirstName'), 'ORDER BY'],
  [joined.replace('select i.InvoiceId, i.InvoiceDate, c.FirstName, c.Email', 'select i.InvoiceId, i.InvoiceDate, c.FirstName as GivenName, c.Email').replace('order by i.InvoiceId', 'order by GivenName'), 'ORDER BY'],
  [joined.replace('select i.InvoiceId, i.InvoiceDate, c.FirstName, c.Email', 'select i.InvoiceId as ID, c.FirstName as InvoiceId, c.Email').replace('order by i.InvoiceId', 'order by InvoiceId'), 'ORDER BY'],
  [joined.replace('select i.InvoiceId, i.InvoiceDate, c.FirstName, c.Email', 'select i.InvoiceId, FirstName, c.FirstName, c.Email'), 'not proven to belong to Invoice'],
  [joined.replace('select i.InvoiceId, i.InvoiceDate, c.FirstName, c.Email', 'select i.InvoiceId, c.FirstName, i.InvoiceDate, c.Email'), 'source ranges do not match'],
  [joined.replace('join Customer as c\n  on i.CustomerId = c.CustomerId', 'join Customer as c\n  on i.CustomerId = c.CustomerId\njoin Customer as c2\n  on i.CustomerId = c2.CustomerId'), 'Only one admitted'],
])('leaves unsupported source dependencies untouched: %s', (source, reason) => {
  const result = removeAuthorCustomerJoin(source, binding);
  expect(result).toMatchObject({ ok: false, reason: expect.stringContaining(reason) });
});
