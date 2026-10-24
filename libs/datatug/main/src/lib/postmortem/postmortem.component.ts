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
import { RouterLink } from '@angular/router';
import { projectPageHref, withQuery } from '../nav/project-page-href';
import { FormsModule } from '@angular/forms';
import { DatePipe, JsonPipe, TitleCasePipe } from '@angular/common';
import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCheckbox,
  IonInput,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonTextarea,
} from '@ionic/angular';
import type { WorkDetail } from '../work/work.models';
import { workError } from '../work/work.models';
import { patchProposalDefinition } from './postmortem-proposal';
import { PostmortemApiService } from './postmortem-api.service';
import {
  emptyReport,
  type GenerationCandidate,
  type PostmortemAction,
  type PostmortemDetail,
  type ReportDraft,
  type ReportProposal,
  type ReportSection,
  type ReportRevision,
} from './postmortem.models';
@Component({
  selector: 'sneat-postmortem',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    JsonPipe,
    DatePipe,
    JsonPipe,
    TitleCasePipe,
    IonBadge,
    IonButton,
    IonCard,
    IonCardContent,
    IonCheckbox,
    IonInput,
    IonItem,
    IonItemDivider,
    IonLabel,
    IonSelect,
    IonSelectOption,
    IonTextarea,
  ],
  templateUrl: './postmortem.component.html',
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
    }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    ion-textarea {
      min-width: 0;
    }
    .muted {
      color: var(--ion-color-medium);
    }
    a {
      overflow-wrap: anywhere;
    }
  `,
})
export class PostmortemComponent {
  readonly work = input.required<WorkDetail>();
  readonly changed = output<WorkDetail>();
  private readonly api = inject(PostmortemApiService);
  private controller = new AbortController();
  readonly detail = signal<PostmortemDetail | undefined>(undefined);
  readonly draft = signal<ReportDraft>(emptyReport());
  readonly dirty = signal(false);
  readonly busy = signal(false);
  readonly loading = signal(true);
  readonly history = signal<ReportRevision[]>([]);
  readonly error = signal('');
  readonly notice = signal('');
  readonly candidate = signal<GenerationCandidate | undefined>(undefined);
  readonly generationRequest = signal<PostmortemAction | undefined>(undefined);
  readonly pending = signal<PostmortemAction | undefined>(undefined);
  readonly publicSections = signal<ReportSection[]>([]);
  readonly publicationAcknowledged = signal(false);
  readonly publicText = signal('');
  readonly recipients = signal('');
  readonly recipientsConfirmed = signal(false);
  readonly token = signal('');
  readonly shareUrl = signal('');
  readonly selectedPublication = signal('');
  readonly proposalKind = signal<'query' | 'check' | 'watch'>('check');
  readonly proposalTitle = signal('');
  readonly proposalDescription = signal('');
  readonly proposalNativeId = signal('');
  readonly proposalEnvironment = signal('');
  readonly proposalConnection = signal('');
  readonly proposalQueryText = signal('');
  readonly proposalQueryType = signal('SQL');
  readonly proposalQueryId = signal('');
  readonly proposalCheckId = signal('');
  readonly proposalInterval = signal(300);
  readonly proposalRationale = signal('');
  readonly proposalEvidence = signal<string[]>([]);
  readonly proposalDependencyIds = signal<string[]>([]);
  readonly reuseId = signal('');
  readonly reuseVersion = signal('');
  readonly reuseFolder = signal('');
  readonly reuseEnvironment = signal('');
  readonly proposalDefinition = signal('{}');
  readonly editingProposal = signal<ReportProposal | undefined>(undefined);
  readonly evidence = computed(() => this.detail()?.report.evidence ?? []);
  readonly canEdit = computed(() => this.work().capabilities.canEdit);
  readonly revision = computed(() => this.detail()?.report);
  readonly capability = computed(() => this.detail()?.capabilities);
  readonly sections = computed(() => this.draft().sections);
  readonly recommendations = computed(() => this.draft().recommendations);
  private identityKey = '';
  constructor() {
    effect((onCleanup) => {
      const item = this.work().item;
      const controller = new AbortController();
      this.controller.abort();
      this.controller = controller;
      const identity = JSON.stringify([item.spaceID, item.projectID, item.id]);
      if (identity !== this.identityKey) {
        this.identityKey = identity;
        this.token.set('');
        this.shareUrl.set('');
        this.dirty.set(false);
        this.pending.set(undefined);
        this.detail.set(undefined);
        this.draft.set(emptyReport());
        this.candidate.set(undefined);
        this.publicSections.set([]);
      }
      void this.load(item.id, controller.signal);
      onCleanup(() => controller.abort());
    });
  }
  async load(id = this.work().item.id, signal = this.controller.signal) {
    this.loading.set(true);
    this.error.set('');
    try {
      const value = await this.api.read(this.work().item, id, signal);
      signal.throwIfAborted();
      this.accept(value);
      this.history.set(await this.api.revisions(value.work.item, id, signal));
    } catch (e) {
      if (!signal.aborted) this.error.set(workError(e));
    } finally {
      if (!signal.aborted) this.loading.set(false);
    }
  }
  private accept(value: PostmortemDetail) {
    this.detail.set(value);
    if (!this.dirty()) {
      const incoming = structuredClone(value.report.draft ?? emptyReport());
      this.draft.set({
        ...incoming,
        recommendations: (incoming.recommendations ?? []).map((proposal) => ({
          ...proposal,
          evidenceIds: proposal.evidenceIds ?? [],
          dependencies: proposal.dependencies ?? [],
        })),
        sections: emptyReport().sections.map((section) => {
          const saved =
            incoming.sections?.find((item) => item.name === section.name) ??
            section;
          return { ...saved, evidenceIds: saved.evidenceIds ?? [] };
        }),
      });
    }
  }
  updateSection(
    index: number,
    field: 'text' | 'classification',
    value: string,
  ) {
    this.draft.update((d) => ({
      ...d,
      sections: d.sections.map((s, i) =>
        i === index ? { ...s, [field]: value } : s,
      ),
    }));
    this.dirty.set(true);
  }
  toggleCitation(index: number, id: string, checked: boolean) {
    this.draft.update((d) => ({
      ...d,
      sections: d.sections.map((s, i) =>
        i === index
          ? {
              ...s,
              evidenceIds: checked
                ? [...new Set([...s.evidenceIds, id])]
                : s.evidenceIds.filter((v) => v !== id),
            }
          : s,
      ),
    }));
    this.dirty.set(true);
  }
  async command(action: string, extra: Record<string, unknown> = {}) {
    if (this.busy() || this.pending()) return;
    const item = this.detail()?.work.item ?? this.work().item;
    this.pending.set({
      spaceID: item.spaceID,
      projectID: item.projectID,
      itemId: item.id,
      operationId: crypto.randomUUID(),
      expectedVersion: item.version,
      action,
      ...extra,
    });
    await this.retry();
  }
  async retry() {
    const request = this.pending();
    if (!request || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const value = await this.api.action(request, this.controller.signal);
      this.controller.signal.throwIfAborted();
      this.pending.set(undefined);
      if (['save', 'apply-generation'].includes(request.action)) {
        this.dirty.set(false);
        this.generationRequest.set(undefined);
      }
      this.accept(value);
      if (value.token) {
        this.token.set(value.token);
        this.shareUrl.set(
          `${location.origin}/postmortems/shared#token=${encodeURIComponent(value.token)}`,
        );
      }
      if (value.token)
        this.selectedPublication.set(String(request['publicationId'] ?? ''));
      this.notice.set(
        value.sendStatus ? `Email ${value.sendStatus}.` : 'Change saved.',
      );
      this.changed.emit(value.work);
    } catch (e) {
      if (!this.controller.signal.aborted) this.error.set(workError(e));
    } finally {
      this.busy.set(false);
    }
  }
  discardPending() {
    this.pending.set(undefined);
    this.notice.set(
      'Review the latest report before trying a changed operation.',
    );
    void this.load();
  }
  save() {
    return this.command('save', { draft: this.draft() });
  }
  async generate() {
    if (this.busy() || this.dirty() || this.pending()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const item = this.detail()?.work.item ?? this.work().item;
      const request = this.generationRequest() ?? {
        spaceID: item.spaceID,
        projectID: item.projectID,
        itemId: item.id,
        expectedVersion: item.version,
        operationId: crypto.randomUUID(),
        action: 'generate',
      };
      this.generationRequest.set(request);
      const response = await this.api.generate(request, this.controller.signal);
      this.generationRequest.set(undefined);
      this.candidate.set(response.candidate);
    } catch (e) {
      if (!this.controller.signal.aborted)
        this.error.set(e instanceof Error ? e.message : workError(e));
    } finally {
      this.busy.set(false);
    }
  }
  cancelGeneration() {
    this.controller.abort();
    this.controller = new AbortController();
    this.busy.set(false);
    this.notice.set('Generation cancelled. Saved content is unchanged.');
  }
  applyGeneration() {
    const candidate = this.candidate();
    if (candidate && !this.dirty())
      void this.command('apply-generation', { candidateId: candidate.id }).then(
        () => {
          if (!this.pending()) this.candidate.set(undefined);
        },
      );
  }
  preparePublication() {
    this.publicSections.set(
      this.sections()
        .filter((s) => s.text.trim())
        .map((s) => ({ ...s, evidenceIds: [] })),
    );
    this.publicationAcknowledged.set(false);
  }
  updatePublicSection(index: number, text: string) {
    this.publicSections.update((sections) =>
      sections.map((section, i) =>
        i === index ? { ...section, text } : section,
      ),
    );
    this.publicationAcknowledged.set(false);
  }
  omitPublicSection(index: number) {
    this.publicSections.update((sections) =>
      sections.filter((_, i) => i !== index),
    );
    this.publicationAcknowledged.set(false);
  }
  publish() {
    void this.command('publish', {
      publication: {
        sections: this.publicSections(),
        safeCitationLabels: [],
        proposalSummaries: [],
      },
      approvedDigest: this.revision()?.digest,
      previewAcknowledged: this.publicationAcknowledged(),
    });
  }
  createLink() {
    return this.command('create-link', {
      publicationId: this.selectedPublication(),
    });
  }
  sendEmail() {
    return this.command('send-email', {
      publicationId: this.selectedPublication(),
      token: this.token(),
      recipients: this.recipients()
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }
  editProposal(proposal?: ReportProposal) {
    this.editingProposal.set(proposal);
    this.proposalKind.set(proposal?.kind ?? 'check');
    this.proposalTitle.set(String(proposal?.dto['title'] ?? ''));
    this.proposalDescription.set(String(proposal?.dto['description'] ?? ''));
    const dto = proposal?.dto ?? {};
    const request = dto['request'] as Record<string, unknown> | undefined;
    const schedule = dto['schedule'] as Record<string, unknown> | undefined;
    const steps = dto['steps'] as { queryId?: string }[] | undefined;
    this.proposalNativeId.set(String(dto['id'] ?? ''));
    this.proposalEnvironment.set(String(dto['environment'] ?? ''));
    this.proposalConnection.set(String(dto['connectionId'] ?? ''));
    this.proposalQueryText.set(String(request?.['text'] ?? ''));
    this.proposalQueryType.set(String(request?.['queryType'] ?? 'SQL'));
    this.proposalQueryId.set(steps?.[0]?.queryId ?? '');
    this.proposalCheckId.set(String(dto['checkId'] ?? ''));
    this.proposalInterval.set(Number(schedule?.['intervalSeconds'] ?? 300));
    this.proposalRationale.set(proposal?.rationale ?? '');
    this.proposalEvidence.set(proposal?.evidenceIds ?? []);
    this.proposalDependencyIds.set(
      (proposal?.dependencies ?? []).map((dependency) =>
        String((dependency as { proposalId: string }).proposalId),
      ),
    );
    this.proposalDefinition.set(JSON.stringify(proposal?.dto ?? {}, null, 2));
  }
  saveProposal() {
    try {
      const dto = JSON.parse(this.proposalDefinition()) as Record<
        string,
        unknown
      >;
      if (!dto || typeof dto !== 'object' || Array.isArray(dto))
        throw new Error();
      const definition = patchProposalDefinition(dto, {
        kind: this.proposalKind(),
        id: this.proposalNativeId(),
        title: this.proposalTitle(),
        description: this.proposalDescription(),
        connection: this.proposalConnection(),
        queryType: this.proposalQueryType(),
        queryText: this.proposalQueryText(),
        queryId: this.proposalQueryId(),
        environment: this.proposalEnvironment(),
        checkId: this.proposalCheckId(),
        interval: this.proposalInterval(),
      });
      const previous = this.editingProposal();
      const proposal: ReportProposal = {
        id: previous?.id ?? crypto.randomUUID(),
        kind: this.proposalKind(),
        revision: (previous?.revision ?? 0) + 1,
        state: 'proposed',
        dto: definition,
        evidenceIds: this.proposalEvidence(),
        rationale: this.proposalRationale(),
        dependencies: this.proposalDependencyIds().map((id) => {
          const dependency = this.recommendations().find(
            (item) => item.id === id,
          );
          return {
            proposalId: id,
            revision: dependency?.revision,
            nativeId: String(dependency?.dto['id'] ?? id),
          };
        }),
      };
      if (previous)
        void this.command('adjust-proposal', {
          proposalId: proposal.id,
          proposal,
        });
      else {
        this.draft.update((d) => ({
          ...d,
          recommendations: [...d.recommendations, proposal],
        }));
        this.dirty.set(true);
      }
      this.editingProposal.set(undefined);
      this.proposalTitle.set('');
      this.proposalDefinition.set('{}');
    } catch {
      this.error.set('Enter a valid definition object.');
    }
  }
  decision(proposal: ReportProposal, decision: string) {
    return this.command('proposal-decision', {
      proposalId: proposal.id,
      decision,
    });
  }
  promote(proposal: ReportProposal) {
    return this.command('promote', {
      proposalId: proposal.id,
      proposalRevision: proposal.revision,
    });
  }
  reuse(proposal: ReportProposal) {
    const scope = this.work().item;
    return this.command('reuse', {
      proposalId: proposal.id,
      target: {
        kind: proposal.kind,
        id: this.reuseId(),
        storeId: 'firestore',
        projectId: scope.projectID,
        folder: this.reuseFolder(),
        ...(proposal.kind === 'watch'
          ? { environment: this.reuseEnvironment() }
          : {}),
      },
      targetVersion: this.reuseVersion(),
    });
  }
  artifactHref(proposal: ReportProposal) {
    const scope = this.work().item;
    const target = proposal.target;
    const ref = {
      storeId: 'firestore',
      spaceID: scope.spaceID,
      projectId: scope.projectID,
    };
    if (proposal.kind === 'query') {
      const id = [target?.folder, target?.id].filter(Boolean).join('/');
      return withQuery(
        projectPageHref(ref, ['query', id]),
        new URLSearchParams({
          id,
          ...(target?.environment ? { environment: target.environment } : {}),
        }).toString(),
      );
    }
    return withQuery(
      projectPageHref(ref, [
        proposal.kind === 'check' ? 'checks' : 'watch',
        target?.id ?? '',
      ]),
      target?.environment
        ? new URLSearchParams({ environment: target.environment }).toString()
        : '',
    );
  }
  toggleProposalEvidence(id: string, checked: boolean) {
    this.proposalEvidence.update((ids) =>
      checked
        ? [...new Set([...ids, id])]
        : ids.filter((value) => value !== id),
    );
  }
  toggleDependency(id: string, checked: boolean) {
    this.proposalDependencyIds.update((ids) =>
      checked
        ? [...new Set([...ids, id])]
        : ids.filter((value) => value !== id),
    );
  }
  citationLabel(id: string) {
    return (
      this.evidence().find((e) => e.id === id)?.summary ??
      'Evidence is unavailable.'
    );
  }
  label(section: ReportSection) {
    return section.name.replaceAll('-', ' ');
  }
}
