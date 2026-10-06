import { Component, Input, inject, signal } from '@angular/core';
import { IonCard, IonCardHeader, IonCardTitle, IonItem, IonLabel, IonList } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import type { IProjectRef } from '../../../core/project-context';
import { GithubProjectReaderService } from '../../../services/repo/github/github-project-reader.service';

const datasets = ['chinook', 'northwind', 'pubs', 'sakila', 'adventureworks', 'employees'] as const;
type Dataset = typeof datasets[number];
type Storage = 'sqlite' | 'postgresql' | 'ingitdb';
const projectId = 'datatug-demo-project@datatug@demo-project-1';

interface DemoDbConnection {
  readonly id: string;
  readonly dataset: Dataset;
  readonly storage: Storage;
  readonly tags: readonly string[];
  readonly environments: readonly string[];
  readonly readiness: 'public-api' | 'hosted-api-pending' | 'hosted-repository';
  readonly source: string;
  readonly query: 'ovdb-read' | 'setup-required' | 'local-checkout-required';
}

interface ConnectionCatalog {
  readonly format: 'datatug-demo-connections/v1';
  readonly connections: readonly DemoDbConnection[];
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
      (storage !== 'postgresql' || (entry.readiness === 'hosted-api-pending' &&
        entry.source === `https://demodb.dev/${dataset}/`)) &&
      (storage !== 'ingitdb' || (entry.readiness === 'hosted-repository' &&
        new RegExp(`^https://github\\.com/demo-db/${dataset}/tree/[a-f0-9]{40}/ingitdb$`).test(entry.source)));
  }));
  return editionsValid && raw.bigQueryPlans.every((plan) => plan?.readiness === 'setup-required' &&
    /^https:\/\/github\.com\/openvaultdb\/directory\/blob\/[a-f0-9]{40}\/index\.json$/.test(plan.directory));
}

@Component({
  selector: 'sneat-datatug-demodb-connections',
  standalone: true,
  imports: [IonCard, IonCardHeader, IonCardTitle, IonItem, IonLabel, IonList],
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
                @if (edition.storage === 'sqlite') {
                  <p>Copy to local Dev will be available after the browser database update.</p>
                }
              </ion-label>
            </ion-item>
          }
        </ion-list>
      </ion-card>
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
  private loadEpoch = 0;
  protected readonly catalog = signal<ConnectionCatalog | undefined>(undefined);
  protected readonly error = signal<string | undefined>(undefined);

  @Input() set projectRef(ref: IProjectRef | undefined) {
    const epoch = ++this.loadEpoch;
    this.catalog.set(undefined);
    this.error.set(undefined);
    if (ref?.storeId === 'github.com' && ref.projectId === projectId) void this.load(epoch);
  }

  private async load(epoch: number): Promise<void> {
    try {
      const data = await firstValueFrom(this.reader.getRawJson<ConnectionCatalog>(projectId, 'connections/demo-db.json'));
      if (epoch !== this.loadEpoch) return;
      if (!data || !validCatalog(data)) throw new Error('Invalid catalogue');
      this.catalog.set(data);
    } catch {
      if (epoch === this.loadEpoch) this.error.set('The shared DemoDB connection catalogue could not be loaded.');
    }
  }

  protected readiness(entry: DemoDbConnection): string {
    if (entry.readiness === 'public-api') return 'Public read-only OVDB API';
    if (entry.readiness === 'hosted-repository') return 'Pinned inGitDB repository; local checkout required for queries';
    return 'PostgreSQL query endpoint pending';
  }
}
