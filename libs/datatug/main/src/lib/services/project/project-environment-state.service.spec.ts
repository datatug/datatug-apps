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
});
