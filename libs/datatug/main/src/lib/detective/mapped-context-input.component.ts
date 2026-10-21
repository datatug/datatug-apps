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
  IonInput,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
} from '@ionic/angular';
import { ContextCapabilities } from '../session-context/session-context-contract';
import { parseInputValue } from './detective-forms';
import { DetectiveInputValue } from './models';

export type MappedInputChoice = NonNullable<
  ContextCapabilities['subjects']
>[number];

/** Shared structured input controls: metadata is supplied by the current owner,
 * values remain explicit user input and never become source authority. */
@Component({
  selector: 'sneat-datatug-mapped-context-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonItem, IonLabel, IonSelect, IonSelectOption, IonInput, IonButton],
  template: `<section aria-label="Mapped incident inputs">
    <ion-item
      ><ion-select
        label="Mapped input"
        [value]="choiceId()"
        (ionChange)="choose($event.detail.value)"
        [disabled]="disabled()"
      >
        <ion-select-option value="">Choose a mapped field</ion-select-option>
        @for (item of choices(); track item.id) {
          <ion-select-option [value]="item.id"
            >{{ item.label }} · {{ item.subject.fieldId }} · {{ item.type }} ·
            {{ item.scope.environmentId }}</ion-select-option
          >
        }
      </ion-select></ion-item
    >
    @if (selected(); as item) {
      <p>
        Input {{ item.subject.fieldId }} · {{ item.type }} · {{ item.shape }} ·
        {{ item.scope.identityDomain }}
      </p>
      <ion-item
        ><ion-label position="stacked">Input value</ion-label
        ><ion-input
          aria-label="Mapped input value"
          [value]="text()"
          (ionInput)="text.set($event.detail.value || '')"
          [disabled]="disabled()"
      /></ion-item>
      <ion-button (click)="add()" [disabled]="disabled()">Add input</ion-button>
    }
    @if (error()) {
      <p role="alert">{{ error() }}</p>
    }
    @for (name of names(); track name) {
      <p>
        {{ name }}: {{ display(name) }}
        <ion-button fill="clear" (click)="remove(name)" [disabled]="disabled()"
          >Remove {{ name }}</ion-button
        >
      </p>
    }
  </section>`,
})
export class MappedContextInputComponent {
  readonly choices = input<readonly MappedInputChoice[]>([]);
  readonly disabled = input(false);
  readonly valuesChanged =
    output<Readonly<Record<string, DetectiveInputValue>>>();
  readonly choiceId = signal('');
  readonly text = signal('');
  readonly error = signal('');
  private readonly values = signal<
    Readonly<Record<string, DetectiveInputValue>>
  >({});
  readonly selected = computed(() =>
    this.choices().find((item) => item.id === this.choiceId()),
  );
  readonly names = computed(() => Object.keys(this.values()));
  constructor() {
    effect(() => {
      this.choices();
      this.choiceId.set('');
      this.text.set('');
      this.error.set('');
      this.values.set({});
      this.valuesChanged.emit({});
    });
  }
  choose(id: string) {
    if (this.disabled()) return;
    this.choiceId.set(id);
    this.text.set('');
    this.error.set('');
  }
  add() {
    const choice = this.selected();
    if (!choice || this.disabled()) return;
    try {
      const value = parseInputValue(this.text(), choice.type, choice.shape);
      const values = { ...this.values(), [choice.subject.fieldId]: value };
      this.values.set(values);
      this.valuesChanged.emit(values);
      this.text.set('');
      this.error.set('');
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'Check the typed input.',
      );
    }
  }
  remove(name: string) {
    if (this.disabled()) return;
    const values = { ...this.values() };
    delete values[name];
    this.values.set(values);
    this.valuesChanged.emit(values);
  }
  display(name: string): string {
    const value = this.values()[name];
    return value?.type === 'set'
      ? value.values.map((item) => String(item.value)).join(', ')
      : value?.type === 'range'
        ? 'Range'
        : String(value?.value ?? '');
  }
}
