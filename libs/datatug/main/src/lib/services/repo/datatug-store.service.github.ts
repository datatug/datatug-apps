import { IProjectSummary } from '../../models/definition/project';
import { IDatatugStoreService } from './datatug-store.service.interface';
import { Observable, of, throwError } from 'rxjs';
import { map, mergeMap } from 'rxjs/operators';
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

/**
 * Builds the raw-content URL for a GitHub-store project's
 * `datatug-project.json`.
 *
 * `projectId` format: `"repo@org"` or `"repo@org@folder"` — `folder` is the
 * repo-relative directory the project's `datatug-project.json` lives in.
 * Defaults to `"datatug"` to preserve the historical convention; the demo
 * project (`spec/research/2026-09-09-web-ui-audit.md`) needed an explicit
 * `"demo-project-1"` folder instead. `entity.service.ts`'s
 * `getEntityFromGithub()` also splits this same id on `"@"` but only
 * destructures the first two parts, so an extra folder segment here is
 * silently ignored there — safe to add without touching that file.
 */
export function buildGithubProjectSummaryUrl(projectId: string): string {
  const [repo, org, folder = 'datatug'] = projectId.split('@');
  return `https://raw.githubusercontent.com/${org}/${repo}/main/${folder}/datatug-project.json`;
}

// `providedIn: 'root'` — needed so `DatatugStoreServiceFactory` (also
// root-provided) can resolve this dependency regardless of which route
// requested it.
@Injectable({ providedIn: 'root' })
export class DatatugStoreGithubService implements IDatatugStoreService {
  private readonly http = inject(HttpClient);

  getProjectSummary(projectId: string): Observable<IProjectSummary> {
    interface urlAndHeaders {
      url: string;
      headers?: Record<string, string>;
    }

    const url = buildGithubProjectSummaryUrl(projectId);

    const connectTo: Observable<urlAndHeaders> = of({ url });
    // if (storeId.startsWith(GITLAB_REPO_PREFIX)) {
    // 	//url = 'https://gitlab.COMPANY.com/A_Trakhimenok/dsa-datatug/-/raw/master/datatug/datatug-project.json';
    // 	connectTo = this.privateTokenStoreService.getPrivateToken(storeId, projectId).pipe(map(accessToken => (
    // 		{
    // 			url: `https://gitlab.COMPANY.com/api/v4/projects/${projectId}/repository/files/datatug%2Fdatatug-project.json/raw?ref=master`,
    // 			headers: {"PRIVATE-TOKEN": accessToken}
    // 		})));
    // }
    return connectTo.pipe(
      mergeMap((request) =>
        this.http
          .get<IProjectSummary>(request.url, { headers: request.headers })
          .pipe(
            map((p) => {
              if (p.id === projectId) {
                return p;
              }
              if (p.id) {
                console.warn(
                  `Request project info with projectId=${projectId} but response JSON have id=${p.id}`,
                );
              }
              return { ...p, id: projectId };
            }),
          ),
      ),
    );
  }

  watchProjectItem<T>(projectId: string, path?: string): Observable<T | null> {
    return throwError(() => `not implemented ${projectId} ${path}`);
  }
}
