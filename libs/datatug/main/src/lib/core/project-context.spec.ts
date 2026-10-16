import {
  equalProjectRef,
  isValidProjectRef,
  projectRefToString,
} from './project-context';
describe('project scope identity', () => {
  const p = { storeId: 'firestore', projectId: 'same' };
  it('isolates private and two Spaces with identical IDs', () => {
    const refs = [p, { ...p, spaceID: 'S1' }, { ...p, spaceID: 'S2' }];
    expect(new Set(refs.map(projectRefToString)).size).toBe(3);
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++)
        expect(equalProjectRef(refs[a], refs[b])).toBe(a === b);
  });
  it('keys project identity by API, branch, store, project, and Space', () => {
    const refs = [
      { storeId: 'agent', projectId: 'p' },
      { storeId: 'agent', projectId: 'p', branch: 'one' },
      { storeId: 'agent', projectId: 'p', branch: 'two' },
      {
        storeId: 'agent',
        projectId: 'p',
        projectApi: 'local' as const,
        branch: 'one',
      },
      { storeId: 'agent-2', projectId: 'p', branch: 'one' },
    ];
    expect(new Set(refs.map(projectRefToString)).size).toBe(refs.length);
  });
  it('preserves literal predeployment persistence identities', () => {
    expect(projectRefToString({ storeId: 'agent', projectId: 'p' })).toBe(
      'p@agent',
    );
    expect(
      projectRefToString({
        storeId: 'firestore',
        projectId: 'p',
        spaceID: 'S1',
      }),
    ).toBe('["space-project/1","firestore","S1","p"]');
    expect(
      projectRefToString({
        storeId: 'github.com',
        projectId: 'o/r',
        projectApi: 'cloud',
        branch: 'main',
      }),
    ).toBe('["common-project/1","cloud","github.com","o/r","main"]');
    expect(
      projectRefToString({
        storeId: 'agent',
        projectId: 'p',
        projectApi: 'local',
        branch: 'main',
      }),
    ).toBe('["common-project/1","local","agent","p","main"]');
  });
  it.each(['', '..', 'a/b', '%', 'a'.repeat(129)])(
    'refuses malformed Space %s',
    (spaceID) => expect(isValidProjectRef({ ...p, spaceID })).toBe(false),
  );
  it('a shared ref cannot use an agent/Git store', () =>
    expect(
      isValidProjectRef({ ...p, storeId: 'github.com', spaceID: 'S1' }),
    ).toBe(false));
});
