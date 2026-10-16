export type SqliteScalar = string | number | null;

/** Prepare only declared SQLite named inputs; values never enter SQL text. */
export function prepareDeclaredSqlBindings(
  sql: string,
  declared: readonly { readonly id: string }[],
  values: ReadonlyMap<string, SqliteScalar>,
  positionalBindings: readonly SqliteScalar[],
): { readonly sql: string; readonly bindings: readonly SqliteScalar[] } {
  const parts: string[] = [];
  const bindings: SqliteScalar[] = [];
  const names = new Set(declared.map((parameter) => parameter.id));
  if (names.size !== declared.length)
    throw new Error('Declared SQLite input IDs must be unique.');
  const usedNames = new Set<string>();
  let start = 0;
  let named = false;
  let positionalCount = 0;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];
    if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', i + 2);
      if (end < 0) break;
      i = end;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) throw new Error('The SQL input has an unfinished comment.');
      i = end + 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      const close = char === '[' ? ']' : char;
      let closed = false;
      for (i++; i < sql.length; i++) {
        if (sql[i] !== close) continue;
        if (char !== '[' && sql[i + 1] === close) { i++; continue; }
        closed = true;
        break;
      }
      if (!closed) throw new Error('The SQL input has an unfinished quoted value or identifier.');
      continue;
    }
    if (/[A-Za-z_]/u.test(char ?? '') || char.charCodeAt(0) > 127) {
      // SQLite admits `$` inside an unquoted identifier. It is not a
      // placeholder prefix there (for example, Album$Archive). SQLite also
      // treats non-ASCII characters as identifier characters.
      while (/[A-Za-z0-9_$]/u.test(sql[i + 1] ?? '') ||
        (sql[i + 1]?.charCodeAt(0) ?? 0) > 127) i++;
      continue;
    }
    if (char === '?') {
      if (/\d/u.test(next ?? ''))
        throw new Error('Numbered SQLite placeholders are unavailable for declared inputs.');
      positionalCount++;
      continue;
    }
    if (char !== '@' && char !== ':' && char !== '$') continue;
    if (!/[A-Za-z_]/u.test(next ?? ''))
      throw new Error('This SQLite placeholder shape is unavailable for declared inputs.');
    let end = i + 2;
    while (/[A-Za-z0-9_]/u.test(sql[end] ?? '')) end++;
    if ((sql.charCodeAt(end) > 127) || /[A-Za-z0-9_$]/u.test(sql[end] ?? '') ||
      (char === '$' && (sql[end] === ':' || sql[end] === '(')))
      throw new Error('This SQLite placeholder shape is unavailable for declared inputs.');
    const name = sql.slice(i + 1, end);
    if (!names.has(name) || !values.has(name))
      throw new Error(`SQL input ${name} is not a complete declared binding.`);
    const value = values.get(name);
    if (value === undefined)
      throw new Error(`SQL input ${name} is not a complete declared binding.`);
    named = true;
    usedNames.add(name);
    parts.push(sql.slice(start, i), '?');
    bindings.push(value);
    i = end - 1;
    start = end;
  }
  if (named && positionalCount)
    throw new Error('Mixing named and positional SQLite inputs is unavailable.');
  if (named) {
    if (usedNames.size !== names.size)
      throw new Error('Each declared SQLite input must appear in the SQL source.');
    return { sql: parts.join('') + sql.slice(start), bindings };
  }
  if (!positionalCount)
    throw new Error('The SQL source has no placeholders for its declared inputs.');
  if (positionalCount !== positionalBindings.length)
    throw new Error('The SQL source must have one positional placeholder per declared input.');
  return { sql, bindings: positionalBindings };
}

/** Counts SQLite placeholders outside comments and quoted values/identifiers. */
export function countSqlitePlaceholders(sql: string): number {
  let count = 0;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];
    if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', i + 2);
      if (end < 0) break;
      i = end;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) throw new Error('The SQL input has an unfinished comment.');
      i = end + 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      const close = char === '[' ? ']' : char;
      let closed = false;
      for (i++; i < sql.length; i++) {
        if (sql[i] !== close) continue;
        if (sql[i + 1] === close) { i++; continue; }
        closed = true;
        break;
      }
      if (!closed) throw new Error('The SQL input has an unfinished quoted value or identifier.');
      continue;
    }
    if (char === '?') count++;
    else if ((char === ':' || char === '@' || char === '$') && /[A-Za-z_]/u.test(next ?? '')) count++;
  }
  return count;
}
