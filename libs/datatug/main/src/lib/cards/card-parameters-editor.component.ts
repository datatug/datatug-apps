import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import {
  IonButton,
  IonIcon,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonToggle,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, trashOutline } from 'ionicons/icons';
import type { CardMatchRule, CardParameterDef } from '@datatug/board-models';
import {
  MATCH_KIND_LABELS,
  MatchRuleKind,
  matchRuleKind,
  matchRuleOfKind,
} from './card-model';

addIcons({ addOutline, trashOutline });

export const PARAMETER_TYPES: readonly { value: string; label: string }[] = [
  { value: 'string', label: 'Text' },
  { value: 'integer', label: 'Whole number' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date and time' },
  { value: 'record', label: 'Record (one row)' },
  { value: 'recordset', label: 'Recordset (rows)' },
];

const isScalar = (type: string): boolean =>
  type !== 'record' && type !== 'recordset';

/**
 * Inputs of a card: what it needs before it can show anything, and which
 * grid cells fill each one (the match rules).
 */
@Component({
  selector: 'sneat-datatug-card-parameters-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonButton,
    IonIcon,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonToggle,
  ],
  template: `
    @for (param of parameters(); track $index; let i = $index) {
      <fieldset class="param" [attr.data-parameter-row]="i">
        <legend class="visually-hidden">Input {{ param.id || i + 1 }}</legend>
        <div class="row">
          <ion-input
            class="grow"
            label="Name"
            labelPlacement="stacked"
            placeholder="customerId"
            fill="outline"
            data-field="id"
            [value]="param.id"
            [disabled]="disabled()"
            (ionInput)="patch(i, { id: val($event) })"
          />
          <ion-select
            label="Type"
            labelPlacement="stacked"
            fill="outline"
            interface="popover"
            data-field="type"
            [value]="param.type"
            [disabled]="disabled()"
            (ionChange)="setType(i, val($event))"
          >
            @for (type of types; track type.value) {
              <ion-select-option [value]="type.value">{{
                type.label
              }}</ion-select-option>
            }
          </ion-select>
        </div>
        <div class="row">
          <ion-input
            class="grow"
            label="Label"
            labelPlacement="stacked"
            fill="outline"
            placeholder="Shown on the input form"
            data-field="title"
            [value]="param.title ?? ''"
            [disabled]="disabled()"
            (ionInput)="patch(i, { title: val($event) || undefined })"
          />
          @if (scalar(param.type)) {
            <ion-input
              class="grow"
              label="Default value"
              labelPlacement="stacked"
              fill="outline"
              data-field="default"
              [value]="defaultText(param)"
              [disabled]="disabled()"
              (ionInput)="setDefault(i, val($event))"
            />
          }
        </div>
        <div class="row actions">
          <ion-toggle
            data-field="required"
            [checked]="param.isRequired === true"
            [disabled]="disabled()"
            (ionChange)="patch(i, { isRequired: $any($event).detail.checked })"
            >Required</ion-toggle
          >
          <ion-button
            fill="clear"
            size="small"
            color="danger"
            [disabled]="disabled()"
            data-action="remove-parameter"
            [attr.aria-label]="'Remove input ' + (param.id || i + 1)"
            (click)="remove(i)"
          >
            <ion-icon slot="start" name="trash-outline" />
            Remove
          </ion-button>
        </div>

        @if (scalar(param.type)) {
          <div class="rules">
            <h4>Fill from selected cells</h4>
            @if (!(param.match ?? []).length) {
              <p class="hint">
                Add a rule and selecting a matching cell in a table or query
                result fills this input with the cell's value.
              </p>
            }
            @for (rule of param.match ?? []; track $index; let r = $index) {
              <div class="rule" [attr.data-rule-row]="r">
                <ion-select
                  class="kind"
                  aria-label="Rule type"
                  fill="outline"
                  interface="popover"
                  data-field="rule-kind"
                  [value]="kindOf(rule)"
                  [disabled]="disabled()"
                  (ionChange)="setRuleKind(i, r, val($event))"
                >
                  @for (kind of kinds; track kind) {
                    <ion-select-option [value]="kind">{{
                      kindLabels[kind]
                    }}</ion-select-option>
                  }
                </ion-select>
                @switch (kindOf(rule)) {
                  @case ('entity') {
                    <ion-input
                      aria-label="Entity"
                      placeholder="Customer"
                      fill="outline"
                      data-field="rule-entity"
                      [value]="rule['entity'] ?? ''"
                      [disabled]="disabled()"
                      (ionInput)="patchRule(i, r, 'entity', val($event))"
                    />
                    <ion-input
                      aria-label="Field"
                      placeholder="CustomerID"
                      fill="outline"
                      data-field="rule-field"
                      [value]="rule['field'] ?? ''"
                      [disabled]="disabled()"
                      (ionInput)="patchRule(i, r, 'field', val($event))"
                    />
                  }
                  @case ('table') {
                    <ion-input
                      aria-label="Table"
                      placeholder="Orders or dbo.Ord*"
                      fill="outline"
                      data-field="rule-table"
                      [value]="rule['table'] ?? ''"
                      [disabled]="disabled()"
                      (ionInput)="patchRule(i, r, 'table', val($event))"
                    />
                    <ion-input
                      aria-label="Column"
                      placeholder="CustomerID"
                      fill="outline"
                      data-field="rule-column"
                      [value]="rule['column'] ?? ''"
                      [disabled]="disabled()"
                      (ionInput)="patchRule(i, r, 'column', val($event))"
                    />
                  }
                  @default {
                    <ion-input
                      aria-label="Column"
                      placeholder="CustomerID or *Customer*"
                      fill="outline"
                      data-field="rule-column"
                      [value]="rule['column'] ?? ''"
                      [disabled]="disabled()"
                      (ionInput)="patchRule(i, r, 'column', val($event))"
                    />
                  }
                }
                <ion-button
                  fill="clear"
                  size="small"
                  color="medium"
                  [disabled]="disabled()"
                  aria-label="Remove rule"
                  data-action="remove-rule"
                  (click)="removeRule(i, r)"
                >
                  <ion-icon slot="icon-only" name="trash-outline" />
                </ion-button>
              </div>
            }
            <div class="row actions">
              <ion-button
                fill="clear"
                size="small"
                data-action="add-rule"
                [disabled]="disabled()"
                (click)="addRule(i)"
              >
                <ion-icon slot="start" name="add-outline" />
                Add rule
              </ion-button>
            </div>
            @if ((param.match ?? []).length) {
              <p class="hint">
                Names ignore case. Use <code>*</code> for any text and
                <code>?</code> for one character, for example
                <code>Customer*</code>.
                @if (param.isRequired !== true) {
                  <strong class="warn">
                    Rules apply only to required inputs.</strong
                  >
                }
              </p>
            }
          </div>
        }
      </fieldset>
    }
    <ion-button
      fill="outline"
      size="small"
      data-action="add-parameter"
      [disabled]="disabled()"
      (click)="add()"
    >
      <ion-icon slot="start" name="add-outline" />
      Add input
    </ion-button>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .param {
        margin: 0 0 1rem;
        padding: 0 0 0 0.75rem;
        border: 0;
        border-left: 3px solid var(--ion-color-step-250, #c8c8c8);
        display: grid;
        gap: 0.5rem;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
      }
      .row > * {
        min-width: 9rem;
      }
      .row.actions {
        justify-content: space-between;
      }
      .grow {
        flex: 1 1 12rem;
      }
      .rules h4 {
        margin: 0.25rem 0;
        font-size: 0.95rem;
      }
      .rule {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
        margin-bottom: 0.5rem;
      }
      .rule > ion-input {
        flex: 1 1 8rem;
      }
      .rule .kind {
        flex: 0 0 11rem;
      }
      .hint {
        margin: 0.25rem 0;
        font-size: 0.85rem;
        color: var(--ion-color-medium-shade);
      }
      .warn {
        color: var(--ion-color-warning-shade);
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
    `,
  ],
})
export class CardParametersEditorComponent {
  readonly parameters = input.required<readonly CardParameterDef[]>();
  readonly disabled = input(false);
  readonly parametersChange = output<CardParameterDef[]>();

  protected readonly types = PARAMETER_TYPES;
  protected readonly kinds: MatchRuleKind[] = ['entity', 'table', 'column'];
  protected readonly kindLabels = MATCH_KIND_LABELS;

  protected val(event: unknown): string {
    const value = (event as { detail?: { value?: unknown } }).detail?.value;
    return value == null ? '' : String(value);
  }
  protected scalar = isScalar;
  protected kindOf(rule: CardMatchRule): MatchRuleKind {
    return matchRuleKind(rule);
  }
  protected defaultText(param: CardParameterDef): string {
    return param.defaultValue == null ? '' : String(param.defaultValue);
  }

  private emit(next: CardParameterDef[]): void {
    this.parametersChange.emit(next);
  }
  private change(
    index: number,
    fn: (param: CardParameterDef) => CardParameterDef,
  ): void {
    this.emit(
      this.parameters().map((p, i) => (i === index ? fn({ ...p }) : p)),
    );
  }

  add(): void {
    const taken = new Set(this.parameters().map((p) => p.id));
    let n = this.parameters().length + 1;
    while (taken.has(`input${n}`)) n++;
    this.emit([
      ...this.parameters(),
      { id: `input${n}`, type: 'string', isRequired: true, match: [] },
    ]);
  }
  remove(index: number): void {
    this.emit(this.parameters().filter((_, i) => i !== index));
  }
  patch(index: number, change: Partial<CardParameterDef>): void {
    this.change(index, (p) => {
      const next = { ...p, ...change };
      for (const key of Object.keys(next) as (keyof CardParameterDef)[])
        if (next[key] === undefined) delete next[key];
      return next;
    });
  }
  setType(index: number, type: string): void {
    this.change(index, (p) => {
      const next = { ...p, type };
      // Supplied rows carry no default and no cell rules.
      if (!isScalar(type)) {
        delete next.defaultValue;
        delete next.match;
      }
      return next;
    });
  }
  setDefault(index: number, text: string): void {
    this.change(index, (p) => {
      const next = { ...p };
      if (text === '') delete next.defaultValue;
      else if (['integer', 'number'].includes(p.type) && !isNaN(Number(text)))
        next.defaultValue = Number(text);
      else if (p.type === 'boolean')
        next.defaultValue = text.toLowerCase() === 'true';
      else next.defaultValue = text;
      return next;
    });
  }

  addRule(index: number): void {
    this.change(index, (p) => ({
      ...p,
      match: [...(p.match ?? []), { column: '' }],
    }));
  }
  removeRule(index: number, rule: number): void {
    this.change(index, (p) => {
      const match = (p.match ?? []).filter((_, i) => i !== rule);
      const { match: _old, ...rest } = p;
      void _old;
      return match.length ? { ...rest, match } : rest;
    });
  }
  setRuleKind(index: number, rule: number, kind: string): void {
    this.change(index, (p) => ({
      ...p,
      match: (p.match ?? []).map((r, i) =>
        i === rule ? matchRuleOfKind(kind as MatchRuleKind, r) : r,
      ),
    }));
  }
  patchRule(index: number, rule: number, key: string, value: string): void {
    this.change(index, (p) => ({
      ...p,
      match: (p.match ?? []).map((r, i) =>
        i === rule ? ({ ...r, [key]: value } as CardMatchRule) : r,
      ),
    }));
  }
}
