import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { PublicSqliteQueryPreview } from '../../public-sqlite-tugql';
import { tokenizeTugql } from './tugql-syntax';

interface AuthorSqlBindingDisplay {
  readonly kind: 'customer-id' | 'literal';
  readonly label: string;
  readonly value?: string | number | null;
}

@Component({
  selector: 'sneat-author-sql-preview',
  templateUrl: './author-sql-preview.component.html',
  styleUrl: './author-sql-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthorSqlPreviewComponent {
  public readonly plan = input.required<PublicSqliteQueryPreview>();
  public readonly customerId = input('');
  public readonly customerIdValid = input(false);
  public readonly customerIdMissing = input(true);
  public readonly sqlTokens = computed(() => tokenizeTugql(this.plan().sql));

  public get bindings(): readonly AuthorSqlBindingDisplay[] {
    const plan = this.plan();
    if (plan.bindingSlots) {
      return plan.bindingSlots.map((slot) => slot.kind === 'customer-id'
        ? { kind: 'customer-id', label: '@CustomerId · integer' }
        : {
            kind: 'literal',
            label: slot.name === 'HAVING threshold (literal)'
              ? 'HAVING threshold · integer literal'
              : `${slot.name} · integer literal`,
            value: slot.value,
          });
    }

    let fixedBindingIndex = 0;
    return plan.bindingNames.map((name) => {
      if (name === 'CustomerId')
        return { kind: 'customer-id', label: '@CustomerId · integer' };
      const value = plan.fixedBindings[fixedBindingIndex++];
      return {
        kind: 'literal',
        label: name === 'HAVING threshold (literal)'
          ? 'HAVING threshold · integer literal'
          : `${name} · integer literal`,
        value,
      };
    });
  }
}
