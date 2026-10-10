import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
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
    if (next === undefined) return false;
    this.controlError.set(undefined);
    return true;
  }

  public numberChanged(
    event: Event,
    property: 'limit' | 'threshold',
  ): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) return;
    const raw = input.value;
    const current = this.profile()[property];
    const minimum = property === 'limit' ? 1 : Number.MIN_SAFE_INTEGER;
    const maximum = property === 'limit' ? 100 : Number.MAX_SAFE_INTEGER;
    if (!/^-?\d+$/u.test(raw)) {
      input.value = String(current ?? (property === 'limit' ? 100 : 7));
      this.controlError.set(
        property === 'limit'
          ? 'Enter a whole-number row limit from 1 to 100. The draft was not changed.'
          : 'Enter a whole-number HAVING threshold. The draft was not changed.',
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
      input.value = String(current ?? (property === 'limit' ? 100 : 7));
      this.controlError.set(
        property === 'limit'
          ? 'Enter a whole-number row limit from 1 to 100. The draft was not changed.'
          : 'Enter a whole-number HAVING threshold. The draft was not changed.',
      );
    }
  }

  public operatorChanged(event: Event): void {
    const value = (event.target as HTMLSelectElement | null)?.value;
    if (['=', '!=', '<', '<=', '>', '>='].includes(value ?? '')) {
      this.update({ havingOperator: value as AuthorHavingOperator });
    }
  }
}
