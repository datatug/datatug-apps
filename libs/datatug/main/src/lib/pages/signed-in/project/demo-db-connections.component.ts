import { isDemoDbOvdbDatabaseUrl } from '../../../queries/demodb-ovdb';
import { Component, Input, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonCard, IonCardHeader, IonCardTitle, IonIcon, IonItem, IonLabel, IonList } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import type { IProjectRef } from '../../../core/project-context';
import { projectPageHref } from '../../../nav/project-page-href';
import { GithubProjectReaderService } from '../../../services/repo/github/github-project-reader.service';

const datasets = ['chinook', 'northwind', 'pubs', 'sakila', 'adventureworks', 'employees'] as const;
type Dataset = typeof datasets[number];
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

interface DatasetGroup {
  readonly id: Dataset;
  readonly connections: readonly DemoDbConnection[];
  readonly bigQuery?: BigQueryEdition;
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
        isDemoDbOvdbDatabaseUrl(entry.source, dataset))) &&
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
  imports: [RouterLink, IonCard, IonCardHeader, IonCardTitle, IonIcon, IonItem, IonLabel, IonList],
  template: `
    @if (catalog()) {
      <ion-card>
        <ion-card-header><ion-card-title>Demo databases</ion-card-title></ion-card-header>
        <ion-list>
          @for (group of groups(); track group.id) {
            <ion-item [attr.data-testid]="'dataset-' + group.id">
              <ion-icon name="server-outline" slot="start" color="medium" aria-hidden="true" />
              <ion-label>
                <strong>{{ title(group.id) }}</strong>
                @for (edition of group.connections; track edition.id) {
                  <p>
                    <strong>{{ label(edition.storage) }}</strong> · {{ readiness(edition) }}
                    · <a [href]="edition.source" target="_blank" rel="noopener noreferrer">Source</a>
                    @if (edition.id === 'chinook-postgresql' && edition.readiness === 'public-api' && chinookQueryHref()) {
                      · <a [href]="chinookQueryHref()">Explore PostgreSQL artist track totals</a>
                    }
                    @if (edition.storage === 'postgresql' && edition.readiness === 'public-api') {
                      · <a [routerLink]="['/demo', 'ovdb', edition.id]" [attr.data-testid]="'explore-postgresql-' + edition.dataset">Explore PostgreSQL in DataTug (read-only via OpenVaultDB)</a>
                    }
                    @if (edition.storage === 'sqlite') {
                      · <a [routerLink]="['/demo', 'sqlite', edition.dataset]" [attr.data-testid]="'explore-local-' + edition.dataset">Explore SQLite in DataTug (editable copy in this browser)</a>
                    }
                  </p>
                }
                @if (group.bigQuery; as edition) {
                  <p>
                    <strong>BigQuery</strong> · {{ edition.tableCount }} tables · {{ edition.rowCount.toLocaleString() }} rows.
                    Google account and your own execution project required; charges may apply. Browser querying and copying are unavailable.
                    <a href="https://console.cloud.google.com/bigquery" target="_blank" rel="noopener noreferrer">Open BigQuery Console</a>
                  </p>
                  <details>
                    <summary>BigQuery hosting details</summary>
                    <p>Source: {{ edition.sourceProjectId }}.{{ edition.datasetId }} · {{ edition.location }} · revision {{ edition.sourceRevision }}</p>
                    <p>Source SQLite SHA-256: <code>{{ edition.sourceSqliteSha256 }}</code></p>
                    <a [href]="edition.verification" target="_blank" rel="noopener noreferrer">Verified hosting manifest</a>
                  </details>
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
            <ion-item>
              <ion-icon name="server-outline" slot="start" color="medium" aria-hidden="true" />
              <ion-label>{{ plan.title }} · your Google account and execution project required
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
  protected readonly groups = computed<readonly DatasetGroup[]>(() => {
    const catalog = this.catalog();
    if (!catalog) return [];
    return datasets.map((id) => ({
      id,
      connections: catalog.connections.filter((entry) => entry.dataset === id),
      bigQuery: catalog.bigQueryEditions?.find((entry) => entry.dataset === id),
    }));
  });
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly chinookQueryHref = signal<string | undefined>(undefined);

  @Input() set projectRef(ref: IProjectRef | undefined) {
    const epoch = ++this.loadEpoch;
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
    } catch {
      if (epoch === this.loadEpoch) this.error.set('The shared DemoDB connection catalogue could not be loaded.');
    }
  }

  protected readiness(entry: DemoDbConnection): string {
    if (entry.readiness === 'public-api') return entry.storage === 'postgresql'
      ? 'Public read-only PostgreSQL through OVDB'
      : 'Public read-only OVDB API';
    if (entry.readiness === 'hosted-repository') return 'Pinned inGitDB repository; local checkout required for queries';
    return 'PostgreSQL query endpoint pending';
  }

  protected title(dataset: Dataset): string {
    return dataset === 'adventureworks' ? 'AdventureWorks' : dataset[0].toUpperCase() + dataset.slice(1);
  }

  protected label(storage: Storage): string {
    return storage === 'sqlite' ? 'SQLite' : storage === 'ingitdb' ? 'inGitDB' : 'PostgreSQL';
  }
}
