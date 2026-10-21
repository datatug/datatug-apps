import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { QuickSearchSnapshotService } from './quick-search-snapshot.service';
import { QuickSearchApiService } from './quick-search-api.service';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { ProjectService } from '../services/project/project.service';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { QueriesService } from '../queries/queries.service';

const ref = {
  storeId: 'github.com',
  projectId: 'repo@owner@folder',
  branch: 'feature',
};
function setup(
  raw: unknown = {
    id: 'check-a',
    title: 'Check A',
    tags: ['customers'],
    steps: [{ query: 'private SQL' }],
    description: 'private description',
  },
  statuses = [
    { audience: 'public', eligible: true },
    { audience: 'public', eligible: true },
  ],
) {
  let epoch = 0;
  const status = vi.fn(() =>
    of(statuses.shift() || { audience: 'private', eligible: false }),
  );
  const getRawJson = vi.fn(() => of(raw));
  TestBed.configureTestingModule({
    providers: [
      { provide: QuickSearchApiService, useValue: { status } },
      {
        provide: GithubProjectReaderService,
        useValue: {
          readInfo: () => of({ commit: 'a'.repeat(40) }),
          visitEpoch: () => String(epoch),
          getRawJson,
        },
      },
      { provide: ProjectService, useValue: {} },
      { provide: ProjectQueryApiService, useValue: {} },
      { provide: QueriesService, useValue: {} },
    ],
  });
  return {
    service: TestBed.inject(QuickSearchSnapshotService),
    status,
    getRawJson,
    move: () => epoch++,
  };
}
describe('public Check metadata fallback', () => {
  it('projects only exact metadata after fresh public eligibility before and after the pinned read', async () => {
    const { service, status, getRawJson } = setup();
    const doc = await service.publicCheckMetadata(ref, 'check-a');
    expect(doc).toEqual({
      kind: 'check',
      id: 'check-a',
      name: 'Check A',
      tags: ['customers'],
      reference: { objectId: 'check-a' },
    });
    expect(getRawJson).toHaveBeenCalledExactlyOnceWith(
      'repo@owner@folder@feature',
      'checks/check-a.json',
    );
    expect(status).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(doc)).not.toMatch(
      /private SQL|private description|steps/,
    );
  });
  it('does not read raw source for private scope or revoked public eligibility', async () => {
    const { service, getRawJson } = setup(undefined, [
      { audience: 'private', eligible: false },
    ]);
    await expect(service.publicCheckMetadata(ref, 'check-a')).rejects.toThrow();
    expect(getRawJson).not.toHaveBeenCalled();
    await expect(
      service.publicCheckMetadata({ ...ref, projectApi: 'cloud' }, 'check-a'),
    ).rejects.toThrow();
  });
  it('suppresses a snapshot if project becomes private after the source read', async () => {
    const { service } = setup(undefined, [
      { audience: 'public', eligible: true },
      { audience: 'private', eligible: false },
    ]);
    await expect(service.publicCheckMetadata(ref, 'check-a')).rejects.toThrow();
  });
  it.each([
    [],
    { id: 'other' },
    { id: 'check-a', tags: null },
    { id: 'check-a', title: 4 },
  ])('rejects malformed or mismatched object %j', async (raw) => {
    await expect(
      setup(raw).service.publicCheckMetadata(ref, 'check-a'),
    ).rejects.toThrow();
  });
  it('does not start a source read if the target changes during the eligibility request', async () => {
    const { service, status, getRawJson } = setup();
    const pending = new Subject<{ audience: string; eligible: boolean }>();
    status.mockReturnValue(pending);
    let current = true;
    const read = service.publicCheckMetadata(ref, 'check-a', () => current);
    current = false;
    pending.next({ audience: 'public', eligible: true });
    await expect(read).rejects.toThrow();
    expect(getRawJson).not.toHaveBeenCalled();
  });
  it('rejects a visit epoch change during the read', async () => {
    const { service, getRawJson, move } = setup();
    getRawJson.mockImplementation(() => {
      move();
      return of({ id: 'check-a' });
    });
    await expect(service.publicCheckMetadata(ref, 'check-a')).rejects.toThrow(
      'changed during read',
    );
  });
});
