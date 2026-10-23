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
// `api.github.com` budget: `githubApi.getContents` (a records directory of a
// collection, the subcollections of a record) is answered from ONE recursive
// listing of the branch per connect (`git/trees/<branch>?recursive=1`), not
// one Contents API call per collection and per record. A truncated or failed
// listing falls back to the Contents API call.
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
import { Injectable, inject } from '@angular/core';
import type {
  CollectionEntry,
  CollectionSchema,
  RecordRow,
} from '@ingitdb/client';
import { createIngitDbClient } from '@ingitdb/client-github';
import type { IngitDbGithubClient } from '@ingitdb/client-github';
import { GITHUB_API_HOST, githubGet } from './github/github-http';
import { GITHUB_FETCH } from './github/github-project-reader.service';
import { MAX_TREE_BYTES } from './github/github-read-limits';
import { GITHUB_USER_TOKEN } from './github/github-user-token';

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

/** One entry of a recursive git tree listing, as far as the explorer reads it. */
export interface IVaultTreeEntry {
  readonly path: string;
  readonly type: string;
}

/** A Contents API directory entry, as far as `@ingitdb/client-github` and this service read it. */
export interface IVaultContentsEntry {
  readonly name: string;
  readonly path: string;
  readonly type: 'dir' | 'file';
}

/**
 * The Contents API answer for the directory `dir`, computed from a recursive listing: its children, `'absent'` when
 * the listing has no such directory (the Contents API's 404), `'unknown'` when the path is a file (ask the API).
 */
export function contentsFromTree(
  tree: readonly IVaultTreeEntry[],
  dir: string,
): IVaultContentsEntry[] | 'absent' | 'unknown' {
  const base = dir.replace(/^\/+|\/+$/g, '');
  if (base) {
    const self = tree.find((entry) => entry.path === base);
    if (!self) return 'absent';
    if (self.type !== 'tree') return 'unknown';
  }
  const prefix = base ? `${base}/` : '';
  const children: IVaultContentsEntry[] = [];
  for (const entry of tree) {
    if (!entry.path.startsWith(prefix)) continue;
    const name = entry.path.slice(prefix.length);
    if (!name || name.includes('/')) continue;
    if (entry.type === 'tree' || entry.type === 'blob')
      children.push({ name, path: entry.path, type: entry.type === 'tree' ? 'dir' : 'file' });
  }
  return children;
}

function notFound(): Error {
  return Object.assign(new Error('Not Found'), { response: { status: 404 } });
}

@Injectable()
export class VaultExplorerService {
  private readonly fetchFn = inject(GITHUB_FETCH);
  private readonly userToken = inject(GITHUB_USER_TOKEN);
  private client?: IngitDbGithubClient;
  /** The recursive listing of each `repo@branch`, asked once per connect; undefined when it could not be had in full. */
  private trees = new Map<string, Promise<IVaultTreeEntry[] | undefined>>();

  /**
   * (Re)creates the GitHub client with the given token. The token is only
   * ever held by the client in memory and sent to api.github.com — never
   * persisted (no localStorage/IndexedDB/cookies).
   */
  connect(token?: string): void {
    const client = createIngitDbClient({ token: token || undefined });
    const api = client.githubApi;
    const contents = api.getContents.bind(api);
    // The listing goes with the typed token, else the signed-in user's: it is the one API call of a visit.
    const listingToken = token || this.userToken();
    this.trees = new Map();
    api.getContents = async (repo: string, path: string, ref?: string) => {
      const tree = await this.tree(repo, ref, listingToken);
      const answer = tree ? contentsFromTree(tree, path) : 'unknown';
      if (answer === 'absent') throw notFound();
      return answer === 'unknown' ? contents(repo, path, ref) : answer;
    };
    this.client = client;
  }

  private tree(
    repo: string,
    ref: string | undefined,
    token: string | undefined,
  ): Promise<IVaultTreeEntry[] | undefined> {
    const key = `${repo}@${ref ?? ''}`;
    let listing = this.trees.get(key);
    if (!listing) {
      listing = this.askTree(repo, ref, token);
      this.trees.set(key, listing);
    }
    return listing;
  }

  private async askTree(
    repo: string,
    ref: string | undefined,
    token: string | undefined,
  ): Promise<IVaultTreeEntry[] | undefined> {
    const [owner, name] = repo.split('/');
    if (!owner || !name) return undefined;
    const out = await githubGet(
      this.fetchFn,
      `https://${GITHUB_API_HOST}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(ref || 'HEAD')}?recursive=1`,
      { maxBytes: MAX_TREE_BYTES, token },
    );
    if (out.kind !== 'ok') return undefined;
    try {
      const response = JSON.parse(out.text) as { truncated?: boolean; tree?: unknown };
      return response.truncated === false && Array.isArray(response.tree)
        ? (response.tree as IVaultTreeEntry[]).filter(
            (entry) => typeof entry?.path === 'string' && typeof entry?.type === 'string',
          )
        : undefined;
    } catch {
      return undefined;
    }
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
