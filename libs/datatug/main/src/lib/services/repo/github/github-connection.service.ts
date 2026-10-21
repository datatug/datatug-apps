import { Injectable, inject } from '@angular/core';
import { DatatugApiService } from '../../base/datatug-api.service';

export interface ConnectedGithubRepository {
  readonly id: number;
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly permission: 'read' | 'write';
}

export type GithubOAuthRepository = ConnectedGithubRepository;

export interface GitHubOAuthStartRequest {
  readonly operationID: string;
  readonly owner: string;
  readonly repository: string;
  readonly requiredScopes?: readonly ('repo' | 'workflow')[];
}

export interface GitHubOAuthCompleteResult {
  readonly connected: true;
  readonly actorID: number | string;
  readonly login: string;
  readonly scopes: readonly string[];
}

/** GitHub App credentials remain server-side. Every operation uses the Firebase auth bridge. */
@Injectable({ providedIn: 'root' })
export class GithubConnectionService {
  private readonly api = inject(DatatugApiService);
  start() {
    return this.api.post<{ authorizationURL: string }>(
      'datatug/github/authorization/start',
      {},
    );
  }
  complete(code: string, state: string) {
    return this.api.post<{ connected: true }>(
      'datatug/github/authorization/complete',
      { code, state },
    );
  }
  appRepositories() {
    return this.api.get<{ repositories: readonly ConnectedGithubRepository[] }>(
      'datatug/github/repositories',
    );
  }

  oauthRepositories() {
    return this.api.get<{ repositories: readonly GithubOAuthRepository[] }>(
      'datatug/github/oauth/repositories',
    );
  }

  startOAuth(request: GitHubOAuthStartRequest) {
    return this.api.post<{ authorizationURL: string }>(
      'datatug/github/oauth/start',
      request,
    );
  }

  completeOAuth(operationID: string, code: string, state: string) {
    return this.api.post<GitHubOAuthCompleteResult>(
      'datatug/github/oauth/complete',
      { operationID, code, state },
    );
  }

  resolveOAuthRepository(owner: string, repository: string) {
    return this.api.post<GithubOAuthRepository>(
      'datatug/github/oauth/resolve-repository',
      { owner, repository },
    );
  }
}
