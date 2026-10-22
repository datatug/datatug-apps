import {
  CREDENTIAL_HEADER_FRAGMENTS,
  CREDENTIAL_HEADER_NAMES,
} from './http-credential-headers';
import {
  MAX_HTTP_HEADERS,
  httpMethodAllowsBody,
  httpRequestSaveProblem,
  isAbsoluteHttpUrl,
  isBrowserForbiddenHeader,
  isHttpToken,
} from './http-request-rules';

describe('UI credential list equals the core list', () => {
  // Copied from datatug-core pkg/datatug/query_http.go `IsCredentialHTTPHeader`.
  // Update both together: this test fails when the lists drift.
  const CORE_NAMES = [
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
    'x-access-token',
    'x-amz-security-token',
  ];
  const CORE_FRAGMENTS = ['token', 'secret', 'password', 'api-key', 'apikey'];

  it('has the same exact names', () =>
    expect([...CREDENTIAL_HEADER_NAMES].sort()).toEqual(
      [...CORE_NAMES].sort(),
    ));
  it('has the same name fragments', () =>
    expect([...CREDENTIAL_HEADER_FRAGMENTS].sort()).toEqual(
      [...CORE_FRAGMENTS].sort(),
    ));
});

describe('http request rules', () => {
  it.each([
    ['POST', true],
    ['put', true],
    ['PATCH', true],
    ['DELETE', true],
    ['GET', false],
    ['HEAD', false],
    ['OPTIONS', false],
    [undefined, false],
  ])('method %s allows body: %s', (m, expected) =>
    expect(httpMethodAllowsBody(m)).toBe(expected),
  );

  it('recognises RFC 7230 tokens', () => {
    expect(isHttpToken('X-Request-Id')).toBe(true);
    expect(isHttpToken("a!#$%&'*+-.^_`|~9")).toBe(true);
    for (const bad of ['', 'Bad Name', 'a:b', 'a/b', 'é', 'a\tb'])
      expect(isHttpToken(bad)).toBe(false);
  });

  it('reports invalid header names and too many headers', () => {
    expect(
      httpRequestSaveProblem({
        headers: [
          { name: ' Accept ', value: '' },
          { name: '', value: '' },
        ],
      }),
    ).toBeUndefined();
    expect(
      httpRequestSaveProblem({ headers: [{ name: 'a b', value: '' }] }),
    ).toContain('"a b"');
    const many = Array.from({ length: MAX_HTTP_HEADERS + 1 }, (_, i) => ({
      name: `X-${i}`,
      value: '',
    }));
    expect(httpRequestSaveProblem({ headers: many })).toContain('50');
    expect(
      httpRequestSaveProblem({ headers: many.slice(0, MAX_HTTP_HEADERS) }),
    ).toBeUndefined();
  });

  it('accepts only absolute http(s) URLs', () => {
    expect(isAbsoluteHttpUrl('https://api.example.com/x?y=1')).toBe(true);
    expect(isAbsoluteHttpUrl(' http://localhost:8080 ')).toBe(true);
    for (const bad of [
      '',
      '/relative',
      'api.example.com',
      'ftp://x.test',
      'javascript:alert(1)',
      'https://',
      '//x.test',
    ])
      expect(isAbsoluteHttpUrl(bad)).toBe(false);
  });

  it.each([
    'Cookie',
    'host',
    'Content-Length',
    'Connection',
    'Origin',
    'Referer',
    'Sec-Fetch-Mode',
    'Proxy-Authorization',
    'Accept-Encoding',
  ])('flags %s as forbidden in browsers', (name) =>
    expect(isBrowserForbiddenHeader(name)).toBe(true),
  );
  it.each(['Accept', 'Authorization', 'X-Request-Id'])(
    'allows %s in browsers',
    (name) => expect(isBrowserForbiddenHeader(name)).toBe(false),
  );
});
