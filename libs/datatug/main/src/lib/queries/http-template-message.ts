import type { HttpPosition, HttpTemplateErrorCode } from './http-template';

/** Where a placeholder sits, in the words a query author uses. */
const POSITION_PLACE: Partial<Record<HttpPosition, string>> = {
  method: 'the method',
  scheme: 'the web address scheme',
  userinfo: 'the web address user name or password',
  host: "the web address's host",
  path: 'the path',
  'query-name': 'a query parameter name',
  query: 'a query value',
  fragment: 'the part after #',
  'header-name': 'a header name',
  header: 'a header value',
  'content-type': 'the Content-Type header',
  'reserved-header': 'a header the network layer controls',
  body: 'the body',
  'json-string': 'a JSON string',
  'json-value': 'a JSON value',
  'json-key': 'a JSON key',
  'json-other': 'that part of the JSON',
};

/** A position a placeholder can never take, with the advice that goes with it. */
const FORBIDDEN_ADVICE: Partial<Record<HttpPosition, string>> = {
  host: ' Use a separate query for each host.',
  scheme: ' Use a separate query for each scheme.',
  userinfo: ' Put credentials in an Authorization header instead.',
};

const trim = (s: string | undefined, max = 40): string =>
  (s ?? '').replace(/[^\w.-]/g, '').slice(0, max);

/**
 * One plain sentence for a template problem, written from its structured
 * fields only (never from server text and never with a value).
 */
export function httpTemplateMessage(
  code: string,
  parameter?: string,
  position?: string,
  header?: string,
): string {
  const p = parameter ? `{${trim(parameter)}}` : 'A placeholder';
  const where = position ? POSITION_PLACE[position as HttpPosition] : undefined;
  const h = header ? ` in the ${trim(header)} header` : '';
  switch (code as HttpTemplateErrorCode) {
    case 'forbidden-position':
      return `${p} can't be used in ${where ?? 'that part of the request'}.${FORBIDDEN_ADVICE[position as HttpPosition] ?? ''}`;
    case 'invalid-url':
      return 'With placeholders, the web address must be a complete http or https address without spaces or backslashes, such as https://host/path.';
    case 'invalid-json':
      return 'The JSON body is not valid JSON.';
    case 'body-not-allowed':
      return `${p} can't be in the body: only POST, PUT, PATCH and DELETE send one.`;
    case 'duplicate-content-type':
      return `${p} needs exactly one Content-Type header, so the body is encoded correctly.`;
    case 'invalid-declaration':
      return `${p} can't be declared: use only letters, digits and _ in its name, and a supported type.`;
    case 'duplicate-parameter':
      return `${p} is declared more than once.`;
    case 'undeclared':
      return `${p} is used in the request but not declared.`;
    case 'unused':
      return `${p} is declared but the request doesn't use it.`;
    case 'default-required':
      return `${p} is optional, so it needs a default value.`;
    case 'credential-parameter':
      return `${p} is a credential: it must be required, have no default, and appear only in a credential header such as Authorization.`;
    case 'json-type':
      return `${p} can stand alone as a JSON value only if it is a number or a yes/no value. Put it inside quotes.`;
    case 'missing-value':
      return `${p} needs a value.`;
    case 'invalid-value':
      return `The value for ${p} doesn't match its type.`;
    case 'dot-segment':
      return `${p} can't be . or .. in a path.`;
    case 'header-line-break':
      return `The value for ${p}${h} can't contain line breaks or control characters.`;
    case 'too-large':
      return `With ${p} filled in, the request is too large.`;
    default:
      return 'This request template is not valid.';
  }
}
