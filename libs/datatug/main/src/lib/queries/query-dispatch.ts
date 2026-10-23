import type { AppliedEvidenceRequest } from '../evidence/applied-evidence';
import type { IQueryDef } from '../models/definition/query-def';
import type { ExecutionBindingOrigin, TypedValue } from '@sneat/datatug-semantic';
import { isLocalProjectRef, type IProjectRef } from '../core/project-context';
import type { OvdbConnection } from '../ovdb/ovdb-connection';
import { QueryType } from '../models/definition/query-def';
import type { FederatedQueryMode, FederatedQueryProgress, FederatedQueryResult } from './federated-query-executor';
import type { FederatedRunExtras, LocalResultRef } from './federated-query.service';
import type { RunQueryRequest } from '@sneat/datatug-semantic';
import type { HostedQueryResponse } from '../detective/detective-client.service';

/** Client-authored admission failure whose message is safe to show in a board card. */
export class QueryDispatchError extends Error {}

/** Runtime selection is separate from the reference used to load a definition. */
export type QueryRuntimeTarget =
  | { readonly kind: 'local-agent'; readonly agentStoreId: string }
  | { readonly kind: 'hosted-cloud' }
  | { readonly kind: 'ovdb-federation' }
  | { readonly kind: 'ovdb-connection'; readonly connectionId: string; readonly databaseId: string }
  | { readonly kind: 'browser-sqlite' };

export interface QueryDispatchRequest {
  readonly evidence?: AppliedEvidenceRequest;
  readonly operationId?: string;
  readonly principal?: string;
  readonly projectRef: IProjectRef;
  readonly definition: IQueryDef;
  /** Canonical path-qualified saved-query identity; never derive it from a basename. */
  readonly queryId?: string;
  readonly environment?: string;
  readonly target?: QueryRuntimeTarget;
  readonly securityContextId?: string;
  readonly agentRequest?: RunQueryRequest;
  readonly hostedInputs?: Readonly<Record<string, TypedValue>>;
  /** Explicit runtime object selected by the open database session; its fetch stays request-owned. */
  readonly runtimeBinding?: OvdbConnection;
  /** Opaque identity of a currently registered provider-owned browser runtime. */
  readonly runtimeSelectionId?: string;
  /** Explicit runtime object selected by the open database session; its fetch stays request-owned. */
  readonly federationRun?: {
    readonly token?: string;
    readonly mode?: FederatedQueryMode;
    readonly onProgress?: (progress: FederatedQueryProgress) => void;
    readonly onFinished?: (totalRows: number) => void;
    readonly extras?: FederatedRunExtras;
  };
  readonly parameters?: Readonly<Record<string, TypedValue>>;
  readonly bindingOrigins?: readonly ExecutionBindingOrigin[];
  /**
   * Browser SQLite only: a session that downloads each pinned fixture once and
   * keeps one worker for several statements (for example one lookup dialog).
   * Without it every statement fetches the fixture and starts its own worker.
   */
  readonly browserSqliteSession?: import('./browser-sqlite-query.service').BrowserSqliteSession;
  /** Called only once a browser worker has accepted the prepared request. */
  readonly onDispatched?: () => void;
  readonly signal?: AbortSignal;
}

export interface QueryConnectionDescriptor {
  readonly id?: string;
  readonly title?: string;
  readonly dataset?: string;
  readonly storage?: string;
  readonly source?: string;
  readonly readiness?: string;
  readonly query?: string;
  readonly environment?: string;
  readonly environments?: readonly string[];
  readonly fixtureSha256?: string;
  readonly browserFixture?: {
    readonly url?: string;
    readonly bytes?: number;
    readonly sourceRights?: { readonly url: string; readonly bytes: number; readonly sha256: string };
  };
}

export interface QueryDispatchPlan {
  readonly projectRef: IProjectRef;
  readonly definition: IQueryDef;
  readonly connection?: QueryConnectionDescriptor;
  readonly target: QueryRuntimeTarget;
  readonly environment?: string;
  readonly runtimeBinding?: OvdbConnection;
  readonly runtimeSelectionId?: string;
}

export interface QueryExecutionSession {
  readonly result: Promise<FederatedQueryResult>;
  readonly hostedResponse?: Promise<HostedQueryResponse>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
  getPage?(index: number, resultSet?: string, localResult?: LocalResultRef): Promise<TypedValue[][]>;
  continueSource?(sourceId: string, limit: number, offset: number): Promise<FederatedQueryResult>;
  associateLocalResult?(projectRef: IProjectRef, queryId: string, result: LocalResultRef): Promise<void>;
}

export function captureQueryDispatchRequest(
  request: QueryDispatchRequest,
): QueryDispatchRequest {
  if (!request.projectRef || !request.definition)
    throw new QueryDispatchError('A project reference and query definition are required to run this query.');
  const { signal, runtimeBinding, federationRun, onDispatched, browserSqliteSession, ...snapshot } = request;
  const captured = structuredClone({
    ...snapshot,
    projectRef: request.projectRef,
    definition: request.definition,
    ...(request.parameters ? { parameters: request.parameters } : {}),
  });
  // AbortSignal is not structured-cloneable; keep the original request-owned signal.
  const capturedBinding = runtimeBinding
    ? Object.freeze({
      ...runtimeBinding,
      descriptor: Object.freeze(structuredClone(runtimeBinding.descriptor)),
    })
    : undefined;
  const capturedRun = federationRun ? Object.freeze({
    ...federationRun,
    ...(federationRun.extras ? { extras: Object.freeze({
      ...federationRun.extras,
      ...(federationRun.extras.staticSource
        ? { staticSource: Object.freeze(structuredClone(federationRun.extras.staticSource)) }
        : {}),
    }) } : {}),
  }) : undefined;
  return Object.freeze({
    ...captured,
    ...(capturedBinding ? { runtimeBinding: capturedBinding } : {}),
    ...(capturedRun ? { federationRun: capturedRun } : {}),
    ...(onDispatched ? { onDispatched } : {}),
    // A live session object (worker, cached bytes): passed by reference, never cloned.
    ...(browserSqliteSession ? { browserSqliteSession } : {}),
    signal,
  });
}

export function resolveQueryDispatchPlan(
  request: QueryDispatchRequest,
  catalog: { readonly connections?: readonly QueryConnectionDescriptor[] } | null | undefined,
): QueryDispatchPlan {
  const connectionId = request.definition.connectionId;
  const serverOwnedTarget = serverOwnsSourceAdmission(request);
  const matches = !serverOwnedTarget && connectionId ? catalog?.connections?.filter((connection) => connection.id === connectionId) ?? [] : [];
  if (!serverOwnedTarget && connectionId && matches.length !== 1)
    throw new QueryDispatchError(matches.length ? 'The saved query connection is ambiguous.' : 'The saved query connection is missing from this project.');
  const connection = matches[0];
  const target = request.target ?? inferRuntimeTarget(connection, request);
  validateRuntimeTarget(target, connection, request);
  return Object.freeze({
    projectRef: Object.freeze(structuredClone(request.projectRef)),
    definition: Object.freeze(structuredClone(request.definition)),
    ...(connection ? { connection: Object.freeze(structuredClone(connection)) } : {}),
    target: Object.freeze(structuredClone(target)),
    ...(request.environment ? { environment: request.environment } : {}),
    ...(request.runtimeBinding ? { runtimeBinding: request.runtimeBinding } : {}),
    ...(request.runtimeSelectionId ? { runtimeSelectionId: request.runtimeSelectionId } : {}),
  });
}

/** Saved-query servers admit source IDs from their own project/environment bindings. */
export function serverOwnsSourceAdmission(request: QueryDispatchRequest): boolean {
  if (request.target) return request.target.kind === 'hosted-cloud' || request.target.kind === 'local-agent';
  if (request.runtimeBinding || request.runtimeSelectionId) return false;
  return request.projectRef.storeId === 'firestore' && !!request.projectRef.spaceID ||
    isLocalProjectRef(request.projectRef);
}

function inferRuntimeTarget(
  connection: QueryConnectionDescriptor | undefined,
  request: QueryDispatchRequest,
): QueryRuntimeTarget {
  if (request.runtimeBinding) return {
    kind: 'ovdb-connection',
    connectionId: request.runtimeBinding.id,
    databaseId: request.runtimeBinding.databaseId,
  };
  if (request.projectRef.storeId === 'firestore' && request.projectRef.spaceID)
    return { kind: 'hosted-cloud' };
  if (isLocalProjectRef(request.projectRef))
    return { kind: 'local-agent', agentStoreId: request.projectRef.storeId };
  if (request.definition.federation) return { kind: 'ovdb-federation' };
  if (connection?.storage === 'sqlite' && connection.browserFixture)
    return { kind: 'browser-sqlite' };
  throw new QueryDispatchError('Choose a supported execution target before running this saved query.');
}

function validateRuntimeTarget(
  target: QueryRuntimeTarget,
  connection: QueryConnectionDescriptor | undefined,
  request: QueryDispatchRequest,
): void {
  if (request.definition.targets?.length &&
    (target.kind === 'browser-sqlite' || target.kind === 'ovdb-connection' || target.kind === 'ovdb-federation'))
    throw new QueryDispatchError('This saved query has legacy target settings that this browser runtime cannot apply. Choose its agent runtime.');
  if (request.definition.federation && target.kind !== 'ovdb-federation' && target.kind !== 'hosted-cloud' && target.kind !== 'local-agent')
    throw new QueryDispatchError('This saved query is a federation plan and cannot be sent to this browser runtime.');
  if (connection) {
    if (!request.environment && (connection.environment !== undefined || connection.environments !== undefined))
      throw new QueryDispatchError('Select an environment for this saved connection before running the query.');
    const member = connection.environment === undefined
      ? connection.environments === undefined || !!request.environment && connection.environments.includes(request.environment)
      : connection.environment === request.environment;
    if (!member) throw new QueryDispatchError('The selected connection is unavailable in this environment.');
  }
  if (target.kind === 'browser-sqlite') {
    if (
      !connection || connection.storage !== 'sqlite' || !connection.browserFixture ||
      typeof connection.browserFixture.url !== 'string' || typeof connection.fixtureSha256 !== 'string'
    ) throw new QueryDispatchError('This connection has no pinned browser SQLite fixture.');
    return;
  }
  if (target.kind === 'hosted-cloud' && (!request.projectRef.spaceID || !request.environment))
    throw new QueryDispatchError('Hosted execution requires a shared cloud project and selected environment.');
  if (target.kind === 'hosted-cloud' && request.projectRef.storeId !== 'firestore')
    throw new QueryDispatchError('Hosted execution is available only for shared Firestore projects.');
  if (target.kind === 'hosted-cloud' && !request.queryId)
    throw new QueryDispatchError('Hosted execution requires the exact saved query path.');
  if (target.kind === 'ovdb-federation' && !request.definition.federation)
    throw new QueryDispatchError('OVDB execution requires an admitted federation definition.');
  if (target.kind === 'ovdb-connection') {
    const binding = request.runtimeBinding;
    if (!binding || binding.id !== target.connectionId || binding.databaseId !== target.databaseId)
      throw new QueryDispatchError('The selected OVDB runtime binding is missing or changed.');
    if (!connection || connection.id !== request.definition.connectionId ||
      !connection.fixtureSha256 || !/^[a-f0-9]{64}$/u.test(connection.fixtureSha256) ||
      binding.descriptor.canonical?.sha256 !== connection.fixtureSha256)
      throw new QueryDispatchError('The selected OVDB runtime does not match the query connection in this project.');
    if (request.definition.request.queryType !== QueryType.TugQL)
      throw new QueryDispatchError('This OVDB runtime supports structured TugQL queries; raw SQL is unavailable.');
    if (binding.descriptor.capabilities.query !== true && binding.descriptor.capabilities.tugql !== true)
      throw new QueryDispatchError('The selected OVDB runtime does not support query execution.');
  }
  if (target.kind === 'local-agent' && (!target.agentStoreId || !request.environment || !request.securityContextId || !request.queryId))
    throw new QueryDispatchError('Local agent execution requires an explicit agent, exact saved query path, environment and security context.');
  if (target.kind === 'local-agent' && (target.agentStoreId !== request.projectRef.storeId || request.projectRef.branch || request.projectRef.projectApi === 'cloud'))
    throw new QueryDispatchError('This local agent cannot bind the selected project revision to the saved query. Choose a revision-aware runtime.');
}
