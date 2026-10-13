import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
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
import { displayInputValue, parseInputValue } from './detective-forms';
import {
  CheckInput,
  CheckStep,
  DetectiveInputValue,
  DetectiveState,
  DetectiveValue,
  ScenarioStep,
} from './models';

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

@Component({
  selector: 'sneat-datatug-detective-ai-panel',
  standalone: true,
  imports: [
    CommonModule,
    IonBadge,
    IonButton,
    IonCard,
    IonCardContent,
    IonInput,
    IonItem,
    IonLabel,
    IonList,
    IonNote,
    IonSelect,
    IonSelectOption,
    IonTextarea,
  ],
  templateUrl: './detective-ai-panel.component.html',
  styleUrl: './detective-pages.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetectiveAiPanelComponent {
  private readonly client = inject(DetectiveClientService);
  readonly context = input<DetectiveRequestContext | undefined>();
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
  protected readonly draft = signal<AiDraft | undefined>(undefined);
  protected readonly inputEdits = signal<Record<string, InputEdit>>({});
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
    return !!proposal && !!draft && draft.kind !== 'explain-failure';
  });
  protected readonly confirmable = computed(() => {
    const proposal = this.selected();
    return (
      !!proposal?.parentProposalId &&
      proposal.draft.kind !== 'explain-failure' &&
      proposal.draft.kind !== 'extract-context'
    );
  });

  private readonly load = effect((onCleanup) => {
    const context = this.context();
    const open = this.open();
    this.proposals.set([]);
    this.selected.set(undefined);
    this.draft.set(undefined);
    this.error.set('');
    if (!context || !open) return;
    const subscription = this.client.aiProposals(context).subscribe({
      next: (page) => {
        this.proposals.set(page.proposals);
        this.cursor.set(page.nextCursor);
        this.hasMore.set(page.hasMore);
      },
      error: (error) =>
        this.error.set(
          `AI proposals are unavailable: ${detectiveErrorMessage(error, context.kind === 'cloud')}`,
        ),
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
      this.error.set(detectiveErrorMessage(error, context.kind === 'cloud'));
    } finally {
      this.busy.set(false);
    }
  }
  protected async loadMore(): Promise<void> {
    const context = this.context();
    const after = this.cursor();
    if (!context || !after || !this.hasMore()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const page = await firstValueFrom(
        this.client.aiProposals(context, after),
      );
      this.proposals.update((all) => [
        ...all,
        ...page.proposals.filter(
          (item) => !all.some((existing) => existing.id === item.id),
        ),
      ]);
      this.cursor.set(page.nextCursor);
      this.hasMore.set(page.hasMore);
    } catch (error) {
      this.error.set(detectiveErrorMessage(error, context.kind === 'cloud'));
    } finally {
      this.busy.set(false);
    }
  }
  protected selectProposal(proposal: AiProposal): void {
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
  protected updateScenarioStep(
    index: number,
    patch: Partial<ScenarioStep>,
  ): void {
    const scenario = this.draft()?.scenario;
    if (scenario)
      this.updateScenario({
        steps: scenario.steps.map((step, i) =>
          i === index ? { ...step, ...patch } : step,
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
  protected async review(): Promise<void> {
    const context = this.context();
    const proposal = this.selected();
    const draft = this.draft();
    if (!context || !proposal || !draft || !this.reviewable()) return;
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      const values: Record<string, DetectiveInputValue> = {};
      for (const [name, edit] of Object.entries(this.inputEdits())) {
        if (!/^[a-z][a-z0-9_]*$/u.test(name))
          throw new Error(`Invalid input name: ${name}`);
        values[name] = parseInputValue(
          edit.text,
          edit.type,
          edit.cardinality,
          edit.end,
        );
      }
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
                draft: draft.case
                  ? { ...draft, case: { ...draft.case, context: values } }
                  : draft.run
                    ? { ...draft, run: { ...draft.run, inputs: values } }
                    : draft,
              },
            };
      const derived = await firstValueFrom(
        this.client.aiReview(context, request),
      );
      this.proposals.update((all) => [
        derived,
        ...all.filter((item) => item.id !== derived.id),
      ]);
      this.selectProposal(derived);
      this.message.set(
        'Edited derivative saved privately. Review it again before Confirm.',
      );
    } catch (error) {
      this.error.set(detectiveErrorMessage(error, context.kind === 'cloud'));
    } finally {
      this.busy.set(false);
    }
  }
  protected async confirm(): Promise<void> {
    const context = this.context();
    const proposal = this.selected();
    if (!context || !proposal || !this.confirmable()) return;
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
      this.receipt.set({
        resourceId: receipt.resourceId,
        operationId: receipt.operationId,
      });
      this.confirmed.emit(receipt);
      this.message.set(
        `Confirmed through the project service: ${receipt.resourceId}.`,
      );
    } catch (error) {
      this.error.set(detectiveErrorMessage(error, context.kind === 'cloud'));
    } finally {
      this.busy.set(false);
    }
  }
}
