import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { PublicSqliteSourceDiscovery } from '../../public-sqlite-query.service';
import type { AuthorCustomerField, AuthorRelationshipSourceReview } from './author-relationship-source-edit';

@Component({
  selector: 'sneat-author-relationship-sources',
  templateUrl: './author-relationship-sources.component.html',
  styleUrl: './author-relationship-sources.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthorRelationshipSourcesComponent {
  public readonly sources = input.required<PublicSqliteSourceDiscovery | undefined>();
  public readonly currentLimit = input.required<string>();
  public readonly loading = input.required<boolean>();
  public readonly review = input.required<AuthorRelationshipSourceReview | undefined>();
  public readonly choices = input.required<readonly AuthorCustomerField[]>();
  public readonly selectedFields = input.required<readonly AuthorCustomerField[]>();
  public readonly disabled = input.required<boolean>();
  public readonly statusMessage = input.required<string>();

  public readonly disclosureChanged = output<boolean>();
  public readonly customerFieldChanged = output<{
    readonly field: AuthorCustomerField;
    readonly checked: boolean;
  }>();
  public readonly reviewRequested = output<void>();
  public readonly applyRequested = output<void>();

  public onDisclosureToggled(event: Event): void {
    this.disclosureChanged.emit(
      (event.currentTarget as HTMLDetailsElement | null)?.open ?? false,
    );
  }

  public onCustomerFieldChanged(field: AuthorCustomerField, event: Event): void {
    this.customerFieldChanged.emit({
      field,
      checked: (event.currentTarget as HTMLInputElement | null)?.checked ?? false,
    });
  }
}
