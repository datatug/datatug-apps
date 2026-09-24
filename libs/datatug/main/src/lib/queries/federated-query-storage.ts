const prefixes = ['datatug-federated-', 'datatug-output-'];
const maxAgeMs = 24 * 60 * 60 * 1000;

/** A crashed tab cannot run its normal close path. Reap only dated databases old enough
 * to avoid deleting a concurrent tab's active query. Older undated names are left alone. */
export async function cleanupOrphanedQueryDatabases(now = Date.now()): Promise<void> {
  if (typeof indexedDB.databases !== 'function') return;
  for (const { name } of await indexedDB.databases()) {
    if (!name || !prefixes.some((prefix) => name.startsWith(prefix))) continue;
    const timestamp = Number(name.split('-')[2]);
    if (!Number.isSafeInteger(timestamp) || timestamp > now - maxAgeMs || timestamp <= 0) continue;
    await deleteQueryDatabase(name);
  }
}

export async function deleteQueryDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Cannot remove temporary query storage.'));
    request.onblocked = () => reject(new Error('Temporary query storage is still open.'));
  });
}

export function queryStorageError(error: unknown): Error {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new Error('Browser storage is full. Close other results or free site storage, then run the query again.');
  }
  return error instanceof Error ? error : new Error('Temporary query storage failed.');
}
