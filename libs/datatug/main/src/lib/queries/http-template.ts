/**
 * HTTP query parameters (spec/features/http-query-parameters): the TypeScript
 * half of the ONE substituter shared with DataTug Core
 * (datatug-core pkg/datatug/query_http_template.go). Both run the same test
 * vectors: `http-template-vectors.json` here is a byte-identical copy of
 * datatug-core `pkg/datatug/testdata/http_template_vectors.json` (refresh it
 * with `scripts/sync-http-template-vectors.mjs`), so the browser run, the
 * DataTug server run and save validation agree.
 *
 * Founder-approved decisions on the spec's open questions (2026-10-22):
 * - one run binds one row: there is no per-row fan-out;
 * - the CLI keeps running only the URL as a GET; header and body placeholders
 *   are web-only (the editor warns);
 * - there is no brace escape: `{{name}}` is literal text;
 * - placeholders are forbidden in the host (and scheme, userinfo, port and
 *   fragment), so a saved query is pinned to its template's origin and no
 *   separate per-query origin allowlist is needed.
 *
 * Stricter than the spec, as in Core: a Content-Type value cannot hold a
 * placeholder, routing/transport headers cannot either, a templated URL must
 * be an absolute http(s) URL with a host and no backslash, whitespace or
 * control character, and the substituted URL, headers and body are capped.
 */

import { httpTemplateMessage } from './http-template-message';

export type HttpParameterType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'bit'
  | 'date'
  | 'datetime';

export const HTTP_PARAMETER_TYPES: readonly HttpParameterType[] = [
  'string',
  'integer',
  'number',
  'boolean',
  'bit',
  'date',
  'datetime',
];

export type HttpPosition =
  | 'method'
  | 'scheme'
  | 'userinfo'
  | 'host'
  | 'path'
  | 'query-name'
  | 'query'
  | 'fragment'
  | 'header-name'
  | 'header'
  | 'content-type'
  | 'reserved-header'
  | 'body'
  | 'json-string'
  | 'json-value'
  | 'json-key'
  | 'json-other';

export type HttpTemplateErrorCode =
  | 'invalid-url'
  | 'forbidden-position'
  | 'invalid-json'
  | 'body-not-allowed'
  | 'invalid-declaration'
  | 'duplicate-parameter'
  | 'undeclared'
  | 'unused'
  | 'default-required'
  | 'credential-parameter'
  | 'json-type'
  | 'missing-value'
  | 'invalid-value'
  | 'dot-segment'
  | 'header-line-break'
  | 'duplicate-content-type'
  | 'too-large';

/** Why a template cannot be saved or run. It never holds a parameter value. */
export class HttpTemplateError extends Error {
  constructor(
    readonly code: HttpTemplateErrorCode,
    readonly detail: string,
    readonly parameter?: string,
    readonly position?: HttpPosition,
    readonly header?: string,
  ) {
    super(httpTemplateMessage(code, parameter, position, header));
    this.name = 'HttpTemplateError';
  }
}

export interface HttpTemplateHeader {
  readonly name: string;
  readonly value: string;
}

export interface HttpRequestTemplate {
  readonly method?: string;
  readonly url: string;
  readonly headers?: readonly HttpTemplateHeader[];
  readonly body?: string;
}

/** The subset of a parameter declaration the substituter reads. */
export interface HttpParameterDecl {
  readonly id: string;
  readonly type: string;
  readonly defaultValue?: unknown;
  readonly isRequired?: boolean;
  readonly isCredential?: boolean;
  readonly isMultiValue?: boolean;
  readonly lookup?: unknown;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly meta?: { readonly entity?: string; readonly field?: string };
}

export interface HttpPlaceholder {
  readonly name: string;
  readonly position: HttpPosition;
  readonly header?: string;
  readonly credential?: boolean;
}

export const MAX_HTTP_TEMPLATE_URL_BYTES = 64 * 1024;
export const MAX_HTTP_TEMPLATE_HEADER_BYTES = 64 * 1024;
/** Mirrors Core `MaxQueryHTTPBodyBytes`. */
export const MAX_HTTP_TEMPLATE_BODY_BYTES = 256 * 1024;
const MAX_SAFE = 9007199254740991;
const MAX_JSON_DEPTH = 512;

type Field = 'url' | 'header' | 'body';
interface Span extends HttpPlaceholder {
  readonly field: Field;
  readonly headerIndex: number;
  readonly start: number;
  readonly end: number;
}

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;
const PLACEHOLDER_PREFIX = /^\{([a-zA-Z0-9_]+)\}/;
const PARAM_ID = /^[a-zA-Z0-9_]+$/;
const SCHEME = /^[hH][tT][tT][pP][sS]?$/;
const HOST =
  /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9][A-Za-z0-9._~-]*)(?::[0-9]{1,5})?$/;
const JSON_NUMBER_PREFIX = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/;
const JSON_NUMBER_FULL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const INTEGER = /^-?[0-9]+$/;
const TIME =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[Tt ]([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]{1,9})?([Zz]|[+-][0-9]{2}:[0-9]{2}))?$/;

const RESERVED_HEADERS = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'te',
  'trailer',
  'forwarded',
  'proxy-connection',
  'expect',
  'via',
  'x-real-ip',
  'x-original-url',
  'x-rewrite-url',
  'x-host',
]);

/** Mirrors Core `IsCredentialHTTPHeader`. */
export function isCredentialHeaderName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (
    [
      'authorization',
      'proxy-authorization',
      'cookie',
      'set-cookie',
      'x-api-key',
      'x-auth-token',
      'x-access-token',
      'x-amz-security-token',
    ].includes(n)
  )
    return true;
  return ['token', 'secret', 'password', 'api-key', 'apikey'].some((p) =>
    n.includes(p),
  );
}

function asciiTrim(s: string): string {
  return s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
}

function isReservedHeader(name: string): boolean {
  const n = asciiTrim(name).toLowerCase();
  return (
    RESERVED_HEADERS.has(n) ||
    n.startsWith('proxy-') ||
    n.startsWith('x-forwarded-')
  );
}

function isContentType(name: string): boolean {
  return asciiTrim(name).toLowerCase() === 'content-type';
}

function isLiteralBraces(s: string, start: number, end: number): boolean {
  return start > 0 && s[start - 1] === '{' && end < s.length && s[end] === '}';
}

interface Match {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

function placeholderMatches(s: string): Match[] {
  const out: Match[] = [];
  for (const m of s.matchAll(PLACEHOLDER)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!isLiteralBraces(s, start, end)) out.push({ name: m[1], start, end });
  }
  return out;
}

function firstPlaceholder(s: string): string {
  return placeholderMatches(s)[0]?.name ?? '';
}

/** The placeholder names in text, in order, skipping `{{name}}`. */
export function placeholderNames(s: string): string[] {
  return placeholderMatches(s).map((m) => m.name);
}

/** True when the template holds any `{name}` placeholder. */
export function httpTemplateHasPlaceholders(t: HttpRequestTemplate): boolean {
  return (
    !!firstPlaceholder(t.url) ||
    !!firstPlaceholder(t.method ?? '') ||
    !!firstPlaceholder(t.body ?? '') ||
    (t.headers ?? []).some(
      (h) => !!firstPlaceholder(h.name) || !!firstPlaceholder(h.value),
    )
  );
}

const forbidden = (
  name: string,
  pos: HttpPosition,
  detail: string,
  header?: string,
) => new HttpTemplateError('forbidden-position', detail, name, pos, header);

function urlSpans(u: string): Span[] {
  if (!firstPlaceholder(u)) return [];
  let rest = u;
  const hash = rest.indexOf('#');
  if (hash >= 0) {
    const name = firstPlaceholder(rest.slice(hash + 1));
    if (name)
      throw forbidden(name, 'fragment', 'the URL fragment cannot hold a placeholder');
    rest = rest.slice(0, hash);
  }
  const schemeEnd = rest.indexOf('://');
  if (schemeEnd >= 0) {
    const name = firstPlaceholder(rest.slice(0, schemeEnd));
    if (name)
      throw forbidden(name, 'scheme', 'the URL scheme cannot hold a placeholder');
  }
  if (schemeEnd < 0 || !SCHEME.test(rest.slice(0, schemeEnd)))
    throw new HttpTemplateError(
      'invalid-url',
      'a URL with placeholders must be an absolute http or https URL, such as https://host/path',
    );
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000- \u007f]/.test(u))
    throw new HttpTemplateError(
      'invalid-url',
      'a URL with placeholders cannot contain spaces, control characters or backslashes',
    );
  let offset = schemeEnd + 3;
  const afterScheme = rest.slice(offset);
  let authority = afterScheme;
  let pathAndQuery = '';
  const authEnd = afterScheme.search(/[/?]/);
  if (authEnd >= 0) {
    authority = afterScheme.slice(0, authEnd);
    pathAndQuery = afterScheme.slice(authEnd);
  }
  const at = authority.lastIndexOf('@');
  if (at >= 0) {
    const name = firstPlaceholder(authority.slice(0, at));
    if (name)
      throw forbidden(name, 'userinfo', 'the URL userinfo cannot hold a placeholder');
    authority = authority.slice(at + 1);
  }
  const hostName = firstPlaceholder(authority);
  if (hostName)
    throw forbidden(
      hostName,
      'host',
      'the URL host and port cannot hold a placeholder: a saved query is pinned to its origin',
    );
  if (!HOST.test(authority))
    throw new HttpTemplateError('invalid-url', 'a URL with placeholders must name its host');
  offset += afterScheme.length - pathAndQuery.length;
  const queryAt = pathAndQuery.indexOf('?');
  const path = queryAt >= 0 ? pathAndQuery.slice(0, queryAt) : pathAndQuery;
  const spans: Span[] = placeholderMatches(path).map((m) => ({
    name: m.name,
    position: 'path',
    field: 'url',
    headerIndex: 0,
    start: offset + m.start,
    end: offset + m.end,
  }));
  if (queryAt < 0) return spans;
  const query = pathAndQuery.slice(queryAt + 1);
  let pairStart = offset + queryAt + 1;
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    const name = eq < 0 ? pair : pair.slice(0, eq);
    const p = firstPlaceholder(name);
    if (p)
      throw forbidden(p, 'query-name', 'a query-string name cannot hold a placeholder');
    if (eq >= 0) {
      const valueStart = pairStart + eq + 1;
      for (const m of placeholderMatches(pair.slice(eq + 1)))
        spans.push({
          name: m.name,
          position: 'query',
          field: 'url',
          headerIndex: 0,
          start: valueStart + m.start,
          end: valueStart + m.end,
        });
    }
    pairStart += pair.length + 1;
  }
  return spans;
}

type BodyMode = 'text' | 'json' | 'form';

function bodyMode(headers: readonly HttpTemplateHeader[]): BodyMode {
  const h = headers.find((x) => isContentType(x.name));
  if (!h) return 'text';
  const media = asciiTrim(h.value.split(';')[0]).toLowerCase();
  if (media === 'application/json' || media.endsWith('+json')) return 'json';
  if (media === 'application/x-www-form-urlencoded') return 'form';
  return 'text';
}

const invalidJson = (detail: string) =>
  new HttpTemplateError(
    'invalid-json',
    'the JSON body is not valid: ' + detail,
    undefined,
    'body',
  );

class JsonScanner {
  i = 0;
  depth = 0;
  readonly spans: Span[] = [];
  constructor(private readonly s: string) {}

  scan(): Span[] {
    this.value();
    this.ws();
    if (this.i < this.s.length) throw this.unexpected();
    return this.spans;
  }

  private ws(): void {
    while (this.i < this.s.length && ' \t\r\n'.includes(this.s[this.i])) this.i++;
  }

  private placeholderAt(): { name: string; length: number } | undefined {
    if (this.s[this.i] !== '{') return undefined;
    const m = PLACEHOLDER_PREFIX.exec(this.s.slice(this.i, this.i + 256));
    if (!m || isLiteralBraces(this.s, this.i, this.i + m[0].length)) return undefined;
    return { name: m[1], length: m[0].length };
  }

  private unexpected(): HttpTemplateError {
    const p = this.placeholderAt();
    if (p)
      return forbidden(
        p.name,
        'json-other',
        'a placeholder in a JSON body must be a whole value or sit inside a string',
      );
    if (this.i >= this.s.length) return invalidJson('unexpected end of input');
    return invalidJson(`unexpected character at offset ${this.i}`);
  }

  private value(): void {
    this.ws();
    const p = this.placeholderAt();
    if (p) {
      this.spans.push({
        name: p.name,
        position: 'json-value',
        field: 'body',
        headerIndex: 0,
        start: this.i,
        end: this.i + p.length,
      });
      this.i += p.length;
      return;
    }
    if (this.i >= this.s.length) throw this.unexpected();
    const c = this.s[this.i];
    if (c === '{' || c === '[') return this.container(c);
    if (c === '"') return this.str(false);
    if (c === '-' || (c >= '0' && c <= '9')) return this.number();
    for (const lit of ['true', 'false', 'null'])
      if (this.s.startsWith(lit, this.i)) {
        this.i += lit.length;
        return;
      }
    throw this.unexpected();
  }

  private container(open: string): void {
    if (++this.depth > MAX_JSON_DEPTH) throw invalidJson('nesting is too deep');
    const closing = open === '{' ? '}' : ']';
    this.i++;
    this.ws();
    if (this.s[this.i] === closing) {
      this.i++;
      this.depth--;
      return;
    }
    for (;;) {
      if (open === '{') {
        this.ws();
        const p = this.placeholderAt();
        if (p)
          throw forbidden(p.name, 'json-key', 'an object key cannot hold a placeholder');
        if (this.s[this.i] !== '"') throw this.unexpected();
        this.str(true);
        this.ws();
        if (this.s[this.i] !== ':') throw this.unexpected();
        this.i++;
      }
      this.value();
      this.ws();
      if (this.s[this.i] === ',') {
        this.i++;
        continue;
      }
      if (this.s[this.i] === closing) {
        this.i++;
        this.depth--;
        return;
      }
      throw this.unexpected();
    }
  }

  private str(isKey: boolean): void {
    this.i++;
    const start = this.i;
    for (;;) {
      if (this.i >= this.s.length) throw invalidJson('unterminated string');
      const c = this.s[this.i];
      const code = c.charCodeAt(0);
      if (c === '"') {
        const raw = this.s.slice(start, this.i);
        for (const m of placeholderMatches(raw)) {
          if (isKey)
            throw forbidden(m.name, 'json-key', 'an object key cannot hold a placeholder');
          this.spans.push({
            name: m.name,
            position: 'json-string',
            field: 'body',
            headerIndex: 0,
            start: start + m.start,
            end: start + m.end,
          });
        }
        this.i++;
        return;
      }
      if (c === '\\') {
        this.i++;
        if (this.i >= this.s.length) throw invalidJson('unterminated string');
        const e = this.s[this.i];
        if ('"\\/bfnrt'.includes(e)) this.i++;
        else if (
          e === 'u' &&
          this.i + 4 < this.s.length &&
          /^[0-9a-fA-F]{4}$/.test(this.s.slice(this.i + 1, this.i + 5))
        )
          this.i += 5;
        else throw invalidJson(`invalid escape at offset ${this.i}`);
      } else if (code < 0x20) {
        throw invalidJson(`control character in a string at offset ${this.i}`);
      } else this.i++;
    }
  }

  private number(): void {
    const m = JSON_NUMBER_PREFIX.exec(this.s.slice(this.i, this.i + 1024));
    if (!m || !m[0]) throw invalidJson(`invalid number at offset ${this.i}`);
    this.i += m[0].length;
  }
}

function spans(t: HttpRequestTemplate): Span[] {
  const methodName = firstPlaceholder(t.method ?? '');
  if (methodName)
    throw forbidden(methodName, 'method', 'the method cannot hold a placeholder');
  const out = urlSpans(asciiTrim(t.url));
  const headers = t.headers ?? [];
  headers.forEach((h, i) => {
    const nameP = firstPlaceholder(h.name);
    if (nameP)
      throw forbidden(nameP, 'header-name', 'a header name cannot hold a placeholder', h.name);
    const credential = isCredentialHeaderName(h.name);
    for (const m of placeholderMatches(h.value)) {
      if (isContentType(h.name))
        throw forbidden(
          m.name,
          'content-type',
          'the Content-Type header decides how the body is encoded, so it cannot hold a placeholder',
          h.name,
        );
      if (isReservedHeader(h.name))
        throw forbidden(
          m.name,
          'reserved-header',
          'this header routes the request or belongs to the transport, so it cannot hold a placeholder',
          h.name,
        );
      out.push({
        name: m.name,
        position: 'header',
        header: h.name,
        credential,
        field: 'header',
        headerIndex: i,
        start: m.start,
        end: m.end,
      });
    }
  });
  const body = t.body ?? '';
  const bodyName = firstPlaceholder(body);
  if (bodyName) {
    const method = t.method || 'GET';
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
      throw new HttpTemplateError(
        'body-not-allowed',
        'only POST, PUT, PATCH and DELETE requests carry a body, so the body cannot hold a placeholder',
        bodyName,
        'body',
      );
    if (headers.filter((h) => isContentType(h.name)).length > 1)
      throw new HttpTemplateError(
        'duplicate-content-type',
        'a body with placeholders needs exactly one Content-Type header, which decides how values are encoded',
        bodyName,
        'body',
      );
    if (bodyMode(headers) === 'json') out.push(...new JsonScanner(body).scan());
    else
      for (const m of placeholderMatches(body))
        out.push({
          name: m.name,
          position: 'body',
          field: 'body',
          headerIndex: 0,
          start: m.start,
          end: m.end,
        });
  }
  return out;
}

/** Every placeholder of the template: URL, headers, body. Throws on a forbidden position. */
export function httpTemplatePlaceholders(t: HttpRequestTemplate): HttpPlaceholder[] {
  return spans(t).map(({ name, position, header, credential }) => ({
    name,
    position,
    ...(header !== undefined ? { header } : {}),
    ...(credential ? { credential } : {}),
  }));
}

function declarationDefaultOk(p: HttpParameterDecl): boolean {
  const v = p.defaultValue;
  // Mirrors Core ParameterDef.Validate's JSON-type check before rendering.
  switch (p.type) {
    case 'string':
      if (typeof v !== 'string') return false;
      break;
    case 'integer':
    case 'bit':
      if (typeof v !== 'number' || !Number.isInteger(v) || Math.abs(v) > MAX_SAFE)
        return false;
      break;
    case 'number':
      if (typeof v !== 'number') return false;
      break;
    case 'boolean':
      if (typeof v !== 'boolean') return false;
      break;
  }
  return renderHttpParameterValue(p.type, v) !== undefined;
}

/** Checks HTTP parameter declarations on their own. Throws HttpTemplateError. */
export function validateHttpParameterDecls(params: readonly HttpParameterDecl[]): void {
  const seen = new Set<string>();
  for (const p of params) {
    const bad = (detail: string) =>
      new HttpTemplateError('invalid-declaration', detail, p.id);
    if (!PARAM_ID.test(p.id))
      throw bad('an HTTP parameter id uses only letters, digits and _');
    if (seen.has(p.id))
      throw new HttpTemplateError('duplicate-parameter', 'is declared more than once', p.id);
    seen.add(p.id);
    if (!(HTTP_PARAMETER_TYPES as readonly string[]).includes(p.type))
      throw bad('type must be one of ' + HTTP_PARAMETER_TYPES.join(', '));
    if (p.isMultiValue || p.lookup || p.minLength || p.maxLength)
      throw bad(
        'isMultiValue, lookup, minLength and maxLength are not supported on HTTP queries',
      );
    if (p.meta && (!p.meta.entity?.trim() || !p.meta.field?.trim()))
      throw bad('meta must name an entity and a field');
    if (p.isCredential) {
      if (!p.isRequired || p.defaultValue !== undefined || p.meta)
        throw new HttpTemplateError(
          'credential-parameter',
          'a credential parameter must be required, with no default and no meta: its value is typed for each run',
          p.id,
        );
      continue;
    }
    if (p.defaultValue === '') throw bad('a default value cannot be empty');
    if (p.defaultValue !== undefined && p.defaultValue !== null) {
      if (!declarationDefaultOk(p))
        throw bad('defaultValue does not match type ' + p.type);
    } else if (!p.isRequired)
      throw new HttpTemplateError(
        'default-required',
        'a parameter that is not required needs a default value',
        p.id,
      );
  }
}

const JSON_LITERAL_TYPES = new Set(['integer', 'number', 'boolean', 'bit']);

function checkUses(
  all: readonly Span[],
  params: readonly HttpParameterDecl[],
): Map<string, HttpParameterDecl> {
  const defs = new Map(params.map((p) => [p.id, p]));
  const used = new Set<string>();
  for (const s of all) {
    const def = defs.get(s.name);
    if (!def)
      throw new HttpTemplateError(
        'undeclared',
        'is used as a placeholder but not declared',
        s.name,
        s.position,
        s.header,
      );
    used.add(s.name);
    if (s.credential && !def.isCredential)
      throw new HttpTemplateError(
        'credential-parameter',
        'a parameter used in a credential header must be declared as a credential',
        s.name,
        s.position,
        s.header,
      );
    if (!s.credential && def.isCredential)
      throw new HttpTemplateError(
        'credential-parameter',
        'a credential parameter can only be used in credential headers',
        s.name,
        s.position,
        s.header,
      );
    if (s.position === 'json-value' && !JSON_LITERAL_TYPES.has(def.type))
      throw new HttpTemplateError(
        'json-type',
        `only integer, number, boolean and bit parameters can be a bare JSON value; put a ${def.type} parameter inside quotes`,
        s.name,
        s.position,
      );
  }
  for (const p of params)
    if (!used.has(p.id) && !p.isCredential)
      throw new HttpTemplateError('unused', 'is declared but no placeholder uses it', p.id);
  return defs;
}

/** Save-time check of a template with its declared parameters. Throws HttpTemplateError. */
export function validateHttpTemplate(
  t: HttpRequestTemplate,
  params: readonly HttpParameterDecl[],
): void {
  validateHttpParameterDecls(params);
  checkUses(spans(t), params);
}

const isMissing = (v: unknown) => v === undefined || v === null || v === '';

// ---- encoding (Go url.PathEscape / url.QueryEscape) ----

const HEX = '0123456789ABCDEF';
const encoder = new TextEncoder();

function goEscape(s: string, keep: string, spacePlus: boolean): string {
  let out = '';
  for (const b of encoder.encode(s)) {
    const c = String.fromCharCode(b);
    if (
      (b >= 0x30 && b <= 0x39) ||
      (b >= 0x41 && b <= 0x5a) ||
      (b >= 0x61 && b <= 0x7a) ||
      '-_.~'.includes(c) ||
      (b < 0x80 && keep.includes(c))
    )
      out += c;
    else if (spacePlus && b === 0x20) out += '+';
    else out += '%' + HEX[b >> 4] + HEX[b & 15];
  }
  return out;
}

/** Go `url.PathEscape`. */
export function goPathEscape(s: string): string {
  return goEscape(s, '$&+:=@', false);
}

/** Go `url.QueryEscape`. */
export function goQueryEscape(s: string): string {
  return goEscape(s, '', true);
}

function jsonStringContent(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    switch (ch) {
      case '"':
        out += '\\"';
        break;
      case '\\':
        out += '\\\\';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      case '\b':
        out += '\\b';
        break;
      case '\f':
        out += '\\f';
        break;
      default:
        out += code < 0x20 ? '\\u' + code.toString(16).padStart(4, '0') : ch;
    }
  }
  return out;
}

const utf8Length = (s: string) => encoder.encode(s).length;
// eslint-disable-next-line no-control-regex
const HEADER_CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f]/;

function spliceField(
  text: string,
  all: readonly Span[],
  encoded: readonly string[],
  field: Field,
  headerIndex: number,
  max: number,
  pos: HttpPosition,
): string {
  let out = '';
  let bytes = 0;
  let last = 0;
  let touched = false;
  all.forEach((s, i) => {
    if (s.field !== field || s.headerIndex !== headerIndex) return;
    touched = true;
    const literal = text.slice(last, s.start);
    const add = utf8Length(literal) + utf8Length(encoded[i]);
    if (bytes + add > max)
      throw new HttpTemplateError(
        'too-large',
        `the substituted value makes it larger than ${max} bytes`,
        s.name,
        s.position,
      );
    out += literal + encoded[i];
    bytes += add;
    last = s.end;
  });
  if (!touched) return text;
  const tail = text.slice(last);
  if (bytes + utf8Length(tail) > max)
    throw new HttpTemplateError(
      'too-large',
      `the substituted value makes it larger than ${max} bytes`,
      undefined,
      pos,
    );
  return out + tail;
}

function prepareSubstitution(
  t: HttpRequestTemplate,
  params: readonly HttpParameterDecl[],
  values: Readonly<Record<string, unknown>>,
): { all: Span[]; encoded: string[] } {
  validateHttpParameterDecls(params);
  const all = spans(t);
  const defs = checkUses(all, params);
  const rendered = new Map<string, string>();
  for (const s of all) {
    if (rendered.has(s.name)) continue;
    const def = defs.get(s.name) as HttpParameterDecl;
    let v: unknown = Object.prototype.hasOwnProperty.call(values, s.name)
      ? values[s.name]
      : undefined;
    if (isMissing(v)) v = def.defaultValue;
    if (isMissing(v))
      throw new HttpTemplateError('missing-value', 'has no value', s.name);
    const text = renderHttpParameterValue(def.type, v);
    if (text === undefined)
      throw new HttpTemplateError(
        'invalid-value',
        'the value is not a valid ' + def.type,
        s.name,
      );
    rendered.set(s.name, text);
  }
  const headers = t.headers ?? [];
  const form = bodyMode(headers) === 'form';
  const cache = new Map<string, string>();
  const encoded = all.map((s) => {
    const key = s.name + '\u0000' + s.position;
    // A cached encoding already passed its position's checks.
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const value = rendered.get(s.name) as string;
    let e: string;
    switch (s.position) {
      case 'path':
        if (value === '.' || value === '..')
          throw new HttpTemplateError(
            'dot-segment',
            'a path value cannot be . or ..',
            s.name,
            s.position,
          );
        e = goPathEscape(value);
        break;
      case 'query':
        e = goQueryEscape(value);
        break;
      case 'header':
        if (HEADER_CONTROL.test(value))
          throw new HttpTemplateError(
            'header-line-break',
            'a header value cannot contain a line break, NUL or other control character',
            s.name,
            s.position,
            s.header,
          );
        e = value;
        break;
      case 'json-string':
        e = jsonStringContent(value);
        break;
      case 'body':
        e = form ? goQueryEscape(value) : value;
        break;
      default:
        e = value;
    }
    cache.set(key, e);
    return e;
  });
  return { all, encoded };
}

/**
 * Validates the template like {@link validateHttpTemplate} and replaces each
 * placeholder with its value encoded for its position. A missing, null or
 * empty value takes the declared default, else fails with missing-value.
 * Substituted text is never rescanned. Throws HttpTemplateError.
 */
export function substituteHttpTemplate(
  t: HttpRequestTemplate,
  params: readonly HttpParameterDecl[],
  values: Readonly<Record<string, unknown>>,
): HttpRequestTemplate {
  const { all, encoded } = prepareSubstitution(t, params, values);
  return {
    ...(t.method !== undefined ? { method: t.method } : {}),
    url: spliceField(asciiTrim(t.url), all, encoded, 'url', 0, MAX_HTTP_TEMPLATE_URL_BYTES, 'path'),
    ...(t.headers
      ? {
          headers: t.headers.map((h, i) => ({
            name: h.name,
            value: spliceField(h.value, all, encoded, 'header', i, MAX_HTTP_TEMPLATE_HEADER_BYTES, 'header'),
          })),
        }
      : {}),
    ...(t.body !== undefined
      ? {
          body: spliceField(t.body, all, encoded, 'body', 0, MAX_HTTP_TEMPLATE_BODY_BYTES, 'body'),
        }
      : {}),
  };
}

/** A piece of a substituted text: literal template text, or a value filled for one placeholder. */
export interface HttpSubstitutedPart {
  readonly text: string;
  /** The parameter id when this piece is a substituted value. */
  readonly name?: string;
}

function partsOf(
  text: string,
  all: readonly Span[],
  encoded: readonly string[],
  field: Field,
  headerIndex: number,
): HttpSubstitutedPart[] {
  const parts: HttpSubstitutedPart[] = [];
  let last = 0;
  all.forEach((s, i) => {
    if (s.field !== field || s.headerIndex !== headerIndex) return;
    if (s.start > last) parts.push({ text: text.slice(last, s.start) });
    if (encoded[i] !== '') parts.push({ text: encoded[i], name: s.name });
    last = s.end;
  });
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/**
 * The substituted request as pieces, attributed by the substitution's own
 * spans, so adjacent placeholders and values that contain the neighbouring
 * literal text are attributed exactly. Concatenating a field's pieces gives
 * the same text as {@link substituteHttpTemplate}. Throws like it.
 */
export function substituteHttpTemplateParts(
  t: HttpRequestTemplate,
  params: readonly HttpParameterDecl[],
  values: Readonly<Record<string, unknown>>,
): { url: HttpSubstitutedPart[]; headers: HttpSubstitutedPart[][]; body?: HttpSubstitutedPart[] } {
  const { all, encoded } = prepareSubstitution(t, params, values);
  return {
    url: partsOf(asciiTrim(t.url), all, encoded, 'url', 0),
    headers: (t.headers ?? []).map((h, i) => partsOf(h.value, all, encoded, 'header', i)),
    ...(t.body !== undefined ? { body: partsOf(t.body, all, encoded, 'body', 0) } : {}),
  };
}

// ---- value coercion (Core RenderHTTPParameterValue) ----

/** Shortest round-trip decimal without an exponent; -0 is 0 (Go FormatFloat 'f', -1). */
export function formatHttpNumber(f: number): string {
  if (f === 0) return '0';
  const s = String(f);
  const e = s.indexOf('e');
  if (e < 0) return s;
  const negative = s.startsWith('-');
  const mantissa = s.slice(negative ? 1 : 0, e);
  const exp = Number(s.slice(e + 1));
  const dot = mantissa.indexOf('.');
  const digits = mantissa.replace('.', '');
  const point = (dot < 0 ? mantissa.length : dot) + exp;
  let out: string;
  if (point >= digits.length) out = digits + '0'.repeat(point - digits.length);
  else if (point <= 0) out = '0.' + '0'.repeat(-point) + digits;
  else out = digits.slice(0, point) + '.' + digits.slice(point);
  return (negative ? '-' : '') + out;
}

function finiteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function boolOf(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === '1' || v === 1) return true;
  if (v === 'false' || v === '0' || v === 0) return false;
  return undefined;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2)
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z: number): [number, number, number] {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function renderTime(type: 'date' | 'datetime', s: string): string | undefined {
  const m = TIME.exec(s);
  if (!m) return undefined;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month))
    return undefined;
  let [hour, minute, second, fraction, offset] = [0, 0, 0, '', 0];
  if (m[4] !== undefined) {
    [hour, minute, second] = [Number(m[4]), Number(m[5]), Number(m[6])];
    if (hour > 23 || minute > 59 || second > 59) return undefined;
    fraction = (m[7] ?? '').replace(/^\./, '').replace(/0+$/, '');
    const zone = m[8];
    if (zone !== 'Z' && zone !== 'z') {
      const oh = Number(zone.slice(1, 3));
      const om = Number(zone.slice(4, 6));
      if (oh > 23 || om > 59) return undefined;
      offset = (oh * 60 + om) * (zone[0] === '-' ? -1 : 1);
    }
  }
  const totalMinutes =
    daysFromCivil(year, month, day) * 1440 + hour * 60 + minute - offset;
  const days = Math.floor(totalMinutes / 1440);
  const minuteOfDay = totalMinutes - days * 1440;
  const [y, mo, d] = civilFromDays(days);
  if (y < 0 || y > 9999) return undefined;
  const date = `${pad(y, 4)}-${pad(mo)}-${pad(d)}`;
  if (type === 'date') return date;
  return (
    `${date}T${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}:${pad(second)}` +
    (fraction ? '.' + fraction : '') +
    'Z'
  );
}

/**
 * Coerces a bound value to the parameter type and renders it (Core
 * `RenderHTTPParameterValue`); undefined when it cannot be coerced.
 */
export function renderHttpParameterValue(type: string, v: unknown): string | undefined {
  switch (type) {
    case 'string': {
      if (typeof v === 'string') return v;
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      const n = finiteNumber(v);
      return n === undefined ? undefined : formatHttpNumber(n);
    }
    case 'integer': {
      if (typeof v === 'string') {
        if (!INTEGER.test(v)) return undefined;
        const n = BigInt(v);
        return n > BigInt(MAX_SAFE) || n < -BigInt(MAX_SAFE) ? undefined : n.toString();
      }
      const n = finiteNumber(v);
      return n !== undefined && Number.isInteger(n) && Math.abs(n) <= MAX_SAFE
        ? formatHttpNumber(n)
        : undefined;
    }
    case 'number': {
      let n: number | undefined;
      if (typeof v === 'string') {
        if (!JSON_NUMBER_FULL.test(v)) return undefined;
        n = finiteNumber(Number(v));
      } else n = finiteNumber(v);
      return n === undefined ? undefined : formatHttpNumber(n);
    }
    case 'boolean':
    case 'bit': {
      const b = boolOf(v);
      if (b === undefined) return undefined;
      return type === 'bit' ? (b ? '1' : '0') : b ? 'true' : 'false';
    }
    case 'date':
    case 'datetime':
      return typeof v === 'string' ? renderTime(type, v) : undefined;
  }
  return undefined;
}
