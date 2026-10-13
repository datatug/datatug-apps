import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
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
import { firstValueFrom } from 'rxjs';
import { projectPageHref } from '../nav/project-page-href';
import { IEnvironmentFull } from '../models/definition/environments';
import { ProjectService } from '../services/project/project.service';
import {
  DetectiveClientService,
  detectiveErrorMessage,
} from './detective-client.service';
import {
  detectiveSlug,
  displayInputValue,
  parseInputValue,
  parseScalar,
} from './detective-forms';
import { useDetectivePageContext } from './detective-page-context';
import {
  CheckBinding,
  CheckDefinition,
  CheckInput,
  CheckRun,
  CheckStep,
  DetectiveInputValue,
  DetectiveState,
  PublishedValidator,
  QueryValidators,
  ValidatorDefinition,
} from './models';
import { ValidationRunResultsComponent } from './validation-run-results.component';

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
  ],
})
export class ChecksPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly client = inject(DetectiveClientService);
  private readonly projectService = inject(ProjectService);
  protected readonly scope = useDetectivePageContext();
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly state = signal<DetectiveState | undefined>(undefined);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
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
  protected readonly checkId = computed(
    () => this.params().get('checkId') || undefined,
  );
  protected readonly caseId = computed(
    () => this.queryParams().get('caseId') || undefined,
  );
  protected readonly queryId = computed(
    () => this.queryParams().get('query') || undefined,
  );
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
  protected readonly displayedQueryRun = computed(
    () => this.selectedRun() || this.queryHistory()[0],
  );
  protected readonly usedBy = computed(() =>
    (this.state()?.checks || []).filter((check) =>
      check.steps.some(
        (step) =>
          step.checkId === this.checkId() ||
          step.validators?.some(
            (validator) => validator.checkId === this.checkId(),
          ),
      ),
    ),
  );
  // ProjectSummary does not carry environments. Use the agent's project_full,
  // the same source as the existing Environments page.
  private readonly loadEnvironments = effect((onCleanup) => {
    const ref = this.scope.ref();
    this.availableEnvironments.set([]);
    this.environment.set('');
    this.environmentsError.set('');
    this.environmentsLoading.set(false);
    if (!ref || this.scope.unsupported()) return;
    this.environmentsLoading.set(true);
    const subscription = this.projectService.getFull(ref).subscribe({
      next: (project) => {
        this.availableEnvironments.set(project.environments || []);
        this.environmentsLoading.set(false);
      },
      error: () => {
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
    this.state.set(undefined);
    this.error.set('');
    if (!context) return;
    this.loading.set(true);
    const subscription = this.client.state(context).subscribe({
      next: (state) => {
        this.state.set(state);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(detectiveErrorMessage(error));
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

  protected checksUrl(): string {
    return projectPageHref(this.scope.ref(), 'checks');
  }
  protected checkUrl(id: string): string {
    return projectPageHref(this.scope.ref(), ['checks', id]);
  }
  protected caseUrl(): string {
    const caseId = this.caseId();
    return projectPageHref(
      this.scope.ref(),
      caseId ? ['detective', caseId] : 'detective',
    );
  }
  protected queryUrl(id: string): string {
    const url = projectPageHref(this.scope.ref(), ['query', id]);
    return `${url}${url.includes('?') ? '&' : '?'}id=${encodeURIComponent(id)}`;
  }
  protected editQueryValidators(): void {
    const queryId = this.queryId();
    if (!queryId) return;
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
      this.error.set(detectiveErrorMessage(error));
    }
  }
  protected async saveQueryValidators(): Promise<void> {
    const context = this.scope.context();
    const draft = this.queryValidatorDraft();
    if (!context || !draft) return;
    if (
      !draft.queryId ||
      draft.validators.some((validator) => !detectiveSlug.test(validator.id))
    ) {
      this.error.set('Each Validator needs a slug ID.');
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
      if (!response.queryValidators)
        throw new Error('The agent did not return the query Validators.');
      await this.refresh();
      this.queryValidatorDraft.set(undefined);
      this.message.set(`Saved local Validators for ${draft.queryId}.`);
    } catch (error) {
      this.error.set(detectiveErrorMessage(error));
    } finally {
      this.busy.set(false);
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
        if (!name || !row.value.trim() || inputs[name])
          throw new Error('Each query input needs a unique name and value.');
        inputs[name] = parseInputValue(
          row.value,
          row.type,
          row.cardinality,
          row.end,
        );
      }
    } catch (error) {
      this.error.set(detectiveErrorMessage(error));
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
      if (!response.run)
        throw new Error('The agent did not return a Validator run.');
      await this.refresh();
      this.selectedRun.set(response.run);
      this.message.set(
        `Validator run ${response.run.id}: ${response.run.outcome}.`,
      );
    } catch (error) {
      this.error.set(detectiveErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
  protected async loadOlderRuns(): Promise<void> {
    const context = this.scope.context();
    const state = this.state();
    if (!context || !state?.runsHasMore || !state.runsNextCursor) return;
    this.olderRunsBusy.set(true);
    this.error.set('');
    try {
      const older = await firstValueFrom(
        this.client.state(context, state.runsNextCursor),
      );
      const seen = new Set(state.runs.map((run) => run.id));
      this.state.set({
        ...older,
        runs: [...state.runs, ...older.runs.filter((run) => !seen.has(run.id))],
      });
    } catch (error) {
      this.error.set(detectiveErrorMessage(error));
    } finally {
      this.olderRunsBusy.set(false);
    }
  }

  protected startNew(): void {
    this.draft.set(NEW_CHECK());
    this.error.set('');
  }
  protected startEdit(): void {
    const check = this.current();
    if (check) this.draft.set(structuredClone(check));
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
      this.error.set(detectiveErrorMessage(error));
    }
  }

  protected async save(): Promise<void> {
    const context = this.scope.context();
    const draft = this.draft();
    if (!context || !draft) return;
    if (
      !detectiveSlug.test(draft.id) ||
      !draft.title.trim() ||
      !draft.steps.length
    ) {
      this.error.set('Use a slug ID, a title, and at least one step.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.client.action(context, { type: 'save-check', check: draft }),
      );
      if (!response.check)
        throw new Error('The agent did not return the saved Check.');
      await this.refresh();
      this.draft.set(undefined);
      await this.router.navigateByUrl(this.checkUrl(response.check.id), {
        replaceUrl: draft.version === 0,
      });
      this.message.set(
        `Saved Check ${response.check.id} · version ${response.check.version}.`,
      );
    } catch (error) {
      this.error.set(detectiveErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected beginPromote(validator: ValidatorDefinition): void {
    if (validator.validatorId) return;
    this.validatorDraft.set({
      id: '',
      title: '',
      version: 0,
      validator: structuredClone(validator),
    });
  }
  protected editPublished(validator: PublishedValidator): void {
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
      this.error.set(detectiveErrorMessage(error));
    }
  }
  protected async savePublished(): Promise<void> {
    const context = this.scope.context();
    const validator = this.validatorDraft();
    if (!context || !validator) return;
    if (!detectiveSlug.test(validator.id) || !validator.title.trim()) {
      this.error.set('Published Validator needs a slug ID and title.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.client.action(context, { type: 'save-validator', validator }),
      );
      if (!response.validator)
        throw new Error('The agent did not return the Validator.');
      await this.refresh();
      this.validatorDraft.set(undefined);
      this.message.set(`Published Validator ${response.validator.id}.`);
    } catch (error) {
      this.error.set(detectiveErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected setRunInput(
    name: string,
    key: 'value' | 'end',
    value: string,
  ): void {
    this.runInputText.update((all) => ({
      ...all,
      [name]: {
        value: all[name]?.value || '',
        end: all[name]?.end || '',
        [key]: value,
      },
    }));
  }
  protected useCaseContext(): void {
    const check = this.current();
    const investigation = this.caseContext();
    if (!check || !investigation) return;
    const next = { ...this.runInputText() };
    let added = 0;
    for (const input of check.inputs) {
      const value = investigation.context[input.name];
      if (!value) continue;
      if (input.cardinality === 'range') {
        if (value.type !== 'range' || value.start.type !== input.type) continue;
        next[input.name] = {
          value: displayInputValue(value.start),
          end: displayInputValue(value.end),
        };
      } else if (input.cardinality === 'set') {
        if (
          value.type !== 'set' ||
          value.values.some((member) => member.type !== input.type)
        )
          continue;
        next[input.name] = { value: displayInputValue(value), end: '' };
      } else {
        if (value.type !== input.type) continue;
        next[input.name] = { value: displayInputValue(value), end: '' };
      }
      added++;
    }
    this.runInputText.set(next);
    this.message.set(`${added} matching Case inputs copied for review.`);
  }
  protected async run(): Promise<void> {
    const context = this.scope.context();
    const check = this.current();
    if (!context || !check) return;
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
      this.error.set(detectiveErrorMessage(error));
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.client.action(context, {
          type: 'run-check',
          checkId: check.id,
          caseId: this.caseId(),
          environment,
          inputs,
        }),
      );
      if (!response.run) throw new Error('The agent did not return a run.');
      await this.refresh();
      this.selectedRun.set(response.run);
      this.message.set(`Run ${response.run.id}: ${response.run.outcome}.`);
    } catch (error) {
      this.error.set(detectiveErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
  protected viewRun(run: CheckRun): void {
    this.selectedRun.set(run);
  }

  private async refresh(): Promise<void> {
    const context = this.scope.context();
    if (context)
      this.state.set(await firstValueFrom(this.client.state(context)));
  }
}
