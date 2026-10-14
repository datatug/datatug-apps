import 'fake-indexeddb/auto';
import { SessionResultCacheService } from './session-result-cache.service';

describe('SessionResultCacheService', () => {
  it('does not create its private database until a cache read or write is requested', async () => {
    const before = await indexedDB.databases();
    expect(before.some((database) => database.name === 'datatug-session-view-cache')).toBe(false);

    const cache = new SessionResultCacheService();
    expect((await indexedDB.databases()).some((database) => database.name === 'datatug-session-view-cache')).toBe(false);

    await cache.write('run/result', { rows: [{ id: 1 }] });
    expect((await cache.read<{ rows: readonly { id: number }[] }>('run/result'))?.rows).toEqual([{ id: 1 }]);
    expect((await indexedDB.databases()).some((database) => database.name === 'datatug-session-view-cache')).toBe(true);
  });
});
