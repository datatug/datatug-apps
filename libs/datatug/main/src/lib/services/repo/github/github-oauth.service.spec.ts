import { TestBed } from '@angular/core/testing';

const authState = vi.hoisted(() => ({
  currentUser: { uid: 'user1' } as { uid: string } | null,
}));

const {
  linkWithPopupMock,
  signInWithPopupMock,
  linkWithRedirectMock,
  signInWithRedirectMock,
  getRedirectResultMock,
  credentialFromResultMock,
} = vi.hoisted(() => ({
  linkWithPopupMock: vi.fn(),
  signInWithPopupMock: vi.fn(),
  linkWithRedirectMock: vi.fn(),
  signInWithRedirectMock: vi.fn(),
  getRedirectResultMock: vi.fn(),
  credentialFromResultMock: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  GithubAuthProvider: class {
    public addScope = vi.fn();
    public static credentialFromResult = credentialFromResultMock;
  },
  linkWithPopup: linkWithPopupMock,
  signInWithPopup: signInWithPopupMock,
  linkWithRedirect: linkWithRedirectMock,
  signInWithRedirect: signInWithRedirectMock,
  getRedirectResult: getRedirectResultMock,
}));

vi.mock('@sneat/app-auth', () => ({
  SNEAT_FIREBASE_AUTH: 'SNEAT_FIREBASE_AUTH',
}));

import {
  GithubOAuthService,
  GithubSignInRedirecting,
} from './github-oauth.service';

const popupBlocked = (): Error & { code: string } =>
  Object.assign(new Error('popup blocked'), { code: 'auth/popup-blocked' });

describe('GithubOAuthService', () => {
  let service: GithubOAuthService;

  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        GithubOAuthService,
        { provide: 'SNEAT_FIREBASE_AUTH', useValue: authState },
      ],
    });
    service = TestBed.inject(GithubOAuthService);
  });

  it('keeps the popup as the default path and remembers the token', async () => {
    linkWithPopupMock.mockResolvedValue({});
    credentialFromResultMock.mockReturnValue({ accessToken: 'gho_popup' });

    await expect(service.signIn()).resolves.toBe('gho_popup');

    expect(linkWithPopupMock).toHaveBeenCalled();
    expect(signInWithRedirectMock).not.toHaveBeenCalled();
    expect(service.accessToken).toBe('gho_popup');
    expect(sessionStorage.getItem('datatug:github:token')).toBe('gho_popup');
  });

  it('falls back to a redirect when the browser blocks the popup', async () => {
    linkWithPopupMock.mockRejectedValue(popupBlocked());
    linkWithRedirectMock.mockResolvedValue(undefined);

    await expect(service.signIn()).rejects.toBeInstanceOf(GithubSignInRedirecting);

    expect(linkWithRedirectMock).toHaveBeenCalled();
    // The page is leaving: no token is claimed and no failure is reported.
    expect(service.accessToken).toBeUndefined();
  });


  it('picks the token up from a redirect result, once', async () => {
    getRedirectResultMock.mockResolvedValue({});
    credentialFromResultMock.mockReturnValue({ accessToken: 'gho_redirect' });

    await expect(service.completeRedirectSignIn()).resolves.toBe('gho_redirect');
    expect(getRedirectResultMock).toHaveBeenCalledTimes(1);

    // Idempotent: calling it again must not re-read (or lose) the result.
    await expect(service.completeRedirectSignIn()).resolves.toBe('gho_redirect');
    expect(getRedirectResultMock).toHaveBeenCalledTimes(1);
  });

  it('reports a redirect result without a token as "not signed in"', async () => {
    getRedirectResultMock.mockResolvedValue(null);

    await expect(service.completeRedirectSignIn()).resolves.toBeUndefined();
    expect(service.isSignedIn).toBe(false);
  });

  it('forgets the token without signing the user out of Sneat', async () => {
    linkWithPopupMock.mockResolvedValue({});
    credentialFromResultMock.mockReturnValue({ accessToken: 'gho_popup' });
    await service.signIn();

    service.forget();

    expect(service.isSignedIn).toBe(false);
    expect(sessionStorage.getItem('datatug:github:token')).toBeNull();
  });
});
