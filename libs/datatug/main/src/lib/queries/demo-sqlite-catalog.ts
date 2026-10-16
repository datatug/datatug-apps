// The pinned canonical SQLite files of the DemoDB datasets (https://demodb.dev).
//
// Each entry names where a browser downloads the dataset from (`source`):
// - `file`: `url` is the plain SQLite file.
// - `chunked`: `url` is a `demodb-chunked-export/v1` manifest (`<file>.parts.json`)
//   listing gzip parts with their SHA-256. DemoDB serves files above the 25 MiB
//   static-asset limit only this way; there is no single-file URL for them.
// `sha256`/`bytes` always describe the decoded SQLite file: that pin is checked
// after download whatever the source. `transferBytes` is roughly what crosses the
// wire; it is only used to tell the user how much will be downloaded.
//
// `demo-sqlite-catalog.spec.ts` checks the pins offline;
// `scripts/check-demo-sqlite-catalog.mjs --online` re-downloads every dataset (parts
// one at a time for `chunked`) and compares status, size and SHA-256 with this file.

export const demoSqliteDatasetIds = [
  'chinook',
  'northwind',
  'pubs',
  'sakila',
  'adventureworks',
  'employees',
] as const;

export type DemoSqliteDatasetId = (typeof demoSqliteDatasetIds)[number];

/**
 * How the browser keeps a dataset:
 * - `working-and-pristine`: an editable working copy plus a pristine copy that
 *   Reset restores without downloading again.
 * - `single-copy`: only the working copy (half the storage); Reset downloads
 *   the file again, so it needs the network. Used for large datasets.
 */
export type DemoSqliteStoragePolicy = 'working-and-pristine' | 'single-copy';

/**
 * How a dataset is served:
 * - `file`: one SQLite file at `url`.
 * - `chunked`: a `demodb-chunked-export/v1` manifest at `url`, listing gzip parts
 *   (see `demo-sqlite/demodb-chunked-fetch.ts`).
 */
export type DemoSqliteSource = 'file' | 'chunked';

export interface DemoSqliteCatalogEntry {
  readonly dataset: DemoSqliteDatasetId;
  readonly title: string;
  readonly source: DemoSqliteSource;
  /** The SQLite file (`file`), or the `.parts.json` manifest (`chunked`). */
  readonly url: string;
  /** SHA-256 of the decoded SQLite file. */
  readonly sha256: string;
  /** Byte size of the decoded SQLite file. */
  readonly bytes: number;
  /** Bytes downloaded (for `chunked`, the gzip parts together). */
  readonly transferBytes: number;
  readonly storagePolicy: DemoSqliteStoragePolicy;
}

/** Datasets above this decoded size ask before downloading and never fall back to memory. */
export const LARGE_DEMO_SQLITE_BYTES = 10 * 1024 * 1024;

export const demoSqliteCatalog: Readonly<
  Record<DemoSqliteDatasetId, DemoSqliteCatalogEntry>
> = {
  chinook: {
    dataset: 'chinook',
    title: 'Chinook',
    source: 'file',
    url: 'https://chinook.demodb.dev/data/chinook.sqlite',
    sha256: '7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15',
    bytes: 1007616,
    transferBytes: 1007616,
    storagePolicy: 'working-and-pristine',
  },
  northwind: {
    dataset: 'northwind',
    title: 'Northwind',
    source: 'file',
    url: 'https://northwind.demodb.dev/data/northwind.sqlite',
    sha256: '279b34136771aee75d802094b3329515a2b01da65d2a20a4a9e3b58c29b4fd20',
    bytes: 602112,
    transferBytes: 602112,
    storagePolicy: 'working-and-pristine',
  },
  pubs: {
    dataset: 'pubs',
    title: 'Pubs',
    source: 'file',
    url: 'https://pubs.demodb.dev/data/pubs.sqlite',
    sha256: 'b45b08b7c06441cc0b138b031ea5bd32bd5866aebf874c89d2ebf7fc6abb3691',
    bytes: 212992,
    transferBytes: 212992,
    storagePolicy: 'working-and-pristine',
  },
  sakila: {
    dataset: 'sakila',
    title: 'Sakila',
    source: 'file',
    url: 'https://sakila.demodb.dev/data/sakila.sqlite',
    // demo-db/sakila ovdb-database.json (source revision sha256:ef4ab9aa…).
    sha256: '9bebeee50fecb1fee115c206a4f380f2f6d1f009e7796b18b8a8cfba7c810454',
    bytes: 4915200,
    transferBytes: 4915200,
    storagePolicy: 'working-and-pristine',
  },
  adventureworks: {
    dataset: 'adventureworks',
    title: 'AdventureWorks',
    source: 'chunked',
    url: 'https://adventureworks.demodb.dev/data/adventureworks.sqlite.parts.json',
    sha256: '6a105e1982becfe003fc7a307d7cad9d738390cedd79d166c2167fd817168109',
    bytes: 126820352,
    transferBytes: 35367459,
    storagePolicy: 'single-copy',
  },
  employees: {
    dataset: 'employees',
    title: 'Employees',
    source: 'file',
    url: 'https://employees.demodb.dev/data/employees.sqlite',
    sha256: '46b49dd0e141cd8db66d57680a10febfccc15e6f54dc7b8f3c2316b55e11c5f0',
    bytes: 876544,
    transferBytes: 876544,
    storagePolicy: 'working-and-pristine',
  },
};

/** The catalog entry of a dataset id, matched case-insensitively; undefined for anything else. */
export function findDemoSqliteDataset(
  id: string | null | undefined,
): DemoSqliteCatalogEntry | undefined {
  const key = (id ?? '').trim().toLowerCase();
  return (demoSqliteDatasetIds as readonly string[]).includes(key)
    ? demoSqliteCatalog[key as DemoSqliteDatasetId]
    : undefined;
}

export function isLargeDemoSqliteDataset(entry: DemoSqliteCatalogEntry): boolean {
  return entry.bytes > LARGE_DEMO_SQLITE_BYTES;
}

/**
 * The download size the progress bar falls back to when the download reports no total:
 * the decoded file for `file`, the gzip parts for `chunked`.
 */
export function demoSqliteDownloadBytes(entry: DemoSqliteCatalogEntry): number {
  return entry.source === 'chunked' ? entry.transferBytes : entry.bytes;
}

/** Browser storage the dataset occupies once stored, by its storage policy. */
export function demoSqliteStorageBytes(entry: DemoSqliteCatalogEntry): number {
  return entry.storagePolicy === 'single-copy' ? entry.bytes : entry.bytes * 2;
}

/** `1.0 MB`, `126.8 MB`: decimal megabytes, as download sizes are usually shown. */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
