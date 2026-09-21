import type { StructuredQuery } from '@dalgo/core';

type ChinookQuery = StructuredQuery<Record<string, unknown>>;

function yamlScalar(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** Display the validated query as a canonical, editable DTQL YAML action. */
export function chatDtqlYaml(query: ChinookQuery): string {
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
export function chatSQLite(query: ChinookQuery): string {
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
