import { ChangeDetectionStrategy, Component, input, OnChanges, output, SimpleChanges, signal } from '@angular/core';
import { IonAlert, IonButton, IonButtons, IonIcon, IonItem, IonLabel, IonList } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { refreshOutline, trashOutline } from 'ionicons/icons';
import type { PublicSqliteSourceDiscovery } from '../../public-sqlite-query.service';
import type { AuthorParticipatingSource, AuthorSourceInventory } from './author-participating-sources';

@Component({
  selector: 'sneat-author-participating-sources',
  templateUrl: './author-participating-sources.component.html',
  styleUrl: './author-participating-sources.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonAlert, IonButton, IonButtons, IonIcon, IonItem, IonLabel, IonList],
})
export class AuthorParticipatingSourcesComponent implements OnChanges {
  public constructor() {
    addIcons({ refreshOutline, trashOutline });
  }
  public readonly inventory = input.required<AuthorSourceInventory>();
  public readonly active = input(false);
  public readonly metadata = input<PublicSqliteSourceDiscovery | undefined>();
  public readonly disabled = input(false);
  public readonly statusMessage = input('');
  public readonly canRemoveJoin = input(false);
  public readonly removeJoinReason = input<string | undefined>(undefined);
  public readonly removalOutputs = input<readonly string[]>([]);
  public readonly selectedSource = signal<string | undefined>(undefined);
  public readonly removalConfirmOpen = input(false);
  public readonly removeRequested = output<void>();
  public readonly removalConfirmed = output<boolean>();
  public readonly activated = output<void>();
  public readonly refreshRequested = output<void>();

  public ngOnChanges(changes: SimpleChanges): void {
    if (changes['inventory'] || changes['metadata']) this.selectedSource.set(undefined);
    if (changes['active']?.currentValue === true) this.activated.emit();
  }

  public toggleDetails(source: AuthorParticipatingSource): void {
    this.selectedSource.update((current) => current === source.id ? undefined : source.id);
  }

  public tableFields(source: AuthorParticipatingSource): readonly { name: string; type: string }[] {
    const metadata = this.metadata();
    if (!metadata || (source.schema !== undefined && source.schema !== 'main') || source.database) return [];
    if (source.name.toLowerCase() === 'invoice') return metadata.invoiceFields;
    if (source.name.toLowerCase() === 'customer') return metadata.customerFields;
    return [];
  }

  public tableSchema(source: AuthorParticipatingSource): string | undefined {
    if ((source.schema !== undefined && source.schema !== 'main') || source.database) return undefined;
    const relationship = this.metadata()?.relationship;
    if (relationship?.from.table.toLowerCase() === source.name.toLowerCase()) return relationship.from.schema;
    if (relationship?.to.table.toLowerCase() === source.name.toLowerCase()) return relationship.to.schema;
    return undefined;
  }

}
