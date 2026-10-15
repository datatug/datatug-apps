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
  AGENT_SESSION_EXCHANGE_PATH,
  provideAgentLinkCode,
} from './agent-access.service';
import { AgentLinkCode } from './agent-link-code';

const AGENT = 'http://127.0.0.1:8989';
const SCHEMA_URL = `${AGENT}/datatug/records/schema`;
const TOKEN_KEY = `datatug.agent-session:${AGENT}`;

function setup(code?: AgentLinkCode) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([agentAccessInterceptor])),
      provideHttpClientTesting(),
      provideAgentLinkCode(code),
      provideAgentAccessForModuleClients(),
    ],
  });
  return {
    http: TestBed.inject(HttpClient),
    ctrl: TestBed.inject(HttpTestingController),
  };
}

describe('agentAccessInterceptor', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('exchanges the code once, then sends the token only to that agent', () => {
    const { http, ctrl } = setup({ origin: AGENT, code: 'v1.c' });
    const done: unknown[] = [];
    http.post(SCHEMA_URL, {}).subscribe((r) => done.push(r));
    http.post(SCHEMA_URL, {}).subscribe((r) => done.push(r));

    const exchange = ctrl.expectOne(AGENT + AGENT_SESSION_EXCHANGE_PATH);
    expect(exchange.request.body).toEqual({ code: 'v1.c' });
    expect(exchange.request.headers.has('Authorization')).toBe(false);
    exchange.flush({ token: 'tok-1' });

    const calls = ctrl.match(SCHEMA_URL);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.request.headers.get('Authorization')).toBe('Bearer tok-1');
      call.flush({});
    }
    expect(done).toHaveLength(2);
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-1');

    http.get('https://api.example.com/x').subscribe();
    const other = ctrl.expectOne('https://api.example.com/x');
    expect(other.request.headers.has('Authorization')).toBe(false);
    other.flush({});

    http.get(`${AGENT}/datatug/agent-info`).subscribe();
    ctrl.expectNone(AGENT + AGENT_SESSION_EXCHANGE_PATH);
    ctrl.expectOne(`${AGENT}/datatug/agent-info`).flush({});
    ctrl.verify();
  });

  it('reuses a token held from an earlier page, so a spent code still opens the page', () => {
    localStorage.setItem(TOKEN_KEY, 'tok-held');
    const { http, ctrl } = setup({ origin: AGENT, code: 'v1.spent' });
    http.post(SCHEMA_URL, {}).subscribe();
    ctrl.expectNone(AGENT + AGENT_SESSION_EXCHANGE_PATH);
    expect(
      ctrl.expectOne(SCHEMA_URL).request.headers.get('Authorization'),
    ).toBe('Bearer tok-held');
  });

  it('turns a refused code into a 401 and does not send the request', () => {
    const { http, ctrl } = setup({ origin: AGENT, code: 'v1.used' });
    let status = -1;
    http.post(SCHEMA_URL, {}).subscribe({ error: (e) => (status = e.status) });
    ctrl
      .expectOne(AGENT + AGENT_SESSION_EXCHANGE_PATH)
      .flush({ error: 'link-expired' }, { status: 401, statusText: 'Unauthorized' });
    expect(status).toBe(401);
    ctrl.expectNone(SCHEMA_URL);
  });

  it('keeps the code when the agent is not reachable, so Check again can exchange it', () => {
    const { http, ctrl } = setup({ origin: AGENT, code: 'v1.c' });
    let status = -1;
    http.post(SCHEMA_URL, {}).subscribe({ error: (e) => (status = e.status) });
    ctrl
      .expectOne(AGENT + AGENT_SESSION_EXCHANGE_PATH)
      .error(new ProgressEvent('error'), { status: 0 });
    expect(status).toBe(0);

    http.post(SCHEMA_URL, {}).subscribe();
    ctrl.expectOne(AGENT + AGENT_SESSION_EXCHANGE_PATH).flush({ token: 'tok-2' });
    expect(
      ctrl.expectOne(SCHEMA_URL).request.headers.get('Authorization'),
    ).toBe('Bearer tok-2');
  });

  it('sends no token to an agent too old to have the exchange route', () => {
    const { http, ctrl } = setup({ origin: AGENT, code: 'v1.c' });
    http.post(SCHEMA_URL, {}).subscribe();
    ctrl
      .expectOne(AGENT + AGENT_SESSION_EXCHANGE_PATH)
      .flush('404 page not found', { status: 404, statusText: 'Not Found' });
    expect(ctrl.expectOne(SCHEMA_URL).request.headers.has('Authorization')).toBe(false);
  });

  it('forgets a token the agent refuses', () => {
    localStorage.setItem(TOKEN_KEY, 'tok-old');
    const { http, ctrl } = setup();
    http.post(SCHEMA_URL, {}).subscribe({ error: () => undefined });
    ctrl
      .expectOne(SCHEMA_URL)
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();

    http.post(SCHEMA_URL, {}).subscribe({ error: () => undefined });
    expect(ctrl.expectOne(SCHEMA_URL).request.headers.has('Authorization')).toBe(false);
  });

  it('never exchanges a code minted for another agent', () => {
    const { http, ctrl } = setup({ origin: 'http://127.0.0.1:9000', code: 'v1.c' });
    http.post(SCHEMA_URL, {}).subscribe();
    ctrl.expectNone('http://127.0.0.1:9000' + AGENT_SESSION_EXCHANGE_PATH);
    expect(ctrl.expectOne(SCHEMA_URL).request.headers.has('Authorization')).toBe(false);
  });

  it('also sends the token from an HttpClient a library module provides itself', () => {
    localStorage.setItem(TOKEN_KEY, 'tok-held');
    const { ctrl } = setup();
    const root = TestBed.inject(EnvironmentInjector);
    const moduleInjector = createEnvironmentInjector(
      [
        provideHttpClient(withInterceptorsFromDi()),
        { provide: HttpBackend, useValue: root.get(HttpBackend) },
      ],
      root,
    );
    moduleInjector.get(HttpClient).get(`${AGENT}/datatug/exec/select`).subscribe();
    const calls = ctrl.match(`${AGENT}/datatug/exec/select`);
    expect(calls).toHaveLength(1);
    expect(calls[0].request.headers.get('Authorization')).toBe('Bearer tok-held');
  });
});
