import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpParams } from '@angular/common/http';
import { SneatApiService } from '@sneat/api';
import { of, firstValueFrom } from 'rxjs';
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
