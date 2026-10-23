import { matchesTags, newTagError, tagCounts } from './tags';
import {
  fromProjectQueryWire,
  toProjectQueryWire,
} from '../queries/project-query-contract';
import { QueryType, ITextQueryRequest } from '../models/definition/query-def';
import { isQueryChanged } from '../queries/query-editor-state-service';
describe('project tags', () => {
  it('counts each exact tag once per item and intersects multiple selections', () => {
    const items = [
      { tags: ['ops', 'ops', 'Ops'] },
      { tags: ['ops', 'prod'] },
      {},
    ];
    expect(tagCounts(items)).toEqual(
      expect.arrayContaining([
        { tag: 'ops', count: 2 },
        { tag: 'Ops', count: 1 },
        { tag: 'prod', count: 1 },
      ]),
    );
    expect(items.filter((item) => matchesTags(item, ['ops', 'prod']))).toEqual([
      items[1],
    ]);
    expect(matchesTags(items[0], ['prod'])).toBe(false);
    expect(matchesTags({}, [])).toBe(true);
  });
  it('validates trimmed duplicates and Core byte-length limits', () => {
    expect(newTagError(' ops ', ['ops'])).toContain('already');
    expect(newTagError(' ', [])).toContain('Enter');
    expect(newTagError('é'.repeat(26), [])).toContain('50');
    expect(newTagError('é'.repeat(25), [])).toBe('');
  });
  it.each([QueryType.SQL, QueryType.DTQL, QueryType.TugQL])(
    'round-trips %s tags and explicit remove-all through the revision save envelope',
    (queryType) => {
      const original = {
        id: 'q',
        title: 'Query',
        tags: ['ops'],
        request: {
          queryType,
          text: 'SELECT 1',
        } as ITextQueryRequest,
      };
      const wire = toProjectQueryWire(original, 'nested/q');
      expect(wire.tags).toEqual(['ops']);
      expect(fromProjectQueryWire({ ...wire })).toEqual(original);
      wire.tags?.push('changed');
      expect(original.tags).toEqual(['ops']);
      expect(toProjectQueryWire({ ...original, tags: [] }).tags).toEqual([]);
      expect(
        isQueryChanged({
          id: 'nested/q',
          queryType,
          def: original,
          title: original.title,
          request: original.request,
          tags: [],
        }),
      ).toBe(true);
      expect(
        isQueryChanged({
          id: 'nested/q',
          queryType,
          def: original,
          title: original.title,
          request: original.request,
          tags: ['ops'],
        }),
      ).toBe(false);
    },
  );
});
