import { parseTugQL } from '@dalgo/core';
import { type IQueryDef, QueryType } from '../../../models/definition/query-def';

/** A read-only view of a deliberately small, fully consumed SQLite SELECT. */
export type SqlTugqlTransfer =
  | { readonly supported: true; readonly source: string; readonly sourceCount: 1 }
  | { readonly supported: false; readonly reason: string };

type Token = { readonly value: string; readonly offset: number };

class TransferFailure extends Error {}

const identifier = /^[A-Za-z_][A-Za-z_0-9]*$/u;
const integer = /^(?:0|[1-9][0-9]*)$/u;
const keywords = new Set(['SELECT', 'FROM', 'AS', 'WHERE', 'ORDER', 'BY', 'ASC', 'DESC', 'LIMIT']);

function scan(source: string): Token[] {
  const tokens: Token[] = [];
  for (let offset = 0; offset < source.length;) {
    const rest = source.slice(offset);
    const whitespace = /^\s+/u.exec(rest)?.[0];
    if (whitespace) { offset += whitespace.length; continue; }
    if (rest.startsWith('--') || rest.startsWith('/*'))
      throw new TransferFailure('SQL comments are not transferred to TugQL. Edit the SQL source to review this query.');
    if (["'", '"', '`', '['].includes(rest[0]))
      throw new TransferFailure('Quoted strings or identifiers need dialect-aware conversion, which is unavailable for this SQL query.');
    const token = /^(?:@[A-Za-z_][A-Za-z_0-9]*|[A-Za-z_][A-Za-z_0-9]*|[0-9]+|[.,;*=()<>!+-])/u.exec(rest)?.[0];
    if (!token)
      throw new TransferFailure(`SQL contains an unsupported character at offset ${offset + 1}; no TugQL was generated.`);
    tokens.push({ value: token, offset });
    offset += token.length;
  }
  return tokens;
}

class Cursor {
  private index = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  peek(): string | undefined { return this.tokens[this.index]?.value; }
  take(): string | undefined { const value = this.peek(); if (value !== undefined) this.index++; return value; }
  at(word: string): boolean { return this.peek()?.toUpperCase() === word; }
  consume(word: string): boolean { if (!this.at(word)) return false; this.take(); return true; }
  expect(word: string): void {
    if (!this.consume(word)) throw new TransferFailure(`Expected ${word} in the bounded SQL SELECT profile; no TugQL was generated.`);
  }
  name(label: string): string {
    const value = this.take();
    if (!value || !identifier.test(value) || keywords.has(value.toUpperCase()))
      throw new TransferFailure(`${label} must be a plain SQL identifier for TugQL transfer.`);
    return value;
  }
  field(label: string): string {
    const first = this.name(label);
    return this.consume('.') ? `${first}.${this.name(label)}` : first;
  }
  remaining(): boolean { return this.index < this.tokens.length; }
  rest(): string { return this.tokens.slice(this.index).map((token) => token.value).join(' '); }
}

/**
 * This never changes the saved SQL request, previews, bindings, or executor.
 * The accepted syntax profile has only explicit field projections, one table, one
 * optional integer equality, one order field, and a positive bounded limit.
 * Every source token must be consumed. SQL outside that profile is explained,
 * never partially translated by matching a SELECT/FROM substring.
 */
export function transferSqlToTugql(definition: IQueryDef | undefined): SqlTugqlTransfer {
  if (!definition || definition.request.queryType !== QueryType.SQL)
    return { supported: false, reason: 'This query is not a native SQL definition.' };
  const source = (definition.request as { text?: string }).text ?? '';
  if (!source.trim())
    return { supported: false, reason: 'Enter SQL source to see whether this query can be represented in TugQL.' };
  try {
    const cursor = new Cursor(scan(source));
    cursor.expect('SELECT');
    if (cursor.at('DISTINCT')) throw new TransferFailure('SELECT DISTINCT has no verified transfer in this view.');
    if (cursor.at('*')) throw new TransferFailure('Wildcard projection has no verified TugQL transfer in this view.');
    const projections: { field: string; alias?: string }[] = [];
    do {
      if (cursor.at('(')) throw new TransferFailure('SQL functions and scalar subqueries have no verified TugQL transfer in this view.');
      const field = cursor.field('Selected field');
      if (cursor.at('(')) throw new TransferFailure('SQL functions and scalar subqueries have no verified TugQL transfer in this view.');
      const alias = cursor.consume('AS') ? cursor.name('Column alias') : undefined;
      projections.push({ field, ...(alias ? { alias } : {}) });
      if (projections.length > 6) throw new TransferFailure('More than six selected fields are outside this bounded TugQL transfer profile.');
    } while (cursor.consume(','));
    cursor.expect('FROM');
    const table = cursor.field('Source table');
    const sourceAlias = cursor.consume('AS') ? cursor.name('Source alias') : undefined;
    const tableName = table.split('.').at(-1) as string;
    const validateField = (field: string): void => {
      const pieces = field.split('.');
      if (pieces.length > 2 || (pieces.length === 2 && pieces[0] !== (sourceAlias ?? tableName)))
        throw new TransferFailure(`Field ${field} is outside the declared single SQL source ${table}.`);
    };
    projections.forEach((projection) => validateField(projection.field));
    const where = cursor.consume('WHERE') ? (() => {
      const field = cursor.field('WHERE field');
      validateField(field);
      cursor.expect('=');
      const right = cursor.take();
      if (!right) throw new TransferFailure('WHERE equality needs a value.');
      if (right.startsWith('@')) {
        const matches = definition.parameters?.filter((item) => item.id === right.slice(1)) ?? [];
        if (matches.length !== 1 || matches[0].type !== 'integer' || matches[0].isMultiValue)
          throw new TransferFailure(`Parameter ${right} needs one declared integer type for TugQL transfer; no binding was inferred.`);
      } else if (!integer.test(right) || !Number.isSafeInteger(Number(right))) {
        throw new TransferFailure('Only a safe integer literal or declared integer parameter is supported in transferred WHERE equality.');
      }
      return { field, right };
    })() : undefined;
    const order = cursor.consume('ORDER') ? (() => {
      cursor.expect('BY');
      const field = cursor.field('ORDER BY field');
      validateField(field);
      if (projections.some((projection) => projection.alias === field))
        throw new TransferFailure('ORDER BY a projected alias needs dialect-aware name resolution before TugQL transfer.');
      const direction = cursor.consume('DESC') ? ' DESC' : (cursor.consume('ASC') ? ' ASC' : '');
      return `${field}${direction}`;
    })() : undefined;
    const hasLimit = cursor.consume('LIMIT');
    const limit = hasLimit ? cursor.take() : undefined;
    if (hasLimit && limit === undefined) throw new TransferFailure('LIMIT needs a positive integer value.');
    if (limit !== undefined && (!integer.test(limit) || !Number.isSafeInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 1000))
      throw new TransferFailure('LIMIT must be a positive safe integer up to 1000 for TugQL transfer.');
    const ended = cursor.consume(';');
    if (cursor.remaining()) {
      const rest = cursor.rest();
      throw new TransferFailure(
        ended || rest.includes(';') ? 'Multiple SQL statements cannot be transferred to one TugQL query.' :
        /\bJOIN\b/iu.test(rest) ? 'JOIN and its ON condition need relationship-aware TugQL transfer, which is unavailable here.' :
        /\b(?:GROUP|HAVING|UNION|OFFSET)\b/iu.test(rest) ? 'Grouping, set operations, and offsets have no verified transfer in this view.' :
        'The SQL query contains an expression or clause outside the bounded TugQL transfer profile.',
      );
    }
    const usedParameters = where?.right.startsWith('@') ? [where.right.slice(1)] : [];
    if ((definition.parameters ?? []).some((parameter) => !usedParameters.includes(parameter.id)))
      throw new TransferFailure('The SQL definition declares parameters outside this single-equality transfer profile; their declarations were not dropped.');
    const result = [
      ...(usedParameters.length ? ['PARAMETERS (', ...usedParameters.map((name) => `  @${name} INTEGER${definition.parameters?.find((parameter) => parameter.id === name)?.isRequired ? ' REQUIRED' : ''}`), ')'] : []),
      `FROM ${table}${sourceAlias ? ` AS ${sourceAlias}` : ''}`,
      ...(where ? [`WHERE ${where.field} = ${where.right}`] : []),
      ...(order ? [`ORDER BY ${order}`] : []),
      ...(limit ? [`LIMIT ${limit}`] : []),
      'SELECT (',
      ...projections.map((projection) => `  ${projection.field}${projection.alias ? ` AS ${projection.alias}` : ''}`),
      ')',
    ].join('\n');
    const parsed = parseTugQL(result);
    if (parsed.diagnostics.length || !parsed.document.tree)
      throw new TransferFailure('The generated TugQL did not pass the TugQL parser; the saved SQL remains authoritative.');
    return { supported: true, source: result, sourceCount: 1 };
  } catch (error) {
    return { supported: false, reason: error instanceof TransferFailure ? error.message : 'This SQL shape could not be verified for TugQL transfer.' };
  }
}
