import { parseTugQL } from '@dalgo/core';
import type { TugQLTree } from '@dalgo/core';
import type { IQueryRelationshipBinding } from '../../../models/definition/query-def';
import { requireCustomerIdParameterSource } from '../../public-sqlite-tugql';

export type AuthorCustomerField = 'FirstName' | 'LastName' | 'Email';

export interface AuthorRelationshipSourceReview {
  readonly before: string;
  readonly after: string;
  readonly relationship: IQueryRelationshipBinding;
  readonly selectedFields: readonly AuthorCustomerField[];
  readonly customerAlias: string;
  readonly limit: number;
  readonly outputLineage: readonly {
    readonly output: string;
    readonly source: string;
    readonly field: string;
  }[];
}

export type AuthorRelationshipSourceEdit =
  | { readonly ok: true; readonly review: AuthorRelationshipSourceReview }
  | { readonly ok: false; readonly reason: string };

const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

const hasOnlyKeys = (
  value: unknown,
  keys: readonly string[],
): boolean => {
  const object = record(value);
  return !!object && Object.keys(object).every((key) => keys.includes(key));
};

function isDirectField(
  value: unknown,
  alias: string,
  field: string,
): boolean {
  const item = record(value);
  return !!item && item['field'] === field &&
    (item['source'] === undefined || item['source'] === alias) &&
    hasOnlyKeys(item, ['field', 'source', 'as']) &&
    (item['as'] === undefined || typeof item['as'] === 'string');
}

function aliasFor(source: string): string {
  for (let suffix = 0; suffix < 100; suffix++) {
    const candidate = suffix === 0 ? 'c' : `c${suffix}`;
    if (!new RegExp(`\\b${candidate}\\b`, 'iu').test(source)) return candidate;
  }
  throw new Error('A safe Customer alias could not be selected.');
}

function lineEnding(source: string): '\r\n' | '\n' | undefined {
  if (source.includes('\r\n')) return '\r\n';
  if (source.includes('\n')) return '\n';
  return undefined;
}

function lineParts(source: string): string[] {
  return source.match(/[^\n]*(?:\n|$)/gu)?.filter((line) => line.length > 0) ?? [];
}

function clauseLine(
  lines: readonly string[],
  pattern: RegExp,
  label: string,
): number {
  const matches = lines
    .map((line, index) => pattern.test(line) ? index : -1)
    .filter((index) => index >= 0);
  if (matches.length !== 1) throw new Error(`The ${label} clause is ambiguous in this source.`);
  return matches[0] as number;
}

function sourceShape(
  source: string,
): {
  readonly alias: string;
  readonly limit: number;
  readonly blockSelect: boolean;
  readonly tree: TugQLTree;
} {
  const parsed = parseTugQL(source);
  if (parsed.diagnostics.length || !parsed.document.tree)
    throw new Error('This source has TugQL diagnostics. It remains unchanged in Code.');
  const tree = parsed.document.tree;
  if (tree.definitions?.length)
    throw new Error('CTE and saved-query import sources are not supported by relationship Apply yet.');
  const query = record(tree.query);
  const from = record(query?.['from']);
  if (!query || !from || from['name'] !== 'Invoice' ||
      (from['schema'] !== undefined && from['schema'] !== 'main') ||
      from['database'] !== undefined ||
      (Array.isArray(from['joins']) && from['joins'].length > 0) ||
      !hasOnlyKeys(from, ['name', 'schema', 'alias', 'joins']))
    throw new Error('Apply supports one unjoined main Invoice source only.');
  const alias = typeof from['alias'] === 'string' ? from['alias'] : 'Invoice';
  const limit = query['limit'];
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 100)
    throw new Error('Apply requires LIMIT 1–100.');
  if (query['offset'] !== undefined || query['groupBy'] !== undefined || query['having'] !== undefined ||
      !hasOnlyKeys(query, ['from', 'where', 'limit', 'orderBy', 'columns']))
    throw new Error('This query has clauses that relationship Apply cannot preserve safely.');

  const where = record(query['where']);
  const left = record(where?.['left']);
  const right = record(where?.['right']);
  if (left?.['field'] === 'CustomerId' && left['source'] === undefined)
    throw new Error('Qualify Invoice.CustomerId with its Invoice alias before reviewing a join.');
  if (where?.['op'] !== '==' || left?.['field'] !== 'CustomerId' ||
      (left['source'] !== undefined && left['source'] !== alias) ||
      right?.['param'] !== 'CustomerId')
    throw new Error('Apply requires the declared @CustomerId Invoice filter.');
  if (!hasOnlyKeys(where, ['op', 'left', 'right']) ||
      !hasOnlyKeys(left, ['field', 'source']) ||
      !hasOnlyKeys(right, ['param']))
    throw new Error('Apply cannot preserve extra filter expressions safely.');
  requireCustomerIdParameterSource(tree);

  const orderBy = query['orderBy'];
  if (orderBy !== undefined) {
    const order = Array.isArray(orderBy) && orderBy.length === 1 ? record(orderBy[0]) : undefined;
    const orderField = record(order?.['field']) ?? order;
    if (!order || !orderField || orderField['field'] !== 'InvoiceId' ||
        (orderField['source'] !== undefined && orderField['source'] !== alias) ||
        (order['direction'] !== undefined && order['direction'] !== 'asc') ||
        !hasOnlyKeys(order, ['field', 'source', 'direction']) ||
        !hasOnlyKeys(orderField, ['field', 'source']))
      throw new Error('Apply supports only ascending InvoiceId ordering.');
  }

  const columns = query['columns'];
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > 6 ||
      !isDirectField(columns[0], alias, 'InvoiceId'))
    throw new Error('Apply requires InvoiceId as the first direct projection.');
  const names = new Set<string>();
  for (const column of columns) {
    const item = record(column);
    const field = item?.['field'];
    if (field === 'CustomerId' && item?.['source'] === undefined)
      throw new Error('Qualify the Invoice.CustomerId projection with its Invoice alias before reviewing a join.');
    if (typeof field !== 'string' || !['InvoiceId', 'InvoiceDate', 'CustomerId'].includes(field) ||
        !isDirectField(column, alias, field))
      throw new Error('Apply supports direct InvoiceId, InvoiceDate, and CustomerId projections only.');
    const outputName = String(item?.['as'] ?? field).toLowerCase();
    if (names.has(outputName)) throw new Error('The current projection has duplicate output names.');
    names.add(outputName);
  }
  const lines = lineParts(source);
  const fromIndex = clauseLine(lines, /^\s*from\s+Invoice(?:\s+as\s+[A-Za-z_][\w]*)?(?:\s*--[^\n]*)?\r?\n?$/iu, 'FROM');
  const fromLine = lines[fromIndex] ?? '';
  const match = /^(\s*)from\s+Invoice(?:\s+as\s+([A-Za-z_][\w]*))?(\s*--[^\n]*)?(\r?\n)?$/iu.exec(fromLine);
  if (!match || (match[3] && !match[4]))
    throw new Error('Keep FROM Invoice on its own line to review this source edit.');
  if (!lineEnding(source)) throw new Error('Apply requires a line-oriented TugQL source.');
  const selectIndex = clauseLine(lines, /^\s*select(?:\s|\()?/iu, 'SELECT');
  const selectLine = lines[selectIndex] ?? '';
  const blockSelect = /^\s*select\s*\(\s*(?:--[^\n]*)?(?:\r?\n)$/iu.test(selectLine);
  return { alias, limit: limit as number, blockSelect, tree };
}

/**
 * Builds a narrow, review-only edit. Parsed TugQL admits semantics; the text
 * locator owns the patch and preserves all bytes outside the inserted clauses.
 */
export function reviewAuthorRelationshipSource(
  source: string,
  selectedFields: readonly AuthorCustomerField[],
  relationship: IQueryRelationshipBinding,
): AuthorRelationshipSourceEdit {
  try {
    const shape = sourceShape(source);
    const uniqueFields = [...new Set(selectedFields)];
    if (uniqueFields.length !== selectedFields.length ||
        uniqueFields.some((field) => !['FirstName', 'LastName', 'Email'].includes(field)))
      throw new Error('Choose each admitted Customer text field at most once.');
    const currentColumns = record(shape.tree.query)?.['columns'] as readonly unknown[];
    const currentNames = new Set(currentColumns.map((column) => {
      const item = record(column);
      return String(item?.['as'] ?? item?.['field'] ?? '').toLowerCase();
    }));
    if (uniqueFields.some((field) => currentNames.has(field.toLowerCase())))
      throw new Error('The selected Customer field would create duplicate output names.');
    if (record(shape.tree.query)?.['columns'] &&
        (record(shape.tree.query)?.['columns'] as readonly unknown[]).length + uniqueFields.length > 6)
      throw new Error('The joined projection is limited to six output columns.');
    if (relationship.id !== 'FK_Invoice_Customer_CustomerId' ||
        relationship.from.schema !== 'main' || relationship.from.table !== 'Invoice' ||
        relationship.to.schema !== 'main' || relationship.to.table !== 'Customer' ||
        relationship.pairs.length !== 1 || relationship.pairs[0]?.fromField !== 'CustomerId' ||
        relationship.pairs[0]?.toField !== 'CustomerId')
      throw new Error('The admitted Invoice-to-Customer relationship pin is invalid.');

    const eol = lineEnding(source) as '\r\n' | '\n';
    const upper = /^\s*FROM\b/mu.test(source);
    const kw = (lower: string, upperWord: string): string => upper ? upperWord : lower;
    const lines = lineParts(source);
    const fromIndex = clauseLine(lines, /^\s*from\s+Invoice(?:\s+as\s+[A-Za-z_][\w]*)?(?:\s*--[^\n]*)?\r?\n?$/iu, 'FROM');
    const fromLine = lines[fromIndex] ?? '';
    const fromMatch = /^(\s*)from\s+Invoice(?:\s+as\s+([A-Za-z_][\w]*))?(\s*--[^\n]*)?(\r?\n)?$/iu.exec(fromLine);
    if (!fromMatch) throw new Error('FROM Invoice cannot be located without changing unrelated text.');
    const indent = fromMatch[1] ?? '';
    const bodyIndent = /^\t/mu.test(source) ? '\t' : '  ';
    const customerAlias = aliasFor(source);
    lines.splice(fromIndex + 1, 0,
      `${indent}${kw('join', 'JOIN')} Customer ${kw('as', 'AS')} ${customerAlias}${eol}`,
      `${indent}${bodyIndent}${kw('on', 'ON')} ${shape.alias}.CustomerId = ${customerAlias}.CustomerId${eol}`,
    );

    const hasOrder = /^(\s*)order\s+by\s+/imu.test(source);
    if (!hasOrder) {
      const limitIndex = clauseLine(lines, /^\s*limit\s+\d+(?:\s*--[^\n]*)?\r?\n?$/iu, 'LIMIT');
      lines.splice(limitIndex, 0,
        `${indent}${kw('order', 'ORDER')} ${kw('by', 'BY')} ${shape.alias}.InvoiceId${eol}`,
      );
    }

    const selectIndex = clauseLine(lines, /^\s*select(?:\s|\()?/iu, 'SELECT');
    if (shape.blockSelect) {
      const selectIndent = (lines[selectIndex] ?? '').match(/^[ \t]*/u)?.[0] ?? '';
      const escapedIndent = selectIndent.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const closeIndex = lines.findIndex((line, index) => index > selectIndex && new RegExp(`^${escapedIndent}\\)(?:[ \\t]*--[^\\n]*)?\\r?\\n?$`, 'u').test(line));
      if (closeIndex < 0) throw new Error('The SELECT block closing line cannot be located safely.');
      if (uniqueFields.length) {
        const firstItem = lines.slice(selectIndex + 1, closeIndex).find((line) => line.trim() && !/^\s*--/u.test(line));
        const itemIndent = firstItem?.match(/^[ \t]*/u)?.[0] ?? `${indent}${bodyIndent}`;
        const additions = uniqueFields.map((field) => `${itemIndent}${customerAlias}.${field}${eol}`);
        lines.splice(closeIndex, 0, ...additions);
      }
    } else if (uniqueFields.length) {
      const line = lines[selectIndex] ?? '';
      const eolSuffix = line.endsWith('\r\n') ? '\r\n' : line.endsWith('\n') ? '\n' : '';
      const core = eolSuffix ? line.slice(0, -eolSuffix.length) : line;
      const commentIndex = core.indexOf('--');
      const contentEnd = commentIndex < 0 ? core.length : commentIndex;
      const authoredContent = core.slice(0, contentEnd);
      const trailingWhitespace = authoredContent.match(/[ \t]+$/u)?.[0] ?? '';
      const insertionPoint = contentEnd - trailingWhitespace.length;
      const additions = uniqueFields.map((field) => `${customerAlias}.${field}`).join(', ');
      lines[selectIndex] = `${core.slice(0, insertionPoint)}, ${additions}${core.slice(insertionPoint)}${eolSuffix}`;
    }
    const after = lines.join('');
    const candidate = parseTugQL(after);
    if (candidate.diagnostics.length || !candidate.document.tree)
      throw new Error('The proposed edit does not parse as TugQL; the draft was left unchanged.');
    const originalTree = JSON.parse(JSON.stringify(shape.tree)) as Record<string, unknown>;
    const candidateTree = JSON.parse(JSON.stringify(candidate.document.tree)) as Record<string, unknown>;
    const originalQuery = record(originalTree['query']) as Record<string, unknown>;
    const candidateQuery = record(candidateTree['query']) as Record<string, unknown>;
    const originalFrom = record(originalQuery['from']) as Record<string, unknown>;
    const candidateFrom = record(candidateQuery['from']) as Record<string, unknown>;
    const joins = candidateFrom['joins'];
    const join = Array.isArray(joins) && joins.length === 1 ? record(joins[0]) : undefined;
    const joinedFrom = record(join?.['from']);
    const on = Array.isArray(join?.['on']) ? join?.['on'] as readonly unknown[] : [];
    const predicate = record(on[0]);
    const leftField = record(predicate?.['left']);
    const rightField = record(predicate?.['right']);
    if (!join || (join['type'] !== undefined && join['type'] !== 'inner') || joinedFrom?.['name'] !== 'Customer' ||
        joinedFrom['alias'] !== customerAlias || on.length !== 1 || predicate?.['op'] !== '==' ||
        leftField?.['source'] !== shape.alias || leftField['field'] !== 'CustomerId' ||
        rightField?.['source'] !== customerAlias || rightField['field'] !== 'CustomerId')
      throw new Error('The proposed relationship was not represented as one explicit join.');
    delete candidateFrom['joins'];
    if (Array.isArray(originalFrom['joins']) && originalFrom['joins'].length === 0)
      delete originalFrom['joins'];
    if (shape.tree.query['orderBy'] === undefined) delete candidateQuery['orderBy'];
    const candidateColumns = candidateQuery['columns'];
    if (!Array.isArray(candidateColumns) || candidateColumns.length < uniqueFields.length)
      throw new Error('The proposed output fields were not represented in the parsed query.');
    if (uniqueFields.length) {
      const additions = candidateColumns.slice(-uniqueFields.length);
      if (additions.some((column, index) => {
        const item = record(column);
        return item?.['field'] !== uniqueFields[index] || item['source'] !== customerAlias;
      })) throw new Error('The appended Customer fields differ from the reviewed selection.');
      candidateQuery['columns'] = candidateColumns.slice(0, -uniqueFields.length);
    }
    if (JSON.stringify(candidateTree) !== JSON.stringify(originalTree))
      throw new Error('The proposed source edit changes query semantics outside the reviewed join, order, and output fields.');
    const outputLineage = [
      ...currentColumns.map((column) => {
        const item = record(column);
        const field = String(item?.['field'] ?? '');
        return Object.freeze({
          output: String(item?.['as'] ?? field),
          source: String(item?.['source'] ?? shape.alias),
          field,
        });
      }),
      ...uniqueFields.map((field) => Object.freeze({
        output: field,
        source: customerAlias,
        field,
      })),
    ];
    return {
      ok: true,
      review: Object.freeze({
        before: source,
        after,
        relationship,
        selectedFields: Object.freeze(uniqueFields),
        customerAlias,
        limit: shape.limit,
        outputLineage: Object.freeze(outputLineage),
      }),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'The relationship edit could not be reviewed safely.',
    };
  }
}
