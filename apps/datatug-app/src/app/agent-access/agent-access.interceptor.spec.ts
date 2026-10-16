import {
  HttpBackend,
  HttpClient,
  provideHttpClient,
  withInterceptors,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  agentAccessInterceptor,
  provideAgentAccessForModuleClients,
} from './agent-access.interceptor';
import {
  AGENT_ACTIVE_ORIGIN,
  AgentAccessService,
  AGENT_SESSION_EXCHANGE_PATH,
  provideAgentLinkCode,
} from './agent-access.service';
import { AgentLinkCode } from './agent-link-code';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const AGENT = 'http://127.0.0.1:8989';
const SCHEMA_URL = `${AGENT}/datatug/records/schema`;
const TOKEN_KEY = `datatug.agent-session:${AGENT}`;
const LEGACY_CODE_KEY = 'datatug.agent-link-code';

function setup(
  code?: AgentLinkCode,
  activeOrigin: string | undefined | (() => string | undefined) = AGENT,
) {
  const currentOrigin =
    typeof activeOrigin === 'function' ? activeOrigin : () => activeOrigin;
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([agentAccessInterceptor])),
      provideHttpClientTesting(),
      provideAgentLinkCode(code),
      { provide: AGENT_ACTIVE_ORIGIN, useValue: currentOrigin },
      provideAgentAccessForModuleClients(),
    ],
  });
  return {
    http: TestBed.inject(HttpClient),
    ctrl: TestBed.inject(HttpTestingController),
  };
}

describe('agentAccessInterceptor', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  async function settleAsync(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  function ok(token: string): Promise<Response> {
    return Promise.resolve(
      new Response(JSON.stringify({ token }), { status: 200 }),
    );
  }

  it('exchanges once with no ambient credentials, then attaches only to the active agent API', async () => {
    fetchSpy.mockReturnValue(ok('tok-1'));
    const { http, ctrl } = setup({ origin: AGENT, code: 'v1.c' });
    http.post(SCHEMA_URL, {}).subscribe();
    await settleAsync();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe(AGENT + AGENT_SESSION_EXCHANGE_PATH);
    expect(options).toEqual(
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        body: JSON.stringify({ code: 'v1.c' }),
      }),
    );
    const api = ctrl.expectOne(SCHEMA_URL);
    expect(api.request.headers.get('Authorization')).toBe('Bearer tok-1');
    expect(api.request.redirect).toBe('error');
    expect(api.request.credentials).toBe('omit');
    expect(api.request.withCredentials).toBe(false);
    expect(api.request.cache).toBe('no-store');
    api.flush({});

    http.get(`${AGENT}/unrelated`).subscribe();
    expect(
      ctrl.expectOne(`${AGENT}/unrelated`).request.headers.has('Authorization'),
    ).toBe(false);
    http.get('http://127.0.0.1:9000/datatug/records/schema').subscribe();
    expect(
      ctrl
        .expectOne('http://127.0.0.1:9000/datatug/records/schema')
        .request.headers.has('Authorization'),
    ).toBe(false);
    http.get('https://api.example.com/datatug/records/schema').subscribe();
    expect(
      ctrl
        .expectOne('https://api.example.com/datatug/records/schema')
        .request.headers.has('Authorization'),
    ).toBe(false);
    ctrl.verify();
  });

  it('does not retry or persist a one-shot code after a lost exchange acknowledgement', async () => {
    fetchSpy.mockRejectedValue(new TypeError('network failure'));
    const { http } = setup({ origin: AGENT, code: 'v1.once' });
    let status = -1;
    http.post(SCHEMA_URL, {}).subscribe({ error: (e) => (status = e.status) });
    await settleAsync();
    expect(status).toBe(401);
    expect(sessionStorage.length).toBe(0);
    TestBed.resetTestingModule();
    const second = setup();
    second.http.post(SCHEMA_URL, {}).subscribe();
    await settleAsync();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(
      second.ctrl.expectOne(SCHEMA_URL).request.headers.has('Authorization'),
    ).toBe(false);
    second.ctrl.verify();
  });

  it('does not attach a token when the active agent changes during the exchange', async () => {
    let resolveFetch!: (response: Response) => void;
    fetchSpy.mockReturnValue(
      new Promise<Response>((resolve) => (resolveFetch = resolve)),
    );
    let currentOrigin: string | undefined = AGENT;
    let status = -1;
    const { http, ctrl } = setup(
      { origin: AGENT, code: 'v1.route-change' },
      () => currentOrigin,
    );
    http.get(SCHEMA_URL).subscribe({ error: (err) => (status = err.status) });
    currentOrigin = 'http://127.0.0.1:9000';
    resolveFetch(
      new Response(JSON.stringify({ token: 'tok-stale' }), { status: 200 }),
    );
    await settleAsync();
    expect(status).toBe(0);
    ctrl.expectNone(SCHEMA_URL);
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-stale');
    ctrl.verify();
  });

  it('rejects redirects at the exchange transport boundary', async () => {
    fetchSpy.mockReturnValue(
      Promise.reject(new TypeError('redirect rejected')),
    );
    const { http, ctrl } = setup({ origin: AGENT, code: 'v1.redirect' });
    http.post(SCHEMA_URL, {}).subscribe({ error: () => undefined });
    await settleAsync();
    expect(fetchSpy.mock.calls[0][1].redirect).toBe('error');
    expect(ctrl.match(SCHEMA_URL)).toHaveLength(0);
    ctrl.verify();
  });

  it('never exchanges a code minted for another agent or attaches to another active agent', () => {
    const otherAgent = 'http://127.0.0.1:9000';
    localStorage.setItem(`datatug.agent-session:${otherAgent}`, 'tok-other');
    const { http, ctrl } = setup(undefined, otherAgent);
    http.get(SCHEMA_URL).subscribe();
    expect(
      ctrl.expectOne(SCHEMA_URL).request.headers.has('Authorization'),
    ).toBe(false);
    http.get(`${otherAgent}/datatug/records/schema`).subscribe();
    const active = ctrl.expectOne(`${otherAgent}/datatug/records/schema`);
    expect(active.request.headers.get('Authorization')).toBe(
      'Bearer tok-other',
    );
    expect(active.request.redirect).toBe('error');
    active.flush({});
    expect(fetchSpy).not.toHaveBeenCalled();
    ctrl.verify();
  });

  it('keeps a newer persisted token after an old in-memory token gets a 401, then uses it', () => {
    fetchSpy.mockReturnValue(ok('tok-old'));
    const { http, ctrl } = setup({ origin: AGENT, code: 'v1.old' });
    http.get(SCHEMA_URL).subscribe({ error: () => undefined });
    return settleAsync().then(() => {
      const oldRequest = ctrl.expectOne(SCHEMA_URL);
      expect(oldRequest.request.headers.get('Authorization')).toBe(
        'Bearer tok-old',
      );
      localStorage.setItem(TOKEN_KEY, 'tok-new');
      oldRequest.flush({}, { status: 401, statusText: 'Unauthorized' });
      expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-new');
      http.get(SCHEMA_URL).subscribe();
      const retry = ctrl.expectOne(SCHEMA_URL);
      expect(retry.request.headers.get('Authorization')).toBe('Bearer tok-new');
      retry.flush({});
      ctrl.verify();
    });
  });

  it('scrubs a legacy session-stored code without reading or replaying it', () => {
    sessionStorage.setItem(
      LEGACY_CODE_KEY,
      JSON.stringify({ origin: AGENT, code: 'v1.old' }),
    );
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    setup();
    TestBed.inject(AgentAccessService);
    expect(sessionStorage.length).toBe(0);
    expect(getItem).not.toHaveBeenCalledWith(LEGACY_CODE_KEY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses a held token when a second tab exchanges an already-spent link', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-held');
    fetchSpy.mockReturnValue(
      Promise.resolve(new Response('{}', { status: 401 })),
    );
    const { http, ctrl } = setup({ origin: AGENT, code: 'v1.spent' });
    http.get(SCHEMA_URL).subscribe();
    await settleAsync();
    expect(
      ctrl.expectOne(SCHEMA_URL).request.headers.get('Authorization'),
    ).toBe('Bearer tok-held');
    ctrl.verify();
  });

  it('uses a fresh link token instead of a token held from before an agent restart', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-before-restart');
    fetchSpy.mockReturnValue(ok('tok-fresh'));
    const { http, ctrl } = setup({ origin: AGENT, code: 'v1.fresh' });
    http.get(SCHEMA_URL).subscribe();
    await settleAsync();
    expect(
      ctrl.expectOne(SCHEMA_URL).request.headers.get('Authorization'),
    ).toBe('Bearer tok-fresh');
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-fresh');
    ctrl.verify();
  });

  it('does not send the API request when a code is refused and no held token exists', async () => {
    fetchSpy.mockReturnValue(
      Promise.resolve(new Response('{}', { status: 401 })),
    );
    const { http, ctrl } = setup({ origin: AGENT, code: 'v1.refused' });
    let status = -1;
    http.get(SCHEMA_URL).subscribe({ error: (err) => (status = err.status) });
    await settleAsync();
    expect(status).toBe(401);
    ctrl.expectNone(SCHEMA_URL);
    ctrl.verify();
  });

  it('keeps old-agent 404 compatibility by sending the API request without a token', async () => {
    fetchSpy.mockReturnValue(
      Promise.resolve(new Response('{}', { status: 404 })),
    );
    const { http, ctrl } = setup({ origin: AGENT, code: 'v1.old-agent' });
    http.get(SCHEMA_URL).subscribe();
    await settleAsync();
    expect(
      ctrl.expectOne(SCHEMA_URL).request.headers.has('Authorization'),
    ).toBe(false);
    ctrl.verify();
  });

  it('forgets the token an agent currently rejects', () => {
    localStorage.setItem(TOKEN_KEY, 'tok-revoked');
    const { http, ctrl } = setup();
    http.get(SCHEMA_URL).subscribe({ error: () => undefined });
    ctrl
      .expectOne(SCHEMA_URL)
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    http.get(SCHEMA_URL).subscribe();
    expect(
      ctrl.expectOne(SCHEMA_URL).request.headers.has('Authorization'),
    ).toBe(false);
    ctrl.verify();
  });

  it('uses FetchBackend for authenticated module clients so redirect:error is enforced there too', async () => {
    fetchSpy.mockReturnValue(
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    localStorage.setItem(TOKEN_KEY, 'tok-module');
    const { ctrl } = setup();
    const root = TestBed.inject(EnvironmentInjector);
    const moduleInjector = createEnvironmentInjector(
      [
        provideHttpClient(withInterceptorsFromDi()),
        { provide: HttpBackend, useValue: root.get(HttpBackend) },
      ],
      root,
    );
    moduleInjector.get(HttpClient).get(SCHEMA_URL).subscribe();
    await settleAsync();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1];
    expect(init.redirect).toBe('error');
    expect(init.credentials).toBe('omit');
    expect(new Headers(init.headers).get('Authorization')).toBe(
      'Bearer tok-module',
    );
    ctrl.verify();
  });
});
