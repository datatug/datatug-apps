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
import { digestOAuthState } from './oauth-state-digest';

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

  it('accepts only the stored OAuth state digest and a valid operation envelope', async () => {
    sessionStorage.setItem(
      GITHUB_RECONNECT_SESSION_KEY,
      JSON.stringify({
        operationID: '11111111-1111-4111-8111-111111111111',
        firebaseUID: 'firebase-actor',
        oauthStateDigest: await digestOAuthState('state-expected'),
        returnUrl: '/projects/repo?branch=work',
        requiredScopes: ['repo'],
      }),
    );
    expect(readPendingGithubReconnect(await digestOAuthState('different-state'))).toBeUndefined();
    expect(readPendingGithubReconnect(undefined)).toBeUndefined();
    expect(readPendingGithubReconnect('state-expected')).toBeUndefined();
    expect(readPendingGithubReconnect(await digestOAuthState('state-expected'))).toMatchObject({
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
      oauthStateDigest: await digestOAuthState('expected-state'),
      returnUrl: '/new-project?store=github',
      requiredScopes: ['repo', 'workflow'],
    });
    assign.mockRestore();
  });
});
