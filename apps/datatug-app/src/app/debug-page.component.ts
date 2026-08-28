import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton } from '@ionic/angular/ion-button';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonInput } from '@ionic/angular/ion-input';
import { IonItem } from '@ionic/angular/ion-item';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonToolbar } from '@ionic/angular/ion-toolbar';

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
