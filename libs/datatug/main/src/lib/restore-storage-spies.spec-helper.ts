/**
 * happy-dom's Storage is a Proxy: `vi.restoreAllMocks()` does not undo
 * `vi.spyOn(sessionStorage, 'getItem')`, only the spy's own `mockRestore()`
 * does. The shared suite (`isolate: false`) reuses one window per worker, so
 * a spy left behind makes sessionStorage fail in every later spec file.
 * Call this from `afterEach` in any spec that spies on web storage.
 */
export function restoreStorageSpies(): void {
  for (const storage of [sessionStorage, localStorage])
    for (const method of ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const) {
      const candidate = storage[method] as unknown as { mockRestore?: () => void };
      candidate.mockRestore?.();
    }
}
