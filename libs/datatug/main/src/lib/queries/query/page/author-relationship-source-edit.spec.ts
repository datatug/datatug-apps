import type { IQueryRelationshipBinding } from '../../../models/definition/query-def';
import { reviewAuthorRelationshipSource } from './author-relationship-source-edit';

const binding: IQueryRelationshipBinding = {
  id: 'FK_Invoice_Customer_CustomerId',
  version: 'fixture:Invoice.CustomerId->Customer.CustomerId:v1',
  from: { schema: 'main', table: 'Invoice' },
  to: { schema: 'main', table: 'Customer' },
  pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
};

const source = `parameters (
  @CustomerId integer required
)
from Invoice as i
where i.CustomerId = @CustomerId
limit 100
select i.InvoiceId, i.InvoiceDate
`;

it('reviews a source-preserving compact join, order, and selected Customer field', () => {
  const result = reviewAuthorRelationshipSource(source, ['FirstName'], binding);
  if (!result.ok) throw new Error(result.reason);
  expect(result.ok).toBe(true);
  expect(result.review.after).toBe(`parameters (
  @CustomerId integer required
)
from Invoice as i
join Customer as c
  on i.CustomerId = c.CustomerId
where i.CustomerId = @CustomerId
order by i.InvoiceId
limit 100
select i.InvoiceId, i.InvoiceDate, c.FirstName
`);
  expect(result.review.after.replace('join Customer as c\n  on i.CustomerId = c.CustomerId\n', ''))
    .toContain('where i.CustomerId = @CustomerId\n');
  expect(result.review.relationship).toEqual(binding);
});

it('preserves CRLF, case, aliases, inline comments, parameters, and block SELECT items', () => {
  const crlf = `PARAMETERS (\r\n  @CustomerId INTEGER REQUIRED\r\n)\r\nFROM Invoice AS inv -- keep this\r\nWHERE inv.CustomerId = @CustomerId\r\nLIMIT 7\r\nSELECT (\r\n  inv.InvoiceId\r\n  inv.InvoiceDate\r\n)\r\n`;
  const result = reviewAuthorRelationshipSource(crlf, ['Email'], binding);
  if (!result.ok) throw new Error(result.reason);
  expect(result.ok).toBe(true);
  expect(result.review.after).toContain('FROM Invoice AS inv -- keep this\r\nJOIN Customer AS c\r\n  ON inv.CustomerId = c.CustomerId\r\n');
  expect(result.review.after).toContain('ORDER BY inv.InvoiceId\r\nLIMIT 7\r\n');
  expect(result.review.after).toContain('  inv.InvoiceDate\r\n  c.Email\r\n)\r\n');
  expect(result.review.after).toContain('@CustomerId INTEGER REQUIRED\r\n');
  expect(result.review.after.includes('\n') && !result.review.after.includes('\r\n')).toBe(false);
});

it('allows a deliberate JOIN-only review and retains an existing stable order', () => {
  const ordered = source.replace('limit 100', 'order by i.InvoiceId asc\nlimit 100');
  const result = reviewAuthorRelationshipSource(ordered, [], binding);
  if (!result.ok) throw new Error(result.reason);
  expect(result.ok).toBe(true);
  expect(result.review.after).toContain('order by i.InvoiceId asc\nlimit 100');
  expect(result.review.after).not.toContain('c.FirstName');
  expect(result.review.after.match(/order by/giu)).toHaveLength(1);
});

it('inserts before authored whitespace and preserves Unicode inline comments byte-for-byte', () => {
  const compact = `parameters (\n  @CustomerId integer required\n)\nfrom Invoice as i\nwhere i.CustomerId = @CustomerId\nlimit 3\nselect i.InvoiceId, i.InvoiceDate   -- keep 東京 exactly\n`;
  const result = reviewAuthorRelationshipSource(compact, ['FirstName'], binding);
  if (!result.ok) throw new Error(result.reason);
  expect(result.ok).toBe(true);
  expect(result.review.after).toContain(
    'select i.InvoiceId, i.InvoiceDate, c.FirstName   -- keep 東京 exactly\n',
  );
});

it.each([
  [source.replace('select i.InvoiceId, i.InvoiceDate', 'select i.InvoiceId as FirstName, i.InvoiceDate'), 'duplicate output names'],
  [source.replace('limit 100', 'limit 0'), 'LIMIT 1–100'],
  [source.replace('where i.CustomerId = @CustomerId', 'where i.InvoiceId = @CustomerId'), 'declared @CustomerId Invoice filter'],
  [source.replace('from Invoice as i', 'with X as (\n  from Invoice as i\n  select i.InvoiceId\n)\nfrom X as i'), 'CTE and saved-query import'],
  [source.replace('limit 100', 'order by i.InvoiceDate desc\nlimit 100'), 'ascending InvoiceId ordering'],
])('refuses unsupported or ambiguous source without proposing a mutation', (candidate, reason) => {
  const result = reviewAuthorRelationshipSource(candidate, ['FirstName'], binding);
  expect(result).toMatchObject({ ok: false });
  if (result.ok) throw new Error('Expected the source to be refused.');
  expect(result.reason).toContain(reason);
});

it('enforces the joined six-column limit and the exact declared relationship pin', () => {
  const sixColumns = source.replace(
    'select i.InvoiceId, i.InvoiceDate',
    'select i.InvoiceId, i.InvoiceDate, i.CustomerId, i.InvoiceId as A, i.InvoiceDate as B',
  );
  const tooMany = reviewAuthorRelationshipSource(sixColumns, ['FirstName', 'LastName'], binding);
  expect(tooMany).toMatchObject({ ok: false, reason: expect.stringContaining('six output columns') });
  const wrongBinding = { ...binding, pairs: [{ fromField: 'InvoiceId', toField: 'CustomerId' }] };
  expect(reviewAuthorRelationshipSource(source, ['FirstName'], wrongBinding)).toMatchObject({ ok: false });
});

it.each([
  [source.replace('where i.CustomerId', 'where CustomerId'), 'Qualify Invoice.CustomerId'],
  [source.replace('select i.InvoiceId, i.InvoiceDate', 'select i.InvoiceId, InvoiceDate, CustomerId'), 'Qualify the Invoice.CustomerId projection'],
])('refuses unqualified CustomerId references before they become ambiguous', (candidate, reason) => {
  const result = reviewAuthorRelationshipSource(candidate, ['FirstName'], binding);
  expect(result).toMatchObject({ ok: false });
  if (result.ok) throw new Error('Expected the ambiguous source to be refused.');
  expect(result.reason).toContain(reason);
  expect(result).not.toHaveProperty('review');
});

it('allows a six-column JOIN-only review but refuses any seventh output', () => {
  const sixColumns = source.replace(
    'select i.InvoiceId, i.InvoiceDate',
    'select i.InvoiceId as A, i.InvoiceDate as B, i.CustomerId as C, i.InvoiceId as D, i.InvoiceDate as E, i.CustomerId as F',
  );
  const joinOnly = reviewAuthorRelationshipSource(sixColumns, [], binding);
  expect(joinOnly.ok).toBe(true);
  if (!joinOnly.ok) throw new Error(joinOnly.reason);
  expect(joinOnly.review.outputLineage).toHaveLength(6);
  expect(joinOnly.review.after).not.toContain('c.FirstName');

  const appended = reviewAuthorRelationshipSource(sixColumns, ['FirstName'], binding);
  expect(appended).toMatchObject({ ok: false });
  if (appended.ok) throw new Error('Expected the seventh output to be refused.');
  expect(appended.reason).toContain('six output columns');
});
