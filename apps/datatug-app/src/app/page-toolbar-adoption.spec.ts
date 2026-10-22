import { ApplicationRef, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { of } from 'rxjs';
import { PageToolbarAdoption, pageOwnToolbar } from './page-toolbar-adoption';

function outletWith(pageHtml: string): HTMLElement {
  const outlet = document.createElement('ion-router-outlet');
  outlet.innerHTML = `<div class="ion-page">${pageHtml}</div>`;
  document.body.append(outlet);
  return outlet;
}

describe('PageToolbarAdoption', () => {
  const setup = (status: 'authenticated' | 'notAuthenticated') => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SneatAuthStateService, useValue: { authStatus: of(status) } }],
    });
    return new (class {
      injector = TestBed.inject(EnvironmentInjector);
      appRef = TestBed.inject(ApplicationRef);
    })();
  };

  afterEach(() => document.body.replaceChildren());

  it('ignores the Home header, which yields to the shell', () => {
    const outlet = outletWith('<ion-header class="home-header"><ion-toolbar></ion-toolbar></ion-header>');
    expect(pageOwnToolbar(outlet.firstElementChild as Element)).toBeNull();
  });

  it('adds a menu button and Sign in to a signed-out page toolbar, once', async () => {
    const { injector, appRef } = setup('notAuthenticated');
    const outlet = outletWith('<ion-header><ion-toolbar><ion-title>Page</ion-title></ion-toolbar></ion-header>');
    const adoption = new PageToolbarAdoption(outlet, injector, appRef);
    adoption.adopt();
    adoption.adopt();
    appRef.tick();
    await appRef.whenStable();
    expect(outlet.querySelectorAll('ion-menu-button')).toHaveLength(1);
    expect(outlet.querySelectorAll('ion-buttons.shell-adopted')).toHaveLength(2);
    expect(outlet.textContent).toContain('Sign in');
    adoption.stop();
    expect(outlet.querySelectorAll('.shell-adopted')).toHaveLength(0);
  });

  it('keeps a page menu button and shows no Sign in when signed in', async () => {
    const { injector, appRef } = setup('authenticated');
    const outlet = outletWith('<ion-header><ion-toolbar><ion-buttons slot="start"><ion-menu-button></ion-menu-button></ion-buttons></ion-toolbar></ion-header>');
    const adoption = new PageToolbarAdoption(outlet, injector, appRef);
    adoption.adopt();
    appRef.tick();
    await appRef.whenStable();
    expect(outlet.querySelectorAll('ion-menu-button')).toHaveLength(1);
    expect(outlet.textContent).not.toContain('Sign in');
    adoption.stop();
  });
});
