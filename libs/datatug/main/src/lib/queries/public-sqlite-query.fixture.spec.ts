import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseTugQL, resolveTugQL } from '@dalgo/core';
import { compilePublicSqliteTugQL, preparePublicSqliteCteStructuralDocument } from './public-sqlite-tugql';
import { executePinnedSql } from './public-sqlite-query.worker';

const fixturePath = process.env['DATATUG_CHINOOK_FIXTURE'];
const sqlPath = process.env['DATATUG_CHINOOK_GENRE_SQL'];

it.skipIf(!fixturePath || !sqlPath)(
  'runs the saved Customer Genre Mix against the pinned Chinook fixture',
  async () => {
    if (!sqlPath || !fixturePath)
      throw new Error('The pinned Chinook fixture and saved SQL are required.');
    const sql = readFileSync(sqlPath, 'utf8');
    const fixture = readFileSync(fixturePath);
    const result = await executePinnedSql(sql, fixture);
    expect(result.columns).toEqual([
      'GenreId',
      'Genre',
      'InvoiceCount',
      'TotalCents',
    ]);
    expect(result.rows).toEqual([
      [1, 'Rock', 4, 1485],
      [3, 'Metal', 2, 594],
      [19, 'TV Shows', 1, 398],
      [4, 'Alternative & Punk', 2, 396],
      [9, 'Pop', 1, 396],
      [2, 'Jazz', 1, 297],
      [7, 'Latin', 1, 297],
      [21, 'Drama', 1, 199],
    ]);
  },
);

it.skipIf(!fixturePath)(
  'executes the bounded CTE graph and its SQL-ordered proof against the pinned Chinook fixture',
  async () => {
    if (!fixturePath) throw new Error('The pinned Chinook fixture is required.');
    const fixture = readFileSync(fixturePath);
    const fixtureSha256 = createHash('sha256').update(fixture).digest('hex');
    expect(fixtureSha256).toBe('7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15');
    const source = `parameters (
  @CustomerId integer required
)
with CustomerCounts as (
  from Invoice as i
  where i.CustomerId = @CustomerId
  group by i.CustomerId
  having count(*) >= 7
  limit 100
  select (
    i.CustomerId
    count(*) as InvoiceCount
  )
)
with EligibleCounts as (
  from CustomerCounts as counts
  where counts.InvoiceCount >= 7
  limit 100
  select (
    counts.CustomerId
    counts.InvoiceCount
  )
)
with CustomerFields as (
  from Customer as c
  order by c.CustomerId asc
  limit 100
  select (
    c.CustomerId
    c.FirstName
    c.LastName
    c.Email
  )
)
from EligibleCounts as totals
join CustomerFields as customer
  on totals.CustomerId = customer.CustomerId
order by totals.CustomerId asc
limit 10
select (
  totals.CustomerId
  totals.InvoiceCount
  customer.FirstName
  customer.LastName
  customer.Email
)
`;
    const parsed = parseTugQL(source);
    expect(parsed.diagnostics).toEqual([]);
    const structuralDocument = preparePublicSqliteCteStructuralDocument(parsed.document);
    const authorization = resolveTugQL(structuralDocument, {
      authorizedSchemas: [{
        version: 'invoice-schema-v1',
        tables: [
          { name: 'Invoice', fields: [
            { name: 'CustomerId', type: 'integer', authorized: true },
            { name: 'InvoiceId', type: 'integer', authorized: true },
          ] },
          { name: 'Customer', fields: [
            { name: 'CustomerId', type: 'integer', authorized: true },
            { name: 'FirstName', type: 'string', authorized: true },
            { name: 'LastName', type: 'string', authorized: true },
            { name: 'Email', type: 'string', authorized: true },
          ] },
        ],
      }],
      relationships: [],
      pinnedImports: [],
      bindings: [],
    });
    expect(authorization.diagnostics).toEqual([]);
    if (!authorization.resolved) throw new Error('Expected Core to resolve the bounded CTE source.');
    const plan = compilePublicSqliteTugQL(authorization.resolved, {
      fixtureSha256,
      schemaVersion: 'invoice-schema-v1',
      draftRevision: 1,
      authoredSource: source,
    });
    const bindings = [1, ...plan.fixedBindings];
    expect(plan.bindingNames).toEqual(['CustomerId', 'HAVING threshold (literal)', 'WHERE literal']);
    const runPlan = (candidate = plan, candidateBindings = bindings, candidateNames = candidate.bindingNames, candidateColumns = candidate.outputColumns) => executePinnedSql(
      candidate.sql,
      fixture,
      candidateBindings,
      true,
      true,
      candidateColumns?.map((column) => column.name),
      candidate.authorProof,
      candidateNames,
      candidate.schemaVersion,
      candidate.draftRevision,
      candidate.authorProof.profile,
      candidate.fixtureSha256,
      candidateColumns,
    );
    await expect(runPlan()).resolves.toMatchObject({
      columns: ['CustomerId', 'InvoiceCount', 'FirstName', 'LastName', 'Email'],
      rows: [[1, 7, 'Luís', 'Gonçalves', 'luisg@embraer.com.br']],
    });
    await expect(runPlan({ ...plan, sql: `${plan.sql} -- altered` })).rejects.toThrow('independently compiled profile');
    await expect(runPlan(plan, [1, 7, 8])).rejects.toThrow('independently compiled profile');
    await expect(runPlan(plan, bindings, ['CustomerId', 'Count', 'Threshold'])).rejects.toThrow('independently compiled profile');
    const alteredOutputColumns = plan.outputColumns?.map((column, index) => index === 0 ? { ...column, lineage: [] } : column);
    await expect(runPlan(plan, bindings, plan.bindingNames, alteredOutputColumns)).rejects.toThrow('independently compiled profile');
    const alteredResolvedQuery = {
      ...structuredClone(plan.authorProof.resolvedQuery),
      limit: 9,
    };
    await expect(runPlan({
      ...plan,
      authorProof: { ...plan.authorProof, resolvedQuery: alteredResolvedQuery },
    })).rejects.toThrow('worker resolved AST differs from the Author proof');
    await expect(runPlan({
      ...plan,
      authorProof: {
        ...plan.authorProof,
        authoredSource: source.replace('having count(*) >= 7', 'having count(*) >= 8'),
      },
    })).rejects.toThrow('worker resolved AST differs from the Author proof');

    const zeroThresholdSource = source.replace('where counts.InvoiceCount >= 7', 'where counts.InvoiceCount >= 8');
    const zeroParsed = parseTugQL(zeroThresholdSource);
    expect(zeroParsed.diagnostics).toEqual([]);
    const zeroAuthorization = resolveTugQL(
      preparePublicSqliteCteStructuralDocument(zeroParsed.document),
      {
        authorizedSchemas: [{
          version: 'invoice-schema-v1',
          tables: [
            { name: 'Invoice', fields: [
              { name: 'CustomerId', type: 'integer', authorized: true },
              { name: 'InvoiceId', type: 'integer', authorized: true },
            ] },
            { name: 'Customer', fields: [
              { name: 'CustomerId', type: 'integer', authorized: true },
              { name: 'FirstName', type: 'string', authorized: true },
              { name: 'LastName', type: 'string', authorized: true },
              { name: 'Email', type: 'string', authorized: true },
            ] },
          ],
        }],
        relationships: [],
        pinnedImports: [],
        bindings: [],
      },
    );
    expect(zeroAuthorization.diagnostics).toEqual([]);
    if (!zeroAuthorization.resolved) throw new Error('Expected Core to resolve the zero-row bounded CTE source.');
    const zeroPlan = compilePublicSqliteTugQL(zeroAuthorization.resolved, {
      fixtureSha256,
      schemaVersion: 'invoice-schema-v1',
      draftRevision: 2,
      authoredSource: zeroThresholdSource,
    });
    await expect(executePinnedSql(
      zeroPlan.sql,
      fixture,
      [1, ...zeroPlan.fixedBindings],
      true,
      true,
      zeroPlan.outputColumns?.map((column) => column.name),
      zeroPlan.authorProof,
      zeroPlan.bindingNames,
      zeroPlan.schemaVersion,
      zeroPlan.draftRevision,
      zeroPlan.authorProof.profile,
      zeroPlan.fixtureSha256,
      zeroPlan.outputColumns,
    )).resolves.toMatchObject({
      columns: ['CustomerId', 'InvoiceCount', 'FirstName', 'LastName', 'Email'],
      rows: [],
    });
  },
);
