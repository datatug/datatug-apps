import { Subject } from 'rxjs';
import {
  GITHUB_SIGNED_OUT_EVENT,
  GITHUB_TOKEN_OWNER_STORAGE_KEY,
  GITHUB_TOKEN_STORAGE_KEY,
  IGithubSignOutAuthState,
  forgetGithubTokenOnSignOut,
  tabStorage,
} from './github-redirect-capture';

describe('forgetGithubTokenOnSignOut', () => {
  function watch() {
    const states = new Subject<IGithubSignOutAuthState>();
    const events: string[] = [];
    const target = { dispatchEvent: (event: Event) => { events.push(event.type); return true; } };
    forgetGithubTokenOnSignOut(states, () => sessionStorage, target);
    return { states, events };
  }
  /** What `GithubOAuthService.setToken` (or the redirect capture) stores. */
  const storeToken = (token: string, owner: string) => {
    sessionStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, token);
    sessionStorage.setItem(GITHUB_TOKEN_OWNER_STORAGE_KEY, owner);
  };
  const kept = () => sessionStorage.getItem(GITHUB_TOKEN_STORAGE_KEY);
  afterEach(() => sessionStorage.clear());

  it('removes the token at sign-out and announces it', () => {
    const { states, events } = watch();
    storeToken('gho_u1', 'u1');
    states.next({ status: 'authenticating' });
    states.next({ status: 'authenticated', user: { uid: 'u1' } });
    expect(kept()).toBe('gho_u1');
    states.next({ status: 'notAuthenticated' });
    expect(kept()).toBeNull();
    expect(sessionStorage.getItem(GITHUB_TOKEN_OWNER_STORAGE_KEY)).toBeNull();
    expect(events).toEqual([GITHUB_SIGNED_OUT_EVENT]);
  });

  it('account switch, auth event first: the old token goes, the new one stored after it stays', () => {
    const { states } = watch();
    storeToken('gho_u1', 'u1');
    states.next({ status: 'authenticated', user: { uid: 'u1' } });
    states.next({ status: 'authenticated', user: { uid: 'u2' } });
    expect(kept()).toBeNull();
    storeToken('gho_u2', 'u2');
    states.next({ status: 'authenticated', user: { uid: 'u2' } });
    expect(kept()).toBe('gho_u2');
  });

  it('account switch, token stored first: the new account keeps its own token', () => {
    const { states, events } = watch();
    storeToken('gho_u1', 'u1');
    states.next({ status: 'authenticated', user: { uid: 'u1' } });
    storeToken('gho_u2', 'u2'); // popup sign-in as u2 stores its token before the auth event
    states.next({ status: 'authenticated', user: { uid: 'u2' } });
    expect(kept()).toBe('gho_u2');
    expect(events).toEqual([]);
  });

  it('removes a token kept with no owner, or for another user, at start-up', () => {
    const { states } = watch();
    sessionStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, 'gho_legacy');
    states.next({ status: 'authenticated', user: { uid: 'u1' } });
    expect(kept()).toBeNull();
    storeToken('gho_u2', 'u2');
    states.next({ status: 'authenticated', user: { uid: 'u1' } });
    expect(kept()).toBeNull();
  });

  it('does nothing while auth is still deciding, or with no token', () => {
    const { states, events } = watch();
    storeToken('gho_u1', 'u1');
    states.next({ status: 'authenticating' });
    expect(kept()).toBe('gho_u1');
    sessionStorage.clear();
    states.next({ status: 'notAuthenticated' });
    expect(events).toEqual([]);
  });
});

describe('with storage blocked by the browser', () => {
  /** Reading `sessionStorage` throws, as it does when site data is blocked. */
  function blockStorage() {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    return () => {
      if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    };
  }

  it('tabStorage is undefined instead of throwing', () => {
    const restore = blockStorage();
    try {
      expect(tabStorage()).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('the sign-out watch starts and follows auth states without throwing (no token, no owner)', () => {
    const restore = blockStorage();
    try {
      const states = new Subject<IGithubSignOutAuthState>();
      const events: string[] = [];
      const target = { dispatchEvent: (event: Event) => { events.push(event.type); return true; } };
      expect(() => forgetGithubTokenOnSignOut(states, undefined, target)).not.toThrow();
      expect(() => {
        states.next({ status: 'authenticated', user: { uid: 'u1' } });
        states.next({ status: 'notAuthenticated' });
      }).not.toThrow();
      expect(events).toEqual([]);
    } finally {
      restore();
    }
  });

  it('storage whose methods throw is no token either', () => {
    const states = new Subject<IGithubSignOutAuthState>();
    const throwing = { getItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    forgetGithubTokenOnSignOut(states, () => throwing, { dispatchEvent: () => true });
    expect(() => states.next({ status: 'notAuthenticated' })).not.toThrow();
  });
});
