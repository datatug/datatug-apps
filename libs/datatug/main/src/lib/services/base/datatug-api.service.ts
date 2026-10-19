import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { SneatApiAuthTokenBridge, SneatApiService } from '@sneat/api';
import { SneatUrlOperationBlocker } from '@sneat/core-public';
import { DatatugApiBaseUrl } from '@sneat/datatug-semantic';

/**
 * Client for the DataTug API. It inherits the Sneat token bridge, the Bearer
 * header and the 401 refresh from `SneatApiService`, and differs only in the
 * base URL it is given (`DatatugApiBaseUrl`, which mirrors `SneatApiBaseUrl`).
 * The dedicated TEST project preview keeps identity calls on the normal API.
 *
 * Decorators are not inherited, so this class declares its own `@Injectable`
 * and constructor.
 */
@Injectable({ providedIn: 'root' })
export class DatatugApiService extends SneatApiService {
  private readonly authoritativeApi = inject(SneatApiService);
  // Only the dedicated TEST project build delegates these identity operations.
  // An arbitrary custom API origin must not change where credentials are sent.
  private readonly projectPreview = inject(DatatugApiBaseUrl) ===
    'https://datatug-cloud-preview-354fvnqbaa-ey.a.run.app/v0/';

  override get<T>(endpoint: string, params?: HttpParams, options?: Parameters<SneatApiService['get']>[2]) {
    return this.projectPreview && endpoint === 'datatug/github/oauth/repositories'
      ? this.authoritativeApi.get<T>(endpoint, params, options)
      : super.get<T>(endpoint, params, options);
  }

  override post<T>(endpoint: string, body: unknown, options?: Parameters<SneatApiService['post']>[2]) {
    const identityEndpoint = endpoint === 'datatug/github/oauth/start' ||
      endpoint === 'datatug/github/oauth/complete' ||
      endpoint === 'datatug/github/oauth/resolve-repository' ||
      endpoint === 'datatug/github/authorization/start' ||
      endpoint === 'datatug/github/authorization/complete';
    return this.projectPreview && identityEndpoint
      ? this.authoritativeApi.post<T>(endpoint, body, options)
      : super.post<T>(endpoint, body, options);
  }

  constructor() {
    super(
      inject(HttpClient),
      inject(SneatApiAuthTokenBridge),
      inject(DatatugApiBaseUrl),
      inject(SneatUrlOperationBlocker),
    );
  }
}
