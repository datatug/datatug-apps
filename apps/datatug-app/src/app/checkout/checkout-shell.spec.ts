import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MenuController } from '@ionic/angular/menu-controller';
import { ErrorLogger } from '@sneat/core';
import { PRODUCT_PROFILE } from '@datatug/product-profiles';
import { DatatugAppComponent } from '../datatug-app.component';
import { isCheckoutShellAddress } from './checkout-privacy-state';

it.each([
  '/checkout/sign-in?plan=pro&period=yearly&checkout=test',
  '/subscribe?plan=pro&period=monthly',
  '/business/checkout?checkout=test',
  '/pricing/return?mode=test',
  '/business/checkout/return?mode=test',
  '/login#/subscribe?plan=pro',
  '/sso?returnTo=%2Fsubscribe',
  '/sso/callback?code=fixture',
  '/sign-in-from-email-link?returnTo=%2Fsubscribe',
])('hides the application panel for %s', (url) => {
  expect(isCheckoutShellAddress(url)).toBe(true);
});
it.each(['/home', '/my', '/spaces/acme/settings/sso', '/sso/setup'])(
  'retains the normal shell for %s',
  (url) => expect(isCheckoutShellAddress(url)).toBe(false),
);

it('hides and restores the panel after navigation without recreating the router outlet', async () => {
  TestBed.configureTestingModule({
    imports: [DatatugAppComponent],
    providers: [
      provideRouter([
        { path: 'blocked', canActivate: [() => false], children: [] },
        { path: '**', children: [] },
      ]),
      { provide: MenuController, useValue: { close: async () => true } },
      { provide: ErrorLogger, useValue: {} },
      { provide: PRODUCT_PROFILE, useValue: { brandName: 'DataTug' } },
    ],
  });
  const fixture = TestBed.createComponent(DatatugAppComponent);
  await fixture.whenStable();
  const outlet = fixture.nativeElement.querySelector('ion-router-outlet');
  const menu: HTMLElement = fixture.nativeElement.querySelector('ion-menu');
  await TestBed.inject(Router).navigateByUrl(
    '/business/checkout?checkout=test',
  );
  await fixture.whenStable();
  expect(menu.style.display).toBe('none');
  expect(fixture.nativeElement.querySelector('ion-router-outlet')).toBe(outlet);
  await TestBed.inject(Router).navigateByUrl('/blocked');
  await fixture.whenStable();
  expect(menu.style.display).toBe('none');
  await TestBed.inject(Router).navigateByUrl('/sso?returnTo=%2Fsubscribe');
  await fixture.whenStable();
  expect(
    fixture.nativeElement
      .querySelector('.auth-brand a')
      .getAttribute('aria-label'),
  ).toBe('DataTug home');
  await TestBed.inject(Router).navigateByUrl('/home');
  await fixture.whenStable();
  expect(menu.style.display).toBe('');
  expect(fixture.nativeElement.querySelector('.auth-brand')).toBeNull();
});
