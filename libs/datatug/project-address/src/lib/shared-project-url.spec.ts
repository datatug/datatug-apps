import { parseProjectUrl, tryProjectUrl } from './project-url';

describe('Space-qualified metadata addresses', () => {
  const ref = { storeId: 'firestore', spaceID: 'S1', projectId: 'same' };
  it.each([
    '',
    'overview',
    'queries',
    'query/q',
    'checks',
    'checks/invoice-check',
    'detective',
    'detective/invoice-case',
    'detective/scenario/invoice-review',
    'incidents',
    'incidents/new',
    'incidents/detective-incidents-9c561d36/INC-1',
  ])('round trips %s without losing Space ownership', (page) => {
    const url = tryProjectUrl(ref, page);
    expect(url).toBe(
      `/space/S1/store/firestore/project/same${page ? `/${page}` : ''}`,
    );
    expect(parseProjectUrl(url as string)).toMatchObject({
      ok: true,
      ...ref,
    });
  });
  it.each(['query', 'chat', 'env/local', 'boards', 'public-data'])(
    'refuses unsupported %s',
    (page) => {
      expect(tryProjectUrl(ref, page)).toMatchObject({ ok: false });
      expect(
        parseProjectUrl(`/space/S1/store/firestore/project/same/${page}`),
      ).toMatchObject({ ok: false });
    },
  );
  it('keeps a folder-qualified query id as one encoded page segment', () => {
    const url = tryProjectUrl(ref, ['query', 'folder/q']);
    expect(url).toBe('/space/S1/store/firestore/project/same/query/folder%2Fq');
    expect(parseProjectUrl(url as string)).toMatchObject({ ok: true, ...ref });
  });
  it('rejects a raw multi-segment query id that the shared route cannot bind', () => {
    expect(tryProjectUrl(ref, 'query/folder/q')).toMatchObject({
      reason: 'not-representable',
    });
    expect(
      parseProjectUrl('/space/S1/store/firestore/project/same/query/folder/q'),
    ).toMatchObject({
      ok: false,
    });
  });
  it.each(['', '..', 'a/b', '%2F', ' a', 'a?x', 'a#x', 'a\\b'])(
    'refuses malformed Space %s',
    (spaceID) => {
      expect(tryProjectUrl({ ...ref, spaceID })).toMatchObject({ ok: false });
    },
  );
  it.each([
    '/space/S1/store/github.com/project/same',
    '/space/S1/store/firestore/project/%2F',
    '/space/%2F/store/firestore/project/same',
    '/space/S1/store/firestore/project/same/overview/more',
    '/space//store/firestore/project/same',
  ])('refuses malformed cold address %s', (url) => {
    expect(parseProjectUrl(url)).toMatchObject({ ok: false });
  });
  it('keeps private, Git and agent addresses unchanged', () => {
    expect(tryProjectUrl({ storeId: 'firestore', projectId: 'same' })).toBe(
      '/store/firestore/project/same',
    );
    expect(
      tryProjectUrl({ storeId: 'localhost:8989', projectId: 'same' }),
    ).toBe('/store/localhost:8989/project/same');
    expect(
      tryProjectUrl({ storeId: 'github.com', projectId: 'repo@owner@' }),
    ).toBe('/project/github.com/owner/repo');
  });
});
