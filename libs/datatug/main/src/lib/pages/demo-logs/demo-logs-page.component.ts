// A mapped presentation of ordinary OVDB query results. The server and wire
// protocol do not know this collection contains logs.
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IonBackButton, IonButtons, IonContent, IonHeader, IonMenuButton,
  IonTitle, IonToolbar,
} from '@ionic/angular';
import { fetchOvdbDescriptor, type OvdbConnection } from '../../ovdb/ovdb-connection';
import { ovdbDatabase, type OvdbRow } from '../../ovdb/ovdb-records';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type Filter = { readonly field: string; readonly operator: '==' | '>=' | '<='; readonly value: string };
type AppliedQuery = { readonly baseUrl: string; readonly databaseId: string; readonly collection: string; readonly orderId: string };

@Component({
  selector: 'sneat-datatug-demo-logs-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IonBackButton, IonButtons, IonContent, IonHeader, IonMenuButton, IonTitle, IonToolbar],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-menu-button /><ion-back-button defaultHref="/demo" /></ion-buttons>
      <ion-title>Log evidence · timeline</ion-title>
    </ion-toolbar></ion-header>
    <ion-content color="light">
      <main class="evidence-page">
        <header class="evidence-heading">
          @if (isNorthwindSource()) {
            <p class="eyebrow">Northwind investigation · synthetic log evidence</p>
            @if (applied()!.orderId) { <h1>Why did order {{ applied()!.orderId }} remain unshipped?</h1> }
            @else { <h1>Northwind order evidence</h1> }
            <p>The database record is real. These log entries are a deterministic synthetic scenario for investigating it.</p>
            @if (applied()!.orderId) { <a [routerLink]="['/demo', 'sqlite', 'northwind', 'table', 'Orders']" [queryParams]="{ record: applied()!.orderId }">Open the order record</a> }
          } @else {
            <p class="eyebrow">Evidence from an OVDB collection</p>
            <h1>Log evidence timeline</h1>
            @if (applied(); as query) { <p>Showing results from {{ query.databaseId }} / {{ query.collection }}{{ query.orderId ? ' for order ' + query.orderId : '' }}.</p> }
          }
        </header>

        <form class="evidence-filters" (submit)="load($event)" aria-label="Log evidence filters">
          <details class="source-settings"><summary>Source connection · {{ databaseId() }} / {{ collection() }}</summary>
            <div class="source-controls">
              <label>OVDB URL <input [value]="baseUrl()" (input)="baseUrl.set(inputValue($event))" autocomplete="url" /></label>
              <label>Database <input [value]="databaseId()" (input)="databaseId.set(inputValue($event))" /></label>
              <label>Collection <input [value]="collection()" (input)="collection.set(inputValue($event))" /></label>
              <label>Local owner token (optional) <input type="password" [value]="ownerToken()" (input)="ownerToken.set(inputValue($event))" autocomplete="off" /></label>
            </div>
          </details>
          <label>Order ID <input [value]="orderId()" (input)="orderId.set(inputValue($event))" /></label>
          <label>Correlation ID <input [value]="correlationId()" (input)="correlationId.set(inputValue($event))" /></label>
          <label>From (RFC3339 UTC) <input [value]="fromTime()" (input)="fromTime.set(inputValue($event))" /></label>
          <label>To (RFC3339 UTC) <input [value]="toTime()" (input)="toTime.set(inputValue($event))" /></label>
          <label>Severity
            <select [value]="severity()" (change)="severity.set(inputValue($event))">
              <option value="">All</option><option>DEBUG</option><option>INFO</option><option>WARN</option><option>WARNING</option><option>ERROR</option>
            </select>
          </label>
          <label class="untimed"><input type="checkbox" [checked]="includeUntimed()" (change)="includeUntimed.set(checked($event))" /> Include untimed or malformed entries (file source only; ignores time range)</label>
          <button type="submit" [disabled]="state() === 'loading'">{{ state() === 'loading' ? 'Loading…' : 'Find evidence' }}</button>
          <p class="filter-note">Exact order ID, correlation ID and severity; inclusive time range unless the untimed control is selected. Use WARN for file entries and WARNING for Cloud Logging. Text search and regex are unavailable. Showing at most 100 newest entries. Edits take effect when you select Find evidence. The optional token stays in this page's memory and is sent only to a loopback server.</p>
        </form>

        @if (state() === 'loading') { <p role="status">Reading the configured source…</p> }
        @if (state() === 'error') { <p role="alert" class="error">{{ error() }}</p> }
        @if (state() === 'ready' && rows().length === 0) { <p role="status">No entries matched this bounded query.</p> }
        @if (state() === 'ready' && rows().length > 0) {
          <p role="status">{{ rows().length }} entries{{ rows().length === 100 ? ' · result limit reached' : '' }}</p>
          <ol class="timeline">
            @for (row of rows(); track row.key) {
              <li [class.malformed]="status(row) !== 'parsed'">
                <button type="button" class="entry" (click)="selectedKey.set(selectedKey() === row.key ? '' : row.key)" [attr.aria-expanded]="selectedKey() === row.key">
                  <time>{{ text(row, 'timestamp') || 'Time unavailable' }}</time>
                  <strong [class.error]="text(row, 'severity') === 'ERROR'">{{ text(row, 'severity') || 'UNKNOWN' }}</strong>
                  <span>{{ text(row, 'service') || text(row, 'source') || 'Source unavailable' }}</span>
                  <span class="message">{{ text(row, 'message') || 'Unparsed entry' }}</span>
                </button>
                @if (selectedKey() === row.key) {
                  <section class="entry-details" aria-label="Entry details">
                    <dl>
                      <dt>Parse status</dt><dd>{{ status(row) }}</dd>
                      <dt>Correlation</dt><dd>{{ text(row, 'correlation_id') || 'Not supplied' }}</dd>
                      <dt>Order</dt><dd>{{ text(row, 'order_id') || 'Not supplied' }}</dd>
                      <dt>Reference</dt><dd><code>{{ text(row, 'source_ref') }}</code></dd>
                    </dl>
                    @if (isNorthwindSource() && text(row, 'order_id')) {
                      <a [routerLink]="['/demo', 'sqlite', 'northwind', 'table', 'Orders']" [queryParams]="{ record: text(row, 'order_id') }">Open related order {{ text(row, 'order_id') }}</a>
                    }
                    <button type="button" (click)="copyReference(row)">Copy evidence reference</button>
                    <h3>{{ text(row, 'parser') === 'google-cloud-logging' ? 'Provider entry (SDK reconstruction)' : 'Original file entry' }}</h3><pre>{{ text(row, 'raw') }}</pre>
                    @if (text(row, 'fields_json')) { <h3>Structured fields</h3><pre>{{ text(row, 'fields_json') }}</pre> }
                  </section>
                }
              </li>
            }
          </ol>
        }
      </main>
    </ion-content>
  `,
  styles: `
    .evidence-page { max-width: 1120px; margin: 0 auto; padding: 20px 16px 64px; color: var(--ion-text-color); }
    .evidence-heading { border-left: 4px solid var(--ion-color-primary); padding-left: 20px; margin-bottom: 18px; }
    .eyebrow { text-transform: uppercase; letter-spacing: .12em; font-size: 12px; font-weight: 700; color: var(--ion-color-medium); }
    h1 { font-size: clamp(24px, 4vw, 40px); margin: 6px 0 10px; }
    .evidence-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; background: var(--ion-card-background, white); padding: 16px; border-radius: 12px; margin-bottom: 16px; }
    .source-settings { grid-column: 1 / -1; border-bottom: 1px solid var(--ion-color-light-shade); padding-bottom: 8px; }
    .source-settings summary { cursor: pointer; font-size: 13px; font-weight: 700; }
    .source-controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; padding-top: 12px; }
    label { display: grid; gap: 4px; font-size: 13px; font-weight: 600; }
    label.untimed { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; }
    .untimed input { min-height: auto; }
    input, select, button { font: inherit; min-height: 38px; border: 1px solid var(--ion-color-medium-tint); border-radius: 6px; padding: 6px 9px; background: var(--ion-background-color, white); color: var(--ion-text-color); }
    button { cursor: pointer; } button:focus-visible, a:focus-visible { outline: 3px solid var(--ion-color-primary); outline-offset: 2px; }
    .filter-note { grid-column: 1 / -1; margin: 0; font-size: 13px; color: var(--ion-color-medium); }
    .timeline { list-style: none; padding: 0; border-left: 2px solid var(--ion-color-medium-tint); margin-left: 12px; }
    .timeline li { margin: 0 0 12px 16px; border-radius: 10px; background: var(--ion-card-background, white); box-shadow: 0 1px 6px rgba(0,0,0,.08); }
    .timeline li.malformed { border-left: 4px solid var(--ion-color-warning); }
    .entry { display: grid; grid-template-columns: minmax(150px, 1fr) 80px minmax(120px, 1fr) minmax(200px, 2fr); width: 100%; text-align: left; gap: 12px; border: 0; padding: 14px; }
    .entry time, .entry strong { font-variant-numeric: tabular-nums; }
    .entry-details { padding: 4px 16px 18px; border-top: 1px solid var(--ion-color-light-shade); }
    dl { display: grid; grid-template-columns: 130px 1fr; gap: 6px 12px; } dt { font-weight: 700; } dd { margin: 0; overflow-wrap: anywhere; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 300px; overflow: auto; padding: 12px; background: var(--ion-color-light); border-radius: 6px; }
    .error { color: var(--ion-color-danger); }
    @media (max-width: 700px) { .entry { grid-template-columns: 1fr 80px; } .message { grid-column: 1 / -1; } }
  `,
})
export class DemoLogsPageComponent {
  private readonly route = inject(ActivatedRoute);
  readonly baseUrl = signal('http://127.0.0.1:6832');
  readonly databaseId = signal('northwind_evidence');
  readonly collection = signal('fulfillment_events');
  readonly ownerToken = signal('');
  readonly orderId = signal(this.route.snapshot.queryParamMap.get('order') ?? '11039');
  readonly correlationId = signal('');
  readonly fromTime = signal('2018-04-21T09:12:00Z');
  readonly toTime = signal('2018-04-21T09:14:00Z');
  readonly severity = signal('');
  readonly includeUntimed = signal(false);
  readonly state = signal<LoadState>('idle');
  readonly error = signal('');
  readonly rows = signal<readonly OvdbRow[]>([]);
  readonly applied = signal<AppliedQuery | null>(null);
  readonly selectedKey = signal('');
  #request = 0;

  constructor() { void this.load(); }

  inputValue(event: Event): string { return (event.target as HTMLInputElement).value; }
  checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
  text(row: OvdbRow, field: string): string { const value = row.data[field]; return value == null ? '' : String(value); }
  status(row: OvdbRow): string { return this.text(row, 'parse_status') || 'parsed'; }
  isNorthwindSource(): boolean {
    const query = this.applied();
    return query?.baseUrl === 'http://127.0.0.1:6832' && query.databaseId === 'northwind_evidence' && ['fulfillment_events', 'carrier_events'].includes(query.collection);
  }

  private sourceFetch(baseUrl: string): typeof globalThis.fetch {
    const token = this.ownerToken();
    if (!token) return globalThis.fetch.bind(globalThis);
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('A local owner token can only be used with an HTTP loopback source.');
    }
    return (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${token}`);
      return globalThis.fetch(input, { ...init, headers, redirect: 'error' });
    };
  }

  async load(event?: Event): Promise<void> {
    event?.preventDefault();
    const request = ++this.#request;
    this.error.set('');
    const from = this.fromTime();
    const to = this.toTime();
    const includeUntimed = this.includeUntimed();
    const orderId = this.orderId().trim();
    const correlationId = this.correlationId().trim();
    const severity = this.severity();
    const baseUrl = this.baseUrl().trim();
    const databaseId = this.databaseId().trim();
    const collection = this.collection().trim();
    if (!includeUntimed && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(from) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(to) || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(to) < Date.parse(from))) {
      this.error.set('Enter a valid increasing RFC3339 time range.');
      this.state.set('error');
      return;
    }
    this.state.set('loading');
    this.rows.set([]);
    this.applied.set(null);
    try {
      const sourceFetch = this.sourceFetch(baseUrl);
      const descriptor = await fetchOvdbDescriptor(sourceFetch, baseUrl, databaseId);
      if (!descriptor.collections?.includes(collection) || descriptor.capabilities.query !== true) {
        throw new Error('The selected collection is unavailable for ordinary OVDB queries.');
      }
      const connection: OvdbConnection = { id: databaseId, title: databaseId, baseUrl, databaseId, fetch: sourceFetch, descriptor };
      const filters: Filter[] = includeUntimed ? [] : [
        { field: 'timestamp', operator: '>=', value: from },
        { field: 'timestamp', operator: '<=', value: to },
      ];
      if (orderId) filters.push({ field: 'order_id', operator: '==', value: orderId });
      if (correlationId) filters.push({ field: 'correlation_id', operator: '==', value: correlationId });
      if (severity) filters.push({ field: 'severity', operator: '==', value: severity });
      const result = await ovdbDatabase(connection).query<Record<string, unknown>>({
        source: { kind: 'collection', name: collection }, filters,
        orders: [{ field: 'timestamp', direction: 'desc' }], limit: 100,
      });
      if (request !== this.#request) return;
      this.rows.set(result.records.map((record) => ({ key: record.key.path, data: record.data ?? {} })));
      this.applied.set({ baseUrl, databaseId, collection, orderId });
      this.state.set('ready');
    } catch (error) {
      if (request !== this.#request) return;
      this.error.set(error instanceof Error ? error.message : 'The source could not be queried.');
      this.state.set('error');
    }
  }

  async copyReference(row: OvdbRow): Promise<void> {
    try { await navigator.clipboard.writeText(this.text(row, 'source_ref')); }
    catch { this.error.set('Clipboard access is unavailable; select the reference text to copy it.'); }
  }
}
