import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AgentContextService,
  type ContextScope,
  type FactLayer,
  InvestigationContextService,
} from '@sneat/datatug-semantic';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonNote,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import {
  routingParamIncidentId,
  routingParamStoreId,
} from '../../../core/datatug-routing-params';
import { IncidentClientService } from '../../../incidents/incident-client.service';
import {
  incidentContextQueryParams,
  resolveIncidentRouteScope,
} from '../../../incidents/incident-route-context';
import {
  IncidentDetail,
  IncidentEvent,
  IncidentFactView,
  AppendIncidentEventRequest,
  IncidentRequestContext,
  IncidentStreamItem,
} from '../../../incidents/models';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { agentBaseUrl } from '../../../services/repo/agent-url';

/**
 * The incident detail page. Its route (`incidents/:storeId/:incidentId`)
 * embeds the full {@link IncidentDetail}-identifying `IncidentRef` — the
 * store id and the incident id — rather than relying on ambient nav context,
 * so a link produced under one product profile opens the identical page
 * under another (hub `product-profiles` REQ:no-profile-private-data,
 * AC:deep-link-works-in-other-profile: "no 404, no redirect to a profile
 * home, and no capability missing from the page").
 *
 * The route IncidentRef remains authoritative on refresh. Project/environment
 * request scope is URL-carried alongside it, while the current
 * securityContextId is always read from AgentContextService at request time.
 */
@Component({
  selector: 'sneat-datatug-incident-detail',
  templateUrl: './incident-detail-page.component.html',
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonButton,
    IonMenuButton,
    IonTitle,
    IonContent,
    IonCard,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
  ],
})
export class IncidentDetailPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navContext = inject(DatatugNavContextService);
  private readonly agentContext = inject(AgentContextService);
  private readonly investigationContext = inject(InvestigationContextService);
  private readonly incidentClient = inject(IncidentClientService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly routeParams = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly navAgentStoreId = toSignal(this.navContext.currentStoreId, {
    initialValue: undefined,
  });
  private readonly navProject = toSignal(this.navContext.currentProject, {
    initialValue: undefined,
  });
  private readonly navEnvironment = toSignal(this.navContext.currentEnv, {
    initialValue: undefined,
  });

  protected readonly incidentId = computed(
    () => this.routeParams().get(routingParamIncidentId) || undefined,
  );
  protected readonly requestContext = computed<
    IncidentRequestContext | undefined
  >(() => {
    const query = this.queryParams();
    const storeId = this.routeParams().get(routingParamStoreId) || undefined;
    const routeScope = resolveIncidentRouteScope(
      query,
      {
        agentStoreId: this.navAgentStoreId(),
        project: this.navProject(),
        environment: this.navEnvironment()?.id,
      },
      storeId,
    );
    if (!routeScope) {
      return undefined;
    }
    const { agentStoreId, project, environment } = routeScope;
    const securityContextId = agentStoreId
      ? this.agentContext
          .contextFor(agentBaseUrl(agentStoreId))
          .securityContextId()
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

  protected readonly incidentListUrl = computed(() => {
    const context = this.requestContext();
    const tree = this.router.createUrlTree(['/incidents'], {
      queryParams: context ? incidentContextQueryParams(context) : undefined,
    });
    return this.router.serializeUrl(tree);
  });

  protected readonly incident = signal<IncidentDetail | undefined>(undefined);
  protected readonly events = signal<IncidentStreamItem[] | undefined>(
    undefined,
  );
  protected readonly isLoading = signal(false);
  protected readonly isTimelineLoading = signal(false);
  protected readonly unavailableMessage = signal<string | undefined>(undefined);
  protected readonly timelineMessage = signal<string | undefined>(undefined);
  protected readonly contextMutationError = signal<string | undefined>(
    undefined,
  );
  protected readonly contextMutationInFlight = signal<string | undefined>(
    undefined,
  );
  private readonly pendingContextMutations = new Map<
    string,
    AppendIncidentEventRequest
  >();
  protected readonly overlayFacts = computed(() =>
    (this.incident()?.canonicalContext.facts ?? []).filter(
      (fact) => !!fact.layer && fact.layer !== 'canonical',
    ),
  );
  private recoveryTargetKey: string | undefined;
  private selectedInvestigationScope:
    | Omit<ContextScope, 'agentUrl'>
    | undefined;
  private readonly staleRecoveryAttempted = signal(false);
  private readonly staleRecoveryInProgress = signal(false);

  private readonly loadIncident = effect((onCleanup) => {
    const context = this.requestContext();
    const incidentId = this.incidentId();
    const at = this.queryParams().get('at') || undefined;
    this.incident.set(undefined);
    this.events.set(undefined);
    this.unavailableMessage.set(undefined);
    this.timelineMessage.set(undefined);
    if (!context || !incidentId) {
      this.isLoading.set(false);
      this.isTimelineLoading.set(false);
      return;
    }
    const targetKey = JSON.stringify({
      agentStoreId: context.agentStoreId,
      storeId: context.scope.storeId,
      project: context.scope.project,
      environment: context.scope.environment,
      incidentId,
      at,
    });
    const sameTarget = this.recoveryTargetKey === targetKey;
    if (!sameTarget) {
      this.recoveryTargetKey = targetKey;
      this.staleRecoveryAttempted.set(false);
      this.staleRecoveryInProgress.set(false);
      this.contextMutationInFlight.set(undefined);
      this.contextMutationError.set(undefined);
      this.pendingContextMutations.clear();
    }
    const baseUrl = agentBaseUrl(context.agentStoreId);
    const investigationScope = {
      project: context.scope.project,
      environment: context.scope.environment,
      securityContextId: context.scope.securityContextId,
    };
    if (
      sameTarget &&
      this.selectedInvestigationScope &&
      !this.investigationContext.isCurrentScope(
        this.selectedInvestigationScope,
        baseUrl,
      )
    ) {
      this.isLoading.set(false);
      this.isTimelineLoading.set(false);
      return;
    }
    this.activateInvestigationContext(context);

    this.isLoading.set(true);
    this.isTimelineLoading.set(true);
    let recoverySubscription: { unsubscribe(): void } | undefined;
    const recoverStaleContext = (): boolean => {
      if (
        !this.investigationContext.isCurrentScope(investigationScope, baseUrl)
      ) {
        this.isLoading.set(false);
        this.isTimelineLoading.set(false);
        return true;
      }
      if (
        this.recoveryTargetKey !== targetKey ||
        this.staleRecoveryInProgress()
      ) {
        return true;
      }
      if (this.staleRecoveryAttempted()) {
        return false;
      }
      this.staleRecoveryAttempted.set(true);
      this.staleRecoveryInProgress.set(true);
      this.incident.set(undefined);
      this.events.set(undefined);
      this.isLoading.set(true);
      this.isTimelineLoading.set(true);
      this.investigationContext.clear();
      recoverySubscription = this.agentContext
        .contextFor(baseUrl)
        .refresh()
        .subscribe({
          error: () => {
            if (this.recoveryTargetKey !== targetKey) {
              return;
            }
            this.staleRecoveryInProgress.set(false);
            this.isLoading.set(false);
            this.isTimelineLoading.set(false);
            this.unavailableMessage.set(
              'The DataTug agent context changed and could not be refreshed.',
            );
          },
        });
      return true;
    };
    const incidentSubscription = this.incidentClient
      .get(context, incidentId, at)
      .subscribe((result) => {
        if (
          result.kind === 'error' &&
          result.code === 'STALE_CONTEXT' &&
          recoverStaleContext()
        ) {
          return;
        }
        this.isLoading.set(false);
        if (result.kind === 'ok') {
          this.incident.set(result.data);
        } else {
          this.unavailableMessage.set(result.message);
        }
      });
    const eventsSubscription = this.incidentClient
      .events(context, incidentId)
      .subscribe((result) => {
        if (
          result.kind === 'error' &&
          result.code === 'STALE_CONTEXT' &&
          recoverStaleContext()
        ) {
          return;
        }
        this.isTimelineLoading.set(false);
        if (result.kind === 'ok') {
          this.events.set(result.data);
        } else {
          this.timelineMessage.set(result.message);
        }
      });
    onCleanup(() => {
      incidentSubscription.unsubscribe();
      eventsSubscription.unsubscribe();
      recoverySubscription?.unsubscribe();
      if (this.recoveryTargetKey === targetKey) {
        this.staleRecoveryInProgress.set(false);
      }
    });
  });

  protected eventSummary(event: IncidentEvent): string {
    if (
      event.type === 'note.added' &&
      event.payload &&
      typeof event.payload === 'object' &&
      'body' in event.payload &&
      typeof event.payload.body === 'string'
    ) {
      return event.payload.body;
    }
    return event.type;
  }

  protected factValue(fact: IncidentFactView): string {
    return 'redacted' in fact.value ? 'redacted' : String(fact.value.value);
  }

  protected isFactFinal(fact: IncidentFactView): boolean {
    const incident = this.incident();
    const layer = fact.layer;
    if (!layer || layer === 'canonical') {
      return true;
    }
    return !!(
      incident?.contextPromotions?.some(
        (item) =>
          item.fact.layer === layer &&
          item.fact.id === fact.id &&
          item.fact.scope.storeId === fact.scope?.storeId &&
          item.fact.scope.projectId === fact.scope?.projectId &&
          item.fact.scope.environment === fact.scope?.environment,
      ) || incident?.contextRejections?.some((item) => item.layer === layer)
    );
  }

  protected promote(fact: IncidentFactView): void {
    const context = this.requestContext();
    const incident = this.incident();
    const incidentId = this.incidentId();
    const layer = fact.layer;
    const factScope = fact.scope;
    const factEnvironment = factScope?.environment;
    if (
      !context ||
      !incident ||
      !incidentId ||
      !layer ||
      layer === 'canonical' ||
      !factScope ||
      !factEnvironment ||
      this.contextMutationInFlight() ||
      !this.investigationContext.isCurrentScope(
        this.investigationScope(context),
        agentBaseUrl(context.agentStoreId),
      )
    ) {
      return;
    }
    const mutationKey = `promote:${factScope.storeId}:${factScope.projectId}:${factScope.environment}:${fact.id}:${layer}`;
    const request = this.contextMutationRequest(mutationKey, () => ({
      ...context.scope,
      mutationId: `context-promote-${crypto.randomUUID()}`,
      incident: incident.ref,
      expectedSeq: incident.lastSeq,
      event: {
        at: new Date().toISOString(),
        type: 'context.fact.promoted',
        assertion: { kind: 'claim', confidence: 'confirmed' },
        ...(layer.startsWith('hypothesis:')
          ? {
              refs: [
                {
                  kind: 'hypothesis' as const,
                  id: layer.slice('hypothesis:'.length),
                },
              ],
            }
          : {}),
        payload: {
          fact: {
            scope: {
              storeId: factScope.storeId,
              projectId: factScope.projectId,
              environment: factEnvironment,
            },
            id: fact.id,
            layer,
          },
          role: 'affected',
        },
      },
    }));
    this.appendContextEvent(mutationKey, layer, request, fact);
  }

  protected reject(fact: IncidentFactView): void {
    const context = this.requestContext();
    const incident = this.incident();
    const incidentId = this.incidentId();
    const layer = fact.layer;
    if (
      !context ||
      !incident ||
      !incidentId ||
      !layer ||
      layer === 'canonical' ||
      this.contextMutationInFlight() ||
      !this.investigationContext.isCurrentScope(
        this.investigationScope(context),
        agentBaseUrl(context.agentStoreId),
      )
    ) {
      return;
    }
    const mutationKey = `reject:${layer}`;
    const request = this.contextMutationRequest(mutationKey, () => ({
      ...context.scope,
      mutationId: `context-reject-${crypto.randomUUID()}`,
      incident: incident.ref,
      expectedSeq: incident.lastSeq,
      event: {
        at: new Date().toISOString(),
        type: 'context.fact.rejected',
        assertion: { kind: 'claim', confidence: 'confirmed' },
        ...(layer.startsWith('hypothesis:')
          ? {
              refs: [
                {
                  kind: 'hypothesis' as const,
                  id: layer.slice('hypothesis:'.length),
                },
              ],
            }
          : {}),
        payload: { layer },
      },
    }));
    this.appendContextEvent(mutationKey, layer, request);
  }

  private contextMutationRequest(
    key: string,
    create: () => AppendIncidentEventRequest,
  ): AppendIncidentEventRequest {
    const pending = this.pendingContextMutations.get(key);
    if (pending) {
      return pending;
    }
    const request = create();
    this.pendingContextMutations.set(key, request);
    return request;
  }

  private appendContextEvent(
    mutationKey: string,
    layer: Exclude<FactLayer, 'canonical'>,
    request: AppendIncidentEventRequest,
    promotedFact?: IncidentFactView,
  ): void {
    const context = this.requestContext();
    const incidentId = this.incidentId();
    if (!context || !incidentId) {
      return;
    }
    const scope = this.investigationScope(context);
    const baseUrl = agentBaseUrl(context.agentStoreId);
    const incidentOperationKey = this.incidentOperationKey(context, incidentId);
    this.contextMutationError.set(undefined);
    this.contextMutationInFlight.set(mutationKey);
    this.incidentClient
      .append(context, incidentId, request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (
          this.currentIncidentOperationKey() !== incidentOperationKey ||
          !this.investigationContext.isCurrentScope(scope, baseUrl) ||
          this.contextMutationInFlight() !== mutationKey
        ) {
          return;
        }
        this.contextMutationInFlight.set(undefined);
        if (result.kind !== 'ok') {
          this.contextMutationError.set(result.message);
          return;
        }
        this.pendingContextMutations.delete(mutationKey);
        this.incident.set(result.data.projection);
        if (promotedFact) {
          this.investigationContext.applyPromotion(
            promotedFact.id,
            layer,
            'affected',
          );
        }
        this.isTimelineLoading.set(true);
        this.incidentClient
          .events(context, incidentId)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((timelineResult) => {
            if (
              this.currentIncidentOperationKey() !== incidentOperationKey ||
              !this.investigationContext.isCurrentScope(scope, baseUrl)
            ) {
              return;
            }
            this.isTimelineLoading.set(false);
            if (timelineResult.kind === 'ok') {
              this.events.set(timelineResult.data);
              this.timelineMessage.set(undefined);
            } else {
              this.timelineMessage.set(timelineResult.message);
            }
          });
      });
  }

  ionViewDidEnter(): void {
    const context = this.requestContext();
    if (context) {
      this.activateInvestigationContext(context);
    }
  }

  private activateInvestigationContext(context: IncidentRequestContext): void {
    const investigationScope = {
      project: context.scope.project,
      environment: context.scope.environment,
      securityContextId: context.scope.securityContextId,
    };
    this.investigationContext.setScope(
      investigationScope,
      agentBaseUrl(context.agentStoreId),
    );
    this.selectedInvestigationScope = investigationScope;
  }

  private investigationScope(context: IncidentRequestContext) {
    return {
      project: context.scope.project,
      environment: context.scope.environment,
      securityContextId: context.scope.securityContextId,
    };
  }

  private currentIncidentOperationKey(): string | undefined {
    const context = this.requestContext();
    const incidentId = this.incidentId();
    return context && incidentId
      ? this.incidentOperationKey(context, incidentId)
      : undefined;
  }

  private incidentOperationKey(
    context: IncidentRequestContext,
    incidentId: string,
  ): string {
    return JSON.stringify([
      context.agentStoreId,
      context.scope.storeId,
      context.scope.project,
      context.scope.environment,
      context.scope.securityContextId,
      incidentId,
    ]);
  }
}
