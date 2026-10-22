import { HttpErrorResponse } from '@angular/common/http';
import { RetainedEvidenceApiService } from '../evidence/retained-evidence-api.service';
import { useNativeRunLifetime } from '../evidence/native-run-lifetime';
import {
  EvidenceSharePanelComponent,
  EvidenceShareSelection,
} from '../evidence/evidence-share-panel.component';
import { requireAppliedInputMatch } from '../evidence/applied-evidence';
import { RetainedRunIntent } from '../evidence/run-intent';
import { SessionDetectiveRunComponent } from '../session-context/session-detective-run.component';
import { SessionWorkspaceService } from '../session-context/session-workspace.service';
import { CommonModule, DOCUMENT } from '@angular/common';
import { DEMO_PROJECT_REF } from '@datatug/project-address';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, UrlTree } from '@angular/router';
import {
  IonBackButton,
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
  IonList,
  IonCheckbox,
  IonMenuButton,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { catchError, firstValueFrom, forkJoin, map, of } from 'rxjs';
import { projectPageHref } from '../nav/project-page-href';
import { IEnvironmentFull } from '../models/definition/environments';
import { IQueryDef } from '../models/definition/query-def';
import { QueriesService } from '../queries/queries.service';
import { ProjectService } from '../services/project/project.service';
import {
  DetectiveClientService,
  detectiveErrorMessage,
} from './detective-client.service';
import {
  caseRunLinkMessage,
  detectiveParameterName,
  detectiveSlug,
  compatibleCaseInput,
  compatibleCaseInputs,
  displayInputValue,
  parseInputValue,
  parseScalar,
  validParameterBindings,
  validValidatorBindings,
} from './detective-forms';
import { useDetectivePageContext } from './detective-page-context';
import {
  CheckBinding,
  CheckDefinition,
  CheckInput,
  CheckRun,
  CheckStep,
  CheckStepResult,
  DetectiveInputValue,
  DetectiveState,
  PublishedValidator,
  QueryValidators,
  ValidatorDefinition,
} from './models';
import { ValidationRunResultsComponent } from './validation-run-results.component';
import { DetectiveDemoStarterComponent } from './detective-demo-starter.component';
import { DetectiveAiPanelComponent } from './detective-ai-panel.component';
import { checkConsumers, inspectCheck } from './check-inspection';
import { PublicDemoChecksComponent } from './public-demo-checks.component';
import { isPublicChecksProject } from './public-demo-checks.service';

const NEW_CHECK = (): CheckDefinition => ({
  id: '',
  title: '',
  description: '',
  version: 0,
  inputs: [],
  steps: [],
});
const NEW_VALIDATOR = (): ValidatorDefinition => ({
  id: '',
  scope: 'row',
  kind: 'non-null',
  severity: 'error',
});
interface QueryInputRow extends CheckInput {
  value: string;
  end: string;
}

@Component({
  selector: 'sneat-datatug-checks-page',
  templateUrl: './checks-page.component.html',
  styleUrl: './detective-pages.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SessionDetectiveRunComponent,
    EvidenceSharePanelComponent,
    CommonModule,
    FormsModule,
    RouterLink,
    IonBackButton,
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
    IonList,
    IonCheckbox,
    IonMenuButton,
    IonNote,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTextarea,
    IonTitle,
    IonToolbar,
    ValidationRunResultsComponent,
    DetectiveDemoStarterComponent,
    DetectiveAiPanelComponent,
    PublicDemoChecksComponent,
  ],
})
export class ChecksPageComponent {
  private readonly sessionWorkspace = inject(SessionWorkspaceService, {
    optional: true,
  });
  protected readonly nativeSessionId = computed(() =>
    this.sessionWorkspace ? this.params()?.get('sessionId') || '' : '',
  );
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly client = inject(DetectiveClientService);
  private readonly projectService = inject(ProjectService);
  private readonly queriesService = inject(QueriesService);
  private readonly document = inject(DOCUMENT);
  protected readonly scope = useDetectivePageContext();
  private readonly destroyRef = inject(DestroyRef);
  private runLifetime = new AbortController();
  private readonly nativeRunLifetime = useNativeRunLifetime();
  private readonly evidenceInjector = inject(Injector);
  private readonly retainedIntent = new RetainedRunIntent();
  protected readonly evidenceSelection = signal<
    EvidenceShareSelection | undefined
  >(undefined);
  protected readonly retainedPending = signal(false);
  protected readonly retainedReviewed = signal(false);
  constructor() {
    this.nativeRunLifetime.changes$
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.invalidateHeldRun());
    this.scope.scopeChanges$
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.invalidateHeldRun());
    this.route.paramMap
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.invalidateHeldRun());
    this.route.queryParamMap
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.invalidateHeldRun());
    this.destroyRef.onDestroy(() => this.invalidateHeldRun());
  }
  private invalidateHeldRun(): void {
    this.runLifetime.abort();
    this.runLifetime = new AbortController();
    this.selectedRun.set(undefined);
    this.evidenceSelection.set(undefined);
    this.retainedIntent.clearHeld();
    this.retainedPending.set(false);
    this.retainedReviewed.set(false);
  }
  protected changeRunEnvironment(value: string): void {
    if (this.retainedPending()) return;
    this.invalidateHeldRun();
    this.environment.set(value);
  }
  protected chooseEvidence(
    selection: EvidenceShareSelection | undefined,
  ): void {
    if (!this.retainedPending()) this.evidenceSelection.set(selection);
  }
  protected async reviewRetainedRun(): Promise<void> {
    this.retainedReviewed.set(false);
    const identity = this.pageIdentity();
    try {
      await this.refresh();
      if (
        !this.destroyRef.destroyed &&
        this.isCurrentScope(identity) &&
        this.retainedPending()
      )
        this.retainedReviewed.set(true);
    } catch (error) {
      if (this.isCurrentScope(identity))
        this.error.set(detectiveErrorMessage(error, true));
    }
  }
  protected abandonRetainedRun(): void {
    if (!this.retainedReviewed() || this.busy()) return;
    this.retainedIntent.abandonReviewed();
    this.retainedPending.set(false);
    this.retainedReviewed.set(false);
    this.evidenceSelection.set(undefined);
  }

  protected readonly publicDemo = computed(
    () =>
      this.scope.ref()?.storeId === 'github.com' &&
      this.scope.ref()?.projectId === DEMO_PROJECT_REF.projectId,
  );
  protected readonly publicChecks = computed(() =>
    isPublicChecksProject(this.scope.ref()),
  );
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly state = signal<DetectiveState | undefined>(undefined);
  protected readonly loading = signal(false);
  protected readonly runCapabilityHint = computed(() => {
    const capabilities = this.state()?.capabilities;
    if (this.loading() || !capabilities || capabilities.canRun) return '';
    return capabilities.localOnly
      ? 'Check execution is disabled on the connected local agent.'
      : 'Check execution is unavailable for this project on the connected service.';
  });
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly messageOutcome = signal<'pass' | 'fail' | 'unknown'>(
    'pass',
  );
  protected readonly search = signal('');
  protected readonly draft = signal<CheckDefinition | undefined>(undefined);
  protected readonly validatorDraft = signal<PublishedValidator | undefined>(
    undefined,
  );
  protected readonly queryValidatorDraft = signal<QueryValidators | undefined>(
    undefined,
  );
  protected readonly queryInputRows = signal<QueryInputRow[]>([]);
  protected readonly olderRunsBusy = signal(false);
  protected readonly environment = signal('');
  protected readonly availableEnvironments = signal<IEnvironmentFull[]>([]);
  protected readonly environmentsLoading = signal(false);
  protected readonly environmentsError = signal('');
  protected readonly runInputText = signal<
    Record<string, { value: string; end: string }>
  >({});
  protected readonly selectedRun = signal<CheckRun | undefined>(undefined);
  protected readonly runLinkNotice = signal<
    { runId: string; text: string } | undefined
  >(undefined);
  protected readonly queryDetails = signal<Record<string, IQueryDef | null>>(
    {},
  );
  protected readonly queryDetailsLoading = signal(false);
  protected readonly checkId = computed(
    () => this.params().get('checkId') || undefined,
  );
  protected readonly caseId = computed(
    () => this.queryParams().get('caseId') || undefined,
  );
  protected readonly queryId = computed(
    () => this.queryParams().get('query') || undefined,
  );

  protected readonly pageIdentity = computed(() => {
    const scope = this.scope.identity();
    return scope
      ? JSON.stringify([scope, this.checkId(), this.queryId(), this.caseId()])
      : undefined;
  });
  private activeScopeIdentity = '';
  private draftScopeIdentity = '';
  private validatorDraftScopeIdentity = '';
  private queryValidatorDraftScopeIdentity = '';
  private prefilledCaseCheck = '';
  private readonly resetScope = effect(() => {
    const identity = this.pageIdentity() || '';
    if (identity === this.activeScopeIdentity) return;
    this.activeScopeIdentity = identity;
    this.draftScopeIdentity = '';
    this.validatorDraftScopeIdentity = '';
    this.queryValidatorDraftScopeIdentity = '';
    this.state.set(undefined);
    this.draft.set(undefined);
    this.validatorDraft.set(undefined);
    this.queryValidatorDraft.set(undefined);
    this.queryInputRows.set([]);
    this.runInputText.set({});
    this.selectedRun.set(undefined);
    this.runLinkNotice.set(undefined);
    this.queryDetails.set({});
    this.environment.set('');
    this.availableEnvironments.set([]);
    this.prefilledCaseCheck = '';
    this.olderRunsBusy.set(false);
    this.environmentsLoading.set(false);
    this.environmentsError.set('');
    this.loading.set(false);
    this.busy.set(false);
    this.error.set('');
    this.message.set('');
  });
  private isCurrentScope(identity: string | undefined): boolean {
    return !!identity && identity === this.pageIdentity();
  }
  protected readonly currentQueryValidators = computed(() =>
    this.state()?.queryValidators?.find(
      (item) => item.queryId === this.queryId(),
    ),
  );
  protected readonly checks = computed(() => {
    const search = this.search().trim().toLowerCase();
    return (this.state()?.checks || []).filter(
      (check) =>
        !search ||
        `${check.id} ${check.title} ${check.description || ''}`
          .toLowerCase()
          .includes(search),
    );
  });
  protected readonly current = computed(() =>
    this.state()?.checks.find((check) => check.id === this.checkId()),
  );
  protected readonly caseContext = computed(() =>
    this.state()?.cases.find((item) => item.id === this.caseId()),
  );
  protected readonly caseCheckCompatible = computed(() => {
    const check = this.current();
    const investigation = this.caseContext();
    if (!this.caseId()) return true;
    return (
      !!check &&
      !!investigation &&
      compatibleCaseInputs(check.inputs, investigation.context)
    );
  });
  private readonly prefillCaseInputs = effect(() => {
    const check = this.current();
    const investigation = this.caseContext();
    if (!check || !investigation || !this.caseId()) return;
    const key = `${investigation.id}/${check.id}`;
    if (this.prefilledCaseCheck === key) return;
    this.prefilledCaseCheck = key;
    this.useCaseContext(true);
  });
  protected readonly history = computed(() =>
    (this.state()?.runs || []).filter((run) => run.checkId === this.checkId()),
  );
  protected readonly queryHistory = computed(() =>
    (this.state()?.runs || []).filter(
      (run) =>
        run.kind === 'query-validators' && run.queryId === this.queryId(),
    ),
  );
  protected readonly displayedRun = computed(
    () => this.selectedRun() || this.history()[0],
  );
  protected readonly observedSources = computed(() => {
    const sources = new Set<string>();
    const visit = (steps: CheckStepResult[]) => {
      for (const step of steps) {
        if (step.source) sources.add(step.source);
        if (step.children) visit(step.children);
      }
    };
    visit(this.displayedRun()?.steps || []);
    return [...sources];
  });
  protected readonly displayedQueryRun = computed(
    () => this.selectedRun() || this.queryHistory()[0],
  );
  protected readonly inspection = computed(() => {
    const check = this.current();
    const state = this.state();
    return check && state ? inspectCheck(check, state) : undefined;
  });
  protected readonly usedBy = computed(() => {
    const id = this.checkId();
    const state = this.state();
    return id && state ? checkConsumers(id, state) : undefined;
  });
  private readonly loadQueryDetails = effect((onCleanup) => {
    const ref = this.scope.ref();
    const identity = this.pageIdentity();
    const ids = this.inspection()?.queryIds || [];
    this.queryDetails.set({});
    this.queryDetailsLoading.set(false);
    if (!ref || !ids.length) return;
    this.queryDetailsLoading.set(true);
    const subscription = forkJoin(
      ids.map((id) =>
        this.queriesService.getQuery(ref, id).pipe(
          map((query) => [id, query] as const),
          catchError(() => of([id, null] as const)),
        ),
      ),
    ).subscribe((queries) => {
      if (!this.isCurrentScope(identity)) return;
      this.queryDetails.set(Object.fromEntries(queries));
      this.queryDetailsLoading.set(false);
    });
    onCleanup(() => subscription.unsubscribe());
  });
  // Hosted environments are admitted by the server; local agents retain their
  // project_full source until both transports expose the same state field.
  private readonly loadEnvironments = effect((onCleanup) => {
    const ref = this.scope.ref();
    const identity = this.pageIdentity();
    this.availableEnvironments.set([]);
    this.environment.set('');
    this.environmentsError.set('');
    this.environmentsLoading.set(false);
    if (
      !ref ||
      this.scope.unsupported() ||
      this.scope.context()?.kind === 'cloud'
    )
      return;
    this.environmentsLoading.set(true);
    const subscription = this.projectService.getFull(ref).subscribe({
      next: (project) => {
        if (!this.isCurrentScope(identity)) return;
        this.availableEnvironments.set(project.environments || []);
        this.environmentsLoading.set(false);
      },
      error: () => {
        if (!this.isCurrentScope(identity)) return;
        this.environmentsError.set(
          'Could not load project environments from the agent.',
        );
        this.environmentsLoading.set(false);
      },
    });
    onCleanup(() => subscription.unsubscribe());
  });

  private readonly loadState = effect((onCleanup) => {
    const context = this.scope.context();
    const identity = this.pageIdentity();
    this.state.set(undefined);
    this.error.set('');
    if (!context) return;
    this.loading.set(true);
    const subscription = this.client.state(context).subscribe({
      next: (state) => {
        if (!this.isCurrentScope(identity)) return;
        this.state.set(state);
        if (context.kind === 'cloud') {
          this.availableEnvironments.set(
            (state.environments || []).map((id) => ({ id, title: id })),
          );
          this.environmentsLoading.set(false);
        }
        this.loading.set(false);
      },
      error: (error: unknown) => {
        if (!this.isCurrentScope(identity)) return;
        this.error.set(
          detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
        );
        this.loading.set(false);
      },
    });
    onCleanup(() => subscription.unsubscribe());
  });

  private readonly selectEnvironment = effect(() => {
    const active = this.scope.currentEnvironment()?.id;
    if (
      active &&
      this.availableEnvironments().some(
        (environment) => environment.id === active,
      ) &&
      !this.environment()
    )
      this.environment.set(active);
  });

  protected pageRoute(href: string): UrlTree {
    return this.router.parseUrl(href);
  }
  private sessionPageHref(page: string | string[]): string {
    const id = this.nativeSessionId();
    return projectPageHref(
      this.scope.ref(),
      id
        ? ['sessions', id, ...(typeof page === 'string' ? [page] : page)]
        : page,
    );
  }
  protected checksUrl(): string {
    return this.sessionPageHref('checks');
  }
  protected checkUrl(id: string): string {
    return this.sessionPageHref(['checks', id]);
  }
  protected caseUrl(): string {
    const caseId = this.caseId();
    return this.sessionPageHref(caseId ? ['detective', caseId] : 'detective');
  }
  protected queryUrl(id: string) {
    const url = projectPageHref(this.scope.ref(), ['query', id]);
    return this.router.parseUrl(
      `${url}${url.includes('?') ? '&' : '?'}id=${encodeURIComponent(id)}`,
    );
  }
  protected validatorSummary(validator: ValidatorDefinition): string {
    const target = validator.checkId
      ? ` → Check ${validator.checkId}`
      : validator.field
        ? ` · ${validator.field}${validator.otherField ? ` / ${validator.otherField}` : ''}`
        : '';
    return `${validator.scope} ${validator.kind || 'published'} · configured failure severity: ${validator.severity}${target}`;
  }
  protected recordedUpdateAt(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    return Number.isFinite(parsed.valueOf()) && parsed.getUTCFullYear() > 1
      ? value
      : undefined;
  }
  protected checkInputLabel(name: string): string {
    return name
      .split(/[_\-\s]+/)
      .filter(Boolean)
      .map((part) =>
        part.toLowerCase() === 'id'
          ? 'ID'
          : part.charAt(0).toUpperCase() + part.slice(1),
      )
      .join(' ');
  }
  private focusRunResult(): void {
    // The results card is conditional on the returned run. Let Angular render
    // the signal before moving keyboard focus and scrolling it into view.
    setTimeout(() => {
      const result = this.document.getElementById('detective-check-run-result');
      result?.focus();
      const reducedMotion =
        this.document.defaultView?.matchMedia?.(
          '(prefers-reduced-motion: reduce)',
        ).matches ?? false;
      result?.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    });
  }
  private notify(
    message: string,
    outcome: 'pass' | 'fail' | 'unknown' = 'pass',
  ): void {
    this.messageOutcome.set(outcome);
    this.message.set(message);
  }
  protected editQueryValidators(): void {
    const queryId = this.queryId();
    if (!queryId) return;
    this.queryValidatorDraftScopeIdentity = this.pageIdentity() || '';
    this.queryValidatorDraft.set(
      structuredClone(
        this.currentQueryValidators() || {
          queryId,
          version: 0,
          validators: [],
        },
      ),
    );
  }
  protected addQueryValidator(): void {
    this.queryValidatorDraft.update((draft) =>
      draft
        ? {
            ...draft,
            validators: [
              ...draft.validators,
              {
                ...NEW_VALIDATOR(),
                id: `validator-${draft.validators.length + 1}`,
              },
            ],
          }
        : draft,
    );
  }
  protected updateQueryValidator(
    index: number,
    patch: Partial<ValidatorDefinition>,
  ): void {
    this.queryValidatorDraft.update((draft) =>
      draft
        ? {
            ...draft,
            validators: draft.validators.map((validator, i) =>
              i === index ? { ...validator, ...patch } : validator,
            ),
          }
        : draft,
    );
  }
  protected usePublishedQueryValidator(
    index: number,
    validatorId: string,
  ): void {
    this.updateQueryValidator(index, {
      validatorId,
      kind: validatorId ? '' : 'non-null',
    });
  }
  protected removeQueryValidator(index: number): void {
    this.queryValidatorDraft.update((draft) =>
      draft
        ? {
            ...draft,
            validators: draft.validators.filter((_, i) => i !== index),
          }
        : draft,
    );
  }
  protected addQueryValidatorBinding(index: number): void {
    const validator = this.queryValidatorDraft()?.validators[index];
    if (validator)
      this.updateQueryValidator(index, {
        bindings: [...(validator.bindings || []), { input: '' }],
      });
  }
  protected updateQueryValidatorBinding(
    index: number,
    bindingIndex: number,
    patch: Partial<CheckBinding>,
  ): void {
    const validator = this.queryValidatorDraft()?.validators[index];
    if (validator)
      this.updateQueryValidator(index, {
        bindings: (validator.bindings || []).map((binding, i) =>
          i === bindingIndex ? { ...binding, ...patch } : binding,
        ),
      });
  }
  protected removeQueryValidatorBinding(
    index: number,
    bindingIndex: number,
  ): void {
    const validator = this.queryValidatorDraft()?.validators[index];
    if (validator)
      this.updateQueryValidator(index, {
        bindings: (validator.bindings || []).filter(
          (_, i) => i !== bindingIndex,
        ),
      });
  }
  protected setQueryExpected(index: number, raw: string): void {
    try {
      this.updateQueryValidator(index, {
        expected: raw.trim() ? parseScalar(raw, 'number') : undefined,
      });
      this.error.set('');
    } catch (error) {
      this.error.set(
        detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
      );
    }
  }
  protected async saveQueryValidators(): Promise<void> {
    const context = this.scope.context();
    const identity = this.pageIdentity();
    const draft = this.queryValidatorDraft();
    if (
      !context ||
      !draft ||
      identity !== this.queryValidatorDraftScopeIdentity
    )
      return;
    if (
      !draft.queryId ||
      draft.validators.some((validator) => !detectiveSlug.test(validator.id))
    ) {
      this.error.set('Each Validator needs a slug ID.');
      return;
    }
    if (!validValidatorBindings(draft.validators)) {
      this.error.set(
        'Binding input names must use the Check parameter name format (up to 128 characters).',
      );
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.client.action(context, {
          type: 'save-query-validators',
          queryValidators: draft,
        }),
      );
      if (!this.isCurrentScope(identity)) return;
      if (!response.queryValidators)
        throw new Error(
          'The project store did not return the query Validators.',
        );
      await this.refresh();
      if (!this.isCurrentScope(identity)) return;
      if (this.queryValidatorDraft() !== draft) {
        this.notify(
          'The earlier Validators were saved; your newer edits remain open.',
        );
        return;
      }
      this.queryValidatorDraft.set(undefined);
      this.notify(`Saved local Validators for ${draft.queryId}.`);
    } catch (error) {
      if (
        !this.isCurrentScope(identity) ||
        this.queryValidatorDraft() !== draft
      )
        return;
      this.error.set(
        detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
      );
    } finally {
      if (this.isCurrentScope(identity)) this.busy.set(false);
    }
  }
  protected addQueryInput(): void {
    this.queryInputRows.update((all) => [
      ...all,
      {
        name: '',
        type: 'string',
        cardinality: 'scalar',
        value: '',
        end: '',
      },
    ]);
  }
  protected updateQueryInput(
    index: number,
    patch: Partial<QueryInputRow>,
  ): void {
    this.queryInputRows.update((all) =>
      all.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }
  protected removeQueryInput(index: number): void {
    this.queryInputRows.update((all) => all.filter((_, i) => i !== index));
  }
  protected async runQueryValidators(): Promise<void> {
    const context = this.scope.context();
    const identity = this.pageIdentity();
    const queryId = this.queryId();
    if (!context || !queryId) return;
    const environment = this.environment().trim();
    if (!environment) {
      this.error.set('Select a logical environment before validating.');
      return;
    }
    const inputs: Record<string, DetectiveInputValue> = {};
    try {
      for (const row of this.queryInputRows()) {
        const name = row.name.trim();
        if (
          !detectiveParameterName.test(name) ||
          !row.value.trim() ||
          inputs[name]
        )
          throw new Error('Each query input needs a unique name and value.');
        inputs[name] = parseInputValue(
          row.value,
          row.type,
          row.cardinality,
          row.end,
        );
      }
    } catch (error) {
      this.error.set(
        detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
      );
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.client.action(context, {
          type: 'run-query-validators',
          queryId,
          environment,
          inputs,
          caseId: this.caseId(),
        }),
      );
      if (!this.isCurrentScope(identity)) return;
      if (!response.run)
        throw new Error('The project store did not return a Validator run.');
      await this.refresh();
      if (!this.isCurrentScope(identity)) return;
      this.selectedRun.set(response.run);
      const linkText = caseRunLinkMessage(
        this.caseId(),
        response.run.id,
        response.caseLinkStatus,
        response.run.executionStatus,
      );
      this.runLinkNotice.set(
        linkText ? { runId: response.run.id, text: linkText } : undefined,
      );
      this.notify(
        `Validator run ${response.run.id}: ${response.run.outcome}.${linkText ? ` ${linkText}` : ''}`,
        response.run.outcome,
      );
      this.focusRunResult();
    } catch (error) {
      if (!this.isCurrentScope(identity)) return;
      this.error.set(
        detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
      );
    } finally {
      if (this.isCurrentScope(identity)) this.busy.set(false);
    }
  }
  protected async loadOlderRuns(): Promise<void> {
    const context = this.scope.context();
    const identity = this.pageIdentity();
    const state = this.state();
    if (!context || !state?.runsHasMore || !state.runsNextCursor) return;
    this.olderRunsBusy.set(true);
    this.error.set('');
    try {
      const older = await firstValueFrom(
        this.client.state(context, state.runsNextCursor),
      );
      if (!this.isCurrentScope(identity)) return;
      const seen = new Set(state.runs.map((run) => run.id));
      this.state.set({
        ...older,
        runs: [...state.runs, ...older.runs.filter((run) => !seen.has(run.id))],
      });
    } catch (error) {
      if (!this.isCurrentScope(identity)) return;
      this.error.set(
        detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
      );
    } finally {
      if (this.isCurrentScope(identity)) this.olderRunsBusy.set(false);
    }
  }

  protected startNew(): void {
    this.draftScopeIdentity = this.pageIdentity() || '';
    this.draft.set(NEW_CHECK());
    this.error.set('');
  }
  protected startEdit(): void {
    const check = this.current();
    if (check) {
      this.draftScopeIdentity = this.pageIdentity() || '';
      this.draft.set(structuredClone(check));
    }
  }
  protected cancelEdit(): void {
    this.draft.set(undefined);
    this.error.set('');
  }
  protected updateDraft(patch: Partial<CheckDefinition>): void {
    this.draft.update((draft) => (draft ? { ...draft, ...patch } : draft));
  }
  protected addInput(): void {
    const draft = this.draft();
    if (draft)
      this.updateDraft({
        inputs: [
          ...draft.inputs,
          { name: '', type: 'string', cardinality: 'scalar' },
        ],
      });
  }
  protected updateInput(index: number, patch: Partial<CheckInput>): void {
    const draft = this.draft();
    if (draft)
      this.updateDraft({
        inputs: draft.inputs.map((input, i) =>
          i === index ? { ...input, ...patch } : input,
        ),
      });
  }
  protected removeInput(index: number): void {
    const draft = this.draft();
    if (draft)
      this.updateDraft({ inputs: draft.inputs.filter((_, i) => i !== index) });
  }
  protected addStep(kind: CheckStep['kind']): void {
    const draft = this.draft();
    if (draft)
      this.updateDraft({
        steps: [
          ...draft.steps,
          {
            id: `step-${draft.steps.length + 1}`,
            kind,
            validators: [],
            bindings: [],
          },
        ],
      });
  }
  protected updateStep(index: number, patch: Partial<CheckStep>): void {
    const draft = this.draft();
    if (draft)
      this.updateDraft({
        steps: draft.steps.map((step, i) =>
          i === index ? { ...step, ...patch } : step,
        ),
      });
  }
  protected removeStep(index: number): void {
    const draft = this.draft();
    if (draft)
      this.updateDraft({ steps: draft.steps.filter((_, i) => i !== index) });
  }
  protected addBinding(stepIndex: number): void {
    const step = this.draft()?.steps[stepIndex];
    if (step)
      this.updateStep(stepIndex, {
        bindings: [...(step.bindings || []), { input: '' }],
      });
  }
  protected updateBinding(
    stepIndex: number,
    index: number,
    patch: Partial<CheckBinding>,
  ): void {
    const step = this.draft()?.steps[stepIndex];
    if (step)
      this.updateStep(stepIndex, {
        bindings: (step.bindings || []).map((binding, i) =>
          i === index ? { ...binding, ...patch } : binding,
        ),
      });
  }
  protected removeBinding(stepIndex: number, index: number): void {
    const step = this.draft()?.steps[stepIndex];
    if (step)
      this.updateStep(stepIndex, {
        bindings: (step.bindings || []).filter((_, i) => i !== index),
      });
  }
  protected addValidator(stepIndex: number): void {
    const step = this.draft()?.steps[stepIndex];
    if (step)
      this.updateStep(stepIndex, {
        validators: [
          ...(step.validators || []),
          {
            ...NEW_VALIDATOR(),
            id: `validator-${(step.validators || []).length + 1}`,
          },
        ],
      });
  }
  protected updateValidator(
    stepIndex: number,
    index: number,
    patch: Partial<ValidatorDefinition>,
  ): void {
    const step = this.draft()?.steps[stepIndex];
    if (step)
      this.updateStep(stepIndex, {
        validators: (step.validators || []).map((validator, i) =>
          i === index ? { ...validator, ...patch } : validator,
        ),
      });
  }
  protected usePublishedValidator(
    stepIndex: number,
    index: number,
    validatorId: string,
  ): void {
    this.updateValidator(stepIndex, index, {
      validatorId,
      kind: validatorId ? '' : 'non-null',
    });
  }
  protected removeValidator(stepIndex: number, index: number): void {
    const step = this.draft()?.steps[stepIndex];
    if (step)
      this.updateStep(stepIndex, {
        validators: (step.validators || []).filter((_, i) => i !== index),
      });
  }
  protected addValidatorBinding(stepIndex: number, index: number): void {
    const validator = this.draft()?.steps[stepIndex]?.validators?.[index];
    if (validator)
      this.updateValidator(stepIndex, index, {
        bindings: [...(validator.bindings || []), { input: '' }],
      });
  }
  protected updateValidatorBinding(
    stepIndex: number,
    index: number,
    bindingIndex: number,
    patch: Partial<CheckBinding>,
  ): void {
    const validator = this.draft()?.steps[stepIndex]?.validators?.[index];
    if (validator)
      this.updateValidator(stepIndex, index, {
        bindings: (validator.bindings || []).map((binding, i) =>
          i === bindingIndex ? { ...binding, ...patch } : binding,
        ),
      });
  }
  protected removeValidatorBinding(
    stepIndex: number,
    index: number,
    bindingIndex: number,
  ): void {
    const validator = this.draft()?.steps[stepIndex]?.validators?.[index];
    if (validator)
      this.updateValidator(stepIndex, index, {
        bindings: (validator.bindings || []).filter(
          (_, i) => i !== bindingIndex,
        ),
      });
  }
  protected setExpected(stepIndex: number, index: number, raw: string): void {
    try {
      this.updateValidator(stepIndex, index, {
        expected: parseScalar(raw, 'number'),
      });
      this.error.set('');
    } catch (error) {
      this.error.set(
        detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
      );
    }
  }

  protected async save(): Promise<void> {
    const context = this.scope.context();
    const identity = this.pageIdentity();
    const draft = this.draft();
    if (!context || !draft || identity !== this.draftScopeIdentity) return;
    if (
      !detectiveSlug.test(draft.id) ||
      !draft.title.trim() ||
      !draft.steps.length
    ) {
      this.error.set('Use a slug ID, a title, and at least one step.');
      return;
    }
    if (
      draft.inputs.some((input) => !detectiveParameterName.test(input.name))
    ) {
      this.error.set(
        'Check input names must start with a letter and use letters, digits, underscores or hyphens (up to 128 characters).',
      );
      return;
    }
    if (
      draft.steps.some(
        (step) =>
          !validParameterBindings(step.bindings) ||
          !validValidatorBindings(step.validators),
      )
    ) {
      this.error.set(
        'Binding input names must start with a letter and use letters, digits, underscores or hyphens (up to 128 characters).',
      );
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.client.action(context, { type: 'save-check', check: draft }),
      );
      if (!this.isCurrentScope(identity)) return;
      if (!response.check)
        throw new Error('The project store did not return the saved Check.');
      await this.refresh();
      if (!this.isCurrentScope(identity)) return;
      if (this.draft() !== draft) {
        this.notify(
          'The earlier Check was saved; your newer edits remain open.',
        );
        return;
      }
      this.draft.set(undefined);
      await this.router.navigateByUrl(this.checkUrl(response.check.id), {
        replaceUrl: draft.version === 0,
      });
      this.notify(
        `Saved Check ${response.check.id} · version ${response.check.version}.`,
      );
    } catch (error) {
      if (!this.isCurrentScope(identity) || this.draft() !== draft) return;
      this.error.set(
        detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
      );
    } finally {
      if (this.isCurrentScope(identity)) this.busy.set(false);
    }
  }

  protected beginPromote(validator: ValidatorDefinition): void {
    if (validator.validatorId) return;
    this.validatorDraftScopeIdentity = this.pageIdentity() || '';
    this.validatorDraft.set({
      id: '',
      title: '',
      version: 0,
      validator: structuredClone(validator),
    });
  }
  protected editPublished(validator: PublishedValidator): void {
    this.validatorDraftScopeIdentity = this.pageIdentity() || '';
    this.validatorDraft.set(structuredClone(validator));
  }
  protected updatePublished(patch: Partial<PublishedValidator>): void {
    this.validatorDraft.update((draft) =>
      draft ? { ...draft, ...patch } : draft,
    );
  }
  protected updatePublishedDefinition(
    patch: Partial<ValidatorDefinition>,
  ): void {
    this.validatorDraft.update((draft) =>
      draft ? { ...draft, validator: { ...draft.validator, ...patch } } : draft,
    );
  }
  protected addPublishedBinding(): void {
    const validator = this.validatorDraft()?.validator;
    if (validator)
      this.updatePublishedDefinition({
        bindings: [...(validator.bindings || []), { input: '' }],
      });
  }
  protected updatePublishedBinding(
    index: number,
    patch: Partial<CheckBinding>,
  ): void {
    const validator = this.validatorDraft()?.validator;
    if (validator)
      this.updatePublishedDefinition({
        bindings: (validator.bindings || []).map((binding, i) =>
          i === index ? { ...binding, ...patch } : binding,
        ),
      });
  }
  protected removePublishedBinding(index: number): void {
    const validator = this.validatorDraft()?.validator;
    if (validator)
      this.updatePublishedDefinition({
        bindings: (validator.bindings || []).filter((_, i) => i !== index),
      });
  }
  protected setPublishedExpected(raw: string): void {
    try {
      this.updatePublishedDefinition({
        expected: raw.trim() ? parseScalar(raw, 'number') : undefined,
      });
      this.error.set('');
    } catch (error) {
      this.error.set(
        detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
      );
    }
  }
  protected async savePublished(): Promise<void> {
    const context = this.scope.context();
    const identity = this.pageIdentity();
    const validator = this.validatorDraft();
    if (!context || !validator || identity !== this.validatorDraftScopeIdentity)
      return;
    if (!detectiveSlug.test(validator.id) || !validator.title.trim()) {
      this.error.set('Published Validator needs a slug ID and title.');
      return;
    }
    if (!validParameterBindings(validator.validator.bindings)) {
      this.error.set(
        'Binding input names must use the Check parameter name format (up to 128 characters).',
      );
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.client.action(context, { type: 'save-validator', validator }),
      );
      if (!this.isCurrentScope(identity)) return;
      if (!response.validator)
        throw new Error('The project store did not return the Validator.');
      await this.refresh();
      if (!this.isCurrentScope(identity)) return;
      if (this.validatorDraft() !== validator) {
        this.notify(
          'The earlier Validator was saved; your newer edits remain open.',
        );
        return;
      }
      this.validatorDraft.set(undefined);
      this.notify(`Published Validator ${response.validator.id}.`);
    } catch (error) {
      if (!this.isCurrentScope(identity) || this.validatorDraft() !== validator)
        return;
      this.error.set(
        detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
      );
    } finally {
      if (this.isCurrentScope(identity)) this.busy.set(false);
    }
  }

  protected setRunInput(
    name: string,
    key: 'value' | 'end',
    value: string,
  ): void {
    if (this.retainedPending()) return;
    this.runLifetime.abort();
    this.runLifetime = new AbortController();
    this.selectedRun.set(undefined);
    this.runInputText.update((all) => ({
      ...all,
      [name]: {
        value: all[name]?.value || '',
        end: all[name]?.end || '',
        [key]: value,
      },
    }));
  }
  protected useCaseContext(automatic = false): void {
    const check = this.current();
    const investigation = this.caseContext();
    if (!check || !investigation) return;
    if (!this.caseCheckCompatible()) {
      this.error.set(
        'This Check does not declare every confirmed Case set or range with a matching type. Choose a compatible Check before running Case evidence.',
      );
      return;
    }
    const next = { ...this.runInputText() };
    let added = 0;
    for (const input of check.inputs) {
      const value = investigation.context[input.name];
      if (!compatibleCaseInput(input, value)) continue;
      if (automatic && next[input.name]?.value.trim()) continue;
      if (input.cardinality === 'range') {
        if (value?.type !== 'range') continue;
        next[input.name] = {
          value: displayInputValue(value.start),
          end: displayInputValue(value.end),
        };
      } else if (input.cardinality === 'set') {
        if (value?.type !== 'set') continue;
        next[input.name] = { value: displayInputValue(value), end: '' };
      } else {
        if (!value || value.type === 'set' || value.type === 'range') continue;
        next[input.name] = { value: displayInputValue(value), end: '' };
      }
      added++;
    }
    this.runInputText.set(next);
    if (added)
      this.notify(
        `${added} matching Case inputs copied for review. Run uses the values shown below.`,
      );
  }
  protected async run(): Promise<void> {
    const context = this.scope.context();
    const identity = this.pageIdentity();
    const check = this.current();
    if (this.nativeSessionId()) {
      this.error.set(
        'Use the native session input preview. Legacy execution is unavailable in a session.',
      );
      return;
    }
    if (
      !context ||
      !check ||
      identity !== this.activeScopeIdentity ||
      this.busy()
    )
      return;
    if (this.caseId() && !this.caseCheckCompatible()) {
      this.error.set(
        'This Check cannot run as evidence for this Case because its confirmed set or range inputs do not match the Check schema.',
      );
      return;
    }
    const environment = this.environment().trim();
    if (!environment) {
      this.error.set('Select a logical environment before running.');
      return;
    }
    const inputs: Record<string, DetectiveInputValue> = {};
    try {
      for (const input of check.inputs) {
        const text = this.runInputText()[input.name];
        if (!text?.value?.trim() && !input.required) continue;
        if (!text?.value?.trim()) throw new Error(`${input.name} is required.`);
        inputs[input.name] = parseInputValue(
          text.value,
          input.type,
          input.cardinality,
          text.end,
        );
      }
    } catch (error) {
      this.error.set(
        detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
      );
      return;
    }
    const selection = this.evidenceSelection();
    if (
      selection &&
      (selection.identity !== this.scope.identity() ||
        selection.environment !== environment ||
        selection.choice.evidence.context.scope.environmentId !== environment)
    ) {
      this.error.set(
        'The applied selection belongs to a previous scope. Choose it again.',
      );
      return;
    }
    if (selection) {
      try {
        requireAppliedInputMatch(selection.choice, inputs);
      } catch (error) {
        this.error.set(
          error instanceof Error ? error.message : 'Review the applied input.',
        );
        return;
      }
    }
    let signal = this.runLifetime.signal;
    if (context.kind === 'cloud') {
      try {
        const ref = this.scope.ref();
        if (!ref) return;
        signal = AbortSignal.any([
          signal,
          this.nativeRunLifetime.capture(
            ref,
            context.principal,
            { environment },
          ).signal,
        ]);
      } catch (error) {
        this.error.set(
          error instanceof Error
            ? error.message
            : 'Current scope is unavailable.',
        );
        return;
      }
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const action = {
        type: 'run-check' as const,
        checkId: check.id,
        caseId: this.caseId(),
        environment,
        inputs,
        ...(selection ? { evidence: selection.choice.evidence } : {}),
      };
      const intent =
        context.kind === 'cloud'
          ? await this.retainedIntent.prepare(
              JSON.stringify([identity, environment, check.version]),
              action,
            )
          : undefined;
      if (
        signal.aborted ||
        !this.isCurrentScope(identity) ||
        environment !== this.environment()
      )
        return;
      if (intent) this.retainedPending.set(true);
      const response = await firstValueFrom(
        this.client.action(context, action, undefined, {
          signal,
          ...(intent ? { operationId: intent.operationId } : {}),
        }),
      );
      if (
        signal.aborted ||
        !this.isCurrentScope(identity) ||
        environment !== this.environment()
      )
        return;
      if (!response.run)
        throw new Error('The project store did not return a run.');
      if (
        selection &&
        (response.run.actor !== context.principal ||
          response.run.checkId !== check.id ||
          response.run.environment !== environment)
      )
        throw new Error(
          'The actual retained Check run could not be verified. Retry the original operation.',
        );
      let admittedRun = response.run;
      if (selection && response.run.executionStatus === 'completed') {
        const projectRef = this.scope.ref();
        if (
          !projectRef ||
          !Number.isSafeInteger(response.run.definition?.version) ||
          response.run.definition.version < 1
        )
          throw new Error(
            'The returned Check definition version is unavailable. Retry its original receipt.',
          );
        const retained = await this.evidenceInjector
          .get(RetainedEvidenceApiService)
          .read(
            { projectRef, environment, actor: context.principal || '' },
            {
              kind: 'check-run',
              checkRun: {
                storeId: projectRef.storeId,
                projectId: projectRef.projectId,
                environment,
                checkId: response.run.checkId,
                checkVersion: response.run.definition.version,
                runId: response.run.id,
              },
            },
            signal,
          );
        if (!('run' in retained))
          throw new Error(
            'The retained Check receipt did not identify an actual Check run.',
          );
        const selected = selection.choice.evidence.context,
          binding = selected.bindings[0];
        if (
          retained.run.actor !== context.principal ||
          retained.manifest.incidentRef !==
            selection.choice.evidence.incidentRef ||
          retained.manifest.sessionId !== selected.sessionId ||
          retained.manifest.entryId !== binding?.entryId ||
          retained.manifest.revisionId !== binding?.revisionId ||
          retained.manifest.identityDomain !== selected.scope.identityDomain
        )
          throw new Error(
            'The retained Check manifest does not match the explicitly shared context.',
          );
        if (
          signal.aborted ||
          !this.isCurrentScope(identity) ||
          environment !== this.environment()
        )
          return;
        admittedRun = retained.run;
      }
      if (intent && response.run.executionStatus === 'completed') {
        this.retainedIntent.confirm();
        this.retainedPending.set(false);
        this.retainedReviewed.set(false);
      }
      await this.refresh();
      if (!this.isCurrentScope(identity)) return;
      this.selectedRun.set(admittedRun);
      const linkText = caseRunLinkMessage(
        this.caseId(),
        response.run.id,
        response.caseLinkStatus,
        response.run.executionStatus,
      );
      this.runLinkNotice.set(
        linkText ? { runId: response.run.id, text: linkText } : undefined,
      );
      this.notify(
        `Run ${response.run.id}: ${response.run.outcome}.${response.run.definition?.version !== check.version ? ` Actual admitted Check version ${response.run.definition?.version}; the displayed request used version ${check.version}. This is a different actual definition, not a requested-version confirmation.` : ''}${linkText ? ` ${linkText}` : ''}`,
        response.run.outcome,
      );
      this.focusRunResult();
    } catch (error) {
      this.retainedIntent.rejectConflict(error);
      if (this.retainedIntent.hasPending) this.retainedPending.set(true);
      if (
        error instanceof HttpErrorResponse &&
        [401, 403].includes(error.status)
      ) {
        this.selectedRun.set(undefined);
        this.evidenceSelection.set(undefined);
        this.state.set(undefined);
      }
      if (!this.isCurrentScope(identity)) return;
      this.error.set(
        detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
      );
    } finally {
      if (this.isCurrentScope(identity)) this.busy.set(false);
    }
  }
  protected viewRun(run: CheckRun): void {
    this.selectedRun.set(run);
    if (this.runLinkNotice()?.runId !== run.id)
      this.runLinkNotice.set(undefined);
  }

  protected async refresh(): Promise<void> {
    const context = this.scope.context();
    const identity = this.pageIdentity();
    if (context) {
      const state = await firstValueFrom(this.client.state(context));
      if (this.isCurrentScope(identity)) this.state.set(state);
    }
  }
}
