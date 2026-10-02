import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GithubRepoError } from './github-api';
import { GithubReposService } from './github-repos.service';

describe('GithubReposService', () => {
  let service: GithubReposService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(GithubReposService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the repositories the user can push to, leaving out one that has no default branch to commit to', () => {
    let repos: unknown;
    service.listRepos('tok').subscribe((r) => (repos = r));
    http
      .expectOne((r) => r.url === 'https://api.github.com/user/repos')
      .flush([
        { full_name: 'datatug/a', private: false, default_branch: 'main' },
        { full_name: 'datatug/b', private: true },
        { private: false, default_branch: 'main' },
      ]);
    expect(repos).toEqual([
      { fullName: 'datatug/a', private: false, defaultBranch: 'main' },
    ]);
  });

  it('creates a repository and returns it with the default branch GitHub named', () => {
    let created: unknown;
    service.createRepo('tok', 'mine', true).subscribe((r) => (created = r));
    const req = http.expectOne(
      (r) =>
        r.method === 'POST' && r.url === 'https://api.github.com/user/repos',
    );
    expect(req.request.body).toEqual({
      name: 'mine',
      private: true,
      auto_init: true,
    });
    req.flush({ full_name: 'me/mine', private: true, default_branch: 'trunk' });
    expect(created).toEqual({
      fullName: 'me/mine',
      private: true,
      defaultBranch: 'trunk',
    });
  });

  it.each([
    [
      { full_name: 'me/mine', private: true },
      'GitHub created mine, but did not return the default branch of mine, so DataTug cannot tell which branch to commit to.',
    ],
    [
      { default_branch: 'main' },
      'GitHub created mine, but did not return its full name',
    ],
  ])(
    'an incomplete answer for the repository just made is an error that says so: %j',
    (wire, message) => {
      let error: unknown;
      service
        .createRepo('tok', 'mine', true)
        .subscribe({ error: (e) => (error = e) });
      http.expectOne((r) => r.method === 'POST').flush(wire);
      expect(error).toBeInstanceOf(GithubRepoError);
      expect((error as Error).message).toBe(message);
    },
  );
});
