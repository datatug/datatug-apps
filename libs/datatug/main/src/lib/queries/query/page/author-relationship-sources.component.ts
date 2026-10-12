import {
  ChangeDetectionStrategy,
  Component,
  OnChanges,
  SimpleChanges,
  input,
  output,
  signal,
} from '@angular/core';
import { IonAccordion, IonAccordionGroup, IonButton, IonButtons, IonCheckbox, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { gitMergeOutline } from 'ionicons/icons';
import type { PublicSqliteSourceDiscovery } from '../../public-sqlite-query.service';
import type { AuthorCustomerField, AuthorRelationshipSourceReview } from './author-relationship-source-edit';

@Component({
  selector: 'sneat-author-relationship-sources',
  templateUrl: './author-relationship-sources.component.html',
  styleUrl: './author-relationship-sources.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonAccordion, IonAccordionGroup, IonButton, IonButtons, IonCheckbox, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote],
})
export class AuthorRelationshipSourcesComponent implements OnChanges {
  public constructor() {
    addIcons({ gitMergeOutline });
  }

  public readonly active = input(false);
  public readonly sources = input.required<PublicSqliteSourceDiscovery | undefined>();
  public readonly currentLimit = input.required<string>();
  public readonly loading = input.required<boolean>();
  public readonly review = input.required<AuthorRelationshipSourceReview | undefined>();
  public readonly choices = input.required<readonly AuthorCustomerField[]>();
  public readonly selectedFields = input.required<readonly AuthorCustomerField[]>();
  public readonly disabled = input.required<boolean>();
  public readonly canJoin = input(false);
  public readonly statusMessage = input.required<string>();
  public readonly expandedTable = signal<'Invoice' | 'Customer' | undefined>(undefined);

  public readonly activated = output<void>();
  public readonly customerFieldChanged = output<{
    readonly field: AuthorCustomerField;
    readonly checked: boolean;
  }>();
  public readonly reviewRequested = output<void>();
  public readonly joinRequested = output<void>();
  public readonly applyRequested = output<void>();

  public ngOnChanges(changes: SimpleChanges): void {
    if (changes['active']?.currentValue === false || changes['sources']) {
      this.expandedTable.set(undefined);
    }
    if (changes['active']?.currentValue === true) this.activated.emit();
  }

  public toggleTable(table: 'Invoice' | 'Customer'): void {
    this.expandedTable.update((current) => current === table ? undefined : table);
  }

  public sourceSchema(table: 'Invoice' | 'Customer'): string | undefined {
    const relationship = this.sources()?.relationship;
    if (relationship?.from.table === table) return relationship.from.schema;
    if (relationship?.to.table === table) return relationship.to.schema;
    return undefined;
  }

  public requestOutputReview(event: Event): void {
    event.stopPropagation();
    if (!this.disabled()) this.reviewRequested.emit();
  }

  public joinRelationship(event: Event): void {
    event.stopPropagation();
    if (this.canJoin() && !this.disabled()) this.joinRequested.emit();
  }

  public onCustomerFieldChanged(
    field: AuthorCustomerField,
    event: CustomEvent<{ readonly checked?: boolean }>,
  ): void {
    this.customerFieldChanged.emit({
      field,
      checked: event.detail.checked === true,
    });
  }
}
