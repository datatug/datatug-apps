import { Component, OnDestroy, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
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
import { Subject, takeUntil } from 'rxjs';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugServicesNavModule } from '../../../services/nav/datatug-services-nav.module';
import { IncidentClientService } from '../../../incidents/incident-client.service';
import { IncidentSummary } from '../../../incidents/models';

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
export class IncidentListPageComponent implements OnDestroy {
  private readonly navContext = inject(DatatugNavContextService);
  private readonly incidentClient = inject(IncidentClientService);
  private readonly destroyed = new Subject<void>();

  protected readonly storeId = toSignal(this.navContext.currentStoreId, {
    initialValue: undefined,
  });

  protected readonly incidents = signal<IncidentSummary[] | undefined>(
    undefined,
  );
  protected readonly isLoading = signal(false);
  protected readonly unavailableMessage = signal<string | undefined>(
    undefined,
  );

  constructor() {
    this.navContext.currentStoreId
      .pipe(takeUntil(this.destroyed))
      .subscribe({ next: (storeId) => this.loadIncidents(storeId) });
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }

  private loadIncidents(storeId: string | undefined): void {
    this.unavailableMessage.set(undefined);
    this.incidents.set(undefined);
    if (!storeId) {
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
    this.isLoading.set(true);
    this.incidentClient
      .list(storeId)
      .pipe(takeUntil(this.destroyed))
      .subscribe((result) => {
        this.isLoading.set(false);
        if (result.kind === 'ok') {
          this.incidents.set(result.data);
        } else {
          this.unavailableMessage.set(result.message);
        }
      });
  }

  protected incidentLink(incident: IncidentSummary): string {
    const storeId = this.storeId();
    return storeId
      ? `/incidents/${encodeURIComponent(storeId)}/${encodeURIComponent(incident.id)}`
      : '';
  }
}
