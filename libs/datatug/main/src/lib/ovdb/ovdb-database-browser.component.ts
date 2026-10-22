// Browses one OVDB database: a source status row (its "more actions" menu holds Reset database when the
// descriptor says `reset`), the table list, and a table's rows with the record view.
// Every mutation control is decided by the descriptor's capabilities.
//
// Flow (routes are the host's, given as `basePath`):
//   <basePath>                 table list ─click─▶ <basePath>/table/<name>
//   <basePath>/table/<name>    rows ─click─▶ record (edit / delete); the way back to <basePath> is the host page's
//                              header (back button), not a link inside the table card
//   source menu: Reset database ─▶ confirmation ─▶ POST reset ─▶ descriptor re-read and verified ─▶ rows reloaded
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonSpinner,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, ellipsisVertical } from 'ionicons/icons';
import { OvdbRecordEditorComponent, type OvdbRecordChange } from '../pages/signed-in/env-db-table/ovdb-record-editor/ovdb-record-editor.component';
import {
  fetchOvdbDescriptor,
  ovdbCollections,
  ovdbUiCapabilities,
  type OvdbConnection,
  type OvdbDescriptor,
} from './ovdb-connection';
import { ResultFooterComponent } from '../components/result-footer/result-footer.component';
import { OvdbConfirmService } from './ovdb-confirm.service';
import { displayOvdbValue, ovdbFormFields, type OvdbDisplayValue } from './ovdb-record-form';
import { getOvdbRecord, ovdbCreateKeyField, OVDB_PAGE_SIZE, describeOvdbError, listOvdbRows, resetOvdbDatabase, type OvdbRow } from './ovdb-records';
import { ovdbCollectionSchema } from './ovdb-connection';
import type { RelatedLogEvidenceLink } from '../pages/demo-logs/log-source-declarations';

addIcons({ addOutline, ellipsisVertical });

@Component({
  selector: 'sneat-datatug-ovdb-database-browser',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonBadge,
    IonButton,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonSpinner,
    OvdbRecordEditorComponent,
    ResultFooterComponent,
  ],
  template: `
    <section class="ovdb-source" data-testid="ovdb-database-header">
      <div class="ovdb-source-row">
        <div class="ovdb-source-summary">
          @if (showTitle()) {
            <h2 class="ovdb-source-title">{{ connection().title }}</h2>
          }
          <p class="ovdb-subtitle">
            {{ tables().length }} tables ·
            {{ caps().edit || caps().delete ? 'editable' : 'read-only' }}
            @if (statusText()) {
              · <span data-testid="ovdb-status">{{ statusText() }}</span>
            }
          </p>
        </div>
        @if (caps().reset || hasSourceActions()) {
          <button
            type="button"
            data-testid="source-menu"
            class="ovdb-source-menu-toggle"
            aria-label="More actions for this database"
            aria-haspopup="true"
            aria-controls="ovdb-source-menu"
            [attr.aria-expanded]="menuOpen()"
            (click)="menuOpen.set(!menuOpen())"
            (keydown.escape)="menuOpen.set(false)"
          >
            <ion-icon name="ellipsis-vertical" aria-hidden="true" />
          </button>
        }
      </div>
      @if (menuOpen() && (caps().reset || hasSourceActions())) {
        <ion-list id="ovdb-source-menu" class="ovdb-source-menu" lines="full" data-testid="source-menu-list" (click)="menuOpen.set(false)" (keydown.escape)="menuOpen.set(false)">
          @if (caps().reset) {
            <ion-item button detail="false" data-testid="reset-database" [disabled]="resetting()" (click)="resetDatabase()">
              <ion-label class="ovdb-danger-label">Reset database…</ion-label>
            </ion-item>
          }
          <ng-content select="[ovdbSourceAction]" />
        </ion-list>
      }
      @if (resetting()) {
        <p role="status" class="ovdb-subtitle"><ion-spinner name="dots" /> Resetting…</p>
      }
      @if (resetMessage()) {
        <p role="status" data-testid="reset-message">{{ resetMessage() }}</p>
      }
      @if (resetError()) {
        <p role="alert" class="ovdb-error" data-testid="reset-error">{{ resetError() }}</p>
      }
    </section>

    @if (!caps().browse) {
      <ion-card><ion-card-content role="alert">This database cannot be browsed: it does not accept queries.</ion-card-content></ion-card>
    } @else if (!table()) {
      <ion-card data-testid="ovdb-table-list">
        <ion-card-header><ion-card-title>Tables</ion-card-title></ion-card-header>
        <ion-list lines="full">
          @for (name of tables(); track name) {
            <ion-item button [routerLink]="[...basePath(), 'table', name]" [queryParams]="navigationQuery()" [attr.data-testid]="'table-' + name">
              <ion-label>{{ name }}</ion-label>
            </ion-item>
          } @empty {
            <ion-item><ion-label>No tables.</ion-label></ion-item>
          }
        </ion-list>
      </ion-card>
    } @else if (!tables().includes(table()!)) {
      <ion-card data-testid="ovdb-unknown-table">
        <ion-card-content>
          <p>There is no table “{{ table() }}” in this database.</p>
          <ion-button fill="outline" [routerLink]="basePath()" [queryParams]="navigationQuery()">All tables</ion-button>
        </ion-card-content>
      </ion-card>
    } @else {
      <ion-card data-testid="ovdb-table">
        <ion-card-header class="ovdb-table-header">
          <ion-card-title>{{ table() }}
            @if (rows(); as list) {
              <ion-badge color="medium">{{ list.length }}{{ list.length === pageSize ? '+' : '' }}</ion-badge>
            }
          </ion-card-title>
          @if (canCreate()) {
            <ion-button data-testid="record-create" size="small" [disabled]="creating() || resetting()" (click)="creating.set(true)">
              <ion-icon slot="start" name="add-outline" />
              Create record
            </ion-button>
          }
        </ion-card-header>
        <ion-card-content>
          @if (loadError()) {
            <p role="alert" class="ovdb-error" data-testid="rows-error">{{ loadError() }}</p>
            <ion-button size="small" fill="outline" (click)="reload()">Try again</ion-button>
          } @else if (!rows()) {
            <ion-spinner name="dots" />
          } @else {
            <div class="ovdb-grid-scroll">
              <table class="ovdb-grid" data-testid="ovdb-rows">
                <thead>
                  <tr>@for (column of columns(); track column) { <th [class.ovdb-num]="numericColumns().has(column)">{{ column }}</th> }</tr>
                </thead>
                <tbody>
                  @for (row of rows(); track row.key; let i = $index) {
                    <tr
                      tabindex="0"
                      [class.selected]="row.key === selectedKey()"
                      [attr.aria-current]="row.key === selectedKey() ? 'true' : null"
                      (click)="select(row)"
                      (keydown.enter)="select(row, $event)"
                      (keydown.space)="select(row, $event)"
                      [attr.data-testid]="'row-' + i"
                    >
                      @for (column of columns(); track column) {
                        @let value = cell(column, row.data[column]);
                        <td [class.ovdb-null]="value.kind !== 'value'" [class.ovdb-num]="numericColumns().has(column)" [attr.data-cell-kind]="value.kind">{{ value.text }}</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </ion-card-content>
        @if (rows()?.length === pageSize) {
          <sneat-datatug-result-footer data-testid="rows-limit-note">Showing the first {{ pageSize }} rows.</sneat-datatug-result-footer>
        }
      </ion-card>
      @if (creating()) {
        <sneat-datatug-ovdb-record-editor
          [connection]="liveConnection()" [collection]="table()!" [creating]="true"
          (created)="recordCreated($event)" (cancelled)="creating.set(false)"
        />
      } @else if (selected(); as row) {
        @for (link of relatedEvidenceTargets(); track link.label) {
          <ion-button size="small" fill="outline" [routerLink]="link.path" [queryParams]="link.queryParams">{{ link.label }}</ion-button>
        }
        <sneat-datatug-ovdb-record-editor
          [connection]="liveConnection()"
          [collection]="table()!"
          [record]="row.data"
          (changed)="recordChanged($event)"
        />
      }
    }
  `,
  styles: `
    .ovdb-grid-scroll { overflow-x: auto; max-height: 50vh; }
    .ovdb-grid { border-collapse: collapse; font-size: 13px; width: 100%; }
    .ovdb-grid th, .ovdb-grid td { border-bottom: 1px solid var(--ion-color-light-shade); padding: 4px 8px; text-align: left; white-space: nowrap; max-width: 24em; overflow: hidden; text-overflow: ellipsis; }
    .ovdb-grid tbody tr { cursor: pointer; }
    .ovdb-grid tbody tr:focus-visible { outline: 2px solid var(--ion-color-primary); outline-offset: -2px; }
    .ovdb-null { color: var(--ion-color-medium); font-style: italic; }
    .ovdb-grid tr.selected { background: var(--ion-color-primary-tint); color: var(--ion-color-primary-contrast); }
    .ovdb-error { color: var(--ion-color-danger); }
    .ovdb-grid th.ovdb-num, .ovdb-grid td.ovdb-num { text-align: right; font-variant-numeric: tabular-nums; }
    .ovdb-subtitle { margin: 4px 0 0; color: var(--ion-color-medium); font-size: 14px; }
    /* The source status is a flat row, not a card: the page header already names the database. */
    .ovdb-source { margin: 12px 16px 0; }
    .ovdb-source-menu-toggle { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--ion-color-medium); font-size: 20px; cursor: pointer; }
    .ovdb-source-menu-toggle:hover { background: var(--ion-color-light-tint); }
    .ovdb-source-menu-toggle:focus-visible { outline: 2px solid var(--ion-color-primary); outline-offset: -2px; }
    .ovdb-source-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .ovdb-source-summary { min-width: 0; }
    .ovdb-source-summary .ovdb-subtitle { margin: 0; }
    .ovdb-source-title { margin: 0 0 2px; font-size: 18px; font-weight: 500; }
    .ovdb-source-menu { margin-top: 8px; border-radius: 4px; background: var(--ion-card-background, var(--ion-background-color, #fff)); }
    .ovdb-danger-label { color: var(--ion-color-danger); }
    /* Title and its primary action share one row; the action stays compact and right-aligned. */
    .ovdb-table-header { display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 8px; }
    .ovdb-table-header ion-card-title { min-width: 0; }
    .ovdb-table-header ion-button { flex: none; margin: 0; }
  `,
})
export class OvdbDatabaseBrowserComponent {
  private readonly confirmService = inject(OvdbConfirmService);

  readonly connection = input.required<OvdbConnection>();
  /** Router path of the table list; tables open at `[...basePath, 'table', name]`. */
  readonly basePath = input.required<readonly string[]>();
  readonly navigationQuery = input<Record<string, unknown>>({});
  readonly table = input<string | undefined>(undefined);
  /** Explicit record → evidence links declared by a project (log-source-declarations.ts), never inferred from the OVDB engine. */
  readonly relatedEvidence = input<readonly RelatedLogEvidenceLink[]>([]);
  protected readonly relatedEvidenceTargets = computed(() => {
    const row = this.selected();
    if (!row) return [];
    return this.relatedEvidence().flatMap((link) => {
      const value = row.data[link.field];
      if (this.table() !== link.collection || typeof link.queryParam !== 'string' || !link.queryParam ||
        value === null || value === undefined || value === '') return [];
      return [{ path: link.path, label: link.label ?? 'Related log evidence', queryParams: { ...link.queryParams, [link.queryParam]: String(value) } }];
    });
  });
  /** Deep-linked record id. Local keyed sources may load it beyond the first grid page. */
  readonly focusRecordId = input<string | undefined>();
  /** Extra status shown in the header (for example "Local copy ready"). */
  readonly statusText = input<string>('');
  /**
   * Show the database title above the status. A host whose page header already names the database turns
   * this off so the same name is not printed twice.
   */
  readonly showTitle = input<boolean>(true);
  /** True when the host projects its own `[ovdbSourceAction]` items into the source menu. */
  readonly hasSourceActions = input<boolean>(false);
  /** Added to the Reset Database confirmation (for example that a reset needs the network). */
  readonly resetNote = input<string>('');
  /** Emits the re-read descriptor after a successful reset. */
  readonly descriptorChange = output<OvdbDescriptor>();

  protected readonly pageSize = OVDB_PAGE_SIZE;
  private readonly descriptorOverride = signal<OvdbDescriptor | undefined>(undefined);
  /** The connection with the latest descriptor this component read. */
  protected readonly liveConnection = computed<OvdbConnection>(() => {
    const connection = this.connection();
    const descriptor = this.descriptorOverride();
    return descriptor ? { ...connection, descriptor } : connection;
  });
  protected readonly caps = computed(() => ovdbUiCapabilities(this.liveConnection().descriptor));
  protected readonly tables = computed(() => ovdbCollections(this.liveConnection().descriptor));
  protected readonly creating = signal(false);
  protected readonly createdRow = signal<OvdbRow | undefined>(undefined);
  protected readonly focusedRow = signal<OvdbRow | undefined>(undefined);
  protected readonly canCreate = computed(() => {
    const table = this.table();
    return !!table && !!ovdbCreateKeyField(this.liveConnection().descriptor, table);
  });
  protected readonly rows = signal<readonly OvdbRow[] | undefined>(undefined);
  protected readonly loadError = signal('');
  protected readonly selectedKey = signal<string | undefined>(undefined);
  protected readonly selected = computed(() => this.rows()?.find((row) => row.key === this.selectedKey()) ?? (this.focusedRow()?.key === this.selectedKey() ? this.focusedRow() : undefined) ?? (this.createdRow()?.key === this.selectedKey() ? this.createdRow() : undefined));
  /** Columns whose values are numbers (by declared type, else by the rows): right-aligned with tabular figures. */
  protected readonly numericColumns = computed<ReadonlySet<string>>(() => {
    const table = this.table();
    const schema = table ? ovdbCollectionSchema(this.liveConnection().descriptor, table) : undefined;
    const rows = this.rows() ?? [];
    const numeric = new Set<string>();
    for (const column of this.columns()) {
      const sample = rows.map((row) => row.data[column]).find((value) => value !== null && value !== undefined);
      const kind = ovdbFormFields(schema, { [column]: sample }).find((f) => f.name === column)?.kind;
      if (kind === 'integer' || kind === 'decimal' || kind === 'number') numeric.add(column);
    }
    return numeric;
  });
  /**
   * Fixed scale per fractional numeric column that declares none (SQLite REAL, Postgres float): the most fraction
   * digits among the loaded rows, so `51.3` and `32.38` line up as `51.30` and `32.38`. Display only; capped at 6.
   */
  protected readonly displayScales = computed<ReadonlyMap<string, number>>(() => {
    const scales = new Map<string, number>();
    const numeric = this.numericColumns();
    for (const column of this.columns()) {
      if (!numeric.has(column)) continue;
      let max = 0;
      let allNumbers = true;
      for (const row of this.rows() ?? []) {
        const value = row.data[column];
        if (value === null || value === undefined) continue;
        if (typeof value !== 'number') { allNumbers = false; break; }
        if (Number.isInteger(value) || !Number.isFinite(value)) continue;
        max = Math.max(max, Math.min(6, (String(value).split('.')[1] ?? '').length));
      }
      if (allNumbers && max > 0) scales.set(column, max);
    }
    return scales;
  });
  protected readonly columns = computed(() => {
    const table = this.table();
    const schema = table ? ovdbCollectionSchema(this.liveConnection().descriptor, table) : undefined;
    const declared = Object.keys(schema?.fields ?? {});
    if (declared.length) return declared;
    return [...new Set((this.rows() ?? []).flatMap((row) => Object.keys(row.data)))];
  });
  protected readonly menuOpen = signal(false);
  protected readonly resetting = signal(false);
  protected readonly resetMessage = signal('');
  protected readonly resetError = signal('');
  #loadEpoch = 0;
  #confirmingReset = false;

  constructor() {
    effect(() => {
      const connection = this.connection();
      const table = this.table();
      const focusRecordId = this.focusRecordId();
      untracked(() => {
        this.descriptorOverride.set(undefined);
        this.selectedKey.set(undefined);
        this.creating.set(false);
        this.createdRow.set(undefined);
        this.focusedRow.set(undefined);
        void this.load(connection, table, focusRecordId);
      });
    });
  }

  protected cell(column: string, value: unknown): OvdbDisplayValue {
    const table = this.table();
    const schema = table ? ovdbCollectionSchema(this.liveConnection().descriptor, table) : undefined;
    const field = ovdbFormFields(schema, { [column]: value }).find((f) => f.name === column);
    const scale = this.displayScales().get(column);
    if (field && scale !== undefined && field.scale === undefined && typeof value === 'number') {
      return displayOvdbValue({ kind: 'decimal', scale }, value);
    }
    return field ? displayOvdbValue(field, value) : { text: String(value ?? ''), kind: value === null || value === undefined ? 'null' : 'value' };
  }

  /** Selects a row; for a key press, stops the page from scrolling on Space. */
  protected select(row: OvdbRow, event?: Event): void {
    event?.preventDefault();
    this.creating.set(false);
    this.focusedRow.set(undefined);
    this.selectedKey.set(row.key);
  }

  reload(): Promise<void> {
    return this.load(this.liveConnection(), this.table());
  }

  private async load(connection: OvdbConnection, table: string | undefined, focusRecordId?: string): Promise<void> {
    const epoch = ++this.#loadEpoch;
    this.loadError.set('');
    if (!table || !ovdbCollections(connection.descriptor).includes(table) || !ovdbUiCapabilities(connection.descriptor).browse) {
      this.rows.set(undefined);
      return;
    }
    try {
      const rows = await listOvdbRows(connection, table);
      if (epoch !== this.#loadEpoch) return;
      this.rows.set(rows);
      const selectedFocusedKey = this.focusedRow()?.key === this.selectedKey() ? this.selectedKey() : undefined;
      const keyedId = focusRecordId ?? (selectedFocusedKey ? this.focusRecordId() : undefined);
      if (keyedId && this.liveConnection().descriptor.capabilities.read === true) {
        const row = await getOvdbRecord(connection, table, keyedId);
        if (epoch !== this.#loadEpoch) return;
        if (!focusRecordId && this.selectedKey() !== selectedFocusedKey) return;
        if (row) {
          this.focusedRow.set(row);
          if (focusRecordId) this.selectedKey.set(row.key);
        } else if (selectedFocusedKey) {
          this.focusedRow.set(undefined);
          this.selectedKey.set(undefined);
        }
      }
    } catch (error) {
      if (epoch !== this.#loadEpoch) return;
      this.rows.set(undefined);
      this.loadError.set(describeOvdbError(error, 'load'));
    }
  }

  protected async recordCreated(row: OvdbRow): Promise<void> {
    this.creating.set(false);
    this.createdRow.set(row);
    this.selectedKey.set(row.key);
    await this.reload();
  }

  protected async recordChanged(change: OvdbRecordChange): Promise<void> {
    if (change === 'deleted') { this.selectedKey.set(undefined); this.createdRow.set(undefined); }
    const created = this.createdRow();
    const table = this.table();
    const connection = this.liveConnection();
    await this.reload();
    if (change === 'saved' && created && table && !this.rows()?.some((row) => row.key === created.key)) {
      const keyField = ovdbCreateKeyField(connection.descriptor, table);
      if (keyField) {
        try {
          const row = await getOvdbRecord(connection, table, created.data[keyField] as string | number);
          if (this.table() === table && this.liveConnection() === connection) this.createdRow.set(row);
        } catch (error) {
          this.loadError.set(describeOvdbError(error, 'load'));
        }
      }
    }
  }

  async resetDatabase(): Promise<void> {
    if (!this.caps().reset || this.resetting() || this.#confirmingReset) return;
    const connection = this.liveConnection();
    // A second click while the dialog is open must not open another one.
    this.#confirmingReset = true;
    let confirmed: boolean;
    try {
      confirmed = await this.confirmService.confirm({
        header: 'Reset Database?',
        message: [
          `All your local changes to ${connection.title} will be lost and the original DemoDB data restored. This cannot be undone.`,
          this.resetNote(),
        ]
          .filter(Boolean)
          .join(' '),
        confirmText: 'Reset Database',
      });
    } finally {
      this.#confirmingReset = false;
    }
    if (!confirmed) return;
    const expectedSha = connection.descriptor.canonical?.sha256;
    this.resetting.set(true);
    this.resetMessage.set('');
    this.resetError.set('');
    try {
      await resetOvdbDatabase(connection);
      const descriptor = await fetchOvdbDescriptor(connection.fetch, connection.baseUrl, connection.databaseId);
      this.descriptorOverride.set(descriptor);
      this.descriptorChange.emit(descriptor);
      const shaMatches = !expectedSha || descriptor.canonical?.sha256 === expectedSha;
      if (descriptor.localState?.modified === true || !shaMatches) {
        this.resetError.set('The database was reset, but it still reports local changes. Reload the page and check the data.');
      } else {
        this.resetMessage.set(
          expectedSha
            ? `Database reset to the original DemoDB data (SHA-256 ${expectedSha.slice(0, 12)}…).`
            : 'Database reset to its original data.',
        );
      }
      this.selectedKey.set(undefined);
      this.createdRow.set(undefined);
      this.creating.set(false);
      await this.reload();
    } catch (error) {
      this.resetError.set(describeOvdbError(error, 'reset'));
    } finally {
      this.resetting.set(false);
    }
  }
}
