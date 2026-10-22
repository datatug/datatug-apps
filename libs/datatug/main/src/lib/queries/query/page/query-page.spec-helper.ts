import { toProjectQueryWire } from '../../project-query-contract';
import type { ProjectQueryReadWire } from '../../project-query-contract';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Component, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Observable, firstValueFrom, of } from 'rxjs';
import { type FederatedQueryResult } from '../../federated-query.service';
import type { QueryDispatchRequest } from '../../query-dispatch';
import type { DetectiveState } from '../../../detective/models';

/**
 * The query dispatch doubles of one spec file. Spec files share a module graph per worker, so each file creates its
 * own with {@link createDispatchFixtures}; a test replaces one by assigning to it (`fx.localResultFixture = vi.fn()`).
 */
export function createDispatchFixtures() {
  return {
    localResultFixture: vi.fn(),
    federationResultFixture: vi.fn(),
    dispatchPageResponse: vi.fn(),
    dispatchBrowserResponse: vi.fn(),
    dispatchOvdbResponse: vi.fn(),
    dispatchHostedResponse: vi.fn(),
    dispatchStart: vi.fn(),
    dispatchCancel: vi.fn(async () => undefined),
  };
}
export type DispatchFixtures = ReturnType<typeof createDispatchFixtures>;

export const repositoryRoot = resolvePath(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../../../',
);
export const resolve = (path: string): string => resolvePath(repositoryRoot, path);

export const detectiveClientStub = () => ({
  state: vi.fn((): Observable<DetectiveState> =>
    of({
      checks: [],
      validators: [],
      queryValidators: [],
      cases: [],
      runs: [],
      scenarios: [],
      runsHasMore: false,
      environments: [],
      capabilities: {
        localOnly: false,
        canRead: true,
        canWrite: false,
        canRun: false,
        maxRows: 0,
        maxFanout: 0,
      },
    }),
  ),
  runHostedQuery: vi.fn(),
  action: vi.fn(),
});


export function fixturePromise<T>(source: Observable<T> | Promise<T> | T | undefined): Promise<T> {
  if (source === undefined) return new Promise<T>(() => undefined);
  if (source instanceof Observable) return firstValueFrom(source);
  return Promise.resolve(source);
}

/** A session-level fake: transport behavior is exercised in query-dispatch.service.spec.ts. */
export function queryDispatchTestStub(fx: DispatchFixtures) {
  const revision = signal(0);
  return { runtimeRevision: revision.asReadonly(), advanceRevision: () => revision.update((value) => value + 1),
    availableWorkingCopies: vi.fn(async () => []), start: (request: QueryDispatchRequest) => {
    fx.dispatchStart(request);
    const target = request.target?.kind;
    const shared = {
      cancel: fx.dispatchCancel,
      dispose: fx.dispatchCancel,
      getPage: fx.dispatchPageResponse,
      associateLocalResult: vi.fn(async () => undefined),
    };
    if (target === 'local-agent') return {
      ...shared,
      result: fixturePromise<FederatedQueryResult>(fx.localResultFixture(request)),
    };
    if (target === 'hosted-cloud') {
      const hostedResponse = fixturePromise(fx.dispatchHostedResponse(request));
      return { ...shared, hostedResponse, result: hostedResponse.then((response) => response.result) };
    }
    if (target === 'browser-sqlite') {
      let response: ReturnType<DispatchFixtures['dispatchBrowserResponse']>;
      try { response = fx.dispatchBrowserResponse(request); }
      catch (error) { return { ...shared, result: Promise.reject(error) }; }
      if (response !== undefined) request.onDispatched?.();
      return { ...shared, result: fixturePromise<FederatedQueryResult>(response) };
    }
    if (request.runtimeSelectionId) return {
      ...shared, result: fixturePromise<FederatedQueryResult>(fx.dispatchOvdbResponse(request)),
    };
    if (target === 'ovdb-federation') return {
      ...shared,
      result: fixturePromise<FederatedQueryResult>(fx.federationResultFixture(request)),
    };
    throw new Error(`Unexpected query dispatch target in test: ${target ?? 'none'}`);
  } };
}

@Component({ selector: 'sneat-datatug-sql', standalone: true, template: '' })
export class SqlEditorHostStub {
  readonly sql = input('');
  readonly readonly = input(false);
  readonly disabled = input(false);
  readonly lineNumbers = input(true);
  readonly autoCloseBrackets = input(true);
  readonly ariaLabel = input('SQL query');
  readonly sqlChanged = output<string>();
}

export function agentContextStub(
  securityContextId: string | undefined | null = 'sctx-1',
) {
  const scopedSecurityContextId = signal<string | undefined>(
    securityContextId === null ? undefined : securityContextId,
  );
  return {
    securityContextId: scopedSecurityContextId,
    contextFor: vi.fn(() => ({ securityContextId: scopedSecurityContextId })),
    refresh: vi.fn(() => of(undefined)),
  };
}

export function asReadWire(
  wire: ReturnType<typeof toProjectQueryWire>,
): ProjectQueryReadWire {
  return { ...wire } as ProjectQueryReadWire;
}

export function githubProjectActivityStub() {
  return {
    bindingGeneration: 0,
    resolve: vi.fn(() => of(undefined)),
    reportForCurrentProject: vi.fn(() => of(undefined)),
  };
}

export function setRouterNavigation(
  router: Router,
  info: unknown,
  id: number,
  successful = false,
): void {
  const currentNavigation = router.currentNavigation as unknown as ReturnType<
    typeof vi.fn
  >;
  const lastSuccessfulNavigation =
    router.lastSuccessfulNavigation as unknown as ReturnType<typeof vi.fn>;
  currentNavigation.mockReturnValue({ id, extras: { info } });
  if (successful) {
    lastSuccessfulNavigation.mockReturnValue({ id, extras: { info } });
  }
}

export function clearCurrentRouterNavigation(router: Router): void {
  const currentNavigation = router.currentNavigation as unknown as ReturnType<
    typeof vi.fn
  >;
  currentNavigation.mockReturnValue(null);
}

export function setRouteId(id: string): void {
  Object.defineProperty(TestBed.inject(ActivatedRoute), 'snapshot', {
    configurable: true,
    value: { queryParamMap: convertToParamMap({ id }) },
  });
}
