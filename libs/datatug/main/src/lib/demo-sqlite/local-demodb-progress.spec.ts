import { describe, expect, it } from 'vitest';
import { mapDemoDbProgress } from './local-demodb-progress';

describe('mapDemoDbProgress', () => {
  it('shows the fetch phase as the download bar, with the total only when known', () => {
    expect(mapDemoDbProgress({ phase: 'fetch', loaded: 1200, total: 5000 })).toEqual({ phase: 'download', loaded: 1200, total: 5000 });
    expect(mapDemoDbProgress({ phase: 'fetch', loaded: 7 })).toEqual({ phase: 'download', loaded: 7 });
    expect(mapDemoDbProgress({ phase: 'fetch' })).toEqual({ phase: 'download', loaded: 0 });
  });

  it('shows every later phase as an install step, in the order the worker reports them', () => {
    const steps = ['verify', 'importPristine', 'importWorking', 'open'].map((phase) => mapDemoDbProgress({ phase, total: 99 }));
    expect(steps).toEqual([
      { phase: 'install', step: 'verify' },
      { phase: 'install', step: 'importPristine' },
      { phase: 'install', step: 'importWorking' },
      { phase: 'install', step: 'open' },
    ]);
  });

  it('ignores a phase a newer package may add', () => {
    expect(mapDemoDbProgress({ phase: 'compact' })).toBeUndefined();
  });
});
