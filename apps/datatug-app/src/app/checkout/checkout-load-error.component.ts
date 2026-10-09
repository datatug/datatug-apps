import { ChangeDetectionStrategy, Component, InjectionToken, inject } from '@angular/core';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonToolbar } from '@ionic/angular/ion-toolbar';

/** Kept outside the checkout chunks so a failed page import can still render. */
export const CHECKOUT_PAGE_RELOAD = new InjectionToken<() => void>('CHECKOUT_PAGE_RELOAD', {
  providedIn: 'root',
  factory: () => () => location.reload(),
});

@Component({
  selector: 'datatug-checkout-load-error',
  imports: [IonHeader, IonToolbar, IonTitle, IonContent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-header><ion-toolbar><ion-title>Checkout unavailable</ion-title></ion-toolbar></ion-header>
    <ion-content>
      <main>
        <h1>Checkout page could not load</h1>
        <p>Check your connection, then reload this page to try again.</p>
        <button type="button" (click)="reload()">Reload checkout</button>
        <p><a href="https://datatug.io/pricing/">Back to pricing</a></p>
      </main>
    </ion-content>
  `,
  styles: [`
    main { max-width: 46rem; margin: 2rem auto; padding: 1rem; }
    button { padding: 0.7rem 1rem; cursor: pointer; }
  `],
})
export class CheckoutLoadErrorComponent {
  protected readonly reload = inject(CHECKOUT_PAGE_RELOAD);
}
