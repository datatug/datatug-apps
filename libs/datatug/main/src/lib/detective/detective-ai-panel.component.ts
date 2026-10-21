import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  Directive,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonTextarea,
} from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import {
  AiConfirmReceipt,
  AiDraft,
  AiProposal,
  AiProvenance,
} from './detective-ai.models';
import {
  DetectiveClientService,
  DetectiveRequestContext,
  detectiveErrorMessage,
} from './detective-client.service';
import {
  detectiveParameterName,
  displayInputValue,
  parseInputValue,
  parseScalar,
  validParameterBindings,
  validScenarioBindings,
  validValidatorBindings,
} from './detective-forms';
import {
  CheckInput,
  CheckBinding,
  CheckStep,
  DetectiveInputValue,
  DetectiveState,
  DetectiveValue,
  ScenarioStep,
  ValidatorDefinition,
} from './models';

type IonButtonHost = HTMLElement & {
  componentOnReady?: () => Promise<unknown>;
};

type InputEdit = {
  type: DetectiveValue['type'];
  cardinality: 'scalar' | 'set' | 'range';
  text: string;
  end: string;
};

function editFromValue(value: DetectiveInputValue): InputEdit {
  if (value.type === 'set')
    return {
      type: value.values[0]?.type || 'string',
      cardinality: 'set',
      text: displayInputValue(value),
      end: '',
    };
  if (value.type === 'range')
    return {
      type: value.start.type,
      cardinality: 'range',
      text: displayInputValue(value.start),
      end: displayInputValue(value.end),
    };
  return {
    type: value.type,
    cardinality: 'scalar',
    text: displayInputValue(value),
    end: '',
  };
}

@Directive({
  selector: 'ion-button[sneatNativeAriaExpanded]',
  standalone: true,
})
class NativeAriaExpandedDirective {
  readonly sneatNativeAriaExpanded = input(false);
  readonly sneatNativeAriaControls = input.required<string>();
  private readonly host =
    inject<ElementRef<IonButtonHost>>(ElementRef).nativeElement;

  constructor() {
    effect((onCleanup) => {
      const expanded = this.sneatNativeAriaExpanded();
      const controlsId = this.sneatNativeAriaControls();
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
      });
      const sync = async (): Promise<void> => {
        await this.host.componentOnReady?.();
        if (cancelled) return;
        const button = this.host.shadowRoot?.querySelector<HTMLButtonElement>(
          'button[part~="native"]',
        );
        if (!button) return;
        button.setAttribute('aria-expanded', String(expanded));
        button.setAttribute('aria-controls', controlsId);
        const content = this.host.ownerDocument.getElementById(controlsId);
        if (content && 'ariaControlsElements' in button)
          button.ariaControlsElements = [content];
      };
      void sync().catch(() => undefined);
    });
  }
}

@Component({
  selector: 'sneat-datatug-detective-ai-panel',
  standalone: true,
  imports: [
    CommonModule,
    IonBadge,
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonIcon,
    IonInput,
    IonItem,
    IonLabel,
    IonList,
    IonNote,
    IonSelect,
    IonSelectOption,
    IonTextarea,
    NativeAriaExpandedDirective,
  ],
  templateUrl: './detective-ai-panel.component.html',
  styleUrl: './detective-pages.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetectiveAiPanelComponent {
  private readonly client = inject(DetectiveClientService);
  protected readonly contentId =
    'detective-ai-proposals-' + crypto.randomUUID();
  readonly context = input<DetectiveRequestContext | undefined>();
  readonly identity = input<string | undefined>();
  readonly state = input<DetectiveState | undefined>();
  readonly caseId = input<string | undefined>();
  readonly confirmed = output<AiConfirmReceipt>();
  protected readonly open = signal(false);
  protected readonly text = signal('');
  protected readonly countName = signal('');
  protected readonly countValue = signal('');
  protected readonly expectedCounts = signal<Record<string, number>>({});
  protected readonly proposals = signal<AiProposal[]>([]);
  protected readonly cursor = signal<string | undefined>(undefined);
  protected readonly hasMore = signal(false);
  protected readonly matches = signal<
    { kind: string; id: string; title: string; revision: string }[]
  >([]);
  protected readonly assistantText = signal('');
  protected readonly selected = signal<AiProposal | undefined>(undefined);
  private readonly selectedScopeKey = signal('');
  protected readonly draft = signal<AiDraft | undefined>(undefined);
  protected readonly inputEdits = signal<Record<string, InputEdit>>({});
  protected readonly expectedTypeEdits = signal<
    Record<string, DetectiveValue['type']>
  >({});
  protected readonly expectedValueEdits = signal<
    Partial<Record<string, string>>
  >({});
  protected readonly expectedValueErrors = signal<
    Partial<Record<string, string>>
  >({});
  private readonly expectedTypeEdited = signal(false);
  protected readonly reviewCaseId = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly receipt = signal<
    { resourceId: string; operationId: string } | undefined
  >(undefined);
  protected readonly displayValue = displayInputValue;
  protected readonly countEntries = computed(() =>
    Object.entries(this.expectedCounts()),
  );
  protected readonly contextEntries = computed(() =>
    Object.entries(this.draft()?.context || {}),
  );
  protected readonly inputEntries = computed(() =>
    Object.entries(this.inputEdits()),
  );
  protected readonly selectedCase = computed(() =>
    this.state()?.cases.find((item) => item.id === this.reviewCaseId()),
  );
  protected readonly reviewable = computed(() => {
    const proposal = this.selected();
    const draft = this.draft();
    return (
      !!proposal &&
      !!draft &&
      this.selectedScopeKey() === this.scopeKey() &&
      !Object.keys(this.expectedValueErrors()).length &&
      draft.kind !== 'explain-failure'
    );
  });
  protected readonly confirmable = computed(() => {
    const proposal = this.selected();
    if (!proposal) return false;
    try {
      return (
        !!proposal?.parentProposalId &&
        this.selectedScopeKey() === this.scopeKey() &&
        proposal.draft.kind !== 'explain-failure' &&
        proposal.draft.kind !== 'extract-context' &&
        !this.expectedTypeEdited() &&
        !Object.keys(this.expectedValueErrors()).length &&
        JSON.stringify(this.materializedDraft()) ===
          JSON.stringify(proposal.draft)
      );
    } catch {
      return false;
    }
  });

  private readonly scopeKey = computed(
    () => this.identity() ?? JSON.stringify(this.context() || null),
  );
  private lastScopeKey = '';
  private scopeEpoch = 0;
  private readonly resetScope = effect(() => {
    const key = this.scopeKey();
    if (key === this.lastScopeKey) return;
    this.lastScopeKey = key;
    this.scopeEpoch++;
    this.text.set('');
    this.expectedCounts.set({});
    this.countName.set('');
    this.countValue.set('');
    this.proposals.set([]);
    this.cursor.set(undefined);
    this.hasMore.set(false);
    this.matches.set([]);
    this.assistantText.set('');
    this.selected.set(undefined);
    this.selectedScopeKey.set('');
    this.draft.set(undefined);
    this.inputEdits.set({});
    this.expectedTypeEdits.set({});
    this.expectedValueEdits.set({});
    this.expectedValueErrors.set({});
    this.expectedTypeEdited.set(false);
    this.reviewCaseId.set('');
    this.receipt.set(undefined);
    this.error.set('');
    this.message.set('');
    this.busy.set(false);
  });
  private currentRequest(key: string, epoch: number, edit: string): boolean {
    return (
      this.scopeKey() === key &&
      this.scopeEpoch === epoch &&
      this.editFingerprint() === edit
    );
  }
  private lastEditValue = '';
  private editRevision = 0;
  private readonly trackEditGeneration = effect(() => {
    this.editFingerprint();
  });
  private editFingerprint(): string {
    const value = JSON.stringify([
      this.selected()?.id,
      this.selected()?.digest,
      this.draft(),
      this.inputEdits(),
      this.expectedTypeEdits(),
      this.expectedValueEdits(),
      this.expectedValueErrors(),
      this.reviewCaseId(),
      this.selectedCase()?.version,
      this.text(),
      this.expectedCounts(),
    ]);
    if (value !== this.lastEditValue) {
      this.lastEditValue = value;
      this.editRevision++;
    }
    return `${this.editRevision}:${value}`;
  }
  private parsedInputs(): Record<string, DetectiveInputValue> {
    const values: Record<string, DetectiveInputValue> = {};
    for (const [name, edit] of Object.entries(this.inputEdits())) {
      if (!detectiveParameterName.test(name))
        throw new Error(`Invalid input name: ${name}`);
      values[name] = parseInputValue(
        edit.text,
        edit.type,
        edit.cardinality,
        edit.end,
      );
    }
    return values;
  }
  private materializedDraft(): AiDraft | undefined {
    const draft = this.draft();
    if (!draft) return undefined;
    const values = this.parsedInputs();
    if (draft.case)
      return {
        ...draft,
        case: {
          ...draft.case,
          context:
            Object.keys(values).length || draft.case.context
              ? values
              : undefined,
        },
      };
    if (draft.run) return { ...draft, run: { ...draft.run, inputs: values } };
    return draft;
  }

  private readonly load = effect((onCleanup) => {
    const context = this.context();
    const open = this.open();
    const key = this.scopeKey();
    if (!context || !open) return;
    const epoch = this.scopeEpoch;
    const edit = untracked(() => this.editFingerprint());
    const subscription = this.client.aiProposals(context).subscribe({
      next: (page) => {
        if (!this.currentRequest(key, epoch, edit)) return;
        this.proposals.set(page.proposals);
        this.cursor.set(page.nextCursor);
        this.hasMore.set(page.hasMore);
      },
      error: (error) => {
        if (this.currentRequest(key, epoch, edit))
          this.error.set(
            `AI proposals are unavailable: ${detectiveErrorMessage(error, context.kind === 'cloud')}`,
          );
      },
    });
    onCleanup(() => subscription.unsubscribe());
  });
  protected toggleOpen(): void {
    this.open.update((value) => !value);
  }

  protected addExpectedCount(): void {
    const name = this.countName().trim();
    const number = Number(this.countValue());
    if (
      !/^[a-z][a-z0-9_-]*$/u.test(name) ||
      !Number.isSafeInteger(number) ||
      number < 0
    ) {
      this.error.set('Use a count name and a non-negative whole number.');
      return;
    }
    this.expectedCounts.update((current) => ({ ...current, [name]: number }));
    this.countName.set('');
    this.countValue.set('');
    this.error.set('');
  }
  protected removeExpectedCount(name: string): void {
    this.expectedCounts.update((current) => {
      const copy = { ...current };
      delete copy[name];
      return copy;
    });
  }
  protected async generate(): Promise<void> {
    const context = this.context();
    const text = this.text().trim();
    if (!context || !text) {
      this.error.set('Enter source text before requesting AI proposals.');
      return;
    }
    const key = this.scopeKey();
    const epoch = this.scopeEpoch;
    const edit = this.editFingerprint();
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      const response = await firstValueFrom(
        this.client.aiGenerate(
          context,
          text,
          this.caseId(),
          this.expectedCounts(),
        ),
      );
      if (!this.currentRequest(key, epoch, edit)) return;
      this.matches.set(response.matches || []);
      this.assistantText.set(response.text || '');
      this.proposals.update((all) => [
        ...response.proposals,
        ...all.filter(
          (item) => !response.proposals.some((next) => next.id === item.id),
        ),
      ]);
      if (response.proposals.length) this.selectProposal(response.proposals[0]);
      this.message.set(
        `${response.proposals.length} private proposal${response.proposals.length === 1 ? '' : 's'} ready for review. No project change was made.`,
      );
    } catch (error) {
      if (this.currentRequest(key, epoch, edit))
        this.error.set(detectiveErrorMessage(error, context.kind === 'cloud'));
    } finally {
      if (this.scopeKey() === key && this.scopeEpoch === epoch)
        this.busy.set(false);
    }
  }
  protected async loadMore(): Promise<void> {
    const context = this.context();
    const after = this.cursor();
    if (!context || !after || !this.hasMore()) return;
    const key = this.scopeKey();
    const epoch = this.scopeEpoch;
    const edit = this.editFingerprint();
    this.busy.set(true);
    this.error.set('');
    try {
      const page = await firstValueFrom(
        this.client.aiProposals(context, after),
      );
      if (!this.currentRequest(key, epoch, edit)) return;
      this.proposals.update((all) => [
        ...all,
        ...page.proposals.filter(
          (item) => !all.some((existing) => existing.id === item.id),
        ),
      ]);
      this.cursor.set(page.nextCursor);
      this.hasMore.set(page.hasMore);
    } catch (error) {
      if (this.currentRequest(key, epoch, edit))
        this.error.set(detectiveErrorMessage(error, context.kind === 'cloud'));
    } finally {
      if (this.scopeKey() === key && this.scopeEpoch === epoch)
        this.busy.set(false);
    }
  }
  protected selectProposal(proposal: AiProposal): void {
    this.selectedScopeKey.set(this.scopeKey());
    this.selected.set(proposal);
    this.draft.set(structuredClone(proposal.draft));
    this.reviewCaseId.set(this.caseId() || proposal.draft.case?.caseId || '');
    const values =
      proposal.draft.kind === 'extract-context'
        ? Object.fromEntries(
            Object.entries(proposal.draft.context || {}).map(
              ([name, value]) => [name, value.value],
            ),
          )
        : proposal.draft.case?.context || proposal.draft.run?.inputs || {};
    this.inputEdits.set(
      Object.fromEntries(
        Object.entries(values).map(([name, value]) => [
          name,
          editFromValue(value),
        ]),
      ),
    );
    this.expectedTypeEdits.set({});
    this.expectedValueEdits.set({});
    this.expectedValueErrors.set({});
    this.expectedTypeEdited.set(false);
    this.receipt.set(undefined);
    this.error.set('');
    this.message.set('');
  }
  protected updateDraft(patch: Partial<AiDraft>): void {
    this.draft.update((current) =>
      current ? { ...current, ...patch } : current,
    );
  }
  protected updateQuery(patch: Partial<NonNullable<AiDraft['query']>>): void {
    const current = this.draft();
    if (current?.query)
      this.updateDraft({ query: { ...current.query, ...patch } });
  }
  protected updateCheck(patch: Partial<NonNullable<AiDraft['check']>>): void {
    const current = this.draft();
    if (current?.check)
      this.updateDraft({ check: { ...current.check, ...patch } });
  }
  protected updateValidator(
    patch: Partial<NonNullable<AiDraft['validator']>>,
  ): void {
    const current = this.draft();
    if (current?.validator)
      this.updateDraft({ validator: { ...current.validator, ...patch } });
  }
  protected updateValidatorDefinition(
    patch: Partial<NonNullable<AiDraft['validator']>['validator']>,
  ): void {
    const current = this.draft()?.validator;
    if (current)
      this.updateValidator({ validator: { ...current.validator, ...patch } });
  }
  protected updateScenario(
    patch: Partial<NonNullable<AiDraft['scenario']>>,
  ): void {
    const current = this.draft();
    if (current?.scenario)
      this.updateDraft({ scenario: { ...current.scenario, ...patch } });
  }
  protected updateCase(patch: Partial<NonNullable<AiDraft['case']>>): void {
    const current = this.draft();
    if (current?.case)
      this.updateDraft({ case: { ...current.case, ...patch } });
  }
  protected updateCaseFinding(
    index: number,
    patch: Partial<
      NonNullable<NonNullable<AiDraft['case']>['findings']>[number]
    >,
  ): void {
    const item = this.draft()?.case;
    if (item)
      this.updateCase({
        findings: (item.findings || []).map((finding, i) =>
          i === index ? { ...finding, ...patch } : finding,
        ),
      });
  }
  protected addCaseFinding(): void {
    const item = this.draft()?.case;
    if (item)
      this.updateCase({
        findings: [
          ...(item.findings || []),
          {
            id: `finding-${crypto.randomUUID()}`,
            text: '',
            status: 'hypothesis',
          },
        ],
      });
  }
  protected removeCaseFinding(index: number): void {
    const item = this.draft()?.case;
    if (item)
      this.updateCase({
        findings: (item.findings || []).filter((_, i) => i !== index),
      });
  }
  protected updateCaseFindingEvidence(index: number, text: string): void {
    this.updateCaseFinding(index, {
      evidenceRefs: text
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    });
  }
  protected updateRun(patch: Partial<NonNullable<AiDraft['run']>>): void {
    const current = this.draft();
    if (current?.run) this.updateDraft({ run: { ...current.run, ...patch } });
  }
  protected updateInput(name: string, patch: Partial<InputEdit>): void {
    this.inputEdits.update((all) => ({
      ...all,
      [name]: { ...all[name], ...patch },
    }));
  }
  protected addInputValue(): void {
    const name = `value_${Object.keys(this.inputEdits()).length + 1}`;
    this.inputEdits.update((all) => ({
      ...all,
      [name]: { type: 'string', cardinality: 'scalar', text: '', end: '' },
    }));
  }
  protected removeInputValue(name: string): void {
    this.inputEdits.update((all) => {
      const next = { ...all };
      delete next[name];
      return next;
    });
  }
  protected renameInputValue(name: string, nextName: string): void {
    if (this.draft()?.kind === 'extract-context') return;
    this.inputEdits.update((all) => {
      const next = { ...all };
      const item = next[name];
      delete next[name];
      next[nextName] = item;
      return next;
    });
  }
  protected inputDefinitions(): CheckInput[] {
    return (
      this.draft()?.check?.inputs ||
      this.draft()?.query?.inputs ||
      this.draft()?.scenario?.inputs ||
      []
    );
  }
  protected updateInputDefinition(
    index: number,
    patch: Partial<CheckInput>,
  ): void {
    const inputs = this.inputDefinitions().map((item, i) =>
      i === index ? { ...item, ...patch } : item,
    );
    if (this.draft()?.check) this.updateCheck({ inputs });
    else if (this.draft()?.query) this.updateQuery({ inputs });
    else if (this.draft()?.scenario) this.updateScenario({ inputs });
  }
  protected addInputDefinition(): void {
    const inputs = [
      ...this.inputDefinitions(),
      { name: '', type: 'string' as const, cardinality: 'scalar' as const },
    ];
    if (this.draft()?.check) this.updateCheck({ inputs });
    else if (this.draft()?.query) this.updateQuery({ inputs });
    else if (this.draft()?.scenario) this.updateScenario({ inputs });
  }
  protected removeInputDefinition(index: number): void {
    const inputs = this.inputDefinitions().filter((_, i) => i !== index);
    if (this.draft()?.check) this.updateCheck({ inputs });
    else if (this.draft()?.query) this.updateQuery({ inputs });
    else if (this.draft()?.scenario) this.updateScenario({ inputs });
  }
  protected updateCheckStep(index: number, patch: Partial<CheckStep>): void {
    const check = this.draft()?.check;
    if (check)
      this.updateCheck({
        steps: check.steps.map((step, i) =>
          i === index ? { ...step, ...patch } : step,
        ),
      });
  }
  protected addCheckStep(): void {
    const check = this.draft()?.check;
    if (check)
      this.updateCheck({ steps: [...check.steps, { id: '', kind: 'query' }] });
  }
  protected removeCheckStep(index: number): void {
    const check = this.draft()?.check;
    if (check)
      this.updateCheck({ steps: check.steps.filter((_, i) => i !== index) });
  }
  protected addCheckStepBinding(stepIndex: number): void {
    const step = this.draft()?.check?.steps[stepIndex];
    if (step)
      this.updateCheckStep(stepIndex, {
        bindings: [...(step.bindings || []), { input: '' }],
      });
  }
  protected updateCheckStepBinding(
    stepIndex: number,
    index: number,
    patch: Partial<CheckBinding>,
  ): void {
    const step = this.draft()?.check?.steps[stepIndex];
    if (step)
      this.updateCheckStep(stepIndex, {
        bindings: (step.bindings || []).map((binding, i) =>
          i === index ? { ...binding, ...patch } : binding,
        ),
      });
  }
  protected removeCheckStepBinding(stepIndex: number, index: number): void {
    const step = this.draft()?.check?.steps[stepIndex];
    if (step)
      this.updateCheckStep(stepIndex, {
        bindings: (step.bindings || []).filter((_, i) => i !== index),
      });
  }
  protected updateCheckStepValidator(
    stepIndex: number,
    validatorIndex: number,
    patch: Partial<NonNullable<CheckStep['validators']>[number]>,
  ): void {
    const step = this.draft()?.check?.steps[stepIndex];
    if (!step) return;
    this.updateCheckStep(stepIndex, {
      validators: (step.validators || []).map((item, index) =>
        index === validatorIndex ? { ...item, ...patch } : item,
      ),
    });
  }
  protected useCatalogValidator(
    stepIndex: number,
    validatorIndex: number,
    validatorId: string,
  ): void {
    this.updateCheckStepValidator(stepIndex, validatorIndex, {
      validatorId: validatorId || undefined,
      kind: validatorId ? '' : 'non-null',
    });
  }
  protected addCheckStepValidator(stepIndex: number): void {
    const step = this.draft()?.check?.steps[stepIndex];
    if (step)
      this.updateCheckStep(stepIndex, {
        validators: [
          ...(step.validators || []),
          { id: '', scope: 'row', kind: 'non-null', severity: 'error' },
        ],
      });
  }
  protected removeCheckStepValidator(stepIndex: number, index: number): void {
    const step = this.draft()?.check?.steps[stepIndex];
    if (step)
      this.updateCheckStep(stepIndex, {
        validators: (step.validators || []).filter((_, i) => i !== index),
      });
  }
  protected addValidatorBinding(
    validator: ValidatorDefinition,
    update: (patch: Partial<ValidatorDefinition>) => void,
  ): void {
    update({ bindings: [...(validator.bindings || []), { input: '' }] });
  }
  protected updateValidatorBinding(
    validator: ValidatorDefinition,
    index: number,
    patch: Partial<CheckBinding>,
    update: (patch: Partial<ValidatorDefinition>) => void,
  ): void {
    update({
      bindings: (validator.bindings || []).map((binding, i) =>
        i === index ? { ...binding, ...patch } : binding,
      ),
    });
  }
  protected removeValidatorBinding(
    validator: ValidatorDefinition,
    index: number,
    update: (patch: Partial<ValidatorDefinition>) => void,
  ): void {
    update({
      bindings: (validator.bindings || []).filter((_, i) => i !== index),
    });
  }
  protected setExpected(
    key: string,
    raw: string,
    type: DetectiveValue['type'],
    update: (patch: Partial<ValidatorDefinition>) => void,
  ): void {
    this.expectedValueEdits.update((all) => ({ ...all, [key]: raw }));
    try {
      const expected =
        raw.trim() || type === 'null' ? parseScalar(raw, type) : undefined;
      update({ expected });
      this.expectedValueErrors.update((all) => {
        const next = { ...all };
        delete next[key];
        return next;
      });
      this.error.set('');
    } catch (error) {
      const message = detectiveErrorMessage(
        error,
        this.context()?.kind === 'cloud',
      );
      this.expectedValueErrors.update((all) => ({ ...all, [key]: message }));
      this.error.set(message);
    }
  }
  protected setStepExpected(
    stepIndex: number,
    index: number,
    raw: string,
    type: DetectiveValue['type'],
  ): void {
    this.setExpected(`step-${stepIndex}-${index}`, raw, type, (patch) =>
      this.updateCheckStepValidator(stepIndex, index, patch),
    );
  }
  protected expectedType(
    key: string,
    current?: DetectiveValue['type'],
  ): DetectiveValue['type'] {
    return this.expectedTypeEdits()[key] || current || 'number';
  }
  protected setStepExpectedType(
    stepIndex: number,
    index: number,
    type: DetectiveValue['type'],
  ): void {
    this.expectedTypeEdits.update((all) => ({
      ...all,
      [`step-${stepIndex}-${index}`]: type,
    }));
    this.expectedTypeEdited.set(true);
    const expected =
      this.draft()?.check?.steps[stepIndex]?.validators?.[index]?.expected;
    if (
      expected ||
      this.expectedValueEdits()[`step-${stepIndex}-${index}`] !== undefined
    )
      this.setStepExpected(
        stepIndex,
        index,
        this.expectedValueEdits()[`step-${stepIndex}-${index}`] ??
          String(expected?.value ?? ''),
        type,
      );
  }
  protected setPublishedExpectedType(type: DetectiveValue['type']): void {
    this.expectedTypeEdits.update((all) => ({ ...all, published: type }));
    this.expectedTypeEdited.set(true);
    const expected = this.draft()?.validator?.validator.expected;
    if (expected || this.expectedValueEdits()['published'] !== undefined)
      this.setPublishedExpected(
        this.expectedValueEdits()['published'] ?? String(expected?.value ?? ''),
        type,
      );
  }
  protected setPublishedExpected(
    raw: string,
    type: DetectiveValue['type'],
  ): void {
    this.setExpected('published', raw, type, (patch) =>
      this.updateValidatorDefinition(patch),
    );
  }
  protected addStepValidatorBinding(stepIndex: number, index: number): void {
    const validator =
      this.draft()?.check?.steps[stepIndex]?.validators?.[index];
    if (validator)
      this.addValidatorBinding(validator, (patch) =>
        this.updateCheckStepValidator(stepIndex, index, patch),
      );
  }
  protected updateStepValidatorBinding(
    stepIndex: number,
    validatorIndex: number,
    index: number,
    patch: Partial<CheckBinding>,
  ): void {
    const validator =
      this.draft()?.check?.steps[stepIndex]?.validators?.[validatorIndex];
    if (validator)
      this.updateValidatorBinding(validator, index, patch, (next) =>
        this.updateCheckStepValidator(stepIndex, validatorIndex, next),
      );
  }
  protected removeStepValidatorBinding(
    stepIndex: number,
    validatorIndex: number,
    index: number,
  ): void {
    const validator =
      this.draft()?.check?.steps[stepIndex]?.validators?.[validatorIndex];
    if (validator)
      this.removeValidatorBinding(validator, index, (next) =>
        this.updateCheckStepValidator(stepIndex, validatorIndex, next),
      );
  }
  protected addPublishedBinding(): void {
    const validator = this.draft()?.validator?.validator;
    if (validator)
      this.addValidatorBinding(validator, (patch) =>
        this.updateValidatorDefinition(patch),
      );
  }
  protected updatePublishedBinding(
    index: number,
    patch: Partial<CheckBinding>,
  ): void {
    const validator = this.draft()?.validator?.validator;
    if (validator)
      this.updateValidatorBinding(validator, index, patch, (next) =>
        this.updateValidatorDefinition(next),
      );
  }
  protected removePublishedBinding(index: number): void {
    const validator = this.draft()?.validator?.validator;
    if (validator)
      this.removeValidatorBinding(validator, index, (next) =>
        this.updateValidatorDefinition(next),
      );
  }
  protected updateScenarioStep(
    index: number,
    patch: Partial<ScenarioStep>,
  ): void {
    const scenario = this.draft()?.scenario;
    if (scenario)
      this.updateScenario({
        steps: scenario.steps.map((step, i) =>
          i === index
            ? {
                ...step,
                ...patch,
                ...(patch.kind === 'check' ? { bindings: [] } : {}),
              }
            : step,
        ),
      });
  }
  protected addScenarioStep(): void {
    const scenario = this.draft()?.scenario;
    if (scenario)
      this.updateScenario({
        steps: [...scenario.steps, { id: '', kind: 'query', ref: '' }],
      });
  }
  protected removeScenarioStep(index: number): void {
    const scenario = this.draft()?.scenario;
    if (scenario)
      this.updateScenario({
        steps: scenario.steps.filter((_, i) => i !== index),
      });
  }
  protected sourceTrail(): AiProvenance[] {
    return this.draft()?.sources || [];
  }
  private validDraftParameterNames(draft: AiDraft): boolean {
    const inputs = [
      ...(draft.query?.inputs || []),
      ...(draft.check?.inputs || []),
      ...(draft.scenario?.inputs || []),
    ];
    return (
      inputs.every((input) => detectiveParameterName.test(input.name)) &&
      (draft.check?.steps || []).every(
        (step) =>
          validParameterBindings(step.bindings) &&
          validValidatorBindings(step.validators),
      ) &&
      (draft.scenario?.steps || []).every((step) =>
        validScenarioBindings(
          step.bindings,
          draft.scenario?.inputs || [],
          step.kind,
        ),
      ) &&
      validParameterBindings(draft.validator?.validator.bindings)
    );
  }
  protected async review(): Promise<void> {
    const context = this.context();
    const proposal = this.selected();
    const draft = this.draft();
    if (!context || !proposal || !draft || !this.reviewable()) return;
    if (!this.validDraftParameterNames(draft)) {
      this.error.set(
        'Input and binding names must start with a letter and use letters, digits, underscores or hyphens (up to 128 characters).',
      );
      return;
    }
    const key = this.scopeKey();
    const epoch = this.scopeEpoch;
    const edit = this.editFingerprint();
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      const values = this.parsedInputs();
      const request =
        draft.kind === 'extract-context'
          ? (() => {
              const target = this.selectedCase();
              if (!target)
                throw new Error(
                  'Choose an existing Case before applying extracted context.',
                );
              return {
                contextReview: {
                  proposalId: proposal.id,
                  digest: proposal.digest,
                  caseId: target.id,
                  expectedVersion: target.version,
                  context: values,
                },
              };
            })()
          : {
              review: {
                proposalId: proposal.id,
                digest: proposal.digest,
                draft: this.materializedDraft() || draft,
              },
            };
      const derived = await firstValueFrom(
        this.client.aiReview(context, request),
      );
      if (!this.currentRequest(key, epoch, edit)) return;
      this.proposals.update((all) => [
        derived,
        ...all.filter((item) => item.id !== derived.id),
      ]);
      this.selectProposal(derived);
      this.message.set(
        'Edited derivative saved privately. Review it again before Confirm.',
      );
    } catch (error) {
      if (this.currentRequest(key, epoch, edit))
        this.error.set(detectiveErrorMessage(error, context.kind === 'cloud'));
    } finally {
      if (this.scopeKey() === key && this.scopeEpoch === epoch)
        this.busy.set(false);
    }
  }
  protected async confirm(): Promise<void> {
    const context = this.context();
    const proposal = this.selected();
    if (!context || !proposal || !this.confirmable()) return;
    if (!this.validDraftParameterNames(proposal.draft)) {
      this.error.set(
        'Scenario query bindings must map valid Scenario inputs, and Check steps cannot have bindings.',
      );
      return;
    }
    const key = this.scopeKey();
    const epoch = this.scopeEpoch;
    const edit = this.editFingerprint();
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      const receipt = await firstValueFrom(
        this.client.aiConfirm(context, {
          id: proposal.id,
          digest: proposal.digest,
        }),
      );
      if (!this.currentRequest(key, epoch, edit)) return;
      this.receipt.set({
        resourceId: receipt.resourceId,
        operationId: receipt.operationId,
      });
      this.confirmed.emit(receipt);
      this.message.set(
        `Confirmed through the project service: ${receipt.resourceId}.`,
      );
    } catch (error) {
      if (this.currentRequest(key, epoch, edit))
        this.error.set(detectiveErrorMessage(error, context.kind === 'cloud'));
    } finally {
      if (this.scopeKey() === key && this.scopeEpoch === epoch)
        this.busy.set(false);
    }
  }
}
