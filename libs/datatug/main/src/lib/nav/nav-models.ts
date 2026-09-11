import { IStoreRef, parseStoreRef } from '@sneat/core';
import { IProjectRef } from '../core/project-context';
import { ITableFull } from '../models/definition/apis/database';
import { IEnvironmentSummary } from '../models/definition/environments';
import { IProjectSummary, IProjEnv } from '../models/definition/project';
import { IDatatugStoreBrief, IProjectBrief } from '../models/interfaces';

/**
 * Matches a bare `host:port` store id, e.g. `"localhost:8989"`. Deliberately
 * does NOT match an `http-`/`https-` prefixed id (`"http-localhost:8989"`)
 * even though `-` is not excluded by the character class below — that form
 * must fall through to `parseStoreRef()` so its `-` gets turned into `://`
 * (see the `startsWith` guard in `parseDatatugStoreRef` below).
 */
const HOST_PORT_STORE_ID = /^[^\s:@/]+:\d+$/;

/**
 * Matches a legacy full-URL store id/key, e.g. `"http://localhost:8989"` —
 * a form some historic `IDatatugBriefForUser.stores` records still hold
 * (`libs/datatug/main/src/lib/models/interfaces.ts`), predating PR #109's
 * switch of the default local-agent entry to the canonical dash-prefixed
 * key `LOCALHOST_AGENT_STORE_ID` (`"http-localhost:8989"`). A user record
 * keyed this way is already recognised elsewhere as "a localhost store
 * exists" (`isLocalhostAgentStoreId()`, same file), but until S165 this
 * function itself rejected the key outright — `MyStoresComponent.goStore()`
 * → `parseDatatugStoreRef(brief.id)` threw
 * `unsupported format of store id:http://localhost:8989` (founder,
 * 2026-09-11 follow-up 5).
 *
 * Accepts one optional trailing slash — `"http://host:port"` and
 * `"http://host:port/"` name the same agent, so the slash carries no
 * information and is stripped on normalisation. Anything past that (a path,
 * query, or fragment) is deliberately NOT matched: the id names an agent's
 * origin, never a sub-resource, so `"http://host:port/some/path"` falls
 * through to `parseStoreRef()` and throws `unsupported format of store id`
 * like any other malformed id, rather than silently discarding the path.
 */
const HTTP_URL_STORE_ID = /^(https?):\/\/([^/\s]+)\/?$/;

/**
 * Wraps `@sneat/core`'s `parseStoreRef()`. That function only recognises
 * `'firestore'` | `'github'` | `'github.com'` | an `'http-'`/`'https-'`
 * prefixed id, and throws `unsupported format of store id` for anything
 * else — including the bare `host:port` form (`"localhost:8989"`) that
 * `getStoreUrl()` (`@sneat/api`) and every local-agent "connect" flow in
 * this app use as the canonical store id. Recognise that form here, before
 * delegating, so every store-id parse site in datatug-apps accepts it
 * (`unsupported format of store id:localhost:8989` was thrown live
 * navigating to a store/project on a local agent — see
 * `spec/research/2026-09-09-web-ui-audit.md`).
 *
 * The bare-`host:port` short-circuit below must NOT fire for an
 * `http-`/`https-` prefixed id: `HOST_PORT_STORE_ID` matches
 * `"http-localhost:8989"` too (`-` is not excluded by the id's character
 * class), so without the `startsWith` guard this function used to return
 * `{ type: 'agent', url: 'http-localhost:8989' }` — the raw id, verbatim,
 * never converted to a real URL. `parseStoreRef()` is the only place that
 * turns the `-` into `://`, and it only runs for ids WITHOUT a port
 * (`"http-example.com"`), so `"http-localhost:8989"` (the exact form
 * `datatug serve` prints — datatug-cli PR #198) never got a working `.url`.
 * That silently broke every consumer that reads `ref.url` expecting a
 * fetchable URL (e.g. the store page title — see
 * `datatug-store-page.component.ts`'s `storeIdToDisplayLabel` use).
 *
 * Task 13 (S108): this bare/`http-`/`https-` `host:port` id is the ONE
 * store-id/agent-URL convention this app supports. The read-only worktree
 * `.worktrees/datatug-apps-layered-acl-query` registers a second, competing
 * convention (`pwa/repo/:repo/agent/:agentId`); it is deliberately not
 * ported here — see `datatug-app-routes.ts`'s own comment and
 * `spec/research/2026-09-09-layered-acl-reconciliation.md` (datatug/datatug).
 *
 * S165: a legacy full-URL id (`"http://localhost:8989"`, see
 * `HTTP_URL_STORE_ID` above) is ALSO accepted as input — normalised to the
 * canonical dash-prefixed id before delegating, so the returned ref (and
 * every downstream consumer of it) behaves exactly as for the canonical
 * id. This is input tolerance only: the convention above is unchanged, and
 * this function never itself emits a URL-form id.
 */
export function parseDatatugStoreRef(storeId?: string): IStoreRef {
  if (
    storeId &&
    !storeId.startsWith('http-') &&
    !storeId.startsWith('https-') &&
    HOST_PORT_STORE_ID.test(storeId)
  ) {
    return { type: 'agent', url: storeId };
  }
  if (storeId) {
    const urlMatch = HTTP_URL_STORE_ID.exec(storeId);
    if (urlMatch) {
      const [, protocol, hostPort] = urlMatch;
      // Normalise to the canonical dash-prefixed id and fall through to
      // the same `parseStoreRef()` delegation as `"http-localhost:8989"`
      // below — `.url` comes back as the real `http(s)://…` URL (minus any
      // trailing slash) via that function's `-` → `://` conversion, so
      // route segment (`getStoreId()`), display label, and agent detection
      // all behave identically to the canonical id.
      storeId = `${protocol}-${hostPort}`;
    }
  }
  return parseStoreRef(storeId);
}

/**
 * Turns a store id into a human-readable label for UI display. An
 * `'agent'` store id — bare `host:port`, or `http-`/`https-` prefixed —
 * displays as the actual URL the browser will call
 * (`"http://localhost:8989"`) rather than the raw id
 * (`"http-localhost:8989"`); every other store type (`firestore`, `github`,
 * `gitlab`) has no more informative form, so it keeps showing its id.
 * Never throws: falls back to the raw id for anything
 * `parseDatatugStoreRef` cannot parse, so a display site never has to
 * guard this call with try/catch.
 */
export function storeIdToDisplayLabel(storeId?: string | null): string {
  if (!storeId) {
    return '';
  }
  try {
    const ref = parseDatatugStoreRef(storeId);
    return ref.type === 'agent' && ref.url ? ref.url : storeId;
  } catch {
    return storeId;
  }
}

/**
 * True when a store id addresses a DataTug CLI agent (`datatug serve`) —
 * bare `host:port`, or `http-`/`https-` prefixed — in any of the forms
 * `parseDatatugStoreRef` accepts. Never throws: an unparseable id is simply
 * not an agent, so callers can branch on it before deciding whether to fail.
 */
export function isAgentStoreId(storeId?: string | null): boolean {
  if (!storeId) {
    return false;
  }
  try {
    return parseDatatugStoreRef(storeId).type === 'agent';
  } catch {
    return false;
  }
}

export interface IDatatugStoreContext {
  readonly ref: IStoreRef;
  readonly brief?: IDatatugStoreBrief;
}

export interface IProjectContext {
  readonly ref: IProjectRef;
  readonly store?: IDatatugStoreContext;
  readonly brief?: IProjectBrief;
  readonly summary?: IProjectSummary;
}

export function newProjectBriefFromSummary(
  summary: IProjectSummary,
  brief?: IProjectBrief,
): IProjectBrief {
  return {
    ...brief,
    access: summary.access,
    title: summary.title,
    // titleOverride: summary.t
  };
}

export function populateProjectBriefFromSummaryIfMissing(
  p?: IProjectContext,
): IProjectContext | undefined {
  if (p?.summary && !p.brief) {
    p = { ...p, brief: newProjectBriefFromSummary(p.summary) };
  }
  return p;
}

export function newProjectContextFromRef(ref: IProjectRef): IProjectContext {
  return { ref, store: { ref: parseDatatugStoreRef(ref.storeId) } };
}

export interface IEnvContext {
  readonly id: string;
  readonly brief?: IProjEnv;
  readonly summary?: IEnvironmentSummary;
}

export interface IEnvDbContext {
  readonly id: string;
}

export interface IEnvDbTableContext {
  schema: string;
  name: string;
  meta?: ITableFull;
}

export interface IDatatugNavContext {
  readonly projectId?: string;
  readonly envId?: string;
  readonly dbId?: string;
}

export interface IAgentContext {
  protocol: 'http' | 'https';
  host: string;
  port: number;
}

export const getStoreId = (repo: string): string => {
  return (repo || '').replace(/(https?):\/\//, '$1-');
};
