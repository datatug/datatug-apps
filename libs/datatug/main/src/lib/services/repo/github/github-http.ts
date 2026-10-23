// One GET to one of the three hosts a GitHub project is read from, with the rules of design
// `demo-as-github-project.md` 3.6 built in: no credentials, no redirect followed, no other host, a size cap
// checked on the bytes received, a time limit. Pure: `fetch` and the timer are passed in.

import { GITHUB_REQUEST_TIMEOUT_MS } from './github-read-limits';
import {
  DEFAULT_ANON_LIMIT_MS,
  type IGithubApiMemory,
  type IGithubConditionalEntry,
} from './github-api-memory';
import {
  githubIdentity,
  rejectGithubUserToken,
  usableGithubToken,
} from './github-user-token';

export const GITHUB_API_HOST = 'api.github.com';
export const GITHUB_RAW_HOST = 'raw.githubusercontent.com';
export const GITHUB_MIRROR_HOST = 'cdn.jsdelivr.net';

const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  GITHUB_API_HOST,
  GITHUB_RAW_HOST,
  GITHUB_MIRROR_HOST,
]);

/** The `fetch` the reader uses. Injected so a test answers without a network. */
export type GithubFetch = (url: string, init: RequestInit) => Promise<Response>;

/** What one GET came to. A `fetch` that throws is `down`, never an exception. */
export type GithubOutcome =
  | { readonly kind: 'ok'; readonly text: string; readonly bytes: number }
  /** `404`, `409` (an empty repository), `410`, `422` (no such ref). */
  | { readonly kind: 'missing'; readonly status: number }
  /** A redirect: a renamed or moved repository. Never followed. Only reported when `detectMoved` is set. */
  | { readonly kind: 'moved' }
  /**
   * `403` or `429`: a limit, or a block. `retryAt` (ms since the epoch) is when GitHub says the limit resets, when it
   * says so (`X-RateLimit-Reset` with nothing remaining, or `Retry-After`).
   */
  | {
      readonly kind: 'refused';
      readonly status: number;
      readonly retryAt?: number;
    }
  /** A `5xx`, any other status, a network error, a redirect when `detectMoved` is not set, or a timeout. */
  | { readonly kind: 'down'; readonly status?: number }
  /** More bytes arrived than `maxBytes`; the transfer was cancelled. */
  | { readonly kind: 'too-large' };

export interface IGithubGetOptions {
  /** The most bytes of body to accept; the transfer is cancelled past it. */
  readonly maxBytes: number;
  readonly accept?: string;
  /**
   * Ask for the redirect itself (`redirect: 'manual'`) instead of an error, to tell a renamed repository from an
   * outage. The redirect is never followed either way. Used for the one host that answers a rename with a
   * redirect, `api.github.com`: `raw.githubusercontent.com` and jsDelivr answer `200` for a renamed repository
   * (measured), so only there is the signal available.
   */
  readonly detectMoved?: boolean;
  readonly timeoutMs?: number;
  /**
   * The signed-in user's GitHub token. Sent as `Authorization: Bearer` to `api.github.com` only (never to the file host
   * or the mirror), so the call counts against the user's 5,000 an hour instead of the anonymous 60 an hour of the
   * address. A token GitHub refuses (`401`: expired or revoked) is dropped for the page and the call is made again
   * anonymously, once: a stale sign-in never stops a public read, and is not paid for again.
   */
  readonly token?: string;
  /**
   * What is remembered about `api.github.com` calls (see `github-api-memory.ts`): with it, an anonymous call is not
   * made while GitHub is known to refuse it, and a call with a token is made conditional on the answer kept.
   */
  readonly memory?: IGithubApiMemory;
  /** The clock, in ms since the epoch. Injected so a test controls it. */
  readonly now?: () => number;
}

/** `url` as the URL parser reads it, when it is an `https` address with no user name or password on one of the three hosts. */
function allowedGithubUrl(url: string): URL | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  return parsed.protocol === 'https:' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.port === '' &&
    ALLOWED_HOSTS.has(parsed.hostname)
    ? parsed
    : undefined;
}

/** Whether `url` is an `https` address, with no user name or password, on one of the three hosts. */
export function isAllowedGithubUrl(url: string): boolean {
  return allowedGithubUrl(url) !== undefined;
}

/**
 * Reads at most `maxBytes` of a response body, counting the bytes as they arrive and cancelling the transfer
 * as soon as the count passes the cap. A `Content-Length` header is neither trusted nor needed.
 */
export async function readBodyLimited(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bytes: number } | 'too-large'> {
  const decoder = new TextDecoder('utf-8');
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return buffer.byteLength > maxBytes
      ? 'too-large'
      : { text: decoder.decode(buffer), bytes: buffer.byteLength };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return 'too-large';
    }
    chunks.push(value);
  }
  const all = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: decoder.decode(all), bytes };
}

/**
 * One GET, as {@link GithubOutcome}. Never throws; never sends cookies; never follows a redirect. The user's token,
 * when given, goes to `api.github.com` only (see {@link IGithubGetOptions.token}).
 */
export async function githubGet(
  fetchFn: GithubFetch,
  url: string,
  options: IGithubGetOptions,
): Promise<GithubOutcome> {
  const parsed = allowedGithubUrl(url);
  if (!parsed) {
    return { kind: 'down' };
  }
  const api = parsed.hostname === GITHUB_API_HOST;
  const token = api ? usableGithubToken(options.token) : undefined;
  const memory = api ? options.memory : undefined;
  if (token) {
    // A `304` to an authorised call costs nothing (see `github-api-memory.ts`): ask on the answer kept.
    const key = memory
      ? `${githubIdentity(token)}|${options.accept ?? ''}|${parsed.href}`
      : undefined;
    const kept = key ? memory?.getConditional(key) : undefined;
    const authorised = await githubGetOnce(
      fetchFn,
      parsed,
      options,
      token,
      kept,
    );
    if (authorised !== 'unauthorised') {
      if (key && authorised.kind === 'ok' && authorised.etag) {
        memory?.putConditional(key, {
          etag: authorised.etag,
          text: authorised.text,
          bytes: authorised.bytes,
        });
      }
      return withoutEtag(authorised);
    }
    // Refused once: never sent again in this page, so later calls do not pay for it twice.
    rejectGithubUserToken(token);
    memory?.dropConditional(githubIdentity(token));
  }
  const now = options.now ?? (() => Date.now());
  const limitedUntil = memory?.anonymousLimitedUntil() ?? 0;
  if (limitedUntil > now()) {
    // GitHub refuses anonymous calls from here until then: asking again would only be refused, and would delay the page.
    return { kind: 'refused', status: 403, retryAt: limitedUntil };
  }
  const anonymous = await githubGetOnce(fetchFn, parsed, options);
  if (anonymous === 'unauthorised') {
    return { kind: 'down', status: 401 };
  }
  if (memory && anonymous.kind === 'refused') {
    memory.noteAnonymousLimit(
      anonymous.retryAt ?? now() + DEFAULT_ANON_LIMIT_MS,
    );
  }
  return withoutEtag(anonymous);
}

type GithubOutcomeWithEtag =
  | Exclude<GithubOutcome, { kind: 'ok' }>
  | (Extract<GithubOutcome, { kind: 'ok' }> & { readonly etag?: string });

function withoutEtag(out: GithubOutcomeWithEtag): GithubOutcome {
  if (out.kind === 'ok' && 'etag' in out) {
    return { kind: 'ok', text: out.text, bytes: out.bytes };
  }
  return out;
}

/** When a refused call may be made again, as GitHub's headers say (ms since the epoch), or undefined. */
export function githubRetryAt(
  headers: Headers,
  now: number,
): number | undefined {
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (
    headers.get('x-ratelimit-remaining') === '0' &&
    Number.isFinite(reset) &&
    reset > 0
  ) {
    return Math.max(reset * 1000, now + 1000);
  }
  const after = Number(headers.get('retry-after'));
  if (
    headers.get('retry-after') !== null &&
    Number.isFinite(after) &&
    after >= 0
  ) {
    return now + Math.max(after, 1) * 1000;
  }
  return undefined;
}

async function githubGetOnce(
  fetchFn: GithubFetch,
  parsed: URL,
  options: IGithubGetOptions,
  token?: string,
  kept?: IGithubConditionalEntry,
): Promise<GithubOutcomeWithEtag | 'unauthorised'> {
  const headers: Record<string, string> = {
    ...(options.accept ? { Accept: options.accept } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(kept ? { 'If-None-Match': kept.etag } : {}),
  };
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? GITHUB_REQUEST_TIMEOUT_MS,
  );
  try {
    // The address that was checked, as parsed: what is sent is what was allowed, not the string that was given.
    const response = await fetchFn(parsed.href, {
      method: 'GET',
      credentials: 'omit',
      redirect: options.detectMoved ? 'manual' : 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
      ...(Object.keys(headers).length ? { headers } : {}),
    });
    const { status } = response;
    if (status === 401 && token) {
      await response.body?.cancel().catch(() => undefined);
      return 'unauthorised';
    }
    if (status === 304 && kept) {
      // Not changed since the answer kept: that answer, at no cost.
      return { kind: 'ok', text: kept.text, bytes: kept.bytes };
    }
    if (response.type === 'opaqueredirect' || (status >= 300 && status < 400)) {
      return options.detectMoved ? { kind: 'moved' } : { kind: 'down', status };
    }
    if (status === 404 || status === 409 || status === 410 || status === 422) {
      await response.body?.cancel().catch(() => undefined);
      return { kind: 'missing', status };
    }
    if (status === 403 || status === 429) {
      await response.body?.cancel().catch(() => undefined);
      const retryAt = githubRetryAt(
        response.headers,
        (options.now ?? (() => Date.now()))(),
      );
      return retryAt === undefined
        ? { kind: 'refused', status }
        : { kind: 'refused', status, retryAt };
    }
    if (status < 200 || status >= 300) {
      await response.body?.cancel().catch(() => undefined);
      return { kind: 'down', status };
    }
    const body = await readBodyLimited(response, options.maxBytes);
    if (body === 'too-large') {
      return { kind: 'too-large' };
    }
    const etag = token ? response.headers.get('etag') : null;
    return etag ? { kind: 'ok', ...body, etag } : { kind: 'ok', ...body };
  } catch {
    return { kind: 'down' };
  } finally {
    clearTimeout(timer);
  }
}
