import { Subject } from 'rxjs';
import {
  GITHUB_SIGNED_OUT_EVENT,
  GITHUB_TOKEN_STORAGE_KEY,
  IGithubSignOutAuthState,
  forgetGithubTokenOnSignOut,
} from './github-redirect-capture';

describe('forgetGithubTokenOnSignOut', () => {
  function watch() {
    const states = new Subject<IGithubSignOutAuthState>();
    const events: string[] = [];
    const target = { dispatchEvent: (event: Event) => { events.push(event.type); return true; } };
    const subscription = forgetGithubTokenOnSignOut(states, sessionStorage, target);
    sessionStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, 'gho_user');
    return { states, events, subscription };
  }
  afterEach(() => sessionStorage.clear());

  it('removes the token at sign-out and announces it', () => {
    const { states, events } = watch();
    states.next({ status: 'authenticating' });
    states.next({ status: 'authenticated', user: { uid: 'u1' } });
    expect(sessionStorage.getItem(GITHUB_TOKEN_STORAGE_KEY)).toBe('gho_user');
    states.next({ status: 'notAuthenticated' });
    expect(sessionStorage.getItem(GITHUB_TOKEN_STORAGE_KEY)).toBeNull();
    expect(events).toEqual([GITHUB_SIGNED_OUT_EVENT]);
  });

  it('removes the token when another account signs in', () => {
    const { states } = watch();
    states.next({ status: 'authenticated', user: { uid: 'u1' } });
    states.next({ status: 'authenticated', user: { uid: 'u2' } });
    expect(sessionStorage.getItem(GITHUB_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('keeps the token of a first sign-in and of the same account signing in again', () => {
    const { states, events } = watch();
    states.next({ status: 'notAuthenticated' });
    states.next({ status: 'authenticated', user: { uid: 'u1' } });
    states.next({ status: 'authenticating' });
    states.next({ status: 'authenticated', user: { uid: 'u1' } });
    expect(sessionStorage.getItem(GITHUB_TOKEN_STORAGE_KEY)).toBe('gho_user');
    expect(events).toEqual([]);
  });
});
