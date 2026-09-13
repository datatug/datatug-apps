import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AgentContextService,
  contextItemToFact,
  InvestigationContextService,
} from '@sneat/datatug-semantic';
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
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugServicesNavModule } from '../../../services/nav/datatug-services-nav.module';
import { IncidentClientService } from '../../../incidents/incident-client.service';
import {
  datatugServeProjectStoreId,
  incidentAgentQueryParam,
  incidentContextQueryParams,
  incidentEnvironmentQueryParam,
  incidentProjectQueryParam,
  incidentStoreQueryParam,
} from '../../../incidents/incident-route-context';
import {
  IncidentFactInput,
  IncidentRequestContext,
} from '../../../incidents/models';

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
 * Failures report the server's real error and keep the entered title,
 * description and idempotency key untouched. Successful persistence navigates
 * to the returned IncidentRef with `replaceUrl`, so Back cannot reopen a stale
 * filled form.
 */
@Component({
  selector: 'sneat-datatug-incident-create',
  templateUrl: './incident-create-page.component.html',
  imports: [
    FormsModule,
    RouterLink,
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
    IonSpinner,
  ],
})
export class IncidentCreatePageComponent {
  private readonly navContext = inject(DatatugNavContextService);
  private readonly incidentClient = inject(IncidentClientService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly agentContext = inject(AgentContextService);
  private readonly randomId = inject(RandomIdService);
  private readonly investigationContext = inject(InvestigationContextService);
  private readonly destroyRef = inject(DestroyRef);

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
    const agentStoreId =
      query.get(incidentAgentQueryParam) || this.navAgentStoreId();
    const project =
      query.get(incidentProjectQueryParam) || this.navProject()?.ref.projectId;
    const environment =
      query.get(incidentEnvironmentQueryParam) || this.navEnvironment()?.id;
    const storeId = query.get(incidentStoreQueryParam) || project;
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

  protected readonly scopeQueryParams = computed(() => {
    const context = this.requestContext();
    return context ? incidentContextQueryParams(context) : undefined;
  });

  protected readonly contextFactCount = computed(
    () =>
      this.investigationContext.items().filter((item) => item.enabled).length,
  );

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

  private readonly selectInvestigationContext = effect(() => {
    const context = this.requestContext();
    if (!context) {
      return;
    }
    this.investigationContext.setScope({
      project: context.scope.project,
      environment: context.scope.environment,
      securityContextId: context.scope.securityContextId,
    });
  });

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
    return !!this.requestContext();
  }

  protected submit(): void {
    if (this.isSubmitting()) {
      return;
    }
    const context = this.requestContext();
    const title = this.title.trim();
    if (!title) {
      return;
    }
    if (!context) {
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
    const canonicalContext = {
      facts: this.investigationContext
        .items()
        .filter((item) => item.enabled)
        .map((item): IncidentFactInput => {
          const fact = contextItemToFact(item);
          return {
            id: fact.id,
            entity: fact.entity,
            field: fact.field,
            value: fact.value,
            origin: fact.origin,
            enabled: fact.enabled,
            ...(fact.physical ? { physical: fact.physical } : {}),
            ...(fact.mapping ? { mapping: fact.mapping } : {}),
            scope: {
              storeId: datatugServeProjectStoreId,
              projectId: context.scope.project,
              environment: context.scope.environment,
            },
          };
        }),
    };
    const fingerprint = JSON.stringify({
      context,
      title,
      description,
      canonicalContext,
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
      .create(context.agentStoreId, {
        ...context.scope,
        mutationId,
        title,
        description,
        canonicalContext,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
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
          const detailContext: IncidentRequestContext = {
            agentStoreId: context.agentStoreId,
            scope: { ...context.scope, storeId: result.data.ref.storeId },
          };
          this.router
            .navigate(
              [
                '/incidents',
                result.data.ref.storeId,
                result.data.ref.incidentId,
              ],
              {
                queryParams: incidentContextQueryParams(detailContext),
                replaceUrl: true,
              },
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
    return JSON.stringify(this.requestContext());
  }
}
