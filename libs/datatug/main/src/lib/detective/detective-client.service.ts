import {
  HttpClient,
  HttpErrorResponse,
  HttpParams,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { DatatugApiService } from '../services/base/datatug-api.service';
import type { RunQueryResponse } from '@sneat/datatug-semantic';
import { Observable, throwError } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { buildAgentUrl } from '../services/repo/agent-url';
import {
  DetectiveActionRequest,
  DetectiveActionResponse,
  DetectiveExecutionRef,
  DetectiveState,
} from './models';
import {
  HostedIncidentAction,
  HostedIncidentLinks,
  HostedProjectIncidents,
  HostedProjectIncident,
  HostedIncidentResponse,
  HostedKnowledgeAction,
  HostedKnowledgePage,
  HostedKnowledgeResponse,
} from './hosted-linkage.models';
import {
  AiConfirmReceipt,
  AiContextReview,
  AiGenerateResponse,
  AiProposal,
  AiProposalsPage,
  AiReviewedDraft,
} from './detective-ai.models';

export type DetectiveRequestContext =
  | {
      readonly kind: 'agent';
      readonly agentStoreId: string;
      readonly project: string;
      readonly securityContextId: string;
      readonly branch?: string;
      readonly principal?: string;
    }
  | {
      readonly kind: 'cloud';
      readonly storage: 'firestore';
      readonly spaceID: string;
      readonly project: string;
      readonly branch?: string;
      readonly principal?: string;
    };

export function detectiveErrorMessage(error: unknown, cloud = false): string {
  if (error instanceof HttpErrorResponse) {
    switch (error.status) {
      case 0:
        return cloud
          ? 'Could not reach DataTug cloud. Check your connection and retry.'
          : 'Could not reach this project agent. Check that it is running and reload.';
      case 401:
        return 'Sign in to access this Detective project.';
      case 403:
        return cloud
          ? 'This account cannot access the Detective project in its Space.'
          : 'This security context cannot access the Detective project store.';
      case 404:
      case 501:
        return cloud
          ? 'Hosted Detective is unavailable for this project.'
          : 'This agent does not provide Detective yet. Update the local agent and reload.';
      case 409:
        return 'This definition changed since it was opened. Reload and review the latest version before saving.';
      default:
        return typeof error.error?.error?.message === 'string'
          ? error.error.error.message
          : typeof error.error?.message === 'string'
            ? error.error.message
            : error.message;
    }
  }
  return error instanceof Error
    ? error.message
    : cloud
      ? 'The Detective cloud request failed.'
      : 'The Detective agent request failed.';
}

export interface CaseEventsPage {
  caseId: string;
  events: import('./models').CaseEvent[];
  nextBefore?: number;
  hasMore: boolean;
}

export interface HostedQueryResponse {
  result: RunQueryResponse & { readonly execution?: DetectiveExecutionRef };
  queryRevision: string;
  resultFingerprint: string;
  receipt?: unknown;
}

export function normalizeDetectiveState(
  state: DetectiveState | null | undefined,
): DetectiveState {
  const raw = (state || {}) as Partial<DetectiveState>;
  const checks = raw.checks || [];
  const scenarios = raw.scenarios || [];
  const normalizeScenario = (scenario: DetectiveState['scenarios'][number]) => ({
    ...scenario,
    inputs: scenario.inputs || [],
    steps: (scenario.steps || []).map((step) => ({
      ...step,
      bindings: step.bindings || [],
    })),
  });
  return {
    checks: checks.map((check) => ({
      ...check,
      inputs: check.inputs || [],
      steps: (check.steps || []).map((step) => ({
        ...step,
        bindings: step.bindings || [],
        validators: (step.validators || []).map((validator) => ({
          ...validator,
          bindings: validator.bindings || [],
        })),
      })),
    })),
    validators: (raw.validators || []).map((validator) => ({
      ...validator,
      validator: validator.validator
        ? {
            ...validator.validator,
            bindings: validator.validator.bindings || [],
          }
        : validator.validator,
    })),
    queryValidators: (raw.queryValidators || []).map((queryValidators) => ({
      ...queryValidators,
      validators: (queryValidators.validators || []).map((validator) => ({
        ...validator,
        bindings: validator.bindings || [],
      })),
    })),
    cases: (raw.cases || []).map((item) => ({
      ...item,
      context: item.context || {},
      incidentRefs: item.incidentRefs || [],
      scenarioRefs: item.scenarioRefs || [],
      scenarioApplications: (item.scenarioApplications || []).map(
        (application) => ({
          ...application,
          snapshot: application.snapshot
            ? normalizeScenario(application.snapshot)
            : application.snapshot,
          steps: application.steps || [],
        }),
      ),
      runRefs: item.runRefs || [],
      evidence: item.evidence || [],
      findings: item.findings || [],
      timeline: item.timeline || [],
    })),
    runs: raw.runs || [],
    runsHasMore: raw.runsHasMore === true,
    ...(raw.runsNextCursor ? { runsNextCursor: raw.runsNextCursor } : {}),
    scenarios: scenarios.map(normalizeScenario),
    ...(raw.environments ? { environments: raw.environments } : {}),
    capabilities: raw.capabilities || {
      localOnly: true,
      canRead: false,
      canWrite: false,
      canRun: false,
      maxRows: 0,
      maxFanout: 0,
    },
  };
}

export const detectiveOperationId = (): string =>
  `operation-${crypto.randomUUID()}`;

/** Mutations use the selected server boundary; the browser never writes project records directly. */
@Injectable({ providedIn: 'root' })
export class DetectiveClientService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(DatatugApiService);
  private readonly pendingOperations = new Map<string, string>();

  private cloudParams(
    context: Extract<DetectiveRequestContext, { kind: 'cloud' }>,
  ): HttpParams {
    return new HttpParams()
      .set('storage', context.storage)
      .set('spaceID', context.spaceID)
      .set('project', context.project);
  }

  state(
    context: DetectiveRequestContext,
    runsBefore?: string,
  ): Observable<DetectiveState> {
    if (context.kind === 'cloud') {
      return this.api
        .get<DetectiveState>(
          'datatug/detective/state',
          runsBefore
            ? this.cloudParams(context).set('runsBefore', runsBefore)
            : this.cloudParams(context),
        )
        .pipe(map(normalizeDetectiveState));
    }
    return this.http
      .get<DetectiveState>(
        buildAgentUrl(context.agentStoreId, '/detective/state'),
        {
          params: new HttpParams()
            .set('project', context.project)
            .set('securityContextId', context.securityContextId)
            .set('runsBefore', runsBefore || ''),
        },
      )
      .pipe(map(normalizeDetectiveState));
  }

  action(
    context: DetectiveRequestContext,
    action: Omit<DetectiveActionRequest, 'project' | 'securityContextId'>,
    ifMatch?: number,
  ): Observable<DetectiveActionResponse> {
    const key = JSON.stringify(['action', context, action, ifMatch]);
    const operationId =
      this.pendingOperations.get(key) ?? detectiveOperationId();
    this.pendingOperations.set(key, operationId);
    if (context.kind === 'cloud') {
      const resourceVersion =
        action.check?.version ??
        action.validator?.version ??
        action.queryValidators?.version ??
        action.scenario?.version ??
        action.case?.version;
      const expectedVersion = ifMatch ?? resourceVersion;
      const payload = {
        storage: context.storage,
        spaceID: context.spaceID,
        project: context.project,
        ...action,
        ...(expectedVersion === undefined ? {} : { ifMatch: expectedVersion }),
      };
      return this.api
        .post<DetectiveActionResponse>('datatug/detective/action', {
          ...payload,
          operationId,
        })
        .pipe(
          tap({
            next: (response) => {
              if (response.run?.executionStatus !== 'pending')
                this.pendingOperations.delete(key);
            },
          }),
        );
    }
    return this.http
      .post<DetectiveActionResponse>(
        buildAgentUrl(context.agentStoreId, '/detective/action'),
        {
          ...action,
          project: context.project,
          securityContextId: context.securityContextId,
          operationId,
        },
        { params: new HttpParams().set('project', context.project) },
      )
      .pipe(
        tap({
          next: (response) => {
            if (response.run?.executionStatus !== 'pending')
              this.pendingOperations.delete(key);
          },
        }),
      );
  }

  caseEvents(
    context: DetectiveRequestContext,
    caseId: string,
    before?: number,
  ): Observable<CaseEventsPage> {
    if (context.kind === 'cloud') {
      return this.api.get<CaseEventsPage>(
        'datatug/detective/case_events',
        this.cloudParams(context)
          .set('caseId', caseId)
          .set('before', before === undefined ? '' : String(before)),
      );
    }
    return this.http.get<CaseEventsPage>(
      buildAgentUrl(context.agentStoreId, '/detective/case-events'),
      {
        params: new HttpParams()
          .set('project', context.project)
          .set('securityContextId', context.securityContextId)
          .set('caseId', caseId)
          .set('before', before === undefined ? '' : String(before)),
      },
    );
  }

  demoProject(
    spaceID: string | undefined,
    operationId: string,
  ): Observable<{ storeId: 'firestore'; spaceID: string; projectId: string }> {
    if (spaceID && !/^[A-Za-z0-9_-]{1,128}$/.test(spaceID))
      return throwError(() => new Error('Invalid Personal Space reference.'));
    return this.api.post<{
      storeId: 'firestore';
      spaceID: string;
      projectId: string;
    }>('datatug/detective/demo_project', {
      ...(spaceID ? { spaceID } : {}),
      operationId,
    });
  }

  linkedIncidents(
    context: DetectiveRequestContext,
    caseId: string,
  ): Observable<HostedIncidentLinks> {
    if (context.kind === 'agent')
      return this.http.get<HostedIncidentLinks>(
        buildAgentUrl(context.agentStoreId, '/detective/incidents'),
        {
          params: new HttpParams()
            .set('project', context.project)
            .set('securityContextId', context.securityContextId)
            .set('caseId', caseId),
        },
      );
    return this.api.get<HostedIncidentLinks>(
      'datatug/detective/incidents',
      this.cloudParams(context).set('caseId', caseId),
    );
  }

  projectIncidents(
    context: Extract<DetectiveRequestContext, { kind: 'cloud' }>,
    environment: string,
  ): Observable<HostedProjectIncidents> {
    return this.api.get<HostedProjectIncidents>(
      'datatug/detective/project_incidents',
      this.cloudParams(context).set('environment', environment),
    );
  }

  projectIncident(
    context: Extract<DetectiveRequestContext, { kind: 'cloud' }>,
    environment: string,
    incidentRef: string,
  ): Observable<HostedProjectIncident> {
    return this.api.get<HostedProjectIncident>(
      'datatug/detective/incident',
      this.cloudParams(context)
        .set('environment', environment)
        .set('incidentRef', incidentRef),
    );
  }

  incidentAction(
    context: DetectiveRequestContext,
    action: HostedIncidentAction,
  ): Observable<HostedIncidentResponse> {
    const payload =
      context.kind === 'cloud'
        ? {
            storage: context.storage,
            spaceID: context.spaceID,
            project: context.project,
            ...action,
          }
        : {
            project: context.project,
            securityContextId: context.securityContextId,
            ...action,
          };
    const key = JSON.stringify(['incident_action', payload]);
    const operationId =
      this.pendingOperations.get(key) ?? detectiveOperationId();
    this.pendingOperations.set(key, operationId);
    const request =
      context.kind === 'cloud'
        ? this.api.post<HostedIncidentResponse>(
            'datatug/detective/incident_action',
            { ...payload, operationId },
          )
        : this.http.post<HostedIncidentResponse>(
            buildAgentUrl(context.agentStoreId, '/detective/incident-action'),
            { ...payload, operationId },
          );
    return request.pipe(
      tap({ next: () => this.pendingOperations.delete(key) }),
    );
  }

  knowledgeProposals(
    context: DetectiveRequestContext,
    after?: string,
  ): Observable<HostedKnowledgePage> {
    if (context.kind === 'agent')
      return this.http.get<HostedKnowledgePage>(
        buildAgentUrl(context.agentStoreId, '/detective/knowledge_proposals'),
        {
          params: new HttpParams()
            .set('project', context.project)
            .set('securityContextId', context.securityContextId)
            .set('after', after || ''),
        },
      );
    return this.api.get<HostedKnowledgePage>(
      'datatug/detective/knowledge_proposals',
      after
        ? this.cloudParams(context).set('after', after)
        : this.cloudParams(context),
    );
  }

  knowledgeAction(
    context: DetectiveRequestContext,
    action: HostedKnowledgeAction,
  ): Observable<HostedKnowledgeResponse> {
    const payload =
      context.kind === 'cloud'
        ? {
            storage: context.storage,
            spaceID: context.spaceID,
            project: context.project,
            ...action,
          }
        : { storage: 'local' as const, project: context.project, ...action };
    const key = JSON.stringify(['knowledge_proposal_action', payload]);
    const operationId =
      this.pendingOperations.get(key) ?? detectiveOperationId();
    this.pendingOperations.set(key, operationId);
    const request =
      context.kind === 'cloud'
        ? this.api.post<HostedKnowledgeResponse>(
            'datatug/detective/knowledge_proposal_action',
            { ...payload, operationId },
          )
        : this.http.post<HostedKnowledgeResponse>(
            buildAgentUrl(
              context.agentStoreId,
              '/detective/knowledge_proposal_action',
            ),
            { ...payload, operationId },
            {
              params: new HttpParams()
                .set('project', context.project)
                .set('securityContextId', context.securityContextId),
            },
          );
    return request.pipe(
      tap({ next: () => this.pendingOperations.delete(key) }),
    );
  }

  aiProposals(
    context: DetectiveRequestContext,
    after?: string,
  ): Observable<AiProposalsPage> {
    if (context.kind === 'cloud')
      return this.api.get<AiProposalsPage>(
        'datatug/detective/ai_proposals',
        after
          ? this.cloudParams(context).set('after', after)
          : this.cloudParams(context),
      );
    return this.http.get<AiProposalsPage>(
      buildAgentUrl(context.agentStoreId, '/detective/ai_proposals'),
      {
        params: new HttpParams()
          .set('project', context.project)
          .set('securityContextId', context.securityContextId)
          .set('after', after || ''),
      },
    );
  }

  aiGenerate(
    context: DetectiveRequestContext,
    text: string,
    caseId?: string,
    expectedCounts?: Record<string, number>,
  ): Observable<AiGenerateResponse> {
    const request = {
      text,
      ...(caseId ? { caseId } : {}),
      ...(expectedCounts && Object.keys(expectedCounts).length
        ? { expectedCounts }
        : {}),
    };
    const key = JSON.stringify(['ai-generate', context, request]);
    const operationId =
      this.pendingOperations.get(key) ?? detectiveOperationId();
    this.pendingOperations.set(key, operationId);
    const result =
      context.kind === 'cloud'
        ? this.api.post<AiGenerateResponse>('datatug/detective/ai_proposals', {
            storage: context.storage,
            spaceID: context.spaceID,
            project: context.project,
            operationId,
            ...request,
          })
        : this.http.post<AiGenerateResponse>(
            buildAgentUrl(context.agentStoreId, '/detective/ai_proposals'),
            {
              project: context.project,
              securityContextId: context.securityContextId,
              operationId,
              ...request,
            },
          );
    return result.pipe(tap({ next: () => this.pendingOperations.delete(key) }));
  }

  aiReview(
    context: DetectiveRequestContext,
    request: { review: AiReviewedDraft } | { contextReview: AiContextReview },
  ): Observable<AiProposal> {
    if (context.kind === 'cloud')
      return this.api.post<AiProposal>('datatug/detective/ai_review', {
        storage: context.storage,
        spaceID: context.spaceID,
        project: context.project,
        ...('review' in request
          ? { type: 'draft', draft: request.review }
          : { type: 'context', context: request.contextReview }),
      });
    return this.http.post<AiProposal>(
      buildAgentUrl(context.agentStoreId, '/detective/ai_review'),
      {
        project: context.project,
        securityContextId: context.securityContextId,
        ...('review' in request
          ? { type: 'draft', draft: request.review }
          : { type: 'context', context: request.contextReview }),
      },
      { params: new HttpParams().set('project', context.project) },
    );
  }

  aiConfirm(
    context: DetectiveRequestContext,
    proposal: Pick<AiProposal, 'id' | 'digest'>,
  ): Observable<AiConfirmReceipt> {
    const key = JSON.stringify(['ai-confirm', context, proposal]);
    const operationId =
      this.pendingOperations.get(key) ?? detectiveOperationId();
    this.pendingOperations.set(key, operationId);
    const body = {
      proposalId: proposal.id,
      digest: proposal.digest,
      operationId,
    };
    const result =
      context.kind === 'cloud'
        ? this.api.post<AiConfirmReceipt>('datatug/detective/ai_confirm', {
            storage: context.storage,
            spaceID: context.spaceID,
            project: context.project,
            ...body,
          })
        : this.http.post<AiConfirmReceipt>(
            buildAgentUrl(context.agentStoreId, '/detective/ai_confirm'),
            {
              project: context.project,
              securityContextId: context.securityContextId,
              ...body,
            },
            { params: new HttpParams().set('project', context.project) },
          );
    return result.pipe(tap({ next: () => this.pendingOperations.delete(key) }));
  }

  runHostedQuery(
    context: Extract<DetectiveRequestContext, { kind: 'cloud' }>,
    queryId: string,
    environment: string,
    inputs: Record<string, import('./models').DetectiveInputValue>,
  ): Observable<HostedQueryResponse> {
    const payload = {
      storage: context.storage,
      spaceID: context.spaceID,
      project: context.project,
      queryId,
      environment,
      inputs,
    };
    const key = JSON.stringify(payload);
    const operationId =
      this.pendingOperations.get(key) ?? detectiveOperationId();
    this.pendingOperations.set(key, operationId);
    return this.api
      .post<HostedQueryResponse>('datatug/queries/run_query', {
        ...payload,
        operationId,
      })
      .pipe(tap({ next: () => this.pendingOperations.delete(key) }));
  }
}
