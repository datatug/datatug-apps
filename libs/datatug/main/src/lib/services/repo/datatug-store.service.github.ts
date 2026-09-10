import { IFolder, IFolderItem } from '../../models/definition/folder';
import { IProjectSummary } from '../../models/definition/project';
import { IDatatugStoreService } from './datatug-store.service.interface';
import { Observable, of } from 'rxjs';
import { map, mergeMap, shareReplay } from 'rxjs/operators';
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  buildGithubRawUrl,
  GithubProjectReaderService,
} from './github/github-project-reader.service';

/**
 * Builds the raw-content URL for a GitHub-store project's
 * `datatug-project.json`. Thin wrapper over {@link buildGithubRawUrl} (the
 * one place `projectId`'s `"repo@org[@folder]"` format is parsed — see that
 * function's own doc comment) — kept as its own named export since
 * `datatug-store.service.github.spec.ts` already asserts against it by name.
 */
export function buildGithubProjectSummaryUrl(projectId: string): string {
  return buildGithubRawUrl(projectId, 'datatug-project.json');
}

// `providedIn: 'root'` — needed so `DatatugStoreServiceFactory` (also
// root-provided) can resolve this dependency regardless of which route
// requested it.
@Injectable({ providedIn: 'root' })
export class DatatugStoreGithubService implements IDatatugStoreService {
  private readonly http = inject(HttpClient);
  private readonly githubReader = inject(GithubProjectReaderService);

  // Cached per projectId (shareReplay(1)) — `watchRootFolder()` below also
  // reads the project summary (for its `boards` list), so without this a
  // page that renders both the project summary AND the folder tabs (the
  // project page itself) would fetch `datatug-project.json` twice.
  private readonly summaryCache = new Map<string, Observable<IProjectSummary>>();

  getProjectSummary(projectId: string): Observable<IProjectSummary> {
    let cached = this.summaryCache.get(projectId);
    if (cached) {
      return cached;
    }
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
    cached = connectTo.pipe(
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
      shareReplay(1),
    );
    this.summaryCache.set(projectId, cached);
    return cached;
  }

  /**
   * Only the root folder (`path === "/folders/~"`, the one
   * `DatatugFoldersService.watchFolder`/`DatatugFolderComponent` and
   * `BoardsPageComponent` ever ask for — see their own call sites) is
   * implemented: it drives the project page's Boards/Queries/Environments/
   * Entities tab counts and the Boards list page. Any other folder id
   * resolves to `null`, the SAME "absent" value
   * `DatatugStoreAgentService.watchProjectItem` already returns for every
   * path (its own doc comment: the CLI agent has no generic folder-read
   * route either) — never a thrown error, so an unimplemented folder still
   * lets its page settle on an empty list instead of crashing.
   */
  watchProjectItem<T>(
    projectId: string,
    path?: string,
  ): Observable<T | null | undefined> {
    if (path === '/folders/~') {
      return this.watchRootFolder(projectId) as unknown as Observable<
        T | null | undefined
      >;
    }
    return of(null);
  }

  private watchRootFolder(projectId: string): Observable<IFolder> {
    return this.getProjectSummary(projectId).pipe(
      map((summary) => {
        const boards: Record<string, IFolderItem> = {};
        for (const b of summary.boards || []) {
          boards[b.id] = { name: b.title || b.id };
        }
        return {
          id: '~',
          boards,
          // `numberOf` deliberately left unset: `DatatugFolderComponent.
          // numberOf()` (folders/ui/datatug-folder.component.ts) recurses
          // into itself whenever `folder.numberOf` is truthy (a
          // pre-existing bug, fixed separately in this same change) — never
          // populate it from here regardless, in case that fix is ever
          // reverted independently.
        } as IFolder;
      }),
    );
  }
}
