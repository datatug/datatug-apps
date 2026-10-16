// How opening a local DemoDB copy failed, as the page needs to tell it apart.
//
// The runtime (local-demodb-runtime.ts, loaded lazily) knows the classes of
// @dalgo/sqlite-wasm/opfs and turns its errors into this one; the service in the
// main bundle only reads `kind`, so it never imports the OPFS package.

export type LocalDemoDbFailureKind =
  /** The pool's files stay held by another tab or a closing page; trying again may work. */
  | 'locked'
  /** OPFS cannot be used here and the dataset may not be kept in memory (no download was made). */
  | 'opfs-unavailable'
  /** The browser ran out of storage while writing the copy. */
  | 'quota'
  /** The copy could not be written or opened for another storage reason. */
  | 'storage'
  | 'download'
  /** DemoDB answered HTTP 429: the download stopped at once and is not retried automatically. */
  | 'rate-limited'
  | 'integrity';

export class LocalDemoDbOpenError extends Error {
  override readonly name = 'LocalDemoDbOpenError';
  constructor(
    readonly kind: LocalDemoDbFailureKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
