import { IStoreRef, parseStoreRef } from '@sneat/core';
import { IProjectRef } from '../core/project-context';
import { ITableFull } from '../models/definition/apis/database';
import { IEnvironmentSummary } from '../models/definition/environments';
import { IProjectSummary, IProjEnv } from '../models/definition/project';
import { IDatatugStoreBrief, IProjectBrief } from '../models/interfaces';

/** Matches a bare `host:port` store id, e.g. `"localhost:8989"`. */
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
 */
export function parseDatatugStoreRef(storeId?: string): IStoreRef {
  if (storeId && HOST_PORT_STORE_ID.test(storeId)) {
    return { type: 'agent', url: storeId };
  }
  return parseStoreRef(storeId);
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
