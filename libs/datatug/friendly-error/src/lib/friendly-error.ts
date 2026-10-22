/**
 * What a visitor is told when something fails: what happened and what to do next, in plain words, without leaking
 * anything private. The words are chosen from the KIND of failure; the raw error text is never shown. What may be
 * shown in the collapsed "Details" (a short code, a reference) is sanitised by {@link redactErrorText}.
 */
export type ErrorKind =
  | 'unauthenticated'
  | 'forbidden'
  | 'not-found'
  | 'rate-limit'
  | 'timeout'
  | 'offline'
  | 'server'
  | 'invalid'
  | 'routing'
  | 'unknown';

export interface FriendlyError {
  readonly kind: ErrorKind;
  readonly title: string;
  readonly hint: string;
  /** Whether trying again can help. A missing item or a refused access will not change by pressing Retry. */
  readonly retryable: boolean;
  /**
   * An expected failure (a routing miss, an HTTP status, a limit, a timeout, a missing item): it is explained to the
   * visitor and never opens the crash-report dialog. Only `unknown` and `invalid` application errors are crashes.
   */
  readonly expected: boolean;
  /** Short and safe to read out to support: `HTTP-401`, `NETWORK`, `RATE-LIMIT`, `APP`. */
  readonly code: string;
  /** Quotable id of this occurrence, to match a support request to a report. */
  readonly reference: string;
  /** Sanitised one-liner of the cause, for the Details disclosure. Never contains an address, token or `undefined`. */
  readonly detail: string;
}

const MAX_DETAIL = 140;

/** The HTTP status carried by an Angular `HttpErrorResponse`, a fetch outcome (`{ status }`) or a plain object. */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function rawTextOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'object' && error !== null) {
    const { message } = error as { message?: unknown };
    if (typeof message === 'string') return message;
  }
  return '';
}

/** The address the failed request was for, when the error carries one (used to name the service, never shown). */
function urlOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const { url } = error as { url?: unknown };
    if (typeof url === 'string') return url;
  }
  return /(?:https?:)?\/\/[^\s'")]+/i.exec(rawTextOf(error))?.[0] ?? '';
}

const LOOPBACK =
  /(^|[/@])(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)(?=[:/\s]|$)/i;

/** Whether the address is on the visitor's own computer: the local DataTug agent, not a hosted service. */
export function isLoopbackAddress(url: string): boolean {
  return LOOPBACK.test(url);
}

/** A name for the service behind an address, for "Can't reach <name>". Internal hosts get a generic name. */
export function serviceNameOf(url: string): string {
  if (!url) return 'the server';
  if (isLoopbackAddress(url)) return 'the local DataTug agent';
  let host = '';
  try {
    host = new URL(url.startsWith('//') ? `https:${url}` : url).hostname;
  } catch {
    host = /^(?:https?:)?\/\/([^/:?#\s]+)/i.exec(url)?.[1] ?? '';
  }
  host = host.toLowerCase();
  if (
    /(^|\.)github(usercontent)?\.com$/.test(host) ||
    host === 'cdn.jsdelivr.net'
  )
    return 'GitHub';
  if (/(^|\.)demodb\.dev$/.test(host)) return 'the DemoDB service';
  if (/(^|\.)openvaultdb\.com$/.test(host)) return 'the OpenVaultDB service';
  if (/(^|\.)(datatug|sneat)\.(app|io|co|ai)$/.test(host)) return 'DataTug';
  return 'the server';
}

/**
 * Removes what must not appear on a screen, in a toast or in a copied report: addresses (any URL, with its query or
 * token), IP and loopback addresses, bearer/API tokens and long secret-looking runs, stack-trace lines, the words
 * `undefined` and `null`, and anything past a short length.
 */
export function redactErrorText(text: string): string {
  let out = text
    .split('\n')
    .filter((line) => !/^\s*at\s+\S+/.test(line))
    .join(' ');
  out = out
    // Any URL, including a protocol-relative one such as `//github.com:undefined/…`, with its path and query.
    .replace(/(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s'"<>)]+/gi, '[address]')
    .replace(
      /\b(?:localhost|[\w-]+\.(?:local|internal|lan|corp))(?::\d+)?\b/gi,
      '[address]',
    )
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '[address]')
    .replace(/\[?(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\]?/gi, '[address]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [hidden]')
    .replace(
      /\b(?:gh[pousr]_|github_pat_|sk-|xox[bpa]-|AIza|eyJ)[\w-]{8,}/g,
      '[hidden]',
    )
    .replace(
      /\b(token|key|secret|password|authorization|code)=\S+/gi,
      '$1=[hidden]',
    )
    .replace(/[A-Za-z0-9_-]{32,}/g, '[hidden]')
    .replace(/\b(?:undefined|null)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (out.length > MAX_DETAIL)
    out = `${out.slice(0, MAX_DETAIL - 1).trimEnd()}…`;
  return out;
}

/** Whether `error` is GitHub (or a mirror of it) refusing anonymous reads because the hourly limit was used up. */
export function isGithubRateLimit(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    if ((error as { kind?: unknown }).kind === 'refused') return true;
  }
  const status = statusOf(error);
  const text = rawTextOf(error);
  return (
    /rate limit|secondary rate/i.test(text) ||
    ((status === 429 || status === 403) &&
      serviceNameOf(urlOf(error)) === 'GitHub')
  );
}

/** A fresh quotable reference such as `7f3a9c1e`. */
export function newErrorReference(): string {
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
  }
}

type Parts = Pick<
  FriendlyError,
  'title' | 'hint' | 'retryable' | 'kind' | 'expected' | 'code'
>;

function classify(error: unknown, what: string): Parts {
  const status = statusOf(error);
  const text = rawTextOf(error);
  const url = urlOf(error);
  const service =
    serviceNameOf(url) === 'the server' && /github/i.test(text)
      ? 'GitHub'
      : serviceNameOf(url);
  const local = isLoopbackAddress(url);

  if (/NG04002|Cannot match any routes/i.test(text)) {
    return {
      kind: 'routing',
      title: 'Page not found',
      hint: 'This address does not lead anywhere. Continue from the boards or queries of the project.',
      retryable: false,
      expected: true,
      code: 'ROUTE-404',
    };
  }
  if (isGithubRateLimit(error)) {
    return {
      kind: 'rate-limit',
      title: 'GitHub is limiting anonymous requests',
      hint: 'This project is read from GitHub without signing in, and GitHub allows only a few such reads per hour. Wait a few minutes, then retry.',
      retryable: true,
      expected: true,
      code: 'RATE-LIMIT',
    };
  }
  if (status === 401 || /not authenticated|no firebase id token/i.test(text)) {
    return {
      kind: 'unauthenticated',
      title: 'Sign in to see this',
      hint: 'Sign in with an account that can read it, then try again.',
      retryable: false,
      expected: true,
      code: 'HTTP-401',
    };
  }
  if (status === 403 || /permission-denied|PERMISSION_DENIED/.test(text)) {
    return {
      kind: 'forbidden',
      title: "You don't have access",
      hint: 'Ask the owner to share it with you, or sign in with another account.',
      retryable: false,
      expected: true,
      code: 'HTTP-403',
    };
  }
  if (status === 404) {
    return {
      kind: 'not-found',
      title: 'Not found',
      hint: `We could not find ${what}. It may have been renamed, moved or deleted.`,
      retryable: false,
      expected: true,
      code: 'HTTP-404',
    };
  }
  if (status === 429) {
    return {
      kind: 'rate-limit',
      title: 'Too many requests',
      hint: 'Wait a minute, then retry.',
      retryable: true,
      expected: true,
      code: 'HTTP-429',
    };
  }
  if (
    status === 408 ||
    /\b(timed? ?out|timeout|AbortError|TimeoutError)\b/i.test(text)
  ) {
    return {
      kind: 'timeout',
      title: `${capitalize(service)} took too long to answer`,
      hint: 'Retry in a moment. If it keeps happening, the service may be busy.',
      retryable: true,
      expected: true,
      code: 'TIMEOUT',
    };
  }
  if (
    status === 0 ||
    /failed to fetch|networkerror|network request failed|load failed|unknown error|cors|net::|did not answer/i.test(
      text,
    )
  ) {
    return {
      kind: 'offline',
      title: `Can't reach ${service}`,
      hint: local
        ? 'Start the agent on this computer with `datatug serve`, then retry.'
        : 'Check your connection, then retry. If it keeps failing, the service may be down for a moment.',
      retryable: true,
      expected: true,
      code: 'NETWORK',
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      kind: 'server',
      title: `${capitalize(service)} had a problem`,
      hint: 'This is usually temporary. Retry in a moment.',
      retryable: true,
      expected: true,
      code: `HTTP-${status}`,
    };
  }
  if (/invalid .*(configuration|presentation|chart|board)/i.test(text)) {
    return {
      kind: 'invalid',
      title: `${capitalize(what)} has a setting DataTug cannot display`,
      hint: 'The saved definition is not valid. Open it in the editor and check its settings.',
      retryable: false,
      expected: true,
      code: 'INVALID',
    };
  }
  return {
    kind: 'unknown',
    title: 'Something went wrong',
    hint: 'Try again. If it keeps happening, give the reference from Details to support.',
    retryable: true,
    expected: false,
    code: 'APP',
  };
}

/** Maps any failure to text safe to show. `what` is the thing being loaded, in lower case ("this board"). */
export function friendlyError(
  error: unknown,
  what = 'this page',
  reference: string = newErrorReference(),
): FriendlyError {
  const parts = classify(error, what);
  return {
    ...parts,
    reference,
    detail: redactErrorText(parts.kind === 'unknown' ? rawTextOf(error) : ''),
  };
}

/** The short form for callers that only need to know whether the failure is expected (no crash dialog). */
export const isExpectedError = (error: unknown): boolean =>
  classify(error, 'this page').expected;

/** The text the Details disclosure copies for support: code, reference and the sanitised cause. */
export function errorReport(error: FriendlyError): string {
  return [
    `Code: ${error.code}`,
    `Reference: ${error.reference}`,
    ...(error.detail ? [`Cause: ${error.detail}`] : []),
  ].join('\n');
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
