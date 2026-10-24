import type { Breadcrumb, BrowserOptions, ErrorEvent } from '@sentry/browser';
import { loopbackAgentOrigin } from '../agent-access/agent-link-code';
import {
  onLinkRoute,
  scrubDeep,
  scrubUrl,
  hasQuickSearchOrigin,
  hasWatchOrigin,
  onWatchRoute,
} from './link-privacy';

/** The transaction event of `beforeSendTransaction` (not exported by `@sentry/browser` itself). */
export type TransactionEvent = Parameters<
  NonNullable<BrowserOptions['beforeSendTransaction']>
>[0];

/** Breadcrumb categories of a request the page made. */
const REQUEST_CATEGORIES = new Set(['xhr', 'fetch']);
/** Breadcrumb categories that can carry page text or logged values: dropped on a link route. */
const PAGE_TEXT_CATEGORIES = new Set(['console', 'ui.click', 'ui.input']);

function requestDiagnostics(data: Record<string, unknown>) {
  return {
    method:
      typeof data['method'] === 'string' &&
      /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(data['method'])
        ? data['method']
        : undefined,
    status_code:
      typeof data['status_code'] === 'number' &&
      data['status_code'] >= 100 &&
      data['status_code'] <= 599
        ? data['status_code']
        : undefined,
  };
}

/** A Watch request keeps no source address, payload, response or private SDK attributes. */
function watchRequestBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return {
    category: breadcrumb.category,
    type: 'http',
    data: { ...requestDiagnostics(breadcrumb.data ?? {}), url: '/watch-api' },
  };
}

function watchSpan<T extends object>(span: T): T {
  const data = span as Record<string, unknown>;
  const attributes = (data['data'] ?? {}) as Record<string, unknown>;
  const diagnostics = requestDiagnostics({
    method: attributes['http.method'],
    status_code: attributes['http.response.status_code'],
  });
  // Span IDs and timestamps are SDK diagnostics; arbitrary span attributes are private.
  return {
    span_id: data['span_id'],
    trace_id: data['trace_id'],
    parent_span_id: data['parent_span_id'],
    start_timestamp: data['start_timestamp'],
    timestamp: data['timestamp'],
    description: 'Watch operation',
    data: {
      'http.method': diagnostics.method,
      'http.response.status_code': diagnostics.status_code,
    },
  } as T;
}

/**
 * A request breadcrumb as Sentry may keep it: for a loopback agent only the method, the status and the address
 * without its query (no body or response size or anything else the instrumentation adds).
 */
function scrubRequestBreadcrumb(
  breadcrumb: Breadcrumb,
  dropQuery: boolean,
): Breadcrumb {
  const data = breadcrumb.data ?? {};
  const url = typeof data['url'] === 'string' ? data['url'] : '';
  if (
    !loopbackAgentOrigin(url) &&
    !hasQuickSearchOrigin(url) &&
    !hasWatchOrigin(url)
  ) {
    return scrubDeep(breadcrumb, dropQuery);
  }
  return {
    ...breadcrumb,
    message: undefined,
    data: {
      method: data['method'],
      status_code: data['status_code'],
      url: scrubUrl(url, true),
    },
  };
}

/** Sentry's `beforeBreadcrumb`: see {@link withSentryLinkPrivacy}. */
export function scrubSentryBreadcrumb(
  breadcrumb: Breadcrumb,
  sourceSensitive = false,
): Breadcrumb | null {
  const dropQuery =
    sourceSensitive ||
    onLinkRoute() ||
    hasQuickSearchOrigin(breadcrumb) ||
    hasWatchOrigin(breadcrumb);
  const category = breadcrumb.category ?? '';
  if (onWatchRoute() || hasWatchOrigin(breadcrumb)) {
    if (REQUEST_CATEGORIES.has(category))
      return watchRequestBreadcrumb(breadcrumb);
    if (category === 'navigation') return { category: 'navigation' };
    return null;
  }
  if (dropQuery && PAGE_TEXT_CATEGORIES.has(category)) {
    return null;
  }
  if (REQUEST_CATEGORIES.has(category)) {
    return scrubRequestBreadcrumb(breadcrumb, dropQuery);
  }
  return scrubDeep(breadcrumb, dropQuery);
}

/** Sentry's `beforeSend`/`beforeSendTransaction`: see {@link withSentryLinkPrivacy}. */
export function scrubSentryEvent<T extends ErrorEvent | TransactionEvent>(
  event: T,
): T {
  const watchSensitive = onWatchRoute() || hasWatchOrigin(event);
  const dropQuery =
    onLinkRoute() || hasQuickSearchOrigin(event) || watchSensitive;
  const scrubbed = scrubDeep(event, dropQuery);
  if (scrubbed.request) {
    const { url } = scrubbed.request;
    scrubbed.request = {
      ...scrubbed.request,
      url: url ? scrubUrl(url, dropQuery) : url,
      query_string: dropQuery ? undefined : scrubbed.request.query_string,
      data: undefined,
      cookies: undefined,
    };
  }
  if (scrubbed.breadcrumbs) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs
      .map((b: Breadcrumb) => scrubSentryBreadcrumb(b, dropQuery))
      .filter((b): b is Breadcrumb => !!b);
  }
  if (dropQuery || watchSensitive) {
    // `extra` holds whatever an error logger attached (a serialized HTTP error carries its response body).
    scrubbed.extra = undefined;
  }
  if (watchSensitive) {
    // Watch errors can carry titles, inputs, recipients and one-time credentials in
    // arbitrary SDK fields. Keep only technical diagnostics, never free page text.
    return {
      event_id: scrubbed.event_id,
      timestamp: scrubbed.timestamp,
      platform: scrubbed.platform,
      level: scrubbed.level,
      type: scrubbed.type,
      message: scrubbed.message ? 'Watch operation failed' : undefined,
      transaction: scrubbed.transaction ? 'Watch operation' : undefined,
      request: scrubbed.request
        ? {
            url: '/watch-api',
            method: requestDiagnostics({ method: scrubbed.request.method })
              .method,
          }
        : undefined,
      exception: scrubbed.exception
        ? { values: [{ type: 'WatchError', value: 'Watch operation failed' }] }
        : undefined,
      breadcrumbs: scrubbed.breadcrumbs
        ?.filter(
          (b) =>
            REQUEST_CATEGORIES.has(b.category || '') ||
            b.category === 'navigation',
        )
        .map((b) =>
          REQUEST_CATEGORIES.has(b.category || '')
            ? watchRequestBreadcrumb(b)
            : { category: 'navigation' },
        ),
      ...('spans' in scrubbed
        ? { spans: (scrubbed as TransactionEvent).spans?.map(watchSpan) }
        : {}),
    } as T;
  }
  return scrubbed;
}

/**
 * Sentry options with the link privacy rules (REQ:ui-no-context-telemetry) in front of any hook already set:
 * every event, transaction, span and breadcrumb loses address fragments (the one-time code and the record key);
 * on a table, view, records or record page also every address query, console and UI breadcrumbs and the event's
 * `extra`; on every page a request to a loopback agent keeps only its method, status and address without query.
 */
export function withSentryLinkPrivacy(options: BrowserOptions): BrowserOptions {
  const {
    beforeSend,
    beforeSendTransaction,
    beforeBreadcrumb,
    beforeSendSpan,
  } = options;
  return {
    ...options,
    sendDefaultPii: false,
    beforeSend: (event, hint) => {
      const scrubbed = scrubSentryEvent(event);
      return beforeSend ? beforeSend(scrubbed, hint) : scrubbed;
    },
    beforeSendTransaction: (event, hint) => {
      const scrubbed = scrubSentryEvent(event);
      return beforeSendTransaction
        ? beforeSendTransaction(scrubbed, hint)
        : scrubbed;
    },
    beforeSendSpan: (span) => {
      const scrubbed =
        onWatchRoute() || hasWatchOrigin(span)
          ? watchSpan(span)
          : scrubDeep(span, onLinkRoute() || hasQuickSearchOrigin(span));
      return beforeSendSpan ? beforeSendSpan(scrubbed) : scrubbed;
    },
    beforeBreadcrumb: (breadcrumb, hint) => {
      const scrubbed = scrubSentryBreadcrumb(breadcrumb);
      return scrubbed && beforeBreadcrumb
        ? beforeBreadcrumb(scrubbed, hint)
        : scrubbed;
    },
  };
}
