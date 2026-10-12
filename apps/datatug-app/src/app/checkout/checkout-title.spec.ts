import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { CheckoutTitle } from './checkout-title';

it('does not let an outgoing Ionic checkout restore over the incoming page title', () => {
  const ownership = TestBed.inject(CheckoutTitle);
  const title = TestBed.inject(Title);
  const outgoing = {},
    incoming = {};
  const value = 'Complete your DataTug Pro subscription';
  ownership.claim(outgoing, value);
  ownership.claim(incoming, value);
  ownership.release(outgoing, value, 'DataTug.app');
  expect(title.getTitle()).toBe(value);
  ownership.release(incoming, value, 'DataTug.app');
  expect(title.getTitle()).toBe('DataTug.app');
});
it('preserves a destination title set outside checkout', () => {
  const ownership = TestBed.inject(CheckoutTitle);
  const title = TestBed.inject(Title);
  const owner = {};
  ownership.claim(owner, 'Checkout');
  title.setTitle('My account');
  ownership.release(owner, 'Checkout', 'DataTug.app');
  expect(title.getTitle()).toBe('My account');
});
