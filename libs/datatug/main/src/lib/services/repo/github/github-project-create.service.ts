import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { SneatApiService } from '@sneat/api';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { Observable, forkJoin, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { DatatugStoreGithubService } from '../datatug-store.service.github';
import {
  GITHUB_API_BASE,
  IGithubRepoWire,
  githubApiHeaders,
  toGithubRepo,
} from './github-api';
import {
  GithubProjectReaderService,
  IGithubProjectId,
} from './github-project-reader.service';

/**
 * DataTug cloud endpoint that records a GitHub-hosted project in the user's
 * DataTug index. The path is relative to an API base URL that already ends in
 * `/v0/` (see `ProjectService.createNewProject` for the same rule).
 */
export const REGISTER_GITHUB_PROJECT_ENDPOINT =
  'datatug/projects/register_github_project';

/**
 * Folder a project is created in when the user does not name one — the same
 * default `parseGithubProjectId()` applies when reading a project back.
 */
export const DEFAULT_GITHUB_PROJECT_FOLDER = 'datatug';

/** Content of the `README.md` the CLI's `dtprojcreator` writes too. */
export const GITHUB_PROJECT_README = `# DataTug Project

This directory contains DataTug project configuration.`;

/** Human-readable name of the file the reader fetches (`buildGithubRawUrl`). */
export const GITHUB_PROJECT_FILE_NAME = 'datatug-project.json';

/** Request to create a project in a GitHub repository. */
export interface ICreateGithubProjectRequest {
  /** Repository owner (a user or an organisation). */
  readonly org: string;
  /** Repository name. */
  readonly repo: string;
  /** Repo-relative folder for the project; defaults to `datatug`. */
  readonly folder?: string;
  readonly title: string;
}

/** `owner/repo` as typed by the user, or `undefined` when malformed. */
export function parseGithubRepo(
  value: string,
): { org: string; repo: string } | undefined {
  const parts = value
    .trim()
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return undefined;
  }
  return { org: parts[0], repo: parts[1] };
}

/** UTF-8 safe base64, which is what the GitHub contents API expects. */
function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Creates DataTug projects in a GitHub repository, client-side, with a token
 * the user supplies through {@link PrivateTokenStoreService} — the app never
 * sees the user's GitHub password, and nothing is stored server-side.
 *
 * The files written match what the CLI's `dtprojcreator` produces and what
 * this app's own GitHub reader expects:
 *
 * - `<folder>/datatug-project.json` — the project file (valid JSON: the reader
 *   parses it with `JSON.parse`).
 * - `<folder>/README.md` — the project's own readme.
 */
@Injectable({ providedIn: 'root' })
export class GithubProjectCreateService {
  private readonly http = inject(HttpClient);
  private readonly sneatApiService = inject(SneatApiService);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly githubReader = inject(GithubProjectReaderService);
  private readonly githubStore = inject(DatatugStoreGithubService);

  /**
   * Creates the project files in `request`'s repository (on its default
   * branch, which is what the app's reader reads), makes the reader and the
   * project summaries forget what this browser knew of the repository (so the
   * project opens at once, instead of "No DataTug project here"), registers
   * the project in the user's DataTug index, and resolves with the project ref
   * the app navigates to (`repo@org@folder`).
   *
   * `token` is the GitHub access token the caller obtained through
   * `GithubOAuthService` — repository access is the user's own, and the token
   * never reaches our servers.
   */
  public createProject(
    request: ICreateGithubProjectRequest,
    token: string,
  ): Observable<IGithubProjectId> {
    const folder = (request.folder || DEFAULT_GITHUB_PROJECT_FOLDER)
      .trim()
      .replace(/^\/+|\/+$/g, '');
    const project: IGithubProjectId = {
      repo: request.repo,
      org: request.org,
      folder,
    };
    const message = `Create DataTug project "${request.title}"`;
    return this.defaultBranch(token, request.org, request.repo).pipe(
      switchMap((branch) =>
        forkJoin([
          this.putFile(
            token,
            request.org,
            request.repo,
            branch,
            `${folder}/README.md`,
            GITHUB_PROJECT_README,
            message,
          ),
          this.putFile(
            token,
            request.org,
            request.repo,
            branch,
            `${folder}/${GITHUB_PROJECT_FILE_NAME}`,
            this.projectFile(request.title),
            message,
          ),
        ]),
      ),
      // The repository has a new commit: whatever this browser remembered of it (the commit, "no project here" for
      // this very address) is out of date. Forgotten before anything else is read or the app navigates.
      switchMap(() =>
        from(this.githubReader.forget(request.org, request.repo)),
      ),
      map(() => this.githubStore.forget(request.org, request.repo)),
      // Registering the project only makes it appear in the user's project
      // list: the files are already committed, so a failure here must not fail
      // the creation — the project is still usable right away.
      switchMap(() =>
        this.registerProject(project, request).pipe(
          catchError((err: unknown) => {
            this.errorLogger.logError(
              err,
              'Failed to register the new GitHub project in the user index',
            );
            return of(undefined);
          }),
        ),
      ),
      map(() => project),
    );
  }

  /**
   * The branch the reader reads (`HEAD`): the repository's default branch, whatever it is called. Committing to a
   * branch named `main` would not be seen by the reader in a repository whose default branch is `master` or `trunk`.
   */
  private defaultBranch(
    token: string,
    org: string,
    repo: string,
  ): Observable<string> {
    return this.http
      .get<IGithubRepoWire>(`${GITHUB_API_BASE}/repos/${org}/${repo}`, {
        headers: githubApiHeaders(token),
      })
      .pipe(
        map((wire) => {
          const found = toGithubRepo(wire);
          if (!found) {
            throw new Error(
              `GitHub did not return the repository ${org}/${repo}`,
            );
          }
          return found.defaultBranch;
        }),
      );
  }

  /** Records the project in the user's DataTug index (cloud side). */
  private registerProject(
    project: IGithubProjectId,
    request: ICreateGithubProjectRequest,
  ): Observable<unknown> {
    return this.sneatApiService.post(REGISTER_GITHUB_PROJECT_ENDPOINT, {
      org: project.org,
      repo: project.repo,
      folder: project.folder,
      title: request.title,
    });
  }

  /**
   * The project file content. Kept JSON (not YAML) because
   * `DatatugStoreGithubService.getProjectSummary()` reads it through the
   * GitHub reader, which parses JSON.
   */
  private projectFile(title: string): string {
    return JSON.stringify(
      {
        title,
        access: 'private',
        created: { at: new Date().toISOString() },
      },
      null,
      2,
    );
  }

  /**
   * Creates or updates one file on `branch` through the GitHub contents API. GitHub
   * requires the current blob's `sha` to update an existing file, so the file
   * is looked up first (a 404 means "create").
   */
  private putFile(
    token: string,
    org: string,
    repo: string,
    branch: string,
    path: string,
    content: string,
    message: string,
  ): Observable<void> {
    const url = `${GITHUB_API_BASE}/repos/${org}/${repo}/contents/${path}`;
    const headers = githubApiHeaders(token);
    return this.http
      .get<{ sha?: string }>(url, {
        headers,
        params: { ref: branch },
      })
      .pipe(
        catchError((err: unknown) => {
          if (err instanceof HttpErrorResponse && err.status === 404) {
            return of({} as { sha?: string });
          }
          return throwError(() => err);
        }),
        switchMap((existing) => {
          const body: Record<string, string> = {
            message,
            content: toBase64(content),
            branch,
          };
          if (existing?.sha) {
            body['sha'] = existing.sha;
          }
          return this.http.put<void>(url, body, { headers });
        }),
        map(() => undefined),
      );
  }
}
