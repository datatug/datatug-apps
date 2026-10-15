import { AgentTableSchema } from './agent-link-api.service';

/**
 * The record key of a card's Record link (Feature claude-mod-web-links, REQ:url-shape, REQ:key-lossless,
 * REQ:ui-record-lookup): `#…pk=<percent-encoded JSON object of primary-key column to value>` in the fragment only,
 * never in the path or query. Values must reach the agent exactly as written: an integer above 2^53 - 1 is never
 * read through a JavaScript number, so a key of 9007199254740993 never becomes its neighbour.
 */

/** A value of the key as written in the fragment: a JSON string, a JSON number (its literal text), or anything
 * else (true, false, null, an object or an array), which is never a key. */
export type KeyLiteral =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly literal: string }
  | { readonly kind: 'other' };

/** A key value as the record lookup takes it: a number inside the exactly representable range, else a string. */
export type KeyValue = string | number;

const MAX_FRAGMENT_KEY_LENGTH = 4096;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const INTEGER_LITERAL = /^-?(?:0|[1-9]\d*)$/;

/** The raw `pk` JSON text of a fragment (`code=…&pk=…`, with or without the `#`), or undefined. */
export function pkOfFragment(fragment: string | null | undefined): string | undefined {
  if (!fragment) return undefined;
  const parts = fragment
    .replace(/^#/, '')
    .split('&')
    .filter((p) => p.startsWith('pk='));
  if (parts.length !== 1) return undefined;
  const raw = parts[0].slice('pk='.length);
  if (!raw || raw.length > MAX_FRAGMENT_KEY_LENGTH) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

/**
 * Parses a flat JSON object of key values, keeping every number as its literal text. Undefined for anything that is
 * not exactly one JSON object with distinct names and scalar values (nested values are kept as `other`).
 */
export function parseKeyObject(
  text: string,
): ReadonlyMap<string, KeyLiteral> | undefined {
  let i = 0;
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
  };
  const sticky = (re: RegExp): string | undefined => {
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m) return undefined;
    i += m[0].length;
    return m[0];
  };
  // A string token; JSON.parse below refuses what JSON does not allow in it (raw control characters, bad escapes).
  const STRING = /"(?:[^"\\]|\\.)*"/y;
  const decode = (token: string): string | undefined => {
    try {
      return JSON.parse(token) as string;
    } catch {
      return undefined;
    }
  };
  const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const WORD = /true|false|null/y;
  const out = new Map<string, KeyLiteral>();
  ws();
  if (text[i] !== '{') return undefined;
  i++;
  ws();
  if (text[i] === '}') {
    i++;
  } else {
    for (;;) {
      ws();
      const nameToken = sticky(STRING);
      if (nameToken === undefined) return undefined;
      const name = decode(nameToken);
      if (name === undefined || out.has(name)) return undefined;
      ws();
      if (text[i] !== ':') return undefined;
      i++;
      ws();
      const str = sticky(STRING);
      if (str !== undefined) {
        const value = decode(str);
        if (value === undefined) return undefined;
        out.set(name, { kind: 'string', value });
      } else {
        const num = sticky(NUMBER);
        if (num !== undefined) {
          out.set(name, { kind: 'number', literal: num });
        } else if (sticky(WORD) !== undefined) {
          out.set(name, { kind: 'other' });
        } else {
          return undefined; // an object, an array or not JSON: never a key
        }
      }
      ws();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '}') {
        i++;
        break;
      }
      return undefined;
    }
  }
  ws();
  return i === text.length ? out : undefined;
}

/** Declared column types the record lookup reads as integers or strings (datatug-cli records_lookup.go). */
const INTEGER_TYPES = new Set(['int', 'integer', 'int64', 'bigint']);
const STRING_TYPES = new Set(['string', 'text']);

/**
 * The key to send to the record lookup, checked against the table's live schema before any lookup is made: it must
 * name exactly the declared primary-key columns, an integer column takes an integer literal (a JSON integer, or a
 * string of one), a string column takes a string. Undefined is `bad-key`: no lookup is sent. A safe integer is sent
 * as a number, a larger one as the string of its exact digits, never rounded.
 */
export function lookupKey(
  key: ReadonlyMap<string, KeyLiteral>,
  schema: AgentTableSchema,
): Record<string, KeyValue> | undefined {
  const pk = schema.primaryKey;
  if (!pk.length || key.size !== pk.length) return undefined;
  const types = new Map(schema.columns.map((c) => [c.name, c.type.toLowerCase()]));
  const out: Record<string, KeyValue> = {};
  for (const column of pk) {
    const literal = key.get(column);
    const type = types.get(column) ?? '';
    if (!literal || literal.kind === 'other') return undefined;
    if (INTEGER_TYPES.has(type)) {
      const digits = literal.kind === 'number' ? literal.literal : literal.value;
      if (!INTEGER_LITERAL.test(digits) || digits === '-0') return undefined;
      const big = BigInt(digits);
      out[column] = big <= MAX_SAFE && big >= -MAX_SAFE ? Number(digits) : digits;
    } else if (STRING_TYPES.has(type)) {
      if (literal.kind !== 'string' || literal.value.length > 256) return undefined;
      out[column] = literal.value;
    } else {
      return undefined; // a key type the lookup cannot read
    }
  }
  return out;
}
