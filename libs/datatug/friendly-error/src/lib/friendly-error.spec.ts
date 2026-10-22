import { describe, expect, it } from 'vitest';
import {
  errorReport,
  friendlyError,
  isExpectedError,
  isPageLevelError,
  markReported,
  redactErrorText,
  referenceFor,
  reportLevelOf,
} from './friendly-error';

const LEAKS = [
  /https?:\/\//i,
  /\/\/github/i,
  /undefined/i,
  /127\.0\.0\.1/,
  /localhost/i,
  /ghp_/,
  /token=/i,
];

function expectNoLeak(text: string): void {
  for (const leak of LEAKS) expect(text).not.toMatch(leak);
}

describe('redactErrorText', () => {
  it('removes a URL together with its query and token', () => {
    const out = redactErrorText(
      'Failed https://api.example.com/v1/x?token=ghp_abcdefghijklmnop1234&id=7 now',
    );
    expect(out).toBe('Failed [address] now');
    expectNoLeak(out);
  });

  it('removes protocol-relative addresses and the word undefined', () => {
    const out = redactErrorText(
      'Http failure response for //github.com:undefined/datatug/x.json: 0 Unknown Error',
    );
    expectNoLeak(out);
    expect(out).toContain('[address]');
  });

  it('removes loopback, localhost, private and IPv6 addresses', () => {
    for (const text of [
      'connect ECONNREFUSED 127.0.0.1:50501',
      'GET localhost:6832 failed',
      'host 10.0.3.14 down',
      'host [::1] down',
      'my-box.internal:8080 refused',
    ]) {
      const out = redactErrorText(text);
      expect(out).toContain('[address]');
      expect(out).not.toMatch(/127\.0|localhost|10\.0|::1|internal/);
    }
  });

  it('hides tokens and long secret-looking runs, and drops stack lines', () => {
    const out = redactErrorText(
      'Bearer abc123 secret=hunter2 ' +
        'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8\n    at foo (bar.js:1:2)',
    );
    expect(out).not.toMatch(/abc123|hunter2|A1b2C3|bar\.js/);
  });

  it('keeps the text short', () => {
    expect(redactErrorText('x '.repeat(500)).length).toBeLessThanOrEqual(140);
  });
});

describe('redactErrorText: private text', () => {
  it.each([
    [
      'an email address',
      'user someone.name@example.com is not allowed',
      /someone|example\.com/,
    ],
    [
      'a Unix path',
      "ENOENT: no such file or directory, open '/Users/alex/.acme/projects/x.json'",
      /alex|\.acme|x\.json/,
    ],
    [
      'a Windows path',
      'C:\\Users\\alex\\AppData\\acme\\secret.json not found',
      /alex|AppData|secret\.json/,
    ],
    [
      'a host with a path and query',
      'failed at api.github.com/repos/acme/demo/contents?ref=main',
      /repos|acme|ref=main/,
    ],
    [
      'access_token, api_key and client_secret',
      'access_token=shortsecret123 api_key=abc123 client_secret=xyz',
      /shortsecret|abc123|xyz/,
    ],
    ['a JSON token', '{"token":"abcd1234","message":"bad"}', /abcd1234/],
    ['a short password', 'password: hunter2', /hunter2/],
    [
      'an Authorization token',
      'Authorization: token ghp_abcdefghijklmnop1234567890',
      /ghp_|abcdefghij/,
    ],
    [
      'a JWT',
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      /eyJ|SflKx/,
    ],
    [
      'a fine-grained GitHub token',
      'github_pat_11ABCDEFG0123456789_abcdef',
      /github_pat/,
    ],
    ['a Firebase API key', 'key AIzaSyA-1234567890abcdef', /AIza/],
    [
      'loopback, IPv6 and private addresses',
      'ECONNREFUSED 0.0.0.0:8989 and [::1]:8989 and fe80::1%en0 and 10.0.0.5',
      /0\.0\.0\.0|::1|fe80|10\.0\.0/,
    ],
    [
      'a cluster host in full',
      'connect to mydb.svc.cluster.local failed',
      /mydb|svc|cluster|local/,
    ],
    [
      'a corp host in full',
      'connect to prod-db.corp.example.com failed',
      /prod-db|corp|example/,
    ],
    ['a host:port', 'connect to db.internal:5432', /db\.|5432/],
    [
      'a stack frame in Firefox form',
      'Error: boom\nfoo@https://acme.app/main.js:1:2',
      /acme|main\.js/,
    ],
  ])('hides %s', (_name, input, leak) => {
    const out = redactErrorText(input);
    expect(out).not.toMatch(leak);
  });

  it('keeps a clock time and a date', () => {
    expect(redactErrorText('started at 12:30:45 on 2026-10-22')).toBe(
      'started at 12:30:45 on 2026-10-22',
    );
  });

  it('keeps the readable words around what it hides', () => {
    expect(
      redactErrorText('user someone.name@example.com is not allowed'),
    ).toBe('user [email] is not allowed');
  });

  it.each([
    "TypeError: Cannot read properties of undefined (reading 'id')",
    'Error: [object Object]',
    'value is null',
  ])('returns nothing, not a broken sentence, for %s', (input) => {
    expect(redactErrorText(input)).toBe('');
  });
});

describe('friendlyError', () => {
  it('says "Sign in to see this" for a 401, without the address', () => {
    const e = friendlyError(
      {
        status: 401,
        url: 'https://api.datatug.app/p?token=ghp_abcdefghijklmnop1234',
      },
      'this board',
      'ref12345',
    );
    expect(e.title).toBe('Sign in to see this');
    expect(e.kind).toBe('unauthenticated');
    expect(e.code).toBe('HTTP-401');
    expect(e.reference).toBe('ref12345');
    expect(e.expected).toBe(true);
    expect(e.retryable).toBe(false);
    expectNoLeak(`${e.title} ${e.hint} ${e.detail} ${errorReport(e)}`);
  });

  it('names the service, and says to run `datatug serve`, for a loopback failure', () => {
    const e = friendlyError({
      status: 0,
      url: 'http://127.0.0.1:50501/v1/databases/countries/dtql?key=abc',
      message:
        'Http failure response for http://127.0.0.1:50501/v1: 0 Unknown Error',
    });
    expect(e.title).toBe("Can't reach the local DataTug agent");
    expect(e.hint).toContain('datatug serve');
    expect(e.retryable).toBe(true);
    expectNoLeak(`${e.title} ${e.hint} ${e.detail}`);
  });

  it('words the raw GitHub toast plainly', () => {
    const e = friendlyError({
      status: 0,
      url: '//github.com:undefined/datatug/x',
      message:
        'Http failure response for //github.com:undefined/datatug/x: 0 Unknown Error',
    });
    expect(e.title).toBe("Can't reach GitHub");
    expectNoLeak(`${e.title} ${e.hint} ${e.detail}`);
  });

  it('recognises the anonymous GitHub rate limit', () => {
    const e = friendlyError(
      new Error('GitHub API rate limit reached for this browser — please wait'),
    );
    expect(e.kind).toBe('rate-limit');
    expect(e.code).toBe('RATE-LIMIT');
    expect(e.retryable).toBe(true);
  });

  it('maps 403, 404, timeout and 5xx', () => {
    expect(friendlyError({ status: 403 }).title).toBe("You don't have access");
    expect(friendlyError({ status: 404 }, 'this board').title).toBe(
      'Not found',
    );
    expect(friendlyError(new Error('Request timed out')).kind).toBe('timeout');
    expect(friendlyError({ status: 503 }).code).toBe('HTTP-503');
  });

  it('treats a routing miss as expected and an unknown error as a crash', () => {
    expect(
      isExpectedError(
        new Error("NG04002: Cannot match any routes. URL Segment: 'nope'"),
      ),
    ).toBe(true);
    const unknown = friendlyError(
      new TypeError('x is not a function at https://datatug.app/main.js?v=1'),
    );
    expect(unknown.kind).toBe('unknown');
    expect(unknown.expected).toBe(false);
    expect(unknown.title).toBe('Something went wrong');
    expect(unknown.detail).not.toMatch(/https?:|main\.js/);
    expect(unknown.hint).not.toMatch(/reference/i);
    expect(isExpectedError(new TypeError('boom'))).toBe(false);
  });

  it('gives each occurrence a short reference', () => {
    expect(friendlyError(new Error('a')).reference).toMatch(/^[0-9a-f]{8}$/);
  });

  it('treats a missing sign-in token as "sign in", not an unknown failure', () => {
    const f = friendlyError(
      'User is not authenticated yet - no Firebase ID token',
      'the environments',
    );
    expect(f.kind).toBe('unauthenticated');
    expect(f.title).toBe('Sign in to see this');
  });

  it('classifies by the error code as well as the message', () => {
    const code = (c: string, message = 'x') =>
      friendlyError(Object.assign(new Error(message), { code: c }));
    expect(code('auth/network-request-failed', 'Firebase: Error').kind).toBe(
      'offline',
    );
    expect(code('permission-denied').kind).toBe('forbidden');
    expect(code('unauthenticated').kind).toBe('unauthenticated');
    expect(code('unavailable').kind).toBe('offline');
    expect(code('deadline-exceeded').kind).toBe('timeout');
    expect(code('resource-exhausted').kind).toBe('rate-limit');
    expect(code('auth/network-request-failed').expected).toBe(true);
  });

  it('treats a 4xx status as expected and not retryable', () => {
    for (const status of [400, 409, 422]) {
      const e = friendlyError({ status });
      expect(e.kind).toBe('invalid');
      expect(e.expected).toBe(true);
      expect(e.retryable).toBe(false);
      expect(e.report).toBe('warning');
    }
  });

  it('reports outages as warnings, a crash as an error, a visitor situation not at all', () => {
    expect(reportLevelOf({ status: 503 })).toBe('warning');
    expect(reportLevelOf(new Error('Request timed out'))).toBe('warning');
    expect(reportLevelOf({ status: 0 })).toBe('warning');
    expect(reportLevelOf(new TypeError('boom'))).toBe('error');
    expect(reportLevelOf({ status: 404 })).toBe('none');
    expect(reportLevelOf({ status: 401 })).toBe('none');
  });

  it('names page-level failures that belong on the page, not in a toast', () => {
    expect(isPageLevelError({ status: 404 })).toBe(true);
    expect(isPageLevelError({ status: 401 })).toBe(true);
    expect(isPageLevelError(new Error('GitHub API rate limit reached'))).toBe(
      true,
    );
    expect(isPageLevelError({ status: 503 })).toBe(false);
  });

  it('gives one reference per error, and shows it only once reported', () => {
    const error = new TypeError('boom');
    const first = friendlyError(error);
    const second = friendlyError(error);
    expect(second.reference).toBe(first.reference);
    expect(referenceFor(error)).toBe(first.reference);
    expect(first.reported).toBe(false);
    expect(first.hint).not.toMatch(/reference/i);
    expect(errorReport(first)).not.toMatch(/Reference/);
    markReported(error);
    const shown = friendlyError(error);
    expect(shown.reported).toBe(true);
    expect(shown.hint).toMatch(/reference/i);
    expect(errorReport(shown)).toContain(`Reference: ${first.reference}`);
  });
});
