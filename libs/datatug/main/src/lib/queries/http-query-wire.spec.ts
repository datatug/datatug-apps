import {
  QueryType,
  type IHttpQueryRequest,
  type IQueryDef,
} from '../models/definition/query-def';
import {
  isCredentialHttpHeader,
  savableHttpHeaders,
} from './http-credential-headers';
import {
  fromProjectQueryWire,
  toProjectQueryWire,
  type ProjectQueryReadWire,
} from './project-query-contract';
import { isQueryChanged } from './query-editor-state-service';

function httpDef(request: Partial<IHttpQueryRequest>): IQueryDef {
  return {
    id: 'github-repo',
    title: 'GitHub repo',
    request: {
      queryType: QueryType.HTTP,
      url: 'https://api.github.com/repos/datatug/datatug',
      method: 'GET',
      ...request,
    } as IHttpQueryRequest,
  };
}

describe('isCredentialHttpHeader', () => {
  it.each([
    'Authorization',
    'proxy-authorization',
    'COOKIE',
    'Set-Cookie',
    'X-API-Key',
    'x-auth-token',
    'X-Access-Token',
    'X-Amz-Security-Token',
    'X-CSRF-Token',
    'X-Client-Secret',
    'X-Password',
    'Api-Key',
    'X-ApiKey',
  ])('flags %s', (name) => expect(isCredentialHttpHeader(name)).toBe(true));

  it.each(['Accept', 'Content-Type', 'User-Agent', 'X-Request-Id'])(
    'allows %s',
    (name) => expect(isCredentialHttpHeader(name)).toBe(false),
  );

  it('keeps only named, non-credential headers when saving', () => {
    expect(
      savableHttpHeaders([
        { name: 'Accept', value: 'a' },
        { name: 'Authorization', value: 'Bearer x' },
        { name: '  ', value: 'blank' },
      ]),
    ).toEqual([{ name: 'Accept', value: 'a' }]);
  });
});

describe('HTTP query wire mapping', () => {
  it('maps url to text and method/headers/body to http', () => {
    const wire = toProjectQueryWire(
      httpDef({
        method: 'POST',
        headers: [{ name: 'Accept', value: 'application/json' }],
        body: '{"q":1}',
      }),
    );
    expect(wire.type).toBe(QueryType.HTTP);
    expect(wire.text).toBe('https://api.github.com/repos/datatug/datatug');
    expect(wire.http).toEqual({
      method: 'POST',
      headers: [{ name: 'Accept', value: 'application/json' }],
      body: '{"q":1}',
    });
  });

  it('strips credential headers so they are never sent on save', () => {
    const wire = toProjectQueryWire(
      httpDef({
        headers: [
          { name: 'Authorization', value: 'Bearer secret' },
          { name: 'Accept', value: '*/*' },
          { name: 'X-API-Key', value: 'k' },
        ],
      }),
    );
    expect(wire.http?.headers).toEqual([{ name: 'Accept', value: '*/*' }]);
    expect(JSON.stringify(wire)).not.toContain('secret');
  });

  it('omits empty headers and body', () => {
    const wire = toProjectQueryWire(
      httpDef({ headers: [{ name: 'Authorization', value: 'x' }] }),
    );
    expect(wire.http).toEqual({ method: 'GET' });
  });

  it('round-trips through the wire', () => {
    const def = httpDef({
      method: 'PUT',
      headers: [{ name: 'Accept', value: 'a' }],
      body: 'b',
    });
    const wire = toProjectQueryWire(def) as unknown as ProjectQueryReadWire;
    const read = fromProjectQueryWire(wire);
    expect(read.request).toEqual(def.request);
    expect(read).not.toHaveProperty('http');
  });

  it('loads a legacy text-only HTTP query as GET', () => {
    const read = fromProjectQueryWire({
      folderPath: '~',
      id: 'old',
      type: QueryType.HTTP,
      text: 'https://example.com/x',
    });
    expect(read.request).toEqual({
      queryType: QueryType.HTTP,
      url: 'https://example.com/x',
      method: 'GET',
    });
  });
});

describe('HTTP query change detection', () => {
  const state = (request: IHttpQueryRequest, saved = httpDef({})) =>
    ({
      id: 'q',
      title: saved.title,
      queryType: QueryType.HTTP,
      request,
      def: saved,
    }) as unknown as Parameters<typeof isQueryChanged>[0];
  const base = httpDef({}).request as IHttpQueryRequest;

  it('is unchanged for the same request', () => {
    expect(isQueryChanged(state({ ...base }))).toBe(false);
  });

  it.each([
    ['url', { url: 'https://x.test' }],
    ['method', { method: 'POST' as const }],
    ['body', { body: 'x' }],
    ['header', { headers: [{ name: 'Accept', value: 'a' }] }],
  ])('detects a %s edit', (_, patch) => {
    expect(isQueryChanged(state({ ...base, ...patch }))).toBe(true);
  });

  it('ignores unsaved credential headers and blank rows', () => {
    expect(
      isQueryChanged(
        state({
          ...base,
          headers: [
            { name: 'Authorization', value: 'Bearer x' },
            { name: '', value: '' },
          ],
        }),
      ),
    ).toBe(false);
  });
});
