import { TestBed } from '@angular/core/testing';
import { captureGithubRedirectSignIn } from './github-oauth.initializer';
import { GithubOAuthService } from './github-oauth.service';

describe('captureGithubRedirectSignIn', () => {
  const setup = (result: string | undefined): ReturnType<typeof vi.fn> => {
    const completeRedirectSignIn = vi.fn(() => Promise.resolve(result));
    TestBed.configureTestingModule({
      providers: [
        { provide: GithubOAuthService, useValue: { completeRedirectSignIn } },
      ],
    });
    return completeRedirectSignIn;
  };

  // The regression this guards: Firebase hands its pending redirect result to
  // whoever asks first, and the platform's auth bootstrap asks during start-up.
  // Reading it from the dialog lost the GitHub token, so the capture runs as an
  // app initializer registered ahead of the platform's providers.
  it('captures a pending redirect sign-in at start-up', async () => {
    const completeRedirectSignIn = setup('gho_redirect');

    await expect(
      TestBed.runInInjectionContext(captureGithubRedirectSignIn),
    ).resolves.toBe('gho_redirect');

    expect(completeRedirectSignIn).toHaveBeenCalledTimes(1);
  });

  it('resolves undefined when no redirect sign-in is pending', async () => {
    setup(undefined);

    await expect(
      TestBed.runInInjectionContext(captureGithubRedirectSignIn),
    ).resolves.toBeUndefined();
  });
});
