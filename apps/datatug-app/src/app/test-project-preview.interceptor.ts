import { HttpInterceptorFn } from '@angular/common/http';
import { TEST_CHECKOUT_ORIGIN } from './checkout/checkout-config.mjs';

const LOCAL_PREVIEW_ORIGIN = 'http://localhost:18782';
const PRODUCTION_API_ORIGIN = 'https://api.sneat.cloud';
const LOCAL_PROJECT_API_ORIGIN = 'https://sneat-app-354fvnqbaa-ey.a.run.app';

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

const LOCAL_PROJECT_API_FALLBACK_METHODS: Readonly<Record<string, string>> = {
  '/v0/datatug/github/oauth/repositories': 'GET',
  '/v0/datatug/github/oauth/resolve-repository': 'POST',
  '/v0/spaces/create_space': 'POST',
};

/** Routes only the approved local project-preview and lookup requests. */
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
    (TEST_PROJECT_PREVIEW_METHODS[url.pathname] !== method &&
      LOCAL_PROJECT_API_FALLBACK_METHODS[url.pathname] !== method)
  ) {
    return undefined;
  }

  const origin =
    TEST_PROJECT_PREVIEW_METHODS[url.pathname] === method
      ? TEST_CHECKOUT_ORIGIN
      : LOCAL_PROJECT_API_ORIGIN;
  return `${origin}${url.pathname}${url.search}`;
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
