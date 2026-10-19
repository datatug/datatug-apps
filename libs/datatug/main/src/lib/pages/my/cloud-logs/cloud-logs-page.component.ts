import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import {
  CloudLogsApiService,
  GoogleLogGrant,
  PersonalLogConnection,
  PersonalLogEntry,
  PersonalLogErrorCode,
  PersonalLogQueryResult,
} from './cloud-logs-api.service';

type PageState = 'loading' | 'ready' | 'error';
type QueryState = 'idle' | 'loading' | 'ready' | 'error';
const finishKeyStorageKey = 'datatug:google-cloud-logs:finish-key';

declare global {
  interface Window {
    __datatugTakeGoogleLogsReturn?: () => {
      status: 'complete' | 'failed';
      receipt: string;
    };
  }
}

@Component({
  selector: 'sneat-datatug-cloud-logs-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonBackButton,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header
      ><ion-toolbar>
        <ion-buttons slot="start"
          ><ion-back-button defaultHref="/my"
        /></ion-buttons>
        <ion-title>Cloud Logging connections</ion-title>
      </ion-toolbar></ion-header
    >
    <ion-content color="light"
      ><main class="page">
        <h1>Personal Google Cloud log views</h1>
        <p>
          Connect your Google account and one project-local log view. DataTug
          reads current entries when you search; it does not save log payloads.
        </p>
        @if (notice()) {
          <p role="status" class="notice">{{ notice() }}</p>
        }
        @if (pageState() === 'loading') {
          <p role="status">Loading your connections…</p>
        }
        @if (pageState() === 'error') {
          <p role="alert" class="error">{{ pageError() }}</p>
          <ion-button (click)="loadConnections()">Retry</ion-button>
        }
        @if (pageState() === 'ready') {
          @if (pageError()) {
            <p role="alert" class="error">{{ pageError() }}</p>
          }
          <section aria-labelledby="accounts-heading">
            <h2 id="accounts-heading">Google accounts</h2>
            @if (!grants().length) {
              <p>No Google account is connected yet.</p>
            }
            @for (grant of grants(); track grant.id) {
              <article class="card account">
                <div>
                  <strong>{{ grant.email }}</strong>
                  <p>{{ grantLabel(grant) }}</p>
                </div>
                @if (confirmGrantId() === grant.id) {
                  <div
                    class="revoke-confirm"
                    role="group"
                    aria-label="Confirm Google account disconnect"
                  >
                    <p>
                      This disables every connected view and asks Google to
                      revoke this integration grant. Revocation can affect every
                      scope and client in the integration’s isolated Google
                      OAuth project.
                    </p>
                    <ion-button
                      color="danger"
                      [disabled]="busyGrantId() === grant.id"
                      (click)="disconnect(grant)"
                      >{{
                        busyGrantId() === grant.id
                          ? 'Disconnecting…'
                          : 'Confirm disconnect'
                      }}</ion-button
                    >
                    <ion-button
                      fill="clear"
                      [disabled]="busyGrantId() === grant.id"
                      (click)="confirmGrantId.set('')"
                      >Cancel</ion-button
                    >
                  </div>
                } @else {
                  <ion-button
                    fill="outline"
                    color="danger"
                    [disabled]="
                      grant.state !== 'active' || busyGrantId() === grant.id
                    "
                    (click)="confirmGrantId.set(grant.id)"
                    >Disconnect Google account</ion-button
                  >
                }
              </article>
            }
            <ion-button [disabled]="busy()" (click)="startAuthorization()">{{
              grants().length
                ? 'Connect another Google account'
                : 'Connect Google account'
            }}</ion-button>
          </section>

          <section class="card" aria-labelledby="connect-heading">
            <h2 id="connect-heading">Add a log view</h2>
            <p>
              Enter the Google Cloud project ID and full log view resource name,
              such as <code>projects/example/logs/my-view</code>. DataTug probes
              your access before enabling this view.
            </p>
            <label for="cloud-logs-grant"
              >Google account
              <ion-select
                id="cloud-logs-grant"
                aria-label="Google account"
                [value]="selectedGrantId()"
                (ionChange)="selectedGrantId.set($event.detail.value)"
              >
                @for (grant of activeGrants(); track grant.id) {
                  <ion-select-option [value]="grant.id">{{
                    grant.email
                  }}</ion-select-option>
                }
              </ion-select>
            </label>
            <label for="cloud-logs-project-id"
              >Google Cloud project ID
              <ion-input
                id="cloud-logs-project-id"
                aria-label="Google Cloud project ID"
                [value]="projectId()"
                (ionInput)="projectId.set(inputValue($event))"
                autocomplete="off"
            /></label>
            <label for="cloud-logs-view-id"
              >Full log view resource name
              <ion-input
                id="cloud-logs-view-id"
                aria-label="Full log view resource name"
                [value]="logViewId()"
                (ionInput)="logViewId.set(inputValue($event))"
                placeholder="projects/example/logs/my-view"
                autocomplete="off"
            /></label>
            <ion-button [disabled]="!canConnect()" (click)="connectView()">{{
              busy() ? 'Checking access…' : 'Probe and connect view'
            }}</ion-button>
          </section>

          <section aria-labelledby="views-heading">
            <h2 id="views-heading">Connected views</h2>
            @if (!connections().length) {
              <p>No log views connected.</p>
            }
            @for (connection of connections(); track connection.id) {
              <article
                class="card connection"
                [class.inactive]="!connection.active"
              >
                <div>
                  <strong>{{ connection.projectId }}</strong>
                  <p>{{ connection.logViewId }}</p>
                  @if (!connection.active) {
                    <p role="status">
                      This view is inactive. Reconnect Google access or remove
                      it.
                    </p>
                  }
                </div>
                <div class="actions">
                  <ion-button
                    fill="outline"
                    [disabled]="!connection.active"
                    (click)="selectConnection(connection)"
                    >View logs</ion-button
                  >
                  <ion-button
                    fill="clear"
                    color="danger"
                    [disabled]="busyConnectionId() === connection.id"
                    (click)="removeView(connection)"
                    >Remove view</ion-button
                  >
                </div>
              </article>
            }
          </section>

          @if (selectedConnection(); as connection) {
            <section class="card timeline" aria-labelledby="timeline-heading">
              <h2 id="timeline-heading">Log evidence</h2>
              <p class="view-name">
                {{ connection.projectId }} / {{ connection.logViewId }}
              </p>
              @if (!connection.active) {
                <p role="status">
                  Google access to this view expired or was denied. Reconnect
                  the Google account, then probe this view again.
                </p>
                <ion-button (click)="startAuthorization()"
                  >Reconnect Google account</ion-button
                >
              } @else {
                <form
                  (submit)="runQuery($event)"
                  aria-label="Cloud Logging filters"
                >
                  <label for="cloud-logs-from"
                    >From (RFC3339 UTC)
                    <ion-input
                      id="cloud-logs-from"
                      aria-label="From (RFC3339 UTC)"
                      type="text"
                      placeholder="2026-10-18T00:00:00Z"
                      [value]="fromTime()"
                      (ionInput)="fromTime.set(inputValue($event))"
                  /></label>
                  <label for="cloud-logs-to"
                    >To (RFC3339 UTC)
                    <ion-input
                      id="cloud-logs-to"
                      aria-label="To (RFC3339 UTC)"
                      type="text"
                      placeholder="2026-10-19T00:00:00Z"
                      [value]="toTime()"
                      (ionInput)="toTime.set(inputValue($event))"
                  /></label>
                  <label for="cloud-logs-severity"
                    >Severity
                    <ion-select
                      id="cloud-logs-severity"
                      aria-label="Severity"
                      [value]="severity()"
                      (ionChange)="severity.set($event.detail.value)"
                    >
                      <ion-select-option value="">All</ion-select-option
                      ><ion-select-option value="DEBUG">DEBUG</ion-select-option
                      ><ion-select-option value="INFO">INFO</ion-select-option
                      ><ion-select-option value="NOTICE"
                        >NOTICE</ion-select-option
                      ><ion-select-option value="WARNING"
                        >WARNING</ion-select-option
                      ><ion-select-option value="ERROR">ERROR</ion-select-option
                      ><ion-select-option value="CRITICAL"
                        >CRITICAL</ion-select-option
                      ><ion-select-option value="ALERT">ALERT</ion-select-option
                      ><ion-select-option value="EMERGENCY"
                        >EMERGENCY</ion-select-option
                      >
                    </ion-select></label
                  >
                  <label for="cloud-logs-correlation-id"
                    >Correlation ID
                    <ion-input
                      id="cloud-logs-correlation-id"
                      aria-label="Correlation ID"
                      [value]="correlationId()"
                      (ionInput)="correlationId.set(inputValue($event))"
                  /></label>
                  <label for="cloud-logs-order-id"
                    >Order ID
                    <ion-input
                      id="cloud-logs-order-id"
                      aria-label="Order ID"
                      [value]="orderId()"
                      (ionInput)="orderId.set(inputValue($event))"
                  /></label>
                  <label for="cloud-logs-service"
                    >Service
                    <ion-input
                      id="cloud-logs-service"
                      aria-label="Service"
                      [value]="service()"
                      (ionInput)="service.set(inputValue($event))"
                  /></label>
                  <p class="filter-note">
                    Bounds are inclusive. Identifier and service equality is
                    case-insensitive for ASCII values. Non-ASCII filters are
                    unsupported. Free-text search is unavailable. Results are
                    current source evidence, capped at 200 entries.
                  </p>
                  <ion-button
                    type="submit"
                    [disabled]="queryState() === 'loading'"
                    >{{
                      queryState() === 'loading'
                        ? 'Searching…'
                        : 'Find evidence'
                    }}</ion-button
                  >
                </form>
                @if (queryState() === 'loading') {
                  <p role="status">Reading current entries…</p>
                }
                @if (queryState() === 'error') {
                  <p role="alert" class="error">{{ queryError() }}</p>
                }
                @if (queryState() === 'ready' && !entries().length) {
                  <p role="status">No entries matched this bounded query.</p>
                }
                @if (queryState() === 'ready' && entries().length) {
                  <p role="status">
                    {{ entries().length }} entries{{
                      result()?.capped ? ' · result cap reached' : ''
                    }}{{
                      result()?.morePossible
                        ? ' · more entries may be available'
                        : ''
                    }}
                  </p>
                  <ol>
                    @for (
                      entry of entries();
                      track entry.sourceRef ||
                        entry.timestamp + entry.source + entry.message
                    ) {
                      <li>
                        <button
                          type="button"
                          class="entry"
                          (click)="toggleEntry(entry)"
                        >
                          <time>{{ entry.timestamp }}</time
                          ><strong>{{ entry.severity }}</strong
                          ><span>{{ entry.source }}</span
                          ><span>{{ entry.message }}</span>
                        </button>
                        @if (selectedEntry() === entry) {
                          <section class="details" aria-label="Entry details">
                            <dl>
                              <dt>Source</dt>
                              <dd>{{ entry.source }}</dd>
                              <dt>Correlation ID</dt>
                              <dd>
                                {{
                                  entry.correlationId ||
                                    field(entry, 'correlation_id')
                                }}
                              </dd>
                              <dt>Order ID</dt>
                              <dd>
                                {{ entry.orderId || field(entry, 'order_id') }}
                              </dd>
                              <dt>Service</dt>
                              <dd>
                                {{ entry.service || field(entry, 'service') }}
                              </dd>
                              <dt>Trace ID</dt>
                              <dd>{{ entry.traceId || 'Not supplied' }}</dd>
                              <dt>Parse status</dt>
                              <dd>{{ entry.parseStatus || 'Parsed' }}</dd>
                              <dt>Evidence reference</dt>
                              <dd>
                                <code>{{
                                  entry.sourceRef || 'Unavailable'
                                }}</code>
                              </dd>
                            </dl>
                            @if (entry.raw || entry.fields) {
                              <h3>Raw entry</h3>
                              <pre>{{ rawText(entry) }}</pre>
                            }
                            <p>
                              Record navigation requires a destination from the
                              current DataTug project. These source values are
                              shown as evidence only.
                            </p>
                          </section>
                        }
                      </li>
                    }
                  </ol>
                }
              }
            </section>
          }
        }
      </main></ion-content
    >
  `,
  styles: `
    .page {
      max-width: 1000px;
      margin: 0 auto;
      padding: 20px 16px 56px;
    }
    section {
      margin: 24px 0;
    }
    h1 {
      font-size: clamp(25px, 4vw, 38px);
    }
    .card {
      padding: 16px;
      margin: 12px 0;
      border-radius: 12px;
      background: var(--ion-card-background, white);
      box-shadow: 0 1px 6px #00000012;
    }
    .account,
    .connection {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    article p {
      margin: 5px 0;
      overflow-wrap: anywhere;
      color: var(--ion-color-medium);
    }
    .revoke-confirm {
      max-width: 520px;
    }
    .inactive {
      opacity: 0.75;
    }
    label {
      display: grid;
      gap: 4px;
      margin: 12px 0;
      font-weight: 600;
    }
    form {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 10px;
    }
    form label {
      margin: 0;
    }
    .filter-note,
    form ion-button {
      grid-column: 1 / -1;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .error {
      color: var(--ion-color-danger);
    }
    .notice {
      padding: 12px;
      background: var(--ion-color-light);
      border-radius: 8px;
    }
    .view-name {
      overflow-wrap: anywhere;
      color: var(--ion-color-medium);
    }
    ol {
      list-style: none;
      padding: 0;
    }
    li {
      margin: 10px 0;
      background: var(--ion-background-color, white);
      border-radius: 8px;
    }
    .entry {
      display: grid;
      grid-template-columns: minmax(170px, 1fr) 100px minmax(130px, 1fr) minmax(
          180px,
          2fr
        );
      gap: 12px;
      width: 100%;
      padding: 12px;
      text-align: left;
      border: 0;
      background: transparent;
      color: inherit;
    }
    .details {
      padding: 12px;
    }
    dl {
      display: grid;
      grid-template-columns: 150px 1fr;
      gap: 6px 12px;
    }
    dt {
      font-weight: 700;
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      max-height: 320px;
      overflow: auto;
      padding: 12px;
      background: var(--ion-color-light);
    }
    code {
      overflow-wrap: anywhere;
    }
    @media (max-width: 700px) {
      .account,
      .connection {
        align-items: flex-start;
        flex-direction: column;
      }
      .entry {
        grid-template-columns: 1fr 90px;
      }
      .entry span:last-child {
        grid-column: 1 / -1;
      }
    }
  `,
})
export class CloudLogsPageComponent {
  private readonly api = inject(CloudLogsApiService);
  readonly pageState = signal<PageState>('loading');
  readonly pageError = signal('');
  readonly grants = signal<readonly GoogleLogGrant[]>([]);
  readonly connections = signal<readonly PersonalLogConnection[]>([]);
  readonly selectedGrantId = signal('');
  readonly projectId = signal('');
  readonly logViewId = signal('');
  readonly busy = signal(false);
  readonly busyGrantId = signal('');
  readonly busyConnectionId = signal('');
  readonly confirmGrantId = signal('');
  readonly notice = signal('');
  readonly selectedConnection = signal<PersonalLogConnection | null>(null);
  readonly queryState = signal<QueryState>('idle');
  readonly queryError = signal('');
  readonly entries = signal<readonly PersonalLogEntry[]>([]);
  readonly result = signal<PersonalLogQueryResult | null>(null);
  readonly selectedEntry = signal<PersonalLogEntry | null>(null);
  readonly fromTime = signal(defaultTime(24));
  readonly toTime = signal(defaultTime(0));
  readonly severity = signal('');
  readonly correlationId = signal('');
  readonly orderId = signal('');
  readonly service = signal('');
  readonly activeGrants = () =>
    this.grants().filter((grant) => grant.state === 'active');
  readonly canConnect = () =>
    !!this.selectedGrantId() &&
    !!this.projectId().trim() &&
    !!this.logViewId().trim() &&
    !this.busy();

  constructor() {
    const callback = this.scrubOAuthCallback();
    if (callback?.status === 'complete') {
      void this.finishAuthorization(callback.receipt);
    } else {
      void this.loadConnections();
    }
    if (callback?.status === 'failed') {
      this.clearFinishKey();
      this.notice.set(
        'Google account connection did not complete. You can try again.',
      );
    }
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  grantLabel(grant: GoogleLogGrant): string {
    if (grant.state === 'revocation_pending')
      return 'Disconnect requested. Google access cleanup is in progress.';
    if (grant.state === 'retired') return 'Disconnected';
    return `${this.connections().filter((connection) => connection.grantId === grant.id).length} connected log views`;
  }

  async loadConnections(): Promise<void> {
    this.pageState.set('loading');
    this.pageError.set('');
    try {
      const current = await firstValueFrom(this.api.list());
      this.grants.set(current.grants);
      this.connections.set(current.connections);
      if (
        !current.grants.some(
          (grant) =>
            grant.id === this.selectedGrantId() && grant.state === 'active',
        )
      )
        this.selectedGrantId.set(
          current.grants.find((grant) => grant.state === 'active')?.id ?? '',
        );
      this.pageState.set('ready');
    } catch (error) {
      this.pageError.set(errorMessage(error));
      this.pageState.set('error');
    }
  }

  async startAuthorization(): Promise<void> {
    this.busy.set(true);
    this.pageError.set('');
    try {
      const { authorizationUrl, finishKey } = await firstValueFrom(
        this.api.startGoogleAuthorization(),
      );
      let target: URL;
      try {
        target = new URL(authorizationUrl);
      } catch {
        throw new Error('The authorization link was invalid.');
      }
      if (
        target.protocol !== 'https:' ||
        target.hostname !== 'accounts.google.com'
      )
        throw new Error('The authorization link was invalid.');
      try {
        sessionStorage.setItem(finishKeyStorageKey, finishKey);
      } catch {
        throw new Error(
          'This browser could not securely keep the connection request for the redirect. Check session storage settings and try again.',
        );
      }
      window.location.assign(authorizationUrl);
    } catch (error) {
      this.pageError.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  /** Scrub the short-lived receipt before this page starts any API or telemetry work. */
  private scrubOAuthCallback():
    | { status: 'complete'; receipt: string }
    | { status: 'failed' }
    | undefined {
    const callback = window.__datatugTakeGoogleLogsReturn?.();
    if (!callback) return undefined;
    return callback.status === 'complete'
      ? { status: 'complete', receipt: callback.receipt }
      : { status: 'failed' };
  }

  private clearFinishKey(): void {
    try {
      sessionStorage.removeItem(finishKeyStorageKey);
    } catch {
      // Storage can be disabled by the browser; the key was never exposed to the URL.
    }
  }

  private async finishAuthorization(receipt: string): Promise<void> {
    let finishKey = '';
    try {
      finishKey = sessionStorage.getItem(finishKeyStorageKey) ?? '';
    } catch {
      // Treat unavailable tab storage as a failed or replayed return.
    }
    if (!receipt || !finishKey) {
      this.clearFinishKey();
      this.notice.set(
        'This Google connection request expired or was already used. Start again to connect the account.',
      );
      return;
    }
    try {
      const grant = await firstValueFrom(
        this.api.finishGoogleAuthorization({ receipt, finishKey }),
      );
      this.grants.update((grants) => [
        ...grants.filter((candidate) => candidate.id !== grant.id),
        grant,
      ]);
      this.selectedGrantId.set(grant.id);
      this.notice.set(`Connected Google account ${grant.email}.`);
    } catch (error) {
      this.notice.set(oauthFinishErrorMessage(error));
    } finally {
      this.clearFinishKey();
      await this.loadConnections();
    }
  }

  async connectView(): Promise<void> {
    if (!this.canConnect()) return;
    this.busy.set(true);
    this.pageError.set('');
    try {
      await firstValueFrom(
        this.api.connect({
          grantId: this.selectedGrantId(),
          projectId: this.projectId().trim(),
          logViewId: this.logViewId().trim(),
        }),
      );
      this.projectId.set('');
      this.logViewId.set('');
      await this.loadConnections();
    } catch (error) {
      this.pageError.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  selectConnection(connection: PersonalLogConnection): void {
    this.selectedConnection.set(connection);
    this.entries.set([]);
    this.result.set(null);
    this.queryState.set('idle');
    this.selectedEntry.set(null);
    this.orderId.set('');
    this.correlationId.set('');
    this.service.set('');
    this.severity.set('');
  }

  async removeView(connection: PersonalLogConnection): Promise<void> {
    this.busyConnectionId.set(connection.id);
    this.pageError.set('');
    try {
      await firstValueFrom(this.api.remove(connection.id));
      this.connections.update((connections) =>
        connections.filter((candidate) => candidate.id !== connection.id),
      );
      if (this.selectedConnection()?.id === connection.id)
        this.clearSelection();
    } catch (error) {
      this.pageError.set(errorMessage(error));
    } finally {
      this.busyConnectionId.set('');
    }
  }

  async disconnect(grant: GoogleLogGrant): Promise<void> {
    this.busyGrantId.set(grant.id);
    this.pageError.set('');
    try {
      const result = await firstValueFrom(this.api.disconnect(grant.id));
      this.confirmGrantId.set('');
      this.grants.update((grants) =>
        grants.map((candidate) =>
          candidate.id === grant.id
            ? { ...candidate, state: result.state }
            : candidate,
        ),
      );
      const removedIds = this.connections()
        .filter((connection) => connection.grantId === grant.id)
        .map((connection) => connection.id);
      this.connections.update((connections) =>
        connections.filter((connection) => connection.grantId !== grant.id),
      );
      const selectedConnection = this.selectedConnection();
      if (selectedConnection && removedIds.includes(selectedConnection.id))
        this.clearSelection();
      this.notice.set(
        result.state === 'retired'
          ? result.revocationConfirmed
            ? 'All views are disabled and Google confirmed access revocation.'
            : 'All views are disabled, but Google did not confirm grant revocation. Check Google Account connections; reconnecting is not guaranteed.'
          : 'All views for this account are disabled. Google access revocation is being completed.',
      );
    } catch (error) {
      this.pageError.set(errorMessage(error));
    } finally {
      this.busyGrantId.set('');
    }
  }

  async runQuery(event?: Event): Promise<void> {
    event?.preventDefault();
    const connection = this.selectedConnection();
    const from = toUtc(this.fromTime());
    const to = toUtc(this.toTime());
    if (!connection || !from || !to || Date.parse(to) < Date.parse(from)) {
      this.queryError.set('Enter a valid increasing UTC time range.');
      this.queryState.set('error');
      return;
    }
    if (
      [this.correlationId(), this.orderId(), this.service()].some((value) =>
        /[^\x20-\x7e]/.test(value.trim()),
      )
    ) {
      this.queryError.set(
        'Non-ASCII correlation, order and service filters are unsupported.',
      );
      this.queryState.set('error');
      return;
    }
    this.queryState.set('loading');
    this.queryError.set('');
    this.entries.set([]);
    this.selectedEntry.set(null);
    try {
      const response = await firstValueFrom(
        this.api.query({
          connectionId: connection.id,
          from,
          to,
          ...(this.severity() ? { severity: this.severity() } : {}),
          ...(this.correlationId().trim()
            ? { correlationId: this.correlationId().trim() }
            : {}),
          ...(this.orderId().trim() ? { orderId: this.orderId().trim() } : {}),
          ...(this.service().trim() ? { service: this.service().trim() } : {}),
        }),
      );
      this.entries.set(response.entries);
      this.result.set(response);
      this.queryState.set('ready');
    } catch (error) {
      this.queryError.set(errorMessage(error));
      this.queryState.set('error');
      if (
        errorCode(error) === 'reconnect_required' ||
        errorCode(error) === 'permission_denied'
      ) {
        this.connections.update((connections) =>
          connections.map((candidate) =>
            candidate.id === connection.id
              ? { ...candidate, active: false }
              : candidate,
          ),
        );
        this.selectedConnection.set({ ...connection, active: false });
      }
    }
  }

  toggleEntry(entry: PersonalLogEntry): void {
    this.selectedEntry.set(this.selectedEntry() === entry ? null : entry);
  }
  field(entry: PersonalLogEntry, key: string): string {
    if (entry.fields?.[key] != null) return String(entry.fields[key]);
    try {
      const raw =
        typeof entry.raw === 'string'
          ? (JSON.parse(entry.raw) as Record<string, unknown>)
          : (entry.raw as Record<string, unknown> | undefined);
      return String(raw?.[key] ?? 'Not supplied');
    } catch {
      return 'Not supplied';
    }
  }

  rawText(entry: PersonalLogEntry): string {
    if (typeof entry.raw === 'string') return entry.raw;
    const raw = entry.raw ?? entry.fields ?? {};
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return '[Entry details unavailable]';
    }
  }

  private clearSelection(): void {
    this.selectedConnection.set(null);
    this.entries.set([]);
    this.result.set(null);
    this.selectedEntry.set(null);
    this.queryState.set('idle');
  }
}

function defaultTime(hoursAgo: number): string {
  const date = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  date.setUTCSeconds(0, 0);
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function toUtc(value: string): string | undefined {
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)
  )
    return undefined;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : undefined;
}
function errorCode(error: unknown): PersonalLogErrorCode | undefined {
  if (error && typeof error === 'object' && 'code' in error)
    return (error as { code?: PersonalLogErrorCode }).code;
  return error instanceof HttpErrorResponse
    ? (error.error as { error?: PersonalLogErrorCode } | undefined)?.error
    : undefined;
}
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  switch (errorCode(error)) {
    case 'account_unavailable':
      return 'This Google account is being disconnected. Try again after cleanup finishes.';
    case 'reconnect_required':
      return 'Google access expired. Connect the account again to continue.';
    case 'permission_denied':
      return 'Google denied access to this log view. Check the account’s Cloud Logging access.';
    case 'unsupported_query':
      return 'The provider cannot preserve this query’s filter semantics. Narrow the time range or use ASCII correlation, order and service values.';
    case 'throttled':
      return 'Too many requests. Wait a moment and try again.';
    case 'invalid_request':
      return 'Check the project, log view and filters, then try again.';
    case 'unauthorized':
      return 'Your DataTug session expired. Sign in again to continue.';
    case 'not_found':
      return 'This connection is no longer available. Refresh the connection list.';
    default:
      return 'The Cloud Logging request failed. Try again shortly.';
  }
}

function oauthFinishErrorMessage(error: unknown): string {
  if (
    errorCode(error) === 'invalid_request' ||
    errorCode(error) === 'not_found'
  )
    return 'This Google connection request expired or was already used. Start again to connect the account.';
  if (errorCode(error) === 'unauthorized')
    return 'Your DataTug session expired before Google account setup finished. Sign in and start again.';
  return 'Google account connection could not be completed. Start again to connect the account.';
}
