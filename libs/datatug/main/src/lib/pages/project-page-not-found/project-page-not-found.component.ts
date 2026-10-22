// The last project route: an address under a project that names no page of it (a stale or
// mistyped link, or a page that is switched off, such as `-/dbmodels` while
// ENABLE_EMPTY_SHELL_PAGES is false). Without it the router finds no route (NG04002), which the
// app treats as a crash: the crash-report dialog opens and the visitor lands on the home page.
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonMenuButton,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

@Component({
  selector: 'sneat-datatug-project-page-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IonBackButton, IonButtons, IonContent, IonHeader, IonMenuButton, IonTitle, IonToolbar],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-menu-button /><ion-back-button /></ion-buttons>
        <ion-title>Page not found</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <main class="not-found">
        <h1>This project has no “{{ address }}” page</h1>
        <p>The link may be out of date, or the page is not available yet.</p>
        <a routerLink="../overview" data-testid="project-not-found-overview">Open the project overview</a>
      </main>
    </ion-content>
  `,
  styles: `
    .not-found { max-width: 640px; }
    h1 { font-size: 22px; margin: 8px 0 12px; overflow-wrap: anywhere; }
    a:focus-visible { outline: 3px solid var(--ion-color-primary); outline-offset: 2px; }
  `,
})
export class ProjectPageNotFoundComponent {
  protected readonly address = inject(ActivatedRoute).snapshot.url.map((segment) => segment.path).join('/');
}
