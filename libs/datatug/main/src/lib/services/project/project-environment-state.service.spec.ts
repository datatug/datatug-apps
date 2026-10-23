import { SneatApiNotAuthenticatedError } from '@sneat/api';
import { SneatAuthStateService } from '@sneat/auth-core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import {
  FIRST_CONTRACT_VERSION,
  isPreContractVersion,
  ProjectEnvironmentStateService,
} from './project-environment-state.service';
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
    agentInfo: vi.fn(() => of({ version: '0.78.0' })),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    // A test that pins another agent version must not leak it into the next one.
    api.agentInfo.mockReturnValue(of({ version: '0.78.0' }));
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
  it('does not disguise a structured 404 from a current agent as an old agent', async () => {
    const failure = { status: 404, error: { error: { code: 'NOT_FOUND' } } };
    api.environmentState.mockReturnValue(throwError(() => failure));
    const legacy = vi.fn(() => of([{ id: 'local', title: 'local' }]));
    await expect(
      firstValueFrom(
        TestBed.inject(ProjectEnvironmentStateService).view(ref, legacy),
      ),
    ).rejects.toBe(failure);
    expect(legacy).not.toHaveBeenCalled();
  });
  it('keeps a released agent without the route readonly', async () => {
    api.environmentState.mockReturnValue(
      throwError(() => ({ status: 404, error: '404 page not found\n' })),
    );
    const result = await firstValueFrom(
      TestBed.inject(ProjectEnvironmentStateService).view(ref, () =>
        of([{ id: 'local', title: 'local' }]),
      ),
    );
    expect(result.state).toBeUndefined();
    expect(result.items).toEqual([{ id: 'local', title: 'local' }]);
    expect(result.reason).toContain('Update');
  });
  it('keeps a reachable released agent readonly when its CORS-less 404 reaches the browser as status 0', async () => {
    api.environmentState.mockReturnValue(throwError(() => ({ status: 0 })));
    const result = await firstValueFrom(
      TestBed.inject(ProjectEnvironmentStateService).view(ref, () =>
        of([{ id: 'local', title: 'local' }]),
      ),
    );
    expect(api.agentInfo).toHaveBeenCalledWith(ref);
    expect(result.items).toEqual([{ id: 'local', title: 'local' }]);
    expect(result.reason).toContain('Update');
  });
  it('surfaces the real network error when the agent does not answer agent-info either', async () => {
    const failure = {
      status: 0,
      message: 'Http failure response: 0 Unknown Error',
    };
    api.environmentState.mockReturnValue(throwError(() => failure));
    api.agentInfo.mockReturnValueOnce(throwError(() => ({ status: 0 })));
    const legacy = vi.fn(() => of([{ id: 'local', title: 'local' }]));
    await expect(
      firstValueFrom(
        TestBed.inject(ProjectEnvironmentStateService).view(ref, legacy),
      ),
    ).rejects.toBe(failure);
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each([
    ['status 0', { status: 0, message: 'Unknown Error' }],
    ['a plain-text 404', { status: 404, error: '404 page not found\n' }],
  ])('surfaces %s from a contract agent (0.113.0) instead of calling it old', async (_name, failure) => {
    api.environmentState.mockReturnValue(throwError(() => failure));
    api.agentInfo.mockReturnValue(of({ version: '0.113.0' }));
    const legacy = vi.fn(() => of([{ id: 'local', title: 'local' }]));
    await expect(
      firstValueFrom(
        TestBed.inject(ProjectEnvironmentStateService).view(ref, legacy),
      ),
    ).rejects.toBe(failure);
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each([
    ['0.110.1', 'a plain-text 404', { status: 404, error: '404 page not found\n' }],
    ['v0.111.0', 'a plain-text 404', { status: 404, error: '404 page not found\n' }],
    ['0.112.0', 'a plain-text 404', { status: 404, error: '404 page not found\n' }],
    ['0.110.1', 'status 0', { status: 0, message: 'Unknown Error' }],
    ['v0.111.0', 'status 0', { status: 0, message: 'Unknown Error' }],
    ['0.112.0', 'status 0', { status: 0, message: 'Unknown Error' }],
  ])(
    'reads released agent %s answering %s (no environment-state route) as the legacy list',
    async (version, _signal, failure) => {
      api.environmentState.mockReturnValue(throwError(() => failure));
      api.agentInfo.mockReturnValue(of({ version }));
      const result = await firstValueFrom(
        TestBed.inject(ProjectEnvironmentStateService).view(ref, () =>
          of([{ id: 'local', title: 'local' }]),
        ),
      );
      expect(result.state).toBeUndefined();
      expect(result.items).toEqual([{ id: 'local', title: 'local' }]);
      expect(result.reason).toContain('Update');
    },
  );
  it.each(['0.113.0', 'v0.113.1'])(
    'surfaces a plain-text 404 from contract agent %s instead of a legacy read',
    async (version) => {
      const failure = { status: 404, error: '404 page not found\n' };
      api.environmentState.mockReturnValue(throwError(() => failure));
      api.agentInfo.mockReturnValue(of({ version }));
      const legacy = vi.fn(() => of([{ id: 'local', title: 'local' }]));
      await expect(
        firstValueFrom(
          TestBed.inject(ProjectEnvironmentStateService).view(ref, legacy),
        ),
      ).rejects.toBe(failure);
      expect(legacy).not.toHaveBeenCalled();
    },
  );
  it('gates on the first contract release, v0.113.0', () => {
    expect(FIRST_CONTRACT_VERSION).toEqual([0, 113, 0]);
  });
  it.each([
    ['0.78.0', true],
    ['0.110.0', true],
    ['v0.110.1', true],
    ['0.110.2', true],
    ['v0.111.0', true],
    ['0.112.0', true],
    ['0.112.9', true],
    ['0.113.0', false],
    ['v0.113.0', false],
    ['0.113.1', false],
    ['0.114.0', false],
    ['1.0.0', false],
    [undefined, false],
    ['', false],
    ['dev', false],
  ])('isPreContractVersion(%s) is %s', (version, expected) => {
    expect(isPreContractVersion({ version })).toBe(expected);
  });
  it.each([null, {}, { version: 113 }])(
    'treats agent-info %j without a readable version as current',
    (info) => {
      expect(isPreContractVersion(info)).toBe(false);
    },
  );
  it('surfaces a failed legacy read of a reachable agent', async () => {
    api.environmentState.mockReturnValue(throwError(() => ({ status: 0 })));
    const down = { status: 0, message: 'down' };
    await expect(
      firstValueFrom(
        TestBed.inject(ProjectEnvironmentStateService).view(ref, () =>
          throwError(() => down),
        ),
      ),
    ).rejects.toBe(down);
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
  const signIn = 'Sign in to create environments or manage shared order.';
  const noAccess =
    'These environments are read from the public repository. Managing them needs access to this project in DataTug.';
  it.each([
    [
      'github.com',
      'a signed-out visitor',
      SneatApiNotAuthenticatedError,
      signIn,
    ],
    ['github', 'a signed-out visitor', SneatApiNotAuthenticatedError, signIn],
    ['github.com', 'a refused visitor', { status: 401 }, signIn],
    ['github.com', 'a forbidden visitor', { status: 403 }, noAccess],
    [
      'github.com',
      'a project the hosted API does not know',
      { status: 404 },
      noAccess,
    ],
  ])(
    'reads a public %s project directly for %s, without management state',
    async (storeId, _, error, reason) => {
      api.environmentState.mockReturnValue(throwError(() => error));
      const legacy = vi.fn(() => of([{ id: 'dev', title: 'dev' }]));
      const result = await firstValueFrom(
        TestBed.inject(ProjectEnvironmentStateService).view(
          { ...github, storeId },
          legacy,
        ),
      );
      expect(result).toEqual({ items: [{ id: 'dev', title: 'dev' }], reason });
      expect(result.state).toBeUndefined();
      expect(legacy).toHaveBeenCalledTimes(1);
    },
  );
  it.each([{ status: 403 }, { status: 404 }, SneatApiNotAuthenticatedError])(
    'surfaces a private or missing repository instead of an empty list (%s)',
    async (error) => {
      api.environmentState.mockReturnValue(throwError(() => error));
      const notFound = { status: 404, message: 'Not Found' };
      await expect(
        firstValueFrom(
          TestBed.inject(ProjectEnvironmentStateService).view(github, () =>
            throwError(() => notFound),
          ),
        ),
      ).rejects.toBe(notFound);
    },
  );
  it('does not read a shared Space GitHub project from the repository', async () => {
    api.environmentState.mockReturnValue(
      throwError(() => SneatApiNotAuthenticatedError),
    );
    const legacy = vi.fn(() => of([]));
    await expect(
      firstValueFrom(
        TestBed.inject(ProjectEnvironmentStateService).view(
          { ...github, spaceID: 's1' },
          legacy,
        ),
      ),
    ).rejects.toBe(SneatApiNotAuthenticatedError);
    expect(legacy).not.toHaveBeenCalled();
  });
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
