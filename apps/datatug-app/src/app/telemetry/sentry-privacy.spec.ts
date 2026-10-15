import type { Breadcrumb, ErrorEvent } from '@sentry/browser';
import { isLinkRoute, scrubText } from './link-privacy';
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
      data: { 'http.url': AGENT_SELECT },
    } as never);
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
