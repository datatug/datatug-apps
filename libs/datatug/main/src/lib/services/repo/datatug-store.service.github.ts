import { IFolder, IFolderItem } from '../../models/definition/folder';
import { IProjectSummary } from '../../models/definition/project';
import { IDatatugStoreService } from './datatug-store.service.interface';
import { Observable, defer, of, throwError } from 'rxjs';
import { map, shareReplay, switchMap } from 'rxjs/operators';
import { Injectable, inject } from '@angular/core';
import {
  assertReadableGithubProjectId,
  buildGithubRawUrl,
  parseGithubProjectId,
  GithubProjectNotFoundError,
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
  private readonly githubReader = inject(GithubProjectReaderService);

  // Cached per projectId (shareReplay(1)) — `watchRootFolder()` below also
  // reads the project summary (for its `boards` list), so without this a
  // page that renders both the project summary AND the folder tabs (the
  // project page itself) would fetch `datatug-project.json` twice.
  private readonly summaryCache = new Map<
    string,
    Observable<IProjectSummary>
  >();

  /**
   * Drops the summaries of every project of a repository, so the next one is read again: a project was just created
   * in it (`GithubProjectCreateService`), and what was kept for the address, "no project here" included, is out of
   * date. The reader forgets the repository's commit separately (`GithubProjectReaderService.forget`).
   */
  forget(org: string, repo: string): void {
    const wanted = `${org}/${repo}`.toLowerCase();
    for (const projectId of [...this.summaryCache.keys()]) {
      const id = parseGithubProjectId(projectId);
      if (`${id.org}/${id.repo}` === wanted) {
        this.summaryCache.delete(projectId);
      }
    }
  }

  getProjectSummary(projectId: string): Observable<IProjectSummary> {
    let cached = this.summaryCache.get(projectId);
    if (cached) {
      return cached;
    }
    try {
      assertReadableGithubProjectId(projectId);
    } catch (err) {
      return throwError(() => err);
    }

    // Through the reader: the same commit as the listing and every other file, one cache, one request (the old
    // second, separate read of this file could come from a different commit than the rest of the page).
    // `defer`: `shareReplay` drops a failed read and the next subscriber reads again, instead of getting the same
    // failure back until the page is reloaded.
    cached = defer(() =>
      this.githubReader.getRawJson<IProjectSummary>(
        projectId,
        'datatug-project.json',
      ),
    ).pipe(
      switchMap((p) =>
        p
          ? of(p)
          : this.githubReader
              .readInfo(projectId)
              .pipe(
                switchMap((info) =>
                  throwError(
                    () =>
                      new GithubProjectNotFoundError(
                        projectId,
                        info.state === 'moved' ? 'moved' : 'missing',
                      ),
                  ),
                ),
              ),
      ),
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
