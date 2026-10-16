import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { IProjectRef } from '../../core/project-context';
import { GithubConnectionService } from '../../services/repo/github/github-connection.service';
import { ProjectQueryApiService } from '../../services/project/project-query-api.service';
import {
  GITHUB_RECONNECT_SESSION_KEY,
  GitHubReauthorizationBannerComponent,
  readPendingGithubReconnect,
  safeGitHubReconnectReturnUrl,
} from './github-reauthorization-banner.component';

describe('GitHub reauthorization handoff', () => {
  afterEach(() => sessionStorage.removeItem(GITHUB_RECONNECT_SESSION_KEY));

  it('keeps the same internal project route and selected branch, while removing other query state', () => {
    expect(
      safeGitHubReconnectReturnUrl('/projects/repo?branch=work&code=secret&state=secret'),
    ).toBe('/projects/repo?branch=work');
  });

  it('rejects external, callback, and new-project return routes', () => {
    expect(safeGitHubReconnectReturnUrl('//attacker.example/path')).toBe('/');
    expect(safeGitHubReconnectReturnUrl('https://attacker.example/path')).toBe('/');
    expect(safeGitHubReconnectReturnUrl('/github/callback?code=secret')).toBe('/');
    expect(safeGitHubReconnectReturnUrl('/new-project?store=github')).toBe('/');
  });

  it('accepts only the stored OAuth state and a valid operation envelope', () => {
    sessionStorage.setItem(
      GITHUB_RECONNECT_SESSION_KEY,
      JSON.stringify({
        operationID: '11111111-1111-4111-8111-111111111111',
        firebaseUID: 'firebase-actor',
        oauthState: 'state-expected',
        returnUrl: '/projects/repo?branch=work',
      }),
    );
    expect(readPendingGithubReconnect('different-state')).toBeUndefined();
    expect(readPendingGithubReconnect('state-expected')).toMatchObject({
      firebaseUID: 'firebase-actor',
      returnUrl: '/projects/repo?branch=work',
    });
  });

  it('offers reconnect for the matching private project and stores a state-bound internal return before redirecting', () => {
    TestBed.resetTestingModule();
    const ref: IProjectRef = {
      storeId: 'github.com',
      projectId: 'repo@owner@folder',
      projectApi: 'cloud',
      branch: 'work',
    };
    const authorizationURL = 'https://github.com/login/oauth/authorize?client_id=client&state=expected-state';
    const reauthorizationRequired = new Subject<IProjectRef>();
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
    fixture.detectChanges();
    reauthorizationRequired.next(ref);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Reconnect GitHub');

    fixture.componentInstance.reconnect();

    expect(startOAuth).toHaveBeenCalledWith({
      operationID: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      owner: 'owner',
      repository: 'repo',
      requiredScopes: ['repo'],
    });
    expect(assign).toHaveBeenCalledWith(authorizationURL);
    expect(JSON.parse(sessionStorage.getItem(GITHUB_RECONNECT_SESSION_KEY) ?? 'null')).toMatchObject({
      firebaseUID: 'firebase-actor',
      oauthState: 'expected-state',
      returnUrl: '/projects/repo?branch=work',
    });
    assign.mockRestore();
  });
});
