import { BehaviorSubject } from 'rxjs';
import type { ISneatAuthState, SneatAuthStateService } from '@sneat/auth-core';
import type { Router } from '@angular/router';
import { appCheckoutAuth } from './checkout-auth';

describe('existing app checkout identity', () => {
  const selections = [
    '/subscribe?plan=pro&period=monthly',
    '/subscribe?plan=pro&period=yearly',
    '/subscribe?plan=pro&period=yearly&checkout=test',
    '/pricing/return?mode=test&session_id=cs_test_paid',
    '/pricing/return?mode=live&session_id=cs_live_paid',
  ];
  it.each(selections)(
    'preserves %s through the released login fragment contract',
    async (path) => {
      const navigate = vi.fn().mockResolvedValue(true);
      const adapter = appCheckoutAuth(
        {} as SneatAuthStateService,
        { navigate } as unknown as Router,
        path,
      );
      await adapter.signIn();
      expect(navigate).toHaveBeenCalledWith(['/login'], {
        fragment: path,
        queryParams: { reason: 'Sign in to continue with DataTug Pro' },
      });
      // Released LoginPageComponent reads location.hash.substring(1).
      expect(('#' + navigate.mock.calls[0][1].fragment).substring(1)).toBe(
        path,
      );
    },
  );
  it.each([
    '/business/checkout?planID=datatug-business-usage-monthly',
    '/business/checkout?planID=datatug-business-usage-annual&spaceID=space_1',
    '/business/checkout/return?spaceID=space_1&session_id=cs_test_paid',
  ])('preserves validated Business TEST continuation %s', async (path) => {
    const navigate = vi.fn().mockResolvedValue(true);
    const adapter = appCheckoutAuth(
      {} as SneatAuthStateService,
      { navigate } as unknown as Router,
      path,
      'DataTug Business checkout',
    );
    await adapter.signIn();
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      fragment: path,
      queryParams: {
        reason: 'Sign in to continue with DataTug Business checkout',
      },
    });
  });
  it('waits for cold authentication and uses the existing current-user token only', async () => {
    const states = new BehaviorSubject<ISneatAuthState>({
      status: 'authenticating',
    });
    const token = vi.fn().mockResolvedValue('in-memory-only');
    const auth = {
      authState: states,
      fbAuth: { currentUser: { getIdToken: token, isAnonymous: false } },
    } as unknown as SneatAuthStateService;
    const adapter = appCheckoutAuth(auth, {} as Router, selections[0]);
    const observed = vi.fn();
    const unsubscribe = adapter.observe(observed);
    expect(observed).not.toHaveBeenCalled();
    states.next({
      status: 'authenticated',
      user: {
        uid: 'buyer',
        email: 'buyer@example.invalid',
        isAnonymous: false,
      } as ISneatAuthState['user'],
    });
    expect(observed).toHaveBeenLastCalledWith({
      id: 'buyer',
      email: 'buyer@example.invalid',
    });
    expect(await adapter.token()).toBe('in-memory-only');
    expect(token).toHaveBeenCalledOnce();
    states.next({ status: 'notAuthenticated' });
    expect(observed).toHaveBeenLastCalledWith(null);
    unsubscribe();
    states.next({ status: 'notAuthenticated' });
    expect(observed).toHaveBeenCalledTimes(2);
  });
  it.each([
    'https://evil.invalid',
    '//evil.invalid',
    '/subscribe?plan=business&period=monthly&checkout=test',
    '/subscribe?plan=pro&period=monthly&checkout=test&token=x',
    '/subscribe?plan=pro&period=monthly&account=other',
    '/business/checkout?planID=datatug-business-usage-monthly&api=https://evil.invalid',
    '/business/checkout?planID=datatug-business-usage-monthly&spaceID=../private',
    '/business/checkout/return?spaceID=space_1&session_id=cs_live_paid',
  ])('rejects unsafe continuation %s', (path) => {
    expect(() =>
      appCheckoutAuth({} as SneatAuthStateService, {} as Router, path),
    ).toThrow('Invalid checkout continuation');
  });
});
