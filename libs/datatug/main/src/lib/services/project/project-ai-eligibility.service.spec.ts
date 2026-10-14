import { TestBed } from '@angular/core/testing';
import { HttpParams } from '@angular/common/http';
import { SneatApiService } from '@sneat/api';
import { firstValueFrom, of } from 'rxjs';
import { IProjectRef } from '../../core/project-context';
import { ProjectQueryApiService } from './project-query-api.service';
import { ProjectAIEligibilityService } from './project-ai-eligibility.service';

describe('ProjectAIEligibilityService', () => {
  const get = vi.fn();
  const capabilities = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        ProjectAIEligibilityService,
        { provide: SneatApiService, useValue: { get } },
        { provide: ProjectQueryApiService, useValue: { capabilities } },
      ],
    });
  });

  it('reads a fresh nested entitlement from registered GitHub cloud capabilities', async () => {
    const ref: IProjectRef = {
      storeId: 'github.com',
      projectId: 'owner/repo',
      projectApi: 'cloud',
      branch: 'main',
    };
    capabilities.mockReturnValueOnce(of({ projectAI: { aiAllowed: true } }));
    await expect(
      firstValueFrom(TestBed.inject(ProjectAIEligibilityService).read(ref)),
    ).resolves.toEqual({ aiAllowed: true });
    expect(capabilities).toHaveBeenCalledWith(ref);
    expect(get).not.toHaveBeenCalled();
  });

  it('uses the authenticated Space eligibility endpoint for Firestore projects', async () => {
    const ref: IProjectRef = {
      storeId: 'firestore',
      projectId: 'project_1',
      spaceID: 'space_1',
    };
    get.mockReturnValueOnce(
      of({ aiAllowed: false, reason: 'sponsor_expired' }),
    );
    await expect(
      firstValueFrom(TestBed.inject(ProjectAIEligibilityService).read(ref)),
    ).resolves.toEqual({ aiAllowed: false, reason: 'sponsor_expired' });
    expect(get).toHaveBeenCalledWith(
      'datatug/projects/ai_eligibility',
      expect.any(HttpParams),
    );
    const params = get.mock.calls[0][1] as HttpParams;
    expect(params.get('storage')).toBe('firestore');
    expect(params.get('spaceID')).toBe('space_1');
    expect(params.get('project')).toBe('project_1');
  });

  it('rejects missing and malformed authority instead of guessing access', async () => {
    const service = TestBed.inject(ProjectAIEligibilityService);
    const ref: IProjectRef = {
      storeId: 'github.com',
      projectId: 'owner/repo',
      projectApi: 'cloud',
      branch: 'main',
    };
    capabilities.mockReturnValueOnce(of({ projectAI: {} }));
    await expect(firstValueFrom(service.read(ref))).rejects.toThrow(
      'Project AI access could not be verified.',
    );
    capabilities.mockReturnValueOnce(of({ projectAI: { aiAllowed: 'true' } }));
    await expect(firstValueFrom(service.read(ref))).rejects.toThrow(
      'Project AI access could not be verified.',
    );
    expect(get).not.toHaveBeenCalled();
  });
});
