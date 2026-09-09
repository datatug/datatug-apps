import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ErrorLogger } from '@sneat/core';
import { of } from 'rxjs';

import { DatatugNavContextService } from './datatug-nav-context.service';
import { AppContextService } from '../../core/services/app-context.service';
import { ProjectContextService } from '../project/project-context.service';
import { ProjectService } from '../project/project.service';
import { EnvironmentService } from '../unsorted/environment.service';

describe('DatatugNavContextService', () => {
  let service: DatatugNavContextService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DatatugNavContextService,
        { provide: AppContextService, useValue: { currentApp: of(undefined) } },
        {
          provide: ProjectContextService,
          useValue: {
            current: undefined,
            setCurrent: vi.fn(),
            current$: of(undefined),
          },
        },
        { provide: Router, useValue: { events: of(), navigate: vi.fn() } },
        {
          provide: ProjectService,
          useValue: { watchProjectSummary: vi.fn(), getFull: vi.fn() },
        },
        { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn() } },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
      ],
    });
    service = TestBed.inject(DatatugNavContextService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

/**
 * Regression (lane S92, journey J3): a query page reached without an
 * `/env/:id` path segment or `?env=` query param (the context panel's "open
 * a query" hand-off, or a direct/reloaded navigation to `/query/:id` — this
 * app never puts environment info in either place for that route) used to
 * unconditionally clear `currentEnv` to `undefined`. `InvestigationContextService`
 * scopes its basket by `{agentUrl, project, environment, securityContextId}`,
 * so an `undefined` environment opens an always-empty scope — a value added
 * to context on an `/env/local/...` page could never be found again from the
 * query page, even though the real basket was still sitting in
 * `sessionStorage` under `environment: 'local'`. Confirmed live: the query
 * page's Parameters card said "required — no value supplied" instead of
 * "Customer.ID · from context", for exactly this reason (traced with a
 * temporary debug log on `QueryPageComponent.syncScopeAndBindings()`:
 * `environment` was `undefined` on every call).
 */
describe('DatatugNavContextService — environment persists across a reload with no /env/ in the URL', () => {
  function configureAndCreate() {
    TestBed.configureTestingModule({
      providers: [
        DatatugNavContextService,
        { provide: AppContextService, useValue: { currentApp: of({ appCode: 'datatug' }) } },
        {
          provide: ProjectContextService,
          useValue: { current: undefined, setCurrent: vi.fn(), current$: of(undefined) },
        },
        { provide: Router, useValue: { events: of(), navigate: vi.fn() } },
        {
          provide: ProjectService,
          useValue: {
            watchProjectSummary: vi.fn(() => of(undefined)),
            getFull: vi.fn(),
          },
        },
        {
          provide: EnvironmentService,
          useValue: { getEnvSummary: vi.fn(() => of(undefined)) },
        },
        {
          provide: ErrorLogger,
          useValue: { logError: vi.fn(), logErrorHandler: vi.fn(() => vi.fn()) },
        },
      ],
    });
    return TestBed.inject(DatatugNavContextService);
  }

  const storeId = 'localhost:8989';
  const projectId = 'datatug-demo-project';

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('persists and then falls back to the last environment resolved for this store+project', () => {
    // "the user is on the Customer table, in env=local" — a URL that names
    // the environment explicitly.
    window.history.replaceState(
      {},
      '',
      `/store/${storeId}/project/${projectId}/env/local/db/chinook-local/table/main.Customer`,
    );
    const first = configureAndCreate();
    let firstEnvId: string | undefined;
    first.currentEnv.subscribe((env) => (firstEnvId = env?.id));
    expect(firstEnvId).toBe('local');

    // "a full reload straight onto the query page" — a *different* service
    // instance (a fresh app boot, matching a real reload), with a URL that
    // names neither an `/env/:id` segment nor a `?env=` query param.
    TestBed.resetTestingModule();
    window.history.replaceState(
      {},
      '',
      `/store/${storeId}/project/${projectId}/query/customer-purchases-by-genre?id=customer-purchases-by-genre`,
    );
    const second = configureAndCreate();
    let secondEnvId: string | undefined;
    second.currentEnv.subscribe((env) => (secondEnvId = env?.id));

    expect(secondEnvId).toBe('local');
  });

  it('still clears to undefined when nothing was ever persisted for this store+project', () => {
    window.history.replaceState(
      {},
      '',
      `/store/${storeId}/project/${projectId}/query/customer-purchases-by-genre?id=customer-purchases-by-genre`,
    );
    const service = configureAndCreate();
    let envId: string | undefined = 'not-yet-read';
    service.currentEnv.subscribe((env) => (envId = env?.id));

    expect(envId).toBeUndefined();
  });
});
