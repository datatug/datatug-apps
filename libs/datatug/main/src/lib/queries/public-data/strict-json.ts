/** Strict JSON preserves raw Unicode and refuses duplicate/consumed case aliases. */
export class JsonNumberToken {
  constructor(readonly token: string) {}
}
export function strictJson(text: string): unknown {
  return parseStrictJson(text, false);
}
/** Metadata receipt equality preserves exact number tokens rather than rounded JS numbers. */
export function strictJsonNumbers(text: string): unknown {
  return parseStrictJson(text, true);
}
/** Ordinary P1 diagnostics preserve valid JSON overflow tokens; metadata remains finite. */
export function strictJsonWireNumbers(text: string): unknown {
  return parseStrictJson(text, true, true);
}
function parseStrictJson(
  text: string,
  numbers: boolean,
  wireOverflow = false,
): unknown {
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
  const visit = (depth: number): unknown => {
    if (depth > 32) throw new Error('Metadata nesting exceeds the bound.');
    whitespace();
    if (text[cursor] === '"') {
      return token();
    }
    if (text[cursor] === '{') {
      cursor++;
      whitespace();
      const names = new Set<string>();
      const record: Record<string, unknown> = Object.create(null);
      while (text[cursor] !== '}') {
        if (text[cursor] !== '"') throw new Error('Invalid JSON object.');
        const name = token();
        if (names.has(name)) throw new Error('Duplicate JSON field.');
        names.add(name);
        whitespace();
        if (text[cursor++] !== ':') throw new Error('Invalid JSON object.');
        record[name] = visit(depth + 1);
        whitespace();
        if (text[cursor] !== ',') break;
        cursor++;
        whitespace();
      }
      if (text[cursor++] !== '}') throw new Error('Invalid JSON object.');
      return record;
    }
    if (text[cursor] === '[') {
      const entries: unknown[] = [];
      cursor++;
      whitespace();
      while (text[cursor] !== ']') {
        entries.push(visit(depth + 1));
        whitespace();
        if (text[cursor] !== ',') break;
        cursor++;
        whitespace();
      }
      if (text[cursor++] !== ']') throw new Error('Invalid JSON array.');
      return entries;
    }
    const start = cursor;
    while (cursor < text.length && !/[\s,}\]]/.test(text[cursor])) cursor++;
    if (start === cursor) throw new Error('Invalid JSON value.');
    const raw = text.slice(start, cursor);
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'number') {
      if (!wireOverflow && !Number.isFinite(value))
        throw new Error('Nonfinite JSON number.');
      return numbers ? new JsonNumberToken(raw) : value;
    }
    return value;
  };
  const value = visit(0);
  whitespace();
  if (cursor !== text.length) throw new Error('Trailing JSON data.');
  // Retain the native parser's grammar check (e.g. trailing commas) after bounded traversal.
  JSON.parse(text);
  return value;
}
