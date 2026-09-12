import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { AgentContextService } from '@sneat/datatug-semantic';
import { RandomIdService } from '@sneat/random';
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
  private readonly agentContext = inject(AgentContextService);
  private readonly randomId = inject(RandomIdService);

  protected readonly storeId = toSignal(this.navContext.currentStoreId, {
    initialValue: undefined,
  });
  protected readonly project = toSignal(this.navContext.currentProject, {
    initialValue: undefined,
  });
  protected readonly environment = toSignal(this.navContext.currentEnv, {
    initialValue: undefined,
  });

  // Written only from template `[(ngModel)]` bindings (user input) — no
  // async writer touches these, so plain fields are zoneless-safe as-is
  // (AGENTS.md "Change detection & state", item 4).
  protected title = '';
  protected description = '';

  protected readonly isSubmitting = signal(false);
  protected readonly errorMessage = signal<string | undefined>(undefined);
  private readonly pendingMutation = signal<
    { readonly fingerprint: string; readonly id: string } | undefined
  >(undefined);
  private readonly activeScopeKey = signal<string | undefined>(undefined);
  private readonly submissionToken = signal(0);

  private readonly retireStaleSubmission = effect(() => {
    const scopeKey = this.currentScopeKey();
    const activeScopeKey = this.activeScopeKey();
    if (activeScopeKey && activeScopeKey !== scopeKey) {
      this.activeScopeKey.set(undefined);
      this.submissionToken.update((value) => value + 1);
      this.isSubmitting.set(false);
    }
  });

  protected hasMutationScope(): boolean {
    return !!(
      this.storeId() &&
      this.project()?.ref.storeId &&
      this.project()?.ref.projectId &&
      this.environment()?.id &&
      this.agentContext.securityContextId()
    );
  }

  protected submit(): void {
    if (this.isSubmitting()) {
      return;
    }
    const storeId = this.storeId();
    const project = this.project()?.ref;
    const environment = this.environment()?.id;
    const securityContextId = this.agentContext.securityContextId();
    const title = this.title.trim();
    if (!title) {
      return;
    }
    if (
      !storeId ||
      !project?.storeId ||
      !project.projectId ||
      !environment ||
      !securityContextId
    ) {
      this.errorMessage.set(
        'Open a project and environment connected to a DataTug server before creating an incident.',
      );
      return;
    }
    this.errorMessage.set(undefined);
    this.isSubmitting.set(true);
    const scopeKey = this.currentScopeKey();
    const submissionToken = this.submissionToken() + 1;
    this.submissionToken.set(submissionToken);
    this.activeScopeKey.set(scopeKey);
    const description = this.description.trim() || undefined;
    const fingerprint = JSON.stringify({
      storeId,
      projectStoreId: project.storeId,
      project: project.projectId,
      environment,
      securityContextId,
      title,
      description,
    });
    const pendingMutation = this.pendingMutation();
    let mutationId = pendingMutation?.id;
    if (pendingMutation?.fingerprint !== fingerprint || !mutationId) {
      mutationId = `incident-create-${this.randomId.newRandomId({ len: 20 })}`;
      this.pendingMutation.set({
        fingerprint,
        id: mutationId,
      });
    }
    this.incidentClient
      .create({
        storeId,
        project: project.projectId,
        environment,
        securityContextId,
        mutationId,
        title,
        description,
        projects: [
          {
            storeId: project.storeId,
            projectId: project.projectId,
            environment,
          },
        ],
      })
      .subscribe((result) => {
        if (
          submissionToken !== this.submissionToken() ||
          scopeKey !== this.currentScopeKey()
        ) {
          return;
        }
        this.activeScopeKey.set(undefined);
        this.isSubmitting.set(false);
        if (result.kind === 'ok') {
          this.pendingMutation.set(undefined);
          this.router
            .navigateByUrl(
              `/incidents/${encodeURIComponent(result.data.ref.storeId)}/${encodeURIComponent(result.data.ref.incidentId)}`,
              { replaceUrl: true },
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

  private currentScopeKey(): string {
    return JSON.stringify({
      storeId: this.storeId(),
      projectStoreId: this.project()?.ref.storeId,
      project: this.project()?.ref.projectId,
      environment: this.environment()?.id,
      securityContextId: this.agentContext.securityContextId(),
    });
  }
}
