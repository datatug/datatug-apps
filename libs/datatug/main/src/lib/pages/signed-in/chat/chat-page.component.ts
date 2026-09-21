import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ModuleRegistry, type CellClickedEvent, type ColDef, type SelectionChangedEvent } from 'ag-grid-community';
import {
  IonAlert, IonButton, IonButtons, IonCard, IonCardContent, IonCol, IonContent, IonFooter, IonGrid, IonHeader,
  IonIcon, IonInput, IonItem, IonLabel, IonMenuButton, IonModal,
  IonRow, IonSelect, IonSelectOption, IonSegment, IonSegmentButton, IonSpinner, IonText, IonTextarea, IonTitle, IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { sendOutline } from 'ionicons/icons';
import { ChatInterpretService } from '../../../chat/chat-interpret.service';
import { ChinookChatDataService } from '../../../chat/chinook-chat-data.service';
import { ChatProviderService, providerPresets } from '../../../chat/chat-provider.service';
import { ChatProvider, ChatTurn, CHINOOK_SCHEMA } from '../../../chat/chat.types';
import { ChatSession, ChatSessionService } from '../../../chat/chat-session.service';
import {
  chatBookmarkRows, ChatBookmark, ChatContextReference, ChatDock, ChatWorkspaceAction, emptyChatWorkspace,
} from '../../../chat/chat-workspace';
import { chatDtqlYaml, chatSQLite } from '../../../chat/chat-query-format';
import { SneatDatatugPageTitleComponent } from '../../../components/page-title/sneat-datatug-page-title.component';

ModuleRegistry.registerModules([AllCommunityModule]);
addIcons({ sendOutline });

@Component({
  selector: 'sneat-datatug-chat-page',
  templateUrl: './chat-page.component.html',
  styleUrls: ['./chat-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, DecimalPipe, AgGridAngular, IonHeader, IonToolbar, IonButtons, IonMenuButton,
    IonTitle, IonContent, IonCard, IonCardContent, IonFooter, IonModal, IonGrid, IonRow, IonCol,
    IonSelect, IonSelectOption, IonIcon, IonInput, IonButton, IonItem, IonLabel, IonText,
    IonSpinner, IonSegment, IonSegmentButton, IonTextarea, IonAlert, SneatDatatugPageTitleComponent,
  ],
})
export class ChatPageComponent {
  private cellAnchor?: { recordSetId: string; sourceRow: number; column: string };
  private readonly gridRowCache = new WeakMap<readonly Record<string, unknown>[], Record<string, unknown>[]>();
  private readonly gridColumnCache = new WeakMap<readonly Record<string, unknown>[], Map<string, ColDef[]>>();
  private readonly dockRowCache = new Map<string, {
    state: ReturnType<typeof emptyChatWorkspace>; turns: readonly ChatTurn[]; rows: Record<string, unknown>[];
  }>();
  private readonly route = inject(ActivatedRoute);
  private readonly interpreter = inject(ChatInterpretService);
  private readonly data = inject(ChinookChatDataService);
  private readonly sessionStore = inject(ChatSessionService);
  readonly providers = inject(ChatProviderService);

  readonly storeId = signal(this.route.snapshot.paramMap.get('storeId') || this.route.parent?.snapshot.paramMap.get('storeId') || '');
  readonly projectId = signal(this.route.snapshot.paramMap.get('projectId') || this.route.parent?.snapshot.paramMap.get('projectId') || '');
  readonly seedState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly seedError = signal<string | undefined>(undefined);
  readonly turns = signal<readonly ChatTurn[]>([]);
  readonly sessions = signal<readonly ChatSession[]>([]);
  readonly workspace = signal(emptyChatWorkspace());
  readonly savedSelections = computed(() => Object.values(this.workspace().selections));
  readonly bookmarks = signal<readonly ChatBookmark[]>([]);
  readonly allBookmarks = signal<readonly ChatBookmark[]>([]);
  readonly bookmarkSearch = signal('');
  readonly bookmarkTags = signal('');
  readonly openBookmark = signal<ChatBookmark | undefined>(undefined);
  readonly tables = CHINOOK_SCHEMA.tables;
  readonly currentSelection = computed(() => {
    const state = this.workspace();
    return state.currentSelectionId ? state.selections[state.currentSelectionId] : undefined;
  });
  readonly selectedRows = computed(() => {
    const selection = this.currentSelection();
    const view = selection && this.workspace().views[selection.viewId];
    const turn = this.turns().find((item) => item.recordSetId === view?.recordSetId);
    return selection && turn?.rows ? selection.rows.map((index) => turn.rows?.[index]).filter((row): row is Record<string, unknown> => !!row) : [];
  });
  readonly activeSessionId = signal('');
  readonly activeSessionTitle = computed(() => this.sessions().find((session) => session.id === this.activeSessionId())?.title || 'Chat session');
  readonly sessionBusy = signal(false);
  readonly sessionState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly sessionError = signal<string | undefined>(undefined);
  readonly renameModalOpen = signal(false);
  readonly sessionTitleDraft = signal('');
  readonly sessionAction = signal<{ kind: 'clear' | 'delete'; id: string } | undefined>(undefined);
  readonly sessionAlertHeader = computed(() => this.sessionAction()?.kind === 'clear' ? 'Clear chat?' : 'Delete chat?');
  readonly sessionAlertMessage = computed(() => this.sessionAction()?.kind === 'clear'
    ? 'Remove this chat’s messages and saved results? The chat will remain.'
    : 'Remove this chat and all its saved results?');
  readonly sessionAlertButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Confirm', role: 'confirm', handler: () => { void this.confirmSessionAction(); } },
  ];
  readonly turnTabs = signal<Readonly<Record<string, 'rows' | 'dtql' | 'sql' | 'metrics'>>>({});
  readonly question = signal('');
  readonly submitting = signal(false);
  readonly providerModalOpen = signal(false);
  readonly providerChoice = signal(this.providers.selectedId() || '');
  readonly providerError = signal<string | undefined>(undefined);
  readonly editingId = signal<string | undefined>(undefined);
  readonly presetName = signal('DeepSeek');
  readonly draft = signal<Omit<ChatProvider, 'id'>>({ ...providerPresets['DeepSeek'], apiKey: '' });
  readonly selectedProvider = computed(() => this.providers.providers().find((item) => item.id === this.providers.selectedId()));

  constructor() {
    this.route.paramMap.subscribe(() => this.updateScope());
    this.route.parent?.paramMap.subscribe(() => this.updateScope());
    void this.seed();
    void this.restoreSessions();
  }

  async newSession(): Promise<void> {
    if (this.submitting() || this.sessionBusy()) return;
    this.sessionBusy.set(true);
    const scope = this.scope();
    try {
      const session = await this.sessionStore.create(scope);
      if (scope !== this.scope()) return;
      await this.refreshSessions();
      if (scope !== this.scope()) return;
      this.activeSessionId.set(session.id);
      this.turns.set([]);
      this.turnTabs.set({});
      this.workspace.set(session.workspace || emptyChatWorkspace());
      this.sessionState.set('ready');
      this.sessionError.set(undefined);
    } catch (error) {
      this.showSessionError(error);
    } finally {
      this.sessionBusy.set(false);
    }
  }

  retrySessions(): void {
    void this.restoreSessions();
  }

  async switchSession(id: string): Promise<void> {
    if (!id || id === this.activeSessionId() || this.submitting() || this.sessionBusy()) return;
    const scope = this.scope();
    this.sessionBusy.set(true);
    this.activeSessionId.set(id);
    this.turns.set([]);
    this.turnTabs.set({});
    try {
      this.sessionState.set('loading');
      const restored = await this.sessionStore.load(scope, id);
      if (scope !== this.scope()) return;
      await this.sessionStore.activate(scope, id);
      if (scope !== this.scope()) return;
      this.turns.set(restored.turns);
      this.workspace.set(restored.session.workspace || emptyChatWorkspace());
      this.turnTabs.set({});
      await this.refreshSessions();
      if (scope !== this.scope()) return;
      this.sessionState.set('ready');
      this.sessionError.set(undefined);
    } catch (error) {
      this.showSessionError(error);
      this.sessionState.set('error');
    } finally {
      this.sessionBusy.set(false);
    }
  }

  openRename(): void {
    const session = this.sessions().find((item) => item.id === this.activeSessionId());
    if (!session) return;
    this.sessionTitleDraft.set(session.title);
    this.renameModalOpen.set(true);
  }

  async saveRename(): Promise<void> {
    if (this.sessionBusy() || this.submitting()) return;
    const scope = this.scope();
    const id = this.activeSessionId();
    this.sessionBusy.set(true);
    try {
      await this.sessionStore.rename(scope, id, this.sessionTitleDraft());
      if (scope !== this.scope() || id !== this.activeSessionId()) return;
      await this.refreshSessions();
      if (scope !== this.scope() || id !== this.activeSessionId()) return;
      this.renameModalOpen.set(false);
      this.sessionError.set(undefined);
    } catch (error) {
      this.showSessionError(error);
    } finally {
      this.sessionBusy.set(false);
    }
  }

  askSessionAction(kind: 'clear' | 'delete'): void {
    const id = this.activeSessionId();
    if (id && !this.submitting() && !this.sessionBusy()) this.sessionAction.set({ kind, id });
  }

  async confirmSessionAction(): Promise<void> {
    const action = this.sessionAction();
    if (!action || this.sessionBusy() || this.submitting()) return;
    const scope = this.scope();
    this.sessionBusy.set(true);
    try {
      if (action.kind === 'clear') {
        await this.sessionStore.clear(scope, action.id);
        if (scope === this.scope() && action.id === this.activeSessionId()) this.turns.set([]);
        if (scope === this.scope() && action.id === this.activeSessionId()) this.workspace.set(emptyChatWorkspace());
      } else {
        await this.sessionStore.delete(scope, action.id);
        if (scope === this.scope() && action.id === this.activeSessionId()) {
          this.activeSessionId.set('');
          this.turns.set([]);
          this.workspace.set(emptyChatWorkspace());
        }
      }
      if (scope === this.scope()) await this.restoreSessions();
    } catch (error) {
      this.showSessionError(error);
    } finally {
      this.sessionBusy.set(false);
    }
  }

  choosePreset(name: string): void {
    this.presetName.set(name);
    this.editingId.set(undefined);
    this.draft.set({ ...this.providers.preset(name), apiKey: '' });
    this.providerError.set(undefined);
  }

  edit(provider: ChatProvider): void {
    this.providerModalOpen.set(true);
    this.editingId.set(provider.id);
    this.presetName.set(provider.name in providerPresets ? provider.name : 'DeepSeek');
    this.draft.set({ name: provider.name, protocol: provider.protocol, baseUrl: provider.baseUrl, model: provider.model, apiKey: provider.apiKey });
    this.providerError.set(undefined);
  }

  updateDraft(field: keyof Omit<ChatProvider, 'id'>, value: string): void {
    this.draft.update((draft) => ({ ...draft, [field]: value } as Omit<ChatProvider, 'id'>));
    this.providerError.set(undefined);
  }

  saveProvider(): void {
    const draft = this.draft();
    if (!draft.name.trim() || !draft.baseUrl.trim() || !draft.model.trim() || !draft.apiKey.trim()) {
      this.providerError.set('Enter a name, base URL, model, and API key.');
      return;
    }
    const provider = this.providers.save(draft, this.editingId());
    this.providers.select(provider.id);
    this.providerChoice.set(provider.id);
    this.choosePreset('DeepSeek');
    this.providerModalOpen.set(false);
  }

  selectProvider(value: string): void {
    if (value === '__add_provider__') {
      this.choosePreset('DeepSeek');
      this.providerModalOpen.set(true);
      this.providerChoice.set('__add_provider__');
      queueMicrotask(() => this.providerChoice.set(this.providers.selectedId() || ''));
      return;
    }
    this.providers.select(value);
    this.providerChoice.set(this.providers.selectedId() || '');
  }

  closeProviderModal(): void {
    this.providerModalOpen.set(false);
    this.providerError.set(undefined);
    this.choosePreset('DeepSeek');
    this.providerChoice.set(this.providers.selectedId() || '');
  }

  removeProvider(provider: ChatProvider): void {
    this.providers.remove(provider.id);
    this.providerChoice.set(this.providers.selectedId() || '');
    if (this.editingId() === provider.id) this.choosePreset('DeepSeek');
  }

  async submit(): Promise<void> {
    const question = this.question().trim();
    const provider = this.selectedProvider();
    if (!question || !provider || this.seedState() !== 'ready' || this.sessionState() !== 'ready' || !this.activeSessionId() || this.submitting() || this.sessionBusy()) return;
    const scope = this.scope();
    const sessionId = this.activeSessionId();
    const dataScope = `${this.storeId()}:${this.projectId()}`;
    this.submitting.set(true);
    let id: string | undefined;
    try {
      const context = this.sessionStore.context(this.turns(), this.workspace(), this.projectId(), this.allBookmarks());
      const pending = await this.sessionStore.appendQuestion(scope, sessionId, question);
      id = pending.id;
      if (scope === this.scope() && sessionId === this.activeSessionId()) {
        this.question.set('');
        this.turns.update((turns) => [...turns, pending]);
        await this.refreshSessions();
      }
      const interpretation = await this.interpreter.interpret(question, provider, context);
      if (scope !== this.scope()) throw new Error('The project changed before this result could be queried.');
      if (interpretation.workspaceAction) {
        const completed = await this.sessionStore.completeWorkspaceAction(
          scope, sessionId, id, interpretation.workspaceAction, interpretation.metrics,
        );
        if (scope === this.scope() && sessionId === this.activeSessionId()) {
          this.workspace.set(completed.workspace);
          this.replaceTurn(id, completed.turn);
          await this.refreshSessions();
        }
        return;
      }
      if (!interpretation.dtql) throw new Error('The AI provider did not return a query or workspace action.');
      const bound = await this.sessionStore.bindRecordSet(scope, sessionId, interpretation.dtql);
      if (scope !== this.scope()) throw new Error('The project changed before this result could be queried.');
      const queryStarted = performance.now();
      const { rows, query } = await this.data.query(dataScope, bound.dtql);
      const result = await this.sessionStore.completeQuery(scope, sessionId, id, {
        dtql: bound.dtql, generatedDtql: interpretation.dtql, parentRecordSetId: bound.parentRecordSetId,
        dtqlYaml: chatDtqlYaml(query), sql: chatSQLite(query), rows,
        columns: rows.length ? Object.keys(rows[0]) : [...(CHINOOK_SCHEMA.tables.find((table) => `${table.schema}.${table.name}` === query.source.name)?.fields || [])],
        metrics: { ...interpretation.metrics, queryMs: performance.now() - queryStarted },
        source: `${scope}/chinook`,
      });
      if (scope === this.scope() && sessionId === this.activeSessionId()) {
        this.replaceTurn(id, result);
        await this.refreshSessions();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to answer that question.';
      if (id) {
        try {
          const failed = await this.sessionStore.failQuestion(scope, sessionId, id, message);
          if (scope === this.scope() && sessionId === this.activeSessionId()) this.replaceTurn(id, failed);
        } catch (saveError) {
          this.showSessionError(saveError);
        }
      } else {
        this.showSessionError(error);
      }
    } finally {
      this.submitting.set(false);
    }
  }

  keyMask(provider: ChatProvider): string {
    return provider.apiKey.length > 9
      ? `${provider.apiKey.slice(0, 5)}••••${provider.apiKey.slice(-4)}`
      : '••••';
  }

  columnsFor(rows: readonly Record<string, unknown>[], visibleColumns?: readonly string[]): ColDef[] {
    const fields = visibleColumns || Object.keys(rows[0] || {});
    const key = fields.join('\u0000');
    let byFields = this.gridColumnCache.get(rows);
    if (!byFields) {
      byFields = new Map();
      this.gridColumnCache.set(rows, byFields);
    }
    let columns = byFields.get(key);
    if (!columns) {
      columns = fields.map((field) => ({ field, sortable: true, resizable: true, minWidth: 120 }));
      byFields.set(key, columns);
    }
    return columns;
  }

  gridRows(rows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
    let gridRows = this.gridRowCache.get(rows);
    if (!gridRows) {
      gridRows = rows.map((row, index) => ({ ...row, __sourceRowIndex: index }));
      this.gridRowCache.set(rows, gridRows);
    }
    return gridRows;
  }

  async workspaceAction(action: ChatWorkspaceAction): Promise<void> {
    if (this.submitting() || this.sessionBusy() || this.sessionState() !== 'ready') return;
    const scope = this.scope();
    const sessionId = this.activeSessionId();
    this.sessionBusy.set(true);
    try {
      const state = await this.sessionStore.workspaceAction(scope, sessionId, action);
      if (scope === this.scope() && sessionId === this.activeSessionId()) {
        this.workspace.set(state);
        await this.refreshBookmarks();
      }
    } catch (error) {
      this.showSessionError(error);
    } finally {
      this.sessionBusy.set(false);
    }
  }

  setWorkspaceTab(tab: string | number | undefined): void {
    if (tab === 'project' || tab === 'selected' || tab === 'docked' || tab === 'bookmarks') void this.workspaceAction({ kind: 'setTab', tab });
  }

  bookmarkReference(bookmark: ChatBookmark): ChatContextReference {
    return { kind: 'bookmark', projectId: this.projectId(), sourceId: 'chinook', objectId: bookmark.id, title: bookmark.title };
  }

  async refreshBookmarks(): Promise<void> {
    const scope = this.scope();
    const tags = this.bookmarkTags().split(',').map((tag) => tag.trim()).filter(Boolean);
    const [all, bookmarks] = await Promise.all([
      this.sessionStore.listBookmarks(scope), this.sessionStore.listBookmarks(scope, this.bookmarkSearch(), tags),
    ]);
    if (scope === this.scope()) {
      this.allBookmarks.set(all);
      this.bookmarks.set(bookmarks);
    }
  }

  filterBookmarks(): void { void this.refreshBookmarks(); }
  bookmarkCurrent(): void {
    const selection = this.currentSelection();
    const reference = this.selectionReference();
    if (selection && reference) void this.workspaceAction({ kind: 'bookmark', reference, title: selection.title });
  }
  renameBookmark(bookmark: ChatBookmark): void { const title = window.prompt('Bookmark name', bookmark.title); if (title !== null) void this.workspaceAction({ kind: 'renameBookmark', bookmarkId: bookmark.id, title }); }
  addBookmarkTag(bookmark: ChatBookmark): void { const tag = window.prompt('Tag'); if (tag !== null) void this.workspaceAction({ kind: 'addBookmarkTag', bookmarkId: bookmark.id, tag }); }
  removeBookmarkTag(bookmark: ChatBookmark, tag: string): void { void this.workspaceAction({ kind: 'removeBookmarkTag', bookmarkId: bookmark.id, tag }); }
  deleteBookmark(bookmark: ChatBookmark): void { if (window.confirm(`Delete bookmark “${bookmark.title}”?`)) void this.workspaceAction({ kind: 'deleteBookmark', bookmarkId: bookmark.id }); }
  showBookmark(bookmark: ChatBookmark): void { this.openBookmark.set(bookmark); }
  bookmarkRows(bookmark: ChatBookmark): Record<string, unknown>[] {
    return [...chatBookmarkRows(bookmark)];
  }

  projectReference(): ChatContextReference {
    return { kind: 'project', projectId: this.projectId(), objectId: this.projectId(), title: this.projectId() };
  }

  sourceReference(): ChatContextReference {
    return { kind: 'source', projectId: this.projectId(), sourceId: 'chinook', objectId: 'chinook', title: 'Chinook' };
  }

  tableReference(schema: string, name: string): ChatContextReference {
    return { kind: 'table', projectId: this.projectId(), sourceId: 'chinook', objectId: `${schema}.${name}`, title: name };
  }

  attached(reference: ChatContextReference): boolean {
    return this.workspace().attachments.some((item) => item.kind === reference.kind && item.objectId === reference.objectId && item.sourceId === reference.sourceId);
  }

  toggleAttachment(reference: ChatContextReference): void {
    void this.workspaceAction({ kind: this.attached(reference) ? 'detach' : 'attach', reference });
  }

  onGridSelection(turn: ChatTurn, event: SelectionChangedEvent): void {
    if (!turn.recordSetId) return;
    if (!['checkboxSelected', 'rowClicked', 'spaceKey', 'keyboardSelectAll', 'uiSelectAll'].includes(event.source)) return;
    const rows = event.api.getSelectedNodes().map((node) => (node.data as { __sourceRowIndex?: number } | undefined)?.__sourceRowIndex)
      .filter((index): index is number => Number.isInteger(index));
    if (rows.length) void this.workspaceAction({ kind: 'select', recordSetId: turn.recordSetId, rows, title: `${rows.length} selected rows` });
    else if (this.currentSelection()) void this.workspaceAction({ kind: 'clearSelection' });
  }

  onGridCell(turn: ChatTurn, event: CellClickedEvent): void {
    const index = (event.data as { __sourceRowIndex?: number } | undefined)?.__sourceRowIndex;
    const column = event.column.getColId();
    if (!turn.recordSetId || !Number.isInteger(index) || index === undefined || !turn.columns?.includes(column)) return;
    const pointer = event.event;
    const shifted = pointer instanceof MouseEvent && pointer.shiftKey && this.cellAnchor?.recordSetId === turn.recordSetId;
    if (shifted && this.cellAnchor && turn.columns) {
      const anchor = this.cellAnchor;
      const displayCount = event.api.getDisplayedRowCount();
      let anchorDisplay = -1;
      for (let displayed = 0; displayed < displayCount; displayed++) {
        if ((event.api.getDisplayedRowAtIndex(displayed)?.data as { __sourceRowIndex?: number } | undefined)?.__sourceRowIndex === anchor.sourceRow) {
          anchorDisplay = displayed;
          break;
        }
      }
      const targetDisplay = event.node.rowIndex;
      const startColumn = turn.columns.indexOf(anchor.column);
      const endColumn = turn.columns.indexOf(column);
      if (anchorDisplay >= 0 && targetDisplay !== null && startColumn >= 0 && endColumn >= 0) {
        const rows: number[] = [];
        for (let displayed = Math.min(anchorDisplay, targetDisplay); displayed <= Math.max(anchorDisplay, targetDisplay); displayed++) {
          const source = (event.api.getDisplayedRowAtIndex(displayed)?.data as { __sourceRowIndex?: number } | undefined)?.__sourceRowIndex;
          if (source !== undefined) rows.push(source);
        }
        const columns = turn.columns.slice(Math.min(startColumn, endColumn), Math.max(startColumn, endColumn) + 1);
        void this.workspaceAction({
          kind: 'select', recordSetId: turn.recordSetId, rows, columns,
          ranges: [{ rowIndices: rows, columns }], title: `${rows.length} × ${columns.length} cells`,
        });
        return;
      }
    }
    this.cellAnchor = { recordSetId: turn.recordSetId, sourceRow: index, column };
    void this.workspaceAction({
      kind: 'select', recordSetId: turn.recordSetId, rows: [index], columns: [column],
      ranges: [{ rowIndices: [index], columns: [column] }],
      title: `${column} · row ${index + 1}`,
    });
  }

  selectionReference(): ChatContextReference | undefined {
    const selection = this.currentSelection();
    return selection ? { kind: 'selection', projectId: this.projectId(), sourceId: 'chinook', objectId: selection.id, title: selection.title } : undefined;
  }

  viewReference(): ChatContextReference | undefined {
    const selection = this.currentSelection();
    const view = selection && this.workspace().views[selection.viewId];
    return view ? { kind: 'view', projectId: this.projectId(), sourceId: 'chinook', objectId: view.id, title: view.title } : undefined;
  }

  resultReference(turn: ChatTurn): ChatContextReference | undefined {
    return turn.recordSetId ? {
      kind: 'recordset', projectId: this.projectId(), sourceId: 'chinook', objectId: turn.recordSetId,
      title: turn.question.slice(0, 60),
    } : undefined;
  }

  selectedEntries(): readonly { key: string; value: unknown }[] {
    const row = this.selectedRows()[0];
    const selection = this.currentSelection();
    return row && selection ? selection.columns.map((key) => ({ key, value: row[key] })) : [];
  }

  dockRows(dock: ChatDock): Record<string, unknown>[] {
    if (dock.reference.kind === 'bookmark') {
      const bookmark = this.allBookmarks().find((item) => item.id === dock.reference.objectId);
      return bookmark ? [...this.bookmarkRows(bookmark)] : [];
    }
    const state = this.workspace();
    const turns = this.turns();
    const cached = this.dockRowCache.get(dock.id);
    if (cached?.state === state && cached.turns === turns) return cached.rows;
    const selection = dock.reference.kind === 'selection' ? state.selections[dock.reference.objectId] : undefined;
    const view = selection ? state.views[selection.viewId] : dock.reference.kind === 'view' ? state.views[dock.reference.objectId] : undefined;
    const recordSetId = view?.recordSetId || (dock.reference.kind === 'recordset' ? dock.reference.objectId : undefined);
    const source = turns.find((turn) => turn.recordSetId === recordSetId)?.rows;
    const rows = source ? (selection?.rows || view?.rowIndices || source.map((_, index) => index))
      .map((index) => source[index]).filter((row): row is Record<string, unknown> => !!row) : [];
    if (this.dockRowCache.size > 32) this.dockRowCache.clear();
    this.dockRowCache.set(dock.id, { state, turns, rows });
    return rows;
  }

  dockColumns(dock: ChatDock): readonly string[] | undefined {
    const state = this.workspace();
    const selection = dock.reference.kind === 'selection' ? state.selections[dock.reference.objectId] : undefined;
    const view = selection ? state.views[selection.viewId] : dock.reference.kind === 'view' ? state.views[dock.reference.objectId] : undefined;
    return selection?.columns || view?.columns;
  }

  turnTab(turn: ChatTurn): 'rows' | 'dtql' | 'sql' | 'metrics' {
    return this.turnTabs()[turn.id] || 'rows';
  }

  selectTurnTab(turnId: string, tab: string | number | undefined): void {
    if (tab !== 'rows' && tab !== 'dtql' && tab !== 'sql' && tab !== 'metrics') return;
    this.turnTabs.update((tabs) => ({ ...tabs, [turnId]: tab }));
  }

  private async seed(): Promise<void> {
    const scope = this.scope();
    this.seedState.set('loading');
    this.seedError.set(undefined);
    try {
      await this.data.ensureSeed(this.storeId(), this.projectId());
      if (scope !== this.scope()) return;
      this.seedState.set('ready');
    } catch (error) {
      if (scope !== this.scope()) return;
      this.seedError.set(error instanceof Error ? error.message : 'The local Chinook database is unavailable.');
      this.seedState.set('error');
    }
  }

  private updateScope(): void {
    const storeId = this.route.snapshot.paramMap.get('storeId') || this.route.parent?.snapshot.paramMap.get('storeId') || '';
    const projectId = this.route.snapshot.paramMap.get('projectId') || this.route.parent?.snapshot.paramMap.get('projectId') || '';
    if (storeId === this.storeId() && projectId === this.projectId()) return;
    this.storeId.set(storeId);
    this.projectId.set(projectId);
    this.turns.set([]);
    this.sessions.set([]);
    this.bookmarks.set([]);
    this.allBookmarks.set([]);
    this.openBookmark.set(undefined);
    this.workspace.set(emptyChatWorkspace());
    this.activeSessionId.set('');
    void this.seed();
    void this.restoreSessions();
  }

  private scope(): string {
    return JSON.stringify([this.storeId(), this.projectId()]);
  }

  private async restoreSessions(): Promise<void> {
    const scope = this.scope();
    this.sessionState.set('loading');
    try {
      let sessions = await this.sessionStore.list(scope);
      if (!sessions.length) {
        await this.sessionStore.create(scope);
        sessions = await this.sessionStore.list(scope);
      }
      if (scope !== this.scope()) return;
      this.sessions.set(sessions);
      const selectedId = this.activeSessionId();
      const selected = sessions.find((session) => session.id === selectedId) || sessions[0];
      this.activeSessionId.set(selected.id);
      this.turns.set([]);
      const restored = await this.sessionStore.load(scope, selected.id);
      if (scope !== this.scope()) return;
      this.turns.set(restored.turns);
      this.workspace.set(restored.session.workspace || emptyChatWorkspace());
      await this.refreshBookmarks();
      this.turnTabs.set({});
      this.sessionState.set('ready');
      this.sessionError.set(undefined);
    } catch (error) {
      this.showSessionError(error);
      this.sessionState.set('error');
    }
  }

  private async refreshSessions(): Promise<void> {
    const scope = this.scope();
    const sessions = await this.sessionStore.list(scope);
    if (scope === this.scope()) this.sessions.set(sessions);
  }

  private showSessionError(error: unknown): void {
    this.sessionError.set(error instanceof Error ? error.message : 'Could not save this chat session.');
  }

  private replaceTurn(id: string, replacement: ChatTurn): void {
    this.turns.update((turns) => turns.map((turn) => turn.id === id ? replacement : turn));
  }
}
