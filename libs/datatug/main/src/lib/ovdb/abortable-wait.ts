/** Waits `ms`, rejecting with the abort reason at once (and clearing the timer) when `signal` aborts. */
export function abortableWait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    function abort(): void {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}
