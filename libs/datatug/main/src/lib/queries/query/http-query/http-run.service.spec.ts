import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { DatatugApiService } from '../../../services/base/datatug-api.service';
import {
  QueryType,
  type IHttpQueryRequest,
} from '../../../models/definition/query-def';
import {
  BrowserFetchFailedError,
  HttpRunService,
  ServerRunFailedError,
} from './http-run.service';

const request: IHttpQueryRequest = {
  queryType: QueryType.HTTP,
  url: 'https://api.example.com/x',
  method: 'POST',
  headers: [
    { name: 'Authorization', value: 'Bearer t' },
    { name: ' ', value: 'skipped' },
  ],
  body: '{"q":1}',
};

describe('HttpRunService', () => {
  const post = vi.fn();
  let service: HttpRunService;

  beforeEach(() => {
    post.mockReset();
    TestBed.configureTestingModule({
      providers: [{ provide: DatatugApiService, useValue: { post } }],
    });
    service = TestBed.inject(HttpRunService);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('browser run sends method, headers (including credentials) and body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('{"ok":true}', {
          status: 201,
          statusText: 'Created',
          headers: { 'x-a': 'b' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const result = await service.runViaBrowser(request);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(request.url);
    expect(init.method).toBe('POST');
    expect((init.headers as Headers).get('authorization')).toBe('Bearer t');
    expect(init.body).toBe('{"q":1}');
    expect(result).toMatchObject({
      via: 'browser',
      status: 201,
      bodyText: '{"ok":true}',
      sizeBytes: 11,
    });
    expect(result.headers).toContainEqual({ name: 'x-a', value: 'b' });
  });

  it('browser run sends no body for GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('x'));
    vi.stubGlobal('fetch', fetchMock);
    await service.runViaBrowser({ ...request, method: 'GET' });
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'browser run sends no body for %s',
    async (method) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('x'));
      vi.stubGlobal('fetch', fetchMock);
      await service.runViaBrowser({ ...request, method: method as 'GET' });
      expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    },
  );

  it('server run sends an empty body for OPTIONS and the body for DELETE', async () => {
    post.mockReturnValue(of({ status: 200 }));
    await service.runViaServer({ ...request, method: 'OPTIONS' });
    expect(post.mock.calls[0][1].body).toBe('');
    await service.runViaServer({ ...request, method: 'DELETE' });
    expect(post.mock.calls[1][1].body).toBe('{"q":1}');
  });

  it.each(['', '/relative', 'api.example.com/x', 'ftp://x.test'])(
    'refuses to run %j and never calls fetch or the server',
    async (url) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        service.runViaBrowser({ ...request, url }),
      ).rejects.toBeInstanceOf(ServerRunFailedError);
      await expect(
        service.runViaServer({ ...request, url }),
      ).rejects.toBeInstanceOf(ServerRunFailedError);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    },
  );

  it('maps a mid-body failure to BrowserFetchFailedError so the server run is offered', async () => {
    const broken = {
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      arrayBuffer: () => Promise.reject(new TypeError('network error')),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(broken));
    await expect(service.runViaBrowser(request)).rejects.toBeInstanceOf(
      BrowserFetchFailedError,
    );
  });

  it('maps a fetch TypeError to BrowserFetchFailedError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    await expect(service.runViaBrowser(request)).rejects.toBeInstanceOf(
      BrowserFetchFailedError,
    );
  });

  it('server run posts the contract request and decodes a base64 text body', async () => {
    post.mockReturnValue(
      of({
        status: 200,
        statusText: 'OK',
        headers: [{ name: 'content-type', value: 'text/plain' }],
        body: btoa('hello'),
        bodyEncoding: 'base64',
        truncated: true,
        sizeBytes: 5,
        durationMs: 7,
      }),
    );
    const result = await service.runViaServer(request);
    expect(post).toHaveBeenCalledWith('datatug/http/run', {
      method: 'POST',
      url: request.url,
      headers: [{ name: 'Authorization', value: 'Bearer t' }],
      body: '{"q":1}',
    });
    expect(result).toMatchObject({
      via: 'server',
      bodyText: 'hello',
      truncated: true,
      sizeBytes: 5,
      durationMs: 7,
    });
  });

  it('server run leaves a binary base64 body undecoded', async () => {
    post.mockReturnValue(
      of({ status: 200, body: btoa('\xff\xfe'), bodyEncoding: 'base64' }),
    );
    const result = await service.runViaServer(request);
    expect(result.bodyText).toBeUndefined();
    expect(result.sizeBytes).toBe(2);
  });

  it('server run surfaces the error envelope message', async () => {
    post.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { error: { message: 'blocked target' } },
          }),
      ),
    );
    await expect(service.runViaServer(request)).rejects.toThrow(
      ServerRunFailedError,
    );
    await expect(service.runViaServer(request)).rejects.toThrow(
      'blocked target',
    );
  });

  describe('parameterised runs (http-query-parameters)', () => {
    const tmplRequest: IHttpQueryRequest = {
      queryType: QueryType.HTTP,
      url: 'https://carrier.demodb.dev/v1/bookings?request_id={request_id}',
      method: 'GET',
      headers: [{ name: 'Authorization', value: 'Bearer {token}' }],
    };
    const template = {
      parameters: [
        { id: 'request_id', type: 'string', isRequired: true },
        { id: 'token', type: 'string', isRequired: true, isCredential: true },
        { id: 'unused_cred', type: 'string', isRequired: true, isCredential: true },
      ],
      values: { request_id: 'request 11038', token: 's3', unused_cred: 'x' },
      record: [{ id: 'request_id', source: 'row' as const, value: 'request 11038' }, { id: 'token', source: 'typed' as const }],
    };

    it('substitutes in the browser and keeps the redacted record', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      const result = await service.run(tmplRequest, 'browser', template);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://carrier.demodb.dev/v1/bookings?request_id=request+11038');
      expect((init.headers as Headers).get('authorization')).toBe('Bearer s3');
      expect(result.parameters).toEqual(template.record);
    });

    it('sends the template and used parameters to the server (template mode)', async () => {
      post.mockReturnValue(of({ status: 200, body: '' }));
      await service.run(tmplRequest, 'server', template);
      const [path, payload] = post.mock.calls[0];
      expect(path).toBe('datatug/http/run');
      expect(payload).toEqual({
        method: 'GET',
        url: tmplRequest.url,
        headers: [{ name: 'Authorization', value: 'Bearer {token}' }],
        body: '',
        parameters: [
          { id: 'request_id', type: 'string', value: 'request 11038' },
          { id: 'token', type: 'string', value: 's3' },
        ],
      });
    });

    it('fails before sending when substitution fails', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        service.run({ ...tmplRequest, url: 'http://{request_id}/' }, 'browser', template),
      ).rejects.toBeInstanceOf(ServerRunFailedError);
      await expect(
        service.run({ ...tmplRequest, url: 'http://{request_id}/' }, 'server', template),
      ).rejects.toBeInstanceOf(ServerRunFailedError);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    });
  });
});
