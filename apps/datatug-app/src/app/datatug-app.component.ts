import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { isCheckoutShellAddress } from './checkout/checkout-privacy-state';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
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
import { ResizableMenuDirective } from '@sneat/ui';
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
    ResizableMenuDirective,
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
  private readonly router = inject(Router);
  protected readonly checkout = toSignal(
    this.router.events.pipe(
      filter(
        (
          event,
        ): event is
          | NavigationStart
          | NavigationEnd
          | NavigationCancel
          | NavigationError =>
          event instanceof NavigationStart ||
          event instanceof NavigationEnd ||
          event instanceof NavigationCancel ||
          event instanceof NavigationError,
      ),
      map((event) =>
        event instanceof NavigationStart
          ? isCheckoutShellAddress(this.router.url) ||
            isCheckoutShellAddress(event.url)
          : isCheckoutShellAddress(
              event instanceof NavigationEnd
                ? event.urlAfterRedirects
                : this.router.url,
            ),
      ),
    ),
    { initialValue: isCheckoutShellAddress(this.router.url) },
  );
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  protected readonly checkoutAuth = computed(() =>
    /^\/(?:login|sso(?:\/callback)?|sign-in-from-email-link)\/?(?:[?#]|$)/.test(
      this.currentUrl(),
    ),
  );
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
