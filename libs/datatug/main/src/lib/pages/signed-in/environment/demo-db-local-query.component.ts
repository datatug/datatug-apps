import { Component, OnDestroy, inject, signal } from '@angular/core';
import { ActivatedRoute, type ParamMap } from '@angular/router';
import { Subject, combineLatest, takeUntil } from 'rxjs';
import type { QueryPage, StructuredQuery } from '@dalgo/core';
import {
  IonBackButton, IonButton, IonButtons, IonCard, IonContent, IonHeader, IonInput,
  IonItem, IonLabel, IonSelect, IonSelectOption, IonTitle, IonToolbar,
} from '@ionic/angular';
import type { IProjectRef } from '../../../core/project-context';
import { projectPageHref } from '../../../nav/project-page-href';
import { ProjectTracker } from '../../../services/nav/contexts/project.tracker';
import { DEMODB_LOCAL_COPY } from '../project/demo-db-connections.component';
import { DEMODB_DATASETS, type DemoDbDataset, type LocalDemoDbConnection } from './demo-db-local-copy';

type Row = Record<string, unknown>;
type Filter = StructuredQuery<Row>['filters'][number];
type Order = StructuredQuery<Row>['orders'][number];
type Operator = '==' | '!=' | '<' | '<=' | '>' | '>=';

/** Query a completed browser-local Dev connection through the DALgo IndexedDB source. */
@Component({
  selector: 'sneat-datatug-demodb-local-query',
  standalone: true,
  imports: [IonBackButton, IonButton, IonButtons, IonCard, IonContent, IonHeader, IonInput,
    IonItem, IonLabel, IonSelect, IonSelectOption, IonTitle, IonToolbar],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-back-button [defaultHref]="backHref()" /></ion-buttons>
      <ion-title>Local Dev query</ion-title>
    </ion-toolbar></ion-header>
    <ion-content color="light">
      @if (connection(); as source) {
        <ion-card>
          <ion-item><ion-label>
            <strong>{{ source.dataset }} / IndexedDB / Dev</strong>
            <p>{{ source.tags.join(' · ') }} · {{ source.rowCount }} rows · {{ source.databaseName }}</p>
            <p>Source: {{ source.sourceConnectionId }} · {{ source.provenanceScope }} provenance · {{ source.snapshotScope }} snapshots</p>
          </ion-label></ion-item>
          <ion-item><ion-select aria-label="Table" [value]="table()" (ionChange)="selectTable($event.detail.value)">
            @for (entry of source.tables; track entry.name) { <ion-select-option [value]="entry.name">{{ entry.name }} ({{ entry.rowCount }})</ion-select-option> }
          </ion-select></ion-item>
          <ion-item><ion-select aria-label="Filter field" [value]="filterField()" (ionChange)="setFilterField($event.detail.value)">
            <ion-select-option value="">No filter</ion-select-option>
            @for (field of fields(); track field) { <ion-select-option [value]="field">{{ field }}</ion-select-option> }
          </ion-select>
          <ion-select aria-label="Filter operator" [value]="operator()" (ionChange)="setOperator($event.detail.value)">
            @for (op of operators; track op) { <ion-select-option [value]="op">{{ op }}</ion-select-option> }
          </ion-select>
          <ion-input aria-label="Filter value" [value]="filterValue()" (ionInput)="setFilterValue($any($event.target).value ?? '')" />
          </ion-item>
          <ion-item><ion-select aria-label="Order field" [value]="orderField()" (ionChange)="setOrderField($event.detail.value)">
            <ion-select-option value="">Record key</ion-select-option>
            @for (field of fields(); track field) { <ion-select-option [value]="field">{{ field }}</ion-select-option> }
          </ion-select>
          <ion-select aria-label="Direction" [value]="direction()" (ionChange)="setDirection($event.detail.value)">
            <ion-select-option value="asc">Ascending</ion-select-option><ion-select-option value="desc">Descending</ion-select-option>
          </ion-select>
          <ion-input aria-label="Page size" type="number" min="1" max="100" [value]="pageSize()" (ionInput)="setPageSize($any($event.target).value)" />
          </ion-item>
          <ion-item><ion-button [disabled]="running()" (click)="run(false)">Run local query</ion-button>
            @if (nextCursor()) { <ion-button [disabled]="running()" (click)="run(true)">Next page</ion-button> }
          </ion-item>
          @if (error()) { <ion-item><ion-label role="alert">{{ error() }}</ion-label></ion-item> }
          @if (results()) { <ion-item><ion-label><pre>{{ results() }}</pre></ion-label></ion-item> }
        </ion-card>
      } @else if (error()) {
        <ion-card><ion-item><ion-label role="alert">{{ error() }}</ion-label></ion-item></ion-card>
      }
    </ion-content>
  `,
})
export class DemoDbLocalQueryComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly source = inject(DEMODB_LOCAL_COPY);
  private readonly stop = new Subject<void>();
  private epoch = 0;
  private queryVersion = 0;
  private project?: IProjectRef;
  protected readonly operators: readonly Operator[] = ['==', '!=', '<', '<=', '>', '>='];
  protected readonly connection = signal<LocalDemoDbConnection | undefined>(undefined);
  protected readonly table = signal('');
  protected readonly filterField = signal('');
  protected readonly operator = signal<Operator>('==');
  protected readonly filterValue = signal('');
  protected readonly orderField = signal('');
  protected readonly direction = signal<'asc' | 'desc'>('asc');
  protected readonly pageSize = signal(20);
  protected readonly nextCursor = signal<QueryPage<Row>['nextCursor']>(undefined);
  protected readonly results = signal('');
  protected readonly error = signal('');
  protected readonly running = signal(false);

  constructor() {
    const tracker = new ProjectTracker(this.stop, this.route);
    combineLatest([tracker.projectRef, this.route.paramMap]).pipe(takeUntil(this.stop)).subscribe(([ref, params]) => {
      this.project = ref;
      void this.load(params);
    });
  }

  private async load(params: ParamMap): Promise<void> {
    const epoch = ++this.epoch;
    this.queryVersion++;
    const dataset = params.get('dataset');
    this.connection.set(undefined); this.results.set(''); this.nextCursor.set(undefined);
    if (this.project?.storeId !== 'github.com' || this.project.projectId !== 'datatug-demo-project@datatug@demo-project-1' ||
        !dataset || !DEMODB_DATASETS.includes(dataset as DemoDbDataset)) {
      this.error.set('This local Dev connection belongs to the shared DemoDB project.');
      return;
    }
    try {
      const connection = await this.source.connection(dataset);
      if (epoch !== this.epoch) return;
      if (!connection || connection.storage !== 'indexeddb' || connection.environment !== 'Dev') {
        this.error.set('Copy this DemoDB edition to local Dev before querying it.');
        return;
      }
      this.connection.set(connection);
      this.table.set(connection.tables[0]?.name ?? '');
      this.filterField.set(''); this.orderField.set(''); this.nextCursor.set(undefined); this.results.set('');
      this.error.set('');
    } catch {
      if (epoch === this.epoch) this.error.set('The local Dev connection could not be opened.');
    }
  }

  protected backHref(): string { return projectPageHref(this.project); }
  protected fields(): readonly string[] { return this.connection()?.tables.find((entry) => entry.name === this.table())?.columns.map((field) => field.name) ?? []; }
  private resetQuery(): void { this.queryVersion++; this.nextCursor.set(undefined); this.results.set(''); this.error.set(''); }
  protected setFilterField(value: string): void { this.filterField.set(value); this.resetQuery(); }
  protected setOperator(value: Operator): void { this.operator.set(value); this.resetQuery(); }
  protected setFilterValue(value: string): void { this.filterValue.set(value); this.resetQuery(); }
  protected setOrderField(value: string): void { this.orderField.set(value); this.resetQuery(); }
  protected setDirection(value: 'asc' | 'desc'): void { this.direction.set(value); this.resetQuery(); }
  protected selectTable(value: string): void {
    if (!this.connection()?.tables.some((entry) => entry.name === value)) return;
    this.table.set(value); this.filterField.set(''); this.orderField.set(''); this.resetQuery();
  }
  protected setPageSize(value: string | number | null | undefined): void {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100) { this.pageSize.set(parsed); this.resetQuery(); }
  }

  protected async run(next: boolean): Promise<void> {
    const connection = this.connection();
    const table = this.table();
    if (!connection || !connection.tables.some((entry) => entry.name === table) || this.running()) return;
    const allowed = new Set(this.fields());
    if ((this.filterField() && !allowed.has(this.filterField())) || (this.orderField() && !allowed.has(this.orderField()))) {
      this.error.set('Select a field from this table.'); return;
    }
    const dataset = connection.dataset;
    let value: unknown;
    try { value = this.filterField() ? this.typedFilterValue(table, this.filterField(), this.filterValue()) : undefined; }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Invalid filter value.'); return; }
    const filters: Filter[] = this.filterField()
      ? [{ field: this.filterField(), operator: this.operator(), value }]
      : [];
    const orders: Order[] = this.orderField() ? [{ field: this.orderField(), direction: this.direction() }] : [];
    const cursor = next ? this.nextCursor() : undefined;
    const version = this.queryVersion;
    this.running.set(true); this.error.set('');
    try {
      const page = await this.source.query<Row>(dataset, table, {
        filters, orders, limit: this.pageSize(), ...(cursor ? { startAfter: cursor } : {}),
      });
      if (version !== this.queryVersion || connection !== this.connection()) return;
      this.results.set(JSON.stringify(page.records.map((record) => ({ key: record.key.path, data: record.data })), null, 2));
      this.nextCursor.set(page.nextCursor);
    } catch (error) {
      if (version === this.queryVersion) this.error.set(error instanceof Error ? error.message : 'Local query failed.');
    } finally { this.running.set(false); }
  }

  private typedFilterValue(table: string, field: string, input: string): string | number | boolean {
    const type = this.connection()?.tables.find((entry) => entry.name === table)?.columns.find((entry) => entry.name === field)?.type.toUpperCase() ?? '';
    if (/^(?:BOOL|BOOLEAN)(?:\b|$)/.test(type)) {
      if (input === '0' || input.toLowerCase() === 'false') return false;
      if (input === '1' || input.toLowerCase() === 'true') return true;
      throw new Error('Boolean filters need 0, 1, true, or false.');
    }
    if (/^(?:INTEGER|INT|BIGINT|SMALLINT|TINYINT)(?:\b|$)/.test(type)) {
      if (input.length > 1100 || !/^-?(?:0|[1-9]\d*)$/.test(input)) throw new Error('Integer filters need an integer value.');
      const number = Number(input);
      return Number.isSafeInteger(number) ? number : input;
    }
    if (/^(?:DECIMAL_TEXT|DECIMAL|NUMERIC|REAL|FLOAT|DOUBLE)(?:\b|$)/.test(type)) {
      if (input.length > 1100 || !/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(input)) {
        throw new Error('Numeric filters need a decimal value.');
      }
      return input;
    }
    return input;
  }

  ngOnDestroy(): void { this.epoch++; this.stop.next(); this.stop.complete(); }
}
