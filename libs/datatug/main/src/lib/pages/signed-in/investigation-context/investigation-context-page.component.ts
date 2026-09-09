import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonMenuButton,
  IonSpinner,
  IonText,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline, linkOutline } from 'ionicons/icons';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import {
  AgentContextService,
  Candidate,
  ContextItem,
  Fact,
  InvestigationContextService,
  SemanticApiService,
  toFact,
  tryDecodeErrorEnvelope,
} from '@sneat/datatug-semantic';
import { getStoreId, IProjectContext } from '../../../nav/nav-models';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';

addIcons({ closeOutline, linkOutline });

/**
 * REQ:context-basket, REQ:applicable-queries (plan task 9) — the "Variables" route
 * (`datatug-routing-proj.ts`) becomes this screen (A3: the internal name stays
 * `basket`, the user-facing label is "Investigation Context"). It is the full-page
 * counterpart to `InvestigationContextBarComponent` (chips on every project screen,
 * `ProjectMenuTopComponent`): every collected value with its source, an enable/disable
 * toggle and a remove action, and the queries the *enabled* subset of the context makes
 * applicable — same server contract as `ContextPanelComponent`
 * (`POST /datatug/queries/applicable`, plan Task 12 cut-over), no new client-server
 * contract (INTEGRATION.md).
 *
 * `ContextItem` (investigation-context.service.ts) carries `source` (where the value
 * was added from, e.g. "grid", a related-lookup id) and `label` (the rendered
 * `entity.field = value`) — it does not carry the semantic `declared|inferred`
 * provenance from `GET /datatug/semantic/columns` (that lives on the grid-column
 * mapping, not on a context item once added). This screen shows what the model
 * actually carries: label, source and when it was added.
 */
@Component({
  selector: 'sneat-datatug-investigation-context',
  templateUrl: './investigation-context-page.component.html',
  styleUrl: './investigation-context-page.component.scss',
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    IonTitle,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonToggle,
    IonButton,
    IonIcon,
    IonSpinner,
    IonText,
  ],
})
export class InvestigationContextPageComponent implements OnDestroy {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly datatugNavContextService = inject(DatatugNavContextService);
  private readonly semanticApi = inject(SemanticApiService);
  private readonly agentContext = inject(AgentContextService);
  private readonly router = inject(Router);
  protected readonly context = inject(InvestigationContextService);

  protected readonly items = this.context.items;
  protected readonly enabledCount = this.context.enabledCount;

  protected readonly applicable = signal<readonly Candidate[]>([]);
  protected readonly notYet = signal<readonly Candidate[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | undefined>(undefined);

  private readonly project = signal<IProjectContext | undefined>(undefined);
  private readonly environment = signal<string | undefined>(undefined);
  private readonly destroyed = new Subject<void>();

  /** Guards the effect below against re-entering itself: `handleLoadError` clears the
   * Investigation Context on `STALE_CONTEXT`, and this effect also depends on
   * `context.items()` — see ContextPanelComponent's identical guard/comment for the
   * reproduced infinite-effect-recursion this prevents. */
  private suppressNextReload = false;

  constructor() {
    this.datatugNavContextService.currentProject
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (currentProject) => this.project.set(currentProject),
        error: (err) =>
          this.errorLogger.logError(
            err,
            'Failed to get current project for the Investigation Context page',
          ),
      });
    this.datatugNavContextService.currentEnv
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (currentEnv) => this.environment.set(currentEnv?.id),
        error: (err) =>
          this.errorLogger.logError(
            err,
            'Failed to get current environment for the Investigation Context page',
          ),
      });

    // Re-resolve applicable queries whenever the project/environment or the enabled
    // context set changes (add/remove/enable/disable) — REQ:applicable-queries.
    effect(() => {
      const project = this.project();
      const environment = this.environment();
      const enabledItems = this.context.items().filter((item) => item.enabled);
      if (this.suppressNextReload) {
        this.suppressNextReload = false;
        return;
      }
      this.loadApplicable(project, environment, enabledItems);
    });
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }

  protected addedAtLabel(item: ContextItem): string {
    try {
      return new Date(item.addedAt).toLocaleString();
    } catch {
      return item.addedAt;
    }
  }

  protected toggle(item: ContextItem): void {
    this.context.setEnabled(item.id, !item.enabled);
  }

  protected remove(item: ContextItem): void {
    this.context.removeValue(item.id);
  }

  protected chainText(chain: Candidate['chain']): string {
    return chain.map((step) => step.explanation).join(' → ');
  }

  protected missingText(missing: readonly string[]): string {
    return missing.join(', ');
  }

  protected isOpenable(candidate: Candidate): boolean {
    return candidate.state === 'needs-target';
  }

  /** Opens an applicable (or needs-target) query with its resolved wire bindings/targets
   * — same router-state contract as `EnvDbTablePageComponent.onOpenQuery`
   * (INTEGRATION.md §3): this shared library deliberately doesn't depend on
   * `@angular/router`, so navigating is a host-page job. */
  protected onOpenApplicable(candidate: Candidate): void {
    const project = this.project();
    if (!project) {
      return;
    }
    this.router
      .navigate(
        [
          '/store',
          getStoreId(project.ref.storeId),
          'project',
          project.ref.projectId,
          'query',
          candidate.queryId,
        ],
        {
          // QueryPageComponent.trackQueryParams() resolves the query it opens from the
          // `id` query-string param, not the `:queryId` path segment — see
          // EnvDbTablePageComponent.onOpenQuery's own comment on this contract.
          queryParams: { id: candidate.queryId },
          state: {
            bindings: candidate.bindings,
            targets: candidate.targets,
            selectedSource: candidate.selectedSource,
          },
        },
      )
      .catch((err) =>
        this.errorLogger.logError(err, 'Failed to open applicable query'),
      );
  }

  protected onOpenNotYet(candidate: Candidate): void {
    if (this.isOpenable(candidate)) {
      this.onOpenApplicable(candidate);
    }
  }

  private loadApplicable(
    project: IProjectContext | undefined,
    environment: string | undefined,
    enabledItems: readonly ContextItem[],
  ): void {
    const projectId = project?.ref.projectId;
    const securityContextId = this.agentContext.securityContextId();
    if (!projectId || !environment || !securityContextId || !enabledItems.length) {
      this.applicable.set([]);
      this.notYet.set([]);
      this.loading.set(false);
      this.error.set(undefined);
      return;
    }
    this.loading.set(true);
    this.error.set(undefined);
    const values: Fact[] = enabledItems.map((item) =>
      toFact(item.entityField.entity, item.entityField.field, item.value, 'context'),
    );
    this.semanticApi
      .getApplicableQueries({ project: projectId, environment, securityContextId, values })
      .subscribe({
        next: (response) => {
          this.applicable.set(response.applicable);
          this.notYet.set(response.notYet);
          this.loading.set(false);
        },
        error: (err: unknown) => this.handleLoadError(err),
      });
  }

  private handleLoadError(err: unknown): void {
    this.loading.set(false);
    const envelope =
      err instanceof HttpErrorResponse ? tryDecodeErrorEnvelope(err.error) : undefined;
    if (envelope?.error.code === 'STALE_CONTEXT') {
      this.suppressNextReload = true;
      this.context.clear();
      this.agentContext.refresh().subscribe({ error: () => undefined });
      this.error.set('Your session changed — context was cleared, please retry.');
      return;
    }
    this.error.set('Failed to load applicable queries');
    this.errorLogger.logError(err, 'Failed to load applicable queries');
  }
}
