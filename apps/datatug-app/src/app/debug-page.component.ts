import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';

@Component({
  selector: 'sneat-datatug-debug',
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonItem,
    IonInput,
    IonButton,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Debug</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-item>
        <ion-input
          label="Error message"
          labelPlacement="stacked"
          placeholder="Enter error message"
          [(ngModel)]="message"
        />
      </ion-item>
      <ion-button expand="block" (click)="throwError()">Throw error</ion-button>
    </ion-content>
  `,
})
export class DebugPageComponent {
  protected message = '';

  protected throwError(): void {
    throw new Error(this.message);
  }
}
