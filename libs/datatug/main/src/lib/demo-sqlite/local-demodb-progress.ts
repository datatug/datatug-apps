// Download progress of a canonical DemoDB file, reported by the dataset worker.
//
// `@dalgo/sqlite-wasm`'s worker takes an injectable `fetch` (EngineOptions.fetch)
// but has no progress callback, so DataTug's worker wraps that fetch: the body
// streams through a counter that posts progress messages to the page. The messages
// carry no `id`, so the sqlite-wasm WorkerClient (which matches replies by `id`)
// ignores them. Phases after the download (SHA-256 verification, writing the working
// and pristine copies, quick_check) have no hook upstream; the page shows them as one
// indeterminate "install" phase that starts when the body has been read.

export const DEMODB_PROGRESS_TYPE = 'datatug/demodb-progress';

export type DemoDbProgressMessage =
  | { readonly type: typeof DEMODB_PROGRESS_TYPE; readonly phase: 'download'; readonly loaded: number }
  | { readonly type: typeof DEMODB_PROGRESS_TYPE; readonly phase: 'install' };

export function isDemoDbProgressMessage(data: unknown): data is DemoDbProgressMessage {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as { type?: unknown; phase?: unknown; loaded?: unknown };
  return (
    message.type === DEMODB_PROGRESS_TYPE &&
    (message.phase === 'install' || (message.phase === 'download' && typeof message.loaded === 'number'))
  );
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * A fetch whose response body reports the bytes read (decoded bytes: a
 * `Content-Encoding: gzip` body is already decoded here) at most every `intervalMs`.
 */
export function progressFetch(
  post: (message: DemoDbProgressMessage) => void,
  fetchFn: Fetch = (input, init) => fetch(input, init),
  intervalMs = 100,
  now: () => number = () => Date.now(),
): Fetch {
  return async (input, init) => {
    const response = await fetchFn(input, init);
    if (!response.ok || !response.body) return response;
    let loaded = 0;
    let last = Number.NEGATIVE_INFINITY;
    post({ type: DEMODB_PROGRESS_TYPE, phase: 'download', loaded });
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        loaded += chunk.byteLength;
        if (now() - last >= intervalMs) {
          last = now();
          post({ type: DEMODB_PROGRESS_TYPE, phase: 'download', loaded });
        }
        controller.enqueue(chunk);
      },
      flush() {
        post({ type: DEMODB_PROGRESS_TYPE, phase: 'download', loaded });
        post({ type: DEMODB_PROGRESS_TYPE, phase: 'install' });
      },
    });
    const headers = new Headers(response.headers);
    // The body below is the decoded stream: its length is not the transfer length.
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(response.body.pipeThrough(counter), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
