// The hand-off from datatug.ai / datatug.io is `datatug.app/demo?scenario=<id>&q=<text>&lang=<en|ru>`.
// It is captured here, before analytics and the router run, and removed from the address bar, so the
// visitor's question is not reported as part of a page URL and a reload does not submit it again.
// The demo page (a lazy-loaded library, which this eager file cannot import) reads it from sessionStorage
// under the same key; demo-handoff-capture.spec.ts asserts the two keys are one.
export const DEMO_HANDOFF_KEY = 'datatug.demo.handoff.v1';

export function captureDemoHandoff(location: Location = window.location, history: History = window.history, storage?: Storage): void {
  if (location.pathname !== '/demo' || !location.search) return;
  try {
    (storage ?? sessionStorage).setItem(DEMO_HANDOFF_KEY, location.search);
  } catch {
    return; // Cannot keep it for the page: leave the query string where the page's router can read it.
  }
  history.replaceState(history.state, '', location.pathname + location.hash);
}
