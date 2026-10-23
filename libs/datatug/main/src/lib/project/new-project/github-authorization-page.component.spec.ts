import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, Subject } from 'rxjs';
import { GithubAuthorizationPageComponent } from './github-authorization-page.component';
import { GithubConnectionService } from '../../services/repo/github/github-connection.service';
import { NewProjectService } from './new-project.service';
import { GITHUB_RECONNECT_SESSION_KEY } from './github-reauthorization-banner.component';
import { provideMockErrorLogger } from '../../testing/error-logger.spec-helper';
import { sha256Hex } from './sha256-hex';
import type { ComponentFixture } from '@angular/core/testing';

/** Waits until the page has hashed the returned state and matched it. */
async function resumed(fixture: ComponentFixture<GithubAuthorizationPageComponent>): Promise<void> {
  await (fixture.componentInstance as unknown as { resumed: Promise<void> }).resumed;
  fixture.detectChanges();
}

function harness(actorID = 'actor', useRealNewProjectService = false) {
  TestBed.resetTestingModule();
  const auth = new BehaviorSubject({
    status: 'notAuthenticated',
    user: { uid: actorID },
  });
  const result = new Subject<{
    connected: true;
    actorID: number | string;
    login: string;
    scopes: string[];
  }>();
  const complete = vi.fn((...args: unknown[]) => {
    void args;
    return result;
  });
  const legacyResult = new Subject<{ connected: true }>();
  const completeLegacy = vi.fn(() => legacyResult);
  const newProject = vi.fn();
  TestBed.configureTestingModule({
    imports: [GithubAuthorizationPageComponent],
    providers: [
      provideRouter([]),
      {
        provide: SneatAuthStateService,
        useValue: { authState: auth, signInWith: vi.fn() },
      },
      { provide: GithubConnectionService, useValue: { completeOAuth: complete, complete: completeLegacy } },
      provideMockErrorLogger(),
    ],
  }).overrideComponent(GithubAuthorizationPageComponent, {
    set: {
      providers: useRealNewProjectService
        ? [NewProjectService]
        : [
            {
              provide: NewProjectService,
              useValue: { returnFromGithubOAuth: newProject },
            },
          ],
    },
  });
  return { auth, result, legacyResult, complete, completeLegacy, newProject, router: TestBed.inject(Router) };
}

afterEach(() => {
  delete window.__datatugTakeGitHubAuthorization;
  sessionStorage.removeItem('datatug:new-project:draft');
  sessionStorage.removeItem(GITHUB_RECONNECT_SESSION_KEY);
});
describe('GitHub callback authenticated exchange', () => {
  it('consumes the handoff, waits for Firebase and resumes the saved operation once', async () => {
    const h = harness();
    sessionStorage.setItem('datatug:new-project:draft', JSON.stringify({ operationID: '11111111-1111-4111-8111-111111111111', oauthResumePending: true, oauthStateHash: await sha256Hex('state-fixture'), ciEnabled: true }));
    window.__datatugTakeGitHubAuthorization = () => ({
      code: 'code-fixture',
      state: 'state-fixture',
    });
    const fixture = TestBed.createComponent(GithubAuthorizationPageComponent);
    fixture.detectChanges();
    await resumed(fixture);
    expect(window.__datatugTakeGitHubAuthorization).toBeUndefined();
    expect(h.complete).not.toHaveBeenCalled();
    h.auth.next({ status: 'authenticated', user: { uid: 'actor' } });
    expect(h.complete).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'code-fixture', 'state-fixture');
    h.result.next({ connected: true, actorID: 'github-actor', login: 'alex', scopes: ['repo', 'workflow'] });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Resuming your saved project request');
    expect(h.newProject).toHaveBeenCalledWith('success');
    h.auth.next({ status: 'authenticated', user: { uid: 'actor' } });
    expect(h.complete).toHaveBeenCalledTimes(1);
  });
  it('does not reuse a missing return or show raw provider failures', async () => {
    const h = harness();
    const fixture = TestBed.createComponent(GithubAuthorizationPageComponent);
    fixture.detectChanges();
    await resumed(fixture);
    h.auth.next({ status: 'authenticated', user: { uid: 'actor' } });
    expect(h.complete).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('authorization was canceled');
    expect(h.newProject).not.toHaveBeenCalled();
  });
  it('returns a state-matched OAuth denial to the saved form without exchanging a code', async () => {
    const h = harness();
    sessionStorage.setItem('datatug:new-project:draft', JSON.stringify({ operationID: '11111111-1111-4111-8111-111111111111', oauthResumePending: true, oauthStateHash: await sha256Hex('denied-state') }));
    window.__datatugTakeGitHubAuthorization = () => ({ error: 'access_denied', state: 'denied-state' });
    const fixture = TestBed.createComponent(GithubAuthorizationPageComponent);
    fixture.detectChanges();
    await resumed(fixture);
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.newProject).toHaveBeenCalledWith('denied');
    expect(fixture.nativeElement.textContent).toContain('authorization was canceled');
  });
  it('requires repository and branch reselection when the connected GitHub actor changes', async () => {
    const h = harness();
    sessionStorage.setItem('datatug:new-project:draft', JSON.stringify({ actorID: 'actor', githubActorID: '100', operationID: '11111111-1111-4111-8111-111111111111', oauthResumePending: true, oauthStateHash: await sha256Hex('state-fixture'), ciEnabled: false, repositoryID: 42, githubRepositoryURL: 'https://github.com/old/repo', branch: 'main' }));
    window.__datatugTakeGitHubAuthorization = () => ({ code: 'code-fixture', state: 'state-fixture' });
    const fixture = TestBed.createComponent(GithubAuthorizationPageComponent);
    fixture.detectChanges();
    await resumed(fixture);
    h.auth.next({ status: 'authenticated', user: { uid: 'actor' } });
    h.result.next({ connected: true, actorID: 200, login: 'other', scopes: ['repo'] });
    const draft = JSON.parse(sessionStorage.getItem('datatug:new-project:draft') ?? 'null');
    expect(h.newProject).toHaveBeenCalledWith('actor-changed');
    expect(draft.githubActorID).toBe('200');
    expect(draft.repositoryID).toBeUndefined();
    expect(draft.githubRepositoryURL).toBe('');
    expect(draft.branch).toBe('');
    expect(draft.operationID).toBeUndefined();
  });
  it('returns the same actor to the saved project request after OAuth', async () => {
    const h = harness('business-only-actor', true);
    const navigate = vi.spyOn(h.router, 'navigate').mockResolvedValue(true);
    sessionStorage.setItem('datatug:new-project:draft', JSON.stringify({ operationID: '22222222-2222-4222-8222-222222222222', oauthResumePending: true, oauthStateHash: await sha256Hex('state-fixture'), ciEnabled: false }));
    window.__datatugTakeGitHubAuthorization = () => ({
      code: 'code-fixture',
      state: 'state-fixture',
    });
    const fixture = TestBed.createComponent(GithubAuthorizationPageComponent);
    fixture.detectChanges();
    await resumed(fixture);
    h.auth.next({
      status: 'authenticated',
      user: { uid: 'business-only-actor' },
    });
    h.result.next({ connected: true, actorID: 'github-user-2', login: 'alex', scopes: ['repo'] });
    await fixture.whenStable();
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(['/new-project'], {
      queryParams: { store: 'github', oauthResult: 'success' },
    });
  });
  it('cancels an old-actor return on a session change and never claims it is connected for the new actor', async () => {
    const h = harness();
    sessionStorage.setItem('datatug:new-project:draft', JSON.stringify({ operationID: '11111111-1111-4111-8111-111111111111', oauthResumePending: true, oauthStateHash: await sha256Hex('state-fixture'), ciEnabled: false }));
    window.__datatugTakeGitHubAuthorization = () => ({
      code: 'code-fixture',
      state: 'state-fixture',
    });
    const fixture = TestBed.createComponent(GithubAuthorizationPageComponent);
    fixture.detectChanges();
    await resumed(fixture);
    h.auth.next({ status: 'authenticated', user: { uid: 'actor' } });
    h.auth.next({ status: 'authenticated', user: { uid: 'different' } });
    h.result.next({ connected: true, actorID: 3860020, login: 'alex', scopes: ['repo'] });
    await fixture.whenStable();
    expect(fixture.componentInstance.connected()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('sign-in changed');
  });
  it('keeps a legacy App return on its legacy path when an old OAuth draft has a different state', async () => {
    const h = harness();
    sessionStorage.setItem('datatug:new-project:draft', JSON.stringify({ operationID: '11111111-1111-4111-8111-111111111111', oauthResumePending: true, oauthStateHash: await sha256Hex('new-callback-state') }));
    window.__datatugTakeGitHubAuthorization = () => ({ code: 'app-code', state: 'old-app-state' });
    const fixture = TestBed.createComponent(GithubAuthorizationPageComponent);
    fixture.detectChanges();
    await resumed(fixture);
    h.auth.next({ status: 'authenticated', user: { uid: 'actor' } });
    expect(h.completeLegacy).toHaveBeenCalledWith('app-code', 'old-app-state');
    expect(h.complete).not.toHaveBeenCalled();
  });
  it('never matches a saved request by a clear-text state, and clears the hash once bound', async () => {
    const h = harness();
    sessionStorage.setItem('datatug:new-project:draft', JSON.stringify({ operationID: '11111111-1111-4111-8111-111111111111', oauthResumePending: true, oauthState: 'plain-state' }));
    window.__datatugTakeGitHubAuthorization = () => ({ code: 'app-code', state: 'plain-state' });
    const fixture = TestBed.createComponent(GithubAuthorizationPageComponent);
    fixture.detectChanges();
    await resumed(fixture);
    h.auth.next({ status: 'authenticated', user: { uid: 'actor' } });
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.completeLegacy).toHaveBeenCalledWith('app-code', 'plain-state');

    sessionStorage.setItem('datatug:new-project:draft', JSON.stringify({ operationID: '11111111-1111-4111-8111-111111111111', oauthResumePending: true, oauthStateHash: await sha256Hex('bound-state'), ciEnabled: false }));
    window.__datatugTakeGitHubAuthorization = () => ({ code: 'code-fixture', state: 'bound-state' });
    const next = harness();
    const second = TestBed.createComponent(GithubAuthorizationPageComponent);
    second.detectChanges();
    await resumed(second);
    next.auth.next({ status: 'authenticated', user: { uid: 'actor' } });
    expect(next.complete).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'code-fixture', 'bound-state');
    next.result.next({ connected: true, actorID: 7, login: 'alex', scopes: ['repo'] });
    const draft = sessionStorage.getItem('datatug:new-project:draft') ?? '';
    expect(JSON.parse(draft)).toMatchObject({ githubActorID: '7' });
    expect(JSON.parse(draft)).not.toHaveProperty('oauthStateHash');
    expect(draft).not.toContain('bound-state');
  });
  it('resumes nothing and does not throw when the page is left before the state hash settles', async () => {
    const h = harness();
    sessionStorage.setItem('datatug:new-project:draft', JSON.stringify({ operationID: '11111111-1111-4111-8111-111111111111', oauthResumePending: true, oauthStateHash: await sha256Hex('state-fixture'), ciEnabled: false }));
    window.__datatugTakeGitHubAuthorization = () => ({ code: 'code-fixture', state: 'state-fixture' });
    const fixture = TestBed.createComponent(GithubAuthorizationPageComponent);
    fixture.detectChanges();
    fixture.destroy();
    await (fixture.componentInstance as unknown as { resumed: Promise<void> }).resumed;
    h.auth.next({ status: 'authenticated', user: { uid: 'actor' } });
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.completeLegacy).not.toHaveBeenCalled();
    expect(h.newProject).not.toHaveBeenCalled();
  });
  it('replaces the checking message with a retry hint when resuming fails', async () => {
    harness();
    window.__datatugTakeGitHubAuthorization = () => ({ code: 'code-fixture', state: 'state-fixture' });
    const fixture = TestBed.createComponent(GithubAuthorizationPageComponent);
    vi.spyOn(fixture.componentInstance as unknown as { resumeAuthorization: () => void }, 'resumeAuthorization').mockImplementation(() => {
      throw new Error('resume failed');
    });
    fixture.detectChanges();
    await resumed(fixture);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Checking your DataTug sign-in');
    expect(fixture.nativeElement.textContent).toContain('could not be checked');
  });
  it('completes only the state-bound reconnect operation and returns to the safe project route', async () => {
    const h = harness();
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    sessionStorage.setItem(
      GITHUB_RECONNECT_SESSION_KEY,
      JSON.stringify({
        operationID: '33333333-3333-4333-8333-333333333333',
        firebaseUID: 'actor',
        oauthStateHash: await sha256Hex('reconnect-state'),
        returnUrl: '/projects/repo?branch=work',
        requiredScopes: ['repo', 'workflow'],
      }),
    );
    window.__datatugTakeGitHubAuthorization = () => ({
      code: 'reconnect-code',
      state: 'reconnect-state',
    });
    const fixture = TestBed.createComponent(GithubAuthorizationPageComponent);
    fixture.detectChanges();
    await resumed(fixture);
    h.auth.next({ status: 'authenticated', user: { uid: 'actor' } });
    expect(h.complete).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      'reconnect-code',
      'reconnect-state',
    );
    h.result.next({ connected: true, actorID: 3860020, login: 'alex', scopes: ['repo', 'workflow'] });
    await fixture.whenStable();

    expect(assign).toHaveBeenCalledWith('/projects/repo?branch=work');
    expect(sessionStorage.getItem(GITHUB_RECONNECT_SESSION_KEY)).toBeNull();
    assign.mockRestore();
  });
  it('restores sign-in state and cancels a delayed legacy completion after the Firebase actor changes', async () => {
    const h = harness();
    window.__datatugTakeGitHubAuthorization = () => ({ code: 'app-code', state: 'legacy-state' });
    const fixture = TestBed.createComponent(GithubAuthorizationPageComponent);
    fixture.detectChanges();
    await resumed(fixture);
    expect(fixture.componentInstance.needsSignIn()).toBe(true);
    h.auth.next({ status: 'authenticated', user: { uid: 'actor' } });
    expect(h.completeLegacy).toHaveBeenCalledWith('app-code', 'legacy-state');
    h.auth.next({ status: 'authenticated', user: { uid: 'actor-b' } });
    h.legacyResult.next({ connected: true });
    await fixture.whenStable();

    expect(fixture.componentInstance.connected()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('sign-in changed');
    expect(h.newProject).not.toHaveBeenCalled();
  });
});
describe('GitHub callback "Back to projects"', () => {
  it('navigates to / inside the app, so each product profile resolves its own home, instead of reloading the page at /', () => {
    harness();
    const fixture = TestBed.createComponent(GithubAuthorizationPageComponent);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const button: HTMLElement = Array.from(
      fixture.nativeElement.querySelectorAll(
        'ion-button',
      ) as NodeListOf<HTMLElement>,
    ).find((candidate) =>
      candidate.textContent?.includes('Back to projects'),
    ) as HTMLElement;

    // A plain `href="/"` would be a full page load, and a full page load of
    // `/` is answered by the DataTug.app landing page, not by this app: the
    // router has to take the click over, which cancels the browser's own
    // navigation.
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(router.serializeUrl(navigate.mock.calls[0][0] as UrlTree)).toBe('/');
  });
});
