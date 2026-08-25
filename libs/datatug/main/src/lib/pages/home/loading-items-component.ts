import { Component, input } from '@angular/core';
import { IonIcon, IonItem, IonLabel } from '@ionic/angular';
import { AuthStatus } from '@sneat/auth-core';

@Component({
  selector: 'sneat-datatug-loading-items',
  templateUrl: 'loading-items-component.html',
  imports: [IonItem, IonIcon, IonLabel],
})
export class LoadingItemsComponent {
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  public readonly authStatus = input.required<AuthStatus | undefined>();
  public readonly title = input.required<string | undefined>();
}
