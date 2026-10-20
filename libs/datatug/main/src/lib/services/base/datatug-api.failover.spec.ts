import {
  HttpErrorResponse,
  HttpHandler,
  HttpRequest,
  provideHttpClient,
} from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SneatApiAuthTokenBridge, SneatApiBaseUrl } from '@sneat/api';
import { AnalyticsService, LOGGER_FACTORY } from '@sneat/core';
import {
  DEFAULT_DATATUG_API_FAILOVER_CONFIG,
  DatatugApiBaseUrl,
  DatatugApiBaseUrls,
  DatatugApiFailoverConfig,
} from '@sneat/datatug-semantic';
import { TimeoutError, firstValueFrom, lastValueFrom } from 'rxjs';
import { DatatugApiService } from './datatug-api.service';
import {
  DatatugApiFailoverHttpClient,
  datatugApiFailoverReason,
  type DatatugApiFailoverLog,
} from './datatug-api-failover.http-client';

const primary = 'https://api.datatug.test/v0/';
const fallback = 'https://api2.datatug.test/v0/';
const minute = 60_000;

function configure(providers: Provider[] = []): HttpTestingController {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: DatatugApiBaseUrls, useValue: [primary, fallback] },
      ...providers,
    ],
  });
  TestBed.inject(SneatApiAuthTokenBridge).setExplicitToken('token');
  return TestBed.inject(HttpTestingController);
}

function fail(request: TestRequest, status: number): void {
  if (status === 0) {
    request.error(new ProgressEvent('error'));
  } else {
    request.flush({ error: 'x' }, { status, statusText: 'Failure' });
  }
}

/** Settles a pending promise's rejection so a test can assert it later. */
function settle<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
}

describe('DatatugApiService failover', () => {
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Without a LOGGER_FACTORY the default logger writes to console.warn.
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleWarn.mockRestore();
  });

  describe('GET', () => {
    it.each([0, 502, 503, 504, 520, 521, 522, 523, 525, 526])(
      'retries on the fallback after status %i and returns its answer',
      async (status) => {
        const http = configure();
        const result = firstValueFrom(
          TestBed.inject(DatatugApiService).get<{ ok: boolean }>('datatug/ping'),
        );
        fail(http.expectOne(primary + 'datatug/ping'), status);
        http.expectOne(fallback + 'datatug/ping').flush({ ok: true });
        await expect(result).resolves.toEqual({ ok: true });
        http.verify();
      },
    );

    it.each([524, 500, 400, 403, 404, 409])(
      'does not retry after status %i and surfaces it',
      async (status) => {
        const http = configure();
        const result = settle(
          firstValueFrom(TestBed.inject(DatatugApiService).get('datatug/ping')),
        );
        fail(http.expectOne(primary + 'datatug/ping'), status);
        const outcome = await result;
        expect((outcome as { error: HttpErrorResponse }).error.status).toBe(status);
        http.verify();
      },
    );

    it('sends the same Authorization header, params and path to the fallback', async () => {
      const http = configure();
      const result = firstValueFrom(
        TestBed.inject(DatatugApiService).get(
          'datatug/projects/get_project',
          undefined,
          { params: { project: 'p' } as never },
        ),
      );
      const first = http.expectOne((r) => r.url === primary + 'datatug/projects/get_project');
      expect(first.request.headers.get('Authorization')).toBe('Bearer token');
      fail(first, 503);
      const second = http.expectOne((r) => r.url === fallback + 'datatug/projects/get_project');
      expect(second.request.headers.get('Authorization')).toBe('Bearer token');
      expect(second.request.params.get('project')).toBe('p');
      second.flush({});
      await result;
      http.verify();
    });

    it('uses the refreshed token on the fallback after a 401 refresh', async () => {
      const http = configure();
      const result = firstValueFrom(TestBed.inject(DatatugApiService).get('datatug/ping'));
      // 401 is an answer from the primary: no failover, SneatApiService refreshes and repeats.
      http.expectOne(primary + 'datatug/ping').flush({}, { status: 401, statusText: 'Unauthorized' });
      const refreshed = http.expectOne(primary + 'datatug/ping');
      expect(refreshed.request.headers.get('Authorization')).toBe('Bearer token');
      refreshed.flush({ ok: true });
      await expect(result).resolves.toEqual({ ok: true });
      http.verify();
    });

    it('surfaces the last error and keeps the primary when every base URL fails', async () => {
      const http = configure();
      const api = TestBed.inject(DatatugApiService);
      const result = settle(firstValueFrom(api.get('datatug/ping')));
      fail(http.expectOne(primary + 'datatug/ping'), 503);
      fail(http.expectOne(fallback + 'datatug/ping'), 502);
      const outcome = await result;
      expect((outcome as { error: HttpErrorResponse }).error.status).toBe(502);
      // Nothing answered, so no breaker: the next request starts on the primary again.
      void settle(firstValueFrom(api.get('datatug/ping')));
      http.expectOne(primary + 'datatug/ping').flush({});
      http.verify();
    });

    it('also fails over HEAD-like idempotent reads of getAsAnonymous', async () => {
      const http = configure();
      const result = firstValueFrom(
        TestBed.inject(DatatugApiService).getAsAnonymous('datatug/public'),
      );
      fail(http.expectOne(primary + 'datatug/public'), 0);
      http.expectOne(fallback + 'datatug/public').flush({ ok: 1 });
      await expect(result).resolves.toEqual({ ok: 1 });
      http.verify();
    });
  });

  describe('non-idempotent requests', () => {
    const methods: [string, (api: DatatugApiService) => unknown][] = [
      ['POST', (api) => api.post('datatug/detective/action', { a: 1 })],
      ['PUT', (api) => api.put('datatug/detective/action', { a: 1 })],
      ['DELETE', (api) => api.delete('datatug/detective/action')],
    ];

    it.each(methods.flatMap(([m, call]) => [0, 521, 522, 523].map((s) => [m, call, s] as const)))(
      'retries %s on the fallback after status %i (never reached the server)',
      async (method, call, status) => {
        const http = configure();
        const result = firstValueFrom(
          call(TestBed.inject(DatatugApiService)) as ReturnType<DatatugApiService['post']>,
        );
        const first = http.expectOne(primary + 'datatug/detective/action');
        expect(first.request.method).toBe(method);
        fail(first, status);
        const second = http.expectOne(fallback + 'datatug/detective/action');
        expect(second.request.method).toBe(method);
        expect(second.request.headers.get('Authorization')).toBe('Bearer token');
        second.flush({ done: true });
        await expect(result).resolves.toEqual({ done: true });
        http.verify();
      },
    );

    it.each(
      methods.flatMap(([m, call]) =>
        [524, 500, 502, 503, 504, 520, 525, 526, 400, 401, 403, 404, 409, 422].map(
          (s) => [m, call, s] as const,
        ),
      ),
    )('never retries %s after status %i', async (_method, call, status) => {
      const http = configure();
      const result = settle(
        firstValueFrom(call(TestBed.inject(DatatugApiService)) as ReturnType<DatatugApiService['post']>),
      );
      fail(http.expectOne(primary + 'datatug/detective/action'), status);
      const outcome = await result;
      expect((outcome as { error: HttpErrorResponse }).error.status).toBe(status);
      http.verify();
    });

    it('resends the same body to the fallback', async () => {
      const http = configure();
      const result = firstValueFrom(
        TestBed.inject(DatatugApiService).post('datatug/projects/create_project', { name: 'n' }),
      );
      fail(http.expectOne(primary + 'datatug/projects/create_project'), 522);
      const second = http.expectOne(fallback + 'datatug/projects/create_project');
      expect(second.request.body).toEqual({ name: 'n' });
      second.flush({});
      await result;
    });

    it('does not time out, so a long-running call is never cut', async () => {
      vi.useFakeTimers();
      const http = configure();
      const result = settle(
        firstValueFrom(TestBed.inject(DatatugApiService).post('datatug/queries/run_query', {})),
      );
      const pending = http.expectOne(primary + 'datatug/queries/run_query');
      await vi.advanceTimersByTimeAsync(30 * minute);
      http.expectNone(fallback + 'datatug/queries/run_query');
      pending.flush({ rows: [] });
      expect(await result).toEqual({ value: { rows: [] } });
    });
  });

  describe('circuit breaker', () => {
    async function failOver(
      http: HttpTestingController,
      api: DatatugApiService,
    ): Promise<void> {
      const result = firstValueFrom(api.get('datatug/ping'));
      fail(http.expectOne(primary + 'datatug/ping'), 503);
      http.expectOne(fallback + 'datatug/ping').flush({});
      await result;
    }

    it('holds the fallback for 5 minutes without touching the primary', async () => {
      vi.useFakeTimers();
      const http = configure();
      const api = TestBed.inject(DatatugApiService);
      await failOver(http, api);

      await vi.advanceTimersByTimeAsync(5 * minute - 1);
      const get = firstValueFrom(api.get('datatug/ping'));
      http.expectOne(fallback + 'datatug/ping').flush({});
      await get;
      const post = firstValueFrom(api.post('datatug/detective/action', {}));
      http.expectOne(fallback + 'datatug/detective/action').flush({});
      await post;
      http.verify();
    });

    it('probes the primary with the next GET after the hold and switches back on success', async () => {
      vi.useFakeTimers();
      const http = configure();
      const api = TestBed.inject(DatatugApiService);
      await failOver(http, api);

      await vi.advanceTimersByTimeAsync(5 * minute);
      const probe = firstValueFrom(api.get('datatug/ping'));
      http.expectOne(primary + 'datatug/ping').flush({ from: 'primary' });
      await expect(probe).resolves.toEqual({ from: 'primary' });

      // Back on the primary, no more holding.
      const after = firstValueFrom(api.post('datatug/detective/action', {}));
      http.expectOne(primary + 'datatug/detective/action').flush({});
      await after;
      http.verify();
    });

    it('stays on the fallback and restarts the hold when the probe fails', async () => {
      vi.useFakeTimers();
      const http = configure();
      const api = TestBed.inject(DatatugApiService);
      await failOver(http, api);

      await vi.advanceTimersByTimeAsync(5 * minute);
      const probe = firstValueFrom(api.get('datatug/ping'));
      fail(http.expectOne(primary + 'datatug/ping'), 0);
      http.expectOne(fallback + 'datatug/ping').flush({ from: 'fallback' });
      await expect(probe).resolves.toEqual({ from: 'fallback' });

      await vi.advanceTimersByTimeAsync(5 * minute - 1);
      const held = firstValueFrom(api.get('datatug/ping'));
      http.expectOne(fallback + 'datatug/ping').flush({});
      await held;
      http.verify();
    });

    it('does not probe the primary with a non-idempotent request after the hold', async () => {
      vi.useFakeTimers();
      const http = configure();
      const api = TestBed.inject(DatatugApiService);
      await failOver(http, api);

      await vi.advanceTimersByTimeAsync(10 * minute);
      const post = firstValueFrom(api.post('datatug/detective/action', {}));
      http.expectOne(fallback + 'datatug/detective/action').flush({});
      await post;
      http.verify();
    });

    it('goes back to the primary when the held fallback itself fails', async () => {
      vi.useFakeTimers();
      const http = configure();
      const api = TestBed.inject(DatatugApiService);
      await failOver(http, api);

      const post = firstValueFrom(api.post('datatug/detective/action', {}));
      fail(http.expectOne(fallback + 'datatug/detective/action'), 522);
      http.expectOne(primary + 'datatug/detective/action').flush({ ok: 1 });
      await expect(post).resolves.toEqual({ ok: 1 });

      const next = firstValueFrom(api.post('datatug/detective/action', {}));
      http.expectOne(primary + 'datatug/detective/action').flush({});
      await next;
      http.verify();
    });

    it('honours a configured breaker length', async () => {
      vi.useFakeTimers();
      const http = configure([
        {
          provide: DatatugApiFailoverConfig,
          useValue: { ...DEFAULT_DATATUG_API_FAILOVER_CONFIG, breakerMinutes: 1 },
        },
      ]);
      const api = TestBed.inject(DatatugApiService);
      await failOver(http, api);
      await vi.advanceTimersByTimeAsync(minute);
      const probe = firstValueFrom(api.get('datatug/ping'));
      http.expectOne(primary + 'datatug/ping').flush({});
      await probe;
      http.verify();
    });
  });

  describe('timeout', () => {
    it('abandons a hung primary GET after 8s and retries on the fallback', async () => {
      vi.useFakeTimers();
      const http = configure();
      const result = firstValueFrom(TestBed.inject(DatatugApiService).get('datatug/ping'));
      const hung = http.expectOne(primary + 'datatug/ping');
      await vi.advanceTimersByTimeAsync(7_999);
      expect(hung.cancelled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(hung.cancelled).toBe(true);
      http.expectOne(fallback + 'datatug/ping').flush({ ok: true });
      await expect(result).resolves.toEqual({ ok: true });
    });

    it('never times out the last base URL', async () => {
      vi.useFakeTimers();
      const http = configure();
      const api = TestBed.inject(DatatugApiService);
      const result = firstValueFrom(api.get('datatug/ping'));
      http.expectOne(primary + 'datatug/ping');
      await vi.advanceTimersByTimeAsync(8_000);
      const last = http.expectOne(fallback + 'datatug/ping');
      await vi.advanceTimersByTimeAsync(10 * minute);
      expect(last.cancelled).toBe(false);
      last.flush({ slow: true });
      await expect(result).resolves.toEqual({ slow: true });
    });

    it('gives known slow GET endpoints a longer allowance', async () => {
      vi.useFakeTimers();
      const http = configure();
      const result = firstValueFrom(
        TestBed.inject(DatatugApiService).get('datatug/projects/query_activity_context'),
      );
      const slow = http.expectOne(primary + 'datatug/projects/query_activity_context');
      await vi.advanceTimersByTimeAsync(59_999);
      expect(slow.cancelled).toBe(false);
      slow.flush({ done: true });
      await expect(result).resolves.toEqual({ done: true });
    });

    it('can be disabled with primaryTimeoutMs 0', async () => {
      vi.useFakeTimers();
      const http = configure([
        {
          provide: DatatugApiFailoverConfig,
          useValue: { ...DEFAULT_DATATUG_API_FAILOVER_CONFIG, primaryTimeoutMs: 0 },
        },
      ]);
      const result = firstValueFrom(TestBed.inject(DatatugApiService).get('datatug/ping'));
      const pending = http.expectOne(primary + 'datatug/ping');
      await vi.advanceTimersByTimeAsync(10 * minute);
      expect(pending.cancelled).toBe(false);
      pending.flush({});
      await result;
    });
  });

  describe('configuration', () => {
    it('with one URL behaves exactly as before: no failover', async () => {
      const http = configure([{ provide: DatatugApiBaseUrls, useValue: [primary] }]);
      const result = settle(firstValueFrom(TestBed.inject(DatatugApiService).get('datatug/ping')));
      fail(http.expectOne(primary + 'datatug/ping'), 503);
      expect(((await result) as { error: HttpErrorResponse }).error.status).toBe(503);
      http.verify();
    });

    it('with one URL does not retry a POST on status 0 either', async () => {
      const http = configure([{ provide: DatatugApiBaseUrls, useValue: [primary] }]);
      const result = settle(
        firstValueFrom(TestBed.inject(DatatugApiService).post('datatug/x', {})),
      );
      fail(http.expectOne(primary + 'datatug/x'), 0);
      expect(((await result) as { error: HttpErrorResponse }).error.status).toBe(0);
      http.verify();
    });

    it('without DatatugApiBaseUrls follows DatatugApiBaseUrl', async () => {
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: SneatApiBaseUrl, useValue: 'https://sneat.test/v0/' },
          { provide: DatatugApiBaseUrl, useValue: primary },
        ],
      });
      TestBed.inject(SneatApiAuthTokenBridge).setExplicitToken('token');
      const http = TestBed.inject(HttpTestingController);
      const result = settle(firstValueFrom(TestBed.inject(DatatugApiService).get('datatug/ping')));
      fail(http.expectOne(primary + 'datatug/ping'), 502);
      await result;
      http.verify();
    });

    it('an empty list falls back to DatatugApiBaseUrl', async () => {
      const http = configure([
        { provide: DatatugApiBaseUrls, useValue: [] },
        { provide: DatatugApiBaseUrl, useValue: primary },
      ]);
      const result = firstValueFrom(TestBed.inject(DatatugApiService).get('datatug/ping'));
      http.expectOne(primary + 'datatug/ping').flush({});
      await result;
      http.verify();
    });

    it('keeps identity calls of the TEST preview on the authoritative service', () => {
      const preview = 'https://datatug-cloud-preview-354fvnqbaa-ey.a.run.app/v0/';
      const http = configure([
        { provide: DatatugApiBaseUrl, useValue: preview },
        { provide: DatatugApiBaseUrls, useValue: [preview] },
        { provide: SneatApiBaseUrl, useValue: 'https://identity.test/v0/' },
      ]);
      TestBed.inject(DatatugApiService).get('datatug/github/oauth/repositories').subscribe();
      http.expectOne('https://identity.test/v0/datatug/github/oauth/repositories').flush({});
      http.verify();
    });
  });

  describe('logging', () => {
    function loggers() {
      const warn = vi.fn();
      const logEvent = vi.fn();
      const providers: Provider[] = [
        { provide: LOGGER_FACTORY, useValue: { getLogger: () => ({ warn }) } },
        { provide: AnalyticsService, useValue: { logEvent } },
      ];
      return { warn, logEvent, providers };
    }

    it('warns and records an event with hosts and reason only, never the endpoint or query', async () => {
      const { warn, logEvent, providers } = loggers();
      const http = configure(providers);
      const result = firstValueFrom(
        TestBed.inject(DatatugApiService).get('datatug/projects/get_project', undefined, {
          params: { user: 'someone@example.com' } as never,
        }),
      );
      fail(http.expectOne((r) => r.url.startsWith(primary)), 522);
      http.expectOne((r) => r.url.startsWith(fallback)).flush({});
      await result;
      const detail = {
        method: 'GET',
        fromHost: 'api.datatug.test',
        toHost: 'api2.datatug.test',
        reason: 'status 522',
      };
      expect(warn).toHaveBeenCalledWith('DataTug API failover', detail);
      expect(logEvent).toHaveBeenCalledWith('datatug_api_failover', detail);
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/someone|get_project|\?/);
    });

    it('does not break the call when analytics throws', async () => {
      const { warn } = loggers();
      const http = configure([
        { provide: LOGGER_FACTORY, useValue: { getLogger: () => ({ warn }) } },
        {
          provide: AnalyticsService,
          useValue: {
            logEvent: () => {
              throw new Error('analytics down');
            },
          },
        },
      ]);
      const result = firstValueFrom(TestBed.inject(DatatugApiService).get('datatug/ping'));
      fail(http.expectOne(primary + 'datatug/ping'), 0);
      http.expectOne(fallback + 'datatug/ping').flush({ ok: 1 });
      await expect(result).resolves.toEqual({ ok: 1 });
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('works with no logger factory and no analytics provided', async () => {
      const http = configure();
      const result = firstValueFrom(TestBed.inject(DatatugApiService).get('datatug/ping'));
      fail(http.expectOne(primary + 'datatug/ping'), 0);
      http.expectOne(fallback + 'datatug/ping').flush({});
      await result;
      expect(consoleWarn).toHaveBeenCalledWith('DataTug API failover', expect.objectContaining({ reason: 'network' }));
    });
  });
});

describe('datatugApiFailoverReason', () => {
  const http = (status: number) => new HttpErrorResponse({ status });

  it.each([
    ['GET', 0, 'network'],
    ['HEAD', 504, 'status 504'],
    ['get', 526, 'status 526'],
    ['GET', 524, null],
    ['GET', 500, null],
    ['GET', 404, null],
    ['POST', 0, 'network'],
    ['PATCH', 521, 'status 521'],
    ['PUT', 523, 'status 523'],
    ['DELETE', 522, 'status 522'],
    ['POST', 524, null],
    ['POST', 502, null],
    ['PATCH', 500, null],
  ])('%s with status %i -> %s', (method, status, expected) => {
    expect(datatugApiFailoverReason(method, http(status))).toBe(expected);
  });

  it('retries a timeout only for idempotent methods', () => {
    expect(datatugApiFailoverReason('GET', new TimeoutError())).toBe('timeout');
    expect(datatugApiFailoverReason('POST', new TimeoutError())).toBeNull();
  });

  it('never retries an error that is not an HTTP response', () => {
    expect(datatugApiFailoverReason('GET', new Error('boom'))).toBeNull();
    expect(datatugApiFailoverReason('GET', 'text')).toBeNull();
  });
});

describe('DatatugApiFailoverHttpClient', () => {
  function client(
    baseUrls: readonly string[],
    log?: DatatugApiFailoverLog,
    now?: () => number,
  ) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    return {
      http: TestBed.inject(HttpTestingController),
      client: new DatatugApiFailoverHttpClient(
        TestBed.inject(HttpHandler),
        baseUrls,
        DEFAULT_DATATUG_API_FAILOVER_CONFIG,
        log,
        null,
        now,
      ),
    };
  }

  it('passes a URL outside the primary base through untouched', async () => {
    const { client: c, http } = client([primary, fallback]);
    const result = firstValueFrom(c.get('https://other.test/x'));
    fail(http.expectOne('https://other.test/x'), 503);
    await expect(result).rejects.toMatchObject({ status: 503 });
    http.verify();
  });

  it('passes a prepared HttpRequest through untouched', async () => {
    const { client: c, http } = client([primary, fallback]);
    const result = lastValueFrom(c.request(new HttpRequest('GET', primary + 'datatug/x')));
    http.expectOne(primary + 'datatug/x').flush({ ok: 1 });
    await expect(result).resolves.toMatchObject({ body: { ok: 1 } });
  });

  it('does not fail over the raw event stream', async () => {
    const { client: c, http } = client([primary, fallback]);
    const result = settle(lastValueFrom(c.get(primary + 'datatug/x', { observe: 'events' })));
    fail(http.expectOne(primary + 'datatug/x'), 503);
    expect(((await result) as { error: HttpErrorResponse }).error.status).toBe(503);
    http.verify();
  });

  it('fails over across three base URLs in order', async () => {
    const third = 'https://api3.datatug.test/v0/';
    const { client: c, http } = client([primary, fallback, third]);
    const result = firstValueFrom(c.get(primary + 'datatug/x'));
    fail(http.expectOne(primary + 'datatug/x'), 503);
    fail(http.expectOne(fallback + 'datatug/x'), 0);
    http.expectOne(third + 'datatug/x').flush({ ok: 3 });
    await expect(result).resolves.toEqual({ ok: 3 });
    http.verify();
  });

  it('logs the host of a protocol-relative base URL', async () => {
    const warn = vi.fn();
    const { client: c, http } = client(['//a.test/v0/', '//b.test/v0/'], { warn });
    const result = firstValueFrom(c.get('//a.test/v0/x'));
    fail(http.expectOne('//a.test/v0/x'), 0);
    http.expectOne('//b.test/v0/x').flush({});
    await result;
    expect(warn).toHaveBeenCalledWith(
      'DataTug API failover',
      expect.objectContaining({ fromHost: 'a.test', toHost: 'b.test' }),
    );
  });

  it('logs "unknown" instead of throwing when a base URL cannot be parsed', async () => {
    const warn = vi.fn();
    const { client: c, http } = client([primary, fallback], { warn });
    const result = firstValueFrom(c.get(primary + 'x'));
    const request = http.expectOne(primary + 'x');
    const parse = vi.spyOn(globalThis, 'URL').mockImplementation(() => {
      throw new TypeError('Invalid URL');
    });
    fail(request, 0);
    http.expectOne(fallback + 'x').flush({});
    await result;
    parse.mockRestore();
    expect(warn).toHaveBeenCalledWith(
      'DataTug API failover',
      expect.objectContaining({ fromHost: 'unknown', toHost: 'unknown' }),
    );
  });

  it('reads the clock through the injected function', async () => {
    let now = 1_000;
    const { client: c, http } = client([primary, fallback], undefined, () => now);
    const first = firstValueFrom(c.get(primary + 'datatug/x'));
    fail(http.expectOne(primary + 'datatug/x'), 503);
    http.expectOne(fallback + 'datatug/x').flush({});
    await first;
    now += 5 * minute - 1;
    const held = firstValueFrom(c.get(primary + 'datatug/x'));
    http.expectOne(fallback + 'datatug/x').flush({});
    await held;
    now += 1;
    const probe = firstValueFrom(c.get(primary + 'datatug/x'));
    http.expectOne(primary + 'datatug/x').flush({});
    await probe;
    http.verify();
  });
});
