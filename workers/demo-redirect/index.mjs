// demo.datatug.app: a vanity address for the DataTug.app live demo (founder 2026-10-23). Every request is
// redirected to https://datatug.app/demo, which opens the demo project; the path and the query string are kept
// (`demo.datatug.app/sqlite?utm_source=x` -> `datatug.app/demo/sqlite?utm_source=x`). A fragment never reaches the
// server; the browser carries it over the redirect itself.
//
// A Worker of its own (wrangler.jsonc next to this file), not a script in front of the app's Worker: the app is
// served from static assets without invoking any script, and putting one first (`run_worker_first`) would make
// every request of datatug.app a billed Worker invocation for the sake of one hostname.

import { REDIRECT_STATUS, demoRedirectLocation } from './redirect.mjs';

export default {
  fetch(request) {
    return new Response(null, {
      status: REDIRECT_STATUS,
      headers: {
        Location: demoRedirectLocation(request.url),
        'Cache-Control': 'no-store',
      },
    });
  },
};
