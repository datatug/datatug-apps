import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EnvironmentInjector,
  afterNextRender,
  computed,
  inject,
  signal,
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
import { IonButton } from '@ionic/angular/ion-button';
import { IonButtons } from '@ionic/angular/ion-buttons';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonMenu } from '@ionic/angular/ion-menu';
import { IonMenuButton } from '@ionic/angular/ion-menu-button';
import { IonRouterOutlet } from '@ionic/angular/ion-router-outlet';
import { IonSplitPane } from '@ionic/angular/ion-split-pane';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { MenuController } from '@ionic/angular/menu-controller';
import { ErrorLogger } from '@sneat/core';
import { SneatAuthStateService } from '@sneat/auth-core';
import { ResizableMenuDirective } from '@sneat/ui';
import { PRODUCT_PROFILE } from '@datatug/product-profiles';
import { PageToolbarAdoption } from './page-toolbar-adoption';

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
    IonButtons,
    IonMenuButton,
    IonButton,
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

  // Single source for the side-panel breakpoint: at or above it the split
  // pane reveals the panel, below it the shell renders its own compact
  // header (menu affordance + brand + motto + Sign in) — UX brief §1.
  // Keep datatug-app.component.scss and datatug-home-page.component.scss
  // media queries in sync with this value.
  // The MediaQueryList change event calls the signal write directly, so it
  // is zoneless-safe without a manual change-detection nudge.
  private static readonly PANEL_MIN_WIDTH = 992;
  private readonly narrowQuery = window.matchMedia(
    `(max-width: ${DatatugAppComponent.PANEL_MIN_WIDTH - 0.02}px)`,
  );
  protected readonly menuHidden = signal(this.narrowQuery.matches);

  // The auth service seeds 'authenticating' synchronously on subscribe, so
  // `authStatus()` starts as 'authenticating': neither the Sign-in button
  // (not 'notAuthenticated') nor the hidden-panel branch fires until the
  // state settles — no flash for returning signed-in users.
  protected readonly authStatus = toSignal(
    inject(SneatAuthStateService).authStatus,
  );

  // The profile's start page, read declaratively (`homePath`, so e.g.
  // incidentius' /incidents is never treated as home here); the bare '/'
  // redirect pass-through is deliberately excluded so a signed-out boot
  // under other profiles never flashes the panel hidden.
  private readonly appHomePath = computed(() => {
    const path = this.currentUrl().split(/[?#]/)[0];
    return path === `/${this.profile.homePath}`;
  });

  // Home has no side-panel content for either auth state. Keep the overlay
  // menu available from the Home header, while the split pane remains
  // collapsed so Home never displays the panel by default.
  protected readonly homePanelHidden = computed(
    () =>
      this.profile.minimalSignedOutHome === true &&
      this.appHomePath() &&
      !this.checkoutAuth(),
  );

  // Auth pages provide navigation in their own page headers. The checkout shell
  // (`checkout()` disables the menu by design) must not show a menu-button
  // that can never open — the compact header only earns its place when the
  // menu is genuinely reachable-but-hidden. Elsewhere on narrow layouts it
  // is the menu + brand + motto affordance.
  protected readonly compactHeader = computed(
    () => this.menuHidden() && !this.checkoutAuth() && !this.checkout(),
  );

  // Split-pane visibility: hidden for the checkout shell and Home, where the
  // menu remains available as an overlay from the page header.
  protected readonly paneWhen = computed(() =>
    this.checkout() || this.homePanelHidden()
      ? false
      : `(min-width: ${DatatugAppComponent.PANEL_MIN_WIDTH}px)`,
  );

  constructor() {
    const onChange = (event: MediaQueryListEvent) =>
      this.menuHidden.set(event.matches);
    this.narrowQuery.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() =>
      this.narrowQuery.removeEventListener('change', onChange),
    );
    // A routed page with its own header is the page's single header on narrow layouts: the shell hides
    // its compact bar (styles.scss) and the page's toolbar gets Sign in + menu instead.
    const injector = inject(EnvironmentInjector);
    const appRef = inject(ApplicationRef);
    afterNextRender(() => {
      const outlet = document.getElementById('main-content');
      if (!outlet) return;
      const adoption = new PageToolbarAdoption(outlet, injector, appRef);
      adoption.start();
      this.stopAdoption = () => adoption.stop();
    });
    inject(DestroyRef).onDestroy(() => this.stopAdoption());
  }

  private stopAdoption: () => void = () => undefined;

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
