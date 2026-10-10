import { formatTugQL, parseTugQL } from '@dalgo/core';

export type AuthorHavingOperator = '=' | '!=' | '<' | '<=' | '>' | '>=';

export interface AuthorComposeProfile {
  readonly supported: boolean;
  readonly writable: boolean;
  readonly reason?: string;
  readonly grouped?: boolean;
  readonly includeInvoiceDate?: boolean;
  readonly countExpression?: 'star' | 'InvoiceId';
  readonly havingOperator?: AuthorHavingOperator;
  readonly threshold?: number;
  readonly limit?: number;
  readonly schema?: string;
  readonly tableAlias?: string;
  readonly invoiceIdAlias?: string;
  readonly invoiceDateAlias?: string;
  readonly customerIdAlias?: string;
  readonly countAlias?: string;
}

const unsupported = (reason: string): AuthorComposeProfile => ({
  supported: false,
  writable: false,
  reason,
});

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

const isAliasField = (value: unknown, alias: string, field: string): boolean => {
  const item = record(value);
  return (
    item?.['field'] === field &&
    (item['source'] === undefined || item['source'] === alias) &&
    hasOnlyKeys(item, ['field', 'source'])
  );
};

const isColumnField = (
  value: unknown,
  alias: string,
  field: string,
): boolean => {
  const item = record(value);
  return (
    !!item &&
    item['field'] === field &&
    (item['source'] === undefined || item['source'] === alias) &&
    hasOnlyKeys(item, ['field', 'source', 'as']) &&
    (item['as'] === undefined || typeof item['as'] === 'string')
  );
};

const isCount = (value: unknown, alias: string): 'star' | 'InvoiceId' | undefined => {
  const aggregate = record(record(value)?.['aggregate']);
  const args = aggregate?.['args'];
  if (
    aggregate?.['function'] !== 'count' ||
    aggregate['distinct'] === true ||
    !hasOnlyKeys(aggregate, ['function', 'args']) ||
    !Array.isArray(args) ||
    args.length !== 1
  ) {
    return undefined;
  }
  const argument = record(args[0]);
  if (
    argument?.['star'] === true &&
    hasOnlyKeys(argument, ['star'])
  ) {
    return 'star';
  }
  if (isAliasField(argument, alias, 'InvoiceId')) return 'InvoiceId';
  return undefined;
};

/**
 * Reads the deliberately small Invoice authoring subset. The TugQL parser is
 * the syntax authority; this adapter only exposes controls for a whole query
 * that the existing browser SQLite profile admits.
 */
export function readAuthorComposeProfile(source: string): AuthorComposeProfile {
  if (/--|\/\*/u.test(source)) {
    return unsupported('This query contains comments. Edit it in Code to preserve them.');
  }
  const parsed = parseTugQL(source);
  if (parsed.diagnostics.length || !parsed.document.tree) {
    return unsupported('This source is not a supported Compose query. It remains unchanged in Code.');
  }
  const tree = parsed.document.tree;
  const query = record(tree.query);
  const from = record(query?.['from']);
  const params = tree.parameters;
  if (
    tree.definitions?.length ||
    params?.length !== 1 ||
    params[0]?.name !== 'CustomerId' ||
    params[0]?.type.toLowerCase() !== 'integer' ||
    params[0]?.required !== true ||
    !hasOnlyKeys(params[0] as unknown as Record<string, unknown>, ['name', 'type', 'required']) ||
    !query ||
    !from ||
    from['name'] !== 'Invoice' ||
    (from['schema'] !== undefined && from['schema'] !== 'main') ||
    !hasOnlyKeys(from, ['name', 'schema', 'alias'])
  ) {
    return unsupported('Compose supports only the bounded Invoice query profile. Edit other TugQL in Code.');
  }
  const alias = typeof from['alias'] === 'string' ? from['alias'] : 'Invoice';
  const where = record(query['where']);
  const left = record(where?.['left']);
  const right = record(where?.['right']);
  if (
    !where ||
    where['op'] !== '==' ||
    left?.['field'] !== 'CustomerId' ||
    (left['source'] !== undefined && left['source'] !== alias) ||
    right?.['param'] !== 'CustomerId' ||
    !hasOnlyKeys(where, ['op', 'left', 'right']) ||
    !hasOnlyKeys(left, ['field', 'source']) ||
    !hasOnlyKeys(right, ['param'])
  ) {
    return unsupported('Compose requires the declared @CustomerId filter. The source remains unchanged in Code.');
  }
  if (
    query['kind'] !== undefined ||
    query['as'] !== undefined ||
    query['offset'] !== undefined ||
    query['orderBy'] !== undefined ||
    !hasOnlyKeys(query, ['from', 'where', 'groupBy', 'having', 'limit', 'columns'])
  ) {
    return unsupported('Compose cannot preserve every clause in this query. Use Code; the source remains unchanged.');
  }
  const limit = query['limit'];
  const columns = query['columns'];
  if (
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Array.isArray(columns) ||
    !columns.length ||
    columns.length > 2
  ) {
    return unsupported('Compose requires an explicit supported projection and a limit from 1 to 100.');
  }

  const grouped = query['groupBy'] !== undefined || query['having'] !== undefined;
  if (!grouped) {
    const first = record(columns[0]);
    const second = columns.length === 2 ? record(columns[1]) : undefined;
    if (
      !first ||
      !isColumnField(first, alias, 'InvoiceId') ||
      (columns.length === 2 &&
        (!second ||
          !isColumnField(second, alias, 'InvoiceDate')))
    ) {
      return unsupported('Compose supports InvoiceId with optional InvoiceDate. Use Code for other projections.');
    }
    const firstColumn = first as Record<string, unknown>;
    const secondColumn = second as Record<string, unknown> | undefined;
    return {
      supported: true,
      writable: true,
      grouped: false,
      includeInvoiceDate: columns.length === 2,
      limit,
      schema: typeof from['schema'] === 'string' ? from['schema'] : undefined,
      tableAlias: alias,
      invoiceIdAlias: typeof firstColumn['as'] === 'string' ? firstColumn['as'] : undefined,
      invoiceDateAlias:
        typeof secondColumn?.['as'] === 'string' ? secondColumn['as'] : undefined,
    };
  }

  const groupBy = query['groupBy'];
  const having = record(query['having']);
  const havingCount = isCount(having?.['left'], alias);
  const comparison = having?.['op'];
  const havingValue = record(having?.['right'])?.['value'];
  if (
    !Array.isArray(groupBy) ||
    groupBy.length !== 1 ||
    !isAliasField(groupBy[0], alias, 'CustomerId') ||
    !having ||
    !havingCount ||
    !['==', '!=', '<', '<=', '>', '>='].includes(String(comparison)) ||
    typeof havingValue !== 'number' ||
    !Number.isSafeInteger(havingValue) ||
    columns.length !== 2 ||
    !isColumnField(columns[0], alias, 'CustomerId') ||
    isCount(record(columns[1]), alias) !== havingCount ||
    !hasOnlyKeys(record(columns[1]) ?? {}, ['aggregate', 'as']) ||
    (record(columns[1])?.['as'] !== undefined &&
      typeof record(columns[1])?.['as'] !== 'string') ||
    !hasOnlyKeys(having, ['op', 'left', 'right']) ||
    !hasOnlyKeys(record(having['right']) ?? {}, ['value'])
  ) {
    return unsupported('Compose supports CustomerId grouped by COUNT with an integer HAVING threshold. Use Code for other grouped queries.');
  }
  const operator: AuthorHavingOperator = comparison === '==' ? '=' : comparison as AuthorHavingOperator;
  return {
    supported: true,
    writable: true,
    grouped: true,
    countExpression: havingCount,
    havingOperator: operator,
    threshold: havingValue,
    limit,
    schema: typeof from['schema'] === 'string' ? from['schema'] : undefined,
    tableAlias: alias,
    customerIdAlias:
      typeof record(columns[0])?.['as'] === 'string'
        ? (record(columns[0])?.['as'] as string)
        : undefined,
    countAlias:
      typeof record(columns[1])?.['as'] === 'string'
        ? (record(columns[1])?.['as'] as string)
        : undefined,
  };
}

export interface AuthorComposeChanges {
  readonly grouped: boolean;
  readonly includeInvoiceDate: boolean;
  readonly countExpression: 'star' | 'InvoiceId';
  readonly havingOperator: AuthorHavingOperator;
  readonly threshold: number;
  readonly limit: number;
}

/** Generates, formats, then reparses a complete supported document before it can replace Code. */
export function updateAuthorComposeSource(
  source: string,
  changes: AuthorComposeChanges,
): string | undefined {
  const current = readAuthorComposeProfile(source);
  if (!current.supported || !current.writable) return undefined;
  if (
    !Number.isSafeInteger(changes.limit) ||
    changes.limit < 1 ||
    changes.limit > 100 ||
    !Number.isSafeInteger(changes.threshold)
  ) {
    return undefined;
  }
  const parsed = parseTugQL(source);
  const tree = parsed.document.tree;
  const query = record(tree?.query);
  const from = record(query?.['from']);
  const alias = typeof from?.['alias'] === 'string' ? from['alias'] : undefined;
  const schema = typeof from?.['schema'] === 'string' ? from['schema'] : undefined;
  const currentProfile = readAuthorComposeProfile(source);
  const field = (name: string) => `${alias ? `${alias}.` : ''}${name}`;
  const clauses = [
    'parameters (',
    '  @CustomerId integer required',
    ')',
    `from ${schema ? `${schema}.` : ''}Invoice${alias ? ` as ${alias}` : ''}`,
    `where ${field('CustomerId')} = @CustomerId`,
  ];
  if (changes.grouped) {
    const count = changes.countExpression === 'star' ? 'count(*)' : `count(${field('InvoiceId')})`;
    const op = changes.havingOperator === '=' ? '==' : changes.havingOperator;
    clauses.push(
      `group by ${field('CustomerId')}`,
      `having ${count} ${op} ${changes.threshold}`,
    );
  }
  clauses.push(`limit ${changes.limit}`);
  if (changes.grouped) {
    const count = changes.countExpression === 'star' ? 'count(*)' : `count(${field('InvoiceId')})`;
    const customerColumn = currentProfile.grouped
      ? `${field('CustomerId')}${currentProfile.customerIdAlias ? ` as ${currentProfile.customerIdAlias}` : ''}`
      : field('CustomerId');
    const countAlias = currentProfile.grouped
      ? currentProfile.countAlias ?? 'InvoiceCount'
      : 'InvoiceCount';
    clauses.push(`select ${customerColumn}, ${count} as ${countAlias}`);
  } else {
    const invoiceIdAlias = currentProfile.grouped ? undefined : currentProfile.invoiceIdAlias;
    const invoiceDateAlias = currentProfile.grouped ? undefined : currentProfile.invoiceDateAlias;
    clauses.push(
      `select ${field('InvoiceId')}${invoiceIdAlias ? ` as ${invoiceIdAlias}` : ''}${changes.includeInvoiceDate ? `, ${field('InvoiceDate')}${invoiceDateAlias ? ` as ${invoiceDateAlias}` : ''}` : ''}`,
    );
  }
  const formatted = formatTugQL(clauses.join('\n'));
  if (formatted.diagnostics.length) return undefined;
  const candidate = formatted.source;
  const candidateProfile = readAuthorComposeProfile(candidate);
  return candidateProfile.supported && candidateProfile.writable ? candidate : undefined;
}
