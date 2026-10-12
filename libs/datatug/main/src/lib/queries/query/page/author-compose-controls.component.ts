import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import {
  IonButton,
  IonCheckbox,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonSelect,
  IonSelectOption,
} from '@ionic/angular';
import {
  type AuthorHavingOperator,
  readAuthorComposeProfile,
  updateAuthorComposeSource,
} from './author-compose-profile';

@Component({
  selector: 'sneat-author-compose-controls',
  templateUrl: './author-compose-controls.component.html',
  styleUrl: './author-compose-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonButton,
    IonCheckbox,
    IonInput,
    IonItem,
    IonLabel,
    IonList,
    IonListHeader,
    IonSelect,
    IonSelectOption,
  ],
})
export class AuthorComposeControlsComponent {
  public readonly source = input.required<string>();
  public readonly sourceChanged = output<string>();
  public readonly editInCode = output<void>();
  public readonly profile = computed(() =>
    readAuthorComposeProfile(this.source()),
  );
  public readonly controlError = signal<string | undefined>(undefined);

  public update(
    change: Partial<{
      grouped: boolean;
      includeInvoiceDate: boolean;
      countExpression: 'star' | 'InvoiceId';
      havingOperator: AuthorHavingOperator;
      threshold: number;
      limit: number;
    }>,
  ): boolean {
    const current = this.profile();
    if (!current.supported || !current.writable) return false;
    const next = updateAuthorComposeSource(this.source(), {
      grouped: change.grouped ?? current.grouped ?? false,
      includeInvoiceDate:
        change.includeInvoiceDate ?? current.includeInvoiceDate ?? false,
      countExpression:
        change.countExpression ?? current.countExpression ?? 'star',
      havingOperator:
        change.havingOperator ?? current.havingOperator ?? '>=',
      threshold: change.threshold ?? current.threshold ?? 7,
      limit: change.limit ?? current.limit ?? 100,
    });
    if (next !== undefined && next !== this.source()) {
      this.sourceChanged.emit(next);
    }
    if (next === undefined) {
      this.controlError.set(
        'This edit cannot be applied without changing other query text. The draft was not changed; use Code.',
      );
      return false;
    }
    this.controlError.set(undefined);
    return true;
  }

  public numberChanged(
    event: CustomEvent<{ readonly value?: string | number | null }>,
    property: 'limit' | 'threshold',
    commit = false,
  ): void {
    const input = event.target as HTMLIonInputElement | null;
    if (!input) return;
    const raw = String(event.detail.value ?? '');
    const current = this.profile()[property];
    const minimum = property === 'limit' ? 1 : 0;
    const maximum = property === 'limit' ? 100 : Number.MAX_SAFE_INTEGER;
    if (!/^-?\d+$/u.test(raw)) {
      if (commit) input.value = String(current ?? (property === 'limit' ? 100 : 7));
      this.controlError.set(
        property === 'limit'
          ? 'Enter a whole-number row limit from 1 to 100. The draft was not changed.'
          : 'Enter a whole-number HAVING threshold of 0 or greater. The draft was not changed.',
      );
      return;
    }
    const value = Number(raw);
    if (
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > maximum ||
      !this.update({ [property]: value })
    ) {
      if (commit) input.value = String(current ?? (property === 'limit' ? 100 : 7));
      this.controlError.set(
        property === 'limit'
          ? 'Enter a whole-number row limit from 1 to 100. The draft was not changed.'
          : 'Enter a whole-number HAVING threshold of 0 or greater. The draft was not changed.',
      );
    }
  }

  public operatorChanged(event: CustomEvent<{ readonly value?: string }>): void {
    const value = event.detail.value;
    if (['=', '!=', '<', '<=', '>', '>='].includes(value ?? '')) {
      this.update({ havingOperator: value as AuthorHavingOperator });
    }
  }

  public countExpressionChanged(
    event: CustomEvent<{ readonly value?: string }>,
  ): void {
    this.update({
      countExpression:
        event.detail.value === 'InvoiceId' ? 'InvoiceId' : 'star',
    });
  }
}
