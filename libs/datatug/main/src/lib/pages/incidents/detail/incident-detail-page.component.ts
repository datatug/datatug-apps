import { Component, OnDestroy, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  IonBackButton,
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
import { Subject, takeUntil, takeWhile } from 'rxjs';
import { routingParamIncidentId, routingParamStoreId } from '../../../core/datatug-routing-params';
import { IncidentClientService } from '../../../incidents/incident-client.service';
import { IncidentDetail } from '../../../incidents/models';

/**
 * The incident detail page. Its route (`incidents/:storeId/:incidentId`)
 * embeds the full {@link IncidentDetail}-identifying `IncidentRef` — the
 * store id and the incident id — rather than relying on ambient nav context,
 * so a link produced under one product profile opens the identical page
 * under another (hub `product-profiles` REQ:no-profile-private-data,
 * AC:deep-link-works-in-other-profile: "no 404, no redirect to a profile
 * home, and no capability missing from the page").
 *
 * Out of scope for this scaffold slice (plan Task 9): timeline, hypotheses,
 * evidence, participants, status view, Resolution Record, compare, metrics —
 * those wait for the backend tasks. This page shows the summary fields the
 * server-side model already commits to (title, status, description).
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
    IonNote,
  ],
})
export class IncidentDetailPageComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly incidentClient = inject(IncidentClientService);
  private readonly destroyed = new Subject<void>();

  protected readonly incident = signal<IncidentDetail | undefined>(undefined);
  protected readonly isLoading = signal(false);
  protected readonly unavailableMessage = signal<string | undefined>(
    undefined,
  );

  constructor() {
    this.route.paramMap.pipe(takeUntil(this.destroyed)).subscribe((params) => {
      const storeId = params.get(routingParamStoreId) || undefined;
      const incidentId = params.get(routingParamIncidentId) || undefined;
      this.incident.set(undefined);
      this.unavailableMessage.set(undefined);
      if (!storeId || !incidentId) {
        return;
      }
      this.isLoading.set(true);
      this.incidentClient
        .get(storeId, incidentId)
        .pipe(
          takeUntil(this.destroyed),
          takeWhile(
            () =>
              this.route.snapshot.paramMap.get(routingParamStoreId) ===
                storeId &&
              this.route.snapshot.paramMap.get(routingParamIncidentId) ===
                incidentId,
          ),
        )
        .subscribe((result) => {
          this.isLoading.set(false);
          if (result.kind === 'ok') {
            this.incident.set(result.data);
          } else {
            this.unavailableMessage.set(result.message);
          }
        });
    });
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }
}
