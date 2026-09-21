import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ModuleRegistry, type ColDef } from 'ag-grid-community';
import {
  IonButton, IonButtons, IonCard, IonCardContent, IonCol, IonContent, IonFooter, IonGrid, IonHeader,
  IonIcon, IonInput, IonItem, IonLabel, IonMenuButton, IonModal,
  IonRow, IonSelect, IonSelectOption, IonSegment, IonSegmentButton, IonSpinner, IonText, IonTextarea, IonTitle, IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { sendOutline } from 'ionicons/icons';
import { ChatInterpretService } from '../../../chat/chat-interpret.service';
import { ChinookChatDataService } from '../../../chat/chinook-chat-data.service';
import { ChatProviderService, providerPresets } from '../../../chat/chat-provider.service';
import { ChatProvider, ChatTurn } from '../../../chat/chat.types';
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
    IonSpinner, IonSegment, IonSegmentButton, IonTextarea, SneatDatatugPageTitleComponent,
  ],
})
export class ChatPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly interpreter = inject(ChatInterpretService);
  private readonly data = inject(ChinookChatDataService);
  readonly providers = inject(ChatProviderService);

  readonly storeId = signal(this.route.snapshot.paramMap.get('storeId') || this.route.parent?.snapshot.paramMap.get('storeId') || '');
  readonly projectId = signal(this.route.snapshot.paramMap.get('projectId') || this.route.parent?.snapshot.paramMap.get('projectId') || '');
  readonly seedState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly seedError = signal<string | undefined>(undefined);
  readonly turns = signal<readonly ChatTurn[]>([]);
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
    if (!question || !provider || this.seedState() !== 'ready' || this.submitting()) return;
    const scope = `${this.storeId()}:${this.projectId()}`;
    this.question.set('');
    this.submitting.set(true);
    const id = crypto.randomUUID();
    this.turns.update((turns) => [...turns, { id, question, state: 'loading' }]);
    try {
      const interpretation = await this.interpreter.interpret(question, provider);
      if (scope !== `${this.storeId()}:${this.projectId()}`) throw new Error('The project changed before this result could be queried.');
      const queryStarted = performance.now();
      const { rows, query } = await this.data.query(scope, interpretation.dtql);
      this.replaceTurn(id, { id, question, dtql: interpretation.dtql, dtqlYaml: chatDtqlYaml(query), sql: chatSQLite(query), rows, state: rows.length ? 'result' : 'empty', metrics: { ...interpretation.metrics, queryMs: performance.now() - queryStarted } });
    } catch (error) {
      this.replaceTurn(id, { id, question, state: 'error', error: error instanceof Error ? error.message : 'Unable to answer that question.' });
    } finally {
      this.submitting.set(false);
    }
  }

  keyMask(provider: ChatProvider): string {
    return provider.apiKey.length > 9
      ? `${provider.apiKey.slice(0, 5)}••••${provider.apiKey.slice(-4)}`
      : '••••';
  }

  columnsFor(rows: readonly Record<string, unknown>[]): ColDef[] {
    return Object.keys(rows[0] || {}).map((field) => ({ field, sortable: true, resizable: true, minWidth: 120 }));
  }

  gridRows(rows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
    return [...rows];
  }

  turnTab(turn: ChatTurn): 'rows' | 'dtql' | 'sql' | 'metrics' {
    return this.turnTabs()[turn.id] || 'rows';
  }

  selectTurnTab(turnId: string, tab: string | number | undefined): void {
    if (tab !== 'rows' && tab !== 'dtql' && tab !== 'sql' && tab !== 'metrics') return;
    this.turnTabs.update((tabs) => ({ ...tabs, [turnId]: tab }));
  }

  private async seed(): Promise<void> {
    const scope = `${this.storeId()}:${this.projectId()}`;
    this.seedState.set('loading');
    this.seedError.set(undefined);
    try {
      await this.data.ensureSeed(this.storeId(), this.projectId());
      if (scope !== `${this.storeId()}:${this.projectId()}`) return;
      this.seedState.set('ready');
    } catch (error) {
      if (scope !== `${this.storeId()}:${this.projectId()}`) return;
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
    void this.seed();
  }

  private replaceTurn(id: string, replacement: ChatTurn): void {
    this.turns.update((turns) => turns.map((turn) => turn.id === id ? replacement : turn));
  }
}
