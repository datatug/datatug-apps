import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  IonInput,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonTextarea,
  IonLabel,
} from '@ionic/angular';
import type {
  BoardCard,
  BoardParameterDef,
  BoardWidget,
  CardParameterDef,
  ChartWidgetDef,
} from '@datatug/board-models';
import { BoardChartEditorComponent } from '../board/ui/pages/board/board-chart-editor.component';
import type { IProjectRef } from '../core/project-context';
import {
  bindingChoice,
  bindingValue,
  fieldsToText,
  getSource,
  isEditableKind,
  setSource,
  textToFields,
  WIDGET_KIND_LABELS,
  WidgetSource,
  withBinding,
} from './card-widget-model';

/** A saved query the widget pickers offer. */
export interface CardQueryChoice {
  id: string;
  title?: string;
  parameters?: readonly { id: string; type?: string; isRequired?: boolean }[];
}

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Edits one widget of a card tab: text, fields of one record, a grid of rows
 * and a chart. Row sources are a saved query (with its parameters bound to
 * card inputs or fixed values) or a card input that carries the rows.
 */
@Component({
  selector: 'sneat-datatug-card-widget-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BoardChartEditorComponent,
    NgTemplateOutlet,
    IonInput,
    IonLabel,
    IonSegment,
    IonSegmentButton,
    IonSelect,
    IonSelectOption,
    IonTextarea,
  ],
  template: `
    @let w = widget();
    @let name = w.name;
    <div class="widget" [attr.data-widget-kind]="name">
      @if (kindKnown()) {
        <ion-input
          label="Heading"
          labelPlacement="stacked"
          fill="outline"
          placeholder="Optional"
          data-field="widget-title"
          [value]="data()['title'] ?? ''"
          [disabled]="disabled()"
          (ionInput)="setData({ title: val($event) || undefined })"
        />
      }
      @switch (name) {
        @case ('text') {
          <ion-textarea
            label="Text (Markdown)"
            labelPlacement="stacked"
            fill="outline"
            [autoGrow]="true"
            [rows]="4"
            data-field="markdown"
            [value]="data()['markdown'] ?? ''"
            [disabled]="disabled()"
            (ionInput)="setData({ markdown: val($event) })"
          />
          <p class="hint">
            Insert an input with <code>{{ '{{name}}' }}</code> or a column of a
            record with <code>{{ '{{name.Column}}' }}</code>. Only http, https
            and mailto links open.
          </p>
        }
        @case ('fields') {
          <ng-container [ngTemplateOutlet]="sourceEditor" />
          <ion-textarea
            label="Columns to show"
            labelPlacement="stacked"
            fill="outline"
            [autoGrow]="true"
            [rows]="2"
            placeholder="One per line: Column, or Column = Label. Empty shows all."
            data-field="fields"
            [value]="fieldsText()"
            [disabled]="disabled()"
            (ionInput)="setData({ fields: toFields(val($event)) })"
          />
        }
        @case ('SQL') {
          <ng-container [ngTemplateOutlet]="sourceEditor" />
          @if (source()?.kind === 'query' && chartCard(); as card) {
            <details class="chart-disclosure">
              <summary>Show as a chart instead</summary>
              <sneat-datatug-board-chart-editor
                [card]="card"
                [queries]="queries()"
                [project]="project()"
                [scopeIdentity]="scopeIdentity()"
                [boardParameters]="boardParameters()"
                [disabled]="disabled()"
                (definition)="chartChosen($event)"
              />
            </details>
          }
        }
        @case ('chart') {
          @if (chartCard(); as card) {
            <sneat-datatug-board-chart-editor
              [card]="card"
              [queries]="queries()"
              [project]="project()"
              [scopeIdentity]="scopeIdentity()"
              [boardParameters]="boardParameters()"
              [disabled]="disabled()"
              (definition)="chartChosen($event)"
            />
          }
        }
        @default {
          <p class="hint" role="status">
            The {{ name }} widget has no form here and is kept as it is. Change
            it in the JSON tab.
          </p>
        }
      }
    </div>

    <ng-template #sourceEditor>
      @let src = source();
      @if (src) {
        <ion-segment
          [value]="src.kind"
          [disabled]="disabled()"
          aria-label="Where the rows come from"
          (ionChange)="chooseKind(val($event))"
        >
          <ion-segment-button value="query" data-field="source-query">
            <ion-label>Saved query</ion-label>
          </ion-segment-button>
          <ion-segment-button value="parameter" data-field="source-parameter">
            <ion-label>Card input</ion-label>
          </ion-segment-button>
        </ion-segment>
        @if (src.kind === 'query') {
          <ion-select
            label="Saved query"
            labelPlacement="stacked"
            fill="outline"
            interface="popover"
            placeholder="Choose a saved query"
            data-field="query"
            [value]="src.queryId"
            [disabled]="disabled()"
            (ionChange)="chooseQuery(val($event))"
          >
            @for (query of queries(); track query.id) {
              <ion-select-option [value]="query.id">{{
                query.title || query.id
              }}</ion-select-option>
            }
          </ion-select>
          @for (qp of queryParameters(); track qp.id) {
            <div class="binding" [attr.data-binding]="qp.id">
              <ion-select
                [label]="qp.id + (qp.isRequired ? ' (required)' : '')"
                labelPlacement="stacked"
                fill="outline"
                interface="popover"
                data-field="binding"
                [value]="choiceOf(src, qp.id)"
                [disabled]="disabled()"
                (ionChange)="bind(src, qp, val($event), valueOf(src, qp.id))"
              >
                <ion-select-option value="">Query default</ion-select-option>
                @for (p of scalarInputs(); track p.id) {
                  <ion-select-option [value]="'p:' + p.id"
                    >Input {{ p.title || p.id }}</ion-select-option
                  >
                }
                <ion-select-option value="v">Fixed value</ion-select-option>
              </ion-select>
              @if (choiceOf(src, qp.id) === 'v') {
                <ion-input
                  aria-label="Fixed value"
                  fill="outline"
                  data-field="binding-value"
                  [value]="valueOf(src, qp.id)"
                  [disabled]="disabled()"
                  (ionInput)="bind(src, qp, 'v', val($event))"
                />
              }
            </div>
          }
        } @else {
          <ion-select
            label="Card input carrying the rows"
            labelPlacement="stacked"
            fill="outline"
            interface="popover"
            placeholder="Choose an input"
            data-field="parameter"
            [value]="src.parameter"
            [disabled]="disabled()"
            (ionChange)="setSource({ kind: 'parameter', parameter: val($event) })"
          >
            @for (p of rowInputs(); track p.id) {
              <ion-select-option [value]="p.id"
                >{{ p.title || p.id }} ({{ p.type }})</ion-select-option
              >
            }
          </ion-select>
          @if (!rowInputs().length) {
            <p class="hint">
              Add an input of type record or recordset first, on the Inputs
              section.
            </p>
          }
        }
      }
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .widget {
        display: grid;
        gap: 0.75rem;
      }
      .hint {
        margin: 0;
        font-size: 0.85rem;
        color: var(--ion-color-medium-shade);
      }
      .binding {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .binding > * {
        flex: 1 1 10rem;
      }
      .chart-disclosure summary {
        cursor: pointer;
        min-height: 2.5rem;
        display: flex;
        align-items: center;
      }
    `,
  ],
})
export class CardWidgetEditorComponent {
  readonly widget = input.required<BoardWidget>();
  readonly parameters = input<readonly CardParameterDef[]>([]);
  readonly queries = input<readonly CardQueryChoice[]>([]);
  readonly project = input<IProjectRef>();
  readonly scopeIdentity = input('');
  readonly disabled = input(false);
  readonly widgetChange = output<BoardWidget>();

  protected readonly data = computed<Data>(
    () => (this.widget().data ?? {}) as Data,
  );
  protected readonly kindKnown = computed(() =>
    isEditableKind(this.widget().name),
  );
  protected readonly source = computed(() => getSource(this.widget()));
  protected readonly fieldsText = computed(() =>
    fieldsToText(this.data()['fields']),
  );
  protected readonly boardParameters = computed<BoardParameterDef[]>(() =>
    this.parameters().map(({ match: _m, ...rest }) => {
      void _m;
      return rest;
    }),
  );
  protected readonly scalarInputs = computed(() =>
    this.parameters().filter(
      (p) => p.type !== 'record' && p.type !== 'recordset',
    ),
  );
  /** Inputs that can carry rows, the kind this widget reads best first. */
  protected readonly rowInputs = computed(() => {
    const preferred = this.widget().name === 'fields' ? 'record' : 'recordset';
    return this.parameters()
      .filter((p) => p.type === 'record' || p.type === 'recordset')
      .sort((a, b) => Number(b.type === preferred) - Number(a.type === preferred));
  });
  protected readonly queryParameters = computed(() => {
    const src = this.source();
    if (src?.kind !== 'query') return [];
    return (
      this.queries().find((q) => q.id === src.queryId)?.parameters ?? []
    );
  });
  protected readonly chartCard = computed<BoardCard | undefined>(() => {
    const widget = this.widget();
    if (widget.name === 'chart' || widget.name === 'SQL')
      return { id: 'card', title: 'Card', widget };
    return undefined;
  });
  protected readonly WIDGET_KIND_LABELS = WIDGET_KIND_LABELS;

  protected val(event: unknown): string {
    const value = (event as { detail?: { value?: unknown } }).detail?.value;
    return value == null ? '' : String(value);
  }
  protected toFields = textToFields;

  protected setData(change: Data): void {
    const data = { ...this.data(), ...change };
    for (const key of Object.keys(data))
      if (data[key] === undefined) delete data[key];
    this.widgetChange.emit({ ...this.widget(), data });
  }
  protected setSource(source: WidgetSource): void {
    this.widgetChange.emit(setSource(this.widget(), source));
  }
  protected chooseKind(kind: string): void {
    const current = this.source();
    if (!current || current.kind === kind) return;
    this.setSource(
      kind === 'parameter'
        ? { kind: 'parameter', parameter: this.rowInputs()[0]?.id ?? '' }
        : { kind: 'query', queryId: '', parameters: [] },
    );
  }
  protected chooseQuery(queryId: string): void {
    const current = this.source();
    if (current?.kind === 'query' && current.queryId === queryId) return;
    this.setSource({ kind: 'query', queryId, parameters: [] });
  }
  protected choiceOf(src: WidgetSource, id: string): string {
    return src.kind === 'query' ? bindingChoice(src.parameters, id) : '';
  }
  protected valueOf(src: WidgetSource, id: string): string {
    return src.kind === 'query' ? bindingValue(src.parameters, id) : '';
  }
  protected bind(
    src: WidgetSource,
    queryParameter: { id: string; type?: string },
    choice: string,
    value: string,
  ): void {
    if (src.kind !== 'query') return;
    this.setSource({
      ...src,
      parameters: withBinding(
        src.parameters,
        queryParameter.id,
        choice,
        value,
        queryParameter.type,
      ),
    });
  }
  protected chartChosen(definition: ChartWidgetDef): void {
    this.widgetChange.emit({ name: 'chart', data: definition });
  }
}
