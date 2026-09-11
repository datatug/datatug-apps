import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { IonApp } from '@ionic/angular/ion-app';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonMenu } from '@ionic/angular/ion-menu';
import { IonRouterOutlet } from '@ionic/angular/ion-router-outlet';
import { IonSplitPane } from '@ionic/angular/ion-split-pane';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { MenuController } from '@ionic/angular/menu-controller';
import { ErrorLogger } from '@sneat/core';
import { PRODUCT_PROFILE } from '@datatug/product-profiles';

@Component({
  selector: 'sneat-datatug-root',
  templateUrl: 'datatug-app.component.html',
  styleUrl: 'datatug-app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonApp,
    IonSplitPane,
    IonMenu,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonRouterOutlet,
    RouterOutlet,
    RouterLink,
  ],
})
export class DatatugAppComponent {
  private readonly menuController = inject(MenuController);
  private readonly errorLogger = inject(ErrorLogger);

  // The active product profile (hub `product-profiles` REQ:profile-table),
  // resolved once at bootstrap (config override -> hostname -> `datatug`
  // default) or substituted directly in a test — see `PRODUCT_PROFILE`'s own
  // doc comment. The shell reads only its declarative `brandName`/`planned`
  // fields, never branches on the profile's identity
  // (REQ:profile-config-is-declarative).
  protected readonly profile = inject(PRODUCT_PROFILE);

  // The side menu (`ion-menu type="overlay"`) is an overlay on small
  // screens: clicking the "DataTug.app" brand navigates home via
  // `routerLink`, but on an overlay that leaves the user behind the still-open
  // menu panel. Explicitly close it so the home screen underneath is what
  // they land on. On wide screens ion-split-pane keeps the menu permanently
  // revealed (not "open" in the overlay sense), so `close()` there resolves
  // to `false` and is a harmless no-op.
  protected closeMenu(): void {
    this.menuController
      .close()
      .catch(this.errorLogger.logErrorHandler('Failed to close menu'));
  }
}
