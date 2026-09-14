import { computed, effect, inject, signal, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, type ParamMap } from '@angular/router';
import {
  AgentContextService,
  type ContextScope,
  InvestigationContextService,
} from '@sneat/datatug-semantic';
import {
  routingParamIncidentId,
  routingParamStoreId,
} from '../core/datatug-routing-params';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { agentBaseUrl } from '../services/repo/agent-url';
import {
  incidentEvidenceTargets,
  incidentHypotheses,
  incidentParticipants,
  incidentProjectTargets,
  type IncidentEvidenceTarget,
  type IncidentHypothesisView,
  type IncidentProjectTarget,
} from './incident-evidence-targets';
import { IncidentClientService } from './incident-client.service';
import { resolveIncidentRouteScope } from './incident-route-context';
import {
  incidentStatusProjection,
  type IncidentStatusSentence,
} from './incident-status-projection';
import type {
  IncidentDetail,
  IncidentParticipant,
  IncidentRequestContext,
  IncidentStreamItem,
} from './models';

export interface IncidentPageReads {
  readonly routeParams: Signal<ParamMap>;
  readonly queryParams: Signal<ParamMap>;
  readonly incidentId: Signal<string | undefined>;
  readonly requestContext: Signal<IncidentRequestContext | undefined>;
  readonly incident: ReturnType<typeof signal<IncidentDetail | undefined>>;
  readonly events: ReturnType<
    typeof signal<IncidentStreamItem[] | undefined>
  >;
  readonly isLoading: ReturnType<typeof signal<boolean>>;
  readonly isTimelineLoading: ReturnType<typeof signal<boolean>>;
  readonly unavailableMessage: ReturnType<typeof signal<string | undefined>>;
  readonly timelineMessage: ReturnType<typeof signal<string | undefined>>;
  readonly statusSentences: Signal<readonly IncidentStatusSentence[]>;
  readonly hypotheses: Signal<readonly IncidentHypothesisView[]>;
  readonly evidence: Signal<readonly IncidentEvidenceTarget[]>;
  readonly participants: Signal<readonly IncidentParticipant[]>;
  readonly projects: Signal<readonly IncidentProjectTarget[]>;
  activateInvestigationContext(context: IncidentRequestContext): void;
}

/**
 * Shared URL-scoped incident read model for detail and Resolution Record.
 * Both pages must reconstruct the same incident from route ids and query
 * params; neither may rely on router state.
 */
export function useIncidentPageReads(options?: {
  readonly onTargetChange?: () => void;
}): IncidentPageReads {
  const route = inject(ActivatedRoute);
  const navContext = inject(DatatugNavContextService);
  const agentContext = inject(AgentContextService);
  const investigationContext = inject(InvestigationContextService);
  const incidentClient = inject(IncidentClientService);

  const routeParams = toSignal(route.paramMap, {
    initialValue: route.snapshot.paramMap,
  });
  const queryParams = toSignal(route.queryParamMap, {
    initialValue: route.snapshot.queryParamMap,
  });
  const navAgentStoreId = toSignal(navContext.currentStoreId, {
    initialValue: undefined,
  });
  const navProject = toSignal(navContext.currentProject, {
    initialValue: undefined,
  });
  const navEnvironment = toSignal(navContext.currentEnv, {
    initialValue: undefined,
  });

  const incidentId = computed(
    () => routeParams().get(routingParamIncidentId) || undefined,
  );
  const requestContext = computed<IncidentRequestContext | undefined>(() => {
    const query = queryParams();
    const storeId = routeParams().get(routingParamStoreId) || undefined;
    const routeScope = resolveIncidentRouteScope(
      query,
      {
        agentStoreId: navAgentStoreId(),
        project: navProject(),
        environment: navEnvironment()?.id,
      },
      storeId,
    );
    if (!routeScope) {
      return undefined;
    }
    const { agentStoreId, project, environment } = routeScope;
    const securityContextId = agentStoreId
      ? agentContext.contextFor(agentBaseUrl(agentStoreId)).securityContextId()
      : undefined;
    if (!securityContextId) {
      return undefined;
    }
    return {
      agentStoreId,
      scope: {
        storeId: routeScope.storeId,
        project,
        environment,
        securityContextId,
      },
    };
  });

  const incident = signal<IncidentDetail | undefined>(undefined);
  const events = signal<IncidentStreamItem[] | undefined>(undefined);
  const isLoading = signal(false);
  const isTimelineLoading = signal(false);
  const unavailableMessage = signal<string | undefined>(undefined);
  const timelineMessage = signal<string | undefined>(undefined);
  const statusSentences = computed(() => {
    const current = incident();
    const timeline = events();
    return current && timeline
      ? incidentStatusProjection(current, timeline)
      : [];
  });
  const hypotheses = computed(() => {
    const current = incident();
    return current ? incidentHypotheses(current) : [];
  });
  const evidence = computed(() => {
    const current = incident();
    const context = requestContext();
    return current && context
      ? incidentEvidenceTargets(current.assetRefs, context.agentStoreId)
      : [];
  });
  const participants = computed(() =>
    incidentParticipants(incident()?.participants),
  );
  const projects = computed(() => {
    const current = incident();
    const context = requestContext();
    return current && context
      ? incidentProjectTargets(current.projects, context.agentStoreId)
      : [];
  });

  let recoveryTargetKey: string | undefined;
  let selectedInvestigationScope: Omit<ContextScope, 'agentUrl'> | undefined;
  const staleRecoveryAttempted = signal(false);
  const staleRecoveryInProgress = signal(false);

  const activateInvestigationContext = (
    context: IncidentRequestContext,
  ): void => {
    const investigationScope = {
      project: context.scope.project,
      environment: context.scope.environment,
      securityContextId: context.scope.securityContextId,
    };
    investigationContext.setScope(
      investigationScope,
      agentBaseUrl(context.agentStoreId),
    );
    selectedInvestigationScope = investigationScope;
  };

  effect((onCleanup) => {
    const context = requestContext();
    const currentIncidentId = incidentId();
    const at = queryParams().get('at') || undefined;
    incident.set(undefined);
    events.set(undefined);
    unavailableMessage.set(undefined);
    timelineMessage.set(undefined);
    if (!context || !currentIncidentId) {
      isLoading.set(false);
      isTimelineLoading.set(false);
      return;
    }
    const targetKey = JSON.stringify({
      agentStoreId: context.agentStoreId,
      storeId: context.scope.storeId,
      project: context.scope.project,
      environment: context.scope.environment,
      incidentId: currentIncidentId,
      at,
    });
    const sameTarget = recoveryTargetKey === targetKey;
    if (!sameTarget) {
      recoveryTargetKey = targetKey;
      staleRecoveryAttempted.set(false);
      staleRecoveryInProgress.set(false);
      options?.onTargetChange?.();
    }
    const baseUrl = agentBaseUrl(context.agentStoreId);
    const investigationScope = {
      project: context.scope.project,
      environment: context.scope.environment,
      securityContextId: context.scope.securityContextId,
    };
    if (
      sameTarget &&
      selectedInvestigationScope &&
      !investigationContext.isCurrentScope(selectedInvestigationScope, baseUrl)
    ) {
      isLoading.set(false);
      isTimelineLoading.set(false);
      return;
    }
    activateInvestigationContext(context);

    isLoading.set(true);
    isTimelineLoading.set(true);
    let recoverySubscription: { unsubscribe(): void } | undefined;
    const recoverStaleContext = (): boolean => {
      if (!investigationContext.isCurrentScope(investigationScope, baseUrl)) {
        isLoading.set(false);
        isTimelineLoading.set(false);
        return true;
      }
      if (recoveryTargetKey !== targetKey || staleRecoveryInProgress()) {
        return true;
      }
      if (staleRecoveryAttempted()) {
        return false;
      }
      staleRecoveryAttempted.set(true);
      staleRecoveryInProgress.set(true);
      incident.set(undefined);
      events.set(undefined);
      isLoading.set(true);
      isTimelineLoading.set(true);
      investigationContext.clear();
      recoverySubscription = agentContext
        .contextFor(baseUrl)
        .refresh()
        .subscribe({
          error: () => {
            if (recoveryTargetKey !== targetKey) {
              return;
            }
            staleRecoveryInProgress.set(false);
            isLoading.set(false);
            isTimelineLoading.set(false);
            unavailableMessage.set(
              'The DataTug agent context changed and could not be refreshed.',
            );
          },
        });
      return true;
    };
    const incidentSubscription = incidentClient
      .get(context, currentIncidentId, at)
      .subscribe((result) => {
        if (
          result.kind === 'error' &&
          result.code === 'STALE_CONTEXT' &&
          recoverStaleContext()
        ) {
          return;
        }
        isLoading.set(false);
        if (result.kind === 'ok') {
          incident.set(result.data);
        } else {
          unavailableMessage.set(result.message);
        }
      });
    const eventsSubscription = incidentClient
      .events(context, currentIncidentId)
      .subscribe((result) => {
        if (
          result.kind === 'error' &&
          result.code === 'STALE_CONTEXT' &&
          recoverStaleContext()
        ) {
          return;
        }
        isTimelineLoading.set(false);
        if (result.kind === 'ok') {
          events.set(result.data);
        } else {
          timelineMessage.set(result.message);
        }
      });
    onCleanup(() => {
      incidentSubscription.unsubscribe();
      eventsSubscription.unsubscribe();
      recoverySubscription?.unsubscribe();
      if (recoveryTargetKey === targetKey) {
        staleRecoveryInProgress.set(false);
      }
    });
  });

  return {
    routeParams,
    queryParams,
    incidentId,
    requestContext,
    incident,
    events,
    isLoading,
    isTimelineLoading,
    unavailableMessage,
    timelineMessage,
    statusSentences,
    hypotheses,
    evidence,
    participants,
    projects,
    activateInvestigationContext,
  };
}
