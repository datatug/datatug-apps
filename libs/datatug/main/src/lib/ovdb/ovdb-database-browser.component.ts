// Browses one OVDB database: a header (with Reset Database when the descriptor
// says `reset`), the table list, and a table's rows with the record view.
// Every mutation control is decided by the descriptor's capabilities.
//
// Flow (routes are the host's, given as `basePath`):
//   <basePath>                 table list ─click─▶ <basePath>/table/<name>
//   <basePath>/table/<name>    rows ─click─▶ record (edit / delete) ; "All tables" ─▶ <basePath>
//   header: Reset Database ─▶ confirmation ─▶ POST reset ─▶ descriptor re-read and verified ─▶ rows reloaded
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSpinner,
} from '@ionic/angular';
import { OvdbRecordEditorComponent, type OvdbRecordChange } from '../pages/signed-in/env-db-table/ovdb-record-editor/ovdb-record-editor.component';
import {
  fetchOvdbDescriptor,
  ovdbCollections,
  ovdbUiCapabilities,
  type OvdbConnection,
  type OvdbDescriptor,
} from './ovdb-connection';
import { OvdbConfirmService } from './ovdb-confirm.service';
import { displayOvdbValue, ovdbFormFields, type OvdbDisplayValue } from './ovdb-record-form';
import { OVDB_PAGE_SIZE, describeOvdbError, listOvdbRows, resetOvdbDatabase, type OvdbRow } from './ovdb-records';
import { ovdbCollectionSchema } from './ovdb-connection';

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
    IonItem,
    IonLabel,
    IonList,
    IonNote,
    IonSpinner,
    OvdbRecordEditorComponent,
  ],
  template: `
    <ion-card data-testid="ovdb-database-header">
      <ion-card-header>
        <ion-card-title>{{ connection().title }}</ion-card-title>
        <p class="ovdb-subtitle">
          {{ tables().length }} tables ·
          {{ caps().edit || caps().delete ? 'editable' : 'read-only' }}
          @if (statusText()) {
            · <span data-testid="ovdb-status">{{ statusText() }}</span>
          }
        </p>
      </ion-card-header>
      @if (caps().reset || resetMessage() || resetError()) {
        <ion-card-content>
          @if (caps().reset) {
            <ion-button data-testid="reset-database" color="danger" fill="outline" size="small" [disabled]="resetting()" (click)="resetDatabase()">
              @if (resetting()) {
                <ion-spinner name="dots" />
              } @else {
                Reset Database
              }
            </ion-button>
          }
          @if (resetMessage()) {
            <p role="status" data-testid="reset-message">{{ resetMessage() }}</p>
          }
          @if (resetError()) {
            <p role="alert" class="ovdb-error" data-testid="reset-error">{{ resetError() }}</p>
          }
        </ion-card-content>
      }
    </ion-card>

    @if (!caps().browse) {
      <ion-card><ion-card-content role="alert">This database cannot be browsed: it does not accept queries.</ion-card-content></ion-card>
    } @else if (!table()) {
      <ion-card data-testid="ovdb-table-list">
        <ion-card-header><ion-card-title>Tables</ion-card-title></ion-card-header>
        <ion-list lines="full">
          @for (name of tables(); track name) {
            <ion-item button [routerLink]="[...basePath(), 'table', name]" [attr.data-testid]="'table-' + name">
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
          <ion-button fill="outline" [routerLink]="basePath()">All tables</ion-button>
        </ion-card-content>
      </ion-card>
    } @else {
      <ion-card data-testid="ovdb-table">
        <ion-card-header>
          <ion-card-title>{{ table() }}
            @if (rows(); as list) {
              <ion-badge color="medium">{{ list.length }}{{ list.length === pageSize ? '+' : '' }}</ion-badge>
            }
          </ion-card-title>
          <p class="ovdb-subtitle"><a [routerLink]="basePath()">All tables</a></p>
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
                  <tr>@for (column of columns(); track column) { <th>{{ column }}</th> }</tr>
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
                        <td [class.ovdb-null]="value.kind !== 'value'" [attr.data-cell-kind]="value.kind">{{ value.text }}</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (rows()!.length === pageSize) {
              <ion-note>Showing the first {{ pageSize }} rows.</ion-note>
            }
          }
        </ion-card-content>
      </ion-card>
      @if (selected(); as row) {
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
    .ovdb-subtitle { margin: 4px 0 0; color: var(--ion-color-medium); font-size: 14px; }
  `,
})
export class OvdbDatabaseBrowserComponent {
  private readonly confirmService = inject(OvdbConfirmService);

  readonly connection = input.required<OvdbConnection>();
  /** Router path of the table list; tables open at `[...basePath, 'table', name]`. */
  readonly basePath = input.required<readonly string[]>();
  readonly table = input<string | undefined>(undefined);
  /** Extra status shown in the header (for example "Local copy ready"). */
  readonly statusText = input<string>('');
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
  protected readonly rows = signal<readonly OvdbRow[] | undefined>(undefined);
  protected readonly loadError = signal('');
  protected readonly selectedKey = signal<string | undefined>(undefined);
  protected readonly selected = computed(() => this.rows()?.find((row) => row.key === this.selectedKey()));
  protected readonly columns = computed(() => {
    const table = this.table();
    const schema = table ? ovdbCollectionSchema(this.liveConnection().descriptor, table) : undefined;
    const declared = Object.keys(schema?.fields ?? {});
    if (declared.length) return declared;
    return [...new Set((this.rows() ?? []).flatMap((row) => Object.keys(row.data)))];
  });
  protected readonly resetting = signal(false);
  protected readonly resetMessage = signal('');
  protected readonly resetError = signal('');
  #loadEpoch = 0;
  #confirmingReset = false;

  constructor() {
    effect(() => {
      const connection = this.connection();
      const table = this.table();
      untracked(() => {
        this.descriptorOverride.set(undefined);
        this.selectedKey.set(undefined);
        void this.load(connection, table);
      });
    });
  }

  protected cell(column: string, value: unknown): OvdbDisplayValue {
    const table = this.table();
    const schema = table ? ovdbCollectionSchema(this.liveConnection().descriptor, table) : undefined;
    const field = ovdbFormFields(schema, { [column]: value }).find((f) => f.name === column);
    return field ? displayOvdbValue(field, value) : { text: String(value ?? ''), kind: value === null || value === undefined ? 'null' : 'value' };
  }

  /** Selects a row; for a key press, stops the page from scrolling on Space. */
  protected select(row: OvdbRow, event?: Event): void {
    event?.preventDefault();
    this.selectedKey.set(row.key);
  }

  reload(): Promise<void> {
    return this.load(this.liveConnection(), this.table());
  }

  private async load(connection: OvdbConnection, table: string | undefined): Promise<void> {
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
    } catch (error) {
      if (epoch !== this.#loadEpoch) return;
      this.rows.set(undefined);
      this.loadError.set(describeOvdbError(error, 'load'));
    }
  }

  protected async recordChanged(change: OvdbRecordChange): Promise<void> {
    if (change === 'deleted') this.selectedKey.set(undefined);
    await this.reload();
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
      await this.reload();
    } catch (error) {
      this.resetError.set(describeOvdbError(error, 'reset'));
    } finally {
      this.resetting.set(false);
    }
  }
}
