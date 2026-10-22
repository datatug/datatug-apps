// A mapped presentation of ordinary OVDB query results. The server and wire protocol do not know
// a collection contains logs: the project's declared log sources (log-source-declarations.ts) say
// which collections are logs and which field plays which role.
//
//   /demo/logs?source=<id>&collection=<id>&from=<Z>&to=<Z>&<identifier param>=<value>
//     declared mode: only declared sources and collections are read; without `source`, the first
//     declared source opens.
//   Source settings → "Read this source": ad hoc mode, a typed OVDB address (for example the local
//     agent at http://127.0.0.1:6832) with the fixed default field mapping. Never started from a URL.
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AgGridReadyDirective } from '@datatug/ag-grid';
import { AgGridAngular } from 'ag-grid-angular';
import type { CellKeyDownEvent, FullWidthCellKeyDownEvent, ColDef, GridReadyEvent, SelectionChangedEvent } from 'ag-grid-community';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink, type ParamMap } from '@angular/router';
import {
  IonBackButton, IonButtons, IonContent, IonHeader, IonMenuButton,
  IonTitle, IonToolbar,
} from '@ionic/angular';
import { fetchOvdbDescriptor, type OvdbConnection } from '../../ovdb/ovdb-connection';
import { ovdbDatabase, type OvdbRow } from '../../ovdb/ovdb-records';
import { LogSourceCatalogService } from './log-source-catalog.service';
import {
  DEFAULT_LOG_FIELDS, DEFAULT_LOG_IDENTIFIERS, RFC3339_UTC, identifierValue, recordRoute,
  type LogFields, type LogIdentifier, type LogRecordMapping, type LogRole, type LogSource,
} from './log-source-declarations';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type Filter = { readonly field: string; readonly operator: '==' | '>=' | '<='; readonly value: string | number };

/** What a read is about to show, or showed. */
interface LogView {
  readonly mode: 'declared' | 'adhoc';
  readonly sourceId?: string;
  readonly title: string;
  readonly synthetic: boolean;
  readonly baseUrl: string;
  readonly databaseId: string;
  readonly collection: string;
  readonly collectionTitle: string;
  readonly fields: LogFields;
  readonly identifiers: readonly LogIdentifier[];
  readonly records: readonly LogRecordMapping[];
}
interface AppliedQuery extends LogView { readonly values: Readonly<Record<string, string>> }

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

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
          @for (link of contextRecordLinks(); track link.label) {
            <a [routerLink]="link.commands" [queryParams]="link.queryParams">{{ link.label }}</a>
          }
        </header>

        <form class="evidence-filters" (submit)="submit($event)" aria-label="Log evidence filters">
          @if (sources().length) {
            <label>Log source
              <select [value]="sourceId()" (change)="pickSource(inputValue($event))">
                @for (source of sources(); track source.id) { <option [value]="source.id">{{ source.title }}</option> }
              </select>
            </label>
            @if (declaredSource(); as source) {
              <label>Collection
                <select [value]="collectionId()" (change)="collectionId.set(inputValue($event))">
                  @for (collection of source.collections; track collection.id) {
                    <option [value]="collection.id">{{ collection.title }}{{ unavailable().includes(collection.id) ? ' (not available yet)' : '' }}</option>
                  }
                </select>
              </label>
            }
          }
          @for (identifier of view()?.identifiers ?? []; track identifier.param) {
            <label>{{ identifier.label }}
              <input [value]="values()[identifier.param] ?? ''" (input)="setValue(identifier.param, inputValue($event))"
                [attr.inputmode]="identifier.type === 'integer' ? 'numeric' : null" />
            </label>
          }
          @if (view()?.fields?.correlation) {
            <label>Correlation ID <input [value]="correlationId()" (input)="correlationId.set(inputValue($event))" /></label>
          }
          <label>From (RFC3339 UTC) <input [value]="fromTime()" (input)="fromTime.set(inputValue($event))" /></label>
          <label>To (RFC3339 UTC) <input [value]="toTime()" (input)="toTime.set(inputValue($event))" /></label>
          @if (view()?.fields?.severity) {
            <label>Severity
              <select [value]="severity()" (change)="severity.set(inputValue($event))">
                <option value="">All</option><option>DEBUG</option><option>INFO</option><option>WARN</option><option>WARNING</option><option>ERROR</option>
              </select>
            </label>
          }
          @if (view()?.fields?.parseStatus) {
            <label class="untimed"><input type="checkbox" [checked]="includeUntimed()" (change)="includeUntimed.set(checked($event))" /> Include untimed or malformed entries (ignores the time range)</label>
            @if (includeUntimed() && hasIdentityFilters()) {
              <p class="filter-note" role="note">
                {{ retainedFilterLabels() }} filters still apply. Malformed
                entries may not contain those fields. Clear the IDs and select
                All severity to include entries without those fields.
              </p>
              <button type="button" (click)="clearIdentifierFilters()">
                Clear identifier and correlation filters
              </button>
            }
          }
          <button type="submit" [disabled]="state() === 'loading' || !view()">{{ state() === 'loading' ? 'Loading…' : 'Find evidence' }}</button>
          <p class="filter-note">Identifiers use exact equality and the time range is inclusive. Text search and regex are unavailable. Showing at most 100 newest entries. Edits take effect when you select Find evidence.</p>

          <details class="source-settings"><summary>Source settings · {{ settingsSummary() }}</summary>
            <p class="filter-note">Read another OVDB collection, for example a local agent at http://127.0.0.1:6832. It uses the default log field names and is labelled ad hoc. The optional token stays in this page's memory and is sent only to a loopback server.</p>
            <div class="source-controls">
              <label>OVDB URL <input [value]="baseUrl()" (input)="baseUrl.set(inputValue($event))" autocomplete="url" placeholder="http://127.0.0.1:6832" /></label>
              <label>Database <input [value]="databaseId()" (input)="databaseId.set(inputValue($event))" /></label>
              <label>Collection <input [value]="adhocCollection()" (input)="adhocCollection.set(inputValue($event))" /></label>
              <label>Local owner token (optional) <input type="password" [value]="ownerToken()" (input)="ownerToken.set(inputValue($event))" autocomplete="off" /></label>
              <button type="button" (click)="readAdhoc()">Read this source</button>
            </div>
          </details>
        </form>

        @if (state() === 'loading') { <p role="status">Reading the source in place…</p> }
        @if (error()) { <p role="alert" class="error">{{ error() }}</p> }
        @if (state() === 'ready' && rows().length === 0) { <p role="status">No entries matched this bounded query.</p> }
        @if (state() === 'ready' && rows().length > 0) {
          <p role="status">{{ rows().length }} entries{{ rows().length === 100 ? ' · result limit reached' : '' }}</p>
          <p id="log-grid-help">Newest entries first. Select a row, or focus a cell and press Enter or Space, to inspect its evidence.</p>
          <ag-grid-angular *datatugAgGridReady class="log-grid" [class.fixed-height]="rows().length > autoHeightRows"
            [domLayout]="rows().length > autoHeightRows ? 'normal' : 'autoHeight'"
            [rowData]="gridRows()" [columnDefs]="columns()" [defaultColDef]="defaultColumn"
            [rowSelection]="{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }"
            (gridReady)="nameGrid($event)" (selectionChanged)="selectionChanged($event)" (cellKeyDown)="activateEntry($event)" />
          @if (selectedRow(); as row) {
            <section class="entry-details" aria-label="Entry details">
              <dl>
                @if (applied()?.fields?.parseStatus) { <dt>Parse status</dt><dd>{{ status(row) }}</dd> }
                @for (identifier of applied()?.identifiers ?? []; track identifier.param) {
                  <dt>{{ identifier.label }}</dt><dd>{{ text(row, identifier.field) || 'Not supplied' }}</dd>
                }
                @if (applied()?.fields?.correlation; as field) { <dt>Correlation</dt><dd>{{ text(row, field) || 'Not supplied' }}</dd> }
                <dt>Record key</dt><dd><code>{{ row.key }}</code></dd>
                @if (applied()?.fields?.reference; as field) { <dt>Reference</dt><dd><code>{{ text(row, field) }}</code></dd> }
              </dl>
              @for (link of rowRecordLinks(row); track link.label) {
                <a [routerLink]="link.commands" [queryParams]="link.queryParams">{{ link.label }}</a>
              }
              @if (applied()?.fields?.reference) {
                <button type="button" (click)="copyReference(row)">Copy evidence reference</button>
              }
              @if (applied()?.fields?.raw; as field) {
                <h3>Original entry{{ parserName(row) ? ' · ' + parserName(row) : '' }}</h3><pre>{{ text(row, field) }}</pre>
              } @else {
                <h3>Stored record (the source keeps no original log line)</h3><pre>{{ json(row) }}</pre>
              }
              @if (applied()?.fields?.structured; as field) {
                @if (text(row, field)) { <h3>Structured fields</h3><pre>{{ text(row, field) }}</pre> }
              }
            </section>
          }
        }
      </main>
    </ion-content>
  `,
  styles: `
    .evidence-page { max-width: 1120px; margin: 0 auto; padding: 20px 16px 64px; color: var(--ion-text-color); }
    .evidence-heading { border-left: 4px solid var(--ion-color-primary); padding-left: 20px; margin-bottom: 18px; }
    .evidence-heading a { display: inline-block; margin-right: 16px; }
    .eyebrow { text-transform: uppercase; letter-spacing: .12em; font-size: 12px; font-weight: 700; color: var(--ion-color-medium); }
    h1 { font-size: clamp(24px, 4vw, 40px); margin: 6px 0 10px; overflow-wrap: anywhere; }
    .evidence-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; background: var(--ion-card-background, white); padding: 16px; border-radius: 12px; margin-bottom: 16px; }
    .source-settings { grid-column: 1 / -1; border-top: 1px solid var(--ion-color-light-shade); padding-top: 8px; }
    .source-settings summary { cursor: pointer; font-size: 13px; font-weight: 700; overflow-wrap: anywhere; }
    .source-controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; padding-top: 12px; align-items: end; }
    label { display: grid; gap: 4px; font-size: 13px; font-weight: 600; }
    label.untimed { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; }
    .untimed input { min-height: auto; }
    input, select, button { font: inherit; min-height: 38px; border: 1px solid var(--ion-color-medium-tint); border-radius: 6px; padding: 6px 9px; background: var(--ion-background-color, white); color: var(--ion-text-color); min-width: 0; }
    button { cursor: pointer; } button:focus-visible, a:focus-visible { outline: 3px solid var(--ion-color-primary); outline-offset: 2px; }
    .filter-note { grid-column: 1 / -1; margin: 0; font-size: 13px; color: var(--ion-color-medium); }
    .log-grid { display: block; width: 100%; min-width: 0; }
    .log-grid.fixed-height { height: 420px; }
    .entry-details { padding: 4px 16px 18px; border-top: 1px solid var(--ion-color-light-shade); }
    .entry-details a { display: inline-block; margin: 0 16px 8px 0; }
    dl { display: grid; grid-template-columns: minmax(90px, 130px) 1fr; gap: 6px 12px; } dt { font-weight: 700; } dd { margin: 0; overflow-wrap: anywhere; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 300px; overflow: auto; padding: 12px; background: var(--ion-color-light); border-radius: 6px; }
    .error { color: var(--ion-color-danger); }
  `,
})
export class DemoLogsPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly catalog = inject(LogSourceCatalogService);

  readonly sources = signal<readonly LogSource[]>([]);
  readonly sourceId = signal('');
  readonly collectionId = signal('');
  readonly mode = signal<'declared' | 'adhoc'>('declared');
  readonly baseUrl = signal('');
  readonly databaseId = signal('');
  readonly adhocCollection = signal('');
  readonly ownerToken = signal('');
  readonly values = signal<Readonly<Record<string, string>>>({});
  readonly correlationId = signal('');
  readonly fromTime = signal('');
  readonly toTime = signal('');
  readonly severity = signal('');
  readonly includeUntimed = signal(false);
  readonly state = signal<LoadState>('idle');
  readonly error = signal('');
  readonly rows = signal<readonly OvdbRow[]>([]);
  readonly applied = signal<AppliedQuery | null>(null);
  readonly unavailable = signal<readonly string[]>([]);
  readonly selectedKey = signal('');

  readonly declaredSource = computed(() => this.sources().find((source) => source.id === this.sourceId()));
  readonly view = computed<LogView | undefined>(() => {
    if (this.mode() === 'adhoc') {
      return {
        mode: 'adhoc', title: 'Ad hoc OVDB source', synthetic: false,
        baseUrl: this.baseUrl().trim(), databaseId: this.databaseId().trim(), collection: this.adhocCollection().trim(),
        collectionTitle: this.adhocCollection().trim(), fields: DEFAULT_LOG_FIELDS, identifiers: DEFAULT_LOG_IDENTIFIERS, records: [],
      };
    }
    const source = this.declaredSource();
    const collection = source?.collections.find((item) => item.id === this.collectionId());
    if (!source || !collection) return undefined;
    return {
      mode: 'declared', sourceId: source.id, title: source.title, synthetic: source.synthetic,
      baseUrl: source.baseUrl, databaseId: source.databaseId, collection: collection.id, collectionTitle: collection.title,
      fields: collection.fields, identifiers: source.identifiers, records: source.records,
    };
  });
  readonly hasIdentityFilters = computed(() => Object.values(this.values()).some((value) => value.trim()) || !!this.correlationId().trim());
  readonly retainedFilterLabels = computed(() => {
    const view = this.view();
    return [...(view?.identifiers ?? []).map((identifier) => identifier.label), ...(view?.fields.correlation ? ['correlation'] : []), ...(view?.fields.severity ? ['severity'] : [])].join(', ');
  });
  readonly heading = computed(() => {
    const query = this.applied() ?? this.view();
    if (!query) return { eyebrow: 'Log evidence', title: 'Log evidence timeline', description: '' };
    const values = 'values' in query ? (query as AppliedQuery).values : this.values();
    const filters = query.identifiers.filter((identifier) => values[identifier.param]?.trim()).map((identifier) => `${identifier.label} ${values[identifier.param].trim()}`);
    return {
      eyebrow: `${query.title} · ${query.synthetic ? 'synthetic log evidence' : query.mode === 'adhoc' ? 'ad hoc source' : 'log evidence'}`,
      title: filters.length ? `${query.collectionTitle} · ${filters.join(' · ')}` : query.collectionTitle,
      description: `Read in place from ${query.databaseId} / ${query.collection} through OVDB; nothing is copied or ingested.${query.synthetic ? ' These entries are synthetic: they illustrate the demo, not real events.' : ''}`,
    };
  });
  readonly contextRecordLinks = computed(() => {
    const query = this.applied();
    return query ? this.recordLinks(query, (param) => query.values[param]?.trim() ?? '') : [];
  });
  readonly gridRows = computed(() => {
    const fields = this.applied()?.fields ?? DEFAULT_LOG_FIELDS;
    const fallback: Partial<Record<LogRole, string>> = { timestamp: 'Time unavailable', severity: 'UNKNOWN', origin: 'Source unavailable', message: 'Unparsed entry' };
    return this.rows().map((row) => ({
      key: row.key,
      ...Object.fromEntries((['timestamp', 'severity', 'service', 'origin', 'message'] as const).map((role) => [role, this.text(row, fields[role] ?? '') || fallback[role] || ''])),
    }));
  });
  readonly columns = computed<ColDef[]>(() => {
    const fields = this.applied()?.fields ?? DEFAULT_LOG_FIELDS;
    return [
      { field: 'timestamp', headerName: 'Timestamp', width: 210 },
      ...(fields.severity ? [{ field: 'severity', headerName: 'Severity', width: 110, minWidth: 100 }] : []),
      ...(fields.service ? [{ field: 'service', headerName: 'Service', width: 160 }] : []),
      ...(fields.origin ? [{ field: 'origin', headerName: 'Source', width: 160 }] : []),
      { field: 'message', headerName: 'Message', minWidth: 220, flex: 1, wrapText: true, autoHeight: true },
    ];
  });
  readonly selectedRow = computed(() => this.rows().find((row) => row.key === this.selectedKey()));
  /** A short result fits the page instead of leaving an empty fixed-height grid. */
  readonly autoHeightRows = 12;
  readonly defaultColumn: ColDef = { resizable: true, sortable: false, minWidth: 120 };
  #request = 0;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => void this.fromUrl(params));
  }

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
  inputValue(event: Event): string { return (event.target as HTMLInputElement).value; }
  checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
  setValue(param: string, value: string): void { this.values.update((values) => ({ ...values, [param]: value })); }
  clearIdentifierFilters(): void {
    this.values.set({});
    this.correlationId.set('');
  }
  text(row: OvdbRow, field: string): string { const value = row.data[field]; return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value); }
  parserName(row: OvdbRow): string { return this.text(row, this.applied()?.fields.parser ?? ''); }
  readonly settingsSummary = computed(() => { const view = this.view(); return view ? `${view.databaseId} / ${view.collection}` : 'none'; });
  json(row: OvdbRow): string { return JSON.stringify(row.data, null, 2); }
  status(row: OvdbRow): string { const field = this.applied()?.fields.parseStatus; return (field && this.text(row, field)) || 'parsed'; }
  rowRecordLinks(row: OvdbRow) {
    const query = this.applied();
    if (!query) return [];
    const fields = new Map(query.identifiers.map((identifier) => [identifier.param, identifier.field]));
    return this.recordLinks(query, (param) => this.text(row, fields.get(param) ?? ''));
  }
  private recordLinks(query: LogView, value: (param: string) => string) {
    return query.records.flatMap((record) => {
      const id = value(record.param);
      const route = recordRoute(record, id);
      return route ? [{ ...route, label: `Open ${record.collection} record ${id}` }] : [];
    });
  }

  pickSource(id: string): void {
    const source = this.sources().find((item) => item.id === id);
    if (!source) return;
    this.mode.set('declared');
    void this.router.navigate([], { relativeTo: this.route, queryParams: { source: source.id } });
  }

  /** Declared mode follows the URL; every URL read is a declared read. */
  private async fromUrl(params: ParamMap): Promise<void> {
    let sources: readonly LogSource[];
    try {
      sources = await this.catalog.sources();
    } catch (error) {
      this.fail(error, 'The project’s log sources could not be read.');
      return;
    }
    this.sources.set(sources);
    const sourceParam = params.get('source');
    const source = sourceParam === null ? sources[0] : sources.find((item) => item.id === sourceParam);
    if (!source) return this.fail(undefined, `There is no declared log source “${sourceParam}”.`);
    const collectionParam = params.get('collection');
    const collection = collectionParam === null ? source.collections[0] : source.collections.find((item) => item.id === collectionParam);
    if (!collection) return this.fail(undefined, `“${collectionParam}” is not a declared collection of ${source.title}. Nothing was read.`);
    // Filters the URL does not carry (correlation, severity, untimed) stay while the source and collection stay.
    if (this.mode() !== 'declared' || this.sourceId() !== source.id || this.collectionId() !== collection.id) {
      this.correlationId.set('');
      this.severity.set('');
      this.includeUntimed.set(false);
    }
    this.mode.set('declared');
    this.sourceId.set(source.id);
    this.collectionId.set(collection.id);
    this.values.set(Object.fromEntries(source.identifiers.map((identifier) => [identifier.param, params.get(identifier.param) ?? ''])));
    this.fromTime.set(params.get('from') ?? source.window.from);
    this.toTime.set(params.get('to') ?? source.window.to);
    await this.load();
  }

  /** Declared mode writes the filters into the URL (the URL then reads); ad hoc mode reads directly. */
  async submit(event?: Event): Promise<void> {
    event?.preventDefault();
    const view = this.view();
    if (!view) return;
    if (view.mode === 'adhoc') return this.load();
    const params = {
      source: view.sourceId ?? '', collection: view.collection, from: this.fromTime().trim(), to: this.toTime().trim(),
      ...Object.fromEntries(view.identifiers.map((identifier) => [identifier.param, this.values()[identifier.param]?.trim() ?? ''])),
    };
    const current = this.route.snapshot.queryParamMap;
    if (Object.entries(params).every(([key, value]) => (current.get(key) ?? '') === value)) return this.load();
    try {
      const navigated = await this.router.navigate([], { relativeTo: this.route, queryParams: params });
      if (!navigated) throw new Error('The evidence URL could not be updated.');
    } catch (error) {
      this.fail(error, 'The evidence URL could not be updated.');
    }
  }

  readAdhoc(): void {
    this.mode.set('adhoc');
    void this.load();
  }

  private fail(error: unknown, message: string): void {
    this.#request++;
    this.rows.set([]);
    this.applied.set(null);
    this.error.set(error instanceof Error && error.message ? error.message : message);
    this.state.set('error');
  }

  private sourceFetch(baseUrl: string): typeof globalThis.fetch {
    const token = this.ownerToken();
    if (!token) return globalThis.fetch.bind(globalThis);
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' || !LOOPBACK.includes(url.hostname)) {
      throw new Error('A local owner token can only be used with an HTTP loopback source.');
    }
    return (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${token}`);
      return globalThis.fetch(input, { ...init, headers, redirect: 'error' });
    };
  }

  async load(): Promise<void> {
    const view = this.view();
    if (!view) return;
    const request = ++this.#request;
    this.error.set('');
    const from = this.fromTime().trim(), to = this.toTime().trim();
    const includeUntimed = !!view.fields.parseStatus && this.includeUntimed();
    const values = Object.fromEntries(view.identifiers.map((identifier) => [identifier.param, this.values()[identifier.param]?.trim() ?? '']));
    if (!includeUntimed && (!RFC3339_UTC.test(from) || !RFC3339_UTC.test(to) || Date.parse(to) < Date.parse(from))) {
      return this.fail(undefined, 'Enter a valid increasing RFC3339 UTC time range (ending in Z).');
    }
    const filters: Filter[] = includeUntimed ? [] : [
      { field: view.fields.timestamp, operator: '>=', value: from },
      { field: view.fields.timestamp, operator: '<=', value: to },
    ];
    for (const identifier of view.identifiers) {
      if (!values[identifier.param]) continue;
      const value = identifierValue(identifier, values[identifier.param]);
      if (value === undefined) return this.fail(undefined, `${identifier.label} must be a whole number.`);
      filters.push({ field: identifier.field, operator: '==', value });
    }
    if (view.fields.correlation && this.correlationId().trim()) filters.push({ field: view.fields.correlation, operator: '==', value: this.correlationId().trim() });
    if (view.fields.severity && this.severity()) filters.push({ field: view.fields.severity, operator: '==', value: this.severity() });
    this.state.set('loading');
    this.rows.set([]);
    this.selectedKey.set('');
    this.applied.set(null);
    try {
      if (!view.baseUrl || !view.databaseId || !view.collection) throw new Error('Enter an OVDB URL, a database and a collection.');
      const sourceFetch = this.sourceFetch(view.baseUrl);
      const descriptor = await fetchOvdbDescriptor(sourceFetch, view.baseUrl, view.databaseId);
      const listed = descriptor.collections ?? [];
      if (request === this.#request && view.mode === 'declared') {
        this.unavailable.set(this.declaredSource()?.collections.map((item) => item.id).filter((id) => !listed.includes(id)) ?? []);
      }
      if (!listed.includes(view.collection)) {
        throw new Error(view.mode === 'declared'
          ? `${view.collectionTitle} is declared but not available from the source yet. Choose another collection.`
          : 'The selected collection is unavailable for ordinary OVDB queries.');
      }
      if (descriptor.capabilities.query !== true) throw new Error('The selected collection is unavailable for ordinary OVDB queries.');
      const connection: OvdbConnection = { id: view.databaseId, title: view.databaseId, baseUrl: view.baseUrl, databaseId: view.databaseId, fetch: sourceFetch, descriptor };
      const result = await ovdbDatabase(connection).query<Record<string, unknown>>({
        source: { kind: 'collection', name: view.collection }, filters,
        orders: [{ field: view.fields.timestamp, direction: 'desc' }, ...(view.fields.sequence ? [{ field: view.fields.sequence, direction: 'desc' as const }] : [])],
        limit: 100,
      });
      if (request !== this.#request) return;
      this.rows.set(result.records.map((record) => ({ key: record.key.path, data: record.data ?? {} })));
      this.applied.set({ ...view, values });
      this.state.set('ready');
    } catch (error) {
      if (request !== this.#request) return;
      this.fail(error, 'The source could not be queried.');
    }
  }

  async copyReference(row: OvdbRow): Promise<void> {
    const field = this.applied()?.fields.reference;
    if (!field) return;
    try { await navigator.clipboard.writeText(this.text(row, field)); }
    catch { this.error.set('Clipboard access is unavailable; select the reference text to copy it.'); }
  }
}
