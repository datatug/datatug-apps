import type { Breadcrumb, ErrorEvent } from '@sentry/browser';
import { isLinkRoute, redactResultIds, scrubText } from './link-privacy';
import { TransactionEvent, withSentryLinkPrivacy } from './sentry-privacy';

const BASE = '/store/http-127.0.0.1:8989/project/demo/env/local/db/chinook';
const KEY = '9007199254740993';
const ROW = 'For Those About To Rock';
const CODE = 'v1.1792095344.nonce.signature';
/** The four pages a card's link opens. */
const LINK_PAGES = [
  `${BASE}/table/Album`,
  `${BASE}/view/AlbumView`,
  `${BASE}/table/Album/records`,
  `${BASE}/table/PlaylistTrack/record`,
];
const AGENT_SELECT = `http://127.0.0.1:8989/datatug/exec/select?db=chinook&from=Album&where=AlbumId%3D${KEY}`;

const options = withSentryLinkPrivacy({ dsn: 'https://public@example.ingest.sentry.io/1' });
const previous = location.pathname + location.search + location.hash;

function visit(path: string, hash = ''): void {
  history.replaceState(null, '', path + '?schema=' + hash);
}

/** Everything Sentry would send, as one text. */
function sent(value: unknown): string {
  return JSON.stringify(value) ?? '';
}

function expectNothingSecret(text: string): void {
  expect(text).not.toContain(KEY);
  expect(text).not.toContain(ROW);
  expect(text).not.toContain(CODE);
  expect(text).not.toContain('pk=');
  expect(text).not.toContain('code=');
  expect(text).not.toContain('where=');
}

afterAll(() => history.replaceState(null, '', previous));

describe('isLinkRoute', () => {
  it.each(LINK_PAGES)('%s is a link page', (path) => {
    expect(isLinkRoute(path)).toBe(true);
    expect(isLinkRoute(path + '?schema=#pk=1')).toBe(true);
  });
  it.each([
    '/store/http-127.0.0.1:8989/project/demo',
    `${BASE}`,
    `${BASE}/table/Album/other`,
    '/subscriptions',
  ])('%s is not', (path) => expect(isLinkRoute(path)).toBe(false));
});

describe('scrubText', () => {
  it('cuts fragments everywhere and the query of loopback agent addresses', () => {
    expect(
      scrubText(`Http failure response for ${AGENT_SELECT}: 500`, false),
    ).toBe('Http failure response for http://127.0.0.1:8989/datatug/exec/select: 500');
    expect(scrubText(`https://datatug.app${LINK_PAGES[3]}?schema=#code=${CODE}&pk=%7B%7D`, false)).toBe(
      `https://datatug.app${LINK_PAGES[3]}`,
    );
    expect(scrubText('https://example.com/a?b=1#c', false)).toBe('https://example.com/a?b=1');
    expect(scrubText(`navigated to ${LINK_PAGES[3]}?schema=#pk=${KEY}`, false)).toBe(
      `navigated to ${LINK_PAGES[3]}`,
    );
  });
});

describe('withSentryLinkPrivacy', () => {
  it.each(LINK_PAGES)('an error event on %s holds no fragment, key, row or query', (path) => {
    visit(path, `#pk=%7B%22AlbumId%22%3A${KEY}%7D`);
    const event = {
      message: `failed ${AGENT_SELECT}`,
      request: {
        url: `https://datatug.app${path}?schema=#pk=${KEY}`,
        query_string: 'schema=',
        data: { row: ROW },
      },
      exception: { values: [{ type: 'Error', value: `Http failure response for ${AGENT_SELECT}: 404` }] },
      extra: { __serialized__: { error: { rows: [[ROW]] }, url: AGENT_SELECT } },
      breadcrumbs: [
        { category: 'console', message: `drawTable() data: ${ROW}` },
        { category: 'navigation', data: { from: '/', to: `${path}?schema=#code=${CODE}&pk=${KEY}` } },
        { category: 'xhr', data: { method: 'GET', url: AGENT_SELECT, status_code: 200, request_body_size: 10, response_body_size: 99 } },
      ],
    } as unknown as ErrorEvent;
    const out = options.beforeSend?.(event, {}) as ErrorEvent;
    expectNothingSecret(sent(out));
    expect(out.request?.url).toBe(`https://datatug.app${path}`);
    expect(out.breadcrumbs?.map((b) => b.category)).toEqual(['navigation', 'xhr']);
    expect(out.breadcrumbs?.[1].data).toEqual({
      method: 'GET',
      status_code: 200,
      url: 'http://127.0.0.1:8989/datatug/exec/select',
    });
  });

  it.each(LINK_PAGES)('a transaction and its spans on %s hold no fragment or query', (path) => {
    visit(path, `#code=${CODE}`);
    const transaction = {
      type: 'transaction',
      transaction: path,
      request: { url: `https://datatug.app${path}?schema=#code=${CODE}` },
      spans: [{ description: `GET ${AGENT_SELECT}`, data: { url: AGENT_SELECT } }],
    } as unknown as TransactionEvent;
    expectNothingSecret(sent(options.beforeSendTransaction?.(transaction, {})));
    const span = options.beforeSendSpan?.({
      description: `POST ${AGENT_SELECT}`,
      data: {
        'http.url': AGENT_SELECT,
        'http.query': `?db=chinook&where=AlbumId%3D${KEY}`,
        'http.fragment': `#code=${CODE}&pk=${KEY}`,
      },
    } as never);
    expect(Object.keys((span as { data: object }).data)).toEqual(['http.url']);
    expectNothingSecret(sent(span));
  });

  it.each(LINK_PAGES)('drops console and UI breadcrumbs on %s', (path) => {
    visit(path);
    for (const category of ['console', 'ui.click', 'ui.input']) {
      expect(
        options.beforeBreadcrumb?.({ category, message: ROW } as Breadcrumb),
      ).toBeNull();
    }
  });

  it('keeps no query, body or response of a loopback agent request on any page', () => {
    visit('/store/http-127.0.0.1:8989/project/demo');
    const crumb = options.beforeBreadcrumb?.({
      category: 'fetch',
      message: `POST ${AGENT_SELECT}`,
      data: { method: 'POST', url: AGENT_SELECT, status_code: 404, request_body_size: 80, response_body_size: 40 },
    } as Breadcrumb);
    expect(crumb?.data).toEqual({
      method: 'POST',
      status_code: 404,
      url: 'http://127.0.0.1:8989/datatug/exec/select',
    });
    expectNothingSecret(sent(crumb));
    // A console breadcrumb outside the link pages is kept.
    expect(options.beforeBreadcrumb?.({ category: 'console', message: 'hello' } as Breadcrumb)).toEqual({
      category: 'console',
      message: 'hello',
    });
  });

  it('runs a hook that was already configured after scrubbing', () => {
    const beforeSend = vi.fn((e: ErrorEvent) => e);
    const wrapped = withSentryLinkPrivacy({ beforeSend });
    visit(LINK_PAGES[3], `#pk=${KEY}`);
    wrapped.beforeSend?.({ message: `x #pk=${KEY}` } as ErrorEvent, {});
    expect(beforeSend.mock.calls[0][0].message).toBe('x ');
    expect(wrapped.sendDefaultPii).toBe(false);
  });
});

describe('the query result page', () => {
  const RESULT_ID = 'qr-7f3a9c';
  const PAGE = `/store/http-127.0.0.1:8989/result/${RESULT_ID}`;
  const AGENT_RESULT = `http://127.0.0.1:8989/datatug/results/${RESULT_ID}`;
  const expectNoResult = (text: string) => {
    expectNothingSecret(text);
    expect(text).not.toContain(RESULT_ID);
    expect(text).not.toContain('view=');
    expect(text).not.toContain('row=');
  };

  it('is a link page, with or without its query', () => {
    expect(isLinkRoute(PAGE)).toBe(true);
    expect(isLinkRoute(`${PAGE}?view=sources&row=2#code=${CODE}`)).toBe(true);
    expect(isLinkRoute('/store/http-127.0.0.1:8989/result')).toBe(false);
    expect(isLinkRoute(`${PAGE}/other`)).toBe(false);
  });

  it('replaces the result id in page paths and agent addresses', () => {
    expect(redactResultIds(`${PAGE} and ${AGENT_RESULT}`)).toBe(
      '/store/http-127.0.0.1:8989/result/:resultId and http://127.0.0.1:8989/datatug/results/:resultId',
    );
    expect(scrubText(`GET /datatug/results/${RESULT_ID}`, false)).toBe('GET /datatug/results/:resultId');
    expect(scrubText(`https://datatug.app${PAGE}?view=sources#code=${CODE}`, false)).toBe(
      'https://datatug.app/store/http-127.0.0.1:8989/result/:resultId',
    );
  });

  it('an error event, its breadcrumbs and a transaction hold no id, row, code or query', () => {
    visit(PAGE, `#code=${CODE}`);
    const event = {
      message: `Http failure response for ${AGENT_RESULT}: 404`,
      transaction: PAGE,
      request: { url: `https://datatug.app${PAGE}?view=record&row=2#code=${CODE}`, query_string: 'view=record&row=2' },
      extra: { __serialized__: { error: { recordset: { rows: [[{ type: 'string', value: ROW }]] } } } },
      breadcrumbs: [
        { category: 'navigation', data: { from: '/', to: `${PAGE}?view=record&row=2` } },
        { category: 'fetch', data: { method: 'GET', url: AGENT_RESULT, status_code: 200, response_body_size: 9 } },
        { category: 'console', message: ROW },
      ],
    } as unknown as ErrorEvent;
    const out = options.beforeSend?.(event, {}) as ErrorEvent;
    expectNoResult(sent(out));
    expect(out.request?.url).toBe('https://datatug.app/store/http-127.0.0.1:8989/result/:resultId');
    expect(out.breadcrumbs?.[1].data).toEqual({
      method: 'GET',
      status_code: 200,
      url: 'http://127.0.0.1:8989/datatug/results/:resultId',
    });
    const transaction = {
      type: 'transaction',
      transaction: PAGE,
      request: { url: `https://datatug.app${PAGE}?view=table` },
      spans: [{ description: `GET ${AGENT_RESULT}`, data: { url: AGENT_RESULT, 'url.path': `/datatug/results/${RESULT_ID}` } }],
    } as unknown as TransactionEvent;
    expectNoResult(sent(options.beforeSendTransaction?.(transaction, {})));
    expectNoResult(sent(options.beforeSendSpan?.({ description: `GET ${AGENT_RESULT}`, data: { 'http.url': AGENT_RESULT } } as never)));
  });
});

describe('the query editor opened from a stored result', () => {
  const RESULT_ID = 'qr-7f3a9c';
  const PROJECT = 'secret-project';
  const EDITOR = `/store/http-127.0.0.1:8989/project/${PROJECT}/query`;

  it('is a link page with or without its query, but a deeper path or another page is not', () => {
    expect(isLinkRoute(EDITOR)).toBe(true);
    expect(isLinkRoute(`${EDITOR}?result=${RESULT_ID}&env=local`)).toBe(true);
    expect(isLinkRoute(`${EDITOR}/some/saved`)).toBe(false);
    expect(isLinkRoute('/store/http-127.0.0.1:8989/project/demo/queries')).toBe(false);
  });

  it('replaces the result id of the query and the project id of the path', () => {
    expect(redactResultIds(`${EDITOR}?result=${RESULT_ID}&env=local`)).toBe(
      '/store/http-127.0.0.1:8989/project/:projectId/query?result=:resultId&env=local',
    );
    expect(redactResultIds(`x ?env=local&result=${RESULT_ID}#frag`)).toBe(
      'x ?env=local&result=:resultId#frag',
    );
    expect(redactResultIds(`${EDITOR}`)).toBe('/store/http-127.0.0.1:8989/project/:projectId/query');
    // another project page keeps its path
    expect(redactResultIds('/store/http-127.0.0.1:8989/project/demo/queries')).toBe(
      '/store/http-127.0.0.1:8989/project/demo/queries',
    );
    const url = scrubText(`https://datatug.app${EDITOR}?result=${RESULT_ID}&env=local#code=${CODE}`, false);
    expect(url).toBe('https://datatug.app/store/http-127.0.0.1:8989/project/:projectId/query');
    expect(url).not.toContain(RESULT_ID);
    expect(url).not.toContain(CODE);
  });
});
