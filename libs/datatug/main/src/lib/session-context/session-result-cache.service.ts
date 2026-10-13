import { Injectable } from '@angular/core';
import { openDB } from 'idb';

/** Private device display cache. Read only after fresh session admission; never an execution receipt. */
@Injectable({ providedIn: 'root' })
export class SessionResultCacheService {
  private readonly database = openDB('datatug-session-view-cache', 1, { upgrade: (db) => { db.createObjectStore('views'); } });
  async read<T>(key: string): Promise<T | undefined> { return (await this.database).get('views', key); }
  async write(key: string, value: unknown): Promise<void> { await (await this.database).put('views', value, key); }
}

/** Optional display persistence never changes the execution outcome. */
export async function tryWriteSessionResultCache(
  cache: Pick<SessionResultCacheService, 'write'>,
  key: string,
  value: unknown,
): Promise<boolean> {
  try {
    await cache.write(key, value);
    return true;
  } catch {
    return false;
  }
}
