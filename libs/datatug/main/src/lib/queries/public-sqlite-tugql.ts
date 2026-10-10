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
  readonly relationship?: PublicSqliteRelationshipReceipt;
  readonly outputColumns?: readonly PublicSqliteOutputColumn[];
}

export interface PublicSqliteRelationshipReceipt {
  readonly id: string;
  readonly version: string;
  readonly fromSource: string;
  readonly toSource: string;
  readonly joinType: 'inner';
  readonly pairs: readonly {
    readonly fromField: string;
    readonly toField: string;
  }[];
}

export const PUBLIC_CHINOOK_CUSTOMER_FK = 'FK_Invoice_Customer_CustomerId';

export interface PublicSqliteOutputColumn {
  readonly name: string;
  readonly type: 'integer' | 'string';
  readonly lineage: readonly {
    readonly source: string;
    readonly field: string;
  }[];
}

/** UI-supplied origin metadata. It is explicitly client-reported, not worker proof. */
export interface PublicSqliteClientReportedBinding {
  readonly origin: 'manual' | 'selection';
  readonly originEvidence: 'client-reported';
  readonly sourceQueryId?: string;
  readonly sourceColumn?: string;
}

/** A structural preview has no user-provided values and is safe to show before Run. */
export type PublicSqliteQueryPreview = Omit<
  PublicSqlitePreparedPlan,
  'bindings' | 'relationship'
> & {
  readonly fixedBindings: readonly (string | number | null)[];
  readonly relationship?: PublicSqliteRelationshipReceipt;
  /** Source-preserving edit to make a resolver-completed ON clause reviewable before Run. */
  readonly expandedSource?: string;
};

export type PublicSqliteExecutionReceipt = Omit<
  PublicSqlitePreparedPlan,
  'bindings'
> & {
  readonly executionId: string;
  readonly bindingNames: readonly string[];
  readonly relationship?: PublicSqliteRelationshipReceipt;
  readonly outputColumns?: readonly PublicSqliteOutputColumn[];
  /** UI-supplied origin metadata; the worker verifies values, not this claim. */
  readonly clientReportedBinding?: PublicSqliteClientReportedBinding;
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
    readonly relationship?: PublicSqliteRelationshipReceipt;
    readonly expandedSource?: string;
  },
): PublicSqliteQueryPreview {
  const query = resolved.query;
  if (query.where !== undefined) {
    throw new Error(
      'Compile only the structurally resolved query with its guarded CustomerId predicate removed.',
    );
  }
  const limit = query.limit;
  const isJoined = query.from.joins.length > 0;
  if (
    query.kind !== 'recursive-dtql' ||
    query.from.kind !== 'table' ||
    query.from.name !== 'Invoice' ||
    (query.from.schema !== undefined && query.from.schema !== 'main') ||
    query.from.joins.length > (isJoined ? 1 : 0) ||
    query.as !== undefined ||
    query.offset !== undefined ||
    limit === undefined ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new Error(
      'This preview supports a bounded Invoice scan or Invoice-to-Customer join only.',
    );
  }

  const join = query.from.joins[0];
  const invoiceAlias = query.from.alias ?? 'Invoice';
  const customerAlias =
    join?.from.kind === 'table' ? (join.from.alias ?? 'Customer') : 'Customer';
  const onPredicate = join?.on[0];
  const onMatchesRelationship =
    onPredicate?.operator === '==' &&
    ((onPredicate.left.field === 'CustomerId' &&
      onPredicate.left.source === invoiceAlias &&
      onPredicate.right.field === 'CustomerId' &&
      onPredicate.right.source === customerAlias) ||
      (onPredicate.right.field === 'CustomerId' &&
        onPredicate.right.source === invoiceAlias &&
        onPredicate.left.field === 'CustomerId' &&
        onPredicate.left.source === customerAlias));
  if (isJoined) {
    if (
      !options.relationship ||
      options.relationship.id !== PUBLIC_CHINOOK_CUSTOMER_FK ||
      (join?.type !== undefined && join.type.toLowerCase() !== 'inner') ||
      join?.from.kind !== 'table' ||
      join.from.name !== 'Customer' ||
      (join.from.schema !== undefined && join.from.schema !== 'main') ||
      join.on.length !== 1 ||
      join.on[0]?.operator !== '==' ||
      !onMatchesRelationship ||
      options.relationship.fromSource !== (query.from.alias ?? 'Invoice') ||
      options.relationship.toSource !== (join.from.alias ?? 'Customer') ||
      options.relationship.joinType !== 'inner' ||
      options.relationship.pairs.length !== 1 ||
      options.relationship.pairs[0]?.fromField !== 'CustomerId' ||
      options.relationship.pairs[0]?.toField !== 'CustomerId'
    ) {
      throw new Error(
        'This query requires the unique declared Invoice.CustomerId to Customer.CustomerId relationship.',
      );
    }
  } else if (options.relationship) {
    throw new Error(
      'A relationship receipt was supplied for a single-table query.',
    );
  }
  const expectedOrderAlias = query.from.alias ?? 'Invoice';
  if (
    (!isJoined && query.orderBy?.length) ||
    (isJoined &&
      query.orderBy?.length &&
      (query.orderBy.length !== 1 ||
        query.orderBy[0]?.field.source !== expectedOrderAlias ||
        query.orderBy[0]?.field.field !== 'InvoiceId' ||
        query.orderBy[0]?.direction !== 'asc'))
  ) {
    throw new Error('Order joined Invoice rows by InvoiceId ascending.');
  }

  const alias = query.from.alias ?? 'Invoice';
  const columns = query.columns;
  if (!columns?.length || columns.length > (isJoined ? 6 : 2))
    throw new Error('Select the explicit columns supported by this profile.');
  const grouped = query.groupBy !== undefined || query.having !== undefined;
  if (isJoined && grouped)
    throw new Error(
      'Grouped queries are not supported by this joined SQLite profile.',
    );
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
    const allowedColumns = isJoined
      ? new Set([
          'InvoiceId',
          'CustomerId',
          'FirstName',
          'LastName',
          'Email',
        ])
      : new Set(['InvoiceId', 'InvoiceDate']);
    projection = columns.map((column) => {
      const expression = column.expression;
      const invoiceSource =
        expression.kind === 'field' && expression.field.source === alias;
      const customerSource =
        expression.kind === 'field' &&
        expression.field.source === (join?.from.alias ?? 'Customer');
      if (
        expression.kind !== 'field' ||
        (!invoiceSource && !(isJoined && customerSource)) ||
        !allowedColumns.has(expression.field.field)
      ) {
        throw new Error(
          isJoined
            ? 'Only InvoiceId, CustomerId, FirstName, LastName, and Email projections are supported.'
            : 'Only InvoiceId and InvoiceDate projections are supported.',
        );
      }
      const outputName = column.as ?? expression.field.field;
      const fieldSql = `${quoteIdentifier(expression.field.source)}.${quoteIdentifier(expression.field.field)}`;
      return isJoined || column.as
        ? `${fieldSql} AS ${quoteIdentifier(outputName)}`
        : fieldSql;
    });
    const projectedFieldNames = columns.map((column) => {
      const expression = column.expression;
      return expression.kind === 'field' ? expression.field.field : '';
    });
    if (projectedFieldNames[0] !== 'InvoiceId') {
      throw new Error('Project InvoiceId first.');
    }
  }

  const aliases = columns.map(
    (column) =>
      column.as ??
      (column.expression.kind === 'field' ? column.expression.field.field : ''),
  );
  if (
    isJoined &&
    (new Set(aliases).size !== aliases.length || aliases.some((name) => !name))
  )
    throw new Error('Every projected field must have a unique output alias.');
  const outputColumns: readonly PublicSqliteOutputColumn[] = isJoined
    ? Object.freeze(
        columns.map((column, index) => {
          if (column.expression.kind !== 'field')
            throw new Error('Only direct fields can be projected.');
          const { source, field } = column.expression.field;
          const type: PublicSqliteOutputColumn['type'] =
            field === 'InvoiceId' || field === 'CustomerId'
              ? 'integer'
              : 'string';
          return Object.freeze({
            name: aliases[index] as string,
            type,
            lineage: Object.freeze([{ source, field }]),
          });
        }),
      )
    : [];

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
  if (isJoined && join) {
    const customerAlias = join.from.alias ?? 'Customer';
    const predicate = `${quoteIdentifier(alias)}.${quoteIdentifier('CustomerId')} = ${quoteIdentifier(customerAlias)}.${quoteIdentifier('CustomerId')}`;
    sql.splice(
      2,
      0,
      `INNER JOIN ${quoteIdentifier('Customer')} AS ${quoteIdentifier(customerAlias)} ON ${predicate}`,
    );
  }
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
  if (isJoined)
    sql.push(
      `ORDER BY ${quoteIdentifier(alias)}.${quoteIdentifier('InvoiceId')} ASC`,
    );
  sql.push(`LIMIT ${limit}`);

  return Object.freeze({
    sql: sql.join('\n'),
    fixedBindings: Object.freeze(fixedBindings),
    bindingNames: Object.freeze(bindingNames),
    sourceId: 'chinook-sqlite',
    fixtureSha256: options.fixtureSha256,
    schemaVersion: options.schemaVersion,
    draftRevision: options.draftRevision,
    ...(options.relationship
      ? { relationship: Object.freeze(options.relationship) }
      : {}),
    ...(isJoined ? { outputColumns: Object.freeze(outputColumns) } : {}),
    ...(options.expandedSource
      ? { expandedSource: options.expandedSource }
      : {}),
  });
}
