import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { ErrorLogger } from '@sneat/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { GithubAuthorizationPageComponent } from './github-authorization-page.component';
import { GithubConnectionService } from '../../services/repo/github/github-connection.service';
import { NewProjectService } from './new-project.service';
import { saveBusinessGithubContinuation } from './business-github-continuation';

function harness(actorID = 'actor', useRealNewProjectService = false) {
  TestBed.resetTestingModule();
  const auth = new BehaviorSubject({
    status: 'notAuthenticated',
    user: { uid: actorID },
  });
  const result = new Subject<{ connected: true }>();
  const complete = vi.fn((...args: unknown[]) => {
    void args;
    return result;
  });
  const newProject = vi.fn();
  TestBed.configureTestingModule({
    imports: [GithubAuthorizationPageComponent],
    providers: [
      provideRouter([]),
      {
        provide: SneatAuthStateService,
        useValue: { authState: auth, signInWith: vi.fn() },
      },
      { provide: GithubConnectionService, useValue: { complete } },
      {
        provide: ErrorLogger,
        useValue: { logError: vi.fn(), logErrorHandler: vi.fn(() => vi.fn()) },
      },
    ],
  }).overrideComponent(GithubAuthorizationPageComponent, {
    set: {
      providers: useRealNewProjectService
        ? [NewProjectService]
        : [
            {
              provide: NewProjectService,
              useValue: { navigateToNewProjectPage: newProject },
            },
          ],
    },
  });
  return { auth, result, complete, newProject, router: TestBed.inject(Router) };
}

afterEach(() => {
  delete window.__datatugTakeGitHubAuthorization;
  sessionStorage.removeItem('datatug:new-project:github-business-continuation');
});
describe('GitHub callback authenticated exchange', () => {
  it('consumes only the ephemeral handoff, waits for Firebase, exchanges once and offers the real create dialog', async () => {
    const h = harness();
    window.__datatugTakeGitHubAuthorization = () => ({
      code: 'code-fixture',
      state: 'state-fixture',
    });
    const fixture = TestBed.createComponent(GithubAuthorizationPageComponent);
    fixture.detectChanges();
    expect(window.__datatugTakeGitHubAuthorization).toBeUndefined();
    expect(h.complete).not.toHaveBeenCalled();
    h.auth.next({ status: 'authenticated', user: { uid: 'actor' } });
    expect(h.complete).toHaveBeenCalledWith('code-fixture', 'state-fixture');
    h.result.next({ connected: true });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('GitHub is connected');
    fixture.componentInstance.newProject();
    expect(h.newProject).toHaveBeenCalledWith('github', '/');
    h.auth.next({ status: 'authenticated', user: { uid: 'actor' } });
    expect(h.complete).toHaveBeenCalledTimes(1);
  });
  it('does not reuse a missing return or show raw provider failures', async () => {
    const h = harness();
    const fixture = TestBed.createComponent(GithubAuthorizationPageComponent);
    fixture.detectChanges();
    h.auth.next({ status: 'authenticated', user: { uid: 'actor' } });
    expect(h.complete).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'missing or has already been used',
    );
  });
  it('returns Business checkout context to project creation for the same Business-only actor', async () => {
    const h = harness('business-only-actor', true);
    const navigate = vi.spyOn(h.router, 'navigate').mockResolvedValue(true);
    expect(
      saveBusinessGithubContinuation('business-only-actor', 'space-a'),
    ).toBe(true);
    window.__datatugTakeGitHubAuthorization = () => ({
      code: 'code-fixture',
      state: 'state-fixture',
    });
    const fixture = TestBed.createComponent(GithubAuthorizationPageComponent);
    fixture.detectChanges();
    h.auth.next({
      status: 'authenticated',
      user: { uid: 'business-only-actor' },
    });
    h.result.next({ connected: true });
    await fixture.whenStable();

    fixture.componentInstance.newProject();
    expect(navigate).toHaveBeenCalledWith(['/new-project'], {
      queryParams: {
        store: 'github',
        billingIntent: 'space_business',
        spaceID: 'space-a',
        returnUrl: '/',
      },
    });
    expect(
      sessionStorage.getItem(
        'datatug:new-project:github-business-continuation',
      ),
    ).toBeNull();
  });
  it('cancels an old-actor return on a session change and never claims it is connected for the new actor', async () => {
    const h = harness();
    window.__datatugTakeGitHubAuthorization = () => ({
      code: 'code-fixture',
      state: 'state-fixture',
    });
    const fixture = TestBed.createComponent(GithubAuthorizationPageComponent);
    fixture.detectChanges();
    h.auth.next({ status: 'authenticated', user: { uid: 'actor' } });
    h.auth.next({ status: 'authenticated', user: { uid: 'different' } });
    h.result.next({ connected: true });
    await fixture.whenStable();
    expect(fixture.componentInstance.connected()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('sign-in changed');
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
