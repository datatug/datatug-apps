import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { AgentContextService } from '@sneat/datatug-semantic';
import {
  IonBackButton,
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
  incidentAgentQueryParam,
  incidentContextQueryParams,
  incidentEnvironmentQueryParam,
  incidentProjectQueryParam,
} from '../../../incidents/incident-route-context';
import {
  IncidentDetail,
  IncidentEvent,
  IncidentRequestContext,
  IncidentStreamItem,
} from '../../../incidents/models';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';

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
  private readonly incidentClient = inject(IncidentClientService);

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
    const agentStoreId =
      query.get(incidentAgentQueryParam) || this.navAgentStoreId();
    const project =
      query.get(incidentProjectQueryParam) || this.navProject()?.ref.projectId;
    const environment =
      query.get(incidentEnvironmentQueryParam) || this.navEnvironment()?.id;
    const securityContextId = this.agentContext.securityContextId();
    if (
      !agentStoreId ||
      !storeId ||
      !project ||
      !environment ||
      !securityContextId
    ) {
      return undefined;
    }
    return {
      agentStoreId,
      scope: { storeId, project, environment, securityContextId },
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

    this.isLoading.set(true);
    this.isTimelineLoading.set(true);
    const incidentSubscription = this.incidentClient
      .get(context, incidentId, at)
      .subscribe((result) => {
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
    });
  });

  protected eventSummary(event: IncidentEvent): string {
    if (
      event.payload &&
      typeof event.payload === 'object' &&
      'body' in event.payload &&
      typeof event.payload.body === 'string'
    ) {
      return event.payload.body;
    }
    return event.type;
  }
}
