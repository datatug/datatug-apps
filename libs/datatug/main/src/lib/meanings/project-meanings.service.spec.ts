import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectMeaningsService } from './project-meanings.service';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { ProjectAssetsReadService } from '../services/project/project-assets-read.service';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import type { ProjectMeaningsCatalog } from './project-meanings-contract';

const ref = { storeId: 'firestore', spaceID: 's1', projectId: 'p1' };
const catalog: ProjectMeaningsCatalog = {
  version: 1,
  scope: { storage: 'firestore', spaceID: 's1', project: 'p1' },
  revision: 'revision',
  writable: true,
  referencesComplete: true,
  entities: [],
};
const write = {
  operationId: 'operation-id',
  ifMatch: 'revision',
  change: {
    action: 'add-entity' as const,
    conceptId: 'customer',
    name: 'Customer',
    description: 'A buyer',
  },
};
describe('project meanings durable provider and public reads', () => {
  const api = {
    meaningsCatalog: vi.fn(),
    changeMeaning: vi.fn(),
    meaningScope: vi.fn(),
  };
  const github = {
    getQueriesFolder: vi.fn(),
    listDirectory: vi.fn(),
    getRawJson: vi.fn(),
  };
  const assets = { boards: vi.fn(), board: vi.fn() };
  beforeEach(() => {
    vi.resetAllMocks();
    api.meaningScope.mockImplementation((value: typeof ref) =>
      value.storeId === 'firestore'
        ? {
            storage: 'firestore',
            spaceID: value.spaceID,
            project: value.projectId,
          }
        : { storage: 'github.com', project: 'repo@owner@datatug' },
    );
    api.meaningsCatalog.mockReturnValue(of(catalog));
    api.changeMeaning.mockReturnValue(
      of({ receipt: write.operationId, catalog }),
    );
    github.getQueriesFolder.mockReturnValue(of({ id: '~', items: [] }));
    github.listDirectory.mockReturnValue(of([]));
    assets.boards.mockReturnValue(of([]));
    TestBed.configureTestingModule({
      providers: [
        ProjectMeaningsService,
        { provide: ProjectQueryApiService, useValue: api },
        { provide: GithubProjectReaderService, useValue: github },
        { provide: ProjectAssetsReadService, useValue: assets },
      ],
    });
  });
  it('uses the selected shared project only and propagates provider persistence failure', async () => {
    const service = TestBed.inject(ProjectMeaningsService);
    expect(await firstValueFrom(service.catalog(ref))).toEqual(catalog);
    expect(api.meaningsCatalog).toHaveBeenCalledWith(ref);
    api.changeMeaning.mockReturnValue(throwError(() => new Error('network')));
    await expect(firstValueFrom(service.change(ref, write))).rejects.toThrow(
      'network',
    );
  });
  it('refuses another project catalog and an unverified mutation receipt', async () => {
    const service = TestBed.inject(ProjectMeaningsService);
    api.meaningsCatalog.mockReturnValue(
      of({ ...catalog, scope: { ...catalog.scope, project: 'other' } }),
    );
    await expect(firstValueFrom(service.catalog(ref))).rejects.toThrow(
      'another project',
    );
    api.changeMeaning.mockReturnValue(
      of({ receipt: 'another-operation', catalog }),
    );
    await expect(firstValueFrom(service.change(ref, write))).rejects.toThrow(
      'receipt',
    );
  });
  it('keeps public project immutable and treats an absent standalone file as absent', async () => {
    const service = TestBed.inject(ProjectMeaningsService),
      publicRef = { storeId: 'github.com', projectId: 'repo@owner@datatug' };
    const value = await firstValueFrom(service.catalog(publicRef));
    expect(value.writable).toBe(false);
    expect(github.getRawJson).not.toHaveBeenCalled();
    await expect(
      firstValueFrom(service.change(publicRef, write)),
    ).rejects.toThrow('editable');
    expect(api.changeMeaning).not.toHaveBeenCalled();
  });
  it('does not hide an unreadable or malformed listed standalone file as an empty catalog', async () => {
    const service = TestBed.inject(ProjectMeaningsService),
      publicRef = { storeId: 'github.com', projectId: 'repo@owner@datatug' };
    github.listDirectory.mockReturnValue(
      of([{ name: 'datatug-meanings.json', type: 'file' }]),
    );
    github.getRawJson.mockReturnValue(
      throwError(() => new Error('provider down')),
    );
    await expect(firstValueFrom(service.catalog(publicRef))).rejects.toThrow(
      'provider down',
    );
    github.getRawJson.mockReturnValue(of(undefined));
    await expect(firstValueFrom(service.catalog(publicRef))).rejects.toThrow(
      'invalid',
    );
  });
  it('pins an unqualified local mutation route to provider catalog scope', () => {
    const service = TestBed.inject(ProjectMeaningsService);
    expect(
      service.refForCatalog(
        { storeId: 'localhost:8989', projectId: 'local-project' },
        {
          ...catalog,
          scope: { storage: 'local', project: 'local-project', branch: 'work' },
        },
      ),
    ).toEqual({
      storeId: 'localhost:8989',
      projectId: 'local-project',
      projectApi: 'local',
      branch: 'work',
    });
  });
});
