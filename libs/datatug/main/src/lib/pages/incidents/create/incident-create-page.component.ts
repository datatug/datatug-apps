import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonMenuButton,
  IonNote,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugServicesNavModule } from '../../../services/nav/datatug-services-nav.module';
import { IncidentClientService } from '../../../incidents/incident-client.service';

/**
 * "Houston, we've got a problem" — creating an incident from a title and free
 * text (hub `incidents` REQ:houston-creation: "A user MUST be able to create
 * an incident from a title and free text ... The free text is kept as the
 * incident's `description`."). Reachable from the incident list under either
 * product profile (`incidentius` home's entry point, or `datatug`'s always-on
 * *Incidents* menu item), so — same reasoning as
 * `incident-list-page.component.ts` — this page never branches on the active
 * profile.
 *
 * The server does not implement `POST /datatug/incidents` yet: a failed
 * submit (today, always — see `IncidentClientService`) reports an explicit
 * error and keeps the user's entered title/description untouched so nothing
 * typed is lost, rather than clearing the form or pretending it worked.
 */
@Component({
  selector: 'sneat-datatug-incident-create',
  templateUrl: './incident-create-page.component.html',
  imports: [
    FormsModule,
    DatatugServicesNavModule,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonTitle,
    IonContent,
    IonCard,
    IonCardContent,
    IonItem,
    IonLabel,
    IonInput,
    IonTextarea,
    IonButton,
    IonIcon,
    IonNote,
  ],
})
export class IncidentCreatePageComponent {
  private readonly navContext = inject(DatatugNavContextService);
  private readonly incidentClient = inject(IncidentClientService);
  private readonly router = inject(Router);

  protected readonly storeId = toSignal(this.navContext.currentStoreId, {
    initialValue: undefined,
  });

  // Written only from template `[(ngModel)]` bindings (user input) — no
  // async writer touches these, so plain fields are zoneless-safe as-is
  // (AGENTS.md "Change detection & state", item 4).
  protected title = '';
  protected description = '';

  protected readonly isSubmitting = signal(false);
  protected readonly errorMessage = signal<string | undefined>(undefined);

  protected submit(): void {
    const storeId = this.storeId();
    const title = this.title.trim();
    if (!title) {
      return;
    }
    if (!storeId) {
      this.errorMessage.set(
        'Open a project first — there is no incident store to create this in yet.',
      );
      return;
    }
    this.errorMessage.set(undefined);
    this.isSubmitting.set(true);
    this.incidentClient
      .create(storeId, {
        title,
        description: this.description.trim() || undefined,
      })
      .subscribe((result) => {
        this.isSubmitting.set(false);
        if (result.kind === 'ok') {
          this.router
            .navigateByUrl(
              `/incidents/${encodeURIComponent(storeId)}/${encodeURIComponent(result.data.id)}`,
            )
            .catch(() => void 0);
          return;
        }
        // Keep the draft (title/description untouched) and report the
        // failure — hub REQ:houston-creation / plan Task 9 scope: no mock
        // data, no local-only write, no silent loss of what was typed.
        this.errorMessage.set(result.message);
      });
  }
}
