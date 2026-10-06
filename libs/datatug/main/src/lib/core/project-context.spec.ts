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
  it.each(['', '..', 'a/b', '%', 'a'.repeat(129)])(
    'refuses malformed Space %s',
    (spaceID) => expect(isValidProjectRef({ ...p, spaceID })).toBe(false),
  );
  it('a shared ref cannot use an agent/Git store', () =>
    expect(
      isValidProjectRef({ ...p, storeId: 'github.com', spaceID: 'S1' }),
    ).toBe(false));
});
