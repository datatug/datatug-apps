import { Component, Input, InjectionToken, computed, inject, signal } from '@angular/core';
import { IonButton, IonCard, IonCardHeader, IonCardTitle, IonItem, IonLabel, IonList } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import type { IProjectRef } from '../../../core/project-context';
import { projectPageHref } from '../../../nav/project-page-href';
import { GithubProjectReaderService } from '../../../services/repo/github/github-project-reader.service';
import { DEMODB_DATASETS, DemoDbLocalCopy, type DemoDbDataset, type LocalDemoDbConnection } from '../environment/demo-db-local-copy';

const datasets = DEMODB_DATASETS;
type Dataset = DemoDbDataset;

export const DEMODB_LOCAL_COPY = new InjectionToken<DemoDbLocalCopy>('DemoDB local browser copy', {
  providedIn: 'root', factory: () => new DemoDbLocalCopy(),
});
type Storage = 'sqlite' | 'postgresql' | 'ingitdb';
interface BigQueryEdition {
  readonly id: string;
  readonly dataset: Dataset;
  readonly storage: 'bigquery';
  readonly sourceProjectId: 'demodb-dev';
  readonly datasetId: Dataset;
  readonly location: 'US';
  readonly authentication: 'google-account-required';
  readonly executionProjectId: 'user-selected';
  readonly publicReadRole: 'READER';
  readonly publicReadPrincipal: 'allAuthenticatedUsers';
  readonly readiness: 'public-read-user-project-required';
  readonly query: 'not-enabled-in-browser';
  readonly copy: 'not-enabled';
  readonly tableCount: number;
  readonly rowCount: number;
  readonly sourceRepository: string;
  readonly sourceRevision: string;
  readonly sourceSqliteSha256: string;
  readonly verification: string;
}
const projectId = 'datatug-demo-project@datatug@demo-project-1';
const chinookPostgresqlQueryId = 'demodb/chinook-postgresql-artist-tracks';

interface DemoDbConnection {
  readonly id: string;
  readonly dataset: Dataset;
  readonly storage: Storage;
  readonly tags: readonly string[];
  readonly environments: readonly string[];
  readonly readiness: 'public-api' | 'hosted-api-pending' | 'hosted-repository';
  readonly source: string;
  readonly fixtureSha256?: string;
  readonly query: 'ovdb-read' | 'setup-required' | 'local-checkout-required';
}

interface ConnectionCatalog {
  readonly format: 'datatug-demo-connections/v1';
  readonly connections: readonly DemoDbConnection[];
  readonly bigQueryEditions?: readonly BigQueryEdition[];
  readonly bigQueryPlans: readonly {
    readonly id: string;
    readonly title: string;
    readonly directory: string;
    readonly readiness: 'setup-required';
  }[];
}

function validCatalog(raw: ConnectionCatalog): boolean {
  if (raw?.format !== 'datatug-demo-connections/v1' || !Array.isArray(raw.connections) ||
      raw.connections.length !== datasets.length * 3 || !Array.isArray(raw.bigQueryPlans)) return false;
  const editionsValid = datasets.every((dataset) => (['sqlite', 'postgresql', 'ingitdb'] as const).every((storage) => {
    const matches = raw.connections.filter((entry) => entry.id === `${dataset}-${storage}`);
    if (matches.length !== 1) return false;
    const entry = matches[0];
    return entry.dataset === dataset && entry.storage === storage &&
      Array.isArray(entry.tags) && entry.tags.includes(dataset) && entry.tags.includes(storage) &&
      Array.isArray(entry.environments) &&
      (storage !== 'sqlite' || (entry.readiness === 'public-api' &&
        entry.source === `https://demodb.dev/ovdb/v1/databases/${dataset}`)) &&
      (storage !== 'postgresql' ||
        (entry.readiness === 'hosted-api-pending' && entry.query === 'setup-required' &&
          entry.source === `https://demodb.dev/${dataset}/`) ||
        (entry.readiness === 'public-api' && entry.query === 'ovdb-read' &&
          entry.source === `https://cloud.openvaultdb.com/v1/databases/${dataset}-postgresql`)) &&
      (storage !== 'ingitdb' || (entry.readiness === 'hosted-repository' &&
        new RegExp(`^https://github\\.com/demo-db/${dataset}/tree/[a-f0-9]{40}/ingitdb$`).test(entry.source)));
  }));
  const hostedEditions = raw.bigQueryEditions;
  const bigQueryValid = hostedEditions === undefined || (
    Array.isArray(hostedEditions) && hostedEditions.length === datasets.length && datasets.every((dataset) => {
      const matches = hostedEditions.filter((edition) => edition?.id === `${dataset}-bigquery`);
      if (matches.length !== 1) return false;
      const edition = matches[0];
      return edition.dataset === dataset && edition.storage === 'bigquery' &&
        edition.sourceProjectId === 'demodb-dev' && edition.datasetId === dataset && edition.location === 'US' &&
        edition.authentication === 'google-account-required' && edition.executionProjectId === 'user-selected' &&
        edition.publicReadRole === 'READER' && edition.publicReadPrincipal === 'allAuthenticatedUsers' &&
        edition.readiness === 'public-read-user-project-required' && edition.query === 'not-enabled-in-browser' &&
        edition.copy === 'not-enabled' && Number.isSafeInteger(edition.tableCount) && edition.tableCount > 0 &&
        Number.isSafeInteger(edition.rowCount) && edition.rowCount >= 0 &&
        /^https:\/\/github\.com\/demo-db\/[a-z0-9-]+$/.test(edition.sourceRepository) &&
        /^[a-f0-9]{40}$/.test(edition.sourceRevision) && /^[a-f0-9]{64}$/.test(edition.sourceSqliteSha256) &&
        edition.verification === 'https://github.com/demo-db/websites/blob/main/config/bigquery-hosting.json';
    })
  );
  return editionsValid && bigQueryValid && raw.bigQueryPlans.every((plan) => plan?.readiness === 'setup-required' &&
    /^https:\/\/github\.com\/openvaultdb\/directory\/blob\/[a-f0-9]{40}\/index\.json$/.test(plan.directory));
}

@Component({
  selector: 'sneat-datatug-demodb-connections',
  standalone: true,
  imports: [IonButton, IonCard, IonCardHeader, IonCardTitle, IonItem, IonLabel, IonList],
  template: `
    @if (catalog()) {
      <ion-card>
        <ion-card-header><ion-card-title>Database connections</ion-card-title></ion-card-header>
        <ion-list>
          @for (edition of catalog()!.connections; track edition.id) {
            <ion-item>
              <ion-label>
                <strong>{{ edition.dataset }} / {{ edition.storage }}</strong>
                <p>{{ edition.tags.join(' · ') }} · {{ edition.environments.join(', ') }}</p>
                <p>{{ readiness(edition) }}</p>
                <a [href]="edition.source" target="_blank" rel="noopener noreferrer">Source</a>
                @if (edition.id === 'chinook-postgresql' && edition.readiness === 'public-api' && chinookQueryHref()) {
                  · <a [href]="chinookQueryHref()">Explore PostgreSQL artist track totals</a>
                }
                @if (progress()[edition.dataset] && edition.storage === 'sqlite') {
                  <p>Copying {{ progress()[edition.dataset]!.done }} / {{ progress()[edition.dataset]!.total }} rows ({{ progress()[edition.dataset]!.table }})</p>
                }
                @if (messages()[edition.dataset] && edition.storage === 'sqlite') {
                  <p role="status">{{ messages()[edition.dataset] }}</p>
                }
              </ion-label>
              @if (edition.storage === 'sqlite') {
                @if (busy()[edition.dataset]) {
                  <ion-button slot="end" (click)="cancel(edition.dataset)">Cancel copy</ion-button>
                } @else {
                  <ion-button slot="end" [disabled]="activeCopy() !== undefined || !edition.fixtureSha256" (click)="copy(edition)">Copy to local Dev</ion-button>
                }
              }
            </ion-item>
          }
          @for (copy of localConnections(); track copy.id) {
            <ion-item>
              <ion-label>
                <strong>{{ copy.dataset }} / IndexedDB / Dev</strong>
                <p>{{ copy.tags.join(' · ') }} · {{ copy.rowCount }} rows · saved in this browser</p>
                <p>Copied from {{ copy.sourceConnectionId }} · per-table snapshots · descriptor-declared provenance</p>
                <p>Exact numeric wire tokens support typed filters and sorting. Source foreign keys are metadata only.</p>
                <a [href]="localQueryHref(copy.dataset)">Open local Dev query</a>
              </ion-label>
              @if (copy.retiredDatabaseNames.length) {
                <ion-button slot="end" (click)="clearRetired(copy.dataset)">Clear old copies</ion-button>
              }
            </ion-item>
          }
        </ion-list>
      </ion-card>
      @if (catalog()!.bigQueryEditions?.length) {
        <ion-card>
          <ion-card-header><ion-card-title>Hosted BigQuery editions</ion-card-title></ion-card-header>
          <ion-list>
            @for (edition of catalog()!.bigQueryEditions ?? []; track edition.id) {
              <ion-item>
                <ion-label>
                  <strong>{{ edition.dataset }} · {{ edition.tableCount }} tables · {{ edition.rowCount.toLocaleString() }} rows</strong>
                  <p>Source: {{ edition.sourceProjectId }}.{{ edition.datasetId }} · {{ edition.location }} · source revision {{ edition.sourceRevision }}</p>
                  <p>Google account required. Choose your own BigQuery execution project before querying; charges apply to that project. Browser queries and copy are not enabled.</p>
                  <p>Source SQLite SHA-256: <code>{{ edition.sourceSqliteSha256 }}</code></p>
                  <a href="https://console.cloud.google.com/bigquery" target="_blank" rel="noopener noreferrer">Open BigQuery Console and select your execution project</a>
                  · <a [href]="edition.verification" target="_blank" rel="noopener noreferrer">Verified hosting manifest</a>
                </ion-label>
              </ion-item>
            }
          </ion-list>
        </ion-card>
      }
      <ion-card>
        <ion-card-header><ion-card-title>BigQuery discoveries (setup planned)</ion-card-title></ion-card-header>
        <ion-list>
          @for (plan of catalog()!.bigQueryPlans; track plan.id) {
            <ion-item><ion-label>{{ plan.title }} · your Google account and execution project required
              <p><a [href]="plan.directory" target="_blank" rel="noopener noreferrer">OVDB Directory</a> · Query unavailable</p>
            </ion-label></ion-item>
          }
        </ion-list>
      </ion-card>
    } @else if (error()) {
      <ion-card><ion-item><ion-label role="alert">{{ error() }}</ion-label></ion-item></ion-card>
    }
  `,
})
export class DemoDbConnectionsComponent {
  private readonly reader = inject(GithubProjectReaderService);
  private readonly copyService = inject(DEMODB_LOCAL_COPY);
  private readonly controllers = new Map<DemoDbDataset, AbortController>();
  private loadEpoch = 0;
  private currentProjectRef?: IProjectRef;
  protected readonly catalog = signal<ConnectionCatalog | undefined>(undefined);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly chinookQueryHref = signal<string | undefined>(undefined);
  protected readonly local = signal<Partial<Record<DemoDbDataset, LocalDemoDbConnection>>>({});
  protected readonly localConnections = computed(() => Object.values(this.local()).filter((entry): entry is LocalDemoDbConnection => !!entry));
  protected readonly busy = signal<Partial<Record<DemoDbDataset, boolean>>>({});
  protected readonly progress = signal<Partial<Record<DemoDbDataset, { done: number; total: number; table: string }>>>({});
  protected readonly messages = signal<Partial<Record<DemoDbDataset, string>>>({});
  protected readonly activeCopy = signal<DemoDbDataset | undefined>(undefined);

  @Input() set projectRef(ref: IProjectRef | undefined) {
    const epoch = ++this.loadEpoch;
    this.currentProjectRef = ref;
    this.local.set({});
    this.catalog.set(undefined);
    this.error.set(undefined);
    this.chinookQueryHref.set(undefined);
    if (ref?.storeId === 'github.com' && ref.projectId === projectId) {
      const page = projectPageHref(ref, ['query', chinookPostgresqlQueryId]);
      if (page !== '/') this.chinookQueryHref.set(`${page}?id=${encodeURIComponent(chinookPostgresqlQueryId)}`);
      void this.load(epoch);
    }
  }

  private async load(epoch: number): Promise<void> {
    try {
      const data = await firstValueFrom(this.reader.getRawJson<ConnectionCatalog>(projectId, 'connections/demo-db.json'));
      if (epoch !== this.loadEpoch) return;
      if (!data || !validCatalog(data)) throw new Error('Invalid catalogue');
      this.catalog.set(data);
      void this.loadLocal(epoch);
    } catch {
      if (epoch === this.loadEpoch) this.error.set('The shared DemoDB connection catalogue could not be loaded.');
    }
  }

  /** A browser without usable IndexedDB must not hide the shared catalogue. */
  private async loadLocal(epoch: number): Promise<void> {
    try {
      const connections = await Promise.all(datasets.map(async (id) => [id, await this.copyService.connection(id)] as const));
      if (epoch === this.loadEpoch) this.local.set(Object.fromEntries(connections.filter(([, value]) => value)));
    } catch { /* No local copies are listed. */ }
  }

  protected readiness(entry: DemoDbConnection): string {
    if (entry.readiness === 'public-api') return entry.storage === 'postgresql'
      ? 'Public read-only PostgreSQL through OVDB'
      : 'Public read-only OVDB API';
    if (entry.readiness === 'hosted-repository') return 'Pinned inGitDB repository; local checkout required for queries';
    return 'PostgreSQL query endpoint pending';
  }

  protected async copy(entry: DemoDbConnection): Promise<void> {
    if (entry.storage !== 'sqlite' || entry.readiness !== 'public-api' || !entry.fixtureSha256 || this.activeCopy()) return;
    const controller = new AbortController();
    this.activeCopy.set(entry.dataset);
    this.controllers.set(entry.dataset, controller);
    this.busy.update((value) => ({ ...value, [entry.dataset]: true }));
    this.messages.update((value) => ({ ...value, [entry.dataset]: undefined }));
    try {
      const complete = await this.copyService.copy(entry.dataset, entry.fixtureSha256, controller.signal,
        (done, total, table) => this.progress.update((value) => ({ ...value, [entry.dataset]: { done, total, table } })));
      this.local.update((value) => ({ ...value, [entry.dataset]: complete }));
      this.messages.update((value) => ({ ...value, [entry.dataset]: 'Local Dev copy is ready.' }));
    } catch (error) {
      this.messages.update((value) => ({ ...value, [entry.dataset]:
        controller.signal.aborted ? 'Copy cancelled; previous local copy retained.' :
          error instanceof Error ? error.message : 'Copy failed; previous local copy retained.' }));
    } finally {
      this.controllers.delete(entry.dataset);
      this.activeCopy.set(undefined);
      this.busy.update((value) => ({ ...value, [entry.dataset]: false }));
      this.progress.update((value) => ({ ...value, [entry.dataset]: undefined }));
    }
  }

  protected cancel(dataset: DemoDbDataset): void { this.controllers.get(dataset)?.abort(); }
  protected localQueryHref(dataset: DemoDbDataset): string { return projectPageHref(this.currentProjectRef, ['local-dev', dataset]); }

  protected async clearRetired(dataset: DemoDbDataset): Promise<void> {
    try {
      const removed = await this.copyService.clearRetired(dataset);
      const current = await this.copyService.connection(dataset);
      if (current) this.local.update((value) => ({ ...value, [dataset]: current }));
      this.messages.update((value) => ({ ...value, [dataset]: `Cleared ${removed} old local copies.` }));
    } catch (error) {
      this.messages.update((value) => ({ ...value, [dataset]: error instanceof Error ? error.message : 'Old-copy cleanup failed.' }));
    }
  }
}
