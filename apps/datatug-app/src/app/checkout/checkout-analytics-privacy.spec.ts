import { TestBed } from '@angular/core/testing';
import { NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';
import indexHtml from '../../index.html?raw';
import {
  CHECKOUT_GA_IDS,
  CHECKOUT_PRIVACY_FLAG,
  disableCheckoutAnalytics,
  isCheckoutAddress,
  provideCheckoutAnalyticsPrivacy,
} from './checkout-analytics-privacy';
import { ApplicationInitStatus } from '@angular/core';

it.each([
  '/subscribe',
  '/subscribe/?plan=pro&checkout=test',
  '/pricing/return?mode=test&session_id=cs_test_paid',
  '//pricing//return/',
  '/pricing;foo=1/return',
  '/%73ubscribe',
  '/login#/pricing/return?mode=test&session_id=cs_test_paid',
  '/login#/subscribe?plan=pro&period=monthly&checkout=test',
  '/business/checkout?planID=datatug-business-usage-monthly&spaceID=s1',
  '/business/checkout/return?spaceID=s1&session_id=cs_test_paid',
  '/login#/business/checkout?planID=datatug-business-usage-annual&spaceID=s1',
  '/login#/business/checkout/return?spaceID=s1&session_id=cs_test_paid',
])('recognizes %s without needing the session query', (url) => {
  expect(isCheckoutAddress(url)).toBe(true);
});
it('disables for document lifetime without re-enabling after cancellation or another route', () => {
  const target = {};
  disableCheckoutAnalytics(
    '/subscribe?plan=pro&period=monthly&checkout=test',
    target,
  );
  disableCheckoutAnalytics('/project/github.com/datatug/project', target);
  expect(target).toEqual({
    [CHECKOUT_PRIVACY_FLAG]: true,
    ...Object.fromEntries(
      CHECKOUT_GA_IDS.map((id) => ['ga-disable-' + id, true]),
    ),
  });
});
it('sets initial-page disable before the GA snippet executes', () => {
  const start = indexHtml.indexOf('<!-- Checkout privacy:');
  const end = indexHtml.indexOf('<!-- Google Analytics', start);
  expect(start).toBeGreaterThan(0);
  const snippet = indexHtml
    .slice(start, end)
    .match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!snippet) throw new Error('Missing initial checkout privacy script');
  for (const pathname of [
    '/subscribe/',
    '/pricing/return/',
    '/%73ubscribe',
    '/login#/pricing/return?mode=test&session_id=cs_test_paid',
    '/login#/subscribe?plan=pro&period=monthly&checkout=test',
    '/business/checkout?planID=datatug-business-usage-monthly&spaceID=s1',
    '/business/checkout/return?spaceID=s1&session_id=cs_test_paid',
    '/login#/business/checkout?planID=datatug-business-usage-annual&spaceID=s1',
    '/login#/business/checkout/return?spaceID=s1&session_id=cs_test_paid',
    '/pricing;foo=1/return',
  ]) {
    const target = {};
    new Function('window', 'location', snippet)(target, {
      pathname: pathname.split('#')[0],
      hash: pathname.includes('#') ? '#' + pathname.split('#')[1] : '',
    });
    expect(target).toEqual({
      [CHECKOUT_PRIVACY_FLAG]: true,
      ...Object.fromEntries(
        CHECKOUT_GA_IDS.map((id) => ['ga-disable-' + id, true]),
      ),
    });
  }
  expect(indexHtml).toContain(
    'page_location: location.origin + location.pathname',
  );
});
it('initializes the Router listener and disables synchronously on NavigationStart before history changes', () => {
  const events = new Subject<NavigationStart>();
  TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: { events } },
      provideCheckoutAnalyticsPrivacy(),
    ],
  });
  TestBed.inject(ApplicationInitStatus).runInitializers();
  const target = window as unknown as Record<string, unknown>;
  const keys = [
    CHECKOUT_PRIVACY_FLAG,
    ...CHECKOUT_GA_IDS.map((id) => 'ga-disable-' + id),
  ];
  const previous = keys.map((key) => target[key]);
  try {
    for (const key of keys) delete target[key];
    events.next(
      new NavigationStart(
        1,
        '/pricing/return?mode=test&session_id=cs_test_paid',
      ),
    );
    for (const key of keys) expect(target[key]).toBe(true);
    events.next(new NavigationStart(2, '/'));
    for (const key of keys) expect(target[key]).toBe(true);
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete target[key];
      else target[key] = previous[index];
    });
    events.complete();
  }
});
