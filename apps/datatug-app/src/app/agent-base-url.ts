import { getStoreUrl } from '@sneat/api';

/**
 * The two ids of the GitHub store in an address (`GITHUB_STORE_ID` of `@datatug/project-address`, and the bare store
 * type). Written out here, not imported: this runs at start-up, and importing the constant makes the bundler keep
 * the whole of that module in the initial bundle (about 3 kB); the spec asserts they are the same.
 */
export const GITHUB_STORE_IDS: readonly string[] = ['github.com', 'github'];

/** The store whose agent is used when the address names none: the default local agent (`datatug serve`). */
export const DEFAULT_AGENT_STORE_ID = 'localhost:8989';

/**
 * The agent base URL of a page that has no agent: a GitHub project is read from GitHub, never from an agent, and
 * this is not an address any request can reach (`about:` has no network). The agent base URL token must not be
 * empty (the semantic client's agent context throws on an empty one), and must not fall back to the local agent: a
 * visitor's browser would then call `localhost:8989` from a public page.
 */
export const NO_AGENT_BASE_URL = 'about:blank';

/** The first path segment as the router reads it: `//project`, `/(project/…)`, `/Project;a=1` are all `project`. */
function firstSegmentOf(pathname: string): string {
  const path = pathname.replace(/^\/+/, '').replace(/^\(/, '');
  return (path.split(/[/;()]/)[0] ?? '').toLowerCase();
}

/** The store of a store address (`/store/<id>…`) that names no project, or none. */
function storeIdOfStorePath(pathname: string): string | undefined {
  const segments = pathname.split('/');
  if (segments[1] !== 'store' || !segments[2]) {
    return undefined;
  }
  try {
    return decodeURIComponent(segments[2]);
  } catch {
    return segments[2];
  }
}

/**
 * The base URL of the agent API (`<agent>/datatug`) for the page at `pathname` (design
 * `demo-as-github-project.md` 3.4: `main.ts` read the store id out of `/store/<id>` and fell back to the local agent
 * on any other address, which gave a GitHub project at its short address `/project/github.com/…` an agent address).
 *
 * - any `/project/…` address (the short address of a GitHub project, or the hand-off address the holding page
 *   answers), and the GitHub store at its old addresses: no agent ({@link NO_AGENT_BASE_URL});
 * - `/store/<id>` and `/store/<id>/project/<id>/…`: the agent of that store;
 * - any other address: the default local agent.
 *
 * Only the STORE is read, never the project, so this does not need `parseProjectUrl` (which is not part of the
 * initial bundle: this runs at start-up, and the parser would add about 7 kB of it).
 */
export function agentBaseUrlOfPath(pathname: string): string {
  if (firstSegmentOf(pathname) === 'project') {
    return NO_AGENT_BASE_URL;
  }
  const storeId = storeIdOfStorePath(pathname) ?? DEFAULT_AGENT_STORE_ID;
  return GITHUB_STORE_IDS.includes(storeId)
    ? NO_AGENT_BASE_URL
    : `${getStoreUrl(storeId)}/datatug`;
}
