import { formatTugQL, parseTugQL, type TugQLFormatOptions } from '@dalgo/core';

export type AuthorHavingOperator = '=' | '!=' | '<' | '<=' | '>' | '>=';

export interface AuthorComposeProfile {
  readonly supported: boolean;
  readonly writable: boolean;
  readonly reason?: string;
  readonly grouped?: boolean;
  readonly joined?: boolean;
  readonly customerAlias?: string;
  readonly invoiceDateToggleSupported?: boolean;
  readonly invoiceDateToggleReason?: string;
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

function isJoinOnInvoiceCustomerKey(
  value: unknown,
  invoiceAlias: string,
  customerAlias: string,
): boolean {
  const join = record(value);
  const joinedFrom = record(join?.['from']);
  const on = join?.['on'];
  const predicate = Array.isArray(on) ? record(on[0]) : undefined;
  const left = record(predicate?.['left']);
  const right = record(predicate?.['right']);
  return !!join && !!joinedFrom && joinedFrom['name'] === 'Customer' &&
    (joinedFrom['schema'] === undefined || joinedFrom['schema'] === 'main') &&
    (joinedFrom['alias'] === undefined || joinedFrom['alias'] === customerAlias) &&
    (join['type'] === undefined || String(join['type']).toLowerCase() === 'inner') &&
    Array.isArray(on) && on.length === 1 && predicate?.['op'] === '==' &&
    ((left?.['field'] === 'CustomerId' && left['source'] === invoiceAlias &&
      right?.['field'] === 'CustomerId' && right['source'] === customerAlias) ||
      (right?.['field'] === 'CustomerId' && right['source'] === invoiceAlias &&
        left?.['field'] === 'CustomerId' && left['source'] === customerAlias)) &&
    hasOnlyKeys(join, ['from', 'on', 'type']) &&
    hasOnlyKeys(joinedFrom, ['name', 'schema', 'alias', 'joins']) &&
    (!Array.isArray(joinedFrom['joins']) || joinedFrom['joins'].length === 0) &&
    hasOnlyKeys(predicate ?? {}, ['op', 'left', 'right']) &&
    hasOnlyKeys(left ?? {}, ['field', 'source']) &&
    hasOnlyKeys(right ?? {}, ['field', 'source']);
}

function isJoinedProjection(
  value: unknown,
  invoiceAlias: string,
  customerAlias: string,
): boolean {
  const column = record(value);
  if (!column || !hasOnlyKeys(column, ['field', 'source', 'as']) ||
      (column['as'] !== undefined && typeof column['as'] !== 'string')) return false;
  const field = column['field'];
  const source = column['source'];
  if (typeof field !== 'string' || typeof source !== 'string') return false;
  if (source === invoiceAlias) return ['InvoiceId', 'InvoiceDate', 'CustomerId'].includes(field);
  if (source === customerAlias) return ['FirstName', 'LastName', 'Email'].includes(field);
  return false;
}

function outputName(value: unknown): string | undefined {
  const column = record(value);
  return typeof column?.['as'] === 'string'
    ? column['as'].toLowerCase()
    : typeof column?.['field'] === 'string'
      ? column['field'].toLowerCase()
      : undefined;
}

function isJoinedOrderByInvoiceId(value: unknown, alias: string): boolean {
  const item = record(value);
  if (!item) return false;
  const nested = record(item['field']);
  const field = nested ?? item;
  const source = nested ? nested['source'] : item['source'];
  return field?.['field'] === 'InvoiceId' && source === alias &&
    (item['direction'] === undefined || item['direction'] === 'asc') &&
    (nested
      ? hasOnlyKeys(item, ['field', 'direction']) && hasOnlyKeys(nested, ['field', 'source'])
      : hasOnlyKeys(item, ['field', 'source', 'direction']));
}

function hasComment(source: string): boolean {
  return /--|\/\*/u.test(source);
}

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
    !hasOnlyKeys(from, ['name', 'schema', 'alias', 'joins'])
  ) {
    return unsupported('Compose supports only the bounded Invoice query profile. Edit other TugQL in Code.');
  }
  const alias = typeof from['alias'] === 'string' ? from['alias'] : 'Invoice';
  const joins = Array.isArray(from['joins']) ? from['joins'] : [];
  if (joins.length > 1) {
    return unsupported('Compose supports at most one declared Invoice-to-Customer join. Edit other queries in Code.');
  }
  const joined = joins.length === 1;
  const join = joined ? record(joins[0]) : undefined;
  const joinedFrom = record(join?.['from']);
  const customerAlias = joined
    ? (typeof joinedFrom?.['alias'] === 'string' ? joinedFrom['alias'] : 'Customer')
    : undefined;
  if (joined && (!customerAlias || customerAlias.toLowerCase() === alias.toLowerCase() ||
      !isJoinOnInvoiceCustomerKey(join, alias, customerAlias))) {
    return unsupported('Compose requires the declared Invoice.CustomerId to Customer.CustomerId inner join.');
  }
  if (hasComment(source) && (!joined || /\/\*/u.test(source))) {
    return unsupported('Compose cannot safely preserve comments in this query. Edit it in Code.');
  }
  const where = record(query['where']);
  const left = record(where?.['left']);
  const right = record(where?.['right']);
  if (
    !where ||
    where['op'] !== '==' ||
    left?.['field'] !== 'CustomerId' ||
    (joined ? left['source'] !== alias :
      (left['source'] !== undefined && left['source'] !== alias)) ||
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
    (joined
      ? !Array.isArray(query['orderBy']) ||
        query['orderBy'].length !== 1 ||
        !isJoinedOrderByInvoiceId(query['orderBy'][0], alias)
      : query['orderBy'] !== undefined) ||
    !hasOnlyKeys(query, ['from', 'where', 'groupBy', 'having', 'limit', 'columns', 'orderBy'])
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
    columns.length > (joined ? 6 : 2)
  ) {
    return unsupported('Compose requires an explicit supported projection and a limit from 1 to 100.');
  }

  const grouped = query['groupBy'] !== undefined || query['having'] !== undefined;
  if (joined && grouped) {
    return unsupported('Grouping is not supported for Invoice-to-Customer Compose queries. Edit grouped queries in Code.');
  }
  if (!grouped) {
    const first = record(columns[0]);
    if (!first || !isColumnField(first, alias, 'InvoiceId')) {
      return unsupported('Compose requires InvoiceId as the first direct projection.');
    }
    if (joined) {
      const joinedCustomerAlias = customerAlias ?? 'Customer';
      if (columns.some((column) => !isJoinedProjection(column, alias, joinedCustomerAlias))) {
        return unsupported('Compose supports direct Invoice and Customer fields in this joined query.');
      }
      const names = columns.map(outputName);
      if (names.some((name) => !name) || new Set(names).size !== names.length) {
        return unsupported('Compose requires unique output names in this joined query.');
      }
      const dateColumn = columns.find((column) => {
        const item = record(column);
        return item?.['field'] === 'InvoiceDate' && item['source'] === alias;
      });
      const profile: AuthorComposeProfile = {
        supported: true,
        writable: true,
        grouped: false,
        joined: true,
        includeInvoiceDate: dateColumn !== undefined,
        limit,
        schema: typeof from['schema'] === 'string' ? from['schema'] : undefined,
        tableAlias: alias,
        customerAlias: joinedCustomerAlias,
        invoiceIdAlias: typeof first['as'] === 'string' ? first['as'] : undefined,
        invoiceDateAlias: typeof record(dateColumn)?.['as'] === 'string'
          ? record(dateColumn)?.['as'] as string
          : undefined,
      };
      const dateToggleSupported = joinedDateToggleRoundTrips(source, profile, columns);
      return {
        ...profile,
        invoiceDateToggleSupported: dateToggleSupported,
        ...(dateToggleSupported
          ? {}
          : {
              invoiceDateToggleReason:
                'InvoiceDate is fixed because toggling it could change authored projection details, collide with an output name, or exceed six outputs. Row limit edits remain available.',
            }),
      };
    }
    const second = columns.length === 2 ? record(columns[1]) : undefined;
    if (columns.length === 2 && (!second || !isColumnField(second, alias, 'InvoiceDate'))) {
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
  // Mask line comments with same-length spaces so the token's source offset
  // remains exact while numbers in comments are ignored.
  const searchableClause = clause.replace(/--[^\r\n]*/gu, (comment) =>
    ' '.repeat(comment.length),
  );
  const numbers = [...searchableClause.matchAll(/(?<![\w@])(-?\d+)(?!\w)/gu)];
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

interface SourceLine {
  readonly start: number;
  readonly end: number;
  readonly content: string;
  readonly ending: string;
}

function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (const match of source.matchAll(/\r\n|\r|\n/gu)) {
    const index = match.index;
    const ending = match[0];
    lines.push({
      start,
      end: index + ending.length,
      content: source.slice(start, index),
      ending,
    });
    start = index + ending.length;
  }
  if (start < source.length) {
    lines.push({ start, end: source.length, content: source.slice(start), ending: '' });
  }
  return lines;
}

function directProjectionMatch(
  text: string,
): { readonly start: number; readonly end: number; readonly source?: string; readonly field: string; readonly alias?: string } | undefined {
  const commentIndex = text.indexOf('--');
  const expression = (commentIndex < 0 ? text : text.slice(0, commentIndex));
  const match = /([A-Za-z_][\w]*)(?:\.([A-Za-z_][\w]*))?(?:[ \t]+as[ \t]+([A-Za-z_][\w]*))?[ \t]*$/iu.exec(expression);
  if (!match || match.index === undefined) return undefined;
  if (expression.slice(0, match.index).trim()) return undefined;
  const start = match.index;
  const token = match[0].trimEnd();
  const tokenMatch = /^([A-Za-z_][\w]*)(?:\.([A-Za-z_][\w]*))?(?:[ \t]+as[ \t]+([A-Za-z_][\w]*))?$/iu.exec(token);
  if (!tokenMatch) return undefined;
  const source = tokenMatch[2] ? tokenMatch[1] : undefined;
  const field = tokenMatch[2] ?? tokenMatch[1];
  const alias = tokenMatch[3];
  if (!field) return undefined;
  return {
    start,
    end: start + token.length,
    ...(source ? { source } : {}),
    field,
    ...(alias ? { alias } : {}),
  };
}

function lineMatchesProjection(line: SourceLine, column: unknown): boolean {
  const item = record(column);
  const match = directProjectionMatch(line.content);
  return !!item && !!match &&
    match.field.toLowerCase() === String(item['field']).toLowerCase() &&
    (match.source ?? '') === String(item['source'] ?? '') &&
    (match.alias ?? '') === String(item['as'] ?? '');
}

function replaceJoinedInvoiceDateProjection(
  source: string,
  current: AuthorComposeProfile,
  includeInvoiceDate: boolean,
): string | undefined {
  const parsed = parseTugQL(source);
  const query = record(parsed.document.tree?.query);
  const columnsValue = query?.['columns'];
  if (!Array.isArray(columnsValue) || !columnsValue.length || /\/\*/u.test(source)) {
    return undefined;
  }
  const columns: unknown[] = columnsValue;
  const dateIndexes = columns.flatMap((column, index) => {
    const field = record(column);
    return field?.['field'] === 'InvoiceDate' && field['source'] === current.tableAlias
      ? [index]
      : [];
  });
  if (dateIndexes.length > 1 || (includeInvoiceDate && dateIndexes.length)) return undefined;
  if (!includeInvoiceDate && !dateIndexes.length) return undefined;

  const lines = sourceLines(source);
  const selectIndex = lines.findIndex((line) => /^\s*select\b/iu.test(line.content));
  if (selectIndex < 0) return undefined;
  const header = lines[selectIndex];
  if (!header) return undefined;
  const headerMatch = /^([ \t]*)select\b(.*)$/iu.exec(header.content);
  if (!headerMatch || headerMatch[2] === undefined) return undefined;
  const rest = headerMatch[2];
  const openBlock = /^\s*\(/u.test(rest);
  if (openBlock) {
    const open = rest.indexOf('(');
    if (open < 0 || !/^\s*\(\s*(?:--.*)?$/u.test(rest)) return undefined;
    const closeIndex = lines.findIndex((line, index) => index > selectIndex && /^\s*\)(?:[ \t]*--.*)?$/u.test(line.content));
    if (closeIndex < 0) return undefined;
    const itemLines: number[] = [];
    let columnIndex = 0;
    for (let index = selectIndex + 1; index < closeIndex; index++) {
      const line = lines[index];
      if (!line || !line.content.trim() || /^\s*--/u.test(line.content)) continue;
      const column = columns[columnIndex];
      if (!column || !lineMatchesProjection(line, column)) return undefined;
      itemLines.push(index);
      columnIndex++;
    }
    if (columnIndex !== columns.length) return undefined;
    if (includeInvoiceDate) {
      const firstLineIndex = itemLines[0];
      const firstLine = firstLineIndex === undefined ? undefined : lines[firstLineIndex];
      if (!firstLine || !firstLine.ending) return undefined;
      const firstItem = directProjectionMatch(firstLine.content);
      if (!firstItem) return undefined;
      const alias = current.tableAlias ?? 'Invoice';
      const dateCase = firstItem.field === firstItem.field.toUpperCase()
        ? 'INVOICEDATE'
        : firstItem.field === firstItem.field.toLowerCase()
          ? 'invoicedate'
          : 'InvoiceDate';
      const inserted = `${firstLine.content.slice(0, firstItem.start)}${alias}.${dateCase}${firstLine.ending}`;
      return `${source.slice(0, firstLine.end)}${inserted}${source.slice(firstLine.end)}`;
    }
    const dateLineIndex = itemLines[dateIndexes[0] ?? -1];
    const dateLine = dateLineIndex === undefined ? undefined : lines[dateLineIndex];
    if (!dateLine) return undefined;
    const commentIndex = dateLine.content.indexOf('--');
    if (commentIndex >= 0) {
      const indent = dateLine.content.match(/^[ \t]*/u)?.[0] ?? '';
      const suffix = dateLine.content.slice(commentIndex);
      return `${source.slice(0, dateLine.start)}${indent}${suffix}${dateLine.ending}${source.slice(dateLine.end)}`;
    }
    return `${source.slice(0, dateLine.start)}${source.slice(dateLine.end)}`;
  }

  const selectStart = header.start + (headerMatch[1]?.length ?? 0) + 'select'.length;
  const commentIndex = source.indexOf('--', selectStart);
  const lineEnd = header.end - header.ending.length;
  const expressionEnd = commentIndex >= selectStart && commentIndex < lineEnd
    ? commentIndex
    : lineEnd;
  const expression = source.slice(selectStart, expressionEnd);
  const pieces: { readonly start: number; readonly end: number; readonly commaBefore?: number }[] = [];
  let partStart = 0;
  for (let offset = 0; offset < expression.length; offset++) {
    if (expression[offset] === ',') {
      pieces.push({
        start: partStart,
        end: offset,
        ...(pieces.length ? { commaBefore: expression.lastIndexOf(',', partStart - 1) } : {}),
      });
      partStart = offset + 1;
    }
  }
  pieces.push({
    start: partStart,
    end: expression.length,
    ...(pieces.length ? { commaBefore: expression.lastIndexOf(',', partStart - 1) } : {}),
  });
  if (pieces.length !== columns.length) return undefined;
  const matches = pieces.map((piece) => {
    const raw = expression.slice(piece.start, piece.end);
    const match = directProjectionMatch(raw);
    return match ? { ...match, absoluteStart: selectStart + piece.start + match.start, absoluteEnd: selectStart + piece.start + match.end } : undefined;
  });
  if (matches.some((match, index) => {
    const item = record(columns[index]);
    return !item || !match || match.field.toLowerCase() !== String(item['field']).toLowerCase() ||
      (match.source ?? '') !== String(item['source'] ?? '') ||
      (match.alias ?? '') !== String(item['as'] ?? '');
  })) return undefined;
  if (includeInvoiceDate) {
    const first = matches[0];
    if (!first) return undefined;
    const alias = current.tableAlias ?? 'Invoice';
    const dateCase = first.field === first.field.toUpperCase()
      ? 'INVOICEDATE'
      : first.field === first.field.toLowerCase()
        ? 'invoicedate'
        : 'InvoiceDate';
    return `${source.slice(0, first.absoluteEnd)}, ${alias}.${dateCase}${source.slice(first.absoluteEnd)}`;
  }
  const index = dateIndexes[0];
  const piece = pieces[index ?? -1];
  const match = matches[index ?? -1];
  if (!piece || !match || index === undefined || index < 1) return undefined;
  const previousComma = pieces[index]?.commaBefore;
  if (previousComma === undefined || previousComma < 0) return undefined;
  const nextPiece = pieces[index + 1];
  const removeEnd = nextPiece ? selectStart + nextPiece.start - 1 : match.absoluteEnd;
  return `${source.slice(0, selectStart + previousComma)}${source.slice(removeEnd)}`;
}

function joinedDateToggleRoundTrips(
  source: string,
  profile: AuthorComposeProfile,
  columns: readonly unknown[],
): boolean {
  const dateIndexes = columns.flatMap((column, index) => {
    const item = record(column);
    return item?.['field'] === 'InvoiceDate' && item['source'] === profile.tableAlias
      ? [index]
      : [];
  });
  if (dateIndexes.length > 1 || (dateIndexes[0] !== undefined && dateIndexes[0] !== 1)) {
    return false;
  }
  const dateIndex = dateIndexes[0];
  if (dateIndex === undefined && columns.length >= 6) return false;
  const dateColumn = dateIndex === undefined ? undefined : record(columns[dateIndex]);
  if (dateColumn?.['as'] !== undefined) return false;
  if (columns.some((column, index) =>
    index !== dateIndex && outputName(column) === 'invoicedate')) {
    return false;
  }

  const current = { ...profile, includeInvoiceDate: dateIndex !== undefined };
  const withoutDate = dateIndex === undefined
    ? replaceJoinedInvoiceDateProjection(source, current, true)
    : replaceJoinedInvoiceDateProjection(source, current, false);
  if (withoutDate === undefined) return false;
  const toggled = {
    ...current,
    includeInvoiceDate: dateIndex === undefined,
  };
  const restored = replaceJoinedInvoiceDateProjection(
    withoutDate,
    toggled,
    dateIndex !== undefined,
  );
  return restored === source;
}

/**
 * Toggles the optional projection within the parser-admitted single-source
 * Invoice profile. It edits only the final projection item, preserving the
 * authored SELECT layout, casing, line endings, and trailing whitespace.
 */
function replaceInvoiceDateProjection(
  source: string,
  current: AuthorComposeProfile,
  includeInvoiceDate: boolean,
): string | undefined {
  if (current.joined) {
    return replaceJoinedInvoiceDateProjection(source, current, includeInvoiceDate);
  }
  const select = /(^|\n)([ \t]*)(select)\b/iu.exec(source);
  if (!select || select.index === undefined) return undefined;
  const tokenStart = select.index + (select[1]?.length ?? 0) + (select[2]?.length ?? 0);
  const contentStart = tokenStart + (select[3]?.length ?? 0);
  const content = source.slice(contentStart);
  const leading = content.match(/^\s*/u)?.[0] ?? '';
  const trailing = content.match(/\s*$/u)?.[0] ?? '';
  const trimmedEnd = content.length - trailing.length;
  const core = content.slice(leading.length, trimmedEnd);
  if (!core) return undefined;
  const separator = /\r\n/u.test(source) ? '\r\n' : '\n';

  const parenthesized = /^\(([\s\S]*)\)$/u.exec(core);
  if (parenthesized) {
    const inner = parenthesized[1] ?? '';
    if (!includeInvoiceDate) {
      const block = /^(\r?\n[ \t]*)([^\r\n]+)(\r?\n)[ \t]*([^\r\n]+)(\r?\n[ \t]*)$/u.exec(inner);
      if (
        !block ||
        !isInvoiceProjectionLine(block[2] ?? '', 'InvoiceId') ||
        !isInvoiceProjectionLine(block[4] ?? '', 'InvoiceDate')
      ) {
        return undefined;
      }
      const nextCore = `(${block[1]}${block[2]}${block[5]})`;
      return `${source.slice(0, contentStart)}${leading}${nextCore}${trailing}`;
    }

    const block = /^(\r?\n[ \t]*)([^\r\n]+)(\r?\n[ \t]*)$/u.exec(inner);
    const invoiceIdLine = block?.[2];
    if (!block || !invoiceIdLine || !isInvoiceProjectionLine(invoiceIdLine, 'InvoiceId')) {
      return undefined;
    }
    const fieldExpression = /^(?:(?:[A-Za-z_][\w]*)\.)?InvoiceId/iu.exec(
      invoiceIdLine.trim(),
    )?.[0];
    if (!fieldExpression) return undefined;
    const field = /InvoiceId$/iu.exec(fieldExpression)?.[0] ?? 'InvoiceId';
    const dateField =
      field === field.toUpperCase()
        ? 'INVOICEDATE'
        : field === field.toLowerCase()
          ? 'invoicedate'
          : 'InvoiceDate';
    const dateExpression = fieldExpression.replace(/InvoiceId/iu, dateField);
    const indent = block[1].match(/(?:\r?\n)([ \t]*)$/u)?.[1] ?? '';
    const nextCore = `(${block[1]}${invoiceIdLine}${separator}${indent}${dateExpression}${block[3]})`;
    return `${source.slice(0, contentStart)}${leading}${nextCore}${trailing}`;
  }

  if (!includeInvoiceDate) {
    const dateItem = /,\s*(?:(?:[A-Za-z_][\w]*)\.)?InvoiceDate(?:\s+as\s+[A-Za-z_][\w]*)?$/iu.exec(core);
    if (!dateItem || dateItem.index === undefined) return undefined;
    const nextCore = core.slice(0, dateItem.index);
    if (!nextCore.trim()) return undefined;
    return `${source.slice(0, contentStart)}${leading}${nextCore}${trailing}`;
  }

  const invoiceId = /(?:(?:[A-Za-z_][\w]*)\.)?(InvoiceId)(?:\s+as\s+[A-Za-z_][\w]*)?$/iu.exec(core);
  if (!invoiceId || invoiceId.index === undefined) return undefined;
  const expression = invoiceId[0];
  const field = invoiceId[1];
  if (!field) return undefined;
  const dateField =
    field === field.toUpperCase()
      ? 'INVOICEDATE'
      : field === field.toLowerCase()
        ? 'invoicedate'
        : 'InvoiceDate';
  const fieldExpression = /^(?:(?:[A-Za-z_][\w]*)\.)?InvoiceId/iu.exec(
    expression,
  )?.[0];
  if (!fieldExpression) return undefined;
  const dateExpression = fieldExpression.replace(/InvoiceId/iu, dateField);
  const lastLine = core.split(/\r?\n/u).at(-1) ?? core;
  const indent = core.includes('\n') || core.includes('\r')
    ? lastLine.match(/^[ \t]*/u)?.[0] ?? ''
    : leading.match(/(?:^|\r?\n)([ \t]*)$/u)?.[1] ?? '';
  const blockLayout = /[\r\n]/u.test(leading + core);
  const addition = blockLayout
    ? `,${separator}${indent}${dateExpression}`
    : `, ${dateExpression}`;
  return `${source.slice(0, contentStart)}${leading}${core}${addition}${trailing}`;
}

function isInvoiceProjectionLine(line: string, field: 'InvoiceId' | 'InvoiceDate'): boolean {
  const expression = /^(?:(?:[A-Za-z_][\w]*)\.)?(InvoiceId|InvoiceDate)(?:\s+as\s+[A-Za-z_][\w]*)?$/iu.exec(
    line.trim(),
  );
  return expression?.[1]?.toLowerCase() === field.toLowerCase();
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
    (current.grouped && current.countExpression !== changes.countExpression)
  ) {
    return { structural: true };
  }
  let result = source;
  if (
    !current.grouped &&
    current.includeInvoiceDate !== changes.includeInvoiceDate
  ) {
    if (current.joined && !current.invoiceDateToggleSupported) {
      return { structural: false };
    }
    const updated = replaceInvoiceDateProjection(
      result,
      current,
      changes.includeInvoiceDate,
    );
    if (updated === undefined) return { structural: false };
    result = updated;
  }
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
    reparsed.joined !== current.joined ||
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
  if (current.joined && joinedSemanticFingerprint(source) !== joinedSemanticFingerprint(result)) {
    return { structural: false };
  }
  return { structural: false, source: result };
}

function joinedSemanticFingerprint(source: string): string | undefined {
  const parsed = parseTugQL(source);
  const tree = parsed.document.tree;
  if (parsed.diagnostics.length || !tree) return undefined;
  const copy = JSON.parse(JSON.stringify(tree)) as Record<string, unknown>;
  const query = copy['query'] as Record<string, unknown> | undefined;
  if (!query || !Array.isArray(query['columns'])) return undefined;
  const from = record(query['from']);
  const invoiceAlias = typeof from?.['alias'] === 'string' ? from['alias'] : 'Invoice';
  query['limit'] = 0;
  query['columns'] = (query['columns'] as unknown[]).filter((column) => {
    const item = record(column);
    return !(item?.['field'] === 'InvoiceDate' && item['source'] === invoiceAlias);
  });
  return JSON.stringify(copy);
}

/** Generates, formats, then reparses a complete supported document before it can replace Code. */
export function updateAuthorComposeSource(
  source: string,
  changes: AuthorComposeChanges,
): string | undefined {
  const current = readAuthorComposeProfile(source);
  if (!current.supported || !current.writable) return undefined;
  if (current.joined && changes.grouped !== false) return undefined;
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
