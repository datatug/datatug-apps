import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupOrphanedQueryDatabases, queryStorageError } from './federated-query-storage';

describe('temporary browser query storage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reaps only old dated query databases, leaving another tab and unrelated storage alone', async () => {
    const deleted: string[] = [];
    vi.stubGlobal('indexedDB', {
      databases: async () => [
        { name: 'datatug-federated-100000-old' },
        { name: 'datatug-output-190000000-new' },
        { name: 'datatug-federated-undated' },
        { name: 'user-database' },
      ],
      deleteDatabase: (name: string) => {
        deleted.push(name);
        const request: { onsuccess?: () => void } = {};
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    });
    await cleanupOrphanedQueryDatabases(200000000);
    expect(deleted).toEqual(['datatug-federated-100000-old']);
  });

  it('turns browser quota failures into a repairable message', () => {
    expect(queryStorageError(new DOMException('quota', 'QuotaExceededError')).message).toMatch(/storage is full/i);
  });
});
