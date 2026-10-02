import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
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
import { routingParamStoreId } from '../../../core/datatug-routing-params';
import { IncidentClientService } from '../../../incidents/incident-client.service';
import { useIncidentPageReads } from '../../../incidents/incident-page-reads';
import { incidentContextQueryParams } from '../../../incidents/incident-route-context';
import {
  IncidentFactView,
  AppendIncidentEventRequest,
  IncidentRequestContext,
} from '../../../incidents/models';
import { IncidentReadPanelsComponent } from './incident-read-panels.component';
import { IncidentComparePanelComponent } from './incident-compare-panel.component';
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
    IncidentComparePanelComponent,
    IncidentReadPanelsComponent,
  ],
})
export class IncidentDetailPageComponent {
  private readonly router = inject(Router);
  private readonly investigationContext = inject(InvestigationContextService);
  private readonly incidentClient = inject(IncidentClientService);
  private readonly destroyRef = inject(DestroyRef);
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
  private readonly page = useIncidentPageReads({
    onTargetChange: () => {
      this.contextMutationInFlight.set(undefined);
      this.contextMutationError.set(undefined);
      this.pendingContextMutations.clear();
    },
  });
  private readonly routeParams = this.page.routeParams;
  protected readonly incidentId = this.page.incidentId;
  protected readonly requestContext = this.page.requestContext;
  protected readonly incident = this.page.incident;
  protected readonly events = this.page.events;
  protected readonly isLoading = this.page.isLoading;
  protected readonly isTimelineLoading = this.page.isTimelineLoading;
  protected readonly unavailableMessage = this.page.unavailableMessage;
  protected readonly timelineMessage = this.page.timelineMessage;
  protected readonly statusSentences = this.page.statusSentences;
  protected readonly hypotheses = this.page.hypotheses;
  protected readonly evidence = this.page.evidence;
  protected readonly participants = this.page.participants;
  protected readonly projects = this.page.projects;

  protected readonly incidentListUrl = computed(() => {
    const context = this.requestContext();
    const tree = this.router.createUrlTree(['/incidents'], {
      queryParams: context ? incidentContextQueryParams(context) : undefined,
    });
    return this.router.serializeUrl(tree);
  });
  protected readonly recordCommands = computed(() => {
    const storeId = this.routeParams().get(routingParamStoreId);
    const incidentId = this.incidentId();
    if (!storeId || !incidentId) {
      return undefined;
    }
    return ['/incidents', storeId, incidentId, 'record'] as const;
  });
  protected readonly recordQueryParams = computed(() => {
    const context = this.requestContext();
    return context ? incidentContextQueryParams(context) : undefined;
  });
  protected readonly recordUrl = computed(() => {
    const commands = this.recordCommands();
    if (!commands) {
      return undefined;
    }
    return this.router.serializeUrl(
      this.router.createUrlTree([...commands], {
        queryParams: this.recordQueryParams(),
      }),
    );
  });
  protected readonly overlayFacts = computed(() =>
    (this.incident()?.canonicalContext.facts ?? []).filter(
      (fact) => !!fact.layer && fact.layer !== 'canonical',
    ),
  );

  protected eventSummary(event: {
    readonly type: string;
    readonly payload: unknown;
  }): string {
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
      this.page.activateInvestigationContext(context);
    }
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
