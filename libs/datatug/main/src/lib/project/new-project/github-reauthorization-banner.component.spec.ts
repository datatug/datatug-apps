import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { IProjectRef } from '../../core/project-context';
import { readProjectApiQuery } from '../../nav/project-api-routing';
import { GithubConnectionService } from '../../services/repo/github/github-connection.service';
import { ProjectQueryApiService } from '../../services/project/project-query-api.service';
import {
  GITHUB_RECONNECT_SESSION_KEY,
  GitHubReauthorizationBannerComponent,
  readPendingGithubReconnect,
  safeGitHubReconnectReturnUrl,
} from './github-reauthorization-banner.component';
import { sha256Hex } from './sha256-hex';

describe('GitHub reauthorization handoff', () => {
  afterEach(() => sessionStorage.removeItem(GITHUB_RECONNECT_SESSION_KEY));

  it('keeps the same internal project route and selected branch, while removing other query state', () => {
    expect(
      safeGitHubReconnectReturnUrl('/projects/repo?branch=work&code=secret&state=secret'),
    ).toBe('/projects/repo?branch=work');
    const returnUrl = safeGitHubReconnectReturnUrl('/projects/repo?projectApi=cloud&branch=work&code=secret&state=secret');
    expect(returnUrl).toBe('/projects/repo?projectApi=cloud&branch=work');
    expect(readProjectApiQuery(new URL(returnUrl, 'https://datatug.local').searchParams)).toEqual({
      projectApi: 'cloud',
      branch: 'work',
    });
    expect(safeGitHubReconnectReturnUrl('/projects/repo?projectApi=local&branch=work')).toBe('/');
  });

  it('rejects external and callback routes while accepting only the explicit GitHub setup return route', () => {
    expect(safeGitHubReconnectReturnUrl('//attacker.example/path')).toBe('/');
    expect(safeGitHubReconnectReturnUrl('https://attacker.example/path')).toBe('/');
    expect(safeGitHubReconnectReturnUrl('/github/callback?code=secret')).toBe('/');
    expect(safeGitHubReconnectReturnUrl('/new-project?store=github')).toBe('/new-project?store=github');
    expect(safeGitHubReconnectReturnUrl('/new-project?store=github&returnUrl=https://evil.example')).toBe('/');
  });

  it('accepts only the stored OAuth state hash and a valid operation envelope', async () => {
    sessionStorage.setItem(
      GITHUB_RECONNECT_SESSION_KEY,
      JSON.stringify({
        operationID: '11111111-1111-4111-8111-111111111111',
        firebaseUID: 'firebase-actor',
        oauthStateHash: await sha256Hex('state-expected'),
        returnUrl: '/projects/repo?branch=work',
        requiredScopes: ['repo'],
      }),
    );
    expect(readPendingGithubReconnect(await sha256Hex('different-state'))).toBeUndefined();
    expect(readPendingGithubReconnect(undefined)).toBeUndefined();
    expect(readPendingGithubReconnect('state-expected')).toBeUndefined();
    expect(readPendingGithubReconnect(await sha256Hex('state-expected'))).toMatchObject({
      firebaseUID: 'firebase-actor',
      returnUrl: '/projects/repo?branch=work',
      requiredScopes: ['repo'],
    });
  });

  it('offers reconnect for the matching private project and stores a state-bound internal return before redirecting', async () => {
    TestBed.resetTestingModule();
    const ref: IProjectRef = {
      storeId: 'github.com',
      projectId: 'repo@owner@folder',
      projectApi: 'cloud',
      branch: 'work',
    };
    const authorizationURL = 'https://github.com/login/oauth/authorize?client_id=client&state=expected-state';
    const reauthorizationRequired = new Subject<{ ref: IProjectRef; requiredScopes: readonly ('repo' | 'workflow')[] }>();
    const authState = new BehaviorSubject({
      status: 'authenticated',
      user: { uid: 'firebase-actor' },
    });
    const startOAuth = vi.fn(() => of({ authorizationURL }));
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [GitHubReauthorizationBannerComponent],
      providers: [
        { provide: ProjectQueryApiService, useValue: { githubReauthorizationRequired: reauthorizationRequired } },
        { provide: GithubConnectionService, useValue: { startOAuth } },
        { provide: SneatAuthStateService, useValue: { authState } },
        { provide: Router, useValue: { url: '/projects/repo?branch=work&code=stale' } },
      ],
    });
    const fixture = TestBed.createComponent(GitHubReauthorizationBannerComponent);
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('returnUrl', '/new-project?store=github');
    fixture.detectChanges();
    reauthorizationRequired.next({ ref, requiredScopes: ['repo', 'workflow'] });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Reconnect GitHub');

    fixture.componentInstance.reconnect();

    expect(startOAuth).toHaveBeenCalledWith({
      operationID: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      owner: 'owner',
      repository: 'repo',
      requiredScopes: ['repo', 'workflow'],
    });
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith(authorizationURL));
    const stored = sessionStorage.getItem(GITHUB_RECONNECT_SESSION_KEY) ?? 'null';
    expect(stored).not.toContain('expected-state');
    expect(JSON.parse(stored)).toMatchObject({
      firebaseUID: 'firebase-actor',
      oauthStateHash: await sha256Hex('expected-state'),
      returnUrl: '/new-project?store=github',
      requiredScopes: ['repo', 'workflow'],
    });
    assign.mockRestore();
  });
});

describe('GitHub access banner states', () => {
  const ref: IProjectRef = {
    storeId: 'github.com',
    projectId: 'repo@owner@folder',
  };
  const hintKey = `datatug:github:connect-hint-dismissed:${ref.storeId}/${ref.projectId}`;
  afterEach(() => sessionStorage.removeItem(hintKey));

  function create(publicRepository = false) {
    TestBed.resetTestingModule();
    const required = new Subject<{
      ref: IProjectRef;
      requiredScopes: readonly ('repo' | 'workflow')[];
      reason: 'expired' | 'not_connected' | 'access_denied';
    }>();
    TestBed.configureTestingModule({
      imports: [GitHubReauthorizationBannerComponent],
      providers: [
        { provide: ProjectQueryApiService, useValue: { githubReauthorizationRequired: required } },
        { provide: GithubConnectionService, useValue: { startOAuth: vi.fn() } },
        { provide: SneatAuthStateService, useValue: { authState: of({ status: 'notAuthenticated' }) } },
        { provide: Router, useValue: { url: '/project/github.com/owner/repo' } },
      ],
    });
    const fixture = TestBed.createComponent(GitHubReauthorizationBannerComponent);
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('publicRepository', publicRepository);
    fixture.detectChanges();
    const raise = (reason: 'expired' | 'not_connected' | 'access_denied') => {
      required.next({ ref, requiredScopes: ['repo'], reason });
      fixture.detectChanges();
    };
    return { fixture, raise, el: fixture.nativeElement as HTMLElement };
  }

  it('keeps the warning card only for an expired grant', () => {
    const { el, raise } = create();
    raise('expired');
    const card = el.querySelector('[data-testid="github-reauthorization"]');
    expect(card?.querySelector('ion-item-divider')?.getAttribute('color')).toBe('warning');
    expect(card?.innerHTML).toContain('GitHub access expired.');
    expect(card?.innerHTML).toContain('Reconnect GitHub');
    expect(el.querySelector('[data-testid="github-connect"]')).toBeNull();
  });

  it('asks a private repository to connect GitHub in a neutral card, without claiming expiry', () => {
    const { el, raise } = create(false);
    raise('not_connected');
    const card = el.querySelector('[data-testid="github-connect"]');
    expect(card?.querySelector('ion-item-divider')?.getAttribute('color')).toBe('light');
    expect(card?.innerHTML).toContain('Connect GitHub');
    expect(card?.innerHTML).toContain('This repository needs GitHub access.');
    expect(card?.innerHTML).not.toContain('expired');
    expect(card?.querySelector('[aria-label="Dismiss"]')).toBeNull();
  });

  it('shows a public repository a dismissible hint and remembers the dismissal for the session', () => {
    const first = create(true);
    first.raise('not_connected');
    const card = first.el.querySelector('[data-testid="github-connect"]');
    expect(card?.innerHTML).toContain('Connect GitHub to edit this project or open private repositories.');
    (card?.querySelector('[aria-label="Dismiss"]') as HTMLElement).click();
    first.fixture.detectChanges();
    expect(first.el.querySelector('[data-testid="github-connect"]')).toBeNull();
    expect(sessionStorage.getItem(hintKey)).toBe('1');

    const again = create(true);
    again.raise('not_connected');
    expect(again.el.querySelector('[data-testid="github-connect"]')).toBeNull();
  });

  it('keeps the hint dismissal working when session storage throws', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const { el, fixture, raise } = create(true);
      raise('not_connected');
      (el.querySelector('[aria-label="Dismiss"]') as HTMLElement).click();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="github-connect"]')).toBeNull();
    } finally {
      setItem.mockRestore();
    }
  });

  it('words a bare refusal as access needed, not expired', () => {
    const { el, raise } = create(true);
    raise('access_denied');
    const card = el.querySelector('[data-testid="github-connect"]');
    expect(card?.getAttribute('data-reason')).toBe('access_denied');
    expect(card?.innerHTML).toContain('GitHub access needed');
    expect(card?.innerHTML).not.toContain('expired');
    // Only a missing connection on a public repository is a dismissible hint.
    expect(card?.querySelector('[aria-label="Dismiss"]')).toBeNull();
  });
});
