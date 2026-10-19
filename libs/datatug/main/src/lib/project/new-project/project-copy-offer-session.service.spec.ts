import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectCopyOfferSessionService } from './project-copy-offer-session.service';

afterEach(() => vi.unstubAllGlobals());

describe('project copy offer tab session', () => {
  it('restores dataset-specific dismissal after app recreation and clears it on reopen', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key),
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    const first = new ProjectCopyOfferSessionService();
    first.setDismissed('northwind', true);
    const reloaded = new ProjectCopyOfferSessionService();
    expect(reloaded.dismissed('northwind')).toBe(true);
    expect(reloaded.dismissed('chinook')).toBe(false);
    reloaded.setDismissed('northwind', false);
    expect(new ProjectCopyOfferSessionService().dismissed('northwind')).toBe(false);
  });

  it('keeps an in-memory preference when session storage reads and writes are denied', () => {
    const denied = () => { throw new Error('Storage denied'); };
    vi.stubGlobal('sessionStorage', { getItem: denied, setItem: denied, removeItem: denied });
    const session = new ProjectCopyOfferSessionService();
    expect(session.dismissed('northwind')).toBe(false);
    session.setDismissed('northwind', true);
    expect(session.dismissed('northwind')).toBe(true);
    expect(session.dismissed('chinook')).toBe(false);
    session.setDismissed('northwind', false);
    expect(session.dismissed('northwind')).toBe(false);
  });
});
