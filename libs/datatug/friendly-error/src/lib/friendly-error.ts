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
   * An expected failure (a routing miss, any HTTP 4xx/5xx status, a limit, a timeout, a lost connection, a missing
   * item): it is explained to the visitor and never opens the crash-report dialog. Only `unknown` application
   * errors are crashes.
   */
  readonly expected: boolean;
  /**
   * How the failure is reported to the team: `error` for a crash, `warning` for an expected failure that still says
   * something about the service (an outage, a timeout, a lost connection, a rejected request), `none` for what is
   * only the visitor's situation (a missing item, a limit, a missing sign-in).
   */
  readonly report: 'error' | 'warning' | 'none';
  /** Short and safe to read out to support: `HTTP-401`, `NETWORK`, `RATE-LIMIT`, `APP`. */
  readonly code: string;
  /** Quotable id of this occurrence. The same error object always gets the same id (see {@link referenceFor}). */
  readonly reference: string;
  /**
   * Whether this occurrence was sent to the team under {@link FriendlyError.reference}. Only then is the id worth
   * quoting to support, so only then is it shown.
   */
  readonly reported: boolean;
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
  const code = codeOf(error);
  const text = (() => {
    if (typeof error === 'string') return error;
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    if (typeof error === 'object' && error !== null) {
      const { message } = error as { message?: unknown };
      if (typeof message === 'string') return message;
    }
    return '';
  })();
  // A Firebase or Firestore error keeps its machine code (`permission-denied`, `auth/network-request-failed`) in
  // `.code`, and not always in the message, so the code takes part in the classification too.
  return code && !text.includes(code) ? `${text} (${code})` : text;
}

/** The machine code of an error object (`auth/network-request-failed`, `permission-denied`), if it has a string one. */
function codeOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : '';
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

const SECRET_WORDS =
  'token|key|secret|password|passwd|pwd|authorization|signature|credential|session';

/**
 * Removes what must not appear on a screen, in a toast or in a copied report: addresses (any URL with its query or
 * token, a host with a path, internal and loopback hosts, IP addresses), email addresses, file paths, bearer/API
 * tokens, secret-looking `name=value`/`"name": "value"` pairs and long secret-looking runs, stack-trace lines, and
 * anything past a short length.
 *
 * A text that still mentions `undefined`, `null`, `NaN` or `[object Object]` after that is a programming slip, not a
 * cause worth reading out; deleting the word would leave a broken sentence, so such a text becomes empty and the
 * caller falls back to its generic sentence.
 */
export function redactErrorText(text: string): string {
  let out = text
    .split('\n')
    .filter(
      (line) =>
        !/^\s*at\s+\S+/.test(line) && !/^\s*[^\s]*@\S+:\d+:\d+\s*$/.test(line),
    )
    .join(' ');
  out = out
    // Any URL, including a protocol-relative one such as `//github.com:undefined/…`, with its path and query.
    .replace(/(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s'"<>)]+/gi, '[address]')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    // A Windows path, then a Unix/home path of two or more segments.
    .replace(/\b[a-z]:\\[^\s'"<>]+/gi, '[path]')
    .replace(
      /(^|[\s'"(=,:])((?:~|\.{1,2})?(?:\/[\w.@+%~-]+){2,}\/?)/g,
      '$1[path]',
    )
    // Internal hosts in full (`mydb.svc.cluster.local`, `prod-db.corp.example.com`), `localhost`, `host:port`.
    .replace(
      /\b(?:[\w-]+\.)+(?:local|internal|lan|corp|intranet|svc)(?:\.[\w-]+)*(?::\d+)?\b/gi,
      '[address]',
    )
    .replace(/\blocalhost(?::\d+)?\b/gi, '[address]')
    .replace(/\b(?=[\w-]*[a-z])[\w-]+:\d{2,5}\b/gi, '[address]')
    // A public host written without a scheme keeps no path or query.
    .replace(
      /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?[/?#][^\s'"<>)]*/gi,
      '[address]',
    )
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '[address]')
    .replace(/\[[0-9a-f:.]+\](?::\d+)?(?:%\w+)?/gi, '[address]')
    // IPv6 only when it is one (`::`, or eight groups): a clock time such as 12:30:45 is not.
    .replace(
      /(^|[^\w:])((?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4})(?:%\w+)?(?![\w:])/gi,
      (match, lead: string, candidate: string) =>
        candidate.includes('::') || candidate.split(':').length === 8
          ? `${lead}[address]`
          : match,
    )
    .replace(/\bBearer\s+\S+/gi, 'Bearer [hidden]')
    .replace(
      /\b(?:gh[pousr]_|github_pat_|sk-|xox[bpa]-|AIza|eyJ)[\w-]{8,}/g,
      '[hidden]',
    )
    // `access_token=…`, `api_key: …`, `"client_secret": "…"`, `password: x`: a secret-named key keeps no value.
    .replace(
      new RegExp(
        `["']?([\\w-]*(?:${SECRET_WORDS})[\\w-]*)["']?\\s*[=:]\\s*("[^"]*"|'[^']*'|[^\\s,;&}]+)`,
        'gi',
      ),
      '$1=[hidden]',
    )
    .replace(/\bcode=\S+/gi, 'code=[hidden]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[hidden]')
    .replace(/\s+/g, ' ')
    .trim();
  if (/\b(?:undefined|null|NaN)\b|\[object \w+\]/i.test(out)) return '';
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

const objectReferences = new WeakMap<object, string>();
const textReferences = new Map<string, string>();
const reportedReferences = new Set<string>();
const MAX_REMEMBERED = 100;

/**
 * The reference of this failure: the same one wherever the same error is shown (the toast, the page, the report to
 * the team), so what a visitor reads out is what the team can look up. An error object keeps its reference for as
 * long as it lives; a plain string is remembered for a while.
 */
export function referenceFor(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    let reference = objectReferences.get(error);
    if (!reference) {
      reference = newErrorReference();
      objectReferences.set(error, reference);
    }
    return reference;
  }
  const key = String(error);
  let reference = textReferences.get(key);
  if (!reference) {
    reference = newErrorReference();
    if (textReferences.size >= MAX_REMEMBERED)
      textReferences.delete(textReferences.keys().next().value as string);
    textReferences.set(key, reference);
  }
  return reference;
}

/** Records that the failure was sent to the team under its reference, so the reference may be shown. */
export function markReported(error: unknown): string {
  const reference = referenceFor(error);
  if (reportedReferences.size >= MAX_REMEMBERED * 4) reportedReferences.clear();
  reportedReferences.add(reference);
  return reference;
}

type Parts = Pick<
  FriendlyError,
  'title' | 'hint' | 'retryable' | 'kind' | 'expected' | 'code' | 'report'
>;

function classify(error: unknown, what: string): Parts {
  const status = statusOf(error);
  const text = rawTextOf(error);
  const code = codeOf(error).toLowerCase();
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
      report: 'none',
      code: 'ROUTE-404',
    };
  }
  if (isGithubRateLimit(error) || code === 'resource-exhausted') {
    return {
      kind: 'rate-limit',
      title: 'GitHub is limiting anonymous requests',
      hint: 'This project is read from GitHub without signing in, and GitHub allows only a few such reads per hour. Wait a few minutes, then retry.',
      retryable: true,
      expected: true,
      report: 'none',
      code: 'RATE-LIMIT',
    };
  }
  if (
    status === 401 ||
    code === 'unauthenticated' ||
    /^auth\/(?:user-token-expired|requires-recent-login|invalid-user-token|id-token-expired|user-not-found)$/.test(
      code,
    ) ||
    /not authenticated|no firebase id token/i.test(text)
  ) {
    return {
      kind: 'unauthenticated',
      title: 'Sign in to see this',
      hint: 'Sign in with an account that can read it, then try again.',
      retryable: false,
      expected: true,
      report: 'none',
      code: 'HTTP-401',
    };
  }
  if (
    status === 403 ||
    code === 'permission-denied' ||
    /permission[-_ ]denied/i.test(text)
  ) {
    return {
      kind: 'forbidden',
      title: "You don't have access",
      hint: 'Ask the owner to share it with you, or sign in with another account.',
      retryable: false,
      expected: true,
      report: 'none',
      code: 'HTTP-403',
    };
  }
  if (status === 404 || code === 'not-found') {
    return {
      kind: 'not-found',
      title: 'Not found',
      hint: `We could not find ${what}. It may have been renamed, moved or deleted.`,
      retryable: false,
      expected: true,
      report: 'none',
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
      report: 'none',
      code: 'HTTP-429',
    };
  }
  if (
    status === 408 ||
    code === 'deadline-exceeded' ||
    /\b(timed? ?out|timeout|AbortError|TimeoutError)\b/i.test(text)
  ) {
    return {
      kind: 'timeout',
      title: `${capitalize(service)} took too long to answer`,
      hint: 'Retry in a moment. If it keeps happening, the service may be busy.',
      retryable: true,
      expected: true,
      report: 'warning',
      code: 'TIMEOUT',
    };
  }
  if (
    status === 0 ||
    code === 'unavailable' ||
    code === 'auth/network-request-failed' ||
    /failed to fetch|networkerror|network[ -]request[ -]failed|load failed|unknown error|cors|net::|did not answer/i.test(
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
      report: 'warning',
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
      report: 'warning',
      code: `HTTP-${status}`,
    };
  }
  if (status !== undefined && status >= 400) {
    // 400, 409, 410, 422 ...: the service understood the request and refused it. Pressing Retry repeats it.
    return {
      kind: 'invalid',
      title: 'That request was not accepted',
      hint: 'Go back and check what was entered, then try again.',
      retryable: false,
      expected: true,
      report: 'warning',
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
      report: 'none',
      code: 'INVALID',
    };
  }
  return {
    kind: 'unknown',
    title: 'Something went wrong',
    hint: 'Try again in a moment.',
    retryable: true,
    expected: false,
    report: 'error',
    code: 'APP',
  };
}

/** The hint for a crash that was reported: the visitor can quote the reference. */
const REPORTED_UNKNOWN_HINT =
  'Try again. If it keeps happening, give the reference from Details to support.';

/** Maps any failure to text safe to show. `what` is the thing being loaded, in lower case ("this board"). */
export function friendlyError(
  error: unknown,
  what = 'this page',
  reference: string = referenceFor(error),
): FriendlyError {
  const parts = classify(error, what);
  const reported = reportedReferences.has(reference);
  return {
    ...parts,
    hint:
      parts.kind === 'unknown' && reported ? REPORTED_UNKNOWN_HINT : parts.hint,
    reference,
    reported,
    detail: redactErrorText(parts.kind === 'unknown' ? rawTextOf(error) : ''),
  };
}

/** The short form for callers that only need to know whether the failure is expected (no crash dialog). */
export const isExpectedError = (error: unknown): boolean =>
  classify(error, 'this page').expected;

/** Whether the failure belongs on a page as a designed state, not in a toast (a 404, a limit, a missing sign-in). */
export const isPageLevelError = (error: unknown): boolean =>
  ['not-found', 'routing', 'rate-limit', 'unauthenticated'].includes(
    classify(error, 'this page').kind,
  );

/** How the failure should be reported to the team; see {@link FriendlyError.report}. */
export const reportLevelOf = (error: unknown): FriendlyError['report'] =>
  classify(error, 'this page').report;

/** The text the Details disclosure copies for support: code, the reference when reported, and the cause. */
export function errorReport(error: FriendlyError): string {
  return [
    `Code: ${error.code}`,
    ...(error.reported ? [`Reference: ${error.reference}`] : []),
    ...(error.detail ? [`Cause: ${error.detail}`] : []),
  ].join('\n');
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
