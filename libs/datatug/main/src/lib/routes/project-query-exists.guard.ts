import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { catchError, firstValueFrom, of } from 'rxjs';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { readShortGithubAddress } from './github-project-address-check';

/** Query-string flags of an editor that holds a query the project does not (yet) have saved. */
const DRAFT_PARAMS = ['result', 'demoDraft', 'draft', 'projectApi', 'runtime'];

/**
 * `canMatch` of the "this query does not exist" route, which sits in front of the query page. True only when a
 * public GitHub project is opened at a saved-query address (cold, with no in-app state such as `action: 'create'`)
 * and its file tree has no such query. Every doubt (another store, a draft, an in-app navigation, a tree that
 * could not be read, a rate limit) is false, so the query page opens as before.
 */
export const savedQueryIsMissing: CanMatchFn = async (_route, segments) => {
  const router = inject(Router);
  const navigation = router.getCurrentNavigation();
  const typed = navigation?.extractedUrl;
  if (!typed || navigation?.extras.state) return false;
  if (DRAFT_PARAMS.some((name) => name in typed.queryParams)) return false;
  const all = typed.root.children['primary']?.segments.map((s) => s.path) ?? [];
  const address = readShortGithubAddress(all);
  if (address.kind !== 'project' || !address.parts.github) return false;
  const fromPath = segments
    .slice(1)
    .map((segment) => segment.path)
    .join('/');
  const id = fromPath || String(typed.queryParams['id'] ?? '');
  if (!id) return false;
  const reader = inject(GithubProjectReaderService);
  const exists = await firstValueFrom(
    reader
      .hasQuery(address.parts.projectId, id)
      .pipe(catchError(() => of(true))),
  );
  return !exists;
};
