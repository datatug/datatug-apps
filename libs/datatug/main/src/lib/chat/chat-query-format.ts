import {
  isJoinedDTQLQuery, stringifyJoinedDTQL,
  type DTQLExpression, type JoinedDTQLQuery, type ParsedDTQLQuery, type QueryRelation,
} from '@dalgo/core';
import { CHINOOK_SCHEMA } from './chat.types';

type ParsedChinookQuery = ParsedDTQLQuery<Record<string, unknown>>;

function yamlScalar(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** Display the validated query as a canonical, editable DTQL YAML action. */
export function chatDtqlYaml(query: ParsedChinookQuery): string {
  if (isJoinedDTQLQuery(query)) return stringifyJoinedDTQL(query);
  const [schema, name] = query.source.name.split('.');
  const lines = ['from:', `  schema: ${yamlScalar(schema)}`, `  name: ${yamlScalar(name)}`];
  const filter = query.filters[0];
  if (filter) {
    lines.push('where:', `  op: ${yamlScalar(filter.operator === 'in' ? 'In' : filter.operator)}`,
      '  left:', `    field: ${yamlScalar(filter.field)}`, '  right:');
    if (filter.operator === 'in') {
      lines.push('    values:');
      for (const value of filter.value as readonly unknown[]) lines.push(`      - ${yamlScalar(value)}`);
    } else {
      lines.push(`    value: ${yamlScalar(filter.value)}`);
    }
  }
  if (query.orders.length) {
    lines.push('orderBy:');
    for (const order of query.orders) {
      lines.push(`  - field: ${yamlScalar(order.field)}`);
      if (order.direction === 'desc') lines.push('    desc: true');
    }
  }
  lines.push(`limit: ${query.limit}`);
  return lines.join('\n');
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sqliteValue(value: unknown): string {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** SQL for the local Chinook SQLite target, derived from the validated DTQL. */
export function chatSQLite(query: ParsedChinookQuery): string {
  if (isJoinedDTQLQuery(query)) return joinedSQLite(query);
  const [schema, table] = query.source.name.split('.');
  if (!schema || !table) throw new Error('This query has no SQL source.');
  const needsArtist = table === 'Track' && [...query.filters, ...query.orders]
    .some((item) => item.field === 'ArtistName');
  const column = (field: string): string => needsArtist
    ? field === 'ArtistName' ? '"Artist"."Name"' : `"Track".${identifier(field)}`
    : identifier(field);
  const select = needsArtist ? 'SELECT "Track".*, "Artist"."Name" AS "ArtistName"' : 'SELECT *';
  const from = `FROM ${identifier(schema)}.${identifier(table)}` + (needsArtist
    ? ' AS "Track"\nJOIN "main"."Album" AS "Album" ON "Track"."AlbumId" = "Album"."AlbumId"\nJOIN "main"."Artist" AS "Artist" ON "Album"."ArtistId" = "Artist"."ArtistId"'
    : '');
  const lines = [select, from];
  if (query.filters.length) {
    const conditions = query.filters.map((filter) => {
      const field = column(filter.field);
      if (filter.operator === 'in') {
        const values = filter.value as readonly unknown[];
        const nonNull = values.filter((value) => value !== null);
        const parts = [];
        if (nonNull.length) parts.push(`${field} IN (${nonNull.map(sqliteValue).join(', ')})`);
        if (values.length !== nonNull.length) parts.push(`${field} IS NULL`);
        return parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0] || '1 = 0';
      }
      if (filter.value === null && (filter.operator === '==' || filter.operator === '!=')) {
        return `${field} IS ${filter.operator === '!=' ? 'NOT ' : ''}NULL`;
      }
      const operator = filter.operator === '==' ? '=' : filter.operator === '!=' ? '<>' : filter.operator;
      return `${field} ${operator} ${sqliteValue(filter.value)}`;
    });
    lines.push(`WHERE ${conditions.join(' AND ')}`);
  }
  if (query.orders.length) {
    lines.push(`ORDER BY ${query.orders.map((order) => `${column(order.field)} ${order.direction.toUpperCase()}`).join(', ')}`);
  }
  if (query.limit !== undefined) lines.push(`LIMIT ${query.limit}`);
  return `${lines.join('\n')};`;
}

function qualified(source: string, field: string): string {
  return `${identifier(source)}.${identifier(field)}`;
}

function expressionSql(expression: DTQLExpression, fieldSql: (source: string, field: string) => string = qualified): string {
  switch (expression.kind) {
    case 'field': return fieldSql(expression.field.source, expression.field.field);
    case 'literal': return sqliteValue(expression.value);
    case 'binary': return `(${expressionSql(expression.left, fieldSql)} ${expression.operator} ${expressionSql(expression.right, fieldSql)})`;
    case 'aggregate': {
      const args = expression.args.map((arg) => expressionSql(arg, fieldSql)).join(', ');
      return `${expression.function.toUpperCase()}(${expression.distinct ? 'DISTINCT ' : ''}${args})`;
    }
    case 'star': return '*';
    case 'values': return `(${expression.values.map(sqliteValue).join(', ')})`;
    case 'param': return `:${expression.name}`;
  }
}

function relationSql(relation: QueryRelation): string {
  const alias = relation.alias || relation.name;
  let sql = `${identifier(relation.schema || 'main')}.${identifier(relation.name)} AS ${identifier(alias)}`;
  for (const join of relation.joins) {
    const joined = relationSql(join.from);
    const source = join.from.joins.length ? `(${joined})` : joined;
    const on = join.on.map((predicate) =>
      `${qualified(predicate.left.source, predicate.left.field)} = ${qualified(predicate.right.source, predicate.right.field)}`,
    ).join(' AND ');
    sql += `\n${join.type.toUpperCase()} JOIN ${source} ON ${on}`;
  }
  return sql;
}

function joinedSQLite(query: JoinedDTQLQuery): string {
  const relations = new Map<string, QueryRelation>();
  const collect = (relation: QueryRelation): void => {
    relations.set(relation.alias || relation.name, relation);
    relation.joins.forEach((join) => collect(join.from));
  };
  collect(query.from);
  const fieldSql = (source: string, field: string): string => {
    if (field === 'ArtistName' && relations.get(source)?.name === 'Track') {
      return `(SELECT "__dt_artist"."Name" FROM "main"."Album" AS "__dt_album" ` +
        `JOIN "main"."Artist" AS "__dt_artist" ON "__dt_album"."ArtistId" = "__dt_artist"."ArtistId" ` +
        `WHERE "__dt_album"."AlbumId" = ${qualified(source, 'AlbumId')} LIMIT 1)`;
    }
    return qualified(source, field);
  };
  const columns = query.columns?.flatMap((column) => {
    if (column.wildcard) {
      const source = column.wildcard.source;
      if (!source) return ['*'];
      const relation = (function find(root: QueryRelation): QueryRelation | undefined {
        if ((root.alias || root.name) === source) return root;
        for (const join of root.joins) {
          const found = find(join.from);
          if (found) return found;
        }
        return undefined;
      })(query.from);
      const table = CHINOOK_SCHEMA.tables.find((item) => item.schema === (relation?.schema || 'main') && item.name === relation?.name);
      return table ? table.fields.filter((field) => !column.wildcard?.exclude.includes(field)).map((field) => fieldSql(source, field)) : [`${identifier(source)}.*`];
    }
    if (!column.expression) return [];
    return [`${expressionSql(column.expression, fieldSql)}${column.as ? ` AS ${identifier(column.as)}` : ''}`];
  });
  const lines = [`SELECT ${columns?.length ? columns.join(', ') : '*'}`, `FROM ${relationSql(query.from)}`];
  if (query.filters.length) {
    const conditions = query.filters.map((filter) => {
      const field = fieldSql(filter.field.source, filter.field.field);
      if (filter.operator === 'in') {
        const values = filter.value as readonly unknown[];
        const nonNull = values.filter((value) => value !== null);
        const parts = [];
        if (nonNull.length) parts.push(`${field} IN (${nonNull.map(sqliteValue).join(', ')})`);
        if (values.length !== nonNull.length) parts.push(`${field} IS NULL`);
        return parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0] || '1 = 0';
      }
      if (filter.value === null && (filter.operator === '==' || filter.operator === '!=')) {
        return `${field} IS ${filter.operator === '!=' ? 'NOT ' : ''}NULL`;
      }
      const operator = filter.operator === '==' ? '=' : filter.operator === '!=' ? '<>' : filter.operator;
      return `${field} ${operator} ${sqliteValue(filter.value)}`;
    });
    lines.push(`WHERE ${conditions.join(' AND ')}`);
  }
  if (query.groupBy?.length) lines.push(`GROUP BY ${query.groupBy.map((expression) => expressionSql(expression, fieldSql)).join(', ')}`);
  if (query.having) {
    const operator = query.having.operator === '==' ? '=' : query.having.operator === '!=' ? '<>' : query.having.operator;
    lines.push(`HAVING ${expressionSql(query.having.left, fieldSql)} ${operator} ${expressionSql(query.having.right, fieldSql)}`);
  }
  if (query.orders.length) lines.push(`ORDER BY ${query.orders.map((order) => `${fieldSql(order.field.source, order.field.field)} ${order.direction.toUpperCase()}`).join(', ')}`);
  if (query.limit !== undefined) lines.push(`LIMIT ${query.limit}`);
  if (query.offset !== undefined) lines.push(`OFFSET ${query.offset}`);
  return `${lines.join('\n')};`;
}
