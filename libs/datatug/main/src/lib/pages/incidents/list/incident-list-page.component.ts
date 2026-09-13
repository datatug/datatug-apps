import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AgentContextService,
  type ContextScope,
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
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugServicesNavModule } from '../../../services/nav/datatug-services-nav.module';
import { IncidentClientService } from '../../../incidents/incident-client.service';
import { agentBaseUrl } from '../../../services/repo/agent-url';
import {
  incidentContextQueryParams,
  resolveIncidentRouteScope,
} from '../../../incidents/incident-route-context';
import {
  IncidentRequestContext,
  IncidentSummary,
} from '../../../incidents/models';

/**
 * The incident list — this is the `incidentius` profile's home route
 * (hub `product-profiles` REQ:profile-table; `incidents` REQ:profile-home) and,
 * under the `datatug` profile, the page the side menu's always-present
 * *Incidents* item leads to. It is deliberately the same component/route for
 * both — REQ:no-profile-private-data: "an incident opened from the
 * Incidentius home and the same incident reached from a DataTug project page
 * are the same page, not two implementations of one screen" — so this page
 * itself never reads the active product profile; only the app shell (brand)
 * and the side menu (whether the *Incidents* item shows) do.
 *
 * The "Houston, we've got a problem" entry point (vision §23) is always
 * shown here, for the same reason.
 */
@Component({
  selector: 'sneat-datatug-incident-list',
  templateUrl: './incident-list-page.component.html',
  imports: [
    DatatugServicesNavModule,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonMenuButton,
    IonTitle,
    IonContent,
    IonCard,
    IonCardContent,
    IonList,
    IonItem,
    IonIcon,
    IonLabel,
    IonButton,
    IonNote,
    IonSpinner,
  ],
})
export class IncidentListPageComponent {
  private readonly navContext = inject(DatatugNavContextService);
  private readonly route = inject(ActivatedRoute);
  private readonly incidentClient = inject(IncidentClientService);
  private readonly agentContext = inject(AgentContextService);
  private readonly investigationContext = inject(InvestigationContextService);

  private readonly navAgentStoreId = toSignal(this.navContext.currentStoreId, {
    initialValue: undefined,
  });
  private readonly navProject = toSignal(this.navContext.currentProject, {
    initialValue: undefined,
  });
  private readonly navEnvironment = toSignal(this.navContext.currentEnv, {
    initialValue: undefined,
  });
  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly requestContext = computed<
    IncidentRequestContext | undefined
  >(() => {
    const query = this.queryParams();
    const routeScope = resolveIncidentRouteScope(query, {
      agentStoreId: this.navAgentStoreId(),
      project: this.navProject(),
      environment: this.navEnvironment()?.id,
    });
    if (!routeScope) {
      return undefined;
    }
    const { agentStoreId, storeId, project, environment } = routeScope;
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
      scope: { storeId, project, environment, securityContextId },
    };
  });

  protected readonly scopeQueryParams = computed(() => {
    const context = this.requestContext();
    return context ? incidentContextQueryParams(context) : undefined;
  });

  protected readonly incidents = signal<IncidentSummary[] | undefined>(
    undefined,
  );
  protected readonly isLoading = signal(false);
  protected readonly unavailableMessage = signal<string | undefined>(undefined);
  private recoveryTargetKey: string | undefined;
  private selectedInvestigationScope:
    | Omit<ContextScope, 'agentUrl'>
    | undefined;
  private readonly staleRecoveryAttempted = signal(false);
  private readonly staleRecoveryInProgress = signal(false);

  private readonly loadIncidents = effect((onCleanup) => {
    const context = this.requestContext();
    this.unavailableMessage.set(undefined);
    this.incidents.set(undefined);
    if (!context) {
      // hub `incidents` REQ:profile-home: "With no project open, the list
      // shows the incidents of every incident store configured for this
      // machine or served setup that the reader may see; with none
      // configured it shows an empty state that explains how to open a
      // project and create one, so the page is never a dead page." This
      // scaffold slice has no multi-store aggregation yet (that is
      // plan Task 10 territory), so "no store in the current nav context"
      // is treated as "none configured" for now.
      this.isLoading.set(false);
      return;
    }
    const targetKey = JSON.stringify({
      agentStoreId: context.agentStoreId,
      storeId: context.scope.storeId,
      project: context.scope.project,
      environment: context.scope.environment,
    });
    const sameTarget = this.recoveryTargetKey === targetKey;
    if (!sameTarget) {
      this.recoveryTargetKey = targetKey;
      this.staleRecoveryAttempted.set(false);
      this.staleRecoveryInProgress.set(false);
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
      return;
    }
    this.activateInvestigationContext(context);
    this.isLoading.set(true);
    let recoverySubscription: { unsubscribe(): void } | undefined;
    const subscription = this.incidentClient
      .list(context)
      .subscribe((result) => {
        if (
          result.kind === 'error' &&
          result.code === 'STALE_CONTEXT' &&
          this.recoveryTargetKey === targetKey
        ) {
          if (
            !this.investigationContext.isCurrentScope(
              investigationScope,
              baseUrl,
            )
          ) {
            this.isLoading.set(false);
            return;
          }
          if (this.staleRecoveryInProgress()) {
            return;
          }
          if (!this.staleRecoveryAttempted()) {
            this.staleRecoveryAttempted.set(true);
            this.staleRecoveryInProgress.set(true);
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
                  this.unavailableMessage.set(
                    'The DataTug agent context changed and could not be refreshed.',
                  );
                },
              });
            return;
          }
        }
        this.isLoading.set(false);
        if (result.kind === 'ok') {
          this.staleRecoveryAttempted.set(false);
          this.incidents.set(result.data);
        } else {
          this.unavailableMessage.set(result.message);
        }
      });
    onCleanup(() => {
      subscription.unsubscribe();
      recoverySubscription?.unsubscribe();
      if (this.recoveryTargetKey === targetKey) {
        this.staleRecoveryInProgress.set(false);
      }
    });
  });

  protected incidentLink(incident: IncidentSummary): readonly string[] {
    return ['/incidents', incident.ref.storeId, incident.ref.incidentId];
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
}
