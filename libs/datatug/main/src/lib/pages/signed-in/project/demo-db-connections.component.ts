import { Component, Input, InjectionToken, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  IonButton, IonCard, IonCardHeader, IonCardTitle, IonItem, IonLabel, IonList,
} from '@ionic/angular';
import type { IProjectRef } from '../../../core/project-context';
import { projectPageHref } from '../../../nav/project-page-href';
import { GithubProjectReaderService } from '../../../services/repo/github/github-project-reader.service';
import { DEMODB_DATASETS, DemoDbLocalCopy, type DemoDbDataset, type LocalDemoDbConnection } from '../environment/demo-db-local-copy';

export interface DemoDbEditionConnection {
  readonly id: string;
  readonly dataset: DemoDbDataset;
  readonly storage: 'sqlite' | 'postgresql' | 'ingitdb';
  readonly tags: readonly string[];
  readonly environments: readonly string[];
  readonly readiness: 'public-api' | 'hosted-api-pending' | 'hosted-repository';
  readonly source: string;
  readonly fixtureSha256?: string;
  readonly query: 'ovdb-read' | 'setup-required' | 'local-checkout-required';
  readonly copy: 'explicit-browser-import' | 'unavailable';
}

interface DemoDbConnectionCatalog {
  readonly format: 'datatug-demo-connections/v1';
  readonly connections: readonly DemoDbEditionConnection[];
  readonly bigQueryPlans: readonly { readonly id: string; readonly title: string; readonly directory: string; readonly readiness: 'setup-required' }[];
}

export const DEMODB_LOCAL_COPY = new InjectionToken<DemoDbLocalCopy>('DemoDB local browser copy', {
  providedIn: 'root', factory: () => new DemoDbLocalCopy(),
});

const projectId = 'datatug-demo-project@datatug@demo-project-1';

function validateCatalog(raw: DemoDbConnectionCatalog): DemoDbConnectionCatalog {
  if (raw?.format !== 'datatug-demo-connections/v1' || !Array.isArray(raw.connections) ||
      raw.connections.length !== DEMODB_DATASETS.length * 3 || !Array.isArray(raw.bigQueryPlans)) {
    throw new Error('The shared DemoDB connection catalogue is incomplete.');
  }
  for (const dataset of DEMODB_DATASETS) {
    for (const storage of ['sqlite', 'postgresql', 'ingitdb'] as const) {
      const matches = raw.connections.filter((entry) => entry.id === `${dataset}-${storage}`);
      if (matches.length !== 1 || matches[0].dataset !== dataset || matches[0].storage !== storage ||
          !matches[0].tags.includes(dataset) || !matches[0].tags.includes(storage) ||
          !Array.isArray(matches[0].environments) ||
          (storage === 'sqlite' && (matches[0].source !== `https://demodb.dev/ovdb/v1/databases/${dataset}` ||
            !/^[a-f0-9]{64}$/.test(matches[0].fixtureSha256 ?? '') || matches[0].readiness !== 'public-api')) ||
          (storage === 'postgresql' && matches[0].readiness !== 'hosted-api-pending') ||
          (storage === 'ingitdb' && matches[0].readiness !== 'hosted-repository')) {
        throw new Error('The shared DemoDB connection catalogue has an invalid edition.');
      }
    }
  }
  return raw;
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
                  <ion-button slot="end" [disabled]="activeCopy() !== undefined" (click)="copy(edition)">Copy to local Dev</ion-button>
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
      <ion-card>
        <ion-card-header><ion-card-title>BigQuery discoveries (setup planned)</ion-card-title></ion-card-header>
        <ion-list>
          @for (plan of catalog()!.bigQueryPlans; track plan.id) {
            <ion-item><ion-label>{{ plan.title }} · user's Google account and execution project required
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
  protected readonly catalog = signal<DemoDbConnectionCatalog | undefined>(undefined);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly local = signal<Partial<Record<DemoDbDataset, LocalDemoDbConnection>>>({});
  protected readonly localConnections = computed(() => Object.values(this.local()).filter((entry): entry is LocalDemoDbConnection => !!entry));
  protected readonly busy = signal<Partial<Record<DemoDbDataset, boolean>>>({});
  protected readonly progress = signal<Partial<Record<DemoDbDataset, { done: number; total: number; table: string }>>>({});
  protected readonly messages = signal<Partial<Record<DemoDbDataset, string>>>({});
  protected readonly activeCopy = signal<DemoDbDataset | undefined>(undefined);

  @Input() set projectRef(ref: IProjectRef | undefined) {
    const epoch = ++this.loadEpoch;
    this.currentProjectRef = ref;
    if (ref?.storeId !== 'github.com' || ref.projectId !== projectId) {
      this.catalog.set(undefined);
      this.error.set(undefined);
      return;
    }
    void this.load(epoch);
  }

  private async load(epoch: number): Promise<void> {
    try {
      const data = await firstValueFrom(this.reader.getRawJson<DemoDbConnectionCatalog>(projectId, 'connections/demo-db.json'));
      if (epoch !== this.loadEpoch) return;
      this.catalog.set(validateCatalog(data as DemoDbConnectionCatalog));
      const connections = await Promise.all(DEMODB_DATASETS.map(async (id) => [id, await this.copyService.connection(id)] as const));
      if (epoch !== this.loadEpoch) return;
      this.local.set(Object.fromEntries(connections.filter(([, value]) => value)));
    } catch {
      if (epoch === this.loadEpoch) this.error.set('The shared DemoDB connection catalogue could not be loaded.');
    }
  }

  protected readiness(entry: DemoDbEditionConnection): string {
    if (entry.readiness === 'public-api') return 'Public read-only OVDB API';
    if (entry.readiness === 'hosted-repository') return 'Pinned inGitDB repository; local checkout required for queries';
    return 'PostgreSQL query endpoint pending';
  }

  protected async copy(entry: DemoDbEditionConnection): Promise<void> {
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
