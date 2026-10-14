/// <reference lib="webworker" />
// The dataset worker of a local DemoDB copy: sqlite-wasm with the opfs-sahpool VFS
// (no COOP/COEP needed), served by `@dalgo/sqlite-wasm/opfs/worker`. It is started
// only by the leader tab (local-demodb-runtime.ts) and is the only DataTug module
// that loads SQLite WASM. The download goes through progressFetch so the page can
// show how much of the canonical file has arrived.
import { serveDemoDbWorker } from '@dalgo/sqlite-wasm/opfs/worker';
import { progressFetch } from './local-demodb-progress';

serveDemoDbWorker({
  fetch: progressFetch((message) => self.postMessage(message)),
});
