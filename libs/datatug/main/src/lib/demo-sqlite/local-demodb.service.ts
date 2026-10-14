// Opens a writable local copy of a DemoDB SQLite dataset and exposes it as an
// OVDB connection (baseUrl + fetch + descriptor). See local-demodb-runtime.ts for
// the stack; this file holds the user-facing state machine:
//
//   checking ─┬─ stored or small ─────────────────────────────▶ loading ─▶ ready
//             ├─ large, not stored ─▶ confirm-large ─Continue─▶ loading
//             ├─ quota too small ───▶ insufficient-storage
//             └─ large, no OPFS ────▶ unsupported-browser
//   loading ─▶ locked-retry (pool held by another context; Try again) | failed
//
// Large datasets (catalog `bytes` above LARGE_DEMO_SQLITE_BYTES) never run from
// memory: when the session falls back to memory they end in unsupported-browser.
import { Injectable, InjectionToken, Signal, computed, inject, signal } from '@angular/core';
import {
  demoSqliteStorageBytes,
  findDemoSqliteDataset,
  formatMegabytes,
  isLargeDemoSqliteDataset,
  type DemoSqliteCatalogEntry,
} from '../queries/demo-sqlite-catalog';
import { fetchOvdbDescriptor, type OvdbConnection, type OvdbDescriptor } from '../ovdb/ovdb-connection';
import type { DemoDbProgressMessage } from './local-demodb-progress';
import type { LocalDemoDbOpenReport, LocalDemoDbRuntime, OpenLocalDemoDbRuntime } from './local-demodb.types';

export type LocalDemoDbState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'confirm-large'; readonly downloadBytes: number; readonly storageBytes: number }
  | { readonly kind: 'insufficient-storage'; readonly neededBytes: number; readonly availableBytes: number }
  | { readonly kind: 'unsupported-browser'; readonly message: string }
  | {
      readonly kind: 'loading';
      readonly phase: 'opening' | 'download' | 'install';
      /** Decoded bytes received so far. */
      readonly loaded: number;
      /** Decoded size from the catalog. */
      readonly total: number;
      /** False for the first ~400 ms, so a quick open shows no progress UI. */
      readonly showProgress: boolean;
    }
  | {
      readonly kind: 'ready';
      readonly persistent: boolean;
      readonly replacedPreviousVersion: boolean;
      readonly fallbackReason?: string;
    }
  | { readonly kind: 'locked-retry'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string; readonly storage: boolean };

/** Browser facts the state machine needs; replaced in tests. */
export interface LocalDemoDbEnvironment {
  supportsWorkers(): boolean;
  /** OPFS directory access and Web Locks (needed for a persistent, shared copy). */
  opfsAvailable(): Promise<boolean>;
  storageEstimate(): Promise<{ readonly quota: number; readonly usage: number } | undefined>;
  /** Whether this version of the dataset is already stored in this browser. */
  isStored(entry: DemoSqliteCatalogEntry): Promise<boolean>;
  markStored(entry: DemoSqliteCatalogEntry, stored: boolean): void;
}

export const PROGRESS_DELAY_MS = 400;

const storedKey = (dataset: string): string => `datatug.demodb.stored.${dataset}`;

function readLocalStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

interface DirectoryLike {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryLike>;
}

export const browserLocalDemoDbEnvironment: LocalDemoDbEnvironment = {
  supportsWorkers: () => typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined',
  opfsAvailable: async () => {
    const nav = globalThis.navigator as Navigator | undefined;
    if (!nav?.locks || typeof nav.storage?.getDirectory !== 'function') return false;
    try {
      await nav.storage.getDirectory();
      return true;
    } catch {
      return false;
    }
  },
  storageEstimate: async () => {
    try {
      const estimate = await globalThis.navigator?.storage?.estimate?.();
      return estimate && typeof estimate.quota === 'number'
        ? { quota: estimate.quota, usage: estimate.usage ?? 0 }
        : undefined;
    } catch {
      return undefined;
    }
  },
  isStored: async (entry) => {
    if (readLocalStorage(storedKey(entry.dataset)) !== entry.sha256) return false;
    try {
      const root = (await globalThis.navigator.storage.getDirectory()) as unknown as DirectoryLike;
      // The opfs-sahpool directory of @dalgo/sqlite-wasm/opfs: `.demodb/<dataset>`.
      await (await root.getDirectoryHandle('.demodb')).getDirectoryHandle(entry.dataset);
      return true;
    } catch {
      return false;
    }
  },
  markStored: (entry, stored) => {
    try {
      if (stored) globalThis.localStorage?.setItem(storedKey(entry.dataset), entry.sha256);
      else globalThis.localStorage?.removeItem(storedKey(entry.dataset));
    } catch {
      /* the marker only saves a confirmation prompt */
    }
  },
};

export const LOCAL_DEMODB_ENVIRONMENT = new InjectionToken<LocalDemoDbEnvironment>('LOCAL_DEMODB_ENVIRONMENT', {
  providedIn: 'root',
  factory: () => browserLocalDemoDbEnvironment,
});

/** Loads the runtime lazily: @dalgo/sqlite-wasm/opfs and @openvaultdb/inprocess stay out of the main bundle. */
export const LOCAL_DEMODB_RUNTIME_LOADER = new InjectionToken<() => Promise<OpenLocalDemoDbRuntime>>(
  'LOCAL_DEMODB_RUNTIME_LOADER',
  {
    providedIn: 'root',
    factory: () => () => import('./local-demodb-runtime').then((m) => m.openLocalDemoDbRuntime),
  },
);

function errorField(error: unknown, field: string): unknown {
  return typeof error === 'object' && error !== null ? (error as Record<string, unknown>)[field] : undefined;
}

export function storageShortageMessage(entry: DemoSqliteCatalogEntry): string {
  return `Not enough browser storage for this dataset (needs ~${formatMegabytes(demoSqliteStorageBytes(entry))}). Free space or try a smaller dataset.`;
}

export const LARGE_DATASET_NEEDS_OPFS =
  'This dataset needs a regular desktop browser window with local storage (private windows and in-app browsers cannot keep it).';

/** Maps a failure of opening the dataset to a state the page can explain. */
export function classifyOpenError(error: unknown, entry: DemoSqliteCatalogEntry): LocalDemoDbState {
  const name = errorField(error, 'name');
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'PoolUnavailableError' && (errorField(error, 'reason') === 'locked' || errorField(error, 'retriable') === true)) {
    return {
      kind: 'locked-retry',
      message: 'The local copy is still held by another tab or a page that is closing. Close other DataTug tabs of this dataset, then try again.',
    };
  }
  if (name === 'DatasetStorageError' || errorField(error, 'code') === 'dataset_storage') {
    // The `operation` ("import" | "open") does not cross the worker boundary (it is
    // not in sqlite-wasm's SerializedError), so quota is recognised by the message.
    return /quota|space|full|exceed/i.test(message) || isLargeDemoSqliteDataset(entry)
      ? { kind: 'failed', storage: true, message: storageShortageMessage(entry) }
      : { kind: 'failed', storage: true, message: `The local copy could not be stored in this browser: ${message}` };
  }
  if (name === 'CanonicalFetchError') {
    return { kind: 'failed', storage: false, message: 'The dataset could not be downloaded. Check your connection and try again.' };
  }
  if (name === 'CanonicalIntegrityError') {
    return {
      kind: 'failed',
      storage: false,
      message: 'The downloaded dataset did not match its published checksum, so it was not opened. Try again later.',
    };
  }
  return { kind: 'failed', storage: false, message: `The local database could not be opened: ${message}` };
}

/** One open local dataset: state, the OVDB connection once ready, and controls. */
export class LocalDemoDbSession {
  readonly #state = signal<LocalDemoDbState>({ kind: 'checking' });
  readonly #connection = signal<OvdbConnection | undefined>(undefined);
  readonly #role = signal<string>('connecting');
  readonly state: Signal<LocalDemoDbState> = this.#state.asReadonly();
  readonly connection: Signal<OvdbConnection | undefined> = this.#connection.asReadonly();
  readonly role: Signal<string> = this.#role.asReadonly();
  readonly descriptor = computed<OvdbDescriptor | undefined>(() => this.#connection()?.descriptor);
  #runtime: LocalDemoDbRuntime | undefined;
  #unsubscribe: (() => void) | undefined;
  #progressTimer: ReturnType<typeof setTimeout> | undefined;
  #epoch = 0;
  #disposed = false;

  constructor(
    readonly entry: DemoSqliteCatalogEntry,
    private readonly environment: LocalDemoDbEnvironment,
    private readonly loadRuntime: () => Promise<OpenLocalDemoDbRuntime>,
  ) {}

  get baseUrl(): string | undefined {
    return this.#connection()?.baseUrl;
  }

  get fetch(): typeof globalThis.fetch | undefined {
    return this.#connection()?.fetch;
  }

  /** Decides whether to ask, refuse or open, and opens when nothing needs asking. */
  async start(): Promise<void> {
    const epoch = ++this.#epoch;
    this.#state.set({ kind: 'checking' });
    const entry = this.entry;
    if (entry.storagePolicy !== 'working-and-pristine') {
      // A single-copy policy needs an upstream openDemoDb option that does not exist yet.
      this.#state.set({ kind: 'failed', storage: false, message: 'This dataset is not available as a local copy yet.' });
      return;
    }
    if (!this.environment.supportsWorkers()) {
      this.#state.set({
        kind: 'unsupported-browser',
        message: 'This browser cannot run a local database (it lacks Web Workers or WebAssembly). Try a current Chrome, Edge, Firefox or Safari.',
      });
      return;
    }
    const stored = await this.environment.isStored(entry);
    if (epoch !== this.#epoch) return;
    if (!stored) {
      const needed = demoSqliteStorageBytes(entry);
      const estimate = await this.environment.storageEstimate();
      if (epoch !== this.#epoch) return;
      if (estimate && estimate.quota - estimate.usage < needed) {
        this.#state.set({ kind: 'insufficient-storage', neededBytes: needed, availableBytes: Math.max(0, estimate.quota - estimate.usage) });
        return;
      }
      if (isLargeDemoSqliteDataset(entry)) {
        const opfs = await this.environment.opfsAvailable();
        if (epoch !== this.#epoch) return;
        if (!opfs) {
          this.#state.set({ kind: 'unsupported-browser', message: LARGE_DATASET_NEEDS_OPFS });
          return;
        }
        this.#state.set({ kind: 'confirm-large', downloadBytes: entry.transferBytes, storageBytes: needed });
        return;
      }
    }
    await this.#open(epoch);
  }

  /** Continue after the large-dataset confirmation. */
  async confirmDownload(): Promise<void> {
    if (this.#state().kind !== 'confirm-large') return;
    await this.#open(++this.#epoch);
  }

  /** Try again after locked-retry or failed. */
  async retry(): Promise<void> {
    this.#closeRuntime();
    await this.start();
  }

  /** Re-reads the descriptor (after a reset or write) and returns it. */
  async refreshDescriptor(): Promise<OvdbDescriptor> {
    const connection = this.#connection();
    if (!connection) throw new Error('The local database is not open.');
    const descriptor = await fetchOvdbDescriptor(connection.fetch, connection.baseUrl, connection.databaseId);
    this.#connection.set({ ...connection, descriptor });
    return descriptor;
  }

  dispose(): void {
    this.#disposed = true;
    this.#epoch++;
    this.#closeRuntime();
  }

  #closeRuntime(): void {
    clearTimeout(this.#progressTimer);
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#runtime?.close();
    this.#runtime = undefined;
    this.#connection.set(undefined);
  }

  #onProgress = (epoch: number, message: DemoDbProgressMessage): void => {
    const state = this.#state();
    if (epoch !== this.#epoch || state.kind !== 'loading') return;
    this.#state.set(
      message.phase === 'download'
        ? { ...state, phase: 'download', loaded: message.loaded }
        : { ...state, phase: 'install', loaded: this.entry.bytes },
    );
  };

  async #open(epoch: number): Promise<void> {
    const entry = this.entry;
    this.#state.set({ kind: 'loading', phase: 'opening', loaded: 0, total: entry.bytes, showProgress: false });
    clearTimeout(this.#progressTimer);
    this.#progressTimer = setTimeout(() => {
      const state = this.#state();
      if (epoch === this.#epoch && state.kind === 'loading') this.#state.set({ ...state, showProgress: true });
    }, PROGRESS_DELAY_MS);
    let report: LocalDemoDbOpenReport;
    try {
      const openRuntime = await this.loadRuntime();
      if (epoch !== this.#epoch) return;
      const runtime = openRuntime({ entry, onProgress: (message) => this.#onProgress(epoch, message) });
      this.#runtime = runtime;
      this.#role.set(runtime.role());
      this.#unsubscribe = runtime.onRoleChange((role) => this.#role.set(role));
      report = await runtime.ready();
      if (epoch !== this.#epoch) return;
      if (report.fallback && isLargeDemoSqliteDataset(entry)) {
        this.#closeRuntime();
        this.environment.markStored(entry, false);
        this.#state.set({ kind: 'unsupported-browser', message: LARGE_DATASET_NEEDS_OPFS });
        return;
      }
      const descriptor = await fetchOvdbDescriptor(runtime.fetch, runtime.baseUrl, entry.dataset);
      if (epoch !== this.#epoch) return;
      this.#connection.set({
        id: `${entry.dataset}-sqlite-local`,
        title: `${entry.title} (local SQLite)`,
        baseUrl: runtime.baseUrl,
        databaseId: entry.dataset,
        fetch: runtime.fetch,
        descriptor,
      });
    } catch (error) {
      if (epoch !== this.#epoch || this.#disposed) return;
      this.#closeRuntime();
      this.#state.set(classifyOpenError(error, entry));
      return;
    } finally {
      clearTimeout(this.#progressTimer);
    }
    this.environment.markStored(entry, report.persistent);
    this.#state.set({
      kind: 'ready',
      persistent: report.persistent,
      replacedPreviousVersion: report.replacedPreviousVersion,
      ...(report.fallback ? { fallbackReason: report.fallback.reason } : {}),
    });
  }
}

@Injectable({ providedIn: 'root' })
export class LocalDemoDbService {
  private readonly environment = inject(LOCAL_DEMODB_ENVIRONMENT);
  private readonly loadRuntime = inject(LOCAL_DEMODB_RUNTIME_LOADER);

  /** A session for the dataset (case-insensitive id), or undefined for an unknown dataset. Call `start()`. */
  open(datasetId: string): LocalDemoDbSession | undefined {
    const entry = findDemoSqliteDataset(datasetId);
    return entry ? new LocalDemoDbSession(entry, this.environment, this.loadRuntime) : undefined;
  }
}
