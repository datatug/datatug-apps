// The redirect rule of demo.datatug.app (index.mjs). Kept apart from index.mjs: the Workers runtime reads every
// named export of the entry module as an entrypoint and refuses one that is not a handler.

/** Where the demo lives. The host is fixed: nothing in the request can send the visitor to another site. */
export const DEMO_URL = 'https://datatug.app/demo';

/** 302, not 301: the address's target may still change, and a browser keeps a 301 for good. */
export const REDIRECT_STATUS = 302;

/** The datatug.app address for a request URL on demo.datatug.app. */
export function demoRedirectLocation(requestUrl) {
  const { pathname, search } = new URL(requestUrl);
  return DEMO_URL + (pathname === '/' ? '' : pathname) + search;
}
