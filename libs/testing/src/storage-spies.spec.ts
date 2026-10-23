import { restoreStorageSpies } from './storage-spies';

describe('restoreStorageSpies', () => {
  it.each(['sessionStorage', 'localStorage'] as const)(
    'gives real %s back after a spec made it throw, which restoreAllMocks alone does not',
    (name) => {
      const storage = window[name];
      vi.spyOn(storage, 'getItem').mockImplementation(() => {
        throw new Error('read denied');
      });
      vi.spyOn(storage, 'setItem').mockImplementation(() => {
        throw new Error('write denied');
      });
      vi.restoreAllMocks();
      expect(() => storage.getItem('k')).toThrow('read denied');
      restoreStorageSpies(storage);
      storage.setItem('k', 'v');
      expect(storage.getItem('k')).toBe('v');
      storage.clear();
    },
  );
  it('accepts a missing storage', () => {
    expect(() => restoreStorageSpies(undefined)).not.toThrow();
  });
});
