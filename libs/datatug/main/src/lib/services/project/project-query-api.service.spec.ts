import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpParams } from '@angular/common/http';
import { SneatApiService } from '@sneat/api';
import { readGithubProjectId } from '@datatug/project-address';
import { of, firstValueFrom, throwError } from 'rxjs';
import { ProjectQueryApiService } from './project-query-api.service';
import { toProjectQueryWire } from '../../queries/project-query-contract';
import { createHostedDemoDbQuery } from '../../queries/hosted-demo-db-query';

describe('ProjectQueryApiService', () => {
  const api = {
    get: vi.fn((...args: unknown[]) => {
      void args;
      return of({});
    }),
    post: vi.fn((...args: unknown[]) => {
      void args;
      return of({});
    }),
  };
  const http = {
    get: vi.fn((...args: unknown[]) => {
      void args;
      return of({});
    }),
    post: vi.fn((...args: unknown[]) => {
      void args;
      return of({});
    }),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        ProjectQueryApiService,
        { provide: SneatApiService, useValue: api },
        { provide: HttpClient, useValue: http },
      ],
    });
  });
  it('routes GitHub reads/saves through authenticated Cloud API with flat scope and no provider fallback', async () => {
    const service = TestBed.inject(ProjectQueryApiService);
    const ref = {
      storeId: 'github.com',
      projectId: 'repo@owner@datatug@working',
    };
    await firstValueFrom(service.read(ref, 'folder/q', 'working'));
    const params = api.get.mock.calls[0][1] as HttpParams;
    expect(api.get.mock.calls[0][0]).toBe('datatug/queries/query_revision');
    expect(params.get('storage')).toBe('github.com');
    expect(params.get('project')).toBe('repo@owner@datatug');
    expect(params.get('branch')).toBe('working');
    await firstValueFrom(
      service.save(ref, {
        operationId: 'stable-retry-id',
        branch: 'working',
        expectedBranchHead: 'head',
        ifNoneMatch: true,
        query: toProjectQueryWire(createHostedDemoDbQuery('q')),
      }),
    );
    expect(api.post.mock.calls[0][0]).toBe('datatug/queries/save_query');
    expect(api.post.mock.calls[0][1]).toMatchObject({
      storage: 'github.com',
      project: 'repo@owner@datatug',
      operationId: 'stable-retry-id',
      ifNoneMatch: true,
    });
    expect(http.get).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });
  it.each([
    ['Repo@Owner@datatug@working', 'repo@owner@datatug', 'datatug'],
    ['Repo@Owner@datatug@HEAD', 'repo@owner@datatug', 'datatug'],
    ['Repo@Owner@@working', 'repo@owner@', ''],
    [
      'Repo@Owner@Folder/Nested@working',
      'repo@owner@Folder/Nested',
      'Folder/Nested',
    ],
  ])(
    'projects %s into a canonical API scope with branch separate',
    async (projectId, canonical, folder) => {
      const service = TestBed.inject(ProjectQueryApiService);
      await firstValueFrom(
        service.read(
          { storeId: 'github.com', projectId },
          'q',
          'selected-branch',
        ),
      );
      const params = api.get.mock.calls[0][1] as HttpParams;
      expect(params.get('project')).toBe(canonical);
      expect(params.get('branch')).toBe('selected-branch');
      expect(readGithubProjectId(params.get('project'))).toEqual({
        ok: true,
        id: { repo: 'repo', org: 'owner', folder },
      });
    },
  );
  it.each([
    'my project',
    'é',
    '.hidden',
    'a'.repeat(129),
    'a'.repeat(128) + '/' + 'b'.repeat(128),
  ])(
    'refuses unsupported API folder %j through observable errors before GET or save',
    async (folder) => {
      const service = TestBed.inject(ProjectQueryApiService);
      const ref = { storeId: 'github.com', projectId: 'repo@owner@' + folder };
      await expect(firstValueFrom(service.read(ref, 'q'))).rejects.toThrow(
        'Invalid GitHub project API key',
      );
      await expect(
        firstValueFrom(
          service.save(ref, {
            operationId: 'op',
            query: toProjectQueryWire(createHostedDemoDbQuery('q')),
          }),
        ),
      ).rejects.toThrow('Invalid GitHub project API key');
      expect(api.get).not.toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();
    },
  );
  it('uses the exact local CLI prefix and local storage envelope', async () => {
    const service = TestBed.inject(ProjectQueryApiService);
    const ref = { storeId: 'http-localhost:8989', projectId: 'local-project' };
    await firstValueFrom(service.read(ref, 'q', 'work'));
    expect(http.get.mock.calls[0][0]).toBe(
      'http://localhost:8989/datatug/queries/query_revision',
    );
    expect(
      (http.get.mock.calls[0][1] as { params: HttpParams }).params.get(
        'storage',
      ),
    ).toBe('local');
    await firstValueFrom(
      service.save(ref, {
        operationId: 'op',
        branch: 'work',
        expectedBranchHead: 'head',
        ifMatch: 'revision',
        query: toProjectQueryWire(createHostedDemoDbQuery('q')),
      }),
    );
    expect(http.post.mock.calls[0][0]).toBe(
      'http://localhost:8989/datatug/queries/save_query',
    );
    expect(api.post).not.toHaveBeenCalled();
  });
  it('refuses metadata-only shared refs before any network request', async () => {
    await expect(
      firstValueFrom(
        TestBed.inject(ProjectQueryApiService).read(
          { storeId: 'firestore', projectId: 'q', spaceID: 'space' },
          'query',
        ),
      ),
    ).rejects.toThrow('metadata-only');
    expect(api.get).not.toHaveBeenCalled();
    expect(http.get).not.toHaveBeenCalled();
  });
});

it('emits explicit private read authority denial without treating a network failure as revocation', async () => {
  TestBed.resetTestingModule();
  const get = vi.fn(() => throwError(() => ({ status: 0 })));
  TestBed.configureTestingModule({
    providers: [
      ProjectQueryApiService,
      { provide: SneatApiService, useValue: { get } },
      { provide: HttpClient, useValue: {} },
    ],
  });
  const service = TestBed.inject(ProjectQueryApiService);
  const ref = {
    storeId: 'github.com',
    projectId: 'repo@owner@folder',
    projectApi: 'cloud' as const,
    branch: 'work',
  };
  const denied: unknown[] = [];
  service.authorityDenied.subscribe((value) => denied.push(value));
  await expect(firstValueFrom(service.summary(ref))).rejects.toMatchObject({
    status: 0,
  });
  expect(denied).toEqual([]);
  get.mockImplementation(() => throwError(() => ({ status: 403 })));
  await expect(firstValueFrom(service.summary(ref))).rejects.toMatchObject({
    status: 403,
  });
  expect(denied).toEqual([ref]);
});
