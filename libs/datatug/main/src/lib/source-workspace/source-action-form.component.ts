import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonInput,
  IonSelect,
  IonSelectOption,
} from '@ionic/angular';
import {
  type SourceFieldValue,
  type SourceInteraction,
} from './source-workspace-contract';

@Component({
  selector: 'sneat-source-action-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, IonButtons, IonInput, IonSelect, IonSelectOption],
  styles: `
    :host {
      display: block;
      margin-block: 0.5rem;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    h3 {
      margin: 0;
      font-size: 1rem;
      overflow-wrap: anywhere;
    }
    ion-button {
      --color: var(--ion-text-color);
      font-size: 0.85rem;
    }
    ion-input,
    ion-select {
      margin-block: 0.25rem;
    }
    p {
      font-size: 0.85rem;
      line-height: 1.45;
    }
  `,
  template: `<section [attr.aria-label]="interaction().title">
    <header>
      <h3>{{ interaction().title }}</h3>
      @if (interaction().cancelLabel) {
        <ion-buttons slot="end"
          ><ion-button
            fill="clear"
            [disabled]="busy()"
            (click)="cancelReview.emit()"
            >{{ interaction().cancelLabel }}</ion-button
          ></ion-buttons
        >
      }
    </header>
    <p>{{ interaction().description }}</p>
    @if (interaction().phase === 'review') {
      <form (submit)="submit($event)">
        @for (field of interaction().fields; track field.id) {
          @if (field.choices; as choices) {
            <ion-select
              [label]="field.label"
              [value]="valueFor(field.id)"
              [disabled]="busy()"
              (ionChange)="change(field.id, $event.detail.value)"
            >
              <ion-select-option value="">Choose a value</ion-select-option>
              @for (choice of choices; track choice.value) {
                <ion-select-option [value]="choice.value">{{
                  choice.label
                }}</ion-select-option>
              }
            </ion-select>
          } @else {
            <ion-input
              [label]="field.label"
              type="text"
              [inputmode]="field.type === 'integer' ? 'numeric' : 'text'"
              [value]="valueFor(field.id)"
              [maxlength]="field.maxLength ?? 4096"
              [disabled]="busy()"
              (ionInput)="change(field.id, $event.detail.value)"
              (ionBlur)="touched.set(true)"
            />
          }
        }
        @if (touched() && validationError()) {
          <p role="alert">{{ validationError() }}</p>
        }
        <ion-button
          type="submit"
          [disabled]="busy() || !interaction().enabled"
          >{{ interaction().submitLabel }}</ion-button
        >
      </form>
    } @else if (
      interaction().phase === 'uncertain' && interaction().retryLabel
    ) {
      <ion-button
        [disabled]="busy() || !interaction().enabled"
        (click)="retry.emit()"
        >{{ interaction().retryLabel }}</ion-button
      >
    } @else if (
      interaction().phase === 'conflict' && interaction().conflictLabel
    ) {
      <ion-button
        [disabled]="busy() || !interaction().enabled"
        (click)="reviewConflict.emit()"
        >{{ interaction().conflictLabel }}</ion-button
      >
    }
  </section>`,
})
export class SourceActionFormComponent {
  readonly interaction = input.required<SourceInteraction>();
  readonly contextKey = input.required<string>();
  readonly busy = input(false);
  readonly submitted = output<Readonly<Record<string, SourceFieldValue>>>();
  readonly cancelReview = output<void>();
  readonly retry = output<void>();
  readonly reviewConflict = output<void>();
  readonly values = signal<Readonly<Record<string, string>>>({});
  readonly touched = signal(false);
  private readonly inputKey = computed(() =>
    JSON.stringify([
      this.contextKey(),
      this.interaction().reviewId,
      this.interaction().phase,
      this.interaction().fields,
    ]),
  );
  constructor() {
    effect(() => {
      this.inputKey();
      this.values.set({});
      this.touched.set(false);
    });
  }
  valueFor(id: string): string {
    const values = this.values();
    return Object.hasOwn(values, id) ? values[id] : '';
  }
  change(id: string, value: unknown) {
    if (
      this.busy() ||
      !this.interaction().fields.some((field) => field.id === id)
    )
      return;
    this.values.update((values) => ({
      ...values,
      [id]: typeof value === 'string' ? value : '',
    }));
  }
  readonly validationError = computed(() => {
    const fields = this.interaction().fields;
    if (new Set(fields.map((field) => field.id)).size !== fields.length)
      return 'This action has unsupported input definitions.';
    for (const field of fields) {
      const value = this.valueFor(field.id);
      if (!value) {
        if (field.required) return `${field.label} is required.`;
        continue;
      }
      if (value.length > (field.maxLength ?? 4096))
        return `${field.label} is too long.`;
      if (
        field.type === 'integer' &&
        !/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value)
      )
        return `${field.label} must be a canonical integer.`;
      if (
        field.choices &&
        !field.choices.some((choice) => choice.value === value)
      )
        return `Choose an offered ${field.label} value.`;
    }
    return '';
  });
  submit(event: Event) {
    event.preventDefault();
    this.touched.set(true);
    const interaction = this.interaction();
    if (
      this.busy() ||
      !interaction.enabled ||
      interaction.phase !== 'review' ||
      this.validationError()
    )
      return;
    const values = Object.fromEntries(
      interaction.fields.flatMap((field) => {
        const value = this.valueFor(field.id);
        return value === ''
          ? []
          : [
              [
                field.id,
                { type: field.type, value } satisfies SourceFieldValue,
              ],
            ];
      }),
    );
    this.submitted.emit(values);
  }
}
