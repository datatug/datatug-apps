import { describe, expect, it } from 'vitest';
import {
  errorReport,
  friendlyError,
  isExpectedError,
  redactErrorText,
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
    expect(isExpectedError(new TypeError('boom'))).toBe(false);
  });

  it('gives each occurrence a short reference', () => {
    expect(friendlyError(new Error('a')).reference).toMatch(/^[0-9a-f]{8}$/);
  });
});
