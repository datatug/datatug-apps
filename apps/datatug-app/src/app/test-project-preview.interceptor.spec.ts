import '@angular/compiler';
import { HttpHeaders, HttpRequest, HttpResponse } from '@angular/common/http';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { TEST_CHECKOUT_ORIGIN } from './checkout/checkout-config.mjs';
import {
  createTestProjectPreviewInterceptor,
  testProjectPreviewUrl,
} from './test-project-preview.interceptor';

const localPreview = 'http://localhost:18782';
const productionApi = 'https://api.sneat.cloud';

describe('testProjectPreviewUrl', () => {
  it('routes a real setup POST before dispatch while preserving its body and headers', () => {
    const body = { store: 'github.com', repository: 'owner/repo' };
    const request = new HttpRequest(
      'POST',
      `${productionApi}/v0/datatug/projects/create_project?store=github.com`,
      body,
      { headers: new HttpHeaders({ 'X-Setup-Intent': 'private-test' }) },
    );
    let dispatched: HttpRequest<unknown> | undefined;
    const interceptor = createTestProjectPreviewInterceptor(() => localPreview);

    interceptor(request, (nextRequest) => {
      dispatched = nextRequest;
      return of(new HttpResponse());
    }).subscribe();

    expect(dispatched?.url).toBe(
      `${TEST_CHECKOUT_ORIGIN}/v0/datatug/projects/create_project?store=github.com`,
    );
    expect(dispatched?.body).toBe(body);
    expect(dispatched?.headers.get('X-Setup-Intent')).toBe('private-test');
  });

  it('preserves the direct API fallback Space request body, query, and headers', () => {
    const body = { type: 'company', title: 'Business Space' };
    const request = new HttpRequest(
      'POST',
      `${productionApi}/v0/spaces/create_space?source=local-preview`,
      body,
      { headers: new HttpHeaders({ 'X-Setup-Intent': 'private-test' }) },
    );
    let dispatched: HttpRequest<unknown> | undefined;
    const interceptor = createTestProjectPreviewInterceptor(() => localPreview);

    interceptor(request, (nextRequest) => {
      dispatched = nextRequest;
      return of(new HttpResponse());
    }).subscribe();

    expect(dispatched?.url).toBe(
      'https://sneat-app-354fvnqbaa-ey.a.run.app/v0/spaces/create_space?source=local-preview',
    );
    expect(dispatched?.body).toBe(body);
    expect(dispatched?.headers.get('X-Setup-Intent')).toBe('private-test');
  });

  it('routes the native project-creation requests and preserves query strings', () => {
    expect(
      testProjectPreviewUrl(
        `${productionApi}/v0/datatug/github/repositories?limit=100&after=a%2Fb`,
        'GET',
        localPreview,
      ),
    ).toBe(
      `${TEST_CHECKOUT_ORIGIN}/v0/datatug/github/repositories?limit=100&after=a%2Fb`,
    );
    expect(
      testProjectPreviewUrl(
        `${productionApi}/v0/datatug/projects/create_project?store=github.com`,
        'POST',
        localPreview,
      ),
    ).toBe(
      `${TEST_CHECKOUT_ORIGIN}/v0/datatug/projects/create_project?store=github.com`,
    );
    expect(
      testProjectPreviewUrl(
        `${productionApi}/v0/datatug/projects/create_project/status?operationID=op-1`,
        'GET',
        localPreview,
      ),
    ).toBe(
      `${TEST_CHECKOUT_ORIGIN}/v0/datatug/projects/create_project/status?operationID=op-1`,
    );
  });

  it('routes only allowlisted project reads and the native query save method', () => {
    expect(
      testProjectPreviewUrl(
        `${productionApi}/v0/datatug/projects/project_summary?storage=github.com&project=smoke`,
        'GET',
        localPreview,
      ),
    ).toBe(
      `${TEST_CHECKOUT_ORIGIN}/v0/datatug/projects/project_summary?storage=github.com&project=smoke`,
    );
    expect(
      testProjectPreviewUrl(
        `${productionApi}/v0/datatug/queries/save_query`,
        'POST',
        localPreview,
      ),
    ).toBe(`${TEST_CHECKOUT_ORIGIN}/v0/datatug/queries/save_query`);
  });

  it('routes only local repository lookup, resolution, and Space creation to the existing API host', () => {
    const localProjectApi = 'https://sneat-app-354fvnqbaa-ey.a.run.app';
    expect(
      testProjectPreviewUrl(
        `${productionApi}/v0/datatug/github/oauth/repositories?provider=github`,
        'GET',
        localPreview,
      ),
    ).toBe(
      `${localProjectApi}/v0/datatug/github/oauth/repositories?provider=github`,
    );
    expect(
      testProjectPreviewUrl(
        `${productionApi}/v0/datatug/github/oauth/resolve-repository`,
        'POST',
        localPreview,
      ),
    ).toBe(`${localProjectApi}/v0/datatug/github/oauth/resolve-repository`);
    expect(
      testProjectPreviewUrl(
        `${productionApi}/v0/spaces/create_space`,
        'POST',
        localPreview,
      ),
    ).toBe(`${localProjectApi}/v0/spaces/create_space`);
  });

  it.each([
    [
      'wrong local port',
      'http://localhost:18781',
      `${productionApi}/v0/datatug/projects/create_project`,
      'POST',
    ],
    [
      'wrong local scheme',
      'https://localhost:18782',
      `${productionApi}/v0/datatug/projects/create_project`,
      'POST',
    ],
    [
      'another local host',
      'http://127.0.0.1:18782',
      `${productionApi}/v0/datatug/projects/create_project`,
      'POST',
    ],
    [
      'different API origin',
      localPreview,
      'https://api.sneat.cloud.evil/v0/datatug/projects/create_project',
      'POST',
    ],
    [
      'different API scheme',
      localPreview,
      'http://api.sneat.cloud/v0/datatug/projects/create_project',
      'POST',
    ],
    [
      'wrong method',
      localPreview,
      `${productionApi}/v0/datatug/projects/create_project`,
      'GET',
    ],
    [
      'unlisted path',
      localPreview,
      `${productionApi}/v0/datatug/projects/arbitrary`,
      'GET',
    ],
    [
      'authentication path',
      localPreview,
      `${productionApi}/oauth/authorize`,
      'GET',
    ],
    [
      'checkout path',
      localPreview,
      `${productionApi}/v0/checkout/session`,
      'POST',
    ],
    [
      'OAuth start path',
      localPreview,
      `${productionApi}/v0/datatug/github/oauth/start`,
      'POST',
    ],
    [
      'OAuth completion path',
      localPreview,
      `${productionApi}/v0/datatug/github/oauth/complete`,
      'POST',
    ],
    [
      'unlisted direct API path',
      localPreview,
      `${productionApi}/v0/spaces/delete_space`,
      'POST',
    ],
    [
      'fallback path on production page',
      'https://datatug.app',
      `${productionApi}/v0/spaces/create_space`,
      'POST',
    ],
    [
      'different source origin for fallback path',
      localPreview,
      'https://sneat-app-354fvnqbaa-ey.a.run.app/v0/spaces/create_space',
      'POST',
    ],
    [
      'fallback path with wrong method',
      localPreview,
      `${productionApi}/v0/datatug/github/oauth/repositories`,
      'POST',
    ],
    [
      'credentialed URL',
      localPreview,
      `https://user:pass@api.sneat.cloud/v0/datatug/projects/create_project`,
      'POST',
    ],
  ])('leaves %s unchanged', (_case, pageOrigin, url, method) => {
    expect(testProjectPreviewUrl(url, method, pageOrigin)).toBeUndefined();
  });
});
