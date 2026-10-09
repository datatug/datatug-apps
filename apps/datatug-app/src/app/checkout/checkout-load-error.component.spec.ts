import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PRODUCT_PROFILE, PRODUCT_PROFILES } from '@datatug/product-profiles';
import { routes } from '../datatug-app-routes';
import {
  CHECKOUT_PAGE_RELOAD,
  CheckoutLoadErrorComponent,
} from './checkout-load-error.component';

vi.mock('./checkout-page.component', () => {
  throw new TypeError('Importing a module script failed.');
});
vi.mock('./business-checkout-page.component', () => {
  throw new TypeError('Importing a module script failed.');
});

@Component({ template: '<p>Home page</p>' })
class HomeStub {}

const checkoutPaths = [
  'subscribe',
  'pricing/return',
  'business/checkout',
  'business/checkout/return',
];

afterEach(() => vi.restoreAllMocks());

it.each([
  ['/subscribe?plan=pro&period=monthly', 'pro_checkout_page_import_failed'],
  ['/pricing/return?mode=live&session_id=cs_live_example', 'pro_checkout_page_import_failed'],
  ['/business/checkout?planID=datatug-business-usage-monthly', 'business_checkout_page_import_failed'],
  ['/business/checkout/return?spaceID=space_1&session_id=cs_test_example', 'business_checkout_page_import_failed'],
])('keeps %s and offers only an explicit reload when its checkout chunk rejects', async (url, diagnostic) => {
  const reload = vi.fn();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await TestBed.configureTestingModule({
    providers: [
      provideRouter([
        ...routes.filter((route) => checkoutPaths.includes(route.path ?? '')),
        { path: '', component: HomeStub },
      ]),
      { provide: PRODUCT_PROFILE, useValue: PRODUCT_PROFILES.datatug },
      { provide: CHECKOUT_PAGE_RELOAD, useValue: reload },
    ],
  })
    .overrideComponent(CheckoutLoadErrorComponent, {
      set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    })
    .compileComponents();

  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, CheckoutLoadErrorComponent);
  await harness.fixture.whenStable();

  expect(TestBed.inject(Router).url).toBe(url);
  expect(harness.routeNativeElement?.textContent).toContain('Checkout page could not load');
  expect(harness.routeNativeElement?.textContent).not.toContain('Home page');
  expect(warn).toHaveBeenCalledExactlyOnceWith(diagnostic);
  expect(reload).not.toHaveBeenCalled();

  const button = harness.routeNativeElement?.querySelector<HTMLButtonElement>('button');
  expect(button?.textContent).toContain('Reload checkout');
  button?.click();
  expect(reload).toHaveBeenCalledOnce();
  expect(TestBed.inject(Router).url).toBe(url);
});
