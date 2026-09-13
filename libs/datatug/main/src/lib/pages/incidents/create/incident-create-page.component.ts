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
import { agentBaseUrl } from '../../../services/repo/agent-url';
import {
  datatugServeProjectStoreId,
  incidentAgentQueryParam,
  incidentContextQueryParams,
  incidentEnvironmentQueryParam,
  incidentProjectQueryParam,
  incidentStoreQueryParam,
} from '../../../incidents/incident-route-context';
import {
  CreateIncidentRequest,
  IncidentDetail,
  IncidentFactInput,
  IncidentRequestContext,
} from '../../../incidents/models';

interface CommittedIncident {
  readonly context: IncidentRequestContext;
  readonly incident: IncidentDetail;
  readonly mutationId: string;
}

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
    const securityContextId = agentStoreId
      ? this.agentContext
          .contextFor(agentBaseUrl(agentStoreId))
          .securityContextId()
      : undefined;
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
  private readonly committedIncident = signal<CommittedIncident | undefined>(
    undefined,
  );
  protected readonly createdIncidentLink = computed(() => {
    const committed = this.committedIncident();
    return committed
      ? [
          '/incidents',
          committed.incident.ref.storeId,
          committed.incident.ref.incidentId,
        ]
      : undefined;
  });
  protected readonly createdIncidentQueryParams = computed(() => {
    const committed = this.committedIncident();
    return committed
      ? incidentContextQueryParams({
          agentStoreId: committed.context.agentStoreId,
          scope: {
            ...committed.context.scope,
            storeId: committed.incident.ref.storeId,
          },
        })
      : undefined;
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
  private readonly activeTargetKey = signal<string | undefined>(undefined);
  private readonly isRefreshingAgentContext = signal(false);
  private readonly submissionToken = signal(0);

  private readonly selectInvestigationContext = effect(() => {
    const context = this.requestContext();
    if (!context) {
      return;
    }
    this.investigationContext.setScope(
      {
        project: context.scope.project,
        environment: context.scope.environment,
        securityContextId: context.scope.securityContextId,
      },
      agentBaseUrl(context.agentStoreId),
    );
  });

  private readonly retireStaleSubmission = effect(() => {
    const scopeKey = this.currentScopeKey();
    const activeScopeKey = this.activeScopeKey();
    if (activeScopeKey && activeScopeKey !== scopeKey) {
      if (
        this.isRefreshingAgentContext() &&
        this.activeTargetKey() === this.currentTargetKey()
      ) {
        return;
      }
      this.activeScopeKey.set(undefined);
      this.activeTargetKey.set(undefined);
      this.isRefreshingAgentContext.set(false);
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
    const committed = this.committedIncident();
    if (committed) {
      this.navigateToCommittedIncident(committed);
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
    this.activeTargetKey.set(this.currentTargetKey());
    const description = this.description.trim() || undefined;
    const canonicalContext = this.canonicalContext(context);
    const fingerprint = this.mutationFingerprint(
      context,
      title,
      description,
      canonicalContext,
    );
    const pendingMutation = this.pendingMutation();
    let mutationId = pendingMutation?.id;
    if (pendingMutation?.fingerprint !== fingerprint || !mutationId) {
      mutationId = `incident-create-${this.randomId.newRandomId({ len: 20 })}`;
      this.pendingMutation.set({
        fingerprint,
        id: mutationId,
      });
    }
    this.persistIncident(
      context,
      {
        ...context.scope,
        mutationId,
        title,
        description,
        canonicalContext,
      },
      submissionToken,
      false,
    );
  }

  private canonicalContext(context: IncidentRequestContext) {
    return {
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
  }

  private mutationFingerprint(
    context: IncidentRequestContext,
    title: string,
    description: string | undefined,
    canonicalContext: CreateIncidentRequest['canonicalContext'],
  ): string {
    return JSON.stringify({
      agentStoreId: context.agentStoreId,
      scope: {
        storeId: context.scope.storeId,
        project: context.scope.project,
        environment: context.scope.environment,
      },
      title,
      description,
      canonicalContext,
    });
  }

  private persistIncident(
    context: IncidentRequestContext,
    request: CreateIncidentRequest,
    submissionToken: number,
    staleRecoveryAttempted: boolean,
  ): void {
    const scopeKey = JSON.stringify(context);
    const targetKey = this.targetKey(context);
    this.incidentClient
      .create(context.agentStoreId, request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (
          submissionToken !== this.submissionToken() ||
          scopeKey !== this.currentScopeKey()
        ) {
          return;
        }
        if (
          result.kind === 'error' &&
          result.code === 'STALE_CONTEXT' &&
          !staleRecoveryAttempted
        ) {
          this.isRefreshingAgentContext.set(true);
          this.investigationContext.clear();
          this.agentContext
            .contextFor(agentBaseUrl(context.agentStoreId))
            .refresh()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: () => {
                const refreshedContext = this.requestContext();
                if (
                  submissionToken !== this.submissionToken() ||
                  !refreshedContext ||
                  targetKey !== this.targetKey(refreshedContext)
                ) {
                  return;
                }
                const refreshedCanonicalContext =
                  this.canonicalContext(refreshedContext);
                const refreshedRequest: CreateIncidentRequest = {
                  ...request,
                  ...refreshedContext.scope,
                  canonicalContext: refreshedCanonicalContext,
                };
                this.pendingMutation.set({
                  id: request.mutationId,
                  fingerprint: this.mutationFingerprint(
                    refreshedContext,
                    request.title,
                    request.description,
                    refreshedCanonicalContext,
                  ),
                });
                this.activeScopeKey.set(JSON.stringify(refreshedContext));
                this.isRefreshingAgentContext.set(false);
                this.persistIncident(
                  refreshedContext,
                  refreshedRequest,
                  submissionToken,
                  true,
                );
              },
              error: () => {
                if (
                  submissionToken !== this.submissionToken() ||
                  targetKey !== this.currentTargetKey()
                ) {
                  return;
                }
                this.activeScopeKey.set(undefined);
                this.activeTargetKey.set(undefined);
                this.isRefreshingAgentContext.set(false);
                this.isSubmitting.set(false);
                this.errorMessage.set(
                  'The DataTug agent context changed and could not be refreshed.',
                );
              },
            });
          return;
        }
        this.activeScopeKey.set(undefined);
        this.activeTargetKey.set(undefined);
        this.isRefreshingAgentContext.set(false);
        this.isSubmitting.set(false);
        if (result.kind === 'ok') {
          const committed = {
            context,
            incident: result.data,
            mutationId: request.mutationId,
          };
          this.committedIncident.set(committed);
          this.navigateToCommittedIncident(committed);
          return;
        }
        // Keep the draft (title/description untouched) and report the
        // failure — hub REQ:houston-creation / plan Task 9 scope: no mock
        // data, no local-only write, no silent loss of what was typed.
        this.errorMessage.set(result.message);
      });
  }

  private navigateToCommittedIncident(committed: CommittedIncident): void {
    const detailContext: IncidentRequestContext = {
      agentStoreId: committed.context.agentStoreId,
      scope: {
        ...committed.context.scope,
        storeId: committed.incident.ref.storeId,
      },
    };
    this.isSubmitting.set(true);
    this.errorMessage.set(undefined);
    this.router
      .navigate(
        [
          '/incidents',
          committed.incident.ref.storeId,
          committed.incident.ref.incidentId,
        ],
        {
          queryParams: incidentContextQueryParams(detailContext),
          replaceUrl: true,
        },
      )
      .then((navigated) => {
        this.isSubmitting.set(false);
        if (navigated) {
          this.pendingMutation.set(undefined);
          return;
        }
        this.reportCommittedNavigationFailure(committed);
      })
      .catch(() => {
        this.isSubmitting.set(false);
        this.reportCommittedNavigationFailure(committed);
      });
  }

  private reportCommittedNavigationFailure(committed: CommittedIncident): void {
    this.errorMessage.set(
      `Incident ${committed.incident.ref.incidentId} was created, but it could not be opened automatically. Use Open created incident below.`,
    );
  }

  private currentScopeKey(): string {
    return JSON.stringify(this.requestContext());
  }

  private currentTargetKey(): string {
    const context = this.requestContext();
    return context ? this.targetKey(context) : '';
  }

  private targetKey(context: IncidentRequestContext): string {
    return JSON.stringify({
      agentStoreId: context.agentStoreId,
      storeId: context.scope.storeId,
      project: context.scope.project,
      environment: context.scope.environment,
    });
  }
}
