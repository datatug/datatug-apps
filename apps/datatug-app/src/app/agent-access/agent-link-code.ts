import { agentBaseUrlOfPath } from '../agent-base-url';

/**
 * A one-time code of a local DataTug agent, read from the fragment of the address the page was opened at
 * (`…#code=<code>&pk=…`, printed by `datatug daemon url` and `datatug serve`), and the agent origin it was minted for.
 * The page trades it once for the agent's session token (see {@link AgentAccessService}).
 */
export interface AgentLinkCode {
  readonly origin: string;
  readonly code: string;
}

/** The longest code accepted; a code is a few dozen characters. */
const MAX_CODE_LENGTH = 512;
/** A code is opaque to the page: a short run of URL-safe characters, nothing that could be a URL or markup. */
const CODE_SHAPE = /^[A-Za-z0-9._~-]+$/;

/**
 * The origin of a loopback agent (`http(s)://127.0.0.1|localhost|[::1][:port]`), or undefined for any other address.
 * Only a loopback agent ever gets a code exchanged with it or the session token sent to it.
 */
export function loopbackAgentOrigin(url: string): string | undefined {
  if (!/^https?:\/\//i.test(url)) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return undefined;
  }
  if (parsed.username || parsed.password) {
    return undefined;
  }
  const host = parsed.hostname;
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]'
    ? parsed.origin
    : undefined;
}

/**
 * Takes the one-time code out of the address before anything else reads it: the `code=` part of the fragment is
 * removed from the address bar (`history.replaceState`, no navigation), every other fragment part (the record key
 * `pk=`) is kept as it was written. Runs first in `main.ts`, before Sentry, PostHog or the router start, so no
 * telemetry, history entry or `Referer` ever holds the code.
 *
 * Returns the code with the origin of the agent the address names (`/store/http-127.0.0.1:<port>/…`), or undefined
 * when there is no code, the code is not code-shaped, or the address names no loopback agent (the code is still
 * removed from the address bar then).
 */
export function takeAgentLinkCode(
  loc: Pick<Location, 'pathname' | 'search' | 'hash'>,
  hist: Pick<History, 'replaceState' | 'state'>,
): AgentLinkCode | undefined {
  const fragment = loc.hash.replace(/^#/, '');
  if (!fragment) {
    return undefined;
  }
  // Only the parts before the record key are looked at: `pk=` is always last (`code=…&pk=…`), and after the
  // router has rewritten the address bar a `&` inside a key value is bare, so a key holding `&code=` must never be
  // cut into.
  const all = fragment.split('&');
  const pkAt = all.findIndex((part) => part.startsWith('pk='));
  const head = pkAt < 0 ? all : all.slice(0, pkAt);
  const tail = pkAt < 0 ? [] : [all.slice(pkAt).join('&')];
  const codeParts = head.filter((part) => part.startsWith('code='));
  if (!codeParts.length) {
    return undefined;
  }
  const kept = [...head.filter((part) => !part.startsWith('code=')), ...tail];
  hist.replaceState(
    hist.state,
    '',
    loc.pathname + loc.search + (kept.length ? '#' + kept.join('&') : ''),
  );
  if (codeParts.length !== 1) {
    return undefined;
  }
  let code: string;
  try {
    code = decodeURIComponent(codeParts[0].slice('code='.length));
  } catch {
    return undefined;
  }
  if (!code || code.length > MAX_CODE_LENGTH || !CODE_SHAPE.test(code)) {
    return undefined;
  }
  const origin = loopbackAgentOrigin(agentBaseUrlOfPath(loc.pathname));
  return origin ? { origin, code } : undefined;
}
