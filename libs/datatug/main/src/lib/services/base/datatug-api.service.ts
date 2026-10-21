import {
  HttpClient,
  HttpHandler,
  HttpParams,
  HttpResponse,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { SneatApiAuthTokenBridge, SneatApiService } from '@sneat/api';
import { AnalyticsService, LOGGER_FACTORY, loggerFactory } from '@sneat/core';
import { SneatUrlOperationBlocker } from '@sneat/core-public';
import {
  DatatugApiBaseUrl,
  DatatugApiBaseUrls,
  DatatugApiFailoverConfig,
  DATATUG_TEST_PREVIEW_API_BASE_URL,
} from '@sneat/datatug-semantic';
import { DatatugApiFailoverHttpClient } from './datatug-api-failover.http-client';

/** The configured base URLs, never empty: an empty list falls back to `DatatugApiBaseUrl`. */
function datatugApiBaseUrlList(): readonly string[] {
  const urls = inject(DatatugApiBaseUrls);
  return urls.length > 0 ? urls : [inject(DatatugApiBaseUrl)];
}

/**
 * The HttpClient `SneatApiService` sends through: the plain one for a single base URL
 * (exactly the behaviour before failover), the failover one for two or more.
 */
function datatugApiHttpClient(): HttpClient {
  const urls = datatugApiBaseUrlList();
  if (urls.length < 2) {
    return inject(HttpClient);
  }
  const factory = inject(LOGGER_FACTORY, { optional: true }) ?? loggerFactory;
  return new DatatugApiFailoverHttpClient(
    inject(HttpHandler),
    urls,
    inject(DatatugApiFailoverConfig),
    factory.getLogger('DatatugApiFailover'),
    inject(AnalyticsService, { optional: true }),
  );
}

/**
 * Client for the DataTug API. It inherits the Sneat token bridge, the Bearer
 * header and the 401 refresh from `SneatApiService`, and differs only in the
 * base URL it is given (`DatatugApiBaseUrl`, which mirrors `SneatApiBaseUrl`).
 * The dedicated TEST project preview keeps identity calls on the normal API.
 *
 * With two or more `DatatugApiBaseUrls` it fails over to the next base URL when a
 * request fails in a way that is safe to repeat (see `DatatugApiFailoverHttpClient`);
 * with one it behaves exactly as before.
 *
 * Decorators are not inherited, so this class declares its own `@Injectable`
 * and constructor.
 */
@Injectable({ providedIn: 'root' })
export class DatatugApiService extends SneatApiService {
  private readonly authoritativeApi = inject(SneatApiService);
  // Only the dedicated TEST project build delegates these identity operations.
  // An arbitrary custom API origin must not change where credentials are sent.
  private readonly projectPreview =
    inject(DatatugApiBaseUrl) === DATATUG_TEST_PREVIEW_API_BASE_URL;

  override get<T>(
    endpoint: string,
    params?: HttpParams,
    options?: Parameters<SneatApiService['get']>[2],
  ) {
    return this.projectPreview &&
      endpoint === 'datatug/github/oauth/repositories'
      ? this.authoritativeApi.get<T>(endpoint, params, options)
      : super.get<T>(endpoint, params, options);
  }

  /** Header-aware reads use the same authenticated/401-safe transport.
   * Sneat's runtime forwards observe, but its current public options type is body-only.
   */
  getResponse<T>(
    endpoint: string,
    params?: HttpParams,
    responseType: 'json' | 'text' = 'json',
  ) {
    const options = {
      observe: 'response',
      responseType,
    } as unknown as NonNullable<Parameters<SneatApiService['get']>[2]>;
    return this.get<HttpResponse<T>>(endpoint, params, options);
  }

  override post<T>(
    endpoint: string,
    body: unknown,
    options?: Parameters<SneatApiService['post']>[2],
  ) {
    const identityEndpoint =
      endpoint === 'datatug/github/oauth/start' ||
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
      datatugApiHttpClient(),
      inject(SneatApiAuthTokenBridge),
      datatugApiBaseUrlList()[0],
      inject(SneatUrlOperationBlocker),
    );
  }
}
