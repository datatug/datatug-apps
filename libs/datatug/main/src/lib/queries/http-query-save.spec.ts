import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { EMPTY, firstValueFrom, of, throwError } from 'rxjs';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { ProjectService } from '../services/project/project.service';
import {
  QueryType,
  type IHttpQueryRequest,
  type IQueryDef,
} from '../models/definition/query-def';
import { provideMockErrorLogger } from '../testing/error-logger.spec-helper';
import { QueriesService } from './queries.service';
import {
  QueryEditorStateService,
  serverSaveReason,
} from './query-editor-state-service';

const request: IHttpQueryRequest = {
  queryType: QueryType.HTTP,
  url: 'https://api.example.com/x',
  method: 'POST',
  headers: [
    { name: 'Authorization', value: 'Bearer live' },
    { name: ' Accept ', value: 'application/json' },
  ],
  body: '{"a":1}',
};
const def: IQueryDef = {
  id: 'http-q',
  title: 'HTTP',
  request: {
    queryType: QueryType.HTTP,
    url: request.url,
    method: 'GET',
  } as IHttpQueryRequest,
};

function setup(
  projectRef: object,
  queries: Record<string, unknown>,
): QueryEditorStateService {
  const project = { ref: projectRef, summary: { id: 'p', title: 'P' } };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      QueryEditorStateService,
      provideMockErrorLogger(),
      {
        provide: QueriesService,
        useValue: {
          authorityDenied: () => EMPTY,
          authentication: () => of({ status: 'authenticated' }),
          capabilities: () => of({ querySave: true }),
          ...queries,
        },
      },
      { provide: ProjectService, useValue: { getFull: vi.fn() } },
      {
        provide: DatatugNavContextService,
        useValue: { currentProject: of(project), currentEnv: of(undefined) },
      },
    ],
  });
  return TestBed.inject(QueryEditorStateService);
}

const newState = (service: QueryEditorStateService, r = request) =>
  service.newQuery({
    id: def.id,
    title: def.title,
    queryType: QueryType.HTTP,
    request: r,
    def,
    isNew: true,
    branchHead: 'head',
  });

describe('HTTP query save strips credentials on every path', () => {
  it('legacy create/update path sends no credential header and keeps it in the session', async () => {
    const ref = { storeId: 'github.com', projectId: 'owner/repo' };
    const createQuery = vi.fn((_ref, q: IQueryDef) => of(q));
    const service = setup(ref, { createQuery, updateQuery: vi.fn() });
    const state = newState(service);
    await firstValueFrom(service.saveQuery(state, ref));
    const sent = createQuery.mock.calls[0][1].request as IHttpQueryRequest;
    expect(sent.headers).toEqual([
      { name: 'Accept', value: 'application/json' },
    ]);
    expect(sent.body).toBe('{"a":1}');
    expect(JSON.stringify(sent)).not.toContain('Bearer live');
    const live = service.getQueryState(def.id)?.request as IHttpQueryRequest;
    expect(live.headers).toEqual(request.headers);
  });

  it('legacy update path also strips, and drops the body of a bodyless method', async () => {
    const ref = { storeId: 'github.com', projectId: 'owner/repo' };
    const updateQuery = vi.fn((_ref, q: IQueryDef) => of(q));
    const service = setup(ref, { createQuery: vi.fn(), updateQuery });
    const state = {
      ...newState(service, { ...request, method: 'GET' }),
      isNew: false,
    };
    service.updateQueryState(state);
    await firstValueFrom(service.saveQuery(state, ref));
    const sent = updateQuery.mock.calls[0][1].request as IHttpQueryRequest;
    expect(sent.body).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain('Authorization');
    const live = service.getQueryState(def.id)?.request as IHttpQueryRequest;
    expect(live.body).toBe('{"a":1}');
  });

  it('common path sends no credential header', async () => {
    const ref = {
      storeId: 'github.com',
      projectId: 'demo@buyer@project',
      projectApi: 'cloud' as const,
      branch: 'main',
    };
    const saveRevision = vi.fn((_ref, r) =>
      of({ query: r.query, revision: 'rev', branchHead: 'h2' }),
    );
    const service = setup(ref, { saveRevision });
    await firstValueFrom(service.saveQuery(newState(service), ref));
    const wire = saveRevision.mock.calls[0][1].query;
    expect(wire.http.headers).toEqual([
      { name: 'Accept', value: 'application/json' },
    ]);
    expect(JSON.stringify(wire)).not.toContain('Bearer live');
  });
});

describe('HTTP query save problems and server reasons', () => {
  const cloud = {
    storeId: 'github.com',
    projectId: 'demo@buyer@project',
    projectApi: 'cloud' as const,
    branch: 'main',
  };
  const bad = { ...request, headers: [{ name: 'Bad Name', value: 'x' }] };

  it('blocks a save with an invalid header name on the common path', async () => {
    const saveRevision = vi.fn();
    const service = setup(cloud, { saveRevision });
    await expect(
      firstValueFrom(service.saveQuery(newState(service, bad), cloud)),
    ).rejects.toThrow();
    expect(saveRevision).not.toHaveBeenCalled();
    expect(service.getQueryState(def.id)?.saveError).toContain('Bad Name');
  });

  it('blocks a save with an invalid header name on the legacy path', async () => {
    const ref = { storeId: 'github.com', projectId: 'owner/repo' };
    const createQuery = vi.fn();
    const service = setup(ref, { createQuery });
    await expect(
      firstValueFrom(service.saveQuery(newState(service, bad), ref)),
    ).rejects.toThrow();
    expect(createQuery).not.toHaveBeenCalled();
    expect(service.getQueryState(def.id)?.saveError).toContain('Bad Name');
  });

  it('shows the server validation reason instead of the generic message', async () => {
    const err = new HttpErrorResponse({
      status: 400,
      error: { error: { message: 'body must not contain a secret' } },
    });
    const service = setup(cloud, { saveRevision: () => throwError(() => err) });
    await expect(
      firstValueFrom(service.saveQuery(newState(service), cloud)),
    ).rejects.toBe(err);
    const message = service.getQueryState(def.id)?.saveError;
    expect(message).toContain('body must not contain a secret.');
    expect(message).not.toContain('not confirmed');
  });

  it('shows the server reason on the legacy path too', async () => {
    const ref = { storeId: 'github.com', projectId: 'owner/repo' };
    const err = new HttpErrorResponse({ status: 400, error: 'bad record' });
    const service = setup(ref, { createQuery: () => throwError(() => err) });
    await expect(
      firstValueFrom(service.saveQuery(newState(service), ref)),
    ).rejects.toBe(err);
    expect(service.getQueryState(def.id)?.saveError).toContain('bad record.');
  });

  it('keeps "not confirmed" for a 5xx, which may have committed', () => {
    expect(
      serverSaveReason(
        new HttpErrorResponse({ status: 502, error: 'Bad Gateway' }),
      ),
    ).toBeUndefined();
    expect(
      serverSaveReason(new HttpErrorResponse({ status: 400, error: '<html>' })),
    ).toBeUndefined();
    expect(serverSaveReason(new Error('x'))).toBeUndefined();
    expect(
      serverSaveReason(
        new HttpErrorResponse({ status: 422, error: { message: 'Nope.' } }),
      ),
    ).toBe('Nope.');
  });
});
