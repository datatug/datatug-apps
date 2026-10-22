import { SneatApiNotAuthenticatedError } from '@sneat/api';
import { SneatAuthStateService } from '@sneat/auth-core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { ProjectEnvironmentStateService } from './project-environment-state.service';
import { ProjectQueryApiService } from './project-query-api.service';

const ref = {
  storeId: 'http-localhost:18989',
  projectId: 'demo',
  projectApi: 'local' as const,
};
const response = {
  contract: 'environment-state/1',
  scope: {
    storeId: 'local',
    projectId: 'demo',
    projectApi: 'local',
    authorityId: 'agent',
  },
  scopeBinding: 'a'.repeat(64),
  revision: 'r1',
  environments: [{ id: 'dev' }, { id: 'prod', title: 'prod' }],
  savedOrder: ['prod', 'dev'],
  order: ['prod', 'dev'],
  needsRepair: false,
  capabilities: {
    canReadOrder: true,
    canWriteOrder: false,
    canCreateEnvironment: false,
  },
};
describe('ProjectEnvironmentStateService scope', () => {
  const api = {
    environmentState: vi.fn(),
    environmentReference: vi.fn(() => ({
      storeId: 'local',
      projectId: 'demo',
      projectApi: 'local',
    })),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectQueryApiService, useValue: api },
        {
          provide: SneatAuthStateService,
          useValue: {
            authState: of({ status: 'authenticated', user: { uid: 'u1' } }),
          },
        },
      ],
    });
  });
  it('validates wire scope while keeping canonical custom order', async () => {
    api.environmentState.mockReturnValue(of(response));
    const result = await firstValueFrom(
      TestBed.inject(ProjectEnvironmentStateService).read(ref),
    );
    expect(result.environments.map((row) => row.id)).toEqual(['prod', 'dev']);
    expect(api.environmentState).toHaveBeenCalledWith(ref);
  });
  it('rejects another authority project qualifier instead of publishing its list', async () => {
    api.environmentState.mockReturnValue(
      of({ ...response, scope: { ...response.scope, projectApi: 'cloud' } }),
    );
    await expect(
      firstValueFrom(TestBed.inject(ProjectEnvironmentStateService).read(ref)),
    ).rejects.toThrow('scope');
  });
  it('does not disguise a missing current endpoint as an old agent', async () => {
    api.environmentState.mockReturnValue(throwError(() => ({ status: 404 })));
    const legacy = vi.fn(() => of([{ id: 'local', title: 'local' }]));
    await expect(
      firstValueFrom(
        TestBed.inject(ProjectEnvironmentStateService).view(ref, legacy),
      ),
    ).rejects.toEqual({ status: 404 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it('keeps explicit unsupported agents readonly', async () => {
    api.environmentState.mockReturnValue(throwError(() => ({ status: 426 })));
    const result = await firstValueFrom(
      TestBed.inject(ProjectEnvironmentStateService).view(ref, () =>
        of([{ id: 'local', title: 'local' }]),
      ),
    );
    expect(result.state).toBeUndefined();
    expect(result.items).toEqual([{ id: 'local', title: 'local' }]);
    expect(result.reason).toContain('Update');
  });
  const github = { storeId: 'github.com', projectId: 'datatug/demo' };
  it.each([
    ['a signed-out visitor', SneatApiNotAuthenticatedError],
    ['a refused visitor', { status: 401 }],
    ['a forbidden visitor', { status: 403 }],
    ['a project the hosted API does not know', { status: 404 }],
  ])(
    'reads a public GitHub project directly for %s, without management state',
    async (_, error) => {
      api.environmentState.mockReturnValue(throwError(() => error));
      const legacy = vi.fn(() => of([{ id: 'dev', title: 'dev' }]));
      const result = await firstValueFrom(
        TestBed.inject(ProjectEnvironmentStateService).view(github, legacy),
      );
      expect(result).toEqual({ items: [{ id: 'dev', title: 'dev' }] });
      expect(legacy).toHaveBeenCalledTimes(1);
    },
  );
  it('still surfaces an outage of the hosted API for a GitHub project', async () => {
    api.environmentState.mockReturnValue(throwError(() => ({ status: 500 })));
    const legacy = vi.fn(() => of([]));
    await expect(
      firstValueFrom(
        TestBed.inject(ProjectEnvironmentStateService).view(github, legacy),
      ),
    ).rejects.toEqual({ status: 500 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it('does not read a cloud-API GitHub project from the repository', async () => {
    api.environmentState.mockReturnValue(
      throwError(() => SneatApiNotAuthenticatedError),
    );
    const legacy = vi.fn(() => of([]));
    await expect(
      firstValueFrom(
        TestBed.inject(ProjectEnvironmentStateService).view(
          { ...github, projectApi: 'cloud' },
          legacy,
        ),
      ),
    ).rejects.toBe(SneatApiNotAuthenticatedError);
    expect(legacy).not.toHaveBeenCalled();
  });
});
