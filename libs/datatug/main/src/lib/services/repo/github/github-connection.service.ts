import { Injectable, inject } from '@angular/core';
import { SneatApiService } from '@sneat/api';

export interface ConnectedGithubRepository {
  readonly id: number;
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly permission: 'read' | 'write';
}

/** GitHub App credentials remain server-side. Every operation uses the Firebase auth bridge. */
@Injectable({ providedIn: 'root' })
export class GithubConnectionService {
  private readonly api = inject(SneatApiService);
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
  repositories() {
    return this.api.get<{ repositories: readonly ConnectedGithubRepository[] }>(
      'datatug/github/repositories',
    );
  }
}
