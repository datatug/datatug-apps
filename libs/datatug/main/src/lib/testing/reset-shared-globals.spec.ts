import { resetSharedGlobals } from '@sneat/core/testing';

describe('resetSharedGlobals', () => {
  it.each(['sessionStorage', 'localStorage'] as const)(
    'gives the next spec file real %s after a spec made it throw',
    (name) => {
      const storage = window[name];
      vi.spyOn(storage, 'getItem').mockImplementation(() => {
        throw new Error('read denied');
      });
      vi.spyOn(storage, 'setItem').mockImplementation(() => {
        throw new Error('write denied');
      });
      resetSharedGlobals();
      storage.setItem('k', 'v');
      expect(storage.getItem('k')).toBe('v');
    },
  );
});
