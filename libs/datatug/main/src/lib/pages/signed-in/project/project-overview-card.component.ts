import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IonCard, IonItemDivider, IonLabel } from '@ionic/angular';

/**
 * A standalone card on the project page (for example the private sandbox offer): one `color="light"`
 * `ion-item-divider` header with the title in `ion-label` and any actions in `slot="end"`, then the projected
 * content. Overview tab content is not a standalone card; it uses `ProjectTabPanelComponent` instead.
 */
@Component({
  selector: 'sneat-datatug-project-overview-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonCard, IonItemDivider, IonLabel],
  template: `
    <ion-card [attr.data-testid]="testId()">
      <ion-item-divider color="light">
        <ion-label
          ><h2>{{ cardTitle() }}</h2></ion-label
        >
        <ng-content select="[cardHeaderAction]" />
      </ion-item-divider>
      <ng-content />
    </ion-card>
  `,
  styles: `
    h2 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
    }
  `,
})
export class ProjectOverviewCardComponent {
  readonly cardTitle = input.required<string>();
  readonly testId = input<string | undefined>(undefined);
}
