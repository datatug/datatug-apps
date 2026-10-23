import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { IonButton, IonButtons, IonCheckbox, IonContent, IonFooter, IonHeader, IonItem, IonLabel, IonTextarea, IonTitle, IonToolbar, IonSelect, IonSelectOption, IonModal, IonInput } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { AgGridReadyDirective } from '@datatug/ag-grid';
import { AgGridAngular } from 'ag-grid-angular';
import { ChatInterpretService } from '../chat/chat-interpret.service';
import { ChatProviderService, providerPresets } from '../chat/chat-provider.service';
import { ChatProvider } from '../chat/chat.types';
import { SessionChinookQueryService, SessionQueryRows } from './session-chinook-query.service';
import { sessionChatQuery } from './session-chat-query';
import { invoiceInput } from './invoice-dashboard';
import { SessionResultCacheService, tryWriteSessionResultCache } from './session-result-cache.service';
import { DatatugServicesStoreModule } from '../services/repo/datatug-services-store.module';
import { IProjectRef, isSharedProjectRef } from '../core/project-context';
import { readProjectApiQuery } from '../nav/project-api-routing';
import { ProjectAIEligibilityService } from '../services/project/project-ai-eligibility.service';
import { sessionResultFingerprint } from './session-result-fingerprint';

interface SessionReply { readonly inputId: string; readonly state: 'accepted' | 'completed' | 'failed' | 'dispatching'; readonly resultRef?: string; readonly result?: SessionQueryRows; readonly sql?: string; readonly error?: string; }
import { SessionWorkspaceService } from './session-workspace.service';
import { ContextMessage, contextScopeKey } from './session-context-contract';
import { ITextQueryRequest } from '../models/definition/query-def';

/** Durable input pin followed by the existing interpreter, validated compiler and admitted source runtime. */
@Component({
  selector: 'sneat-datatug-session-composer', changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [SessionChinookQueryService],
  imports: [DatatugServicesStoreModule, FormsModule, AgGridAngular, AgGridReadyDirective, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonFooter, IonItem, IonLabel, IonCheckbox, IonTextarea, IonSelect, IonSelectOption, IonModal, IonInput],
  template: `
    <ion-header><ion-toolbar><ion-title>Session composer</ion-title></ion-toolbar></ion-header>
    @if (workspace.snapshotFor(sessionId())) { <ion-content>
      <ion-item><ion-label><h2>Questions and pinned context</h2><p>Attach an invoice entry, then ask about Invoice or InvoiceLine. Send pins selected revisions before provider and source dispatch.</p></ion-label></ion-item>
      <ion-item><ion-select label="AI provider" [value]="providers.selectedId()" (ionChange)="providers.select($event.detail.value)">@for (provider of providers.providers(); track provider.id) { <ion-select-option [value]="provider.id">{{ provider.name }} · {{ provider.model }}</ion-select-option> }</ion-select><ion-button slot="end" (click)="providerOpen.set(true)">Configure</ion-button></ion-item>
      <ion-item><ion-label color="medium">The selected provider receives your question and the attached scalar invoice value. Result rows and provider credentials are not stored in session records.</ion-label></ion-item>
      @if (error()) { <ion-item color="danger" role="alert"><ion-label>{{ error() }}</ion-label></ion-item> }
      @for (message of visibleMessages(); track message.id) {
        <ion-item><ion-label><p>{{ message.role === 'assistant' ? 'Assistant · browser-observed outcome' : 'You' }}</p><h3>{{ message.text }}</h3><p>{{ message.createdAt }} · saved input {{ message.inputSnapshotId }}</p></ion-label></ion-item>
        @if (replyFor(message); as reply) {
          @if (reply.state === 'completed' && reply.result) {
            <ion-item><ion-label>{{ reply.result.rows.length }} rows · pinned input {{ reply.inputId }} · browser-observed result</ion-label></ion-item>
            <ag-grid-angular *datatugAgGridReady style="height:280px;width:100%" [rowData]="reply.result.rows" [columnDefs]="reply.result.columns" [defaultColDef]="{resizable:true,sortable:true,flex:1,minWidth:110}" />
          } @else { <ion-item [color]="reply.state === 'failed' ? 'danger' : 'warning'" role="status"><ion-label>{{ reply.error || (reply.state === 'accepted' ? 'The server accepted this run. This browser will not dispatch it; refresh saved history for its outcome.' : 'Dispatch was started. Reopening never repeats provider or source execution; check the saved run before retrying.') }}</ion-label></ion-item> }
        } @else if (message.role === 'assistant') { <ion-item><ion-label color="medium">Input/history is saved. Result rows are not cached on this device; reopening does not run the question again.</ion-label></ion-item> }
      } @empty { <ion-item><ion-label color="medium">No saved questions in this session.</ion-label></ion-item> }
      @if (hasMoreMessages()) { <ion-item><ion-label>More history is available; this is a partial timeline.</ion-label><ion-button slot="end" (click)="loadMoreMessages()">Load more history</ion-button></ion-item> }
    </ion-content>
    <ion-footer>
      @for (ref of draft()?.attachments; track ref.entryId) {
        <ion-item><ion-label><h3>{{ entryLabel(ref.entryId) }}</h3><p>{{ valueLabel(ref.entryId, ref.revisionId) }} · {{ ref.revisionId }}{{ changed(ref.entryId, ref.revisionId) ? ' · Update available; follows latest at Send' : '' }}</p></ion-label>
          <ion-checkbox [checked]="draft()?.pinnedAttachments?.includes(ref.entryId) || false" (ionChange)="workspace.pinAttachment(ref.entryId, $event.detail.checked)">Pin revision</ion-checkbox>
          <ion-button slot="end" fill="clear" (click)="workspace.detach(ref.entryId)">Remove</ion-button></ion-item>
      }
      <ion-item><ion-textarea label="Question" labelPlacement="stacked" [ngModel]="draft()?.composer || ''" (ngModelChange)="workspace.setComposer($event)" [autoGrow]="true" /></ion-item>
      <ion-toolbar><ion-label class="ion-padding-start">Attachments are independent of All session context.</ion-label><ion-buttons slot="end"><ion-button (click)="send()" [disabled]="busy() || !selectedProvider() || !workspace.canExecuteFor(sessionId()) || !draft()?.composer?.trim()">Send</ion-button></ion-buttons></ion-toolbar>
    </ion-footer>
    <ion-modal [isOpen]="providerOpen()" (didDismiss)="providerOpen.set(false)"><ng-template>
      <ion-header><ion-toolbar><ion-title>AI provider</ion-title><ion-buttons slot="end"><ion-button (click)="providerOpen.set(false)">Cancel</ion-button></ion-buttons></ion-toolbar></ion-header>
      <ion-content>
        <ion-item><ion-select label="Preset" (ionChange)="choosePreset($event.detail.value)">@for (name of presets; track name) { <ion-select-option [value]="name">{{ name }}</ion-select-option> }</ion-select></ion-item>
        <ion-item><ion-input label="Name" [ngModel]="providerDraft().name" (ngModelChange)="updateProvider('name',$event)" /></ion-item>
        <ion-item><ion-input label="Base URL" [ngModel]="providerDraft().baseUrl" (ngModelChange)="updateProvider('baseUrl',$event)" /></ion-item>
        <ion-item><ion-input label="Model" [ngModel]="providerDraft().model" (ngModelChange)="updateProvider('model',$event)" /></ion-item>
        <ion-item><ion-input label="API key" type="password" [ngModel]="providerDraft().apiKey" (ngModelChange)="updateProvider('apiKey',$event)" /></ion-item>
        <ion-item><ion-button (click)="saveProvider()">Save provider on this device</ion-button></ion-item>
      </ion-content>
    </ng-template></ion-modal> } @else { <ion-content><ion-item role="alert"><ion-label>Session access is unavailable. Saved questions and rows are hidden.</ion-label></ion-item></ion-content> }`,
})
export class SessionComposerComponent {
  readonly workspace = inject(SessionWorkspaceService);
  private readonly route = inject(ActivatedRoute);
  readonly providers = inject(ChatProviderService);
  private readonly interpreter = inject(ChatInterpretService);
  private readonly queries = inject(SessionChinookQueryService);
  private readonly cache = inject(SessionResultCacheService);
  private readonly eligibility = inject(ProjectAIEligibilityService);
  readonly selectedProvider = computed(() => this.providers.providers().find((provider) => provider.id === this.providers.selectedId()));
  readonly providerOpen = signal(false);
  readonly presets = Object.keys(providerPresets);
  readonly providerDraft = signal<Omit<ChatProvider, 'id'>>({ ...providerPresets['DeepSeek'], apiKey: '' });
  readonly sessionId = signal(this.route.snapshot.paramMap.get('sessionId') ?? '');
  readonly draft = computed(() => this.workspace.focusedSessionId() === this.sessionId() ? this.workspace.draft() : undefined);
  readonly messages = signal<readonly ContextMessage[]>([]);
  readonly visibleMessages = computed(() => [...this.messages()].sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || a.id.localeCompare(b.id)));
  readonly replies = signal<Readonly<Record<string, SessionReply>>>({});
  readonly hasMoreMessages = signal(false); private messageCursor?: string;
  readonly error = signal(''); readonly busy = signal(false);
  private restoreKey = '';
  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => this.sessionId.set(params.get('sessionId') ?? ''));
    effect(() => {
      const sessionId = this.sessionId(), snapshot = this.workspace.snapshotFor(sessionId);
      const key = `${sessionId}:${snapshot?.session.id ?? ''}`;
      if (key === this.restoreKey) return;
      this.restoreKey = key;
      this.messages.set([]); this.replies.set({}); this.hasMoreMessages.set(false); this.messageCursor = undefined;
      this.error.set(''); this.busy.set(false);
      if (snapshot && sessionId) void this.restore(sessionId);
    });
  }
  choosePreset(name: string): void { this.providerDraft.set({ ...this.providers.preset(name), apiKey: '' }); }
  updateProvider(field: 'name' | 'baseUrl' | 'model' | 'apiKey', value: string): void { this.providerDraft.update((draft) => ({ ...draft, [field]: value })); }
  saveProvider(): void { const provider = this.providers.save(this.providerDraft()); this.providers.select(provider.id); this.providerDraft.update((draft) => ({ ...draft, apiKey: '' })); this.providerOpen.set(false); }
  entryLabel(id: string): string { const entry = this.workspace.snapshotFor(this.sessionId())?.entries.find((entry) => entry.id === id); return entry ? this.workspace.entryLabel(entry) : 'Unavailable entry'; }
  valueLabel(id: string, revisionId: string): string {
    const value = this.workspace.snapshotFor(this.sessionId())?.revisions.find((revision) => revision.entryId === id && revision.id === revisionId)?.value;
    return value?.kind === 'scalar' ? String(value.scalar?.value ?? 'null') : `${value?.values?.length ?? 0} values`;
  }
  changed(id: string, revisionId: string): boolean { return this.workspace.snapshotFor(this.sessionId())?.entries.find((entry) => entry.id === id)?.currentRevisionId !== revisionId; }
  replyFor(message: ContextMessage): SessionReply | undefined { return message.role === 'assistant' ? Object.values(this.replies()).find((reply) => reply.inputId === message.inputSnapshotId) : undefined; }
  async send(): Promise<void> {
    const sessionId = this.sessionId();
    const draft = this.draft(), snapshot = this.workspace.snapshotFor(sessionId);
    if (!draft?.composer.trim() || !snapshot || this.busy() || !this.workspace.canExecuteFor(sessionId)) return;
    const bag = snapshot.bags.find((bag) => bag.id === draft.selectedBagId);
    const provider = this.selectedProvider();
    if (!bag || !provider) return;
    this.busy.set(true); this.error.set('');
    let runId: string | undefined, inputId = '', runVersion = 1;
    const cacheKey = this.workspace.deviceViewKey(sessionId, 'chat-replies');
    try {
      const project = this.project();
      if (isSharedProjectRef(project) || project.projectApi === 'cloud') {
        const eligibility = await firstValueFrom(this.eligibility.read(project));
        if (!eligibility.aiAllowed) throw new Error(eligibility.reason || 'AI access is unavailable for this project.');
      }
      for (const ref of draft.attachments) {
        const entry = snapshot.entries.find((entry) => entry.id === ref.entryId);
        const entryBag = snapshot.bags.find((candidate) => candidate.id === entry?.bagId);
        if (!entryBag || entryBag.scope.environmentId !== bag.scope.environmentId || entryBag.scope.identityDomain !== bag.scope.identityDomain)
          throw new Error('These attachments use different environments or identity domains. Send each scope separately.');
      }
      const admittedSubjects = this.workspace.capabilities()?.subjects?.filter((item) => contextScopeKey(item.scope) === contextScopeKey(bag.scope)).map((item) => item.subject) ?? [];
      const observedRevisions = draft.attachments.map((ref) => {
        const entry = snapshot.entries.find((item) => item.id === ref.entryId);
        if (!entry) throw new Error('An attached entry was removed. Remove it before sending this question.');
        const revisionId = draft.pinnedAttachments?.includes(ref.entryId) ? ref.revisionId : entry.currentRevisionId;
        const revision = snapshot.revisions.find((item) => item.id === revisionId && item.entryId === ref.entryId);
        if (!revision) throw new Error('The selected entry revision is unavailable. Review the attachment before sending.');
        return revision;
      });
      const observedInput = invoiceInput(observedRevisions, admittedSubjects);
      const saved = await this.workspace.pinInput(sessionId, bag.scope, 'chat', 'session-question', 'session-question-1', draft.composer.trim(),
        { InvoiceId: observedInput }, { schemaVersion: 1, kind: 'chat', queries: [] });
      if (!saved) throw new Error(this.workspace.error() || 'The server could not confirm this question.');
      runId = saved.runId; inputId = saved.input.id;
      if (saved.run.executionAuthority !== 'client') {
        if (this.sessionId() === sessionId) this.replies.update((replies) => ({ ...replies, [saved.runId]: { inputId, state: 'accepted' } }));
        if (this.sessionId() === sessionId) await this.cache.write(cacheKey, this.replies());
        if (this.sessionId() === sessionId && this.workspace.focusedSessionId() === sessionId) this.workspace.setComposer('');
        await this.loadMessages(sessionId);
        return;
      }
      const input = invoiceInput(saved.revisions, admittedSubjects);
      if (this.sessionId() === sessionId) this.replies.update((replies) => ({ ...replies, [saved.runId]: { inputId, state: 'dispatching' } }));
      if (this.sessionId() === sessionId) await this.cache.write(cacheKey, this.replies());
      // Sending from a hidden tab never clears the newly focused session's text.
      if (this.sessionId() === sessionId && this.workspace.focusedSessionId() === sessionId) this.workspace.setComposer('');
      await this.loadMessages(sessionId);
      if (!this.workspace.canExecuteFor(sessionId)) throw new Error('This session stopped before provider dispatch. The saved question was not rerun.');
      const interpretation = await this.interpreter.interpret(draft.composer.trim(), provider, '', {
        inputSnapshotId: inputId, entries: saved.revisions.map((revision) => ({ revisionId: revision.id, conceptId: revision.subject.conceptId, fieldId: revision.subject.fieldId,
          ...(revision.value.kind === 'scalar' ? { scalar: revision.value.scalar } : { count: revision.value.values?.length ?? 0 }) })),
      });
      if (!interpretation.tugql) throw new Error('This first session adapter supports an Invoice or InvoiceLine query. Workspace actions and JOIN proposals need a separate reviewed action.');
      const query = sessionChatQuery(interpretation.tugql, saved.revisions, admittedSubjects);
      if (!this.workspace.canExecuteFor(sessionId)) throw new Error('This session stopped before source dispatch. No new source query was started.');
      const recordedVersion = await this.workspace.recordRunExecution(sessionId, saved.runId, { schemaVersion: 1, kind: 'query', queries: [{ id: 'session-chat-query', queryType: 'SQL', text: (query.definition.request as ITextQueryRequest).text,
        connectionId: query.definition.connectionId, parameters: (query.definition.parameters ?? []).map(({ id, type, isRequired }) => ({ id, type, isRequired })) }] }, { InvoiceId: input });
      if (!recordedVersion) throw new Error(this.workspace.error() || 'The actual execution plan is unconfirmed. No source query was started.');
      runVersion = recordedVersion;
      const result = await this.queries.execute(project, bag.scope, query.definition, input);
      const resultRef = await sessionResultFingerprint(result);
      if (this.sessionId() === sessionId) this.replies.update((replies) => ({ ...replies, [saved.runId]: { inputId, state: 'completed', resultRef, result, sql: (query.definition.request as ITextQueryRequest).text } }));
      if (this.sessionId() === sessionId && !(await tryWriteSessionResultCache(this.cache, cacheKey, this.replies()))) this.error.set('The result is available in this tab, but its display cache could not be saved. The source will not be rerun.');
      const answer = `Executed TugQL: ${interpretation.tugql}`;
      if (!(await this.workspace.reportClientRun(sessionId, saved.runId, 'chat', [{ id: 'query', state: 'completed', resultRef }], runVersion, answer)) && this.sessionId() === sessionId) this.error.set('The result is displayed; its client outcome is unconfirmed. Check and recover the retained operation.');
      await this.loadMessages(sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The question could not be completed.';
      if (this.sessionId() === sessionId) this.error.set(message);
      const failedRunId = runId;
      if (failedRunId) {
        if (this.sessionId() === sessionId) this.replies.update((replies) => ({ ...replies, [failedRunId]: { inputId, state: 'failed', error: message } }));
        if (this.sessionId() === sessionId) await this.cache.write(cacheKey, this.replies()).catch(() => undefined);
        await this.workspace.reportClientRun(sessionId, failedRunId, 'chat', [{ id: 'query', state: 'failed', errorCode: 'CLIENT_QUERY_FAILED' }], runVersion);
      }
    }
    finally { if (runId) await this.loadMessages(sessionId); if (this.sessionId() === sessionId) this.busy.set(false); }
  }
  private async loadMessages(sessionId = this.sessionId()): Promise<void> {
    try { const page = await this.workspace.messages(sessionId); if (sessionId !== this.sessionId()) return; this.messages.set(page.items); this.hasMoreMessages.set(page.hasMore); this.messageCursor = page.nextCursor; }
    catch (error) { if (sessionId === this.sessionId()) this.error.set(error instanceof Error ? error.message : 'Saved questions are unavailable.'); }
  }
  async loadMoreMessages(): Promise<void> {
    const sessionId = this.sessionId();
    try { const page = await this.workspace.messages(sessionId, this.messageCursor); if (sessionId !== this.sessionId()) return; this.messages.update((messages) => [...messages, ...page.items.filter((message) => !messages.some((prior) => prior.id === message.id))]); this.hasMoreMessages.set(page.hasMore); this.messageCursor = page.nextCursor; }
    catch { if (sessionId === this.sessionId()) this.error.set('More saved questions could not be loaded.'); }
  }
  private project(): IProjectRef {
    const spaceId = this.route.snapshot.paramMap.get('spaceId');
    return { storeId: this.route.snapshot.paramMap.get('storeId') ?? '', projectId: this.route.snapshot.paramMap.get('projectId') ?? '',
      ...(spaceId ? { spaceID: spaceId } : {}), ...readProjectApiQuery(this.route.snapshot.queryParamMap) };
  }
  private async restore(sessionId: string): Promise<void> {
    await this.loadMessages(sessionId);
    if (sessionId !== this.sessionId() || this.error() || !this.workspace.snapshotFor(sessionId)) return;
    try {
      const cached = await this.cache.read<Readonly<Record<string, SessionReply>>>(this.workspace.deviceViewKey(sessionId, 'chat-replies'));
      if (sessionId !== this.sessionId()) return;
      if (!cached) return;
      const history = await this.workspace.history(sessionId);
      const confirmed: Record<string, SessionReply> = {};
      for (const [runId, reply] of Object.entries(cached)) {
        if (!this.messages().some((message) => message.inputSnapshotId === reply.inputId)) continue;
        const run = history.items.find((item) => item.id === runId && item.inputSnapshotId === reply.inputId);
        if (!run) continue;
        let isConfirmed = false;
        if (reply.state === 'completed') {
          const widget = run.widgets?.find((item) => item.id === 'query');
          isConfirmed = run.state === 'completed' && widget?.state === 'completed' && !!reply.result &&
            widget.resultRef === reply.resultRef && reply.resultRef === await sessionResultFingerprint(reply.result);
        } else if (reply.state === 'failed') {
          isConfirmed = run.state === 'failed' && run.widgets?.some((item) => item.id === 'query' && item.state === 'failed') === true;
        } else {
          isConfirmed = run.state !== 'completed' && run.state !== 'failed';
        }
        if (isConfirmed) confirmed[runId] = reply;
      }
      if (sessionId === this.sessionId()) this.replies.set(confirmed);
    } catch { if (sessionId === this.sessionId()) this.error.set('Questions and input pins are saved; this device could not restore its result display cache.'); }
  }
}
