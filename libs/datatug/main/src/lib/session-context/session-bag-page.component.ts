import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IonButton, IonContent, IonItem, IonLabel } from '@ionic/angular';
import { SessionWorkspaceService } from './session-workspace.service';

@Component({ selector: 'sneat-datatug-session-bag-page', changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonContent, IonItem, IonLabel, IonButton],
  template: `<ion-content><ion-item><ion-label><h2>Context Bag</h2><p>The selected session's staged and applied context is shared across its workspace.</p></ion-label><ion-button slot="end" (click)="workspace.requestBagEditor()">Open Context Bag</ion-button></ion-item></ion-content>` })
export class SessionBagPageComponent {
  readonly workspace = inject(SessionWorkspaceService);
  constructor() { this.workspace.requestBagEditor(); }
}
