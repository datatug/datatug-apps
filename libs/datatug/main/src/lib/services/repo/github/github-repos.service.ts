import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  GITHUB_API_BASE,
  githubApiHeaders,
  IGithubRepo,
  IGithubRepoWire,
  toGithubRepo,
} from './github-api';

/** How many repositories the picker loads (GitHub's maximum page size). */
export const GITHUB_REPOS_PAGE_SIZE = 100;

/**
 * The user's own GitHub repositories, for the new-project dialog.
 *
 * Every call carries the token obtained through {@link GithubOAuthService};
 * nothing is cached here, so the picker always shows the current state.
 */
@Injectable({ providedIn: 'root' })
export class GithubReposService {
  private readonly http = inject(HttpClient);

  /** Repositories the user can push to, most recently updated first. */
  public listRepos(token: string): Observable<IGithubRepo[]> {
    return this.http
      .get<IGithubRepoWire[]>(`${GITHUB_API_BASE}/user/repos`, {
        headers: githubApiHeaders(token),
        params: {
          per_page: `${GITHUB_REPOS_PAGE_SIZE}`,
          sort: 'updated',
          // Everything the user could commit to — not just what they own.
          affiliation: 'owner,collaborator,organization_member',
        },
      })
      .pipe(
        map((repos) =>
          repos
            .map(toGithubRepo)
            .filter((repo): repo is IGithubRepo => !!repo),
        ),
      );
  }

  /**
   * Creates a repository for the user. `autoInit` gives it an initial commit,
   * so the project files can be committed immediately.
   */
  public createRepo(
    token: string,
    name: string,
    isPrivate: boolean,
  ): Observable<IGithubRepo> {
    return this.http
      .post<IGithubRepoWire>(
        `${GITHUB_API_BASE}/user/repos`,
        { name, private: isPrivate, auto_init: true },
        { headers: githubApiHeaders(token) },
      )
      .pipe(
        map((repo) => {
          const created = toGithubRepo(repo);
          if (!created) {
            throw new Error(
              `GitHub created ${name} but did not return its full name`,
            );
          }
          return created;
        }),
      );
  }
}
