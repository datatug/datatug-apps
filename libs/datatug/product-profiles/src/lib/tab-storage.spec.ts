import { afterEach, describe, expect, it } from 'vitest';
import { tabStorage } from './tab-storage';

describe('tabStorage', () => {
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    'sessionStorage',
  );

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
  });

  it('returns the tab sessionStorage', () => {
    expect(tabStorage()).toBe(globalThis.sessionStorage);
  });

  it('is undefined instead of throwing when the browser blocks storage', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    expect(tabStorage()).toBeUndefined();
  });

  it('is undefined where there is no sessionStorage', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: undefined,
    });
    expect(tabStorage()).toBeUndefined();
  });
});
