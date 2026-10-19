import { DatatugApiService } from '../services/base/datatug-api.service';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse, HttpParams } from '@angular/common/http';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SessionContextApiService } from './session-context-api.service';
import { ContextCapabilities } from './session-context-contract';
import { SessionDetectiveRequest } from './session-detective-contract';
const project = { storeId: 'http-localhost:8989', projectId: 'source-project' };
const locator = {
  storage: 'local',
  project: 'source-project',
  databaseId: 'ops-db',
  projectId: 'private-project',
  namespaceId: 'private-ns',
};
const caps: ContextCapabilities = {
  schemaVersion: 1,
  actorId: 'alice',
  databaseId: locator.databaseId,
  projectId: locator.projectId,
  nativeDetective: true,
  operationScope: locator,
  actions: [],
  environments: [],
};
const body: SessionDetectiveRequest = {
  operationId: 'op_1',
  sessionId: 'session_1',
  expectedVersion: 2,
  expectedContextSetId: 'context_1',
  scope: { environmentId: 'demo', identityDomain: 'embedded' },
  checkId: 'check_1',
  bindings: [
    { inputName: 'invoice_id', entryId: 'entry_1', revisionId: 'revision_1' },
  ],
};
it('keeps selectors out of body, derives no native IDs and GET/reconcile cannot dispatch', async () => {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      SessionContextApiService,
    ],
  });
  const service = TestBed.inject(SessionContextApiService),
    http = TestBed.inject(HttpTestingController);
  const accepted = {
    operationId: body.operationId,
    operationScope: locator,
    status: {
      runId: 'run_1',
      state: 'dispatching',
      produced: false,
      done: false,
      privatePins: 'must-be-omitted',
    },
  };
  const pending = service.nativeDetective(project, caps, body);
  const req = http.expectOne((req) =>
    req.url.endsWith('/session-context/detective'),
  );
  expect(req.request.body).toEqual(body);
  for (const [key, value] of Object.entries(locator))
    expect(req.request.params.get(key)).toEqual(value);
  req.flush(accepted);
  expect((await pending).status).not.toHaveProperty('privatePins');
  const lookup = service.nativeDetectiveOperation(
    project,
    locator,
    body.operationId,
  );
  const get = http.expectOne((req) =>
    req.url.endsWith('/detective/operations/op_1'),
  );
  expect(get.request.method).toBe('GET');
  get.flush(accepted);
  await lookup;
  const reconcile = service.reconcileNativeDetective(
    project,
    locator,
    body.operationId,
  );
  const post = http.expectOne((req) =>
    req.url.endsWith('/detective/reconcile'),
  );
  expect(post.request.body).toEqual({ operationId: body.operationId });
  post.flush(accepted);
  await reconcile;
  http.verify();
});

it('recovers GitHub metadata without content/default-branch reads and omits branch on every native port', async () => {
  const github = { storeId: 'github.com', projectId: 'repo@owner@datatug' };
  const scope = {
    ...locator,
    storage: 'github.com',
    project: github.projectId,
  };
  const accepted = {
    operationId: body.operationId,
    operationScope: scope,
    status: {
      runId: 'run_1',
      state: 'dispatching',
      produced: false,
      done: false,
    },
  };
  const get = vi.fn((_path: string, params: HttpParams) => {
    void _path;
    void params;
    return of(accepted);
  });
  const post = vi.fn(
    (_path: string, value: unknown, options: { params: HttpParams }) => {
      void _path;
      void value;
      void options;
      return of(accepted);
    },
  );
  const branches = vi.fn(() =>
    throwError(() => new HttpErrorResponse({ status: 403 })),
  );
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      SessionContextApiService,
      { provide: DatatugApiService, useValue: { get, post } },
      { provide: ProjectQueryApiService, useValue: { branches } },
    ],
  });
  const service = TestBed.inject(SessionContextApiService);
  await service.nativeDetectiveOperation(github, scope, body.operationId);
  expect(branches).not.toHaveBeenCalled();
  const getParams = get.mock.calls[0][1] as HttpParams;
  expect(getParams.keys().sort()).toEqual(Object.keys(scope).sort());
  const explicit = { ...github, branch: 'release/context' };
  await service.nativeDetective(
    explicit,
    { ...caps, operationScope: scope },
    body,
  );
  await service.reconcileNativeDetective(explicit, scope, body.operationId);
  for (const call of post.mock.calls)
    expect((call[2] as { params: HttpParams }).params.has('branch')).toBe(
      false,
    );
  expect(branches).not.toHaveBeenCalled();
});
