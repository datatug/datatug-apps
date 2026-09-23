import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton, IonContent, IonHeader, IonInput, IonItem, IonLabel, IonSpinner, IonText, IonTitle, IonToolbar } from '@ionic/angular';
import { captureCliChatCapability, cliChatCapability } from './cli-chat-capability';

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
  imports: [FormsModule, IonButton, IonContent, IonHeader, IonInput, IonItem, IonLabel, IonSpinner, IonText, IonTitle, IonToolbar],
  template: `
    <ion-header><ion-toolbar><ion-title>{{ session()?.Title || 'CLI chat' }}</ion-title></ion-toolbar></ion-header>
    <ion-content class="ion-padding">
      @if (error()) { <ion-text color="danger"><p role="alert">{{ error() }}</p></ion-text> }
      @if (!session() && !error()) { <ion-spinner aria-label="Connecting to CLI chat" /> }
      @for (message of session()?.Messages || []; track message.ID) {
        @if (message.Kind === 'grid') {
          @if (recordSet(message.RecordSetID); as result) {
            <section aria-label="Query result"><h3>{{ result.Title }}</h3>
              <div style="overflow-x:auto"><table><thead><tr>
                @for (column of result.Result.Columns || []; track column) { <th scope="col">{{ column }}</th> }
              </tr></thead><tbody>
                @for (row of result.Result.Rows || []; track $index) { <tr>
                  @for (column of result.Result.Columns || []; track column) { <td>{{ row.Data[column] }}</td> }
                </tr> }
              </tbody></table></div>
              @if (!result.Result.Rows.length) { <p>No matching rows.</p> }
            </section>
          }
        } @else if (message.Text) {
          <article><strong>{{ message.Role === 'You' ? 'You' : 'DataTug' }}</strong><p>{{ message.Text }}</p></article>
        }
      }
      <ion-item><ion-label position="stacked">Message</ion-label>
        <ion-input aria-label="Message to CLI chat" [value]="draft()" (ionInput)="draft.set($event.detail.value || '')" (keyup.enter)="send()" [disabled]="!session() || sending()" />
      </ion-item>
      <ion-button (click)="send()" [disabled]="!session() || !draft().trim() || sending()">Send</ion-button>
      @if (sending()) { <ion-spinner aria-label="Waiting for DataTug" /> }
    </ion-content>
  `,
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

  private async refresh(): Promise<void> {
    const serial = ++this.refreshSerial;
    const address = this.address;
    const token = this.token;
    try {
      const response = await fetch(`${address}/session`, { headers: { 'X-DataTug-Chat-Capability': token }, cache: 'no-store' });
      if (!response.ok) throw new Error(`CLI chat returned ${response.status}`);
      const session = await response.json() as CliSession;
      if (serial !== this.refreshSerial || address !== this.address || token !== this.token) return;
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
