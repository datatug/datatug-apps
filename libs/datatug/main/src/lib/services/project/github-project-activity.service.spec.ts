import { HttpParams } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { SneatApiService } from '@sneat/api';
import { BehaviorSubject, Subject, firstValueFrom, of } from 'rxjs';
import { IProjectRef } from '../../core/project-context';
import { SneatAuthStateService } from '@sneat/auth-core';
import { ProjectContextService } from './project-context.service';
import { ProjectQueryApiService } from './project-query-api.service';
import { GitHubProjectActivityService } from './github-project-activity.service';

describe('GitHubProjectActivityService', () => {
  const ref: IProjectRef = {
    storeId: 'github.com',
    projectId: 'owner/repo',
    projectApi: 'cloud',
    branch: 'main',
  };
  const scope = { spaceID: 'business_space', projectID: 'shared_project' };
  const authState = new BehaviorSubject({
    status: 'authenticated',
    user: { uid: 'actor-one' },
  });
  const capabilities = vi.fn();
  const get = vi.fn();
  const post = vi.fn();

  let projects: ProjectContextService;
  let expiresAtUTC: string;

  beforeEach(() => {
    vi.clearAllMocks();
    authState.next({ status: 'authenticated', user: { uid: 'actor-one' } });
    TestBed.configureTestingModule({
      providers: [
        GitHubProjectActivityService,
        ProjectContextService,
        {
          provide: SneatAuthStateService,
          useValue: { authState: authState.asObservable() },
        },
        { provide: ProjectQueryApiService, useValue: { capabilities } },
        { provide: SneatApiService, useValue: { get, post } },
      ],
    });
    projects = TestBed.inject(ProjectContextService);
    projects.setCurrent(ref);
    expiresAtUTC = new Date(Date.now() + 60_000).toISOString();
    capabilities.mockReturnValue(of({ activityScope: scope }));
    get.mockReturnValue(of({ contextID: 'server-context', expiresAtUTC }));
    post.mockReturnValue(of({ accepted: true, coalesced: false }));
  });

  it('recovers server scope after reload and reports only its server-issued context', async () => {
    const service = TestBed.inject(GitHubProjectActivityService);
    const session = await firstValueFrom(service.resolve(ref));
    if (!session) throw new Error('Expected an activity session');
    expect(session).toEqual({
      project: ref,
      scope,
      context: { contextID: 'server-context', expiresAtUTC },
    });
    expect(capabilities).toHaveBeenCalledWith(ref);
    expect(get).toHaveBeenCalledWith(
      'datatug/projects/query_activity_context',
      expect.any(HttpParams),
    );
    const getParams = get.mock.calls[0][1] as HttpParams;
    expect(getParams.get('storage')).toBe('firestore');
    expect(getParams.get('spaceID')).toBe(scope.spaceID);
    expect(getParams.get('project')).toBe(scope.projectID);

    await firstValueFrom(
      service.report(session, 'stable-operation-id', 'query_execution_dispatched'),
    );
    expect(post).toHaveBeenCalledWith(
      'datatug/projects/query_activity_report',
      {
        contextID: 'server-context',
        operationID: 'stable-operation-id',
        kind: 'query_execution_dispatched',
      },
      { params: expect.any(HttpParams) },
    );
    const reportParams = post.mock.calls[0][2].params as HttpParams;
    expect(reportParams.get('storage')).toBe('firestore');
    expect(reportParams.get('spaceID')).toBe(scope.spaceID);
    expect(post.mock.calls[0][1]).not.toHaveProperty('actorID');
  });

  it('does not request or invent usage when capabilities omit Business scope', async () => {
    capabilities.mockReturnValueOnce(of({}));
    const service = TestBed.inject(GitHubProjectActivityService);
    await expect(firstValueFrom(service.resolve(ref))).resolves.toBeUndefined();
    expect(get).not.toHaveBeenCalled();
    await expect(firstValueFrom(service.current)).resolves.toBeUndefined();
  });

  it('refreshes an expired server context before reporting activity', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const firstExpiry = new Date(now + 1_000).toISOString();
      get.mockReturnValueOnce(
        of({ contextID: 'expired-context', expiresAtUTC: firstExpiry }),
      );
      const service = TestBed.inject(GitHubProjectActivityService);
      await firstValueFrom(service.resolve(ref));

      clock.mockReturnValue(now + 2_000);
      const refreshedExpiry = new Date(now + 60_000).toISOString();
      get.mockReturnValueOnce(
        of({ contextID: 'refreshed-context', expiresAtUTC: refreshedExpiry }),
      );
      await firstValueFrom(
        service.reportForCurrentProject(ref, 'stable-operation-id', 'query_edit'),
      );

      expect(get).toHaveBeenCalledTimes(2);
      expect(post).toHaveBeenCalledWith(
        'datatug/projects/query_activity_report',
        {
          contextID: 'refreshed-context',
          operationID: 'stable-operation-id',
          kind: 'query_edit',
        },
        { params: expect.any(HttpParams) },
      );
    } finally {
      clock.mockRestore();
    }
  });

  it('rejects non-GitHub or metadata-only refs before reading capabilities', async () => {
    const service = TestBed.inject(GitHubProjectActivityService);
    await expect(
      firstValueFrom(
        service.resolve({ storeId: 'firestore', projectId: 'p', spaceID: 's' }),
      ),
    ).rejects.toThrow('current authenticated GitHub project');
    await expect(
      firstValueFrom(
        service.resolve({ ...ref, spaceID: scope.spaceID }),
      ),
    ).rejects.toThrow('current authenticated GitHub project');
    expect(capabilities).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('drops a late capability response after the project changes', async () => {
    const contextResponse = new Subject<unknown>();
    get.mockReturnValueOnce(contextResponse.asObservable());
    const service = TestBed.inject(GitHubProjectActivityService);
    const resolved = firstValueFrom(service.resolve(ref));
    await Promise.resolve();
    projects.setCurrent({
      storeId: 'github.com',
      projectId: 'owner/other',
      projectApi: 'cloud',
      branch: 'main',
    });
    contextResponse.next({
      contextID: 'old-project-context',
      expiresAtUTC,
    });
    contextResponse.complete();
    await expect(resolved).resolves.toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });

  it('invalidates an issued session when the authenticated actor changes', async () => {
    const service = TestBed.inject(GitHubProjectActivityService);
    const session = await firstValueFrom(service.resolve(ref));
    if (!session) throw new Error('Expected an activity session');
    authState.next({ status: 'authenticated', user: { uid: 'actor-two' } });
    await expect(
      firstValueFrom(
        service.report(session, 'another-operation-id', 'query_edit'),
      ),
    ).rejects.toThrow('no longer current');
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses malformed capability scope before issuing an activity context', async () => {
    capabilities.mockReturnValueOnce(
      of({ activityScope: { spaceID: 'valid', projectID: 'bad/id' } }),
    );
    const service = TestBed.inject(GitHubProjectActivityService);
    await expect(firstValueFrom(service.resolve(ref))).rejects.toThrow(
      'activity scope could not be verified',
    );
    expect(get).not.toHaveBeenCalled();
  });
});
