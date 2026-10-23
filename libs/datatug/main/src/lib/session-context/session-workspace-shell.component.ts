import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { AuthPanelComponent } from '@sneat/auth-ui';
import {
  IonAlert, IonButton, IonButtons, IonCheckbox, IonContent, IonFooter, IonHeader,
  IonPopover, IonInput, IonItem, IonLabel, IonModal, IonNote, IonSelect, IonSelectOption,
  IonSpinner, IonTabBar, IonTabButton, IonTabs, IonTextarea, IonTitle, IonToolbar,
} from '@ionic/angular';
import { filter, firstValueFrom } from 'rxjs';
import { decodeTypedValue, type TypedValue, type TypedValueKind } from '@sneat/datatug-semantic';
import { IProjectRef } from '../core/project-context';
import { projectPageHref } from '../nav/project-page-href';
import { ProjectTracker } from '../services/nav/contexts/project.tracker';
import { Subject } from 'rxjs';
import { ContextEntry, ContextRun, ContextSession, ContextSubject, ContextValue, SessionScope, contextOpaqueId, contextScopeKey, sameContextScope } from './session-context-contract';
import { LegacyContextImportService, LegacyImportPreview } from './legacy-context-import.service';
import { SessionWorkspaceService } from './session-workspace.service';
import { PublicDemoInvestigationPreviewComponent } from '../detective/public-demo-investigation-preview.component';
import { isCanonicalPublicDemo } from '../detective/public-scenario-catalog';

@Component({
  selector: 'sneat-datatug-session-workspace',
  templateUrl: './session-workspace-shell.component.html',
  styleUrl: './session-workspace-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AuthPanelComponent, IonTabs, IonTabBar, IonTabButton, IonItem, IonLabel,
    IonButton, IonButtons, IonSpinner, IonModal, IonHeader, IonToolbar, IonTitle,
    IonContent, IonFooter, IonPopover, IonInput, IonSelect, IonSelectOption, IonCheckbox,
    IonTextarea, IonNote, IonAlert, PublicDemoInvestigationPreviewComponent],
})
export class SessionWorkspaceShellComponent {
  readonly workspace = inject(SessionWorkspaceService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(SneatAuthStateService, { optional: true });
  private readonly legacyImporter = inject(LegacyContextImportService);
  private readonly trackerStop = new Subject<void>();
  private readonly tracker = new ProjectTracker(this.trackerStop, this.route);
  readonly tabs = viewChild(IonTabs);
  readonly chooserModal = viewChild<IonModal>('sessionChooser');
  readonly createModal = viewChild<IonModal>('sessionCreate');
  readonly chooserPresented = signal(false);
  readonly createPresented = signal(false);
  private async dismissModal(modal: IonModal | undefined, open: boolean, presented: () => boolean): Promise<void> {
    if (!modal || (!open && !presented())) return;
    // isOpen initiates presentation; it is not a completed overlay lifecycle.
    if (open && !presented()) await firstValueFrom(modal.didPresent);
    const dismissed = modal.onDidDismiss();
    await modal.dismiss();
    await dismissed;
  }
  readonly drawerOpen = signal(false);
  readonly mappedFieldPickerOpen = signal(false);
  readonly chooserOpen = signal(false);
  readonly createOpen = signal(false);
  readonly addBagOpen = signal(false);
  readonly clearOpen = signal(false);
  readonly deleteOpen = signal(false);
  readonly attachAllOpen = signal(false);
  readonly runHistoryOpen = signal(false);
  readonly runHistoryLoading = signal(false);
  readonly runHistoryError = signal('');
  readonly runHistory = signal<readonly ContextRun[]>([]);
  readonly runHistoryHasMore = signal(false);
  readonly outcomeUnknownTarget = signal<ContextRun | undefined>(undefined);
  readonly outcomeUnknownConfirmOpen = signal(false);
  readonly outcomeUnknownBusy = signal(false);
  readonly legacyImportOpen = signal(false);
  readonly legacyImportLoading = signal(false);
  readonly legacyImportIncludeContext = signal(false);
  readonly legacyImportSelectedConversations = signal<readonly string[]>([]);
  readonly legacyImportPreview = signal<LegacyImportPreview | undefined>(undefined);
  readonly legacyImportScope = signal('');
  readonly legacyImportError = signal('');
  readonly renameTarget = signal<'session' | 'bag' | undefined>(undefined);
  readonly sessionSearch = signal('');
  readonly sessionFilter = signal('all');
  readonly titleDraft = signal('');
  readonly scopeDraft = signal('');
  readonly subjectChoice = signal('');
  readonly conceptDraft = signal('');
  readonly fieldDraft = signal('');
  readonly mappingDraft = signal('');
  readonly aliasDraft = signal('');
  readonly valueType = signal<TypedValueKind>('string');
  readonly valueShape = signal<'scalar' | 'set'>('scalar');
  readonly valueDraft = signal('');
  readonly entryError = signal('');
  readonly entryEditing = signal<ContextEntry | undefined>(undefined);
  readonly formError = signal('');
  readonly focusTabId = signal('');
  private readonly project = signal<IProjectRef | undefined>(undefined);
  protected readonly projectResolved = signal(false);
  protected readonly publicDemo = computed(() => isCanonicalPublicDemo(this.project()));
  private routeGeneration = 0;
  private runHistorySessionId = '';
  private runHistoryCursor?: string;
  readonly visibleSessions = computed(() => this.workspace.sessions().filter((session) =>
    (this.sessionFilter() === 'all' || session.state === this.sessionFilter()) &&
    session.title.toLowerCase().includes(this.sessionSearch().toLowerCase())));
  onSessionSearchChange(query: string): void {
    this.sessionSearch.set(query);
    this.workspace.cancelSearchAll();
  }
  readonly canCreateSession = computed(() => {
    const capabilities = this.workspace.capabilities();
    return !!capabilities && capabilities.actions.includes('createSession') &&
      capabilities.environments.length > 0 && !this.workspace.busy();
  });
  onMappedFieldPickerOpen(): void { this.mappedFieldPickerOpen.set(true); }
  onMappedFieldPickerDismiss(): void { this.mappedFieldPickerOpen.set(false); }
  canDismissContextBag(): boolean { return !this.mappedFieldPickerOpen(); }
  readonly showInitialLoading = computed(() => this.workspace.loading() && !this.workspace.capabilities());
  readonly showInitialLoadError = computed(() => !!this.workspace.error() && !this.workspace.capabilities());
  readonly invoiceOverviewAvailable = computed(() => {
    const scope = this.workspace.selectedBag()?.scope;
    return !!scope && this.workspace.capabilities()?.subjects?.some(item => sameContextScope(item.scope, scope) && item.subject.conceptId === 'invoice' && item.subject.fieldId === 'InvoiceId' && item.type === 'integer' && item.shape === 'scalar') === true;
  });
  readonly availableSubjects = computed(() => {
    const scope = this.workspace.selectedBag()?.scope;
    return scope ? this.workspace.capabilities()?.subjects?.filter((item) => contextScopeKey(item.scope) === contextScopeKey(scope)) ?? [] : [];
  });
  readonly clearButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Confirm', role: 'confirm', handler: () => { void this.workspace.clearBag(); } },
  ];
  readonly deleteButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete session', role: 'destructive', handler: () => { void this.workspace.transition('delete'); } },
  ];
  readonly attachAllButtons = [{ text: 'Cancel', role: 'cancel' }, { text: 'Attach all', handler: () => this.workspace.attachAll() }];
  readonly outcomeUnknownButtons = [
    { text: 'Keep awaiting outcome', role: 'cancel' },
    { text: 'Mark outcome unknown', role: 'confirm', handler: () => { void this.confirmOutcomeUnknown(); } },
  ];
  readonly types: readonly TypedValueKind[] = ['string', 'integer', 'decimal', 'number', 'boolean', 'date', 'datetime', 'null'];

  constructor() {
    effect(() => { if (this.workspace.bagEditorRequests()) this.drawerOpen.set(true); });
    this.destroyRef.onDestroy(() => { this.trackerStop.next(); this.trackerStop.complete(); });
    this.auth?.authState.pipe(takeUntilDestroyed()).subscribe((state) => {
      this.workspace.setActor(state.status === 'authenticated' ? state.user?.uid ?? '' : '');
      const project = this.project();
      if (project) void this.openProject(project);
    });
    this.tracker.projectRef.pipe(takeUntilDestroyed()).subscribe((project) => { this.project.set(project); this.projectResolved.set(true); void this.openProject(project); });
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd), takeUntilDestroyed()).subscribe(() => { void this.focusRoute(); });
  }

  protected async retryAgentAdmission(): Promise<void> {
    const project = this.project();
    if (project && this.workspace.agentReconnectRequired()) await this.openProject(project);
  }
  private async openProject(project: IProjectRef): Promise<void> {
    if (isCanonicalPublicDemo(project)) return;
    await this.workspace.openProject(project);
    await this.focusRoute();
  }
  private async focusRoute(): Promise<void> {
    const generation = ++this.routeGeneration;
    let route = this.router.routerState.snapshot.root, id = '';
    while (route) {
      id = route.paramMap.get('sessionId') || id;
      const child = route.firstChild;
      if (!child) break;
      route = child;
    }
    const routeMatch = this.router.url.match(/(?:^|\/)sessions(?:\/([^/?#]+))?/);
    if (!id && routeMatch?.[1]) {
      try { id = decodeURIComponent(routeMatch[1]); } catch { this.formError.set('This session address is invalid.'); return; }
    }
    if (!id) {
      return;
    }
    if (!contextOpaqueId(id)) { this.formError.set('This session address is invalid.'); this.chooserOpen.set(false); return; }
    if (this.workspace.focusedSessionId() !== id || !this.workspace.snapshot()) await this.workspace.focus(id);
    if (generation === this.routeGeneration) {
      this.focusTabId.set(id);
      this.chooserOpen.set(false);
    }
  }

  sessionHref(id: string): string {
    const project = this.project();
    if (!project) return '';
    const tree = this.router.parseUrl(projectPageHref(project, ['sessions', id, 'overview']));
    tree.queryParams = { ...this.route.snapshot.queryParams };
    delete tree.queryParams['session'];
    return this.router.serializeUrl(tree);
  }
  signInReturnTo(): string { return this.router.url; }
  async selectSession(event: Event): Promise<void> {
    // Guard the draft, then delegate to Ionic's real router-stack selection API.
    event.stopPropagation();
    const detail = (event as CustomEvent<{ tab: string; href?: string }>).detail;
    if (!detail?.tab || !(await this.workspace.flushDraft())) return;
    await this.tabs()?.select(event as CustomEvent);
    this.chooserOpen.set(false);
  }
  async openSession(session: ContextSession): Promise<void> {
    if (!(await this.workspace.flushDraft())) return;
    await this.workspace.focus(session.id);
    if (!this.workspace.snapshot()) return;
    await this.router.navigateByUrl(this.sessionHref(session.id));
    this.chooserOpen.set(false);
  }
  async closeSession(id: string): Promise<void> {
    const next = await this.workspace.closeTab(id);
    if (next === undefined) return;
    if (next) await this.router.navigateByUrl(this.sessionHref(next));
    else {
      this.chooserOpen.set(true);
      const project = this.project();
      if (project) {
        const tree = this.router.parseUrl(projectPageHref(project, 'sessions'));
        tree.queryParams = { ...this.route.snapshot.queryParams };
        await this.router.navigateByUrl(tree);
      }
    }
  }
  async openWorkspacePage(page: 'overview' | 'invoice-overview' | 'invoice-explorer' | 'composer' | 'checks' | 'detective'): Promise<void> {
    const id = this.workspace.focusedSessionId();
    const project = this.project();
    if (page === 'invoice-overview' && !this.invoiceOverviewAvailable()) { this.formError.set('Invoice overview requires an admitted integer invoice input for the selected Bag scope.'); return; }
    if (!id || !project || !(await this.workspace.flushDraft())) return;
    const tree = this.router.parseUrl(projectPageHref(project, ['sessions', id, page]));
    tree.queryParams = { ...this.route.snapshot.queryParams };
    await this.router.navigateByUrl(tree);
  }
  async openRunHistory(): Promise<void> {
    const sessionId = this.workspace.focusedSessionId();
    if (!sessionId) return;
    this.runHistoryOpen.set(true);
    if (this.runHistorySessionId === sessionId && this.runHistory().length) return;
    this.runHistorySessionId = sessionId;
    this.runHistory.set([]);
    this.runHistoryCursor = undefined;
    this.runHistoryHasMore.set(false);
    await this.loadRunHistory();
  }
  async loadMoreRunHistory(): Promise<void> { await this.loadRunHistory(this.runHistoryCursor); }
  private async loadRunHistory(cursor?: string): Promise<void> {
    const sessionId = this.workspace.focusedSessionId();
    if (!sessionId || this.runHistoryLoading()) return;
    this.runHistoryLoading.set(true);
    this.runHistoryError.set('');
    try {
      const page = await this.workspace.history(sessionId, cursor);
      if (sessionId !== this.workspace.focusedSessionId()) return;
      this.runHistory.update((runs) => cursor ? [...runs, ...page.items.filter((run) => !runs.some((item) => item.id === run.id))] : page.items);
      this.runHistoryHasMore.set(page.hasMore);
      this.runHistoryCursor = page.nextCursor;
    } catch (error) {
      this.runHistoryError.set(error instanceof Error ? error.message : 'Run history could not be loaded.');
    } finally { this.runHistoryLoading.set(false); }
  }
  async prepareOutcomeUnknown(run: ContextRun): Promise<void> {
    const sessionId = this.workspace.focusedSessionId();
    if (!sessionId || run.executionAuthority !== 'client' || run.state !== 'accepted' || this.outcomeUnknownBusy()) return;
    this.outcomeUnknownBusy.set(true);
    this.runHistoryError.set('');
    try {
      const fresh = await this.workspace.inspectAcceptedClientRun(sessionId, run.id);
      if (!fresh) { await this.loadRunHistory(); this.runHistoryError.set('This run is no longer awaiting a client outcome. History has been refreshed.'); return; }
      this.outcomeUnknownTarget.set(fresh);
      this.outcomeUnknownConfirmOpen.set(true);
    } catch (error) {
      this.runHistoryError.set(error instanceof Error ? error.message : 'The latest run status could not be checked.');
    } finally { this.outcomeUnknownBusy.set(false); }
  }
  async confirmOutcomeUnknown(): Promise<void> {
    const target = this.outcomeUnknownTarget(), sessionId = this.workspace.focusedSessionId();
    if (!target || !sessionId || this.outcomeUnknownBusy()) return;
    this.outcomeUnknownBusy.set(true);
    try {
      if (await this.workspace.acknowledgeClientOutcomeUnknown(sessionId, target.id)) {
        this.outcomeUnknownConfirmOpen.set(false);
        this.outcomeUnknownTarget.set(undefined);
        this.runHistory.set([]);
        this.runHistoryCursor = undefined;
        await this.loadRunHistory();
      } else this.runHistoryError.set(this.workspace.error());
    } catch (error) {
      this.runHistoryError.set(error instanceof Error ? error.message : 'The run outcome could not be acknowledged.');
    } finally { this.outcomeUnknownBusy.set(false); }
  }
  tabKeydown(event: KeyboardEvent, id: string): void {
    const sessions = this.workspace.openSessions();
    const index = sessions.findIndex((session) => session.id === id);
    let target = index;
    if (event.key === 'ArrowLeft') target = (index - 1 + sessions.length) % sessions.length;
    else if (event.key === 'ArrowRight') target = (index + 1) % sessions.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = sessions.length - 1;
    else return;
    event.preventDefault();
    const next = sessions[target];
    if (next) { this.focusTabId.set(next.id); document.getElementById(`session-tab-${next.id}`)?.focus(); }
  }
  async beginCreate(bag = false): Promise<void> {
    if (!bag && !this.canCreateSession()) return;
    await this.dismissModal(this.chooserModal(), this.chooserOpen(), this.chooserPresented);
    if (!bag && !this.canCreateSession()) return;
    this.renameTarget.set(undefined);
    this.titleDraft.set(''); this.formError.set('');
    const firstEnvironment = this.workspace.capabilities()?.environments[0];
    this.scopeDraft.set(firstEnvironment ? contextScopeKey(firstEnvironment) : '');
    if (bag) this.addBagOpen.set(true); else this.createOpen.set(true);
  }
  beginLegacyImport(): void {
    this.legacyImportScope.set('');
    this.legacyImportPreview.set(undefined);
    this.legacyImportIncludeContext.set(false);
    this.legacyImportSelectedConversations.set([]);
    this.legacyImportError.set('');
    this.legacyImportOpen.set(true);
  }
  async loadLegacyImportPreview(): Promise<void> {
    const project = this.project(), capabilities = this.workspace.capabilities();
    const scope = capabilities?.environments.find((item) => contextScopeKey(item) === this.legacyImportScope());
    this.legacyImportPreview.set(undefined);
    this.legacyImportSelectedConversations.set([]);
    this.legacyImportIncludeContext.set(false);
    this.legacyImportError.set('');
    if (!project || !capabilities || !scope) return;
    this.legacyImportLoading.set(true);
    try { this.legacyImportPreview.set(await this.legacyImporter.preview(project, capabilities, scope)); }
    catch (error) { this.legacyImportError.set(error instanceof Error ? error.message : 'Legacy browser data could not be previewed.'); }
    finally { this.legacyImportLoading.set(false); }
  }
  toggleLegacyConversation(id: string, checked: boolean): void {
    this.legacyImportSelectedConversations.update((ids) => checked ? [...new Set([...ids, id])] : ids.filter((item) => item !== id));
  }
  canImportLegacy(): boolean {
    const preview = this.legacyImportPreview();
    if (!preview || !this.legacyImportScope()) return false;
    return (this.legacyImportIncludeContext() && preview.entries.some((entry) => entry.subject && entry.value && !entry.blockedReason)) ||
      preview.conversations.some((conversation) => this.legacyImportSelectedConversations().includes(conversation.id) && conversation.messages.length > 0);
  }
  readyContextCount(preview: LegacyImportPreview): number {
    return preview.entries.filter((entry) => entry.subject && entry.value && !entry.blockedReason).length;
  }
  async importLegacy(): Promise<void> {
    const project = this.project(), capabilities = this.workspace.capabilities(), preview = this.legacyImportPreview();
    const scope = capabilities?.environments.find((item) => contextScopeKey(item) === this.legacyImportScope());
    if (!project || !capabilities || !preview || !scope || !this.canImportLegacy()) return;
    this.legacyImportError.set('');
    try {
      const payload = await this.legacyImporter.createPayload(project, capabilities, scope, preview,
        this.legacyImportSelectedConversations(), this.legacyImportIncludeContext());
      const id = await this.workspace.importLegacy(payload);
      if (!id) { this.legacyImportError.set(this.workspace.error() || 'The import was not confirmed. Review the status before starting another import.'); return; }
      this.legacyImportOpen.set(false);
      await this.router.navigateByUrl(this.sessionHref(id), { replaceUrl: true });
    } catch (error) { this.legacyImportError.set(error instanceof Error ? error.message : 'The selected legacy data could not be imported.'); }
  }
  environmentLabel(scope: SessionScope): string {
    const environments = this.workspace.capabilities()?.environments ?? [];
    const primary = environments.find((item) => sameContextScope(item, scope))?.title?.trim() || scope.environmentId;
    const sameLabel = environments.filter((item) => (item.title?.trim() || item.environmentId) === primary);
    return sameLabel.length > 1 ? `${primary} · identity domain ${scope.identityDomain}` : primary;
  }
  beginRename(bag = false): void {
    this.titleDraft.set(bag ? this.workspace.selectedBag()?.title ?? '' : this.workspace.session()?.title ?? '');
    this.formError.set(''); this.renameTarget.set(bag ? 'bag' : 'session');
  }
  async saveCreate(bag = false): Promise<void> {
    if (this.renameTarget()) {
      if (!this.titleDraft().trim()) { this.formError.set('Enter a title.'); return; }
      await this.workspace.rename(this.titleDraft(), this.renameTarget() === 'bag');
      if (!this.workspace.error()) this.renameTarget.set(undefined);
      return;
    }
    if (!bag && !this.canCreateSession()) return;
    const scope = this.workspace.capabilities()?.environments.find((item) => contextScopeKey(item) === this.scopeDraft());
    if (!this.titleDraft().trim() || !scope) { this.formError.set('Enter a title and choose an admitted environment.'); return; }
    if (bag) {
      await this.workspace.createBag(this.titleDraft(), scope);
      if (!this.workspace.error()) this.addBagOpen.set(false);
    } else {
      const id = await this.workspace.create(this.titleDraft(), scope);
      if (id) {
        await this.dismissModal(this.createModal(), this.createOpen(), this.createPresented);
        await this.dismissModal(this.chooserModal(), this.chooserOpen(), this.chooserPresented);
        await this.workspace.focus(id);
        await this.router.navigateByUrl(this.sessionHref(id), { replaceUrl: true });
      }
    }
  }
  scopeKey = contextScopeKey;
  subjectChanged(id: string): void {
    this.subjectChoice.set(id);
    const choice = this.availableSubjects().find((item) => item.id === id);
    if (choice) { this.valueType.set(choice.type); this.valueShape.set(choice.shape); }
  }
  editEntry(entry: ContextEntry): void {
    this.entryEditing.set(entry); this.aliasDraft.set(entry.alias ?? '');
    this.conceptDraft.set(entry.subject.conceptId); this.fieldDraft.set(entry.subject.fieldId); this.mappingDraft.set(entry.subject.fieldMappingRef);
    const choice = this.availableSubjects().find((item) => JSON.stringify(item.subject) === JSON.stringify(entry.subject));
    this.subjectChoice.set(choice?.id ?? '');
    const value = this.workspace.revision({ entryId: entry.id, revisionId: entry.currentRevisionId })?.value;
    if (value?.kind === 'scalar' && value.scalar) { this.valueType.set(value.scalar.type); this.valueShape.set('scalar'); this.valueDraft.set(String(value.scalar.value ?? '')); }
    else if (value?.kind === 'set' && value.values) { this.valueType.set(value.values[0]?.type ?? 'string'); this.valueShape.set('set'); this.valueDraft.set(value.values.map((item) => String(item.value ?? '')).join('\n')); }
  }
  async saveEntry(): Promise<void> {
    this.entryError.set('');
    try {
      const chosen = this.availableSubjects().find((item) => item.id === this.subjectChoice());
      const subject: ContextSubject = chosen?.subject ?? this.entryEditing()?.subject ?? {
        conceptId: this.conceptDraft().trim(), fieldId: this.fieldDraft().trim(), fieldMappingRef: this.mappingDraft().trim(),
      };
      if (!subject.conceptId || !subject.fieldId || !subject.fieldMappingRef) throw new Error('Choose a mapped field or enter its explicit semantic and mapping IDs.');
      const values = this.valueShape() === 'set' ? (this.valueDraft() === '' ? [] : this.valueDraft().split(/\r?\n/)) : [this.valueDraft()];
      const typed = values.map((raw) => this.parseValue(raw));
      const value: ContextValue = this.valueShape() === 'scalar' ? { schemaVersion: 1, kind: 'scalar', scalar: typed[0] } : {
        schemaVersion: 1, kind: 'set', values: [...new Map(typed.map((item) => [JSON.stringify(item), item])).values()],
      };
      if (await this.workspace.putEntry(subject, value, this.aliasDraft(), this.entryEditing())) {
        this.valueDraft.set(''); this.aliasDraft.set(''); this.entryEditing.set(undefined);
      }
    } catch (error) { this.entryError.set(error instanceof Error ? error.message : 'Check the typed value.'); }
  }
  private parseValue(raw: string): TypedValue {
    const type = this.valueType();
    if (type === 'number' && !raw.trim()) throw new Error('Enter a number; empty text is not zero.');
    const value: unknown = type === 'null' ? null : type === 'number' ? Number(raw) : type === 'boolean' ? raw === 'true' ? true : raw === 'false' ? false : raw : raw;
    return decodeTypedValue({ type, value });
  }
}
