import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IonButton, IonButtons, IonContent, IonHeader, IonItem, IonLabel, IonSelect, IonSelectOption, IonSpinner, IonTitle, IonToolbar } from '@ionic/angular';
import { AgGridReadyDirective } from '@datatug/ag-grid';
import { AgGridAngular } from 'ag-grid-angular';
import { type ColDef } from 'ag-grid-community';
import { DatatugServicesStoreModule } from '../services/repo/datatug-services-store.module';
import { readProjectApiQuery } from '../nav/project-api-routing';
import { IProjectRef } from '../core/project-context';
import { SessionWorkspaceService } from './session-workspace.service';
import { ContextEntryRevision, ContextInputSnapshot, ContextRun, ContextWidgetOutcome, contextScopeKey } from './session-context-contract';
import { invoiceInput, invoiceWidgetQuery, invoiceDashboardDocument, matchesInvoiceDashboardReceipt, INVOICE_DASHBOARD_ID, INVOICE_DASHBOARD_REVISION } from './invoice-dashboard';
import { SessionChinookQueryService } from './session-chinook-query.service';
import type { TypedValue } from '@sneat/datatug-semantic';
import { SessionResultCacheService, tryWriteSessionResultCache } from './session-result-cache.service';
import { sessionResultFingerprint } from './session-result-fingerprint';

type WidgetView = { readonly state: 'completed'; readonly resultRef: string; readonly rows: Record<string, unknown>[]; readonly columns: ColDef[] } | { readonly state: 'failed'; readonly error: string };
type WidgetExecutionView = { readonly state: 'completed'; readonly rows: Record<string, unknown>[]; readonly columns: ColDef[] } | { readonly state: 'failed'; readonly error: string };
interface DashboardView { readonly runId: string; readonly inputId: string; readonly invoiceId: string; readonly scopeKey: string; readonly bindingStamp: string; readonly widgets: Readonly<Record<'lines' | 'genres', WidgetView>>; }
type MutableDashboardWidgets = { -readonly [Key in keyof DashboardView['widgets']]: DashboardView['widgets'][Key] };

@Component({
  selector: 'sneat-datatug-invoice-dashboard', changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [SessionChinookQueryService],
  imports: [DatatugServicesStoreModule, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent,
    IonItem, IonLabel, IonSelect, IonSelectOption, IonSpinner, AgGridAngular, AgGridReadyDirective],
  template: `
    <ion-header><ion-toolbar><ion-title>Invoice overview</ion-title><ion-buttons slot="end"><ion-button (click)="run()" [disabled]="busy() || !workspace.canExecuteFor(sessionId())">{{ view() ? 'Refresh' : 'Run' }}</ion-button></ion-buttons></ion-toolbar></ion-header>
    @if (snapshot()) { <ion-content>
      <ion-item><ion-select label="Environment" [disabled]="busy()" [value]="scopeChoice()" (ionChange)="scopeChoice.set($event.detail.value)">
        @for (bag of snapshot()?.bags; track bag.id) { <ion-select-option [value]="scopeKey(bag.scope)">{{ bag.scope.environmentId }} · {{ bag.scope.identityDomain }}</ion-select-option> }
      </ion-select></ion-item>
      <ion-item><ion-label><h2>Required input: Invoice → InvoiceId</h2><p>{{ bindingLabel() }}</p><p>Source: admitted pinned Chinook SQLite. InvoiceLine.InvoiceId references Invoice.InvoiceId.</p></ion-label></ion-item>
      @if (busy()) { <ion-item role="status"><ion-spinner slot="start" /><ion-label>Running both widgets with one pinned input…</ion-label></ion-item> }
      @if (error()) { <ion-item color="danger" role="alert"><ion-label>{{ error() }}</ion-label></ion-item> }
      @if (stale()) { <ion-item color="warning" role="status"><ion-label>Context changed for this environment. These widgets still show their saved run; Refresh uses the new input.</ion-label></ion-item> }
      @if (view(); as result) {
          <ion-item><ion-label><h2>Invoice {{ result.invoiceId }}</h2><p>Input {{ result.inputId }} · run {{ result.runId }}</p><p>Browser-observed widget outcomes; rows are stored only in this device's private cache.</p></ion-label></ion-item>
        @if (result.widgets.lines.state === 'completed') {
          <ion-item><ion-label><h2>Invoice lines · {{ result.widgets.lines.rows.length }} rows</h2></ion-label></ion-item>
          <ag-grid-angular *datatugAgGridReady style="height:320px;width:100%" [rowData]="result.widgets.lines.rows" [columnDefs]="result.widgets.lines.columns" [defaultColDef]="{resizable:true,sortable:true,flex:1,minWidth:110}" />
        } @else { <ion-item color="danger" role="alert"><ion-label>Invoice lines failed: {{ result.widgets.lines.error }}</ion-label></ion-item> }
        @if (result.widgets.genres.state === 'completed') {
          <ion-item><ion-label><h2>Amount by genre</h2></ion-label></ion-item>
          <figure aria-label="Invoice amount by genre bar chart">
            @for (row of chartRows(); track row.label) { <div class="chart-row"><span>{{ row.label }}</span><div class="bar" [style.width.%]="row.width"></div><strong>{{ row.amount }}</strong></div> }
            @empty { <p>No genre rows were returned for this invoice.</p> }
            <figcaption>Invoice line amount = quantity × unit price. Every bar uses input {{ result.inputId }}.</figcaption>
          </figure>
        } @else { <ion-item color="danger" role="alert"><ion-label>Genre chart failed: {{ result.widgets.genres.error }}</ion-label></ion-item> }
      }
      <ion-item><ion-label><h2>Saved runs</h2><p>Reopening reads receipts without running a query. Widget rows are available on the device that executed them.</p></ion-label></ion-item>
      @for (run of history(); track run.id) { <ion-item><ion-label>{{ run.state }} · {{ run.createdAt }}<p>{{ run.inputSnapshotId }} · {{ run.outcomeOrigin || 'Awaiting outcome' }}</p></ion-label></ion-item> }
      @if (hasMoreHistory()) { <ion-item><ion-button (click)="loadMoreHistory()">Load more saved runs</ion-button></ion-item> }
    </ion-content> } @else { <ion-content><ion-item role="alert"><ion-label>Session access is unavailable. Saved rows are hidden.</ion-label></ion-item></ion-content> }`,
  styles: [`:host{display:block;height:100%}figure{margin:16px}figcaption{color:var(--ion-color-medium);font-size:.8rem;margin-top:12px}.chart-row{display:grid;grid-template-columns:minmax(90px,160px) minmax(0,1fr) 70px;align-items:center;gap:12px;margin:12px 0}.bar{height:24px;background:var(--ion-color-primary);min-width:2px}.chart-row strong{text-align:right}`],
})
export class InvoiceDashboardComponent {
  readonly workspace = inject(SessionWorkspaceService);
  private readonly route = inject(ActivatedRoute);
  private readonly queries = inject(SessionChinookQueryService);
  private readonly cache = inject(SessionResultCacheService);
  readonly sessionId = signal(this.route.snapshot.paramMap.get('sessionId') ?? '');
  readonly snapshot = computed(() => this.workspace.snapshotFor(this.sessionId()));
  readonly scopeChoice = signal((() => {
    const snapshot = this.snapshot();
    const defaultBag = snapshot?.bags.find((bag) => bag.id === snapshot.session.defaultBagId);
    return defaultBag ? contextScopeKey(defaultBag.scope) : '';
  })());
  readonly scope = computed(() => this.snapshot()?.bags.find((bag) => contextScopeKey(bag.scope) === this.scopeChoice())?.scope);
  readonly busy = signal(false); readonly error = signal(''); readonly view = signal<DashboardView | undefined>(undefined);
  readonly history = signal<readonly ContextRun[]>([]);
  readonly hasMoreHistory = signal(false); private historyCursor?: string;
  readonly bindingStamp = computed(() => {
    const snapshot = this.snapshot(), scope = this.scope();
    return snapshot && scope ? JSON.stringify([snapshot.contextSet.enabled, snapshot.contextSet.slots.find((slot) => contextScopeKey(slot.scope) === contextScopeKey(scope))]) : '';
  });
  readonly stale = computed(() => { const view = this.view(); return !!view && view.bindingStamp !== this.bindingStamp(); });
  readonly bindingLabel = computed(() => { try { return `InvoiceId ${this.currentInput().value} · applied entry revision`; } catch (error) { return error instanceof Error ? error.message : 'Input unavailable'; } });
  readonly chartRows = computed(() => {
    const widget = this.view()?.widgets.genres;
    if (widget?.state !== 'completed') return [];
    const amounts = widget.rows.map((row) => Number(row['Amount']));
    const max = Math.max(...amounts, 0);
    return widget.rows.map((row, index) => ({ label: String(row['Genre']), amount: amounts[index].toFixed(2), width: max > 0 ? amounts[index] / max * 100 : 0 }));
  });
  scopeKey = contextScopeKey;
  private resetKey = '';
  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => this.sessionId.set(params.get('sessionId') ?? ''));
    effect(() => {
      const sessionId = this.sessionId(), snapshot = this.snapshot();
      const key = `${sessionId}:${snapshot?.session.id ?? ''}`;
      if (key === this.resetKey) return;
      this.resetKey = key;
      this.view.set(undefined); this.history.set([]); this.hasMoreHistory.set(false); this.historyCursor = undefined;
      this.busy.set(false); this.error.set('');
      const defaultBag = snapshot?.bags.find((bag) => bag.id === snapshot.session.defaultBagId);
      this.scopeChoice.set(defaultBag ? contextScopeKey(defaultBag.scope) : '');
      if (snapshot && sessionId) void this.restore(sessionId);
    });
  }
  private currentInput(): TypedValue {
    const snapshot = this.snapshot(), scope = this.scope();
    if (!snapshot || !scope || !snapshot.contextSet.enabled) throw new Error('Apply an Invoice → InvoiceId entry in this environment.');
    const slot = snapshot.contextSet.slots.find((item) => contextScopeKey(item.scope) === contextScopeKey(scope));
    if (!slot?.bagId) throw new Error('No context is applied in this environment.');
    const revisions = slot.entries.flatMap((ref) => {
      const revision = snapshot.revisions.find((item) => item.id === ref.revisionId && item.entryId === ref.entryId);
      return revision ? [revision] : [];
    });
    return invoiceInput(revisions, this.admittedSubjects());
  }
  async run(): Promise<void> {
    const sessionId = this.sessionId();
    if (this.busy() || !this.workspace.canExecuteFor(sessionId)) return;
    const scope = this.scope();
    if (!scope) return;
    const project = this.project();
    const admittedSubjects = this.workspace.capabilities()?.subjects?.filter((item) => contextScopeKey(item.scope) === contextScopeKey(scope)).map((item) => item.subject) ?? [];
    this.error.set(''); this.busy.set(true);
    let pinnedRun: { runId: string; run: ContextRun; input: ContextInputSnapshot; revisions: readonly ContextEntryRevision[] } | undefined;
    let outcomeReported = false;
    try {
      const observedInput = this.currentInput();
      const bindingStamp = this.bindingStamp();
      const pinned = await this.workspace.pinInput(sessionId, scope, 'dashboard', INVOICE_DASHBOARD_ID, INVOICE_DASHBOARD_REVISION, undefined, { InvoiceId: observedInput }, invoiceDashboardDocument());
      if (!pinned) throw new Error(this.workspace.error() || 'The server did not confirm the dashboard input.');
      pinnedRun = pinned;
      if (pinned.run.executionAuthority !== 'client') {
        this.error.set('The server accepted this dashboard run. The browser will not run its widgets; check saved run history for the outcome.');
        await this.loadHistory(sessionId);
        return;
      }
      const value = invoiceInput(pinned.revisions, admittedSubjects);
      const values = await Promise.allSettled((['lines', 'genres'] as const).map((widget) => this.executeWidget(widget, value, scope, project)));
      const widgets: MutableDashboardWidgets = {} as MutableDashboardWidgets;
      for (const [index, id] of (['lines', 'genres'] as const).entries()) {
        const outcome = values[index];
        if (outcome.status === 'fulfilled' && outcome.value.state === 'completed') {
          widgets[id] = { ...outcome.value, resultRef: await sessionResultFingerprint({ columns: outcome.value.columns, rows: outcome.value.rows }) };
        } else if (outcome.status === 'fulfilled' && outcome.value.state === 'failed') {
          widgets[id] = outcome.value;
        } else {
          widgets[id] = { state: 'failed', error: outcome.status === 'rejected' && outcome.reason instanceof Error ? outcome.reason.message : 'The source query failed.' };
        }
      }
      const resultView = { runId: pinned.runId, inputId: pinned.input.id, invoiceId: String(value.value), scopeKey: contextScopeKey(scope), bindingStamp, widgets };
      if (sessionId === this.sessionId()) this.view.set(resultView);
      const outcomes: ContextWidgetOutcome[] = (['lines', 'genres'] as const).map((id) => widgets[id].state === 'completed'
        ? { id, state: 'completed', resultRef: widgets[id].resultRef }
        : { id, state: 'failed', errorCode: 'SOURCE_QUERY_FAILED' });
      if (!(await tryWriteSessionResultCache(this.cache, this.workspace.deviceViewKey(sessionId, 'invoice-dashboard'), resultView))) {
        if (sessionId === this.sessionId()) this.error.set('The source finished, but this device could not save the result display. The outcome will be recorded and the source will not be rerun.');
      }
      outcomeReported = true;
      if (!(await this.workspace.reportClientRun(sessionId, pinned.runId, 'dashboard', outcomes)) && sessionId === this.sessionId()) this.error.set('The widgets finished; their outcome receipt is unconfirmed. Retry the retained operation.');
      await this.loadHistory(sessionId);
    } catch (error) {
      if (sessionId === this.sessionId()) this.error.set(error instanceof Error ? error.message : 'The dashboard could not run.');
      if (pinnedRun?.run.executionAuthority === 'client' && !outcomeReported) {
        // Pinning is already durable. Terminalize preparation/source failures
        // without re-dispatching any widget that may have run.
        outcomeReported = true;
        const failure: ContextWidgetOutcome[] = ['lines', 'genres'].map((id) => ({ id, state: 'failed', errorCode: 'DASHBOARD_CLIENT_EXECUTION_FAILED' }));
        if (!(await this.workspace.reportClientRun(sessionId, pinnedRun.runId, 'dashboard', failure)) && sessionId === this.sessionId()) this.error.set('The dashboard failed after its input was accepted; its failure receipt is unconfirmed. Check and recover the saved operation.');
      }
    }
    finally { if (sessionId === this.sessionId()) this.busy.set(false); }
  }
  private project(): IProjectRef {
    const spaceId = this.route.snapshot.paramMap.get('spaceId');
    return { storeId: this.route.snapshot.paramMap.get('storeId') ?? '', projectId: this.route.snapshot.paramMap.get('projectId') ?? '',
      ...(spaceId ? { spaceID: spaceId } : {}), ...readProjectApiQuery(this.route.snapshot.queryParamMap) };
  }
  private admittedSubjects() { return this.workspace.capabilities()?.subjects?.filter((item) => contextScopeKey(item.scope) === this.scopeChoice()).map((item) => item.subject) ?? []; }
  private async executeWidget(widget: 'lines' | 'genres', value: TypedValue, scope: import('./session-context-contract').SessionScope, project: IProjectRef): Promise<WidgetExecutionView> {
    const result = await this.queries.execute(project, scope, invoiceWidgetQuery(widget), value);
    const names = result.columns.map((column) => column.field);
    const required = widget === 'genres' ? ['Genre', 'Amount'] : ['InvoiceLineId', 'InvoiceId'];
    if (required.some((name) => !names.includes(name)) || (widget === 'genres' && result.rows.some((row) => typeof row['Genre'] !== 'string' || !Number.isFinite(Number(row['Amount'])))))
      throw new Error('The source returned an incompatible widget result.');
    return { state: 'completed', ...result };
  }
  private async loadHistory(sessionId = this.sessionId()): Promise<void> {
    try { const history = await this.workspace.history(sessionId); if (sessionId !== this.sessionId()) return; this.history.set(history.items.filter((run) => run.definitionId === INVOICE_DASHBOARD_ID)); this.hasMoreHistory.set(history.hasMore); this.historyCursor = history.nextCursor; }
    catch (error) { if (sessionId === this.sessionId()) this.error.set(error instanceof Error ? error.message : 'Saved dashboard runs are unavailable.'); }
  }
  async loadMoreHistory(): Promise<void> {
    const sessionId = this.sessionId();
    try { const page = await this.workspace.history(sessionId, this.historyCursor); if (sessionId !== this.sessionId()) return; this.history.update((runs) => [...runs, ...page.items.filter((run) => run.definitionId === INVOICE_DASHBOARD_ID && !runs.some((prior) => prior.id === run.id))]); this.hasMoreHistory.set(page.hasMore); this.historyCursor = page.nextCursor; }
    catch { this.error.set('More saved runs could not be loaded.'); }
  }
  private async restore(sessionId: string): Promise<void> {
    await this.loadHistory(sessionId);
    if (sessionId !== this.sessionId() || this.error() || !this.snapshot()) return;
    try {
      const cached = await this.cache.read<DashboardView>(this.workspace.deviceViewKey(sessionId, 'invoice-dashboard'));
      if (sessionId !== this.sessionId()) return;
      const savedRun = cached && this.history().find((run) => run.id === cached.runId && run.inputSnapshotId === cached.inputId);
      if (cached && savedRun && await matchesInvoiceDashboardReceipt(cached.widgets, savedRun)) this.view.set(cached);
    } catch { if (sessionId === this.sessionId()) this.error.set('Saved run receipts are available; this device could not restore its result display cache.'); }
  }
}
