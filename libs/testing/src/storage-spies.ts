/**
 * `vi.restoreAllMocks()` does not undo `vi.spyOn(sessionStorage, 'getItem')`: happy-dom's Storage is a Proxy that
 * keeps the spied method as an own property, so a spec that made storage throw left it throwing for every later file
 * in the worker. Restoring each storage spy directly gives the next file real storage again.
 */
export function restoreStorageSpies(storage: Storage | undefined): void {
  if (!storage) {
    return;
  }
  for (const method of ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const) {
    const candidate = (storage as unknown as Record<string, unknown>)[method];
    if (vi.isMockFunction(candidate)) {
      candidate.mockRestore();
    }
  }
}
