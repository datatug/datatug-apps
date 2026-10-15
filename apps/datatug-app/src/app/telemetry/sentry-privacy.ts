import type { Breadcrumb, BrowserOptions, ErrorEvent } from '@sentry/browser';
import { loopbackAgentOrigin } from '../agent-access/agent-link-code';
import { onLinkRoute, scrubDeep, scrubUrl } from './link-privacy';

/** The transaction event of `beforeSendTransaction` (not exported by `@sentry/browser` itself). */
export type TransactionEvent = Parameters<
  NonNullable<BrowserOptions['beforeSendTransaction']>
>[0];

/** Breadcrumb categories of a request the page made. */
const REQUEST_CATEGORIES = new Set(['xhr', 'fetch']);
/** Breadcrumb categories that can carry page text or logged values: dropped on a link route. */
const PAGE_TEXT_CATEGORIES = new Set(['console', 'ui.click', 'ui.input']);

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
  if (!loopbackAgentOrigin(url)) {
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
export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  const dropQuery = onLinkRoute();
  const category = breadcrumb.category ?? '';
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
  const dropQuery = onLinkRoute();
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
      .map((b: Breadcrumb) => scrubSentryBreadcrumb(b))
      .filter((b): b is Breadcrumb => !!b);
  }
  if (dropQuery) {
    // `extra` holds whatever an error logger attached (a serialized HTTP error carries its response body).
    scrubbed.extra = undefined;
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
  const { beforeSend, beforeSendTransaction, beforeBreadcrumb, beforeSendSpan } =
    options;
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
      const scrubbed = scrubDeep(span, onLinkRoute());
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
