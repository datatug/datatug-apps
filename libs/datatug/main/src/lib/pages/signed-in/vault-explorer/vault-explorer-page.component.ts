// READ-ONLY BY CONSTRUCTION — this page only ever calls
// `VaultExplorerService.loadCollections`/`loadRootCollectionSchema`/
// `loadRecords`/`listSubcollections`, which in turn only ever call the
// read APIs of `@ingitdb/client-github`. Never add a write call (putFile/
// deleteFile/createCommit or the pending-changes stores) here — this is the
// GitHub/inGitDB sibling of the Firestore "explore your own raw data"
// transparency viewer (see space-explorer-page.component.ts), not an editor.
//
// Ported from the standalone Vite SPA of the archived sneat-mod-datatug repo
// (its ng/src/main.ts): connect form → root collections from
// `.ingitdb/root-collections.yaml` → records table → record JSON → nested
// subcollection drill-down with breadcrumbs.
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import {
  IVaultCollectionEntry,
  IVaultCollectionSchema,
  IVaultRecordRow,
  VAULT_META_FIELDS,
  VaultExplorerService,
  vaultErrorMessage,
} from '../../../services/repo/vault-explorer.service';

/**
 * A navigation segment. `collection` renders a records table; `record`
 * renders a single record's fields plus a probe for nested subcollections.
 *
 * `dataPath` is the physical directory that holds the collection's records
 * (its `$records/` sibling). For a root collection it comes from
 * `loadRootCollectionSchema()`; for a nested subcollection we compute it from
 * the parent record's directory (see FORMAT.md — subcollections nest under
 * the parent record, e.g. `spaces/family/contacts/$records/c1.yaml`).
 */
interface IVaultCollectionSegment {
  readonly kind: 'collection';
  readonly id: string;
  readonly label: string;
  dataPath: string; // updated once the root schema resolves the true path
  readonly rootId: string;
}

interface IVaultRecordSegment {
  readonly kind: 'record';
  readonly id: string;
  readonly label: string;
  readonly recordDir: string;
  readonly record: IVaultRecordRow;
}

type VaultSegment = IVaultCollectionSegment | IVaultRecordSegment;

@Component({
  selector: 'sneat-datatug-vault-explorer-page',
  templateUrl: './vault-explorer-page.component.html',
  styleUrls: ['./vault-explorer-page.component.scss'],
  providers: [VaultExplorerService],
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonIcon,
    IonButton,
    IonInput,
    IonSpinner,
    IonBadge,
    IonNote,
  ],
})
export class VaultExplorerPageComponent {
  private readonly explorer = inject(VaultExplorerService);

  // Connect form. The token is a password field kept in memory only — it is
  // never persisted and is sent only to api.github.com by the client.
  protected readonly repoInput = signal('');
  protected readonly branchInput = signal('main');
  protected readonly tokenInput = signal('');

  /** Set once Connect succeeds in creating a client for a repo/branch. */
  protected readonly connection = signal<
    { repo: string; branch: string } | undefined
  >(undefined);

  /** `undefined` while loading the vault config. */
  protected readonly collections = signal<
    IVaultCollectionEntry[] | undefined
  >(undefined);

  /** Path below the collections root, alternating collection/record. */
  protected readonly path = signal<VaultSegment[]>([]);

  /** `undefined` while the current collection's records are loading. */
  protected readonly records = signal<IVaultRecordRow[] | undefined>(
    undefined,
  );
  protected readonly recordColumns = signal<string[]>([]);

  /** `undefined` while probing the current record for subcollections. */
  protected readonly subcollections = signal<string[] | undefined>(undefined);
  protected readonly subcollectionsNote = signal<string | undefined>(
    undefined,
  );

  protected readonly error = signal<string | undefined>(undefined);

  /** Records-table load failure — distinct from `error` (the connect-level
   * banner) so a failed load renders an error branch with Retry next to the
   * table instead of masquerading as "No records in this collection." */
  protected readonly recordsError = signal<string | undefined>(undefined);

  protected readonly currentSegment = computed<VaultSegment | undefined>(
    () => {
      const path = this.path();
      return path[path.length - 1];
    },
  );

  /** Root collection the current path descends from — to highlight it. */
  protected readonly activeRootId = computed<string | undefined>(() => {
    const first = this.path()[0];
    return first?.kind === 'collection' ? first.rootId : undefined;
  });

  /** Ignores responses of superseded requests (user navigated away). */
  private lastRequestId = 0;

  protected async connect(): Promise<void> {
    const repo = this.repoInput().trim();
    const branch = this.branchInput().trim() || 'main';
    const token = this.tokenInput().trim() || undefined;
    if (!repo.includes('/')) {
      this.error.set('Repository must be in "owner/repo" format');
      return;
    }
    const requestId = ++this.lastRequestId;
    this.explorer.connect(token);
    this.connection.set({ repo, branch });
    this.collections.set(undefined);
    this.path.set([]);
    this.error.set(undefined);
    try {
      const collections = await this.explorer.loadCollections(repo, branch);
      if (requestId !== this.lastRequestId) {
        return;
      }
      this.collections.set(collections);
      if (collections.length === 0) {
        this.error.set(
          'No collections found. Is there a .ingitdb/root-collections.yaml at the repo root?',
        );
      }
    } catch (err) {
      if (requestId !== this.lastRequestId) {
        return;
      }
      // Fable refactoring: was `this.collections.set([]);` — setting [] made
      // the failure render as the "(none)" empty state (error masquerading
      // as empty per states.md). Leaving `collections` undefined + gating the
      // spinner on !error() in the template shows only the danger banner; the
      // ever-present Connect/Reconnect button is the retry affordance.
      this.error.set(`Failed to load vault config: ${vaultErrorMessage(err)}`);
    }
  }

  protected openRootCollection(entry: IVaultCollectionEntry): void {
    this.path.set([
      {
        kind: 'collection',
        id: entry.id,
        label: entry.id,
        dataPath: entry.path ?? entry.id,
        rootId: entry.id,
      },
    ]);
    void this.loadRecords();
  }

  protected openRecord(record: IVaultRecordRow): void {
    const seg = this.currentSegment();
    if (seg?.kind !== 'collection') {
      return;
    }
    const id = String(record['_id'] ?? '?');
    this.path.set([
      ...this.path(),
      {
        kind: 'record',
        id,
        label: id,
        recordDir: `${seg.dataPath}/${id}`,
        record,
      },
    ]);
    void this.probeSubcollections();
  }

  protected openSubcollection(name: string): void {
    const seg = this.currentSegment();
    if (seg?.kind !== 'record') {
      return;
    }
    this.path.set([
      ...this.path(),
      {
        kind: 'collection',
        id: `${seg.recordDir}/${name}`,
        label: name,
        dataPath: `${seg.recordDir}/${name}`,
        rootId: this.activeRootId() ?? name,
      },
    ]);
    void this.loadRecords();
  }

  /** `depth` = number of segments to keep; 0 = the collections root. */
  protected goToBreadcrumb(depth: number): void {
    this.path.set(this.path().slice(0, depth));
    const seg = this.currentSegment();
    if (seg?.kind === 'collection') {
      void this.loadRecords();
    } else if (seg?.kind === 'record') {
      void this.probeSubcollections();
    }
  }

  /** JSON of the record's own fields, without client metadata. */
  protected jsonOf(record: IVaultRecordRow): string {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (!VAULT_META_FIELDS.has(key)) {
        clean[key] = value;
      }
    }
    return JSON.stringify(clean, null, 2);
  }

  protected cellText(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  protected filePathOf(record: IVaultRecordRow): string | undefined {
    const path = record['_path'];
    return path ? String(path) : undefined;
  }

  /** Loads records for the current (collection) segment. */
  private async loadRecords(): Promise<void> {
    const conn = this.connection();
    const path = this.path();
    const seg = path[path.length - 1];
    if (!conn || seg?.kind !== 'collection') {
      return;
    }
    const requestId = ++this.lastRequestId;
    this.records.set(undefined);
    this.recordColumns.set([]);
    this.recordsError.set(undefined);
    try {
      let schema: IVaultCollectionSchema;
      let dataPath = seg.dataPath;
      // Root collections resolve their schema (and true data path) via
      // root-collections.yaml. Nested subcollections carry an explicit
      // dataPath already, so we read their records directly.
      if (path.length === 1) {
        const loaded = await this.explorer.loadRootCollectionSchema(
          conn.repo,
          conn.branch,
          seg.rootId,
        );
        schema = loaded.schema;
        dataPath = loaded.collectionPath;
      } else {
        schema = {} as IVaultCollectionSchema;
      }
      const records = await this.explorer.loadRecords(
        conn.repo,
        conn.branch,
        seg.id,
        schema,
        dataPath,
      );
      if (requestId !== this.lastRequestId) {
        return;
      }
      seg.dataPath = dataPath;
      this.records.set(records);
      this.recordColumns.set(columnsOf(records, schema));
    } catch (err) {
      if (requestId !== this.lastRequestId) {
        return;
      }
      // Fable refactoring: was `this.records.set([]); this.error.set(...)` —
      // [] made a load failure render as "No records in this collection."
      // (error masquerading as empty per states.md). Keep `records`
      // undefined and set the dedicated recordsError, which renders as a
      // danger item with a Retry button next to the table.
      this.recordsError.set(`Failed to load records: ${vaultErrorMessage(err)}`);
    }
  }

  /** Template-facing retry for a failed records load. */
  protected retryLoadRecords(): void {
    void this.loadRecords();
  }

  /** Probes the current record's directory for nested subcollections. */
  private async probeSubcollections(): Promise<void> {
    const conn = this.connection();
    const seg = this.currentSegment();
    if (!conn || seg?.kind !== 'record') {
      return;
    }
    const requestId = ++this.lastRequestId;
    this.subcollections.set(undefined);
    this.subcollectionsNote.set(undefined);
    try {
      const subs = await this.explorer.listSubcollections(
        conn.repo,
        seg.recordDir,
        conn.branch,
      );
      if (requestId !== this.lastRequestId) {
        return;
      }
      this.subcollections.set(subs);
    } catch (err) {
      if (requestId !== this.lastRequestId) {
        return;
      }
      this.subcollections.set([]);
      this.subcollectionsNote.set(
        `could not probe subcollections: ${vaultErrorMessage(err)}`,
      );
    }
  }
}

/**
 * Column order: schema `columns_order` first, then any extra keys present on
 * the records themselves (metadata fields excluded).
 */
function columnsOf(
  records: IVaultRecordRow[],
  schema: IVaultCollectionSchema,
): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const column of schema.columns_order ?? []) {
    if (!seen.has(column)) {
      columns.push(column);
      seen.add(column);
    }
  }
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!VAULT_META_FIELDS.has(key) && !seen.has(key)) {
        columns.push(key);
        seen.add(key);
      }
    }
  }
  return columns;
}
