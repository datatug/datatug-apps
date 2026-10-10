import { parseTugQL, resolveTugQL } from '@dalgo/core';
import {
  compilePublicSqliteTugQL,
  requireCustomerIdParameterSource,
  requireLiteralHavingThreshold,
  PUBLIC_CHINOOK_CUSTOMER_FK,
} from './public-sqlite-tugql';

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
  delete structuralQuery.where;
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
  if (!parsed.document.tree) throw new Error('Expected parsed TugQL tree.');
  expect(() =>
    requireCustomerIdParameterSource(parsed.document.tree),
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
  if (!resolution.resolved) throw new Error('Expected TugQL resolution.');
  expect(() =>
    compilePublicSqliteTugQL(resolution.resolved, {
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
  if (!timestampProjection.resolved)
    throw new Error('Expected resolved timestamp projection.');
  expect(() =>
    compilePublicSqliteTugQL(timestampProjection.resolved, {
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
  if (!parsed.document.tree) throw new Error('Expected parsed TugQL tree.');
  expect(() => requireCustomerIdParameterSource(parsed.document.tree)).toThrow(
    'Use the declared @CustomerId parameter',
  );
});

it('accepts built-in parameter type casing and preserves grouped output aliases', () => {
  const source = `PARAMETERS (\n  @CustomerId INTEGER REQUIRED\n)\nFROM Invoice AS i\nWHERE i.CustomerId = @CustomerId\nGROUP BY i.CustomerId\nHAVING count(*) >= 7\nLIMIT 10\nSELECT i.CustomerId AS Customer, count(*) AS Invoices\n`;
  const parsed = parseTugQL(source);
  expect(parsed.diagnostics).toEqual([]);
  if (!parsed.document.tree) throw new Error('Expected parsed TugQL tree.');
  expect(() =>
    requireCustomerIdParameterSource(parsed.document.tree),
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
  if (!parsed.document.tree) throw new Error('Expected parsed TugQL tree.');
  expect(() => requireLiteralHavingThreshold(parsed.document.tree)).toThrow(
    'integer literal HAVING threshold',
  );
});
