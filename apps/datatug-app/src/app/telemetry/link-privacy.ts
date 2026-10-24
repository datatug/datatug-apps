import { parseProjectUrl } from '@datatug/project-address';
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
/** `/store/<agent>/result/<id>`: a query result stored by `datatug query run --result-id`. */
const RESULT_ROUTE = /^\/store\/[^/]+\/result\/[^/?#]+\/?$/;
/**
 * `/store/<agent>/project/<p>/query`: the query editor, which a stored result opens through `?result=<id>`. Its query
 * string (the result id, a saved query id, the environment) is never sent to telemetry.
 */
const RESULT_EDITOR_ROUTE = /^\/store\/[^/]+\/project\/[^/]+\/query\/?$/;

/** Only real project search/discovery routes carry this privacy boundary. */
function quickSearchPage(
  pathname: string,
): 'quick-search' | 'tags' | 'search-schema' | undefined {
  const project = parseProjectUrl(pathname.split(/[?#]/)[0]);
  if (!project.ok) return undefined;
  const rest = project.rest.replace(/^\/sessions\/[A-Za-z0-9_-]{1,128}/, '');
  const match = /^\/(quick-search|tags|search-schema\/[^/]+)\/?$/.exec(rest);
  return match
    ? match[1].startsWith('search-schema/')
      ? 'search-schema'
      : (match[1] as 'quick-search' | 'tags')
    : undefined;
}

/** Work reports contain manual content and native proposals; suppress capture on every Work detail. */
function sensitiveWorkPage(pathname: string): boolean {
  if (pathname === '/my/work' || /^\/postmortems\/shared\/?$/.test(pathname))
    return true;
  const project = parseProjectUrl(pathname.split(/[?#]/)[0]);
  return project.ok && /^\/work(?:\/[^/]+)?\/?$/.test(project.rest);
}
const WORK_API_ROUTE = /^\/(?:v0\/)?datatug\/(?:postmortems|work)\//;
/** Lifecycle/search requests carry scope identifiers even after the page is left. */
const QUICK_SEARCH_API_ROUTE =
  /^\/(?:v0\/)?datatug\/project\/quick-search\/(?:status|preview|enable|refresh|search|disable)\/?$/;
const SEARCH_ORIGIN_URLS =
  /https?:\/\/[^\s"'<>`]+|\/(?:store|space|project|v0|datatug)\/[^\s"'<>`]+/g;

/** A queued SDK payload retains its originating URLs; never rely only on current location. */
export function hasQuickSearchOrigin(value: unknown, depth = 0): boolean {
  if (depth >= 10) return false;
  if (typeof value === 'string')
    return (value.match(SEARCH_ORIGIN_URLS) || []).some((address) => {
      const path = address
        .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?]*/i, '')
        .split(/[?#]/)[0];
      return (
        !!quickSearchPage(path) ||
        sensitiveWorkPage(path) ||
        WORK_API_ROUTE.test(path) ||
        QUICK_SEARCH_API_ROUTE.test(path)
      );
    });
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some((item) =>
    hasQuickSearchOrigin(item, depth + 1),
  );
}

/** Whether pathname (no query or fragment) is a table, view, records, record, query result or result editor page. */
export function isLinkRoute(pathname: string): boolean {
  const path = pathname.split(/[?#]/)[0];
  return (
    sensitiveWorkPage(path) ||
    !!quickSearchPage(path) ||
    LINK_ROUTE.test(path) ||
    RESULT_ROUTE.test(path) ||
    RESULT_EDITOR_ROUTE.test(path)
  );
}

/** What a result id is replaced with in telemetry. */
export const RESULT_ID_PLACEHOLDER = ':resultId';
/** The id of a result page's path (`/store/<agent>/result/<id>`) and of the agent's `results/<id>` route. */
const RESULT_ID_IN_PATH =
  /(\/store\/[^/\s"'<>`?#]+\/result\/|\/datatug\/results\/)[^/\s"'<>`?#]+/g;

/** What the project id of the query editor's path is replaced with in telemetry. */
export const PROJECT_ID_PLACEHOLDER = ':projectId';
/** The project id of the result editor's path (`/store/<agent>/project/<p>/query`, with no deeper segment). */
const PROJECT_ID_IN_EDITOR_PATH =
  /(\/store\/[^/\s"'<>`?#]+\/project\/)[^/\s"'<>`?#]+(\/query)(?=[?#\s"'<>`]|\/?$)/g;

/** The `result=<id>` query parameter of the query editor's address. */
const RESULT_ID_IN_QUERY = /([?&]result=)[^&#\s"'<>`]+/g;

/**
 * Text with every result id of a result page's path, of the agent's `results/<id>` route, or of the editor's `result`
 * query parameter replaced, and the project id of the editor's own path.
 */
export function redactResultIds(text: string): string {
  return text
    .replace(
      RESULT_ID_IN_PATH,
      (_all, prefix: string) => prefix + RESULT_ID_PLACEHOLDER,
    )
    .replace(
      RESULT_ID_IN_QUERY,
      (_all, prefix: string) => prefix + RESULT_ID_PLACEHOLDER,
    )
    .replace(
      PROJECT_ID_IN_EDITOR_PATH,
      (_all, prefix: string, tail: string) =>
        prefix + PROJECT_ID_PLACEHOLDER + tail,
    );
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
  const searchPage = quickSearchPage(path);
  if (searchPage) {
    const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/?]*/i.exec(noFragment)?.[0] || '';
    return (
      origin +
      '/project/:projectId/' +
      searchPage +
      (searchPage === 'search-schema' ? '/:dbModelId' : '')
    );
  }
  if (
    QUICK_SEARCH_API_ROUTE.test(path.split('?')[0]) ||
    dropQuery ||
    loopbackAgentOrigin(noFragment) ||
    isLinkRoute(path)
  ) {
    return redactResultIds(noFragment.split('?')[0]);
  }
  return redactResultIds(noFragment);
}

const ABSOLUTE_URL = /\bhttps?:\/\/[^\s"'<>`]+/g;
const RELATIVE_LINK_PATH =
  /(^|[\s"'(=:])(\/(?:store|space|project|v0|datatug)\/[^\s"'<>`]+)/g;
const LINK_FRAGMENT_PARTS =
  /#(?:[^\s"'<>`#]*&)?(?:code|pk|evidence|token)=[^\s"'<>`]*/g;

/**
 * Free text (an error message, a breadcrumb message, a span description) as telemetry may see it: every absolute
 * address and every `/store/…` path in it goes through {@link scrubUrl}, and any `#code=`/`#pk=`/`#evidence=` fragment is cut
 * (`#evidence=` is a copied evidence link, evidence-records REQ:copyable-evidence-link).
 */
export function scrubText(text: string, dropQuery: boolean): string {
  // A bare path (`url.path` of a span, the router's own URL) is no address the patterns below see.
  return redactResultIds(text)
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

/** Attributes that hold only the query or the fragment of an address (Sentry's fetch and XHR spans and
 * breadcrumbs set `http.query` and `http.fragment`). */
const QUERY_OR_FRAGMENT_KEYS = new Set(['http.query', 'http.fragment']);

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
    if (QUERY_OR_FRAGMENT_KEYS.has(key)) {
      continue; // the bare `?…`/`#…` of an address, which scrubText cannot recognise as one
    }
    out[key] = scrubDeep(item, dropQuery, depth + 1);
  }
  return out as T;
}
