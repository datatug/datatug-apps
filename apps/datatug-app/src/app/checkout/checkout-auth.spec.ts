import { BehaviorSubject } from 'rxjs';
import type {
  ISneatAuthState,
  ISneatUserState,
  SneatAuthStateService,
  SneatUserService,
} from '@sneat/auth-core';
import { isSneatAccountReady } from '@sneat/auth-core';
import type { Router } from '@angular/router';
import { appCheckoutAuth } from './checkout-auth';

const accountAuthState = (
  uid: string,
  isAnonymous = false,
): ISneatAuthState => ({
  status: 'authenticated',
  loadingPhase: 'ready',
  token: 'in-memory-test-token',
  user: {
    uid,
    email: `${uid}@example.invalid`,
    isAnonymous,
  } as ISneatAuthState['user'],
});

const accountUserState = (
  uid: string,
  userRecordStatus: ISneatUserState['userRecordStatus'],
  isAnonymous = false,
): ISneatUserState =>
  ({
    status: 'authenticated',
    user: { uid, isAnonymous } as ISneatUserState['user'],
    record: { title: uid },
    userRecordStatus,
  }) as ISneatUserState;

describe('DataTug checkout identity readiness', () => {
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
        {} as SneatUserService,
        { navigate } as unknown as Router,
        path,
      );
      await adapter.signIn();
      expect(navigate).toHaveBeenCalledWith(['/login'], {
        fragment: path,
        queryParams: { reason: 'Sign in to continue with DataTug Pro' },
      });
    },
  );

  it.each([
    '/business/checkout?planID=datatug-business-usage-monthly&checkout=test',
    '/business/checkout?planID=datatug-business-usage-annual&spaceID=space_1',
    '/business/checkout/return?spaceID=space_1&mode=test&session_id=cs_test_paid',
    '/business/checkout/return?spaceID=space_1&mode=live&session_id=cs_live_paid',
  ])('preserves validated Business continuation %s', async (path) => {
    const navigate = vi.fn().mockResolvedValue(true);
    const adapter = appCheckoutAuth(
      {} as SneatAuthStateService,
      {} as SneatUserService,
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

  it.each(['loading', 'failed', undefined] as const)(
    'does not accept a non-ready profile: %s',
    (status) => {
      expect(
        isSneatAccountReady(
          accountAuthState('buyer'),
          accountUserState('buyer', status),
        ),
      ).toBe(false);
    },
  );

  it('requires the exact authenticated nonanonymous UID and persisted record', () => {
    expect(
      isSneatAccountReady(
        accountAuthState('buyer'),
        accountUserState('buyer', 'ready'),
      ),
    ).toBe(true);
    expect(
      isSneatAccountReady(
        accountAuthState('buyer'),
        accountUserState('previous-buyer', 'ready'),
      ),
    ).toBe(false);
    expect(
      isSneatAccountReady(
        accountAuthState('buyer', true),
        accountUserState('buyer', 'ready', true),
      ),
    ).toBe(false);
    expect(
      isSneatAccountReady(
        { ...accountAuthState('buyer'), loadingPhase: 'failed' },
        accountUserState('buyer', 'ready'),
      ),
    ).toBe(false);
    expect(
      isSneatAccountReady(
        { ...accountAuthState('buyer'), token: '' },
        accountUserState('buyer', 'ready'),
      ),
    ).toBe(false);
  });

  it('waits through cold auth and account initialization, then uses only the current token', async () => {
    const authStates = new BehaviorSubject<ISneatAuthState>({
      status: 'authenticating',
    });
    const userStates = new BehaviorSubject<ISneatUserState>({
      status: 'authenticating',
    });
    const buyer = { uid: 'buyer', isAnonymous: false };
    const token = vi.fn().mockResolvedValue('in-memory-only');
    const auth = {
      authState: authStates,
      fbAuth: { currentUser: { ...buyer, getIdToken: token } },
    } as unknown as SneatAuthStateService;
    const adapter = appCheckoutAuth(
      auth,
      { userState: userStates } as unknown as SneatUserService,
      {} as Router,
      selections[0],
    );
    const observed = vi.fn();
    const unsubscribe = adapter.observe(observed);
    expect(observed).not.toHaveBeenCalled();

    authStates.next(accountAuthState('buyer'));
    expect(observed).toHaveBeenLastCalledWith(null);
    userStates.next(accountUserState('buyer', 'loading'));
    expect(observed).toHaveBeenLastCalledWith(null);
    expect(await adapter.token()).toBeNull();

    userStates.next(accountUserState('buyer', 'ready'));
    expect(observed).toHaveBeenLastCalledWith({
      id: 'buyer',
      email: 'buyer@example.invalid',
    });
    expect(await adapter.token()).toBe('in-memory-only');
    expect(token).toHaveBeenCalledOnce();

    authStates.next(accountAuthState('different-buyer'));
    expect(observed).toHaveBeenLastCalledWith(null);
    expect(await adapter.token()).toBeNull();
    unsubscribe();
    authStates.next({ status: 'notAuthenticated' });
    expect(observed).toHaveBeenCalledTimes(4);
  });

  it('keeps quote and token access closed after sign-in failure or account change', async () => {
    const authStates = new BehaviorSubject<ISneatAuthState>(
      accountAuthState('buyer'),
    );
    const userStates = new BehaviorSubject<ISneatUserState>(
      accountUserState('buyer', 'ready'),
    );
    const getIdToken = vi.fn().mockResolvedValue('in-memory-only');
    const auth = {
      authState: authStates,
      fbAuth: {
        currentUser: {
          uid: 'buyer',
          isAnonymous: false,
          getIdToken,
        },
      },
    } as unknown as SneatAuthStateService;
    const adapter = appCheckoutAuth(
      auth,
      { userState: userStates } as unknown as SneatUserService,
      {} as Router,
      selections[0],
    );
    const observed = vi.fn();
    adapter.observe(observed);

    expect(observed).toHaveBeenLastCalledWith({
      id: 'buyer',
      email: 'buyer@example.invalid',
    });
    authStates.next({ ...accountAuthState('buyer'), loadingPhase: 'failed' });
    expect(observed).toHaveBeenLastCalledWith(null);
    expect(await adapter.token()).toBeNull();
    expect(getIdToken).not.toHaveBeenCalled();

    authStates.next(accountAuthState('buyer'));
    userStates.next(accountUserState('previous-buyer', 'ready'));
    expect(observed).toHaveBeenLastCalledWith(null);
    expect(await adapter.token()).toBeNull();
    expect(getIdToken).not.toHaveBeenCalled();
  });

  it('discards a token if the active Firebase identity changes during token acquisition', async () => {
    const authStates = new BehaviorSubject<ISneatAuthState>(
      accountAuthState('buyer'),
    );
    const userStates = new BehaviorSubject<ISneatUserState>(
      accountUserState('buyer', 'ready'),
    );
    let resolveToken!: (value: string) => void;
    const getIdToken = vi.fn(
      () => new Promise<string>((resolve) => (resolveToken = resolve)),
    );
    let currentUser = {
      uid: 'buyer',
      isAnonymous: false,
      getIdToken,
    };
    const auth = {
      authState: authStates,
      fbAuth: {
        get currentUser() {
          return currentUser;
        },
      },
    } as unknown as SneatAuthStateService;
    const adapter = appCheckoutAuth(
      auth,
      { userState: userStates } as unknown as SneatUserService,
      {} as Router,
      selections[0],
    );
    adapter.observe(vi.fn());

    const tokenPromise = adapter.token();
    currentUser = {
      uid: 'different-buyer',
      isAnonymous: false,
      getIdToken: vi.fn().mockResolvedValue('new-account-token'),
    };
    authStates.next(accountAuthState('different-buyer'));
    resolveToken('old-account-token');
    expect(await tokenPromise).toBeNull();
  });

  it.each(['auth token failure', 'matching record readiness loss'] as const)(
    'discards an in-flight token after %s',
    async (invalidation) => {
      const authStates = new BehaviorSubject<ISneatAuthState>(
        accountAuthState('buyer'),
      );
      const userStates = new BehaviorSubject<ISneatUserState>(
        accountUserState('buyer', 'ready'),
      );
      let resolveToken!: (value: string) => void;
      const currentUser = {
        uid: 'buyer',
        isAnonymous: false,
        getIdToken: vi.fn(
          () => new Promise<string>((resolve) => (resolveToken = resolve)),
        ),
      };
      const adapter = appCheckoutAuth(
        {
          authState: authStates,
          fbAuth: { currentUser },
        } as unknown as SneatAuthStateService,
        { userState: userStates } as unknown as SneatUserService,
        {} as Router,
        selections[0],
      );
      adapter.observe(vi.fn());

      const tokenPromise = adapter.token();
      if (invalidation === 'auth token failure') {
        authStates.next({
          ...accountAuthState('buyer'),
          loadingPhase: 'failed',
        });
      } else {
        userStates.next(accountUserState('buyer', 'loading'));
      }
      resolveToken('stale-token');

      expect(await tokenPromise).toBeNull();
    },
  );

  it.each([
    'https://evil.invalid',
    '//evil.invalid',
    '/subscribe?plan=business&period=monthly&checkout=test',
    '/subscribe?plan=pro&period=monthly&checkout=test&token=x',
    '/subscribe?plan=pro&period=monthly&account=other',
    '/business/checkout?planID=datatug-business-usage-monthly&api=https://evil.invalid',
    '/business/checkout?planID=datatug-business-usage-monthly&spaceID=../private',
    '/business/checkout/return?spaceID=space_1&mode=live&session_id=cs_test_paid',
    '/business/checkout/return?spaceID=space_1&session_id=cs_test_paid',
  ])('rejects unsafe continuation %s', (path) => {
    expect(() =>
      appCheckoutAuth(
        {} as SneatAuthStateService,
        {} as SneatUserService,
        {} as Router,
        path,
      ),
    ).toThrow('Invalid checkout continuation');
  });
});
