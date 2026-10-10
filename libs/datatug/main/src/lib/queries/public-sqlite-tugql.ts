import type {
  RecursiveDTQLExpression,
  TugQLResolved,
  TugQLTree,
} from '@dalgo/core';

export interface PublicSqlitePreparedPlan {
  readonly sql: string;
  readonly bindings: readonly (string | number | null)[];
  readonly bindingNames: readonly string[];
  readonly sourceId: 'chinook-sqlite';
  readonly fixtureSha256: string;
  readonly schemaVersion: string;
  readonly draftRevision: number;
}

/** A structural preview has no user-provided values and is safe to show before Run. */
export type PublicSqliteQueryPreview = Omit<
  PublicSqlitePreparedPlan,
  'bindings'
> & {
  readonly fixedBindings: readonly (string | number | null)[];
};

export type PublicSqliteExecutionReceipt = Omit<
  PublicSqlitePreparedPlan,
  'bindings'
> & {
  readonly executionId: string;
  readonly bindingNames: readonly string[];
};

const SQL_COMPARISON_OPERATORS: Readonly<Record<string, string>> = {
  '==': '=',
  '!=': '!=',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
};

const quoteIdentifier = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`;

function countSql(expression: RecursiveDTQLExpression, alias: string): string {
  if (
    expression.kind !== 'aggregate' ||
    expression.function !== 'count' ||
    expression.distinct === true ||
    expression.args.length !== 1
  ) {
    throw new Error(
      'Grouped Invoice queries support COUNT(*) or COUNT(InvoiceId) only.',
    );
  }
  const argument = expression.args[0];
  if (argument.kind === 'star') return 'COUNT(*)';
  if (
    argument.kind === 'field' &&
    argument.field.source === alias &&
    argument.field.field === 'InvoiceId'
  ) {
    return `COUNT(${quoteIdentifier(alias)}.${quoteIdentifier('InvoiceId')})`;
  }
  throw new Error(
    'Grouped Invoice queries support COUNT(*) or COUNT(InvoiceId) only.',
  );
}

/** Preserve parameter identity before resolveTugQL substitutes its value into a literal. */
export function requireCustomerIdParameterSource(tree: TugQLTree): void {
  const query = tree.query as Readonly<Record<string, unknown>>;
  const from = query['from'] as Readonly<Record<string, unknown>> | undefined;
  const alias = typeof from?.['alias'] === 'string' ? from['alias'] : 'Invoice';
  const where = query['where'] as Readonly<Record<string, unknown>> | undefined;
  const left = where?.['left'] as Readonly<Record<string, unknown>> | undefined;
  const right = where?.['right'] as
    | Readonly<Record<string, unknown>>
    | undefined;
  const parameters = tree.parameters as
    | readonly Readonly<Record<string, unknown>>[]
    | undefined;
  if (
    where?.['op'] !== '==' ||
    left?.['field'] !== 'CustomerId' ||
    (left['source'] !== undefined && left['source'] !== alias) ||
    !parameters?.some(
      (parameter) =>
        parameter['name'] === 'CustomerId' &&
        typeof parameter['type'] === 'string' &&
        parameter['type'].toLowerCase() === 'integer' &&
        parameter['required'] === true,
    ) ||
    right?.['param'] !== 'CustomerId'
  ) {
    throw new Error(
      'Use the declared @CustomerId parameter as the value in Invoice.CustomerId equality.',
    );
  }
}

/** Validate literal provenance before resolveTugQL replaces parameters with values. */
export function requireLiteralHavingThreshold(tree: TugQLTree): void {
  const query = tree.query as Readonly<Record<string, unknown>>;
  const having = query['having'] as
    | Readonly<Record<string, unknown>>
    | undefined;
  if (!having) return;
  const right = having['right'] as
    | Readonly<Record<string, unknown>>
    | undefined;
  const value = right?.['value'];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(
      'This SQLite profile requires an integer literal HAVING threshold.',
    );
  }
}

/** Deliberately small SQLite lowering for the first browser Author journey. */
export function compilePublicSqliteTugQL(
  resolved: TugQLResolved,
  options: {
    readonly fixtureSha256: string;
    readonly schemaVersion: string;
    readonly draftRevision: number;
  },
): PublicSqliteQueryPreview {
  const query = resolved.query;
  if (query.where !== undefined) {
    throw new Error(
      'Compile only the structurally resolved query with its guarded CustomerId predicate removed.',
    );
  }
  const limit = query.limit;
  if (
    query.kind !== 'recursive-dtql' ||
    query.from.kind !== 'table' ||
    query.from.name !== 'Invoice' ||
    (query.from.schema !== undefined && query.from.schema !== 'main') ||
    query.from.joins.length !== 0 ||
    query.as !== undefined ||
    query.offset !== undefined ||
    query.orderBy?.length ||
    limit === undefined ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new Error('This preview supports a bounded Invoice scan only.');
  }

  const alias = query.from.alias ?? 'Invoice';
  const columns = query.columns;
  if (!columns?.length || columns.length > 2)
    throw new Error('Select the explicit columns supported by this profile.');
  const grouped = query.groupBy !== undefined || query.having !== undefined;
  let projection: string[];
  let havingSql: string | undefined;
  let havingThreshold: number | undefined;
  if (grouped) {
    const group = query.groupBy?.[0];
    const having = query.having;
    if (
      query.groupBy?.length !== 1 ||
      group?.kind !== 'field' ||
      group.field.source !== alias ||
      group.field.field !== 'CustomerId' ||
      !having ||
      having.kind !== 'comparison' ||
      !Object.hasOwn(SQL_COMPARISON_OPERATORS, having.operator) ||
      having.right.kind !== 'literal' ||
      typeof having.right.value !== 'number' ||
      !Number.isSafeInteger(having.right.value) ||
      columns.length !== 2 ||
      columns[0].expression.kind !== 'field' ||
      columns[0].expression.field.source !== alias ||
      columns[0].expression.field.field !== 'CustomerId'
    ) {
      throw new Error(
        'Grouped Invoice queries require CustomerId, COUNT, an integer HAVING threshold, and a bounded LIMIT.',
      );
    }
    const selectedCount = countSql(columns[1].expression, alias);
    const havingCount = countSql(having.left, alias);
    if (selectedCount !== havingCount)
      throw new Error('Select and filter the same Invoice COUNT expression.');
    const customerIdSql = `${quoteIdentifier(alias)}.${quoteIdentifier('CustomerId')}`;
    projection = [
      `${customerIdSql}${columns[0].as ? ` AS ${quoteIdentifier(columns[0].as)}` : ''}`,
      `${selectedCount}${columns[1].as ? ` AS ${quoteIdentifier(columns[1].as)}` : ''}`,
    ];
    havingSql = `${havingCount} ${SQL_COMPARISON_OPERATORS[having.operator]} ?`;
    havingThreshold = having.right.value;
  } else {
    const allowedColumns = new Set(['InvoiceId', 'InvoiceDate']);
    projection = columns.map((column) => {
      const expression = column.expression;
      if (
        expression.kind !== 'field' ||
        expression.field.source !== alias ||
        !allowedColumns.has(expression.field.field)
      ) {
        throw new Error(
          'Only InvoiceId and InvoiceDate projections are supported.',
        );
      }
      return `${quoteIdentifier(alias)}.${quoteIdentifier(expression.field.field)}${column.as ? ` AS ${quoteIdentifier(column.as)}` : ''}`;
    });
    const projectedNames = columns.map((column) => {
      const expression = column.expression;
      return expression.kind === 'field' ? expression.field.field : '';
    });
    if (
      projectedNames[0] !== 'InvoiceId' ||
      (projectedNames.length === 2 && projectedNames[1] !== 'InvoiceDate')
    ) {
      throw new Error(
        'Project InvoiceId first, with optional InvoiceDate second.',
      );
    }
  }

  const sql = [
    `SELECT ${projection.join(',\n  ')}`,
    `FROM ${quoteIdentifier('Invoice')} AS ${quoteIdentifier(alias)}`,
  ];
  const bindingNames = ['CustomerId'];
  // `requireCustomerIdParameterSource` checks the original author tree before
  // resolution. The resolver receives a parameter-free structural document;
  // this fixed predicate is then added to the same compiler output for preview
  // and execution, without inventing a binding value.
  sql.push(
    `WHERE ${quoteIdentifier(alias)}.${quoteIdentifier('CustomerId')} = ?`,
  );
  const fixedBindings: (string | number | null)[] = [];
  if (grouped && havingSql !== undefined && havingThreshold !== undefined) {
    sql.push(
      `GROUP BY ${quoteIdentifier(alias)}.${quoteIdentifier('CustomerId')}`,
      `HAVING ${havingSql}`,
    );
    fixedBindings.push(havingThreshold);
    bindingNames.push('HAVING threshold (literal)');
  } else if (grouped) {
    throw new Error(
      'Grouped Invoice queries require CustomerId, COUNT, an integer HAVING threshold, and a bounded LIMIT.',
    );
  }
  sql.push(`LIMIT ${limit}`);

  return Object.freeze({
    sql: sql.join('\n'),
    fixedBindings: Object.freeze(fixedBindings),
    bindingNames: Object.freeze(bindingNames),
    sourceId: 'chinook-sqlite',
    fixtureSha256: options.fixtureSha256,
    schemaVersion: options.schemaVersion,
    draftRevision: options.draftRevision,
  });
}
