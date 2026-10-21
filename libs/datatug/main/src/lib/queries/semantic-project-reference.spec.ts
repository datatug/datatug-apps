import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { prepareLocalMeaningSave } from './semantic-project-reference';
import { QueryType } from '../models/definition/query-def';
import type { ProjectMeaningsCatalog } from '../meanings/project-meanings-contract';
const ref = { storeId: 'localhost:8989', projectId: 'p1' };
const pinned = { ...ref, projectApi: 'local' as const, branch: 'work' };
const catalog: ProjectMeaningsCatalog = {
  version: 1,
  scope: { storage: 'local', project: 'p1', branch: 'work' },
  revision: 'catalog-revision',
  writable: true,
  referencesComplete: true,
  entities: [],
};
const definition = {
  id: 'buyers',
  title: 'Buyers',
  request: {
    queryType: QueryType.SQL,
    text: 'SELECT CustomerId FROM Customer',
  },
};
const wire = {
  id: 'buyers',
  folderPath: '~',
  title: 'Buyers',
  type: QueryType.SQL,
  text: 'SELECT CustomerId FROM Customer',
};
describe('canonical meanings on legacy local query views', () => {
  it('admits an unchanged full definition and pins provider branch/revision', async () => {
    const queries = {
      getRevision: vi.fn(() =>
        of({ query: wire, revision: 'query-r1', branchHead: 'head' }),
      ),
    };
    const meanings = {
      catalog: vi.fn(() => of(catalog)),
      refForCatalog: vi.fn(() => pinned),
    };
    expect(
      await prepareLocalMeaningSave(
        queries,
        meanings,
        ref,
        'buyers',
        definition,
      ),
    ).toEqual({ ref: pinned, revision: 'query-r1', branchHead: 'head' });
    expect(queries.getRevision).toHaveBeenCalledWith(pinned, 'buyers');
  });
  it.each(['changed', 'unsupported', 'missing-revision'])(
    'refuses %s saved definition before establishing a canonical save context',
    async (reason) => {
      const queries = {
        getRevision: vi.fn(() =>
          of({
            query: {
              ...wire,
              text: reason === 'changed' ? 'SELECT Changed' : wire.text,
            },
            revision: reason === 'missing-revision' ? '' : 'query-r1',
            saveSupported: reason !== 'unsupported',
          }),
        ),
      };
      const meanings = {
        catalog: vi.fn(() => of(catalog)),
        refForCatalog: vi.fn(() => pinned),
      };
      await expect(
        prepareLocalMeaningSave(queries, meanings, ref, 'buyers', definition),
      ).rejects.toThrow('saved query changed');
    },
  );
});
