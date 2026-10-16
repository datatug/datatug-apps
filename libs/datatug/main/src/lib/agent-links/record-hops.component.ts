import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonCard, IonCardContent, IonCardHeader, IonCardTitle } from '@ionic/angular';
import { RecordHop } from './record-hops';

/** The foreign-key hops of a record: each opens the referenced record on the same record route. */
@Component({
  selector: 'sneat-datatug-record-hops',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IonCard, IonCardHeader, IonCardTitle, IonCardContent],
  template: `
    @if (hops().length) {
      <ion-card>
        <ion-card-header>
          <ion-card-title>References</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <ul data-testid="record-hops">
            @for (hop of hops(); track hop.fk.name + $index) {
              <li>
                <a
                  data-testid="record-hop"
                  [routerLink]="hop.commands"
                  [queryParams]="{ schema: hop.schema }"
                  [fragment]="hop.fragment"
                  >{{ hop.fk.refTable.name }}</a
                >
                by {{ hop.fk.columns.join(', ') }}
              </li>
            }
          </ul>
        </ion-card-content>
      </ion-card>
    }
  `,
})
export class RecordHopsComponent {
  readonly hops = input.required<readonly RecordHop[]>();
}
