import { loopbackAgentOrigin } from '../agent-access/agent-link-code';

/**
 * Feature claude-mod-web-links, REQ:ui-no-context-telemetry: the pages a card's link opens (a table or view, its
 * `records` and one `record`) must not send the fragment (the one-time code, the record key), the URL query, key
 * values or row text to a third party, and no page may send the query, body or response of a request to a loopback
 * agent. This file holds the pure scrubbing rules; `sentry-privacy.ts` and `register-posthog.ts` apply them.
 */

/** `/store/<agent>/project/<p>/env/<e>/db/<d>/(table|view)/<name>[/records|/record]`. */
const LINK_ROUTE =
  /^\/store\/[^/]+\/project\/[^/]+\/env\/[^/]+\/db\/[^/]+\/(?:table|view)\/[^/?#]+(?:\/(?:records|record))?\/?$/;

/** Whether pathname (no query or fragment) is a table, view, records or record page. */
export function isLinkRoute(pathname: string): boolean {
  return LINK_ROUTE.test(pathname.split(/[?#]/)[0]);
}

/** Whether the current page is a table, view, records or record page. */
export function onLinkRoute(): boolean {
  return typeof location !== 'undefined' && isLinkRoute(location.pathname);
}

/**
 * An address as telemetry may see it: never the fragment; no query either for a loopback agent, for the address of
 * a link page, or when dropQuery (the current page is a link page). Text that is not an address is returned as it is.
 */
export function scrubUrl(url: string, dropQuery: boolean): string {
  const noFragment = url.split('#')[0];
  const path = noFragment.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?]*/i, '');
  if (dropQuery || loopbackAgentOrigin(noFragment) || isLinkRoute(path)) {
    return noFragment.split('?')[0];
  }
  return noFragment;
}

const ABSOLUTE_URL = /\bhttps?:\/\/[^\s"'<>`]+/g;
const RELATIVE_LINK_PATH = /(^|[\s"'(=:])(\/store\/[^\s"'<>`]+)/g;
const LINK_FRAGMENT_PARTS = /#(?:[^\s"'<>`#]*&)?(?:code|pk)=[^\s"'<>`]*/g;

/**
 * Free text (an error message, a breadcrumb message, a span description) as telemetry may see it: every absolute
 * address and every `/store/…` path in it goes through {@link scrubUrl}, and any `#code=`/`#pk=` fragment is cut.
 */
export function scrubText(text: string, dropQuery: boolean): string {
  return text
    .replace(ABSOLUTE_URL, (match) => {
      // Punctuation that ends a sentence is not part of the address ("…/select?x=1: 500").
      const url = match.replace(/[.,:;!)\]]+$/, '');
      return scrubUrl(url, dropQuery) + match.slice(url.length);
    })
    .replace(
      RELATIVE_LINK_PATH,
      (_all, lead: string, path: string) =>
        lead + scrubUrl(path, dropQuery || isLinkRoute(path)),
    )
    .replace(LINK_FRAGMENT_PARTS, '');
}

/** Deepest level of a telemetry payload that is walked; anything deeper is dropped. */
const MAX_DEPTH = 10;

/** A copy of value with every string in it passed through {@link scrubText}. */
export function scrubDeep<T>(value: T, dropQuery: boolean, depth = 0): T {
  if (typeof value === 'string') {
    return scrubText(value, dropQuery) as T;
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return undefined as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubDeep(item, dropQuery, depth + 1)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = scrubDeep(item, dropQuery, depth + 1);
  }
  return out as T;
}
