// The record view of a table in an OVDB database, with Edit and Delete when — and
// only when — the database descriptor allows them (ovdbRecordActions). Used by the
// DemoDB local SQLite explorer and by any hosted OVDB connection; a read-only
// descriptor renders the same view with no mutation controls.
//
// Flow: view ─Edit─▶ edit form ─Save─▶ (update) ─▶ view + `changed('saved')` (the host refreshes the rows)
//                               └Cancel─▶ view
//       view ─Delete─▶ confirmation ─Delete─▶ (delete) ─▶ `changed('deleted')` (the host clears the selection)
//                                    └Cancel─▶ view
// Failures stay on the record with a readable message (describeOvdbError).
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonCheckbox,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSpinner,
} from '@ionic/angular';
import { ovdbCollectionSchema, ovdbRecordActions, type OvdbConnection } from '../../../../ovdb/ovdb-connection';
import { OvdbConfirmService } from '../../../../ovdb/ovdb-confirm.service';
import {
  displayOvdbValue,
  initialOvdbInput,
  ovdbFormFields,
  ovdbRecordChanges,
  parseOvdbInput,
  type OvdbDisplayValue,
  type OvdbFieldInput,
  type OvdbFormField,
} from '../../../../ovdb/ovdb-record-form';
import { createOvdbRecord, ovdbCreateKeyField, type OvdbRow, deleteOvdbRecord, describeOvdbError, updateOvdbRecord } from '../../../../ovdb/ovdb-records';

export type OvdbRecordChange = 'saved' | 'deleted';

@Component({
  selector: 'sneat-datatug-ovdb-record-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonCheckbox,
    IonInput,
    IonItem,
    IonLabel,
    IonList,
    IonNote,
    IonSpinner,
  ],
  template: `
    @if (displayRecord(); as rec) {
      <ion-card data-testid="ovdb-record">
        <ion-card-header>
          <ion-card-title>{{ collection() }} · {{ creating() ? 'Create record' : keyLabel() }}</ion-card-title>
          @if (!editing() && !creating()) {
            <ion-buttons>
              @if (actions().edit) {
                <ion-button data-testid="record-edit" fill="outline" size="small" [disabled]="busy()" (click)="startEdit()">Edit</ion-button>
              }
              @if (actions().delete) {
                <ion-button data-testid="record-delete" fill="outline" size="small" color="danger" [disabled]="busy()" (click)="deleteRecord()">Delete</ion-button>
              }
              @if (actions().reason) {
                <ion-note data-testid="record-actions-reason" [title]="actions().reason" [attr.aria-label]="actions().reason">
                  Read-only table ⓘ
                </ion-note>
              }
            </ion-buttons>
          }
        </ion-card-header>
        <ion-list lines="full">
          @for (field of fields(); track field.name) {
            <ion-item [attr.data-testid]="'record-field-' + field.name">
              <ion-label position="stacked">
                {{ field.name }}
                <ion-note>{{ field.declaredType }}{{ field.key ? ' · primary key' : '' }}</ion-note>
              </ion-label>
              @if ((editing() || creating()) && field.editable) {
                <ion-input
                  [attr.data-testid]="'record-input-' + field.name"
                  [attr.aria-label]="field.name"
                  type="text"
                  [inputmode]="inputMode(field)"
                  [value]="inputOf(field).text"
                  [disabled]="inputOf(field).isNull || busy()"
                  [placeholder]="inputOf(field).isNull ? 'NULL' : ''"
                  (ionInput)="setText(field, $any($event).detail?.value)"
                />
                @if (field.nullable) {
                  <ion-checkbox
                    slot="end"
                    labelPlacement="end"
                    [attr.data-testid]="'record-null-' + field.name"
                    [checked]="inputOf(field).isNull"
                    [disabled]="busy()"
                    (ionChange)="setNull(field, $any($event).detail?.checked === true)"
                    >NULL</ion-checkbox
                  >
                }
                @if (errors()[field.name]; as fieldError) {
                  <ion-note color="danger" role="alert">{{ fieldError }}</ion-note>
                }
              } @else {
                @let shown = display(field, rec[field.name]);
                <div class="ovdb-value" [class.ovdb-null]="shown.kind !== 'value'" [attr.data-value-kind]="shown.kind">{{ shown.text }}</div>
                @if (editing() && field.lockedReason) {
                  <ion-note>{{ field.lockedReason }}</ion-note>
                }
              }
            </ion-item>
          }
        </ion-list>
        <ion-card-content>
          @if (editing() || creating()) {
            <ion-button data-testid="record-save" [disabled]="busy()" (click)="save()">
              @if (busy()) {
                <ion-spinner name="dots" />
              } @else {
                {{ creating() ? 'Create record' : 'Save' }}
              }
            </ion-button>
            <ion-button data-testid="record-cancel" fill="clear" [disabled]="busy()" (click)="cancelEdit()">Cancel</ion-button>
          }
          @if (error()) {
            <p class="ovdb-error" role="alert" data-testid="record-error">{{ error() }}</p>
          }
          @if (notice()) {
            <p role="status" data-testid="record-notice">{{ notice() }}</p>
          }
        </ion-card-content>
      </ion-card>
    }
  `,
  styles: `
    .ovdb-value { padding: 4px 0 8px; white-space: pre-wrap; word-break: break-word; }
    .ovdb-null { color: var(--dt-text-muted); font-style: italic; }
    .ovdb-error { color: var(--ion-color-danger); }
  `,
})
export class OvdbRecordEditorComponent {
  private readonly confirmService = inject(OvdbConfirmService);

  readonly connection = input.required<OvdbConnection>();
  readonly collection = input.required<string>();
  readonly record = input<Readonly<Record<string, unknown>> | undefined>(undefined);
  readonly changed = output<OvdbRecordChange>();
  readonly creating = input(false);
  readonly created = output<OvdbRow>();
  readonly cancelled = output<void>();
  protected readonly displayRecord = computed(() => this.creating() ? {} : this.record());

  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly inputs = signal<Readonly<Record<string, OvdbFieldInput>>>({});
  protected readonly errors = signal<Readonly<Record<string, string>>>({});
  protected readonly error = signal('');
  protected readonly notice = signal('');
  #confirmingDelete = false;

  protected readonly actions = computed(() => ovdbRecordActions(this.connection().descriptor, this.collection()));
  protected readonly fields = computed(() =>
    ovdbFormFields(ovdbCollectionSchema(this.connection().descriptor, this.collection()), this.record() ?? {}).map((field) =>
      this.creating() && field.key ? { ...field, editable: true, lockedReason: undefined } : field),
  );
  protected readonly keyLabel = computed(() => {
    const keyField = this.actions().keyField;
    const record = this.record();
    return keyField && record ? `${keyField} ${String(record[keyField])}` : 'record';
  });

  constructor() {
    // A different record (or table) leaves edit mode and clears messages.
    effect(() => {
      this.record();
      this.collection();
      const creating = this.creating();
      untracked(() => {
        this.editing.set(false);
        this.errors.set({});
        this.error.set('');
        if (creating) this.startEdit();
      });
    });
  }

  protected display(field: OvdbFormField, value: unknown): OvdbDisplayValue {
    return displayOvdbValue(field, value);
  }

  protected inputMode(field: OvdbFormField): string {
    return field.kind === 'integer' ? 'numeric' : field.kind === 'decimal' || field.kind === 'number' ? 'decimal' : 'text';
  }

  protected inputOf(field: OvdbFormField): OvdbFieldInput {
    return this.inputs()[field.name] ?? { text: '', isNull: false };
  }

  startEdit(): void {
    const record = this.record() ?? {};
    const inputs: Record<string, OvdbFieldInput> = {};
    for (const field of this.fields()) {
      if (field.editable) inputs[field.name] = this.creating()
        ? { text: '', isNull: field.nullable }
        : initialOvdbInput(field, record[field.name]);
    }
    this.inputs.set(inputs);
    this.errors.set({});
    this.error.set('');
    this.notice.set('');
    this.editing.set(true);
  }

  cancelEdit(): void {
    if (this.creating()) this.cancelled.emit();
    this.editing.set(false);
    this.errors.set({});
    this.error.set('');
  }

  setText(field: OvdbFormField, value: string | null | undefined): void {
    this.inputs.update((inputs) => ({ ...inputs, [field.name]: { text: value ?? '', isNull: false } }));
  }

  setNull(field: OvdbFormField, isNull: boolean): void {
    this.inputs.update((inputs) => ({
      ...inputs,
      [field.name]: { text: inputs[field.name]?.text ?? '', isNull },
    }));
  }

  async save(): Promise<void> {
    if (this.creating()) return this.create();
    const record = this.record();
    const keyField = this.actions().keyField;
    if (!record || !keyField || !this.actions().edit || this.busy()) return;
    const { changes, errors } = ovdbRecordChanges(this.fields(), record, this.inputs());
    this.errors.set(errors);
    this.error.set('');
    if (Object.keys(errors).length) return;
    if (Object.keys(changes).length === 0) {
      this.editing.set(false);
      this.notice.set('No changes to save.');
      return;
    }
    this.busy.set(true);
    try {
      await updateOvdbRecord(this.connection(), this.collection(), record[keyField] as string | number, changes);
      this.editing.set(false);
      this.notice.set('Saved.');
      this.changed.emit('saved');
    } catch (error) {
      this.error.set(describeOvdbError(error, 'save'));
    } finally {
      this.busy.set(false);
    }
  }

  private async create(): Promise<void> {
    const keyField = ovdbCreateKeyField(this.connection().descriptor, this.collection());
    if (!keyField || this.busy()) return;
    const data: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    for (const field of this.fields()) {
      if (!field.editable) continue;
      const parsed = parseOvdbInput(field, this.inputOf(field));
      if (parsed.ok) data[field.name] = parsed.value;
      else errors[field.name] = parsed.error;
    }
    const key = data[keyField];
    if (typeof key === 'string' && (!key.trim() || key.includes('/'))) errors[keyField] = 'Enter a non-empty record key without slashes.';
    this.errors.set(errors);
    this.error.set('');
    if (Object.keys(errors).length) return;
    this.busy.set(true);
    try {
      this.created.emit(await createOvdbRecord(this.connection(), this.collection(), data));
    } catch (error) {
      this.error.set(describeOvdbError(error, 'save'));
    } finally {
      this.busy.set(false);
    }
  }

  async deleteRecord(): Promise<void> {
    const record = this.record();
    const keyField = this.actions().keyField;
    if (!record || !keyField || !this.actions().delete || this.busy() || this.#confirmingDelete) return;
    const id = record[keyField] as string | number;
    // A second click while the dialog is open must not open another one.
    this.#confirmingDelete = true;
    let confirmed: boolean;
    try {
      confirmed = await this.confirmService.confirm({
        header: 'Delete record?',
        message: `Delete ${this.collection()} ${keyField} ${String(id)}? This cannot be undone (except by resetting the database).`,
        confirmText: 'Delete',
      });
    } finally {
      this.#confirmingDelete = false;
    }
    if (!confirmed) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await deleteOvdbRecord(this.connection(), this.collection(), id);
      this.changed.emit('deleted');
    } catch (error) {
      this.error.set(describeOvdbError(error, 'delete'));
    } finally {
      this.busy.set(false);
    }
  }
}
