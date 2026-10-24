import type { ErrorEvent } from '@sentry/browser';
import { hasWatchOrigin, isLinkRoute, scrubUrl } from './link-privacy';
import { TransactionEvent, withSentryLinkPrivacy } from './sentry-privacy';
import { scrubPosthogEvent } from '../../register-posthog';

const pages = [
  '/store/private-agent/project/private-project/watch',
  '/space/private-space/store/firestore/project/private-project/watch/private-watch',
  '/project/github.com/private-owner/private-repo/tree/private-ref/private-folder/-/watch/new',
];
const apis = [
  'https://api.sneat.cloud/v0/datatug/watch/private-space/private-project/private-env/v1/watch/enrollments',
  'https://private-coordinator.example/prefix/v1/watch/definition?project=private-project',
];
const secret = 'synthetic-one-time-credential';
const title = 'Private customer shipment';
const options = withSentryLinkPrivacy({});
const previous = location.pathname + location.search + location.hash;
afterEach(() => history.replaceState(null, '', previous));

function expectPrivate(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const text of [
    secret,
    title,
    'private-space',
    'private-project',
    'private-watch',
    'private-env',
    'private-owner',
    'private-ref',
    'private-folder',
    'private-repo',
    'private-coordinator',
  ])
    expect(serialized).not.toContain(text);
}

describe('Watch telemetry privacy', () => {
  it.each(pages)(
    'recognizes the real Watch route %s and drops captures before queueing',
    (path) => {
      history.replaceState(null, '', path + '?env=private-env');
      expect(isLinkRoute(path)).toBe(true);
      expect(hasWatchOrigin(path)).toBe(true);
      expectPrivate(scrubUrl(path + '?env=private-env', false));
      for (const category of ['console', 'ui.click', 'ui.input'])
        expect(
          options.beforeBreadcrumb?.({
            category,
            message: secret,
            data: { title },
          }),
        ).toBeNull();
      expect(
        scrubPosthogEvent({
          event: '$autocapture',
          properties: { $el_text: secret },
        }),
      ).toBeNull();
      expect(
        scrubPosthogEvent({
          event: '$snapshot',
          properties: { $snapshot_data: secret },
        }),
      ).toBeNull();
    },
  );

  it.each([
    '/watch',
    '/store/a/project/b/watch-extra',
    '/space/a/store/firestore/project/b/watch/c/extra',
  ])('does not expand the boundary to unrelated route %s', (path) =>
    expect(isLinkRoute(path)).toBe(false),
  );

  it.each([...pages, ...apis])(
    'removes queued Watch details after leaving %s',
    (address) => {
      history.replaceState(null, '', '/home');
      const event = {
        message: secret,
        transaction: title,
        tags: { title },
        contexts: { private: { title } },
        user: { email: title },
        request: {
          url: address + '?env=private-env',
          method: 'POST',
          data: { token: secret },
          headers: { Authorization: secret },
        },
        extra: { response: { token: secret, title } },
        exception: { values: [{ value: secret }] },
        breadcrumbs: [
          { category: 'console', message: secret },
          { category: 'ui.input', message: title },
          {
            category: 'fetch',
            message: secret,
            data: {
              url: address,
              method: 'POST',
              status_code: 403,
              body: secret,
              response: title,
            },
          },
          { category: 'navigation', data: { from: address, to: address } },
        ],
      } as unknown as ErrorEvent;
      const output = options.beforeSend?.(event, {}) as ErrorEvent;
      expectPrivate(output);
      expect(output.extra).toBeUndefined();
      expect(
        output.breadcrumbs?.find((b) => b.category === 'fetch')?.data,
      ).toEqual({ url: '/watch-api', method: 'POST', status_code: 403 });
      const properties = {
        $current_url: address,
        method: 'POST',
        status_code: 403,
        $el_text: title,
        token: secret,
        response: { title },
        $elements: [{ text: secret }],
      };
      expectPrivate(scrubPosthogEvent({ event: title, properties }));
      expect(
        scrubPosthogEvent({ event: '$autocapture', properties }),
      ).toBeNull();
      expect(scrubPosthogEvent({ event: '$snapshot', properties })).toBeNull();
      expect(
        scrubPosthogEvent({ event: title, properties })?.properties[
          'status_code'
        ],
      ).toBe(403);
    },
  );

  it.each(apis)(
    'keeps only technical span and request diagnostics for %s',
    (url) => {
      history.replaceState(null, '', '/home');
      const span = {
        description: url,
        op: title,
        tags: { title },
        data: {
          'http.url': url,
          'http.method': 'POST',
          'http.response.status_code': 429,
          body: secret,
        },
        span_id: '0123456789abcdef',
        trace_id: '0123456789abcdef0123456789abcdef',
      };
      const output = options.beforeSendSpan?.(span as never);
      expectPrivate(output);
      expect((output as { data: object }).data).toEqual({
        'http.method': 'POST',
        'http.response.status_code': 429,
      });
      const transaction = {
        type: 'transaction',
        transaction: title,
        request: { url },
        spans: [span],
      } as unknown as TransactionEvent;
      expectPrivate(options.beforeSendTransaction?.(transaction, {}));
      expect(
        options.beforeBreadcrumb?.({
          category: 'fetch',
          data: { url, method: 'POST', status_code: 429, token: secret },
        })?.data,
      ).toEqual({ url: '/watch-api', method: 'POST', status_code: 429 });
    },
  );
});
