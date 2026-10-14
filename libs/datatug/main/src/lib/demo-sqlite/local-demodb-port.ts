// Adapts a `@dalgo/sqlite-wasm/opfs` bridge port to the `FetchPort` of
// `@openvaultdb/inprocess`.
//
// `fetchOverPort` listens for both `message` and `close`. The bridge ports
// (`session.connect()` and the port the leader serves) only have message
// listeners and ignore the event type, so a `close` listener added to them
// directly would run on every message and dispose the fetch after its first
// answer. This adapter forwards only `message` listeners and keeps `close`
// listeners to itself, calling them when the port is closed here.
// Upstream fix to schedule: the bridge's addEventListener should ignore types it
// does not emit (or emit `close` when the session closes).

export interface MessageOnlyPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  start?(): void;
  close?(): void;
}

/** The FetchPort shape of @openvaultdb/inprocess, plus `close()` that notifies `close` listeners. */
export interface AdaptedFetchPort {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'close', listener: () => void): void;
  start(): void;
  close(): void;
}

export function asFetchPort(port: MessageOnlyPort): AdaptedFetchPort {
  const closeListeners = new Set<() => void>();
  let closed = false;
  const adapted = {
    postMessage: (message: unknown, transfer: Transferable[]) => port.postMessage(message, transfer),
    addEventListener: (type: string, listener: ((event: MessageEvent) => void) | (() => void)) => {
      if (type === 'message') port.addEventListener('message', listener as (event: MessageEvent) => void);
      else if (type === 'close') closeListeners.add(listener as () => void);
    },
    removeEventListener: (type: string, listener: ((event: MessageEvent) => void) | (() => void)) => {
      if (type === 'message') port.removeEventListener('message', listener as (event: MessageEvent) => void);
      else if (type === 'close') closeListeners.delete(listener as () => void);
    },
    start: () => port.start?.(),
    close: () => {
      if (closed) return;
      closed = true;
      port.close?.();
      for (const listener of [...closeListeners]) listener();
    },
  };
  return adapted as AdaptedFetchPort;
}
