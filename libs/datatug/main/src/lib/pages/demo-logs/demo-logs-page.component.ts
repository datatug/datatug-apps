import { DEMO_LOG_SOURCE_ADAPTER, type AppliedLogQuery } from './demo-log-source-adapter';
// A mapped presentation of ordinary OVDB query results. The server and wire
// protocol do not know this collection contains logs.
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AgGridReadyDirective } from '@datatug/ag-grid';
import { AgGridAngular } from 'ag-grid-angular';
import type { CellKeyDownEvent, FullWidthCellKeyDownEvent, ColDef, GridReadyEvent, SelectionChangedEvent } from 'ag-grid-community';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  IonBackButton, IonButtons, IonContent, IonHeader, IonMenuButton,
  IonTitle, IonToolbar,
} from '@ionic/angular';
import { fetchOvdbDescriptor, type OvdbConnection } from '../../ovdb/ovdb-connection';
import { ovdbDatabase, type OvdbRow } from '../../ovdb/ovdb-records';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type Filter = { readonly field: string; readonly operator: '==' | '>=' | '<='; readonly value: string };

@Component({
  selector: 'sneat-datatug-demo-logs-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AgGridAngular, AgGridReadyDirective, RouterLink, IonBackButton, IonButtons, IonContent, IonHeader, IonMenuButton, IonTitle, IonToolbar],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-menu-button /><ion-back-button defaultHref="/demo" /></ion-buttons>
      <ion-title>Log evidence · timeline</ion-title>
    </ion-toolbar></ion-header>
    <ion-content color="light">
      <main class="evidence-page">
        <header class="evidence-heading">
          <p class="eyebrow">{{ heading().eyebrow }}</p>
          <h1>{{ heading().title }}</h1>
          <p>{{ heading().description }}</p>
          @if (recordLink(); as link) {
            <a [routerLink]="link.commands" [queryParams]="link.queryParams">{{ link.label }}</a>
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
          <label>{{ adapter.identifier.label }} <input [value]="identifier()" (input)="identifier.set(inputValue($event))" /></label>
          <label>Correlation ID <input [value]="correlationId()" (input)="correlationId.set(inputValue($event))" /></label>
          <label>From (RFC3339 UTC) <input [value]="fromTime()" (input)="fromTime.set(inputValue($event))" /></label>
          <label>To (RFC3339 UTC) <input [value]="toTime()" (input)="toTime.set(inputValue($event))" /></label>
          <label>Severity
            <select [value]="severity()" (change)="severity.set(inputValue($event))">
              <option value="">All</option><option>DEBUG</option><option>INFO</option><option>WARN</option><option>WARNING</option><option>ERROR</option>
            </select>
          </label>
          <label class="untimed"><input type="checkbox" [checked]="includeUntimed()" (change)="includeUntimed.set(checked($event))" /> Include untimed or malformed entries (file source only; ignores time range)</label>
          @if (includeUntimed() && (identifier().trim() || correlationId().trim())) {
            <p class="filter-note" role="note">
              Identifier, correlation, and severity filters still apply. Malformed
              entries may not contain those fields. Clear the IDs and select
              All severity to include entries without those fields.
            </p>
            <button type="button" (click)="clearIdentifierFilters()">
              Clear identifier and correlation filters
            </button>
          }
          <button type="submit" [disabled]="state() === 'loading'">{{ state() === 'loading' ? 'Loading…' : 'Find evidence' }}</button>
          <p class="filter-note">File identifiers and severity use exact equality; Cloud Logging uses provider case-insensitive equality for identifiers. The time range is inclusive unless the untimed control is selected. Use WARN for file entries and WARNING for Cloud Logging. Text search and regex are unavailable. Showing at most 100 newest entries. Edits take effect when you select Find evidence. The optional token stays in this page's memory and is sent only to a loopback server.</p>
        </form>

        @if (state() === 'loading') { <p role="status">Reading the configured source…</p> }
        @if (error()) { <p role="alert" class="error">{{ error() }}</p> }
        @if (state() === 'ready' && rows().length === 0) { <p role="status">No entries matched this bounded query.</p> }
        @if (state() === 'ready' && rows().length > 0) {
          <p role="status">{{ rows().length }} entries{{ rows().length === 100 ? ' · result limit reached' : '' }}</p>
          <p id="log-grid-help">Newest entries first. Select a row, or focus a cell and press Enter or Space, to inspect its evidence.</p>
          <ag-grid-angular *datatugAgGridReady class="log-grid"
            [rowData]="gridRows()" [columnDefs]="columns" [defaultColDef]="defaultColumn"
            [rowSelection]="{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }"
            (gridReady)="nameGrid($event)" (selectionChanged)="selectionChanged($event)" (cellKeyDown)="activateEntry($event)" />
          @if (selectedRow(); as row) {
                  <section class="entry-details" aria-label="Entry details">
                    <dl>
                      <dt>Parse status</dt><dd>{{ status(row) }}</dd>
                      @for (field of adapter.detailFields; track field.field) {
                        <dt>{{ field.label }}</dt><dd>{{ text(row, field.field) || 'Not supplied' }}</dd>
                      }
                      <dt>Reference</dt><dd><code>{{ text(row, 'source_ref') }}</code></dd>
                    </dl>
                    @if (relatedRecord(row); as link) {
                      <a [routerLink]="link.commands" [queryParams]="link.queryParams">{{ link.label }}</a>
                    }
                    <button type="button" (click)="copyReference(row)">Copy evidence reference</button>
                    <h3>{{ adapter.originalLabel(text(row, 'parser')) }}</h3><pre>{{ text(row, 'raw') }}</pre>
                    @if (text(row, 'fields_json')) { <h3>Structured fields</h3><pre>{{ text(row, 'fields_json') }}</pre> }
                  </section>
          }

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
    .log-grid { display: block; height: 420px; width: 100%; min-width: 0; }
    .entry-details { padding: 4px 16px 18px; border-top: 1px solid var(--ion-color-light-shade); }
    dl { display: grid; grid-template-columns: 130px 1fr; gap: 6px 12px; } dt { font-weight: 700; } dd { margin: 0; overflow-wrap: anywhere; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 300px; overflow: auto; padding: 12px; background: var(--ion-color-light); border-radius: 6px; }
    .error { color: var(--ion-color-danger); }

  `,
})
export class DemoLogsPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly adapter = inject(DEMO_LOG_SOURCE_ADAPTER);
  readonly baseUrl = signal(this.adapter.defaults.baseUrl);
  readonly databaseId = signal(this.adapter.defaults.databaseId);
  readonly collection = signal(this.adapter.defaults.collection);
  readonly ownerToken = signal('');
  readonly identifier = signal(this.route.snapshot.queryParamMap.get(this.adapter.identifier.queryParam) ?? this.adapter.defaults.identifier);
  readonly correlationId = signal('');
  readonly fromTime = signal(this.adapter.defaults.from);
  readonly toTime = signal(this.adapter.defaults.to);
  readonly severity = signal('');
  readonly includeUntimed = signal(false);
  readonly state = signal<LoadState>('idle');
  readonly error = signal('');
  readonly rows = signal<readonly OvdbRow[]>([]);
  readonly applied = signal<AppliedLogQuery | null>(null);
  readonly selectedKey = signal('');
  readonly gridRows = computed(() => this.rows().map(row => ({ ...row, ...Object.fromEntries(['timestamp', 'severity', 'service', 'source', 'message'].map(field => [field, this.text(row, field) || ({ timestamp: 'Time unavailable', severity: 'UNKNOWN', source: 'Source unavailable', message: 'Unparsed entry' } as Record<string, string>)[field] || ''])) })));
  readonly selectedRow = computed(() => this.rows().find(row => row.key === this.selectedKey()));
  readonly defaultColumn: ColDef = { resizable: true, sortable: false, minWidth: 120 };
  readonly columns: ColDef[] = [
    { field: 'timestamp', headerName: 'Timestamp', width: 210 },
    { field: 'severity', headerName: 'Severity', width: 110, minWidth: 100 },
    { field: 'service', headerName: 'Service', width: 160 },
    { field: 'source', headerName: 'Source', width: 160 },
    { field: 'message', headerName: 'Message', minWidth: 280, flex: 1, wrapText: true, autoHeight: true },
  ];
  nameGrid(event: GridReadyEvent): void {
    event.api.setGridAriaProperty('label', 'Log evidence entries');
    event.api.setGridAriaProperty('describedby', 'log-grid-help');
  }
  selectionChanged(event: SelectionChangedEvent): void {
    this.selectedKey.set(event.api.getSelectedRows()[0]?.key ?? '');
  }
  activateEntry(event: CellKeyDownEvent | FullWidthCellKeyDownEvent): void {
    if (event.event instanceof KeyboardEvent && event.event.key === 'Enter') {
      event.event.preventDefault();
      event.node.setSelected(true);
    }
  }
  #request = 0;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const identifier = params.get(this.adapter.identifier.queryParam) ?? this.adapter.defaults.identifier;
      if (this.applied()?.identifier === identifier) return;
      this.identifier.set(identifier);
      void this.load();
    });
  }

  inputValue(event: Event): string { return (event.target as HTMLInputElement).value; }
  checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
  clearIdentifierFilters(): void {
    this.identifier.set('');
    this.correlationId.set('');
  }
  text(row: OvdbRow, field: string): string { const value = row.data[field]; return value == null ? '' : String(value); }
  status(row: OvdbRow): string { return this.text(row, 'parse_status') || 'parsed'; }
  readonly heading = computed(() => this.adapter.heading(this.applied()));
  readonly recordLink = computed(() => {
    const query = this.applied();
    return query ? this.adapter.relatedRecord(query, query.identifier, 'context') : undefined;
  });
  relatedRecord(row: OvdbRow) {
    const query = this.applied();
    return query ? this.adapter.relatedRecord(query, this.text(row, this.adapter.identifier.field)) : undefined;
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
    if (event) {
      const submittedIdentifier = this.identifier().trim();
      const routeIdentifier = this.route.snapshot.queryParamMap.get(this.adapter.identifier.queryParam) ?? this.adapter.defaults.identifier;
      if (submittedIdentifier !== routeIdentifier) {
        try {
          const navigated = await this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { [this.adapter.identifier.queryParam]: submittedIdentifier },
            queryParamsHandling: 'merge',
          });
          if (!navigated) throw new Error('The identifier URL could not be updated.');
        } catch (error) {
          this.error.set(error instanceof Error ? error.message : 'The identifier URL could not be updated.');
          this.state.set('error');
        }
        return;
      }
    }
    const request = ++this.#request;
    this.error.set('');
    const from = this.fromTime();
    const to = this.toTime();
    const includeUntimed = this.includeUntimed();
    const identifier = this.identifier().trim();
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
    this.selectedKey.set('');
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
      if (identifier) filters.push({ field: this.adapter.identifier.field, operator: '==', value: identifier });
      if (correlationId) filters.push({ field: 'correlation_id', operator: '==', value: correlationId });
      if (severity) filters.push({ field: 'severity', operator: '==', value: severity });
      const result = await ovdbDatabase(connection).query<Record<string, unknown>>({
        source: { kind: 'collection', name: collection }, filters,
        orders: [{ field: 'timestamp', direction: 'desc' }], limit: 100,
      });
      if (request !== this.#request) return;
      this.rows.set(result.records.map((record) => ({ key: record.key.path, data: record.data ?? {} })));
      this.applied.set({ baseUrl, databaseId, collection, identifier });
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
