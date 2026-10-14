import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IonButton, IonButtons, IonContent, IonHeader, IonItem, IonLabel, IonSelect, IonSelectOption, IonSpinner, IonTitle, IonToolbar } from '@ionic/angular';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { DatatugServicesStoreModule } from '../services/repo/datatug-services-store.module';
import { IProjectRef } from '../core/project-context';
import { readProjectApiQuery } from '../nav/project-api-routing';
import { IQueryDef, ITextQueryRequest, QueryType } from '../models/definition/query-def';
import { SessionWorkspaceService } from './session-workspace.service';
import { SessionChinookQueryService, SessionQueryRows } from './session-chinook-query.service';
import { contextScopeKey } from './session-context-contract';
import { invoiceInput, invoiceWidgetQuery } from './invoice-dashboard';

ModuleRegistry.registerModules([AllCommunityModule]);
@Component({
  selector: 'sneat-datatug-invoice-explorer', changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [SessionChinookQueryService], imports: [DatatugServicesStoreModule, AgGridAngular, IonHeader, IonToolbar, IonTitle,
    IonButtons, IonButton, IonContent, IonItem, IonLabel, IonSelect, IonSelectOption, IonSpinner],
  template: `
    <ion-header><ion-toolbar><ion-title>Explorer · Chinook</ion-title><ion-buttons slot="end"><ion-button (click)="load()" [disabled]="busy() || !workspace.canExecuteFor(sessionId())">Refresh</ion-button></ion-buttons></ion-toolbar></ion-header>
    <ion-content>
      <ion-item><ion-select label="Environment" [value]="scopeChoice()" (ionChange)="scopeChoice.set($event.detail.value); viewAll.set(false)">@for (bag of snapshot()?.bags; track bag.id) { <ion-select-option [value]="scopeKey(bag.scope)">{{ bag.scope.environmentId }} · {{ bag.scope.identityDomain }}</ion-select-option> }</ion-select></ion-item>
      <ion-item><ion-select label="Table" [value]="table()" (ionChange)="table.set($event.detail.value); viewAll.set(false)"><ion-select-option value="Invoice">Invoice</ion-select-option><ion-select-option value="InvoiceLine">InvoiceLine</ion-select-option></ion-select></ion-item>
      <ion-item><ion-label><h2>{{ table() }}</h2><p>{{ provenance() }}</p><p>This adapter uses the admitted pinned Chinook source. Other tables need declared mappings.</p></ion-label></ion-item>
      @if (error()) { <ion-item color="warning" role="status"><ion-label>{{ error() }}</ion-label>@if (needsViewAll()) { <ion-button slot="end" (click)="selectViewAll()">Select View all</ion-button> }</ion-item> }
      @if (stale()) { <ion-item color="warning" role="status"><ion-label>Context or view changed; refresh to load related rows.</ion-label></ion-item> }
      @if (busy()) { <ion-item role="status"><ion-spinner slot="start" /><ion-label>Loading related rows…</ion-label></ion-item> }
      @if (rows(); as result) { <ag-grid-angular style="height:calc(100% - 220px);min-height:260px;width:100%" [rowData]="result.rows" [columnDefs]="result.columns" [defaultColDef]="{resizable:true,sortable:true,flex:1,minWidth:110}" /> }
    </ion-content>`,
})
export class InvoiceExplorerComponent {
  readonly workspace = inject(SessionWorkspaceService);
  private readonly route = inject(ActivatedRoute);
  private readonly queries = inject(SessionChinookQueryService);
  readonly sessionId = signal(this.route.snapshot.paramMap.get('sessionId') ?? '');
  readonly snapshot = computed(() => this.workspace.snapshotFor(this.sessionId()));
  readonly table = signal<'Invoice' | 'InvoiceLine'>('Invoice');
  readonly scopeChoice = signal((() => { const firstBag = this.snapshot()?.bags[0]; return firstBag ? contextScopeKey(firstBag.scope) : ''; })());
  readonly scope = computed(() => this.snapshot()?.bags.find((bag) => contextScopeKey(bag.scope) === this.scopeChoice())?.scope);
  readonly viewAll = signal(false); readonly needsViewAll = signal(false); readonly stale = signal(false);
  readonly busy = signal(false); readonly error = signal(''); readonly provenance = signal('No source query has run.');
  readonly rows = signal<SessionQueryRows | undefined>(undefined);
  private generation = 0;
  private previousViewStamp?: string;
  scopeKey = contextScopeKey;
  readonly manifestStamp = computed(() => {
    const snapshot = this.snapshot(), scope = this.scope();
    return snapshot && scope ? JSON.stringify([snapshot.contextSet.enabled, snapshot.contextSet.slots.find((slot) => contextScopeKey(slot.scope) === contextScopeKey(scope))]) : '';
  });
  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => this.sessionId.set(params.get('sessionId') ?? ''));
    effect(() => {
      const stamp = JSON.stringify([this.sessionId(), this.manifestStamp(), this.table(), this.scopeChoice(), this.viewAll()]);
      if (stamp === this.previousViewStamp) return;
      this.previousViewStamp = stamp;
      this.generation++;
      this.busy.set(false);
      this.rows.set(undefined);
      this.stale.set(true);
      this.error.set('');
      this.provenance.set('Context or view changed; refresh to load related rows.');
    });
  }
  selectViewAll(): void {
    this.viewAll.set(true);
    this.error.set('View all selected. Refresh to run an explicitly unconstrained query.');
    this.needsViewAll.set(false);
  }
  async load(): Promise<void> {
    const generation = ++this.generation;
    const snapshot = this.snapshot(), scope = this.scope();
    if (!snapshot || !scope) { this.rows.set(undefined); this.error.set('Choose an available environment before loading rows.'); this.busy.set(false); return; }
    if (!this.workspace.canExecuteFor(this.sessionId())) { this.rows.set(undefined); this.error.set('The session is not ready to run a query. Resolve pending session work before refreshing.'); this.busy.set(false); return; }
    const table = this.table(), viewAll = this.viewAll();
    this.error.set(''); this.needsViewAll.set(false);
    let value;
    try {
      if (!viewAll) {
        if (!snapshot.contextSet.enabled) throw new Error('All session context is disabled. Choose View all to read unconstrained rows.');
        const slot = snapshot.contextSet.slots.find((item) => contextScopeKey(item.scope) === contextScopeKey(scope));
        if (!slot?.bagId || !slot.entries.length) throw new Error('No applicable context in this environment. Choose View all to read unconstrained rows.');
        const revisions = slot.entries.flatMap((ref) => {
          const revision = snapshot.revisions.find((item) => item.id === ref.revisionId && item.entryId === ref.entryId);
          return revision ? [revision] : [];
        });
        value = invoiceInput(revisions,
          this.workspace.capabilities()?.subjects?.filter((item) => contextScopeKey(item.scope) === contextScopeKey(scope)).map((item) => item.subject) ?? []);
      }
    } catch (error) {
      this.rows.set(undefined); this.error.set(error instanceof Error ? error.message : 'Context cannot bind this table.');
      this.needsViewAll.set(!snapshot.contextSet.enabled || !snapshot.contextSet.slots.some((slot) => contextScopeKey(slot.scope) === contextScopeKey(scope) && slot.bagId && slot.entries.length));
      return;
    }
    this.busy.set(true);
    try {
      const definition: IQueryDef = table === 'InvoiceLine' && !viewAll ? invoiceWidgetQuery('lines') : {
        id: `session-explore-${table}`, title: table, connectionId: 'chinook-sqlite',
        ...(viewAll ? {} : { parameters: invoiceWidgetQuery('lines').parameters }),
        request: { queryType: QueryType.SQL, text: `SELECT * FROM ${table}${viewAll ? '' : ' WHERE InvoiceId = ?'} ORDER BY ${table === 'Invoice' ? 'InvoiceId' : 'InvoiceLineId'} LIMIT 1000` } as ITextQueryRequest,
      };
      const spaceId = this.route.snapshot.paramMap.get('spaceId');
      const project: IProjectRef = { storeId: this.route.snapshot.paramMap.get('storeId') ?? '', projectId: this.route.snapshot.paramMap.get('projectId') ?? '',
        ...(spaceId ? { spaceID: spaceId } : {}), ...readProjectApiQuery(this.route.snapshot.queryParamMap) };
      const result = await this.queries.execute(project, scope, definition, value);
      if (generation !== this.generation) return;
      this.rows.set(result);
      this.stale.set(false);
      this.provenance.set(viewAll ? 'View all · explicitly unconstrained · first 1,000 rows maximum' : `InvoiceId ${value?.value ?? 'unavailable'} · ${table === 'Invoice' ? 'declared Invoice key' : 'InvoiceLine.InvoiceId → Invoice.InvoiceId'} · ${snapshot.contextSet.id} · ${scope.environmentId}`);
    } catch (error) { if (generation === this.generation) { this.rows.set(undefined); this.error.set(error instanceof Error ? error.message : 'The source is unavailable.'); } }
    finally { if (generation === this.generation) this.busy.set(false); }
  }
}
