import { HttpInterceptorFn } from '@angular/common/http';
import { TEST_CHECKOUT_ORIGIN } from './checkout/checkout-config.mjs';

const LOCAL_PREVIEW_ORIGIN = 'http://localhost:18782';
const PRODUCTION_API_ORIGIN = 'https://api.sneat.cloud';

const TEST_PROJECT_PREVIEW_METHODS: Readonly<Record<string, string>> = {
  '/v0/datatug/github/repositories': 'GET',
  '/v0/datatug/projects/create_project': 'POST',
  '/v0/datatug/projects/create_project/status': 'GET',
  '/v0/datatug/projects/capabilities': 'GET',
  '/v0/datatug/projects/project_summary': 'GET',
  '/v0/datatug/projects/connection_catalog': 'GET',
  '/v0/datatug/projects/branches': 'GET',
  '/v0/datatug/queries/all_queries': 'GET',
  '/v0/datatug/queries/query_revision': 'GET',
  '/v0/datatug/queries/save_query': 'POST',
};

/** Routes only the native project-preview API calls from the dedicated local preview. */
export function testProjectPreviewUrl(
  requestUrl: string,
  method: string,
  pageOrigin: string,
): string | undefined {
  if (pageOrigin !== LOCAL_PREVIEW_ORIGIN) return undefined;

  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return undefined;
  }

  if (
    url.origin !== PRODUCTION_API_ORIGIN ||
    url.username ||
    url.password ||
    TEST_PROJECT_PREVIEW_METHODS[url.pathname] !== method
  ) {
    return undefined;
  }

  return `${TEST_CHECKOUT_ORIGIN}${url.pathname}${url.search}`;
}

export function createTestProjectPreviewInterceptor(
  pageOrigin: () => string,
): HttpInterceptorFn {
  return (request, next) => {
    const url = testProjectPreviewUrl(
      request.url,
      request.method,
      pageOrigin(),
    );
    return next(url ? request.clone({ url }) : request);
  };
}

export const testProjectPreviewInterceptor =
  createTestProjectPreviewInterceptor(() => location.origin);
