// One header per page on narrow layouts (founder, 2026-10-22: "we should have only 1 page header").
//
// Below the side-panel breakpoint the shell used to render its own compact header (menu + brand +
// motto + Sign in) above every routed page, and most pages add their own `ion-header` (back button +
// title) under it, so two bars were stacked. Now a routed page that owns a header keeps it as THE
// header: the shell hides its compact bar (see `styles.scss`, "One header per page") and this class
// puts back what that bar carried, into the page's own toolbar:
//
//   - Sign in, while signed out, at every width (narrow layouts hide the side panel that also offers it);
//   - a menu button, when the toolbar has none (a page that has its own `ion-menu-button` keeps it).
//
// Pages without an `ion-header` of their own (and Home, whose header yields to the shell's) keep the
// shell's compact bar, so nothing loses its way into the menu or Sign in.
//
// The routed pages are rendered by Ionic and are not known to the shell, so the adoption watches the
// outlet's DOM. It is idempotent (a toolbar is adopted once) and releases a toolbar's extras when the
// page is destroyed.
import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  type ComponentRef,
  computed,
  createComponent,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonButton } from '@ionic/angular/ion-button';
import { IonMenuButton } from '@ionic/angular/ion-menu-button';
import { SneatAuthStateService } from '@sneat/auth-core';

/** A page header that yields to the shell's compact header instead of replacing it (Home). */
export const SHELL_OWNED_HEADER_CLASS = 'home-header';

@Component({
  selector: 'sneat-datatug-adopted-sign-in',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, RouterLink],
  template: `
    @if (signedOut()) {
      <ion-button color="primary" routerLink="/login" data-testid="page-sign-in">
        Sign in
      </ion-button>
    }
  `,
})
export class AdoptedSignInComponent {
  private readonly authStatus = toSignal(inject(SneatAuthStateService).authStatus);
  protected readonly signedOut = computed(() => this.authStatus() === 'notAuthenticated');
}

@Component({
  selector: 'sneat-datatug-adopted-menu-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonMenuButton],
  template: `
    <ion-menu-button
      menuIcon="menu-outline"
      class="app-level-menu-button"
      aria-label="Open navigation menu"
    ></ion-menu-button>
  `,
})
export class AdoptedMenuButtonComponent {}

/** The first header of a routed page that takes over from the shell's compact header, if it has one. */
export function pageOwnToolbar(page: Element): Element | null {
  return page.querySelector(`ion-header:not(.${SHELL_OWNED_HEADER_CLASS}) > ion-toolbar`);
}

export class PageToolbarAdoption {
  readonly #adopted = new Map<Element, readonly ComponentRef<unknown>[]>();
  #observer?: MutationObserver;
  #frame = 0;

  constructor(
    private readonly outlet: Element,
    private readonly injector: EnvironmentInjector,
    private readonly appRef: ApplicationRef,
  ) {}

  start(): void {
    this.#observer = new MutationObserver(() => this.#schedule());
    this.#observer.observe(this.outlet, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    this.adopt();
  }

  stop(): void {
    this.#observer?.disconnect();
    cancelAnimationFrame(this.#frame);
    for (const refs of this.#adopted.values()) this.#release(refs);
    this.#adopted.clear();
  }

  /** Adopts every visible routed page's own toolbar and releases the ones whose page is gone. */
  adopt(): void {
    for (const [toolbar, refs] of this.#adopted) {
      if (toolbar.isConnected) continue;
      this.#release(refs);
      this.#adopted.delete(toolbar);
    }
    const pages = this.outlet.querySelectorAll(':scope > .ion-page:not(.ion-page-hidden)');
    for (const page of Array.from(pages)) {
      const toolbar = pageOwnToolbar(page);
      if (toolbar && !this.#adopted.has(toolbar)) this.#adopted.set(toolbar, this.#adoptToolbar(toolbar));
    }
  }

  #schedule(): void {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.adopt();
    });
  }

  #adoptToolbar(toolbar: Element): readonly ComponentRef<unknown>[] {
    const refs: ComponentRef<unknown>[] = [];
    if (!toolbar.querySelector('ion-menu-button')) {
      refs.push(this.#mount(AdoptedMenuButtonComponent, toolbar, 'start', 'shell-adopted-menu'));
    }
    if (!/sign in/i.test(toolbar.textContent ?? '')) {
      refs.push(this.#mount(AdoptedSignInComponent, toolbar, 'end', 'shell-adopted'));
    }
    return refs;
  }

  /** Mounts a component in an `ion-buttons` slot of the toolbar, so Ionic lays it out like the page's own buttons. */
  #mount(
    type: typeof AdoptedMenuButtonComponent | typeof AdoptedSignInComponent,
    toolbar: Element,
    slot: 'start' | 'end',
    className: string,
  ): ComponentRef<unknown> {
    const host = document.createElement('ion-buttons');
    host.setAttribute('slot', slot);
    host.classList.add('shell-adopted', className);
    if (slot === 'start') toolbar.prepend(host);
    else toolbar.append(host);
    const ref = createComponent(type, { environmentInjector: this.injector, hostElement: host });
    this.appRef.attachView(ref.hostView);
    return ref;
  }

  #release(refs: readonly ComponentRef<unknown>[]): void {
    for (const ref of refs) {
      const host = ref.location.nativeElement as Element;
      this.appRef.detachView(ref.hostView);
      ref.destroy();
      host.remove();
    }
  }
}
