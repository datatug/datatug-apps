import { parseTugQL, resolveTugQL } from '@dalgo/core';
import type { RecursiveDTQLQuery, RecursiveDTQLRelation, TugQLResolved, TugQLTree } from '@dalgo/core';
import {
  compilePublicSqliteTugQL,
  requireCustomerIdParameterSource,
  requireLiteralHavingThreshold,
  PUBLIC_CHINOOK_CUSTOMER_FK,
  validatePublicSqliteCteSource,
} from './public-sqlite-tugql';

it('preflights independent CTE branches, safe filters, and a bounded explicit leaf join', () => {
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
  const tree = parsed.document.tree;
  if (!tree) throw new Error('Expected parsed TugQL tree.');
  expect(() => validatePublicSqliteCteSource(tree)).not.toThrow();
  expect(() => requireCustomerIdParameterSource(tree)).not.toThrow();
  expect(() => requireLiteralHavingThreshold(tree)).not.toThrow();
  expect(() => validatePublicSqliteCteSource({
    ...tree,
    query: { ...tree.query, ignored: true },
  })).toThrow('unsupported key: ignored');
  expect(() => validatePublicSqliteCteSource({
    ...tree,
    query: { ...tree.query, from: { ...tree.query.from, joins: [] } },
  } as unknown as TugQLTree)).toThrow('referenced exactly once');

  const definitions = [...structuredClone(tree.definitions ?? [])];
  const secondDefinition = definitions[1];
  if (!secondDefinition) throw new Error('Expected at least two CTE definitions.');
  definitions[1] = { ...secondDefinition, name: 'customercounts' };
  expect(() => validatePublicSqliteCteSource({ ...tree, definitions })).toThrow('unique ignoring case');

  const repeated = structuredClone(tree);
  const rootFrom = repeated.query.from as unknown as { joins: unknown[] };
  rootFrom.joins.push({
    from: { name: 'CustomerFields', alias: 'customerAgain' },
    type: 'inner',
    on: [{ op: '==', left: { field: 'CustomerId', source: 'totals' }, right: { field: 'CustomerId', source: 'customerAgain' } }],
  });
  expect(() => validatePublicSqliteCteSource(repeated)).toThrow('referenced exactly once');

  const unusedInvalid = {
    ...structuredClone(tree),
    definitions: [...structuredClone(tree.definitions ?? []), {
    kind: 'cte',
    name: 'Unused',
      query: { definitions: [], query: { ...tree.query, unsafe: true } },
    } as unknown as NonNullable<TugQLTree['definitions']>[number]],
  };
  expect(() => validatePublicSqliteCteSource(unusedInvalid)).toThrow('unsupported key: unsafe');

  const unorderedCustomer = structuredClone(tree);
  const unorderedDefinitions = unorderedCustomer.definitions ?? [];
  const customerDefinition = unorderedDefinitions.find((definition) => definition.kind === 'cte' && definition.name === 'CustomerFields');
  if (!customerDefinition || customerDefinition.kind !== 'cte') throw new Error('Expected the CustomerFields definition.');
  delete (customerDefinition.query.query as unknown as Record<string, unknown>)['orderBy'];
  expect(() => validatePublicSqliteCteSource(unorderedCustomer)).toThrow('physical Customer query must order');

  const imported = structuredClone(tree);
  const importedDefinitions = imported.definitions ?? [];
  const firstDefinition = importedDefinitions[0];
  if (!firstDefinition || firstDefinition.kind !== 'cte') throw new Error('Expected a CTE definition.');
  const importedTree = {
    ...imported,
    definitions: importedDefinitions.map((definition, index) => index === 0
      ? { ...definition, kind: 'import' } as unknown as typeof firstDefinition
      : definition),
  };
  expect(() => validatePublicSqliteCteSource(importedTree)).toThrow('imports are not supported');
});

it('compiles a bounded graph with independent leaves, renamed outputs, and SQL-ordered binding slots', () => {
  const field = (source: string, name: string) => ({ kind: 'field' as const, field: { source, field: name } });
  const literal = (value: number) => ({ kind: 'literal' as const, value });
  const compare = (left: ReturnType<typeof field> | { kind: 'aggregate'; function: 'count'; args: readonly { kind: 'star' }[] }, operator: '>=' | '==', right: ReturnType<typeof literal>) => ({ kind: 'comparison' as const, left, operator, right });
  const relation = (name: string, alias: string): RecursiveDTQLRelation => ({ kind: 'table', name, alias, joins: [] });
  const derived = (query: RecursiveDTQLQuery, alias: string): RecursiveDTQLRelation => ({ kind: 'query', query: { ...query, as: alias }, joins: [] });
  const invoiceCount: RecursiveDTQLQuery = {
    kind: 'recursive-dtql',
    from: relation('Invoice', 'i'),
    groupBy: [field('i', 'CustomerId')],
    having: compare({ kind: 'aggregate', function: 'count', args: [{ kind: 'star' }] }, '>=', literal(7)),
    limit: 100,
    columns: [
      { expression: field('i', 'CustomerId'), as: 'CustomerKey' },
      { expression: { kind: 'aggregate', function: 'count', args: [{ kind: 'star' }] }, as: 'InvoiceCount' },
    ],
  };
  const eligible: RecursiveDTQLQuery = {
    kind: 'recursive-dtql',
    from: derived(invoiceCount, 'counts'),
    where: compare(field('counts', 'InvoiceCount'), '>=', literal(7)),
    limit: 100,
    columns: [
      { expression: field('counts', 'CustomerKey'), as: 'Key' },
      { expression: field('counts', 'InvoiceCount'), as: 'Count' },
    ],
  };
  const customer: RecursiveDTQLQuery = {
    kind: 'recursive-dtql',
    from: relation('Customer', 'i'),
    where: compare(field('i', 'CustomerId'), '>=', literal(1)),
    orderBy: [{ field: { source: 'i', field: 'CustomerId' }, direction: 'asc' }],
    limit: 100,
    columns: [
      { expression: field('i', 'CustomerId'), as: 'CustomerKey' },
      { expression: field('i', 'FirstName') },
      { expression: field('i', 'LastName') },
      { expression: field('i', 'Email') },
    ],
  };
  const rootFrom: RecursiveDTQLRelation = {
    ...derived(customer, 'customer'),
    joins: [{
      type: 'inner',
      from: derived(eligible, 'totals'),
      on: [{ left: { source: 'totals', field: 'Key' }, operator: '==', right: { source: 'customer', field: 'CustomerKey' } }],
    }],
  };
  const root: RecursiveDTQLQuery = {
    kind: 'recursive-dtql',
    from: rootFrom,
    orderBy: [{ field: { source: 'totals', field: 'Key' }, direction: 'asc' }],
    limit: 10,
    columns: [
      { expression: field('totals', 'Key'), as: 'ClientKey' },
      { expression: field('totals', 'Count'), as: 'InvoiceTotal' },
      { expression: field('customer', 'FirstName'), as: 'GivenName' },
    ],
  };
  const resolved = { query: root, columns: [], schemaVersion: 'test', dependencies: [], relationships: [] } as unknown as TugQLResolved;
  const plan = compilePublicSqliteTugQL(resolved, {
    fixtureSha256: 'fixture-sha256',
    schemaVersion: 'test',
    draftRevision: 1,
  });

  expect(plan.authorProof.profile).toBe('bounded-cte-query');
  expect(plan.sql).toContain('ORDER BY "totals"."Key" ASC');
  expect(plan.sql).toContain('INNER JOIN (SELECT');
  expect(plan.bindingSlots).toEqual([
    { kind: 'literal', name: 'WHERE literal', value: 1 },
    { kind: 'customer-id', name: 'CustomerId' },
    { kind: 'literal', name: 'HAVING threshold (literal)', value: 7 },
    { kind: 'literal', name: 'WHERE literal', value: 7 },
  ]);
  expect(plan.outputColumns).toEqual([
    { name: 'ClientKey', type: 'integer', lineage: [{ source: 'i', field: 'CustomerId' }] },
    { name: 'InvoiceTotal', type: 'integer', lineage: [] },
    { name: 'GivenName', type: 'string', lineage: [{ source: 'i', field: 'FirstName' }] },
  ]);

  const sameSideJoin = {
    ...resolved,
    query: {
      ...root,
      from: {
        ...rootFrom,
        joins: [{
          ...(rootFrom.joins[0] ?? (() => { throw new Error('Expected an explicit graph join.'); })()),
          on: [{ left: { source: 'totals', field: 'Key' }, operator: '==' as const, right: { source: 'totals', field: 'Key' } }],
        }],
      },
    },
  } as unknown as TugQLResolved;
  expect(() => compilePublicSqliteTugQL(sameSideJoin, {
    fixtureSha256: 'fixture-sha256',
    schemaVersion: 'test',
    draftRevision: 1,
  })).toThrow('must connect Invoice.CustomerId and Customer.CustomerId');

  const customerFrom = relation('Customer', 'customer');
  const invoiceJoinRoot: RecursiveDTQLQuery = {
    kind: 'recursive-dtql',
    from: {
      ...customerFrom,
      joins: [{
        type: 'inner',
        from: derived(eligible, 'totals'),
        on: [{ left: { source: 'customer', field: 'CustomerId' }, operator: '==' as const, right: { source: 'totals', field: 'Key' } }],
      }],
    },
    orderBy: [{ field: { source: 'customer', field: 'CustomerId' }, direction: 'asc' }],
    limit: 10,
    columns: [
      { expression: field('customer', 'CustomerId') },
      { expression: field('totals', 'Count'), as: 'InvoiceTotal' },
    ],
  };
  const invertedPlan = compilePublicSqliteTugQL({ ...resolved, query: invoiceJoinRoot } as TugQLResolved, {
    fixtureSha256: 'fixture-sha256',
    schemaVersion: 'test',
    draftRevision: 1,
  });
  expect(invertedPlan.authorProof.profile).toBe('bounded-cte-query');
  expect(invertedPlan.sql).toContain('FROM "Customer" AS "customer"\nINNER JOIN (SELECT');
});

const resolve = (source: string) => {
  const parsed = parseTugQL(source);
  expect(parsed.diagnostics).toEqual([]);
  const tree = parsed.document.tree;
  if (!tree) throw new Error('Expected parsed TugQL tree.');
  requireCustomerIdParameterSource(tree);
  requireLiteralHavingThreshold(tree);
  const parameterFreeTree = { ...tree };
  delete parameterFreeTree.parameters;
  const structuralQuery = { ...tree.query };
  delete structuralQuery['where'];
  const result = resolveTugQL(
    {
      sourceMetadata: parsed.document.sourceMetadata,
      tree: { ...parameterFreeTree, query: structuralQuery },
    },
    {
      authorizedSchemas: [
        {
          version: 'invoice-schema-v1',
          tables: [
            {
              name: 'Invoice',
              fields: [
                { name: 'CustomerId', type: 'integer', authorized: true },
                { name: 'InvoiceId', type: 'integer', authorized: true },
                { name: 'InvoiceDate', type: 'datetime', authorized: true },
              ],
            },
          ],
        },
      ],
      relationships: [],
      pinnedImports: [],
      bindings: [],
    },
  );
  expect(result.diagnostics).toEqual([]);
  if (!result.resolved) throw new Error('Expected TugQL resolution.');
  return result.resolved;
};

it('previews the bounded typed Invoice scan without requiring or inventing a binding', () => {
  const source = `parameters (\n  @CustomerId integer required\n)\nfrom Invoice as i\nwhere i.CustomerId = @CustomerId\nlimit 7\nselect i.InvoiceId, i.InvoiceDate\n`;
  const parsed = parseTugQL(source);
  expect(parsed.diagnostics).toEqual([]);
  const parsedTree = parsed.document.tree;
  if (!parsedTree) throw new Error('Expected parsed TugQL tree.');
  expect(() =>
    requireCustomerIdParameterSource(parsedTree),
  ).not.toThrow();
  const plan = compilePublicSqliteTugQL(resolve(source), {
    fixtureSha256: 'fixture-sha256',
    schemaVersion: 'invoice-schema-v1',
    draftRevision: 9,
  });

  expect(plan.sql).toBe(
    'SELECT "i"."InvoiceId",\n  "i"."InvoiceDate"\nFROM "Invoice" AS "i"\nWHERE "i"."CustomerId" = ?\nLIMIT 7',
  );
  expect(plan.fixedBindings).toEqual([]);
  expect(plan.bindingNames).toEqual(['CustomerId']);
  expect(plan.sql).not.toContain('42');
  expect(Object.isFrozen(plan)).toBe(true);
  expect(Object.isFrozen(plan.fixedBindings)).toBe(true);
  expect(Object.isFrozen(plan.bindingNames)).toBe(true);
});

it('fails closed when the structural compiler receives any WHERE clause', () => {
  const parsed = parseTugQL(
    'from Invoice as i\nwhere i.CustomerId = 42\nlimit 10\nselect i.InvoiceId\n',
  );
  expect(parsed.diagnostics).toEqual([]);
  const resolution = resolveTugQL(parsed.document, {
    authorizedSchemas: [
      {
        version: 'invoice-schema-v1',
        tables: [
          {
            name: 'Invoice',
            fields: [
              { name: 'CustomerId', type: 'integer', authorized: true },
              { name: 'InvoiceId', type: 'integer', authorized: true },
              { name: 'InvoiceDate', type: 'datetime', authorized: true },
            ],
          },
        ],
      },
    ],
    relationships: [],
    pinnedImports: [],
    bindings: [],
  });
  expect(resolution.diagnostics).toEqual([]);
  const resolved = resolution.resolved;
  if (!resolved) throw new Error('Expected TugQL resolution.');
  expect(() =>
    compilePublicSqliteTugQL(resolved, {
      fixtureSha256: 'fixture-sha256',
      schemaVersion: 'invoice-schema-v1',
      draftRevision: 1,
    }),
  ).toThrow(
    'structurally resolved query with its guarded CustomerId predicate removed',
  );
});

it('rejects unbounded scans and projection expressions outside the adapter profile', () => {
  const options = {
    fixtureSha256: 'fixture-sha256',
    schemaVersion: 'invoice-schema-v1',
    draftRevision: 1,
  };
  expect(() =>
    compilePublicSqliteTugQL(
      resolve(
        `parameters (\n  @CustomerId integer required\n)\nfrom Invoice as i\nwhere i.CustomerId = @CustomerId\nselect i.InvoiceId\n`,
      ),
      options,
    ),
  ).toThrow('bounded Invoice scan');
  expect(() =>
    compilePublicSqliteTugQL(
      resolve(
        `parameters (\n  @CustomerId integer required\n)\nfrom Invoice as i\nwhere i.CustomerId = @CustomerId\nlimit 10\nselect i.InvoiceId + 1 as ID\n`,
      ),
      options,
    ),
  ).toThrow('Only InvoiceId and InvoiceDate projections are supported.');
});

it('preserves an authored row limit within the hard cap', () => {
  const resolved = resolve(
    `parameters (\n  @CustomerId integer required\n)\nfrom Invoice as i\nwhere i.CustomerId = @CustomerId\nlimit 2\nselect i.InvoiceId\n`,
  );
  expect(
    compilePublicSqliteTugQL(resolved, {
      fixtureSha256: 'fixture-sha256',
      schemaVersion: 'invoice-schema-v1',
      draftRevision: 1,
    }).sql,
  ).toMatch(/LIMIT 2$/u);
});

it('compiles supported CustomerId groups and binds an integer COUNT HAVING threshold', () => {
  const resolved = resolve(
    `parameters (\n  @CustomerId integer required\n)\nfrom Invoice as i\nwhere i.CustomerId = @CustomerId\ngroup by i.CustomerId\nhaving count(*) >= 7\nlimit 10\nselect i.CustomerId, count(*) as InvoiceCount\n`,
  );
  expect(resolved.query.having).toBeDefined();
  const plan = compilePublicSqliteTugQL(resolved, {
    fixtureSha256: 'fixture-sha256',
    schemaVersion: 'invoice-schema-v1',
    draftRevision: 1,
  });
  expect(plan.sql).toBe(
    'SELECT "i"."CustomerId",\n  COUNT(*) AS "InvoiceCount"\nFROM "Invoice" AS "i"\nWHERE "i"."CustomerId" = ?\nGROUP BY "i"."CustomerId"\nHAVING COUNT(*) >= ?\nLIMIT 10',
  );
  expect(plan.fixedBindings).toEqual([7]);
  expect(plan.bindingNames).toEqual([
    'CustomerId',
    'HAVING threshold (literal)',
  ]);
  expect(plan.sql).not.toContain('>= 7');
});

it('resolves and compiles only the declared Invoice to Customer relationship', () => {
  const relationship = {
    id: PUBLIC_CHINOOK_CUSTOMER_FK,
    version: `${PUBLIC_CHINOOK_CUSTOMER_FK}:v1`,
    fromSource: 'i',
    toSource: 'c',
    joinType: 'inner' as const,
    pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
  };
  const resolveJoin = (
    on: string,
    projection = 'i.InvoiceId, i.CustomerId, c.FirstName, c.LastName, c.Email',
  ): ReturnType<typeof resolveTugQL> => {
    const source = `parameters (\n  @CustomerId integer required\n)\nfrom Invoice as i\njoin Customer as c${on}\nwhere i.CustomerId = @CustomerId\nlimit 100\nselect ${projection}\n`;
    const parsed = parseTugQL(source);
    expect(parsed.diagnostics).toEqual([]);
    if (!parsed.document.tree) throw new Error('Expected parsed TugQL tree.');
    requireCustomerIdParameterSource(parsed.document.tree);
    const withoutBindings = { ...parsed.document.tree };
    delete (withoutBindings as { parameters?: unknown }).parameters;
    const query = { ...withoutBindings.query };
    delete (query as { where?: unknown }).where;
    return resolveTugQL(
      {
        sourceMetadata: parsed.document.sourceMetadata,
        tree: { ...withoutBindings, query },
      },
      {
        authorizedSchemas: [
          {
            version: 'joined-schema-v1',
            tables: [
              {
                name: 'Invoice',
                fields: [
                  { name: 'CustomerId', type: 'integer', authorized: true },
                  { name: 'InvoiceId', type: 'integer', authorized: true },
                  { name: 'InvoiceDate', type: 'datetime', authorized: true },
                ],
              },
              {
                name: 'Customer',
                fields: [
                  { name: 'CustomerId', type: 'integer', authorized: true },
                  { name: 'FirstName', type: 'string', authorized: true },
                  { name: 'LastName', type: 'string', authorized: true },
                  { name: 'Email', type: 'string', authorized: true },
                ],
              },
            ],
          },
        ],
        relationships: [
          {
            id: relationship.id,
            version: relationship.version,
            from: { table: 'Invoice', source: 'i' },
            to: { table: 'Customer', source: 'c' },
            pairs: relationship.pairs,
            exactTypedEquality: true,
          },
        ],
        pinnedImports: [],
        bindings: [],
      },
    );
  };
  const missingOn = resolveJoin('');
  const explicitOn = resolveJoin('\n  on i.CustomerId = c.CustomerId');
  const shorthandOn = resolveJoin('\n  on CustomerId');
  for (const result of [missingOn, explicitOn, shorthandOn]) {
    expect(result.diagnostics).toEqual([]);
    expect(result.resolved?.relationships).toHaveLength(1);
    if (!result.resolved) throw new Error('Expected resolved joined query.');
    const plan = compilePublicSqliteTugQL(result.resolved, {
      fixtureSha256: 'fixture-sha256',
      schemaVersion: 'joined-schema-v1',
      draftRevision: 1,
      relationship,
    });
    expect(plan.sql).toContain(
      'INNER JOIN "Customer" AS "c" ON "i"."CustomerId" = "c"."CustomerId"',
    );
    expect(plan.sql).toContain('ORDER BY "i"."InvoiceId" ASC');
    expect(
      plan.outputColumns?.map(({ name, type, lineage }) => [
        name,
        type,
        lineage[0]?.source,
        lineage[0]?.field,
      ]),
    ).toEqual([
      ['InvoiceId', 'integer', 'i', 'InvoiceId'],
      ['CustomerId', 'integer', 'i', 'CustomerId'],
      ['FirstName', 'string', 'c', 'FirstName'],
      ['LastName', 'string', 'c', 'LastName'],
      ['Email', 'string', 'c', 'Email'],
    ]);
  }
  const authoredAlias = resolveJoin('\n  on i.CustomerId = c.CustomerId');
  if (!authoredAlias.resolved)
    throw new Error('Expected resolved joined query.');
  const authoredColumns = authoredAlias.resolved.query.columns;
  if (!authoredColumns?.length) throw new Error('Expected joined projections.');
  const aliasQuery = {
    ...authoredAlias.resolved,
    query: {
      ...authoredAlias.resolved.query,
      columns: [
        { ...authoredColumns[0], as: 'InvoiceNumber' },
        ...authoredColumns.slice(1),
      ],
    },
  };
  const aliasPlan = compilePublicSqliteTugQL(aliasQuery, {
    fixtureSha256: 'fixture-sha256',
    schemaVersion: 'joined-schema-v1',
    draftRevision: 1,
    relationship,
  });
  expect(aliasPlan.sql).toContain('"i"."InvoiceId" AS "InvoiceNumber"');
  expect(aliasPlan.outputColumns?.[0]).toMatchObject({
    name: 'InvoiceNumber',
    lineage: [{ source: 'i', field: 'InvoiceId' }],
  });
  const timestampProjection = resolveJoin(
    '\n  on i.CustomerId = c.CustomerId',
    'i.InvoiceId, i.InvoiceDate, i.CustomerId, c.FirstName, c.LastName, c.Email',
  );
  expect(timestampProjection.diagnostics).toEqual([]);
  const timestampResolved = timestampProjection.resolved;
  if (!timestampResolved)
    throw new Error('Expected resolved timestamp projection.');
  expect(() =>
    compilePublicSqliteTugQL(timestampResolved, {
      fixtureSha256: 'fixture-sha256',
      schemaVersion: 'joined-schema-v1',
      draftRevision: 1,
      relationship,
    }),
  ).toThrow('Only InvoiceId, CustomerId, FirstName, LastName, and Email projections are supported.');
  const unmatched = resolveJoin('\n  on i.InvoiceId = c.CustomerId');
  expect(unmatched.diagnostics).toHaveLength(0);
  expect(unmatched.resolved?.relationships).toEqual([]);
  const unmatchedResolved = unmatched.resolved;
  if (unmatchedResolved)
    expect(() =>
      compilePublicSqliteTugQL(unmatchedResolved, {
        fixtureSha256: 'fixture-sha256',
        schemaVersion: 'joined-schema-v1',
        draftRevision: 1,
      }),
    ).toThrow(
      'unique declared Invoice.CustomerId to Customer.CustomerId relationship',
    );
});

it('fails closed for unapproved grouped Invoice expressions and HAVING operators', () => {
  const options = {
    fixtureSha256: 'fixture-sha256',
    schemaVersion: 'invoice-schema-v1',
    draftRevision: 1,
  };
  for (const source of [
    `parameters (\n  @CustomerId integer required\n)\nfrom Invoice as i\nwhere i.CustomerId = @CustomerId\ngroup by i.InvoiceDate\nhaving count(*) >= 7\nlimit 10\nselect i.InvoiceDate, count(*) as InvoiceCount\n`,
    `parameters (\n  @CustomerId integer required\n)\nfrom Invoice as i\nwhere i.CustomerId = @CustomerId\ngroup by i.CustomerId\nhaving sum(i.InvoiceId) >= 7\nlimit 10\nselect i.CustomerId, count(*) as InvoiceCount\n`,
    `parameters (\n  @CustomerId integer required\n)\nfrom Invoice as i\nwhere i.CustomerId = @CustomerId\ngroup by i.CustomerId\nhaving count(*) in (7, 8)\nlimit 10\nselect i.CustomerId, count(*) as InvoiceCount\n`,
  ]) {
    expect(() => compilePublicSqliteTugQL(resolve(source), options)).toThrow();
  }
});

it.each([
  ['=', '=', '=='],
  ['!=', '!=', '!='],
  ['<', '<', '<'],
  ['<=', '<=', '<='],
  ['>', '>', '>'],
  ['>=', '>=', '>='],
])(
  'maps HAVING %s through the explicit SQLite comparison whitelist',
  (sourceOperator, sqlOperator) => {
    const plan = compilePublicSqliteTugQL(
      resolve(
        `parameters (\n  @CustomerId integer required\n)\nfrom Invoice as i\nwhere i.CustomerId = @CustomerId\ngroup by i.CustomerId\nhaving count(*) ${sourceOperator} 7\nlimit 10\nselect i.CustomerId, count(*) as InvoiceCount\n`,
      ),
      {
        fixtureSha256: 'fixture-sha256',
        schemaVersion: 'invoice-schema-v1',
        draftRevision: 1,
      },
    );
    expect(plan.sql).toContain(`HAVING COUNT(*) ${sqlOperator} ?`);
    expect(plan.fixedBindings).toEqual([7]);
    expect(plan.bindingNames).toEqual([
      'CustomerId',
      'HAVING threshold (literal)',
    ]);
  },
);

it('supports COUNT(InvoiceId) and rejects a HAVING aggregate different from the projection', () => {
  const options = {
    fixtureSha256: 'fixture-sha256',
    schemaVersion: 'invoice-schema-v1',
    draftRevision: 1,
  };
  const supported = compilePublicSqliteTugQL(
    resolve(
      `parameters (\n  @CustomerId integer required\n)\nfrom Invoice as i\nwhere i.CustomerId = @CustomerId\ngroup by i.CustomerId\nhaving count(i.InvoiceId) >= 7\nlimit 10\nselect i.CustomerId, count(i.InvoiceId) as InvoiceCount\n`,
    ),
    options,
  );
  expect(supported.sql).toContain('COUNT("i"."InvoiceId") AS "InvoiceCount"');
  expect(supported.sql).toContain('HAVING COUNT("i"."InvoiceId") >= ?');
  expect(supported.fixedBindings).toEqual([7]);

  expect(() =>
    compilePublicSqliteTugQL(
      resolve(
        `parameters (\n  @CustomerId integer required\n)\nfrom Invoice as i\nwhere i.CustomerId = @CustomerId\ngroup by i.CustomerId\nhaving count(*) >= 7\nlimit 10\nselect i.CustomerId, count(i.InvoiceId) as InvoiceCount\n`,
      ),
      options,
    ),
  ).toThrow('Select and filter the same Invoice COUNT expression.');
});

it('does not infer parameter identity from a matching literal value', () => {
  const parsed = parseTugQL(
    `parameters (\n  @CustomerId integer required\n)\nfrom Invoice as i\nwhere i.CustomerId = 42\nlimit 10\nselect i.InvoiceId\n`,
  );
  expect(parsed.diagnostics).toEqual([]);
  const parsedTree = parsed.document.tree;
  if (!parsedTree) throw new Error('Expected parsed TugQL tree.');
  expect(() => requireCustomerIdParameterSource(parsedTree)).toThrow(
    'Use the declared @CustomerId parameter',
  );
});

it('accepts built-in parameter type casing and preserves grouped output aliases', () => {
  const source = `PARAMETERS (\n  @CustomerId INTEGER REQUIRED\n)\nFROM Invoice AS i\nWHERE i.CustomerId = @CustomerId\nGROUP BY i.CustomerId\nHAVING count(*) >= 7\nLIMIT 10\nSELECT i.CustomerId AS Customer, count(*) AS Invoices\n`;
  const parsed = parseTugQL(source);
  expect(parsed.diagnostics).toEqual([]);
  const parsedTree = parsed.document.tree;
  if (!parsedTree) throw new Error('Expected parsed TugQL tree.');
  expect(() =>
    requireCustomerIdParameterSource(parsedTree),
  ).not.toThrow();
  const plan = compilePublicSqliteTugQL(resolve(source), {
    fixtureSha256: 'fixture-sha256',
    schemaVersion: 'invoice-schema-v1',
    draftRevision: 1,
  });
  expect(plan.sql).toContain(
    'SELECT "i"."CustomerId" AS "Customer",\n  COUNT(*) AS "Invoices"',
  );
});

it('rejects a parameterized HAVING threshold in the native literal-only profile', () => {
  const parsed = parseTugQL(
    `parameters (\n  @CustomerId integer required\n  @MinCount integer required\n)\nfrom Invoice as i\nwhere i.CustomerId = @CustomerId\ngroup by i.CustomerId\nhaving count(*) >= @MinCount\nlimit 10\nselect i.CustomerId, count(*) as InvoiceCount\n`,
  );
  expect(parsed.diagnostics).toEqual([]);
  const parsedTree = parsed.document.tree;
  if (!parsedTree) throw new Error('Expected parsed TugQL tree.');
  expect(() => requireLiteralHavingThreshold(parsedTree)).toThrow(
    'integer literal HAVING threshold',
  );
});
