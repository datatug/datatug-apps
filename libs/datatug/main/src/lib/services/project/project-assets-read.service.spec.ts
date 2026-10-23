import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { ProjectEnvironmentStateService } from './project-environment-state.service';
import { map } from 'rxjs';
import { ProjectService } from './project.service';
import { ProjectQueryApiService } from './project-query-api.service';
import { ProjectAssetsReadService } from './project-assets-read.service';
import { GithubProjectReaderService } from '../repo/github/github-project-reader.service';

describe('ProjectAssetsReadService', () => {
  const api = {
    boards: vi.fn(() => of([])),
    board: vi.fn(() => of({})),
    entities: vi.fn(() => of([])),
    entity: vi.fn(() => of({ id: 'x' })),
    environments: vi.fn(() => of([])),
  };
  const full = {
    getFull: vi.fn(() =>
      of({
        environments: [{ id: 'local', title: 'Local' }],
        boards: [{ id: 'working', title: 'Working copy' }],
      }),
    ),
  };
  const github = {
    listDirectory: vi.fn(() => of([{ name: 'b1', type: 'dir' as const }])),
    getBoard: vi.fn(() => of({ id: 'b1' })),
    listEntityIds: vi.fn(() => of(['e1'])),
    getEntity: vi.fn(() =>
      of({ id: 'e1', extends: { def: 'keep' }, options: { sources: [] } }),
    ),
    listEnvironmentIds: vi.fn(() => of(['qa'])),
    getEnvironmentSummary: vi.fn(() =>
      of({
        id: 'qa',
        title: 'QA',
        presentation: { label: 'QA', tone: 'primary' },
        dbServers: [{ id: 'secret' }],
      }),
    ),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        ProjectAssetsReadService,
        {
          provide: ProjectEnvironmentStateService,
          useValue: {
            watch: (
              _ref: unknown,
              legacy: () => import('rxjs').Observable<unknown[]>,
            ) => legacy().pipe(map((items) => ({ items }))),
          },
        },
        { provide: ProjectQueryApiService, useValue: api },
        { provide: ProjectService, useValue: full },
        { provide: GithubProjectReaderService, useValue: github },
      ],
    });
  });

  it('reads unqualified local overview assets from the working copy without a branch probe', async () => {
    const ref = { storeId: 'http-127.0.0.1:44082', projectId: 'demo' };
    const service = TestBed.inject(ProjectAssetsReadService);
    expect(await firstValueFrom(service.boards(ref))).toEqual([
      { id: 'working', title: 'Working copy' },
    ]);
    expect(await firstValueFrom(service.environments(ref))).toEqual([
      { id: 'local', title: 'Local' },
    ]);
    expect(full.getFull).toHaveBeenCalledWith(ref);
    expect(api.boards).not.toHaveBeenCalled();
    expect(api.environments).not.toHaveBeenCalled();
  });

  it('keeps explicitly qualified local reads on the branch-aware API without downgrade', async () => {
    const service = TestBed.inject(ProjectAssetsReadService);
    for (const ref of [
      { storeId: 'localhost:8989', projectId: 'demo', branch: 'topic' },
      {
        storeId: 'localhost:8989',
        projectId: 'demo',
        branch: 'topic',
        projectApi: 'local' as const,
      },
      { storeId: 'firestore', projectId: 'demo' },
    ]) {
      await firstValueFrom(service.boards(ref));
      await firstValueFrom(service.environments(ref));
      expect(api.boards).toHaveBeenCalledWith(ref);
      expect(api.environments).toHaveBeenCalledWith(ref);
    }
    expect(full.getFull).not.toHaveBeenCalled();
    api.boards.mockReturnValueOnce(
      throwError(() => new Error('Branch unavailable')),
    );
    await expect(
      firstValueFrom(
        service.boards({
          storeId: 'localhost:8989',
          projectId: 'demo',
          branch: 'topic',
        }),
      ),
    ).rejects.toThrow('Branch unavailable');
    expect(full.getFull).not.toHaveBeenCalled();
  });

  it('uses branch-qualified GitHub addresses for every public project asset read', async () => {
    const service = TestBed.inject(ProjectAssetsReadService);
    const ref = {
      storeId: 'github.com',
      projectId: 'repo@owner@folder',
      branch: 'topic',
    };
    expect(await firstValueFrom(service.boards(ref))).toEqual([{ id: 'b1' }]);
    expect(await firstValueFrom(service.entities(ref))).toEqual([
      { id: 'e1', title: undefined },
    ]);
    const entity = await firstValueFrom(service.entity(ref, 'e1'));
    expect(entity.extends?.def).toBe('keep');
    expect(entity.options).toEqual({ sources: [] });
    const envs = await firstValueFrom(service.environments(ref));
    expect(envs).toEqual([
      { id: 'qa', title: 'QA', presentation: { label: 'QA', tone: 'primary' } },
    ]);
    expect(JSON.stringify(envs)).not.toContain('secret');
    expect(github.listDirectory).toHaveBeenCalledWith(
      'repo@owner@folder@topic',
      'boards',
    );
    expect(github.getEntity).toHaveBeenCalledWith(
      'repo@owner@folder@topic',
      'e1',
    );
  });

  it('routes cloud-authorized GitHub refs through authenticated fixed endpoints for all asset types', async () => {
    const service = TestBed.inject(ProjectAssetsReadService);
    const ref = {
      storeId: 'github.com',
      projectId: 'repo@owner@folder',
      projectApi: 'cloud' as const,
      branch: 'topic',
    };
    await firstValueFrom(service.boards(ref));
    await firstValueFrom(service.board(ref, 'b1'));
    await firstValueFrom(service.entities(ref));
    await firstValueFrom(service.entity(ref, 'e1'));
    await firstValueFrom(service.environments(ref));
    expect(api.boards).toHaveBeenCalledWith(ref);
    expect(api.board).toHaveBeenCalledWith(ref, 'b1');
    expect(api.entities).toHaveBeenCalledWith(ref);
    expect(api.entity).toHaveBeenCalledWith(ref, 'e1');
    expect(api.environments).toHaveBeenCalledWith(ref);
    expect(github.listDirectory).not.toHaveBeenCalled();
    expect(github.listEntityIds).not.toHaveBeenCalled();
    expect(github.listEnvironmentIds).not.toHaveBeenCalled();
    expect(github.getBoard).not.toHaveBeenCalled();
    expect(github.getEntity).not.toHaveBeenCalled();
    expect(github.getEnvironmentSummary).not.toHaveBeenCalled();
  });

  it('fails closed for malformed or incompatible projectApi qualifiers on every asset read', async () => {
    const service = TestBed.inject(ProjectAssetsReadService);
    const badRefs = [
      {
        storeId: 'github.com',
        projectId: 'repo@owner@folder',
        projectApi: '' as never,
        branch: 'topic',
      },
      {
        storeId: 'github.com',
        projectId: 'repo@owner@folder',
        projectApi: 'bogus' as never,
        branch: 'topic',
      },
      {
        storeId: 'github.com',
        projectId: 'repo@owner@folder',
        projectApi: 'local' as const,
        branch: 'topic',
      },
      {
        storeId: 'github.com',
        projectId: 'repo@owner@folder@old',
        projectApi: 'cloud' as const,
        branch: 'new',
      },
    ];
    for (const ref of badRefs) {
      const outcomes = await Promise.allSettled([
        firstValueFrom(service.boards(ref)),
        firstValueFrom(service.board(ref, 'b1')),
        firstValueFrom(service.entities(ref)),
        firstValueFrom(service.entity(ref, 'e1')),
        firstValueFrom(service.environments(ref)),
      ]);
      expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(
        true,
      );
    }
    expect(api.boards).not.toHaveBeenCalled();
    expect(api.board).not.toHaveBeenCalled();
    expect(api.entities).not.toHaveBeenCalled();
    expect(api.entity).not.toHaveBeenCalled();
    expect(api.environments).not.toHaveBeenCalled();
    expect(github.listDirectory).not.toHaveBeenCalled();
    expect(github.listEntityIds).not.toHaveBeenCalled();
    expect(github.listEnvironmentIds).not.toHaveBeenCalled();
    expect(github.getBoard).not.toHaveBeenCalled();
    expect(github.getEntity).not.toHaveBeenCalled();
    expect(github.getEnvironmentSummary).not.toHaveBeenCalled();
  });

  it('rejects disagreement between separate and address-pinned branches', async () => {
    const service = TestBed.inject(ProjectAssetsReadService);
    const request = service.boards({
      storeId: 'github.com',
      projectId: 'repo@owner@folder@old',
      branch: 'new',
    });
    await expect(firstValueFrom(request)).rejects.toThrow('conflicts');
    expect(github.listDirectory).not.toHaveBeenCalled();
  });

  it('requires an explicit environment for shared Firestore board reads without a fallback', async () => {
    const service = TestBed.inject(ProjectAssetsReadService);
    await expect(
      firstValueFrom(
        service.boards({ storeId: 'firestore', projectId: 'p', spaceID: 's' }),
      ),
    ).rejects.toThrow('Choose an admitted environment');
    expect(api.boards).not.toHaveBeenCalled();
    expect(github.listDirectory).not.toHaveBeenCalled();
  });

  it('whitelists bounded public environment presentation and drops connection data', async () => {
    github.getEnvironmentSummary.mockReturnValue(
      of({
        id: 'qa',
        title: 'Q'.repeat(201),
        presentation: {
          label: 'L'.repeat(121),
          icon: 'x;alert(1)',
          tone: 'dangerous',
        },
        editionConnections: ['private'],
        dbServers: [{ id: 'credential-bearing' }],
      }),
    );
    const envs = await firstValueFrom(
      TestBed.inject(ProjectAssetsReadService).environments({
        storeId: 'github.com',
        projectId: 'repo@owner@folder',
      }),
    );
    expect(envs).toEqual([{ id: 'qa', title: 'qa' }]);
    expect(JSON.stringify(envs)).not.toMatch(/private|credential-bearing/);
  });

  it('caps public asset detail reads and bounds their concurrency', async () => {
    github.listDirectory.mockReturnValue(
      of(
        Array.from({ length: 101 }, (_, i) => ({
          name: `b${i}`,
          type: 'dir' as const,
        })),
      ),
    );
    await expect(
      firstValueFrom(
        TestBed.inject(ProjectAssetsReadService).boards({
          storeId: 'github.com',
          projectId: 'repo@owner@folder',
        }),
      ),
    ).rejects.toThrow('exceeds 100 items');
    expect(github.getBoard).not.toHaveBeenCalled();
  });
});
