import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonMenuButton,
  IonNote,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { routingParamStoreId } from '../../../core/datatug-routing-params';
import { useIncidentPageReads } from '../../../incidents/incident-page-reads';
import { incidentContextQueryParams } from '../../../incidents/incident-route-context';
import { IncidentReadPanelsComponent } from '../detail/incident-read-panels.component';

/**
 * Resolution Record for one qualified incident. The URL embeds the same
 * IncidentRef as the detail page, so a cold reload or pasted deep link
 * reconstructs the record without router state.
 */
@Component({
  selector: 'sneat-datatug-incident-resolution-record',
  templateUrl: './incident-resolution-record-page.component.html',
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
    IonNote,
    IncidentReadPanelsComponent,
    RouterLink,
  ],
})
export class IncidentResolutionRecordPageComponent {
  private readonly router = inject(Router);
  private readonly page = useIncidentPageReads();
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

  protected readonly detailCommands = computed(() => {
    const storeId = this.routeParams().get(routingParamStoreId);
    const incidentId = this.incidentId();
    if (!storeId || !incidentId) {
      return ['/incidents'] as const;
    }
    return ['/incidents', storeId, incidentId] as const;
  });
  protected readonly detailQueryParams = computed(() => {
    const context = this.requestContext();
    return context ? incidentContextQueryParams(context) : undefined;
  });
  protected readonly detailUrl = computed(() =>
    this.router.serializeUrl(
      this.router.createUrlTree([...this.detailCommands()], {
        queryParams: this.detailQueryParams(),
      }),
    ),
  );

  ionViewDidEnter(): void {
    const context = this.requestContext();
    if (context) {
      this.page.activateInvestigationContext(context);
    }
  }
}
