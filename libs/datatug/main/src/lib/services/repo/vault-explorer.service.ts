// READ-ONLY BY CONSTRUCTION.
//
// This service backs the "Explore my GitHub vault" transparency viewer — the
// inGitDB/GitHub sibling of the Firestore `SpaceExplorerService` (see
// space-explorer.service.ts). It must NEVER call a write method of
// `@ingitdb/client-github` (putFile/deleteFile/createCommit/createTree/
// updateBranchRef, or the pending/committed-changes stores). It only ever
// reads via `loadDatabaseConfig`/`loadCollectionSchema`/`loadCollectionRecords`
// and `githubApi.getContents`.
//
// The credibility proof behind "own your data": for a GitHub-backed vault
// there is no Sneat/DataTug server in the read path at all — the browser talks
// straight to api.github.com / raw.githubusercontent.com with the user's own
// token (which stays in memory only; it is never persisted anywhere).
//
// Vault layout (see ingitdb dalgo2ingitdb/FORMAT.md): root collections are
// declared in `.ingitdb/root-collections.yaml`; a record's own subcollections
// nest under the parent record's directory, mirroring Firestore's
// document→subcollection model, e.g.
//   spaces/$records/family.yaml               # top-level record
//   spaces/family/contacts/$records/c1.yaml   # nested record
import { Injectable } from '@angular/core';
import type {
  CollectionEntry,
  CollectionSchema,
  RecordRow,
} from '@ingitdb/client';
import { createIngitDbClient } from '@ingitdb/client-github';
import type { IngitDbGithubClient } from '@ingitdb/client-github';

// Re-exported under explorer-scoped names so the page component doesn't need
// to know which of the two `@ingitdb/*` packages declares what.
export type IVaultCollectionEntry = CollectionEntry;
export type IVaultCollectionSchema = CollectionSchema;
export type IVaultRecordRow = RecordRow;

export interface IVaultCollectionSchemaInfo {
  readonly schema: IVaultCollectionSchema;
  /** The physical directory that holds the collection's `$records/`. */
  readonly collectionPath: string;
}

/** Client-managed metadata fields on a record row — not user data. */
export const VAULT_META_FIELDS: ReadonlySet<string> = new Set([
  '_id',
  '_path',
  '_sha',
  '_error',
  '_parseError',
]);

@Injectable()
export class VaultExplorerService {
  private client?: IngitDbGithubClient;

  /**
   * (Re)creates the GitHub client with the given token. The token is only
   * ever held by the client in memory and sent to api.github.com — never
   * persisted (no localStorage/IndexedDB/cookies).
   */
  connect(token?: string): void {
    this.client = createIngitDbClient({ token: token || undefined });
  }

  /** Lists root collections from `.ingitdb/root-collections.yaml`. */
  async loadCollections(
    repo: string,
    branch: string,
  ): Promise<IVaultCollectionEntry[]> {
    const config = await this.requireClient().loadDatabaseConfig(repo, branch);
    return config.collections;
  }

  /** Resolves a root collection's schema and its true records directory. */
  async loadRootCollectionSchema(
    repo: string,
    branch: string,
    collectionId: string,
  ): Promise<IVaultCollectionSchemaInfo> {
    const { schema, collectionPath } =
      await this.requireClient().loadCollectionSchema(
        repo,
        branch,
        collectionId,
      );
    return { schema, collectionPath };
  }

  /** Loads a collection's records (single-file, file-per-record or `.ingr`). */
  async loadRecords(
    repo: string,
    branch: string,
    collectionId: string,
    schema: IVaultCollectionSchema,
    collectionPath: string,
  ): Promise<IVaultRecordRow[]> {
    const { records } = await this.requireClient().loadCollectionRecords(
      repo,
      branch,
      collectionId,
      schema,
      collectionPath,
    );
    return records;
  }

  /**
   * Probes a record's directory for nested subcollections via the GitHub
   * Contents API. A 404 simply means the record has no subcollection
   * directory yet — that's expected, not an error.
   */
  async listSubcollections(
    repo: string,
    recordDir: string,
    branch: string,
  ): Promise<string[]> {
    try {
      const entries = await this.requireClient().githubApi.getContents(
        repo,
        recordDir,
        branch,
      );
      return subcollectionNamesFromContents(entries);
    } catch (err) {
      if (vaultErrorMessage(err).includes('404')) {
        return [];
      }
      throw err;
    }
  }

  private requireClient(): IngitDbGithubClient {
    if (!this.client) {
      throw new Error('VaultExplorerService is not connected yet');
    }
    return this.client;
  }
}

/**
 * Extracts subcollection names from a GitHub Contents API directory listing:
 * every child directory except dot-dirs and the `$records/` data dir itself.
 */
export function subcollectionNamesFromContents(entries: unknown): string[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  return (entries as Array<{ type?: string; name?: string }>)
    .filter(
      (e) =>
        e.type === 'dir' &&
        typeof e.name === 'string' &&
        !e.name.startsWith('.') &&
        e.name !== '$records',
    )
    .map((e) => String(e.name));
}

export function vaultErrorMessage(err: unknown): string {
  const e = err as { response?: { status?: number }; message?: string };
  if (e?.response?.status) {
    return `${e.response.status} ${e.message ?? ''}`.trim();
  }
  return e?.message ?? String(err);
}
