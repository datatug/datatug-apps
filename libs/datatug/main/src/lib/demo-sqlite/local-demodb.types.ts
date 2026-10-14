// Types shared by the local DemoDB service (main bundle) and its lazily loaded
// runtime (local-demodb-runtime.ts, which pulls in @dalgo/sqlite-wasm/opfs and
// @openvaultdb/inprocess). Type-only: importing this file adds no code.
import type { DemoSqliteCatalogEntry } from '../queries/demo-sqlite-catalog';
import type { DemoDbProgressMessage } from './local-demodb-progress';

/** The leader's open report (`OpenReport` of @dalgo/sqlite-wasm/opfs), as DataTug uses it. */
export interface LocalDemoDbOpenReport {
  readonly persistent: boolean;
  readonly replacedPreviousVersion: boolean;
  readonly imported: boolean;
  readonly canonicalSha256: string;
  readonly fallback?: { readonly reason: string; readonly message: string };
}

/** `leader` | `follower` | `connecting` | `suspended` | `failed` | `closed` (DemoDbRole). */
export type LocalDemoDbRole = string;

export interface LocalDemoDbRuntime {
  readonly baseUrl: string;
  /** A standard fetch answered by the in-process OVDB server of the leader tab. */
  readonly fetch: typeof globalThis.fetch;
  ready(): Promise<LocalDemoDbOpenReport>;
  role(): LocalDemoDbRole;
  onRoleChange(listener: (role: LocalDemoDbRole) => void): () => void;
  close(): void;
}

export interface LocalDemoDbRuntimeOptions {
  readonly entry: DemoSqliteCatalogEntry;
  readonly onProgress: (message: DemoDbProgressMessage) => void;
}

export type OpenLocalDemoDbRuntime = (options: LocalDemoDbRuntimeOptions) => LocalDemoDbRuntime;
