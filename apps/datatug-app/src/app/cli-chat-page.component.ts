import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ModuleRegistry, type ColDef } from 'ag-grid-community';
import { IonButton } from '@ionic/angular/ion-button';
import { IonButtons } from '@ionic/angular/ion-buttons';
import { IonContent } from '@ionic/angular/ion-content';
import { IonFooter } from '@ionic/angular/ion-footer';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonInput } from '@ionic/angular/ion-input';
import { IonItem } from '@ionic/angular/ion-item';
import { IonLabel } from '@ionic/angular/ion-label';
import { IonMenuButton } from '@ionic/angular/ion-menu-button';
import { IonSpinner } from '@ionic/angular/ion-spinner';
import { IonText } from '@ionic/angular/ion-text';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { captureCliChatCapability, cliChatCapability } from './cli-chat-capability';

ModuleRegistry.registerModules([AllCommunityModule]);

interface CliMessage {
  ID: string;
  Role: string;
  Kind: string;
  Text: string;
  RecordSetID: string;
}

interface CliRecordSet {
  Title: string;
  Result: { Columns: string[]; Rows: { Key: string; Data: Record<string, unknown> }[] };
}

interface CliSession {
  ID: string;
  Title: string;
  Messages: CliMessage[];
  RecordSets: Record<string, CliRecordSet>;
}

@Component({
  selector: 'datatug-cli-chat-page',
  standalone: true,
  imports: [FormsModule, AgGridAngular, IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonInput, IonItem, IonLabel, IonMenuButton, IonSpinner, IonText, IonTitle, IonToolbar],
  template: `
    <div class="ion-page">
      <ion-header><ion-toolbar>
        <ion-buttons slot="start"><ion-menu-button /></ion-buttons>
        <ion-title>{{ session()?.Title || 'CLI chat' }}</ion-title>
      </ion-toolbar></ion-header>
      <ion-content class="chat-content">
        <div class="chat-history">
          @if (error()) { <ion-text color="danger"><p role="alert">{{ error() }}</p></ion-text> }
          @if (!session() && !error()) { <ion-spinner aria-label="Connecting to CLI chat" /> }
          @for (message of session()?.Messages || []; track message.ID) {
            @if (message.Kind === 'grid') {
              @if (recordSet(message.RecordSetID); as result) {
                <section class="result-card" aria-label="Query result">
                  <div class="card-heading">{{ result.Title }}</div>
                  @if (result.Result.Rows.length) {
                    <ag-grid-angular class="ag-theme-quartz result-grid"
                      [rowData]="gridRows(result)" [columnDefs]="gridColumns(result)"
                      [defaultColDef]="{ sortable: true, resizable: true, filter: true }" />
                  } @else { <p>No matching rows.</p> }
                </section>
              }
            } @else if (message.Text) {
              <article class="message-card" [class.from-user]="message.Role === 'You'">
                <strong>{{ message.Role === 'You' ? 'You' : 'DataTug' }}</strong>
                <p>{{ message.Text }}</p>
              </article>
            }
          }
          @if (sending()) { <ion-spinner aria-label="Waiting for DataTug" /> }
        </div>
      </ion-content>
      <ion-footer class="composer-footer"><ion-toolbar>
        <div class="composer">
          <ion-item><ion-label position="stacked">Message</ion-label>
            <ion-input aria-label="Message to CLI chat" [value]="draft()" (ionInput)="draft.set($event.detail.value || '')" (keyup.enter)="send()" [disabled]="!session() || sending()" />
          </ion-item>
          <ion-button (click)="send()" [disabled]="!session() || !draft().trim() || sending()">Send</ion-button>
        </div>
      </ion-toolbar></ion-footer>
    </div>
  `,
  styles: [`
    .chat-content { --background: var(--ion-background-color); }
    .chat-history { display: flex; flex-direction: column; gap: 1rem; margin: 0 auto; max-width: 1080px; min-height: 100%; padding: 1.25rem; }
    .message-card, .result-card { background: var(--ion-card-background, var(--ion-background-color)); border: 1px solid var(--ion-color-light-shade); border-radius: 1rem; box-shadow: 0 2px 12px rgba(0, 0, 0, .06); padding: .8rem 1rem; }
    .message-card { align-self: flex-start; max-width: min(85%, 680px); white-space: pre-wrap; }
    .message-card.from-user { align-self: flex-end; background: rgba(var(--ion-color-primary-rgb), .1); }
    .message-card p { margin: .4rem 0 0; }
    .result-card { align-self: flex-start; max-width: 100%; width: min(100%, 900px); }
    .card-heading { font-weight: 600; margin-bottom: .75rem; }
    .result-grid { height: min(420px, 48vh); width: 100%; }
    .composer-footer { background: var(--ion-background-color); }
    .composer { align-items: end; display: flex; gap: .5rem; margin: 0 auto; max-width: 1080px; padding: .5rem 1rem; }
    .composer ion-item { flex: 1; min-width: 0; }
    @media (max-width: 600px) { .chat-history { padding: .75rem; } .message-card { max-width: 95%; } }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CliChatPageComponent implements OnInit, OnDestroy {
  readonly session = signal<CliSession | undefined>(undefined);
  readonly error = signal('');
  readonly draft = signal('');
  readonly sending = signal(false);
  private timer?: ReturnType<typeof setInterval>;
  private socket?: WebSocket;
  private address = '';
  private token = '';
  private refreshSerial = 0;
  private readonly rowCache = new WeakMap<CliRecordSet, Record<string, unknown>[]>();
  private readonly columnCache = new WeakMap<CliRecordSet, ColDef[]>();
  private readonly onHashChange = (): void => {
    if (!location.hash.startsWith('#h=')) return;
    captureCliChatCapability();
    this.configureBridge();
    this.socket?.close();
    this.socket = undefined;
    this.session.set(undefined);
    if (this.address) { void this.refresh(); this.connectEvents(); }
  };

  constructor() { this.configureBridge(); }

  private configureBridge(): void {
    const fragment = new URLSearchParams(cliChatCapability());
    const host = fragment.get('h') || '';
    const token = fragment.get('t') || '';
    if (!/^127\.0\.0\.1:\d{1,5}$/.test(host) || !/^[a-f0-9]{64}$/.test(token) || Number(host.split(':')[1]) > 65535) {
      this.error.set('Open this page from DataTug CLI using F5.');
      this.address = '';
      this.token = '';
    } else {
      this.address = `http://${host}/v1/chat`;
      this.token = token;
      this.error.set('');
    }
  }

  ngOnInit(): void {
    window.addEventListener('hashchange', this.onHashChange);
    if (!this.address) return;
    void this.refresh();
    this.connectEvents();
    this.timer = setInterval(() => {
      if (!this.socket || this.socket.readyState === WebSocket.CLOSED) this.connectEvents();
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) void this.refresh();
    }, 1000);
  }

  ngOnDestroy(): void {
    window.removeEventListener('hashchange', this.onHashChange);
    if (this.timer) clearInterval(this.timer);
    this.socket?.close();
  }

  private connectEvents(): void {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return;
    const socket = new WebSocket(this.address.replace('http://', 'ws://') + '/events', ['datatug-chat', this.token]);
    this.socket = socket;
    socket.onmessage = () => { void this.refresh(); };
    socket.onclose = () => { if (this.socket === socket) this.socket = undefined; };
    socket.onerror = () => socket.close();
  }

  recordSet(id: string): CliRecordSet | undefined { return this.session()?.RecordSets?.[id]; }

  gridRows(result: CliRecordSet): Record<string, unknown>[] {
    let rows = this.rowCache.get(result);
    if (!rows) {
      rows = result.Result.Rows.map((row) => row.Data);
      this.rowCache.set(result, rows);
    }
    return rows;
  }

  gridColumns(result: CliRecordSet): ColDef[] {
    let columns = this.columnCache.get(result);
    if (!columns) {
      columns = result.Result.Columns.map((column) => ({ field: column, headerName: column }));
      this.columnCache.set(result, columns);
    }
    return columns;
  }

  private async refresh(): Promise<void> {
    const serial = ++this.refreshSerial;
    const address = this.address;
    const token = this.token;
    try {
      const response = await fetch(`${address}/session`, { headers: { 'X-DataTug-Chat-Capability': token }, cache: 'no-store' });
      if (!response.ok) throw new Error(`CLI chat returned ${response.status}`);
      const session = await response.json() as CliSession;
      if (serial !== this.refreshSerial || address !== this.address || token !== this.token) return;
      const previous = this.session();
      if (previous) {
        for (const [id, recordSet] of Object.entries(session.RecordSets || {})) {
          const prior = previous.RecordSets?.[id];
          if (prior && JSON.stringify(prior) === JSON.stringify(recordSet)) {
            session.RecordSets[id] = prior;
          }
        }
      }
      this.session.set(session);
      this.error.set('');
    } catch {
      if (serial !== this.refreshSerial || address !== this.address || token !== this.token) return;
      this.error.set('Cannot reach this CLI chat. Keep DataTug running and check that the browser permits local connections.');
    }
  }

  async send(): Promise<void> {
    const text = this.draft().trim();
    const sessionId = this.session()?.ID;
    const address = this.address;
    const token = this.token;
    if (!text || !sessionId || this.sending()) return;
    this.sending.set(true);
    try {
      const response = await fetch(`${address}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DataTug-Chat-Capability': token },
        body: JSON.stringify({ text, sessionId }),
      });
      if (!response.ok) throw new Error(`CLI chat returned ${response.status}`);
      if (address !== this.address || token !== this.token) return;
      this.draft.set('');
      await this.refresh();
    } catch {
      if (address !== this.address || token !== this.token) return;
      this.error.set('Could not send this message. Check the CLI session and try again.');
    } finally {
      this.sending.set(false);
    }
  }
}
