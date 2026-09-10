import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { IHttpRequestOptions, SneatApiServiceFactory } from '@sneat/api';
import { STORE_ID_GITHUB_COM, STORE_TYPE_GITHUB } from '@sneat/core';
import { buildAgentUrl } from './agent-url';

const isGithubStoreId = (storeId: string): boolean =>
  storeId === STORE_ID_GITHUB_COM || storeId === STORE_TYPE_GITHUB;

/** Shown (via `ErrorLoggerService`) for any write attempted against a
 * GitHub-store project — every `post`/`put`/`delete` below refuses BEFORE
 * building a URL or making a request, since there is no CLI agent for a
 * GitHub-store id to build one against in the first place (the same
 * `buildAgentUrl` these methods otherwise call throws/produces an invalid
 * URL for it — founder ruling 2026-09-11). */
export const GITHUB_READ_ONLY_MESSAGE =
  'This project is read-only on GitHub — changes cannot be saved here. Clone it and run `datatug serve` to edit.';

@Injectable()
export class StoreApiService {
  private readonly sneatApiServiceFactory = inject(SneatApiServiceFactory);
  private readonly httpClient = inject(HttpClient);

  private static getUrl(repo: string, path: string): string {
    return buildAgentUrl(repo, path);
  }

  public get<T>(
    storeId: string,
    path: string,
    options?: IHttpRequestOptions,
  ): Observable<T> {
    const url = StoreApiService.getUrl(storeId, path);
    // console.log('url', url);
    return this.httpClient.get<T>(url, options);
  }

  // noinspection JSUnusedGlobalSymbols
  public post<T>(
    storeId: string,
    path: string,
    body: unknown,
    options?: IHttpRequestOptions,
  ): Observable<T> {
    if (isGithubStoreId(storeId)) {
      return throwError(() => new Error(GITHUB_READ_ONLY_MESSAGE));
    }
    const url = StoreApiService.getUrl(storeId, path);
    return this.httpClient.post<T>(url, body, options);
  }

  // noinspection JSUnusedGlobalSymbols
  public put<I, O>(
    storeId: string,
    path: string,
    body: I,
    options?: IHttpRequestOptions,
  ): Observable<O> {
    if (isGithubStoreId(storeId)) {
      return throwError(() => new Error(GITHUB_READ_ONLY_MESSAGE));
    }
    const sneatApiService =
      this.sneatApiServiceFactory.getSneatApiService(storeId);
    const url = StoreApiService.getUrl(storeId, path);
    return sneatApiService.put<I, O>(url, body, options);
  }

  // noinspection JSUnusedGlobalSymbols
  public delete<T>(
    storeId: string,
    path: string,
    options?: IHttpRequestOptions,
  ) {
    if (isGithubStoreId(storeId)) {
      return throwError(() => new Error(GITHUB_READ_ONLY_MESSAGE));
    }
    const url = StoreApiService.getUrl(storeId, path);
    return this.httpClient.delete<T>(url, options);
  }
}
