import { catchError, throwError } from 'rxjs';
import { SneatApiNotAuthenticatedError } from '@sneat/api';
import { inject, Injectable } from '@angular/core';
import { HttpParams } from '@angular/common/http';
import {
  formatGithubProjectApiKey,
  readGithubProjectId,
} from '@datatug/project-address';
import { IProjectRef, isSharedProjectRef } from '../core/project-context';
import { DatatugApiService } from '../services/base/datatug-api.service';
import {
  SearchKind,
  SearchResponse,
  SearchSnapshot,
  SearchStatus,
} from './quick-search-model';

export function quickSearchParams(ref: IProjectRef): HttpParams {
  let storage = ref.storeId;
  let project = ref.projectId;
  if (ref.spaceID !== undefined && !isSharedProjectRef(ref))
    throw new Error('Invalid project scope');
  if (storage === 'github' || storage === 'github.com') {
    const address = readGithubProjectId(project);
    if (
      !address.ok ||
      (ref.branch && address.id.ref && ref.branch !== address.id.ref)
    )
      throw new Error('Invalid project scope');
    storage = 'github.com';
    project = formatGithubProjectApiKey(address.id);
    return new HttpParams({
      fromObject: {
        storage,
        project,
        branch: ref.branch || address.id.ref || 'HEAD',
      },
    });
  }
  return new HttpParams({
    fromObject: {
      storage,
      project,
      ...(ref.spaceID ? { spaceID: ref.spaceID } : {}),
      ...(ref.branch ? { branch: ref.branch } : {}),
    },
  });
}
@Injectable({ providedIn: 'root' })
export class QuickSearchApiService {
  private readonly api = inject(DatatugApiService);
  status(ref: IProjectRef) {
    const endpoint = 'datatug/project/quick-search/status';
    const params = quickSearchParams(ref);
    return this.api
      .get<SearchStatus>(endpoint, params)
      .pipe(
        catchError((error) =>
          error === SneatApiNotAuthenticatedError &&
          ['github', 'github.com'].includes(ref.storeId)
            ? this.api.getAsAnonymous<SearchStatus>(endpoint, params)
            : throwError(() => error),
        ),
      );
  }
  search(
    ref: IProjectRef,
    q: string,
    kinds: SearchKind[] = [],
    tags: string[] = [],
  ) {
    const endpoint = 'datatug/project/quick-search/search';
    const params = quickSearchParams(ref),
      body = { q, kinds, tags };
    return this.api
      .post<SearchResponse>(endpoint, body, { params })
      .pipe(
        catchError((error) =>
          error === SneatApiNotAuthenticatedError &&
          ['github', 'github.com'].includes(ref.storeId)
            ? this.api.postAsAnonymous<SearchResponse>(
                endpoint + '?' + params.toString(),
                body,
              )
            : throwError(() => error),
        ),
      );
  }
  /** Authenticated metadata read only; never falls back to anonymous access. */
  preview(ref: IProjectRef, environmentId?: string) {
    return this.api.post<SearchSnapshot>(
      'datatug/project/quick-search/preview',
      environmentId === undefined ? {} : { environmentId },
      { params: quickSearchParams(ref) },
    );
  }
  enable(ref: IProjectRef, snapshot: SearchSnapshot) {
    return this.api.post<SearchStatus>(
      'datatug/project/quick-search/enable',
      { ...snapshot, consent: true, consentVersion: 'project-quick-search/1' },
      { params: quickSearchParams(ref) },
    );
  }
  refresh(ref: IProjectRef, snapshot: SearchSnapshot) {
    return this.api.post<SearchStatus>(
      'datatug/project/quick-search/refresh',
      snapshot,
      { params: quickSearchParams(ref) },
    );
  }
  disable(ref: IProjectRef) {
    return this.api.post<SearchStatus>(
      'datatug/project/quick-search/disable',
      {},
      { params: quickSearchParams(ref) },
    );
  }
}
