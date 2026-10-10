import { formatTugQL, parseTugQL, type TugQLFormatOptions } from '@dalgo/core';

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

function formatterOptions(source: string): TugQLFormatOptions {
  const firstClause = source.match(
    /^(?:parameters|from|where|group by|having|limit|select)\b/imu,
  )?.[0];
  const parameterIndent = source.match(/^(\t+| {2,})@CustomerId\b/mu)?.[1];
  return {
    keywordCase: firstClause === firstClause?.toUpperCase() ? 'uppercase' : 'lowercase',
    indentation: parameterIndent?.startsWith('\t') ? 'tab' : 'two-spaces',
  };
}

/**
 * Finds a single literal inside a parser-admitted clause and replaces only
 * that token. `readAuthorComposeProfile` has already established the clause
 * semantics; this locator deliberately cannot admit or reinterpret a query.
 */
function replaceClauseLiteral(
  source: string,
  clauseName: 'having' | 'limit',
  expectedValue: number,
  replacement: number,
): string | undefined {
  const lines = source.split(/(?<=\n)/u);
  const start = lines.findIndex((line) =>
    new RegExp(`^${clauseName}\\b`, 'iu').test(line),
  );
  if (start < 0) return undefined;
  let end = start + 1;
  while (
    end < lines.length &&
    !/^(?:group\s+by|having|limit|select)\b/iu.test(lines[end] ?? '')
  ) {
    end += 1;
  }
  const clause = lines.slice(start, end).join('');
  const numbers = [...clause.matchAll(/(?<![\w@])(-?\d+)(?!\w)/gu)];
  if (numbers.length !== 1 || Number(numbers[0]?.[1]) !== expectedValue) {
    return undefined;
  }
  const match = numbers[0];
  const localIndex = match.index;
  if (localIndex === undefined) return undefined;
  const absoluteIndex = lines.slice(0, start).join('').length + localIndex;
  const oldValue = match[1];
  if (oldValue === undefined) return undefined;
  return `${source.slice(0, absoluteIndex)}${replacement}${source.slice(absoluteIndex + oldValue.length)}`;
}

function replaceHavingOperator(
  source: string,
  expected: AuthorHavingOperator,
  replacement: AuthorHavingOperator,
): string | undefined {
  const lines = source.split(/(?<=\n)/u);
  const start = lines.findIndex((line) => /^having\b/iu.test(line));
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < lines.length && !/^(?:limit|select)\b/iu.test(lines[end] ?? '')) {
    end += 1;
  }
  const clause = lines.slice(start, end).join('');
  const operators = [...clause.matchAll(/(?<![<>=!])(?:==|!=|<=|>=|=|<|>)(?![=])/gu)];
  if (operators.length !== 1) return undefined;
  const match = operators[0];
  const raw = match?.[0];
  const normalized = raw === '==' ? '=' : raw;
  if (normalized !== expected || match?.index === undefined) return undefined;
  const absoluteIndex = lines.slice(0, start).join('').length + match.index;
  return `${source.slice(0, absoluteIndex)}${replacement === '=' ? '==' : replacement}${source.slice(absoluteIndex + raw.length)}`;
}

type LocalizedClauseUpdate =
  | { readonly structural: true }
  | { readonly structural: false; readonly source?: string };

function updateNonStructuralClauses(
  source: string,
  current: AuthorComposeProfile,
  changes: AuthorComposeChanges,
): LocalizedClauseUpdate {
  if (
    current.grouped !== changes.grouped ||
    (current.grouped && current.countExpression !== changes.countExpression) ||
    (!current.grouped && current.includeInvoiceDate !== changes.includeInvoiceDate)
  ) {
    return { structural: true };
  }
  let result = source;
  if (current.grouped && current.havingOperator !== changes.havingOperator) {
    const updated = replaceHavingOperator(
      result,
      current.havingOperator ?? '>=',
      changes.havingOperator,
    );
    if (updated === undefined) return { structural: false };
    result = updated;
  }
  if (current.grouped && current.threshold !== changes.threshold) {
    const updated = replaceClauseLiteral(
      result,
      'having',
      current.threshold ?? 7,
      changes.threshold,
    );
    if (updated === undefined) return { structural: false };
    result = updated;
  }
  if (current.limit !== changes.limit) {
    const updated = replaceClauseLiteral(result, 'limit', current.limit ?? 100, changes.limit);
    if (updated === undefined) return { structural: false };
    result = updated;
  }
  const reparsed = readAuthorComposeProfile(result);
  if (
    !reparsed.supported ||
    !reparsed.writable ||
    reparsed.grouped !== changes.grouped ||
    reparsed.limit !== changes.limit ||
    (changes.grouped &&
      (reparsed.havingOperator !== changes.havingOperator ||
        reparsed.threshold !== changes.threshold ||
        reparsed.countExpression !== changes.countExpression)) ||
    (!changes.grouped &&
      reparsed.includeInvoiceDate !== changes.includeInvoiceDate)
  ) {
    return { structural: false };
  }
  return { structural: false, source: result };
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
  const localized = updateNonStructuralClauses(source, current, changes);
  if (!localized.structural) return localized.source;
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
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const formatted = formatTugQL(clauses.join(newline), formatterOptions(source));
  if (formatted.diagnostics.length) return undefined;
  const candidate = formatted.source;
  const candidateProfile = readAuthorComposeProfile(candidate);
  if (
    !candidateProfile.supported ||
    !candidateProfile.writable ||
    candidateProfile.grouped !== changes.grouped ||
    candidateProfile.limit !== changes.limit ||
    (changes.grouped &&
      (candidateProfile.havingOperator !== changes.havingOperator ||
        candidateProfile.threshold !== changes.threshold ||
        candidateProfile.countExpression !== changes.countExpression)) ||
    (!changes.grouped &&
      candidateProfile.includeInvoiceDate !== changes.includeInvoiceDate)
  ) {
    return undefined;
  }
  return candidate;
}
