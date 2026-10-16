/// <reference lib="webworker" />
// The dataset worker of a local DemoDB copy: sqlite-wasm with the opfs-sahpool VFS
// (no COOP/COEP needed), served by `@dalgo/sqlite-wasm/opfs/worker`. It is started
// only by the leader tab (local-demodb-runtime.ts) and is the only DataTug module
// that loads SQLite WASM. Progress is reported by openDemoDb's `onProgress`.
// Datasets served as gzip parts are downloaded by the chunked fetch (see
// demodb-chunked-fetch.ts); every other URL goes to the network as before.
import { serveDemoDbWorker } from '@dalgo/sqlite-wasm/opfs/worker';
import { createChunkedCanonicalFetch } from './demodb-chunked-fetch';

serveDemoDbWorker({
  fetch: createChunkedCanonicalFetch(),
  // With a listener the engine reads every download through its stream reader (opens and
  // resets alike), so the typed errors the chunked fetch puts on the stream (HTTP 429,
  // integrity) reach the page with their class instead of a generic body-read error.
  onProgress: () => undefined,
});
