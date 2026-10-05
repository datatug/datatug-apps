/** Strict JSON preserves raw Unicode and refuses duplicate/consumed case aliases. */
export function strictJson(text: string): unknown {
  let cursor = 0;
  const whitespace = (): void => {
    while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor++;
  };
  const token = (): string => {
    const start = cursor++;
    while (cursor < text.length) {
      const char = text[cursor++];
      if (char === '\\') {
        cursor++;
        continue;
      }
      if (char === '"') {
        const value: unknown = JSON.parse(text.slice(start, cursor));
        if (typeof value !== 'string') throw new Error('Invalid JSON string.');
        for (let i = 0; i < value.length; i++) {
          const code = value.charCodeAt(i);
          if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(++i);
            if (!(next >= 0xdc00 && next <= 0xdfff))
              throw new Error('Unpaired Unicode surrogate.');
          } else if (code >= 0xdc00 && code <= 0xdfff)
            throw new Error('Unpaired Unicode surrogate.');
        }
        return value;
      }
    }
    throw new Error('Unterminated JSON string.');
  };
  const visit = (depth: number): void => {
    if (depth > 32) throw new Error('Metadata nesting exceeds the bound.');
    whitespace();
    if (text[cursor] === '"') {
      token();
      return;
    }
    if (text[cursor] === '{') {
      cursor++;
      whitespace();
      const names = new Set<string>();
      while (text[cursor] !== '}') {
        if (text[cursor] !== '"') throw new Error('Invalid JSON object.');
        const name = token();
        if (names.has(name)) throw new Error('Duplicate JSON field.');
        names.add(name);
        whitespace();
        if (text[cursor++] !== ':') throw new Error('Invalid JSON object.');
        visit(depth + 1);
        whitespace();
        if (text[cursor] !== ',') break;
        cursor++;
        whitespace();
      }
      if (text[cursor++] !== '}') throw new Error('Invalid JSON object.');
      return;
    }
    if (text[cursor] === '[') {
      cursor++;
      whitespace();
      while (text[cursor] !== ']') {
        visit(depth + 1);
        whitespace();
        if (text[cursor] !== ',') break;
        cursor++;
        whitespace();
      }
      if (text[cursor++] !== ']') throw new Error('Invalid JSON array.');
      return;
    }
    const start = cursor;
    while (cursor < text.length && !/[\s,}\]]/.test(text[cursor])) cursor++;
    if (start === cursor) throw new Error('Invalid JSON value.');
    JSON.parse(text.slice(start, cursor));
  };
  visit(0);
  whitespace();
  if (cursor !== text.length) throw new Error('Trailing JSON data.');
  return JSON.parse(text) as unknown;
}
