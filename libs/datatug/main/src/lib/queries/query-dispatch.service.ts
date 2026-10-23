import { frozenComparison } from '../evidence/retained-comparison-contract';
import { readRetainedQueryResponse } from '../evidence/retained-evidence-contract';
import { PUBLIC_OVDB_DEV_TRANSPORT } from '@sneat/datatug-semantic';
import { createPublicOvdbDevFetch } from './public-ovdb-dev-transport';
import { executeSavedPublicChartQuery, isSavedPublicChartQueryId } from './public-data/public-chart-query';
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type RunQueryRequest, type RunQueryResponse, decodeSourceRightsEvidence } from '@sneat/datatug-semantic';
import { isJoinedDTQLQuery, parseDTQL, type DTQLSchema, type StructuredQuery } from '@dalgo/core';
import { OpenVaultDbDatabase } from '@dalgo/ovdb/client';
import { firstValueFrom, fromEvent, takeUntil, throwIfEmpty, timeout } from 'rxjs';
import type { FederatedQueryResult } from './federated-query-executor';
import { QueryDispatchError, type
  QueryDispatchPlan,
  QueryDispatchRequest,
  QueryExecutionSession,
  QueryConnectionDescriptor,
} from './query-dispatch';
import { captureQueryDispatchRequest, resolveQueryDispatchPlan, serverOwnsSourceAdmission } from './query-dispatch';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { githubProjectAddressForRef } from '../services/project/project-assets-read.service';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { BrowserSqliteQueryService } from './browser-sqlite-query.service';
import { buildAgentUrl } from '../services/repo/agent-url';
import { FederatedQueryService } from './federated-query.service';
import { DetectiveClientService, type HostedQueryResponse } from '../detective/detective-client.service';
import { QueryType, type ITextQueryRequest } from '../models/definition/query-def';
import { ovdbStreamCell } from './ovdb-stream-values';
import { ovdbDatabaseUrl } from '../ovdb/ovdb-connection';
import { QueryRuntimeRegistry, type QueryRuntimeOption } from './query-runtime-registry.service';

const AGENT_STORES = new Set(['github', 'github.com', 'firestore']);
const OVDB_RESPONSE_BYTES = 2 * 1024 * 1024;

function awaitWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(abortError());
    signal.addEventListener('abort', aborted, { once: true });
    void operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

async function boundedOvdbResponse(response: Response, signal: AbortSignal): Promise<Response> {
  const reader = response.body?.getReader();
  if (!reader) return response;
  const chunks: Uint8Array[] = [];
  let size = 0;
  let reachedEnd = false;
  try {
    while (true) {
      if (signal.aborted) throw abortError();
      const { done, value } = await awaitWithAbort(reader.read(), signal);
      if (done) { reachedEnd = true; break; }
      size += value.byteLength;
      if (size > OVDB_RESPONSE_BYTES) throw new QueryDispatchError('The OVDB response exceeds the 2 MiB browser limit. Narrow the query.');
      chunks.push(value);
    }
  } finally {
    if (reachedEnd) reader.releaseLock();
    else void reader.cancel().catch(() => undefined).finally(() => reader.releaseLock());
  }
  const body = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new Response(body.buffer, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function usesProjectApi(ref: QueryDispatchRequest['projectRef']): boolean {
  return ref.projectApi === 'local' || ref.projectApi === 'cloud' ||
    ref.spaceID !== undefined || !AGENT_STORES.has(ref.storeId);
}

function abortError(): Error {
  const error = new Error('The query was cancelled because its execution context changed.');
  error.name = 'AbortError';
  return error;
}

@Injectable({ providedIn: 'root' })
export class QueryDispatchService {
  private readonly devTransport = inject(PUBLIC_OVDB_DEV_TRANSPORT, { optional: true });
  private readonly projectApi = inject(ProjectQueryApiService);
  private readonly github = inject(GithubProjectReaderService);
  private readonly http = inject(HttpClient);
  private readonly browserSqlite = inject(BrowserSqliteQueryService);
  private readonly detectiveClient = inject(DetectiveClientService);
  private readonly queryRuntimes = inject(QueryRuntimeRegistry);
  readonly runtimeRevision = this.queryRuntimes.revision.asReadonly();

  async availableWorkingCopies(request: Pick<QueryDispatchRequest, 'projectRef' | 'definition' | 'environment' | 'signal'>): Promise<readonly QueryRuntimeOption[]> {
    const declaration = await this.connectionDeclaration(request);
    return declaration ? this.queryRuntimes.candidates(declaration).map(({ selectionId, title }) => ({ selectionId, title })) : [];
  }

  /** Every connection the project's catalog declares (the same read a saved query's connection uses). */
  async connectionCatalog(request: Pick<QueryDispatchRequest, 'projectRef' | 'signal'>): Promise<readonly QueryConnectionDescriptor[]> {
    const source = usesProjectApi(request.projectRef)
      ? this.projectApi.connectionCatalog<{ readonly connections?: readonly QueryConnectionDescriptor[] }>(request.projectRef)
      : this.github.getRawJson<{ readonly connections?: readonly QueryConnectionDescriptor[] }>(
          githubProjectAddressForRef(request.projectRef), 'connections/demo-db.json');
    if (request.signal?.aborted) throw abortError();
    const catalog = await firstValueFrom((request.signal
      ? source.pipe(takeUntil(fromEvent(request.signal, 'abort')), throwIfEmpty(abortError))
      : source).pipe(timeout({ first: 10_000 })));
    if (request.signal?.aborted) throw abortError();
    return catalog?.connections ?? [];
  }

  private async connectionDeclaration(request: Pick<QueryDispatchRequest, 'projectRef' | 'definition' | 'environment' | 'signal'>): Promise<QueryConnectionDescriptor | undefined> {
    const connectionId = request.definition.connectionId;
    if (!connectionId) return undefined;
    const matches = (await this.connectionCatalog(request)).filter((item) => item.id === connectionId);
    if (matches.length !== 1) throw new QueryDispatchError('The saved query connection is missing or ambiguous in this project.');
    const declaration = matches[0];
    const environment = request.environment ?? (declaration.storage === 'sqlite' && declaration.browserFixture &&
      request.definition.request.queryType === QueryType.SQL && declaration.environments?.length === 1 ? declaration.environments[0] : undefined);
    if (!environment && (declaration.environment !== undefined || declaration.environments !== undefined))
      throw new QueryDispatchError('Select an environment for this saved connection before running the query.');
    if (declaration.environment !== undefined && declaration.environment !== environment ||
      declaration.environments !== undefined && (!environment || !declaration.environments.includes(environment)))
      throw new QueryDispatchError('The selected connection is unavailable in this environment.');
    return declaration;
  }

  async plan(request: QueryDispatchRequest): Promise<{ request: QueryDispatchRequest; plan: QueryDispatchPlan }> {
    const captured = captureQueryDispatchRequest(request);
    if (captured.signal?.aborted) throw abortError();
    const connection = serverOwnsSourceAdmission(captured) ? undefined : await this.connectionDeclaration(captured);
    if (captured.signal?.aborted) throw abortError();
    const binding = captured.runtimeSelectionId
      ? connection && this.queryRuntimes.resolve(captured.runtimeSelectionId, connection)
      : captured.runtimeBinding;
    if (captured.runtimeSelectionId && !binding)
      throw new QueryDispatchError('The selected working copy is closed or no longer matches this project connection.');
    const environment = captured.environment ?? (connection?.storage === 'sqlite' && connection.browserFixture &&
      captured.definition.request.queryType === QueryType.SQL && connection.environments?.length === 1 ? connection.environments[0] : undefined);
    const boundRequest = { ...captured, ...(environment ? { environment } : {}), ...(binding ? { runtimeBinding: binding } : {}) };
    return { request: boundRequest, plan: resolveQueryDispatchPlan(boundRequest, connection ? { connections: [connection] } : undefined) };
  }

  async execute(request: QueryDispatchRequest, options?: { readonly maxRows: number }): Promise<FederatedQueryResult> {
    return (await this.executeHeld(request, options)).result;
  }

  async executeHeld(request: QueryDispatchRequest, options?: { readonly maxRows: number }): Promise<{ readonly result: FederatedQueryResult; readonly hostedResponse?: HostedQueryResponse }> {
    const session = this.start(request);
    try {
      const [result, hostedResponse] = await Promise.all([session.result, session.hostedResponse]);
      const paired = (value: FederatedQueryResult) => ({result:value,...(hostedResponse?{hostedResponse}:{})});
      if (!options) return paired(result);
      const total = result.totalRows ?? result.recordset.rows.length;
      if (!Number.isSafeInteger(options.maxRows) || options.maxRows < 1 || options.maxRows > 1000 ||
        !Number.isSafeInteger(total) || total < result.recordset.rows.length || total > options.maxRows)
        throw new QueryDispatchError(`This board accepts at most ${options.maxRows} result rows. Narrow the saved query.`);
      if (result.hasMore || result.truncated)
        throw new QueryDispatchError('This board requires a complete saved query result. Narrow the query.');
      if (total === result.recordset.rows.length) return paired(result);
      if (!session.getPage) throw new QueryDispatchError('This runtime cannot read the complete result.');
      const rows: (typeof result.recordset.rows)[number][] = [];
      for (let index = 0; rows.length < total; index++) {
        request.signal?.throwIfAborted();
        const page = await session.getPage(index);
        if (!page.length || rows.length + page.length > total)
          throw new QueryDispatchError('The saved query result pages are incomplete.');
        rows.push(...page);
      }
      request.signal?.throwIfAborted();
      return paired({ ...result, recordset: { ...result.recordset, rows } });
    } finally { await session.dispose(); }
  }

  start(request: QueryDispatchRequest): QueryExecutionSession {
    const controller = new AbortController();
    let federation: FederatedQueryService | undefined;
    let terminal = false;
    let completedSuccessfully = false;
    let terminalPromise: Promise<void> | undefined;
    const endSession = (cancel = true): Promise<void> => {
      if (terminalPromise) return terminalPromise;
      terminal = true;
      // Successful delivery is complete: normal disposal must not cancel its fetch.
      if (cancel || !completedSuccessfully) controller.abort();
      request.signal?.removeEventListener('abort', relayAbort);
      terminalPromise = Promise.resolve().then(async () => {
        try { await federation?.dispose(); } catch { /* Session teardown is best effort. */ }
      });
      return terminalPromise;
    };
    const relayAbort = () => { void endSession(); };
    request.signal?.addEventListener('abort', relayAbort, { once: true });
    if (request.signal?.aborted) relayAbort();
    const ownedRequest = { ...request, signal: controller.signal };
    let hostedResponse: Promise<HostedQueryResponse> | undefined;
    let result: Promise<FederatedQueryResult>;
    if (request.target?.kind === 'hosted-cloud' ||
      !request.target && !request.runtimeBinding && !request.runtimeSelectionId &&
        request.projectRef.storeId === 'firestore' && !!request.projectRef.spaceID) {
      hostedResponse = this.plan(ownedRequest).then(({ request: captured, plan }) => {
        if (terminal || controller.signal.aborted) throw abortError();
        return this.executeHosted(plan, captured);
      });
      result = hostedResponse.then((response) => response.result);
    } else {
      result = this.runOwned(ownedRequest, (service) => { federation = service; });
    }
    result = result.then((value) => {
      completedSuccessfully = true;
      return value;
    });
    void result.catch(() => undefined);
    if (hostedResponse) void hostedResponse.catch(() => undefined);
    const session: QueryExecutionSession = {
      result,
      ...(hostedResponse ? { hostedResponse } : {}),
      cancel: () => endSession(),
      dispose: () => endSession(false),
      getPage: async (index, resultSet, localResult) => {
        const service = await this.federationForResult(result, () => federation);
        return service.getPage(index, resultSet, localResult);
      },
      continueSource: async (sourceId, limit, offset) => {
        const service = await this.federationForResult(result, () => federation);
        return service.continueSource(sourceId, limit, offset);
      },
      associateLocalResult: async (projectRef, queryId, localResult) => {
        const service = await this.federationForResult(result, () => federation);
        await service.associateLocalResult(projectRef, queryId, localResult);
      },
    };
    return Object.freeze(session);
  }

  private async runOwned(
    request: QueryDispatchRequest,
    onFederation: (service: FederatedQueryService) => void,
  ): Promise<FederatedQueryResult> {
    // Existing publisher admission validates exact saved text, source and full rows.
    if (request.queryId && isSavedPublicChartQueryId(request.queryId) &&
      !request.target && !request.runtimeBinding && !request.runtimeSelectionId) {
      const captured = captureQueryDispatchRequest(request);
      return executeSavedPublicChartQuery(request.queryId, captured.definition, { signal: captured.signal,
        ...(this.devTransport ? { fetch: createPublicOvdbDevFetch(this.devTransport) } : {}),
      });
    }
    const { request: captured, plan } = await this.plan(request);
    if (captured.signal?.aborted) throw abortError();
    if (plan.target.kind === 'ovdb-federation') {
      const service = new FederatedQueryService(this.devTransport);
      onFederation(service);
      if (captured.signal?.aborted) { await service.dispose(); throw abortError(); }
      const options = captured.federationRun;
      const result = service.run(
        captured.definition,
        options?.onProgress,
        options?.token,
        options?.mode,
        options?.onFinished,
        options?.extras,
      );
      if (captured.signal) {
        const cancel = () => { void service.dispose().catch(() => undefined); };
        captured.signal.addEventListener('abort', cancel, { once: true });
        void result.finally(() => captured.signal?.removeEventListener('abort', cancel)).catch(() => undefined);
      }
      return result;
    }
    if (captured.signal?.aborted) throw abortError();
    const result = await this.executePlan(plan, captured);
    if (captured.signal?.aborted) throw abortError();
    return result;
  }

  private async federationForResult(
    result: Promise<FederatedQueryResult>,
    service: () => FederatedQueryService | undefined,
  ): Promise<FederatedQueryService> {
    await result;
    const owned = service();
    if (!owned) throw new QueryDispatchError('This query runtime does not retain result pages or source continuations.');
    return owned;
  }

  private async executePlan(plan: QueryDispatchPlan, request: QueryDispatchRequest): Promise<FederatedQueryResult> {
    switch (plan.target.kind) {
      case 'browser-sqlite': return this.browserSqlite.execute(plan, request);
      case 'local-agent': return this.executeLocalAgent(plan, request);
      case 'hosted-cloud': throw new QueryDispatchError('Hosted execution requires its hosted response session.');
      case 'ovdb-federation': throw new QueryDispatchError('Federated execution requires its per-run session.');
      case 'ovdb-connection': return this.executeOvdbConnection(plan, request);
    }
  }

  private async executeLocalAgent(plan: QueryDispatchPlan, request: QueryDispatchRequest): Promise<FederatedQueryResult> {
    if (plan.target.kind !== 'local-agent') throw new QueryDispatchError('Invalid local agent execution plan.');
    const scope = {
      project: request.projectRef.projectId,
      environment: request.environment,
      securityContextId: request.securityContextId,
    };
    if (!scope.environment || !scope.securityContextId)
      throw new QueryDispatchError('Local agent execution requires the selected environment and current security context.');
    const queryId = request.queryId;
    if (!queryId) throw new QueryDispatchError('Local agent execution requires the exact saved query path.');
    const runRequest: RunQueryRequest = request.agentRequest ?? {
      project: scope.project,
      environment: scope.environment,
      securityContextId: scope.securityContextId,
      queryId,
      parameters: request.parameters ?? {},
      bindingOrigins: request.bindingOrigins ?? Object.keys(request.parameters ?? {}).map((parameterId) => ({ parameterId, origin: 'manual' as const })),
      mode: 'live',
    };
    if (runRequest.project !== scope.project || runRequest.environment !== scope.environment ||
      runRequest.securityContextId !== scope.securityContextId || runRequest.queryId !== queryId)
      throw new QueryDispatchError('The local agent request does not match the selected project, query, environment and security context.');
    if (request.agentRequest && request.parameters &&
      JSON.stringify(Object.entries(request.parameters).sort(([a], [b]) => a.localeCompare(b))) !==
      JSON.stringify(Object.entries(runRequest.parameters ?? {}).sort(([a], [b]) => a.localeCompare(b))))
      throw new QueryDispatchError('Local agent inputs differ from the displayed parameter bindings.');
    if (request.agentRequest && request.bindingOrigins &&
      JSON.stringify(request.bindingOrigins) !== JSON.stringify(runRequest.bindingOrigins ?? []))
      throw new QueryDispatchError('Local agent binding origins differ from the displayed parameter bindings.');
    if (request.signal?.aborted) throw abortError();
    let response: RunQueryResponse;
    try {
      const source = this.http.post<RunQueryResponse>(buildAgentUrl(plan.target.agentStoreId, '/exec/run_query'), runRequest);
      response = await firstValueFrom((request.signal
        ? source.pipe(takeUntil(fromEvent(request.signal, 'abort')), throwIfEmpty(abortError))
        : source).pipe(timeout({ first: 30_000 })));
    } catch (error) {
      if (request.signal?.aborted) throw abortError();
      throw error;
    }
    if (request.signal?.aborted) throw abortError();
    if (response.provenance?.queryId && response.provenance.queryId !== queryId)
      throw new QueryDispatchError('The local agent returned a different saved query identity. Reload the query before retrying.');
    return { ...response, ...decodeSourceRightsEvidence(response as unknown as Record<string, unknown>) };
  }

  private async executeHosted(plan: QueryDispatchPlan, request: QueryDispatchRequest): Promise<HostedQueryResponse> {
    if (plan.target.kind !== 'hosted-cloud' || request.projectRef.storeId !== 'firestore' || !request.projectRef.spaceID || !request.environment || !request.queryId)
      throw new QueryDispatchError('Hosted execution requires an exact saved query, shared project and selected environment.');
    if (request.signal?.aborted) throw abortError();
    const context = {
      kind: 'cloud' as const,
      storage: 'firestore' as const,
      spaceID: request.projectRef.spaceID,
      project: request.projectRef.projectId,
      principal: request.principal,
    };
    if (request.hostedInputs && request.parameters && JSON.stringify(request.hostedInputs) !== JSON.stringify(request.parameters))
      throw new QueryDispatchError('Hosted inputs differ from the displayed parameter bindings.');
    const comparison = frozenComparison(request.definition, request.hostedInputs ?? request.parameters ?? {});
    if (comparison && !request.evidence) throw new QueryDispatchError('Comparison requires an explicit applied evidence selection.');
    const source = this.detectiveClient.runHostedQuery(context, request.queryId, request.environment, {
      ...(request.hostedInputs ?? request.parameters ?? {}),
    }, { evidence: request.evidence, operationId: request.operationId, signal: request.signal, ...(comparison ? { comparison } : {}) });
    try {
      const response = await firstValueFrom((request.signal
        ? source.pipe(takeUntil(fromEvent(request.signal, 'abort')), throwIfEmpty(abortError))
        : source).pipe(timeout({ first: 30_000 })));
      if (request.signal?.aborted) throw abortError();
      if (!response.result.execution || response.result.execution.storeId !== request.projectRef.storeId ||
        response.result.execution.projectId !== request.projectRef.projectId ||
        response.result.provenance.queryId !== request.queryId)
        throw new QueryDispatchError('The hosted query returned no matching retained execution receipt.');
      const admitted = await readRetainedQueryResponse(response, { projectRef: request.projectRef, environment: request.environment, actor: request.principal || '' }, request.queryId, request.evidence, comparison ? { declaration: comparison, inputs: request.hostedInputs ?? request.parameters ?? {} } : undefined);
      if (request.signal?.aborted) throw abortError();
      return admitted;
    } catch (error) {
      if (request.signal?.aborted) throw abortError();
      throw error;
    }
  }

  private async executeOvdbConnection(plan: QueryDispatchPlan, request: QueryDispatchRequest): Promise<FederatedQueryResult> {
    const connection = plan.runtimeBinding;
    if (!connection || plan.target.kind !== 'ovdb-connection')
      throw new QueryDispatchError('The selected OVDB runtime binding is unavailable.');
    if (plan.connection?.id !== request.definition.connectionId ||
      !plan.connection?.fixtureSha256 ||
      connection.descriptor.canonical?.sha256 !== plan.connection?.fixtureSha256)
      throw new QueryDispatchError('The selected OVDB runtime does not match the query connection in this project.');
    if (request.runtimeSelectionId && this.queryRuntimes.resolve(request.runtimeSelectionId, plan.connection) !== connection)
      throw new QueryDispatchError('The selected working copy was closed or changed. Choose a current runtime.');
    if (request.definition.request.queryType !== QueryType.TugQL && request.definition.request.queryType !== QueryType.DTQL)
      throw new QueryDispatchError('This OVDB runtime supports DTQL; raw SQL is unavailable.');
    if (Object.keys(request.parameters ?? {}).length || (request.definition.parameters?.length ?? 0) > 0)
      throw new QueryDispatchError('This OVDB query requires parameter binding support that is not available in this runtime.');
    const nativeDtql = connection.descriptor.capabilities.query !== true && connection.descriptor.capabilities.dtql === true;
    if (connection.descriptor.capabilities.query !== true && !nativeDtql)
      throw new QueryDispatchError('The selected OVDB runtime cannot execute this query.');
    const schemas = connection.descriptor.schemas?.collections ?? {};
    const schema: DTQLSchema = {
      tables: Object.entries(schemas).map(([id, value]) => ({
        name: value.source?.name ?? id,
        ...(value.source?.schema ? { schema: value.source.schema } : {}),
        fields: Object.keys(value.fields ?? {}),
      })),
    };
    const parsed = parseDTQL((request.definition.request as ITextQueryRequest).text, schema, { maxLimit: 1000 });
    if (isJoinedDTQLQuery(parsed))
      throw new QueryDispatchError('This OVDB runtime adapter accepts one source table per query. Use the admitted federated runtime for joins.');
    const query = parsed as StructuredQuery<Record<string, unknown>>;
    const deadline = AbortSignal.timeout(30_000);
    const signal = request.signal ? AbortSignal.any([request.signal, deadline]) : deadline;
    const connectionFetch: typeof globalThis.fetch = async (input, init) => {
      if (signal.aborted) throw abortError();
      try {
        const response = await awaitWithAbort(connection.fetch(input, { ...init, signal }), signal);
        return await boundedOvdbResponse(response, signal);
      } catch (error) {
        if (deadline.aborted && !request.signal?.aborted)
          throw new QueryDispatchError('The OVDB query exceeded the 30-second browser limit. Narrow the query.');
        throw error;
      }
    };
    let records: readonly { readonly data: Record<string, unknown> }[];
    let hasContinuation: boolean;
    if (nativeDtql) {
      const response = await connectionFetch(`${ovdbDatabaseUrl(connection.baseUrl, connection.databaseId)}/dtql`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: (request.definition.request as ITextQueryRequest).text }),
        cache: 'no-store', credentials: 'omit',
      });
      if (!response.ok) throw new QueryDispatchError('The selected OVDB runtime refused this DTQL query.');
      const body = await response.json() as { records?: unknown; nextCursor?: unknown };
      if (!Array.isArray(body.records) || !body.records.every((record) =>
        record && typeof record === 'object' && !Array.isArray(record) &&
        'data' in record && record.data && typeof record.data === 'object' && !Array.isArray(record.data)))
        throw new QueryDispatchError('The selected OVDB runtime returned an invalid query result.');
      records = body.records as { readonly data: Record<string, unknown> }[];
      hasContinuation = typeof body.nextCursor === 'string' && body.nextCursor.length > 0;
    } else {
      const database = new OpenVaultDbDatabase({
        baseUrl: connection.baseUrl,
        databaseId: connection.databaseId,
        fetch: connectionFetch,
      });
      const page = await database.query(query);
      records = page.records;
      hasContinuation = page.nextCursor !== undefined;
    }
    if (request.signal?.aborted) throw abortError();
    if (deadline.aborted) throw new QueryDispatchError('The OVDB query exceeded the 30-second browser limit. Narrow the query.');
    if (request.runtimeSelectionId && this.queryRuntimes.resolve(request.runtimeSelectionId, plan.connection) !== connection)
      throw new QueryDispatchError('The selected working copy was closed or changed while the query ran.');
    const declaredColumns = request.definition.recordsets?.[0]?.columns ?? [];
    const names = declaredColumns.length
      ? declaredColumns.map((column) => column.name)
      : Object.keys(records[0]?.data ?? connection.descriptor.schemas?.collections?.[query.source.name]?.fields ?? {});
    if (records.length > 1000 || names.length > 40)
      throw new QueryDispatchError('The OVDB query exceeds the browser limit of 1,000 rows or 40 columns. Narrow the query.');
    const columns = names.map((name) => ({
      name,
      type: declaredColumns.find((column) => column.name === name)?.type ?? 'unknown',
    }));
    return {
      recordset: {
        columns,
        rows: records.map((record) => columns.map((column) => ovdbStreamCell(record.data[column.name], column.type))),
      },
      limitations: hasContinuation ? [{ policy: 'More source rows are available, but this browser runtime has no continuation for this result. Narrow the query or use another runtime.', rowsFiltered: false, hiddenColumns: [] }] : [],
      bindingsApplied: [],
      truncated: hasContinuation || (query.limit !== undefined && records.length >= query.limit),
      hasMore: false,
      provenance: {
        source: `Working copy ${connection.title}`,
        queryId: request.queryId,
        mode: 'live',
        observedAt: new Date().toISOString(),
      },
      browserExecution: {
        runtime: 'ovdb-connection',
        connectionId: connection.id,
        databaseId: connection.databaseId,
        workingCopyModified: connection.descriptor.localState?.modified ?? false,
        ...(connection.descriptor.canonical?.sha256
          ? { canonicalFixtureSha256: connection.descriptor.canonical.sha256 }
          : {}),
      },
    };
  }
}
