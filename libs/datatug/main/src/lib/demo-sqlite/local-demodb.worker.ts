/// <reference lib="webworker" />
// The dataset worker of a local DemoDB copy: sqlite-wasm with the opfs-sahpool VFS
// (no COOP/COEP needed), served by `@dalgo/sqlite-wasm/opfs/worker`. It is started
// only by the leader tab (local-demodb-runtime.ts) and is the only DataTug module
// that loads SQLite WASM. Progress is reported by openDemoDb's `onProgress`.
import { serveDemoDbWorker } from '@dalgo/sqlite-wasm/opfs/worker';

serveDemoDbWorker();
