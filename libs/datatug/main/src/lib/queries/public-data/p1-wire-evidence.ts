import { JsonNumberToken } from './strict-json';

export interface P1WireDecision {
  readonly key?: string;
  readonly status:
    | 'matched'
    | 'invalid'
    | 'unsupported-precision'
    | 'incomplete';
  readonly reason: string;
}
/** Exact decimal arithmetic uses digit lengths and a bounded exponent, never rounded Number. */
export function classifyP1Token(token: string): P1WireDecision {
  const match =
    /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token);
  if (!match) throw new Error('Malformed numeric reference token.');
  const digits = (match[2] + (match[3] ?? '')).replace(/^0+/, '');
  if (!digits || match[1])
    return { status: 'invalid', reason: 'nonpositive-reference' };
  const exponent = match[4] ?? '0';
  const magnitude = exponent.replace(/^[+-]/, '').replace(/^0+/, '') || '0';
  // No exponentiation or arbitrary-sized integers. At this length the sign decides
  // fractional versus overflow for every nonzero bounded coefficient.
  if (magnitude.length > 6)
    return exponent.startsWith('-')
      ? { status: 'invalid', reason: 'fractional-reference' }
      : {
          status: 'unsupported-precision',
          reason:
            'positive integer outside the safe range; unsupported wire spelling',
        };
  const scale = Number(exponent) - (match[3]?.length ?? 0);
  const trailing = digits.length - digits.replace(/0+$/, '').length;
  if (scale < -trailing)
    return { status: 'invalid', reason: 'fractional-reference' };
  const significant = digits.slice(0, digits.length - trailing);
  const zeroes = scale + trailing;
  if (significant.length + zeroes > 16)
    return {
      status: 'unsupported-precision',
      reason:
        'positive integer outside the safe range' +
        (match[3] || match[4] ? '; unsupported wire spelling' : ''),
    };
  const exact = significant + '0'.repeat(zeroes);
  if (exact.length === 16 && exact > '9007199254740991')
    return {
      status: 'unsupported-precision',
      reason:
        'positive integer outside the safe range' +
        (match[3] || match[4] ? '; unsupported wire spelling' : ''),
    };
  if (!/^[1-9][0-9]*$/.test(token))
    return {
      status: 'invalid',
      reason:
        'representation-ambiguous: integral decimal/exponent wire spelling',
    };
  const parsed = Number(token);
  if (!Number.isSafeInteger(parsed) || String(parsed) !== token)
    return {
      status: 'unsupported-precision',
      reason: 'exact JavaScript roundtrip failed',
    };
  return {
    key: token,
    status: 'matched',
    reason:
      'canonical wire integer; eligibility also requires admitted native typed provenance',
  };
}
/** Stream a diagnostic prefix without allocating the full serialized container. */
function* evidenceParts(value: unknown): Generator<string> {
  if (value instanceof JsonNumberToken) {
    yield value.token;
    return;
  }
  if (typeof value === 'string') {
    yield '\"';
    for (let start = 0; start < value.length; ) {
      let end = Math.min(start + 512, value.length);
      const last = value.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff && end < value.length) end++;
      yield JSON.stringify(value.slice(start, end)).slice(1, -1);
      start = end;
    }
    yield '\"';
    return;
  }
  if (Array.isArray(value)) {
    yield '[';
    for (let i = 0; i < value.length; i++) {
      if (i) yield ',';
      yield* evidenceParts(value[i]);
    }
    yield ']';
    return;
  }
  if (value && typeof value === 'object') {
    yield '{';
    let separator = '';
    for (const [name, item] of Object.entries(value)) {
      yield separator;
      yield* evidenceParts(name);
      yield ':';
      yield* evidenceParts(item);
      separator = ',';
    }
    yield '}';
    return;
  }
  yield JSON.stringify(value) ?? 'missing-field';
}
export function boundedJsonEvidence(value: unknown): {
  token: string;
  truncated: boolean;
} {
  let token = '';
  for (const part of evidenceParts(value)) {
    const remaining = 4096 - token.length;
    if (part.length > remaining)
      return { token: token + part.slice(0, remaining), truncated: true };
    token += part;
  }
  return { token, truncated: false };
}
export function p1WireEvidence(value: unknown): {
  readonly kind: string;
  readonly token: string;
  readonly reason: string;
  readonly truncated: boolean;
} {
  const kind =
    value instanceof JsonNumberToken
      ? 'JSON number'
      : value === undefined
        ? 'absent'
        : value === null
          ? 'JSON null'
          : Array.isArray(value)
            ? 'JSON array'
            : 'JSON ' + typeof value;
  const evidence =
    value instanceof JsonNumberToken
      ? { token: value.token, truncated: false }
      : boundedJsonEvidence(value);
  const decision =
    value instanceof JsonNumberToken ? classifyP1Token(value.token) : undefined;
  return {
    kind,
    ...evidence,
    reason:
      decision?.reason ??
      (value === undefined
        ? 'missing-field'
        : value === null
          ? 'null-reference'
          : value === ''
            ? 'empty-reference; native-type violation'
            : 'native-type violation'),
  };
}
