import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { DatatugApiService } from '../../../services/base/datatug-api.service';
import { QueryType, type IHttpQueryRequest } from '../../../models/definition/query-def';
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
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', { status: 201, statusText: 'Created', headers: { 'x-a': 'b' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await service.runViaBrowser(request);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(request.url);
    expect(init.method).toBe('POST');
    expect((init.headers as Headers).get('authorization')).toBe('Bearer t');
    expect(init.body).toBe('{"q":1}');
    expect(result).toMatchObject({ via: 'browser', status: 201, bodyText: '{"ok":true}', sizeBytes: 11 });
    expect(result.headers).toContainEqual({ name: 'x-a', value: 'b' });
  });

  it('browser run sends no body for GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('x'));
    vi.stubGlobal('fetch', fetchMock);
    await service.runViaBrowser({ ...request, method: 'GET' });
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it('maps a fetch TypeError to BrowserFetchFailedError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(service.runViaBrowser(request)).rejects.toBeInstanceOf(BrowserFetchFailedError);
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
    expect(result).toMatchObject({ via: 'server', bodyText: 'hello', truncated: true, sizeBytes: 5, durationMs: 7 });
  });

  it('server run leaves a binary base64 body undecoded', async () => {
    post.mockReturnValue(of({ status: 200, body: btoa('\xff\xfe'), bodyEncoding: 'base64' }));
    const result = await service.runViaServer(request);
    expect(result.bodyText).toBeUndefined();
    expect(result.sizeBytes).toBe(2);
  });

  it('server run surfaces the error envelope message', async () => {
    post.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { error: { message: 'blocked target' } } })),
    );
    await expect(service.runViaServer(request)).rejects.toThrow(ServerRunFailedError);
    await expect(service.runViaServer(request)).rejects.toThrow('blocked target');
  });
});
