import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import fixture from './fixtures/repository-demo.json';
import { RepositoryMeaningsReaderService } from './repository-meanings-reader.service';
import { ProjectAssetsReadService } from '../services/project/project-assets-read.service';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { PublicDataService } from '../queries/public-data/public-data.service';
import { INITIAL_CANONICAL_PINS } from '../queries/public-data/canonical-metadata';
import { FakeGithub } from '../services/repo/github/github-fake-backend.test';
import {
  GITHUB_FETCH,
  GITHUB_FILE_STORE,
} from '../services/repo/github/github-project-reader.service';
import { NO_GITHUB_FILE_STORE } from '../services/repo/github/github-file-store-api';
import type { ProjectMeaningsCatalog } from './project-meanings-contract';
import { semanticQueryHash } from '../queries/semantic-mapping';

const data = fixture as Record<
  string,
  { revision: string; files: Record<string, string> }
>;
const demo = 'https://github.com/datatug/datatug-demo-project';
function setup(source = data) {
  const gh = new FakeGithub();
  for (const [repository, value] of Object.entries(source))
    gh.addRepo(
      repository.replace('https://github.com/', ''),
      value.revision,
      value.files,
    );
  vi.stubGlobal(
    'fetch',
    function (this: unknown, url: string, init: RequestInit) {
      if (this != null && this !== globalThis)
        throw new TypeError('Illegal invocation');
      return gh.fetch(url, init);
    },
  );
  const files = source[demo].files,
    ids = ['Customer', 'Invoice', 'Country'];
  const assets = {
    entities: vi.fn(() => of(ids.map((id) => ({ id })))),
    entity: vi.fn((_ref, id: string) =>
      of(JSON.parse(files[`demo-project-1/entities/${id}/${id}.entity.json`])),
    ),
    boards: vi.fn(() => of([{ id: 'board1' }])),
    board: vi.fn(() =>
      of({
        ...JSON.parse(files['demo-project-1/boards/board1/board.json']),
        id: 'board1',
      }),
    ),
    environments: vi.fn(() => of([])),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: GITHUB_FETCH, useValue: gh.fetch },
      { provide: GITHUB_FILE_STORE, useValue: NO_GITHUB_FILE_STORE },
      { provide: ProjectAssetsReadService, useValue: assets },
      {
        provide: ProjectQueryApiService,
        useValue: { folder: () => of({ id: '~', items: [] }) },
      },
      {
        provide: PublicDataService,
        useValue: { currentPins: INITIAL_CANONICAL_PINS },
      },
    ],
  });
  const catalog: ProjectMeaningsCatalog = {
    version: 1,
    scope: {
      storage: 'github.com',
      project: 'datatug-demo-project@datatug@demo-project-1',
    },
    revision: 'managed-revision',
    writable: true,
    referencesComplete: true,
    entities: [],
  };
  return {
    service: TestBed.inject(RepositoryMeaningsReaderService),
    gh,
    assets,
    catalog,
  };
}
afterEach(() => vi.unstubAllGlobals());
describe('repository meanings reader with immutable real source fixtures', () => {
  it('pins repository root separately from project folder and verifies registered custom files and legacy inheritance', async () => {
    const { service, gh, catalog } = setup();
    const result = await service.enrich(
      { storeId: 'github.com', projectId: catalog.scope.project },
      catalog,
    );
    expect(
      result.entities.some(
        (entity) =>
          entity.source?.repository === 'https://github.com/meaninggraph/core',
      ),
    ).toBe(true);
    expect(
      result.entities.some(
        (entity) =>
          entity.source?.repository === 'https://github.com/demo-db/chinook',
      ),
    ).toBe(true);
    expect(
      result.entities.some(
        (entity) =>
          entity.source?.repository ===
            'https://github.com/datatug/datatug-meta-iso' &&
          entity.source.revision === '068db7d8fd0a74c341f5a7ac6ed795f491f9db17',
      ),
    ).toBe(true);
    expect(
      result.entities.find((entity) => entity.conceptId === 'Customer')?.source
        ?.path,
    ).toBe('demo-project-1/entities/Customer/Customer.entity.json');
    expect(
      gh
        .urls()
        .some((url) => url.includes('/demo-project-1/demo.meaning.yaml')),
    ).toBe(false);
    expect(
      gh
        .urls()
        .some((url) =>
          url.includes('/ed1dd43027864889f8e887cdac3c505068792f93/index.json'),
        ),
    ).toBe(true);
    expect(gh.urls().some((url) => url.includes('lukes'))).toBe(false);
    expect(result).toMatchObject({
      revision: catalog.revision,
      writable: true,
      referencesComplete: true,
    });
  });
  it('verifies meaning uses of a TugQL query whose structured body is "<id>.query.tugql.yaml" against the declared type (demo#88)', async () => {
    const files = { ...data[demo].files };
    const dir = 'demo-project-1/queries/customers/customer-invoices.query';
    const body = files[`${dir}.dtql`];
    delete files[`${dir}.dtql`];
    files[`${dir}.tugql.yaml`] = body;
    files[`${dir}.json`] = files[`${dir}.json`].replace('"type": "DTQL"', '"type": "TugQL"');
    const def = JSON.parse(files[`${dir}.json`]);
    expect(def.type).toBe('TugQL');
    const hash = await semanticQueryHash('TugQL', body, def.connectionId ?? '', def.federation ?? null);
    const uses = 'demo-project-1/datatug-meaning-uses.json';
    expect(files[uses]).toContain('6a0b28cf717193bf96e3968fd47f9da2d701da156fdec103f3e4f7f0baf928ae');
    files[uses] = files[uses].replaceAll('6a0b28cf717193bf96e3968fd47f9da2d701da156fdec103f3e4f7f0baf928ae', hash);
    const { service, catalog } = setup({ ...data, [demo]: { ...data[demo], files } });
    await expect(
      service.enrich({ storeId: 'github.com', projectId: catalog.scope.project }, catalog),
    ).resolves.toMatchObject({ revision: catalog.revision });
  });

  it('never reads anonymous GitHub for local or cloud-qualified private sources and preserves managed mutation authority', async () => {
    const { service, gh, assets, catalog } = setup();
    assets.entities.mockReturnValue(of([]));
    assets.boards.mockReturnValue(of([]));
    for (const ref of [
      { storeId: 'local', projectId: 'p' },
      {
        storeId: 'github.com',
        projectId: catalog.scope.project,
        projectApi: 'cloud' as const,
      },
    ]) {
      const result = await service.enrich(ref, catalog);
      expect(result).toMatchObject({
        discoveryComplete: false,
        revision: catalog.revision,
        writable: true,
        referencesComplete: true,
      });
    }
    expect(gh.urls()).toEqual([]);
  });
  it.each([
    'https://example.com/secret.json',
    'https://raw.githubusercontent.com/u/r/main/../secret.json',
    'https://raw.githubusercontent.com/u/r/main/file.json?token=secret',
    'https://user@raw.githubusercontent.com/u/r/main/file.json',
  ])(
    'refuses unsupported inherited source %s without fetching it',
    async (url) => {
      const { service, gh, catalog } = setup();
      gh.addRepo('datatug/datatug-demo-project', data[demo].revision, {
        ...data[demo].files,
        'demo-project-1/entities/Country/Country.entity.json': JSON.stringify({
          id: 'Country',
          fields: [],
          extends: { def: url },
        }),
      });
      const result = await service.enrich(
        { storeId: 'github.com', projectId: catalog.scope.project },
        catalog,
      );
      expect(result.discoveryComplete).toBe(false);
      expect(result.notices?.join(' ')).toContain('unsupported source URL');
      expect(gh.urls().some((request) => request.includes('/u/r/'))).toBe(
        false,
      );
    },
  );
});

it('stops raw legacy reads at the aggregate byte budget and retains provider authority', async () => {
  const { service, gh, catalog } = setup();
  gh.addRepo('datatug/datatug-demo-project', data[demo].revision, {
    ...data[demo].files,
    ...Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        `demo-project-1/entities/AAA${i}/AAA${i}.entity.json`,
        ' '.repeat(230 * 1024) + '{"fields":[]}',
      ]),
    ),
  });
  const result = await service.enrich(
    { storeId: 'github.com', projectId: catalog.scope.project },
    catalog,
  );
  expect(result).toMatchObject({
    discoveryComplete: false,
    writable: true,
    referencesComplete: true,
    revision: 'managed-revision',
  });
  expect(result.notices?.join(' ')).toContain('2MiB');
  expect(
    gh
      .urls()
      .some((url) => url.includes('/entities/Customer/Customer.entity.json')),
  ).toBe(false);
});
