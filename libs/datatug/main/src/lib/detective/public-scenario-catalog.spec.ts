import { TestBed } from '@angular/core/testing';
import { of, firstValueFrom } from 'rxjs';
import { DEMO_PROJECT_REF } from '@datatug/project-address';
import { IProjectRef } from '../core/project-context';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import {
  InvalidPublicScenarioError,
  PublicScenarioCatalogService,
  PublicScenarioNotFoundError,
  isCanonicalPublicDemo,
  readPublicScenario,
} from './public-scenario-catalog';

function createService(github: unknown) {
  TestBed.configureTestingModule({
    providers: [{ provide: GithubProjectReaderService, useValue: github }],
  });
  return TestBed.runInInjectionContext(
    () => new PublicScenarioCatalogService(),
  );
}

const scenario = {
  id: 'chinook-customer-coverage-walkthrough',
  title: 'Review customer coverage',
  description: 'Follow the saved query and its Check.',
  version: 1,
  inputs: [],
  steps: [
    {
      id: 'inventory',
      kind: 'query',
      ref: 'demodb/chinook-customer-inventory',
    },
    { id: 'coverage', kind: 'check', ref: 'chinook-customer-coverage' },
  ],
};

describe('public Scenario catalog', () => {
  it('admits only the exact canonical GitHub demo reference', () => {
    expect(isCanonicalPublicDemo(DEMO_PROJECT_REF)).toBe(true);
    expect(
      isCanonicalPublicDemo({ ...DEMO_PROJECT_REF, storeId: 'firestore' }),
    ).toBe(false);
    expect(
      isCanonicalPublicDemo({ ...DEMO_PROJECT_REF, projectId: 'other@demo' }),
    ).toBe(false);
    expect(
      isCanonicalPublicDemo({
        ...DEMO_PROJECT_REF,
        branch: 'feature',
      } as IProjectRef),
    ).toBe(false);
    expect(
      isCanonicalPublicDemo({
        ...DEMO_PROJECT_REF,
        projectApi: 'local',
      } as IProjectRef),
    ).toBe(false);
    expect(
      isCanonicalPublicDemo({ ...DEMO_PROJECT_REF, spaceID: 'private-space' }),
    ).toBe(false);
  });

  it('validates ids, versions, inputs, and link-safe step refs before rendering', () => {
    expect(readPublicScenario(scenario, scenario.id)).toEqual(scenario);
    expect(readPublicScenario({ ...scenario, id: 'other' }, scenario.id)).toBe(
      undefined,
    );
    expect(readPublicScenario({ ...scenario, version: 0 }, scenario.id)).toBe(
      undefined,
    );
    expect(
      readPublicScenario(
        {
          ...scenario,
          steps: [{ id: 'bad', kind: 'query', ref: '../private' }],
        },
        scenario.id,
      ),
    ).toBeUndefined();
    expect(
      readPublicScenario(
        {
          ...scenario,
          inputs: [{ name: 'x', type: 'script', cardinality: 'scalar' }],
        },
        scenario.id,
      ),
    ).toBeUndefined();
    expect(
      readPublicScenario(
        {
          ...scenario,
          steps: [{ id: 'link', kind: 'query', ref: 'https://evil.test' }],
        },
        scenario.id,
      ),
    ).toBeUndefined();
    expect(
      readPublicScenario(
        {
          ...scenario,
          steps: [{ id: 'link', kind: 'check', ref: '../outside' }],
        },
        scenario.id,
      ),
    ).toBeUndefined();
    expect(
      readPublicScenario(scenario, `${scenario.id}?redirect=https://evil.test`),
    ).toBeUndefined();
  });

  it('loads only JSON files from the public demo Scenarios directory', async () => {
    const github = {
      listDirectory: vi.fn(() =>
        of([
          { name: 'README.md', path: 'scenarios/README.md', type: 'file' },
          {
            name: `${scenario.id}.json`,
            path: `scenarios/${scenario.id}.json`,
            type: 'file',
          },
          { name: 'drafts', path: 'scenarios/drafts', type: 'dir' },
        ]),
      ),
      getRawJson: vi.fn(() => of(scenario)),
    };
    const service = createService(github);

    await expect(
      firstValueFrom(service.list(DEMO_PROJECT_REF)),
    ).resolves.toEqual([scenario]);
    expect(github.listDirectory).toHaveBeenCalledWith(
      DEMO_PROJECT_REF.projectId,
      'scenarios',
    );
    expect(github.getRawJson).toHaveBeenCalledWith(
      DEMO_PROJECT_REF.projectId,
      `scenarios/${scenario.id}.json`,
      expect.objectContaining({ budget: expect.anything() }),
    );
  });

  it('distinguishes a missing direct link from an invalid Scenario document', async () => {
    const github = {
      getRawJson: vi
        .fn()
        .mockReturnValueOnce(of(null))
        .mockReturnValueOnce(of({ ...scenario, version: 0 })),
    };
    const service = createService(github);
    await expect(
      firstValueFrom(service.get(DEMO_PROJECT_REF, scenario.id)),
    ).rejects.toBeInstanceOf(PublicScenarioNotFoundError);
    await expect(
      firstValueFrom(service.get(DEMO_PROJECT_REF, scenario.id)),
    ).rejects.toBeInstanceOf(InvalidPublicScenarioError);
  });

  it('refuses another project before reading it', () => {
    const github = { listDirectory: vi.fn() };
    const service = createService(github);
    expect(() =>
      service.list({
        ...DEMO_PROJECT_REF,
        projectId: 'private@org',
      } as IProjectRef),
    ).toThrow('only for the canonical DataTug demo');
    expect(github.listDirectory).not.toHaveBeenCalled();
  });
});
