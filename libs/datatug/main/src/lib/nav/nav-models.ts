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
