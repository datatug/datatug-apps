import { CommonModule } from '@angular/common';
import { DEMO_PROJECT_REF } from '@datatug/project-address';
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
  IonBadge,
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
import { InvestigationContextService } from '@sneat/datatug-semantic';
import { projectPageHref } from '../nav/project-page-href';
import { agentBaseUrl } from '../services/repo/agent-url';
import {
  DetectiveClientService,
  DetectiveRequestContext,
  detectiveErrorMessage,
} from './detective-client.service';
import {
  detectiveSlug,
  compatibleCaseInput,
  displayInputValue,
  identifierProposals,
  parseInputValue,
} from './detective-forms';
import { useDetectivePageContext } from './detective-page-context';
import { DetectiveDemoStarterComponent } from './detective-demo-starter.component';
import {
  HostedIncidentView,
  HostedKnowledgeHandoff,
  HostedKnowledgeKind,
  HostedKnowledgeProposal,
  HostedKnowledgeTarget,
} from './hosted-linkage.models';
import {
  CaseEvent,
  CaseFinding,
  CheckInput,
  CheckRun,
  DetectiveCase,
  DetectiveInputValue,
  DetectiveState,
  DetectiveValue,
  EvidenceRef,
  InvestigationScenario,
  ScenarioStep,
} from './models';

interface ContextProposal {
  readonly key: string;
  readonly value: DetectiveInputValue;
  readonly evidence: string;
  readonly explanation: string;
}

const NEW_CASE = (): DetectiveCase => ({
  id: '',
  title: '',
  status: 'active',
  version: 0,
  context: {},
  incidentRefs: [],
  scenarioRefs: [],
  runRefs: [],
  evidence: [],
  findings: [],
  timeline: [],
});

@Component({
  selector: 'sneat-datatug-cases-page',
  templateUrl: './cases-page.component.html',
  styleUrl: './detective-pages.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IonBackButton,
    IonBadge,
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
    DetectiveDemoStarterComponent,
  ],
})
export class CasesPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly client = inject(DetectiveClientService);
  private readonly basket = inject(InvestigationContextService);
  protected readonly scope = useDetectivePageContext();
  protected readonly publicDemo = computed(
    () =>
      this.scope.ref()?.storeId === 'github.com' &&
      this.scope.ref()?.projectId === DEMO_PROJECT_REF.projectId,
  );
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  protected readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly caseId = computed(
    () => this.params().get('caseId') || undefined,
  );
  protected readonly state = signal<DetectiveState | undefined>(undefined);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly olderRunsBusy = signal(false);
  protected readonly olderEventsBusy = signal(false);
  protected readonly olderEvents = signal<CaseEvent[]>([]);
  protected readonly olderEventsBefore = signal<number | undefined>(undefined);
  protected readonly olderEventsHasMore = signal<boolean | undefined>(
    undefined,
  );
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly search = signal('');
  protected readonly draft = signal<DetectiveCase | undefined>(undefined);
  protected readonly scenarioDraft = signal<InvestigationScenario | undefined>(
    undefined,
  );
  protected readonly contextName = signal('');
  protected readonly contextType = signal<DetectiveValue['type']>('string');
  protected readonly contextCardinality = signal<'scalar' | 'set' | 'range'>(
    'scalar',
  );
  protected readonly contextText = signal('');
  protected readonly contextEnd = signal('');
  protected readonly pastedText = signal('');
  protected readonly proposals = signal<ContextProposal[]>([]);
  protected readonly noteText = signal('');
  protected readonly findingText = signal('');
  protected readonly findingStatus =
    signal<CaseFinding['status']>('hypothesis');
  protected readonly findingEvidence = signal('');
  protected readonly evidenceKind = signal<EvidenceRef['kind']>('external');
  protected readonly evidenceRef = signal('');
  protected readonly evidenceNote = signal('');
  protected readonly incidentRef = signal('');
  protected readonly incidentTitle = signal('');
  protected readonly incidentDescription = signal('');
  protected readonly hostedEnvironment = signal('');
  protected readonly linkedIncidents = signal<HostedIncidentView[]>([]);
  protected readonly incidentLoadError = signal('');
  protected readonly knowledgeProposals = signal<HostedKnowledgeProposal[]>([]);
  protected readonly knowledgeCursor = signal<string | undefined>(undefined);
  protected readonly knowledgeHasMore = signal(false);
  protected readonly knowledgeLoadError = signal('');
  protected readonly knowledgeBusy = signal(false);
  protected readonly knowledgeKind = signal<HostedKnowledgeKind>('invariant');
  protected readonly knowledgeTitle = signal('');
  protected readonly knowledgeStatement = signal('');
  protected readonly knowledgeEvidence = signal<string[]>([]);
  protected readonly knowledgeClaimStatus = signal<'hypothesis' | 'confirmed'>(
    'hypothesis',
  );
  protected readonly knowledgeFindings = signal<string[]>([]);
  protected readonly knowledgeReviewNote = signal('');
  protected readonly handoffProposalId = signal('');
  protected readonly handoffSystem =
    signal<HostedKnowledgeTarget['system']>('meaninggraph');
  protected readonly handoffRepository = signal('');
  protected readonly handoffResourceId = signal('');
  protected readonly handoffExpectedRevision = signal('');
  protected readonly exportedKnowledge = signal<
    HostedKnowledgeHandoff | undefined
  >(undefined);
  protected readonly exportedKnowledgeJson = computed(() =>
    this.exportedKnowledge()
      ? JSON.stringify(this.exportedKnowledge(), null, 2)
      : '',
  );
  protected readonly closureReason = signal('');

  protected readonly cases = computed(() => {
    const search = this.search().trim().toLowerCase();
    return (this.state()?.cases || []).filter(
      (item) =>
        !search ||
        `${item.id} ${item.title} ${item.status}`
          .toLowerCase()
          .includes(search),
    );
  });
  protected readonly scenarios = computed(() => this.state()?.scenarios || []);
  protected readonly current = computed(() =>
    this.state()?.cases.find((item) => item.id === this.caseId()),
  );
  protected readonly caseKnowledge = computed(() =>
    this.knowledgeProposals().filter(
      (proposal) => proposal.caseId === this.caseId(),
    ),
  );
  protected readonly selectedHostedEnvironment = computed(() => {
    const selected = this.hostedEnvironment();
    return this.state()?.environments?.includes(selected)
      ? selected
      : undefined;
  });
  protected readonly timelineEvents = computed(() => {
    const seen = new Set<string>();
    return [...this.olderEvents(), ...(this.current()?.timeline || [])].filter(
      (event) => {
        if (seen.has(event.id)) return false;
        seen.add(event.id);
        return true;
      },
    );
  });
  protected readonly hasOlderEvents = computed(
    () =>
      this.olderEventsHasMore() ?? (this.current()?.timelineOffset || 0) > 0,
  );
  private readonly resetOlderEvents = effect(() => {
    this.caseId();
    this.olderEvents.set([]);
    this.olderEventsBefore.set(undefined);
    this.olderEventsHasMore.set(undefined);
  });
  protected readonly caseRuns = computed(() =>
    (this.state()?.runs || []).filter(
      (run) =>
        run.caseId === this.caseId() ||
        this.current()?.runRefs?.includes(run.id),
    ),
  );
  protected readonly relevantChecks = computed(() => {
    const context = this.current()?.context || this.draft()?.context || {};
    return (this.state()?.checks || []).filter((check) =>
      check.inputs
        .filter((input) => input.required)
        .every((input) => compatibleCaseInput(input, context[input.name])),
    );
  });
  protected readonly relevantScenarios = computed(() => {
    const context = this.current()?.context || this.draft()?.context || {};
    return (this.state()?.scenarios || []).filter((scenario) =>
      scenario.inputs
        ?.filter((input) => input.required)
        .every((input) => compatibleCaseInput(input, context[input.name])),
    );
  });
  protected readonly contextEntries = computed(() =>
    Object.entries(this.draft()?.context || this.current()?.context || {}),
  );
  protected readonly displayValue = displayInputValue;
  protected readonly canImportBasket = computed(() => {
    const scope = this.basket.scope();
    const context = this.scope.context();
    return (
      !!scope &&
      context?.kind === 'agent' &&
      scope.agentUrl === agentBaseUrl(context.agentStoreId) &&
      scope.project === context.project &&
      scope.securityContextId === context.securityContextId &&
      scope.environment === this.scope.currentEnvironment()?.id
    );
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
        this.error.set(
          detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
        );
        this.loading.set(false);
      },
    });
    onCleanup(() => subscription.unsubscribe());
  });

  private readonly loadHostedLinks = effect((onCleanup) => {
    const context = this.scope.context();
    const caseId = this.caseId();
    this.linkedIncidents.set([]);
    this.incidentLoadError.set('');
    this.knowledgeProposals.set([]);
    this.knowledgeCursor.set(undefined);
    this.knowledgeHasMore.set(false);
    this.knowledgeLoadError.set('');
    this.exportedKnowledge.set(undefined);
    this.knowledgeEvidence.set([]);
    this.knowledgeFindings.set([]);
    this.handoffProposalId.set('');
    if (!context || !caseId) return;
    const incidents = this.client.linkedIncidents(context, caseId).subscribe({
      next: (page) => {
        if (page.caseId === caseId) this.linkedIncidents.set(page.incidents);
      },
      error: (error: unknown) =>
        this.incidentLoadError.set(
          detectiveErrorMessage(error, context.kind === 'cloud'),
        ),
    });
    const proposals = this.client.knowledgeProposals(context).subscribe({
      next: (page) => {
        this.knowledgeProposals.set(page.proposals);
        this.knowledgeCursor.set(page.nextCursor);
        this.knowledgeHasMore.set(page.hasMore);
      },
      error: (error: unknown) =>
        this.knowledgeLoadError.set(
          detectiveErrorMessage(error, context.kind === 'cloud'),
        ),
    });
    onCleanup(() => {
      incidents.unsubscribe();
      proposals.unsubscribe();
    });
  });

  protected casesUrl(): string {
    return projectPageHref(this.scope.ref(), 'detective');
  }
  protected caseUrl(id: string): string {
    return projectPageHref(this.scope.ref(), ['detective', id]);
  }
  protected checkUrl(id: string): string {
    return projectPageHref(this.scope.ref(), ['checks', id]);
  }
  protected validatorUrl(queryId: string, caseId: string) {
    const url = projectPageHref(this.scope.ref(), 'checks');
    return this.router.parseUrl(
      `${url}${url.includes('?') ? '&' : '?'}query=${encodeURIComponent(queryId)}&caseId=${encodeURIComponent(caseId)}`,
    );
  }
  protected queryUrl(id: string): string {
    const url = projectPageHref(this.scope.ref(), ['query', id]);
    return `${url}${url.includes('?') ? '&' : '?'}id=${encodeURIComponent(id)}`;
  }
  protected scenarioQueryUrl(
    queryId: string,
    caseId: string,
    applicationId: string,
    stepId: string,
  ) {
    const url = this.queryUrl(queryId);
    const environment =
      this.selectedHostedEnvironment() || this.scope.currentEnvironment()?.id;
    const envQuery = environment
      ? `&env=${encodeURIComponent(environment)}`
      : '';
    return this.router.parseUrl(
      `${url}&caseId=${encodeURIComponent(caseId)}&applicationId=${encodeURIComponent(applicationId)}&scenarioStepId=${encodeURIComponent(stepId)}${envQuery}`,
    );
  }
  protected incidentUrl(ref: string): string | undefined {
    const [store, id] = ref.split('/');
    const context = this.scope.context();
    const environment = this.scope.currentEnvironment()?.id;
    if (!store || !id || context?.kind !== 'agent' || !environment)
      return undefined;
    return this.router.serializeUrl(
      this.router.createUrlTree(['/incidents', store, id], {
        queryParams: {
          agent: context.agentStoreId,
          project: context.project,
          environment,
        },
      }),
    );
  }

  protected startNew(): void {
    const incident = this.queryParams().get('incident');
    this.incidentRef.set(
      incident && /^[^/]+\/[^/]+$/u.test(incident) ? incident : '',
    );
    this.draft.set({
      ...NEW_CASE(),
      incidentRefs:
        this.scope.context()?.kind === 'agent' &&
        incident &&
        /^[^/]+\/[^/]+$/u.test(incident)
          ? [incident]
          : [],
    });
    this.error.set('');
  }
  protected startScenario(): void {
    this.scenarioDraft.set({
      id: '',
      title: '',
      description: '',
      version: 0,
      inputs: [],
      steps: [],
    });
  }
  protected editScenario(item: InvestigationScenario): void {
    this.scenarioDraft.set(structuredClone(item));
  }
  protected updateScenario(patch: Partial<InvestigationScenario>): void {
    this.scenarioDraft.update((item) => (item ? { ...item, ...patch } : item));
  }
  protected addScenarioInput(): void {
    const item = this.scenarioDraft();
    if (item)
      this.updateScenario({
        inputs: [
          ...item.inputs,
          { name: '', type: 'string', cardinality: 'scalar' },
        ],
      });
  }
  protected updateScenarioInput(
    index: number,
    patch: Partial<CheckInput>,
  ): void {
    const item = this.scenarioDraft();
    if (item)
      this.updateScenario({
        inputs: item.inputs.map((input, i) =>
          i === index ? { ...input, ...patch } : input,
        ),
      });
  }
  protected removeScenarioInput(index: number): void {
    const item = this.scenarioDraft();
    if (item)
      this.updateScenario({
        inputs: item.inputs.filter((_, i) => i !== index),
      });
  }
  protected addScenarioStep(kind: ScenarioStep['kind']): void {
    const item = this.scenarioDraft();
    if (item)
      this.updateScenario({
        steps: [
          ...item.steps,
          { id: `step-${item.steps.length + 1}`, kind, ref: '' },
        ],
      });
  }
  protected updateScenarioStep(
    index: number,
    patch: Partial<ScenarioStep>,
  ): void {
    const item = this.scenarioDraft();
    if (item)
      this.updateScenario({
        steps: item.steps.map((step, i) =>
          i === index ? { ...step, ...patch } : step,
        ),
      });
  }
  protected removeScenarioStep(index: number): void {
    const item = this.scenarioDraft();
    if (item)
      this.updateScenario({ steps: item.steps.filter((_, i) => i !== index) });
  }
  protected async saveScenario(): Promise<void> {
    const context = this.scope.context();
    const item = this.scenarioDraft();
    if (!context || !item) return;
    if (
      !detectiveSlug.test(item.id) ||
      !item.title.trim() ||
      !item.steps.length ||
      item.steps.some((step) => !step.ref.trim())
    ) {
      this.error.set(
        'Scenario needs a slug ID, title, and at least one step with a reference.',
      );
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.client.action(context, { type: 'save-scenario', scenario: item }),
      );
      if (!response.scenario)
        throw new Error('The project store did not return the saved Scenario.');
      await this.refresh();
      this.scenarioDraft.set(undefined);
      this.message.set(`Saved Scenario ${response.scenario.id}.`);
    } catch (error) {
      this.error.set(
        detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
      );
    } finally {
      this.busy.set(false);
    }
  }
  protected startEdit(): void {
    const item = this.current();
    if (item) this.draft.set(structuredClone(item));
  }
  protected cancelEdit(): void {
    this.draft.set(undefined);
    this.proposals.set([]);
    this.error.set('');
  }
  protected updateDraft(patch: Partial<DetectiveCase>): void {
    this.draft.update((item) => (item ? { ...item, ...patch } : item));
  }
  protected addContext(): void {
    const item = this.draft();
    const name = this.contextName().trim();
    if (!item) return;
    if (!/^[a-z][a-z0-9_]*$/u.test(name)) {
      this.error.set(
        'Context name must start with a letter and use lower-case letters, digits or underscores.',
      );
      return;
    }
    try {
      const value = parseInputValue(
        this.contextText(),
        this.contextType(),
        this.contextCardinality(),
        this.contextEnd(),
      );
      this.updateDraft({ context: { ...item.context, [name]: value } });
      this.contextName.set('');
      this.contextText.set('');
      this.contextEnd.set('');
      this.error.set('');
    } catch (error) {
      this.error.set(
        detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
      );
    }
  }
  protected removeContext(name: string): void {
    const item = this.draft();
    if (!item) return;
    const context = { ...item.context };
    delete context[name];
    this.updateDraft({ context });
  }

  /** Local pattern suggestions only: source text stays in this browser until confirmed. */
  protected proposeFromPaste(): void {
    const found = identifierProposals(this.pastedText());
    this.proposals.set(
      found.map((proposal) => ({
        ...proposal,
        explanation:
          'Local pattern match; verify every identifier before adding it.',
      })),
    );
    if (!found.length)
      this.message.set(
        'No identifier patterns found. Add context manually below.',
      );
  }
  protected proposeFromBasket(): void {
    if (!this.canImportBasket()) return;
    const proposals: ContextProposal[] = [];
    for (const item of this.basket.items()) {
      if (!item.enabled || (item.condition !== '==' && item.condition !== 'in'))
        continue;
      const key = item.field.toLowerCase().replace(/[^a-z0-9_]/gu, '_');
      if (!/^[a-z][a-z0-9_]*$/u.test(key)) continue;
      const value: DetectiveInputValue =
        item.condition === 'in'
          ? { type: 'set', values: [...item.values] }
          : item.value;
      proposals.push({
        key,
        value,
        evidence: `${item.entity}.${item.field} (${item.source})`,
        explanation: `${item.layer || 'canonical'} context basket value; review its meaning and scope before adding.`,
      });
    }
    this.proposals.set(proposals);
    if (!proposals.length)
      this.message.set(
        'No equality or set values in the current Investigation Context basket.',
      );
  }
  protected confirmProposal(index: number): void {
    const proposal = this.proposals()[index];
    const item = this.draft();
    if (!item || !proposal) return;
    this.updateDraft({
      context: { ...item.context, [proposal.key]: proposal.value },
    });
    this.proposals.update((all) => all.filter((_, i) => i !== index));
  }
  protected dismissProposal(index: number): void {
    this.proposals.update((all) => all.filter((_, i) => i !== index));
  }

  protected async save(): Promise<void> {
    const context = this.scope.context();
    const item = this.draft();
    if (!context || !item) return;
    if (!detectiveSlug.test(item.id) || !item.title.trim()) {
      this.error.set('Use a slug ID and title.');
      return;
    }
    const created = item.version === 0;
    const startIncident = created ? this.incidentRef().trim() : '';
    const hostedEnvironment = this.selectedHostedEnvironment();
    if (
      startIncident &&
      (!/^[^/]+\/[^/]+$/u.test(startIncident) || !hostedEnvironment)
    ) {
      this.error.set(
        'Choose a project environment and use incident-store/incident-id to start this Case.',
      );
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const response = startIncident
        ? await firstValueFrom(
            this.client.incidentAction(context, {
              type: 'start-case',
              incidentRef: startIncident,
              environment: hostedEnvironment || '',
              case: { ...item, incidentRefs: [] },
              ifMatch: 0,
            }),
          )
        : await firstValueFrom(
            this.client.action(
              context,
              { type: created ? 'create-case' : 'update-case', case: item },
              item.version,
            ),
          );
      if (!response.case)
        throw new Error('The project store did not return the saved Case.');
      await this.refresh();
      this.draft.set(undefined);
      await this.router.navigateByUrl(this.caseUrl(response.case.id), {
        replaceUrl: created,
      });
      this.message.set(`Saved Case ${response.case.id}.`);
    } catch (error) {
      this.error.set(
        detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
      );
    } finally {
      this.busy.set(false);
    }
  }

  private async updateCase(
    patch: Partial<DetectiveCase>,
    success: string,
  ): Promise<boolean> {
    const context = this.scope.context();
    const item = this.current();
    if (!context || !item) return false;
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.client.action(
          context,
          {
            type: 'update-case',
            case: { ...item, ...patch },
          },
          item.version,
        ),
      );
      if (!response.case)
        throw new Error('The project store did not return the updated Case.');
      await this.refresh();
      this.message.set(success);
      return true;
    } catch (error) {
      this.error.set(
        detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
      );
      return false;
    } finally {
      this.busy.set(false);
    }
  }
  protected closeCase(): Promise<boolean> {
    const reason = this.closureReason().trim();
    if (!reason) {
      this.error.set('A closure reason is required.');
      return Promise.resolve(false);
    }
    return this.updateCase(
      { status: 'closed', closureReason: reason },
      'Case closed.',
    );
  }
  protected reopenCase(): Promise<boolean> {
    return this.updateCase({ status: 'active' }, 'Case reopened.');
  }
  protected archiveCase(): Promise<boolean> {
    return this.updateCase({ status: 'archived' }, 'Case archived.');
  }
  protected async linkIncident(): Promise<boolean> {
    const item = this.current();
    const context = this.scope.context();
    const ref = this.incidentRef().trim();
    if (!item || !context) return false;
    if (!/^[^/]+\/[^/]+$/u.test(ref)) {
      this.error.set('Use incident-store/incident-id.');
      return false;
    }
    const environment = this.selectedHostedEnvironment();
    if (!environment) {
      this.error.set(
        'Choose a project environment before linking an Incident.',
      );
      return false;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.client.incidentAction(context, {
          type: 'link',
          caseId: item.id,
          incidentRef: ref,
          environment,
          ifMatch: item.version,
        }),
      );
      if (!response.case)
        throw new Error(
          'The Incident service did not return the updated Case.',
        );
      await this.refresh();
      await this.refreshHostedIncidents(context, item.id);
      this.incidentRef.set('');
      this.message.set('Incident linked.');
      return true;
    } catch (error) {
      this.error.set(detectiveErrorMessage(error, context.kind === 'cloud'));
      return false;
    } finally {
      this.busy.set(false);
    }
  }
  protected async createIncident(): Promise<void> {
    const context = this.scope.context();
    const item = this.current();
    const environment = this.selectedHostedEnvironment();
    const title = this.incidentTitle().trim();
    if (!context || !item) return;
    if (!environment || !title) {
      this.error.set(
        'Choose a project environment and give the Incident a title.',
      );
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.client.incidentAction(context, {
          type: 'create',
          caseId: item.id,
          title,
          description: this.incidentDescription().trim(),
          environment,
          ifMatch: item.version,
        }),
      );
      if (!response.case)
        throw new Error(
          'The Incident service did not return the updated Case.',
        );
      await this.refresh();
      await this.refreshHostedIncidents(context, item.id);
      this.incidentTitle.set('');
      this.incidentDescription.set('');
      this.message.set('Incident created and linked to this Case.');
    } catch (error) {
      this.error.set(detectiveErrorMessage(error, context.kind === 'cloud'));
    } finally {
      this.busy.set(false);
    }
  }
  private async refreshHostedIncidents(
    context: DetectiveRequestContext,
    caseId: string,
  ): Promise<void> {
    const page = await firstValueFrom(
      this.client.linkedIncidents(context, caseId),
    );
    if (page.caseId !== caseId)
      throw new Error('The Incident service returned a different Case.');
    this.linkedIncidents.set(page.incidents);
  }
  protected incidentView(ref: string): HostedIncidentView | undefined {
    return this.linkedIncidents().find(
      (incident) =>
        `${incident.ref.storeId}/${incident.ref.incidentId}` === ref,
    );
  }
  protected selectKnowledgeEvidence(id: string, checked: boolean): void {
    this.knowledgeEvidence.update((all) =>
      checked ? [...new Set([...all, id])] : all.filter((ref) => ref !== id),
    );
  }
  protected selectKnowledgeFinding(id: string, checked: boolean): void {
    this.knowledgeFindings.update((all) =>
      checked ? [...new Set([...all, id])] : all.filter((ref) => ref !== id),
    );
  }
  protected beginKnowledgeHandoff(proposal: HostedKnowledgeProposal): void {
    const previous = proposal.handoffs?.at(-1)?.target;
    this.handoffProposalId.set(proposal.id);
    this.handoffSystem.set(previous?.system ?? 'meaninggraph');
    this.handoffRepository.set(previous?.repository ?? '');
    this.handoffResourceId.set(previous?.resourceId ?? '');
    this.handoffExpectedRevision.set(previous?.expectedRevision ?? '');
  }
  protected async loadMoreKnowledge(): Promise<void> {
    const context = this.scope.context();
    const after = this.knowledgeCursor();
    if (!context || !after || !this.knowledgeHasMore()) return;
    this.knowledgeBusy.set(true);
    this.knowledgeLoadError.set('');
    try {
      const page = await firstValueFrom(
        this.client.knowledgeProposals(context, after),
      );
      const seen = new Set(
        this.knowledgeProposals().map((proposal) => proposal.id),
      );
      this.knowledgeProposals.update((all) => [
        ...all,
        ...page.proposals.filter((proposal) => !seen.has(proposal.id)),
      ]);
      this.knowledgeCursor.set(page.nextCursor);
      this.knowledgeHasMore.set(page.hasMore);
    } catch (error) {
      this.knowledgeLoadError.set(
        detectiveErrorMessage(error, context.kind === 'cloud'),
      );
    } finally {
      this.knowledgeBusy.set(false);
    }
  }
  protected async saveKnowledgeDraft(): Promise<void> {
    const context = this.scope.context();
    const item = this.current();
    const title = this.knowledgeTitle().trim();
    const statement = this.knowledgeStatement().trim();
    const evidenceRefs = this.knowledgeEvidence();
    const findingRefs = this.knowledgeFindings();
    const claimStatus = this.knowledgeClaimStatus();
    if (!context || !item) return;
    if (!title || !statement || !evidenceRefs.length) {
      this.error.set(
        'A knowledge draft needs a title, statement, and at least one Case evidence ID.',
      );
      return;
    }
    if (claimStatus === 'confirmed') {
      const confirmed = (item.findings || []).filter(
        (finding) =>
          finding.status === 'confirmed' && findingRefs.includes(finding.id),
      );
      const supported = new Set(
        confirmed.flatMap((finding) => finding.evidenceRefs || []),
      );
      if (
        !confirmed.length ||
        evidenceRefs.some((ref) => !supported.has(ref))
      ) {
        this.error.set(
          'Confirmed knowledge needs a confirmed Case finding supporting every selected evidence ID.',
        );
        return;
      }
    }
    this.knowledgeBusy.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.client.knowledgeAction(context, {
          type: 'save-draft',
          proposal: {
            id: `proposal-${crypto.randomUUID()}`,
            caseId: item.id,
            kind: this.knowledgeKind(),
            title,
            statement,
            evidenceRefs,
            findingRefs,
            claimStatus,
          },
          ifMatch: 0,
        }),
      );
      const savedProposal = response.proposal;
      if (!savedProposal)
        throw new Error(
          'The project store did not return the knowledge draft.',
        );
      this.knowledgeProposals.update((all) => [savedProposal, ...all]);
      this.knowledgeTitle.set('');
      this.knowledgeStatement.set('');
      this.knowledgeEvidence.set([]);
      this.knowledgeFindings.set([]);
      this.knowledgeClaimStatus.set('hypothesis');
      this.message.set('Private knowledge draft saved for review.');
    } catch (error) {
      this.error.set(detectiveErrorMessage(error, context.kind === 'cloud'));
    } finally {
      this.knowledgeBusy.set(false);
    }
  }
  protected async reviewKnowledge(
    proposal: HostedKnowledgeProposal,
    type: 'review' | 'reject',
  ): Promise<void> {
    const context = this.scope.context();
    if (!context) return;
    this.knowledgeBusy.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.client.knowledgeAction(context, {
          type,
          proposalId: proposal.id,
          ifMatch: proposal.version,
          reviewNote: this.knowledgeReviewNote().trim(),
        }),
      );
      const reviewedProposal = response.proposal;
      if (!reviewedProposal)
        throw new Error(
          'The project store did not return the reviewed proposal.',
        );
      this.knowledgeProposals.update((all) =>
        all.map((entry) =>
          entry.id === proposal.id ? reviewedProposal : entry,
        ),
      );
      this.knowledgeReviewNote.set('');
      this.message.set(
        `Knowledge proposal ${type === 'review' ? 'reviewed' : 'rejected'}.`,
      );
    } catch (error) {
      this.error.set(detectiveErrorMessage(error, context.kind === 'cloud'));
    } finally {
      this.knowledgeBusy.set(false);
    }
  }
  protected async prepareKnowledgeHandoff(): Promise<void> {
    const context = this.scope.context();
    const proposal = this.caseKnowledge().find(
      (item) => item.id === this.handoffProposalId(),
    );
    if (!context || !proposal || proposal.status !== 'reviewed') return;
    const target: HostedKnowledgeTarget = {
      system: this.handoffSystem(),
      repository: this.handoffRepository().trim(),
      resourceId: this.handoffResourceId().trim(),
      expectedRevision: this.handoffExpectedRevision().trim(),
    };
    if (
      !target.repository.includes('/') ||
      !target.resourceId ||
      !target.expectedRevision
    ) {
      this.error.set(
        'Enter a repository-qualified target, resource ID, and exact expected revision.',
      );
      return;
    }
    this.knowledgeBusy.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.client.knowledgeAction(context, {
          type: 'export',
          proposalId: proposal.id,
          ifMatch: proposal.version,
          target,
        }),
      );
      const updatedProposal = response.proposal;
      if (!response.export || !updatedProposal)
        throw new Error(
          'The project store did not return the private handoff receipt.',
        );
      this.knowledgeProposals.update((all) =>
        all.map((item) => (item.id === proposal.id ? updatedProposal : item)),
      );
      this.exportedKnowledge.set(response.export);
      this.handoffProposalId.set('');
      this.message.set(
        'Private target-bound handoff is ready for external review. No registry change was made.',
      );
    } catch (error) {
      this.error.set(detectiveErrorMessage(error, context.kind === 'cloud'));
    } finally {
      this.knowledgeBusy.set(false);
    }
  }
  protected attachScenario(scenario: InvestigationScenario): Promise<boolean> {
    const context = this.scope.context();
    const item = this.current();
    if (!context || !item) return Promise.resolve(false);
    this.busy.set(true);
    this.error.set('');
    return firstValueFrom(
      this.client.action(
        context,
        {
          type: 'apply-scenario',
          caseId: item.id,
          scenarioId: scenario.id,
        },
        item.version,
      ),
    )
      .then(async (response) => {
        if (!response.case)
          throw new Error('The project store did not return the Case.');
        await this.refresh();
        this.message.set(
          'Scenario applied. Run each step manually and record its result.',
        );
        return true;
      })
      .catch((error: unknown) => {
        this.error.set(detectiveErrorMessage(error, context.kind === 'cloud'));
        return false;
      })
      .finally(() => this.busy.set(false));
  }

  protected matchingRun(step: ScenarioStep): CheckRun | undefined {
    return this.caseRuns().find(
      (run) =>
        run.executionStatus === 'completed' &&
        (step.kind === 'check'
          ? run.kind === 'check' && run.checkId === step.ref
          : run.kind === 'query-validators' && run.queryId === step.ref),
    );
  }

  protected async recordScenarioStep(
    applicationId: string,
    step: ScenarioStep,
    status: 'completed' | 'skipped',
  ): Promise<void> {
    const context = this.scope.context();
    const item = this.current();
    if (!context || !item) return;
    const runId =
      status === 'completed' ? this.matchingRun(step)?.id : undefined;
    if (status === 'completed' && !runId) {
      this.error.set('Run this step in the Case before marking it complete.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.client.action(
          context,
          {
            type: 'record-scenario-step',
            caseId: item.id,
            applicationId,
            stepId: step.id,
            stepStatus: status,
            ...(runId ? { runId } : {}),
          },
          item.version,
        ),
      );
      if (!response.case)
        throw new Error('The project store did not return the Case.');
      await this.refresh();
      this.message.set(`Scenario step ${step.id} ${status}.`);
    } catch (error) {
      this.error.set(detectiveErrorMessage(error, context.kind === 'cloud'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async loadOlderEvents(): Promise<void> {
    const context = this.scope.context();
    const item = this.current();
    const before = this.olderEventsBefore() ?? item?.timelineOffset;
    if (!context || !item || !before || this.olderEventsBusy()) return;
    this.olderEventsBusy.set(true);
    this.error.set('');
    try {
      const page = await firstValueFrom(
        this.client.caseEvents(context, item.id, before),
      );
      if (page.caseId !== item.id)
        throw new Error('The project store returned events for another Case.');
      const seen = new Set(this.timelineEvents().map((event) => event.id));
      this.olderEvents.update((all) => [
        ...page.events.filter((event) => !seen.has(event.id)),
        ...all,
      ]);
      this.olderEventsBefore.set(page.nextBefore);
      this.olderEventsHasMore.set(page.hasMore);
    } catch (error) {
      this.error.set(detectiveErrorMessage(error, context.kind === 'cloud'));
    } finally {
      this.olderEventsBusy.set(false);
    }
  }
  protected addFinding(): Promise<void> {
    const item = this.current();
    const text = this.findingText().trim();
    if (!item || !text) return Promise.resolve();
    const evidenceRefs = this.findingEvidence()
      .split(',')
      .map((ref) => ref.trim())
      .filter(Boolean);
    if (
      this.findingStatus() === 'confirmed' &&
      (!evidenceRefs.length ||
        evidenceRefs.some(
          (ref) =>
            !item.evidence.some(
              (evidence) => evidence.id === ref || evidence.ref === ref,
            ) && !item.runRefs.includes(ref),
        ))
    ) {
      this.error.set(
        'A confirmed finding must link at least one existing evidence or run reference.',
      );
      return Promise.resolve();
    }
    const finding: CaseFinding = {
      id: `finding-${crypto.randomUUID()}`,
      text,
      status: this.findingStatus(),
      evidenceRefs,
    };
    return this.updateCase(
      { findings: [...(item.findings || []), finding] },
      'Finding saved.',
    ).then((saved) => {
      if (saved) this.findingText.set('');
    });
  }
  protected addEvidence(): Promise<void> {
    const item = this.current();
    const ref = this.evidenceRef().trim();
    if (!item || !ref) return Promise.resolve();
    const evidence: EvidenceRef = {
      id: `evidence-${crypto.randomUUID()}`,
      kind: this.evidenceKind(),
      ref,
      note: this.evidenceNote().trim(),
    };
    return this.updateCase(
      { evidence: [...(item.evidence || []), evidence] },
      'Evidence reference saved.',
    ).then((saved) => {
      if (saved) {
        this.evidenceRef.set('');
        this.evidenceNote.set('');
      }
    });
  }
  protected async addNote(): Promise<void> {
    const context = this.scope.context();
    const item = this.current();
    const message = this.noteText().trim();
    if (!context || !item || !message) return;
    const event: CaseEvent = {
      id: `note-${crypto.randomUUID()}`,
      type: 'note',
      message,
    };
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(
        this.client.action(
          context,
          {
            type: 'append-event',
            caseId: item.id,
            event,
          },
          item.version,
        ),
      );
      await this.refresh();
      this.noteText.set('');
      this.message.set('Note added to the timeline.');
    } catch (error) {
      this.error.set(
        detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
      );
    } finally {
      this.busy.set(false);
    }
  }
  protected runOf(id: string): CheckRun | undefined {
    return this.caseRuns().find((run) => run.id === id);
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
      this.error.set(
        detectiveErrorMessage(error, this.scope.context()?.kind === 'cloud'),
      );
    } finally {
      this.olderRunsBusy.set(false);
    }
  }

  private async refresh(): Promise<void> {
    const context = this.scope.context();
    if (context)
      this.state.set(await firstValueFrom(this.client.state(context)));
  }
}
