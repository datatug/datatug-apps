import {
  Component,
  Input,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { IonIcon, IonItem, IonLabel, IonList } from '@ionic/angular';
import { Subscription } from 'rxjs';
import type { IProjectRef } from '../../../core/project-context';
import { getDbServerId } from '../../../models/definition/apis/database';
import { tryProjectUrl } from '../../../nav/nav-models';
import { DbServerService } from '../../../services/unsorted/db-server.service';
import { projectPageHref } from '../../../nav/project-page-href';
import {
  ProjectOverviewCardComponent,
  matchesOverviewFilter,
} from './project-overview-card.component';

interface ServerLink {
  readonly id: string;
  readonly label: string;
  readonly driver: string;
  readonly databasesCount: number;
  readonly href?: string;
}

/** The overview uses the same server read as the full Servers page. */
@Component({
  selector: 'sneat-datatug-project-database-servers-preview',
  standalone: true,
  imports: [ProjectOverviewCardComponent, IonIcon, IonItem, IonLabel, IonList],
  template: `
    <sneat-datatug-project-overview-card
      cardTitle="Database connections"
      filterNoun="database connections"
      testId="overview-databases-card"
      [titleHref]="serversHref()"
      [filterable]="state() === 'ready' && servers().length > 0"
      [(filter)]="filter"
    >
      @if (state() === 'loading') {
        <ion-item
          ><ion-label>Loading database connections…</ion-label></ion-item
        >
      } @else if (state() === 'error') {
        <ion-item>
          <ion-label role="alert"
            >Database connections could not be loaded.</ion-label
          >
        </ion-item>
      } @else if (servers().length) {
        <ion-list>
          @for (server of filteredServers(); track server.id) {
            <ion-item>
              <ion-icon
                name="server-outline"
                slot="start"
                color="medium"
                aria-hidden="true"
              />
              <ion-label>
                @if (server.href; as href) {
                  <a [href]="href">{{ server.label }}</a>
                } @else {
                  {{ server.label }}
                }
                <p>
                  {{ server.driver }} · {{ server.databasesCount }}
                  {{ server.databasesCount === 1 ? 'database' : 'databases' }}
                </p>
              </ion-label>
            </ion-item>
          } @empty {
            <ion-item lines="none">
              <ion-label color="medium"
                >No database connections match “{{ filter() }}”.</ion-label
              >
            </ion-item>
          }
        </ion-list>
      } @else {
        <ion-item>
          <ion-label
            >No database connections are configured for this project.</ion-label
          >
        </ion-item>
      }
    </sneat-datatug-project-overview-card>
  `,
})
export class ProjectDatabaseServersPreviewComponent implements OnDestroy {
  private readonly service = inject(DbServerService);
  private load?: Subscription;
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly servers = signal<readonly ServerLink[]>([]);
  /** The quick filter typed in the card; matches a connection's host or driver. */
  readonly filter = signal('');
  protected readonly filteredServers = computed(() => {
    const filter = this.filter();
    return this.servers().filter((server) =>
      matchesOverviewFilter(filter, server.label, server.driver),
    );
  });
  protected readonly serversHref = signal<string | undefined>(undefined);

  @Input() set projectRef(ref: IProjectRef | undefined) {
    this.load?.unsubscribe();
    this.servers.set([]);
    this.filter.set('');
    this.serversHref.set(ref ? projectPageHref(ref, 'servers') : undefined);
    this.state.set('loading');
    if (!ref) return;
    this.load = this.service.getDbServers(ref).subscribe({
      next: (items) => {
        this.servers.set(
          (items ?? []).map(({ dbServer, databasesCount }) => {
            const id = getDbServerId(dbServer);
            const url = tryProjectUrl(ref, [
              'servers',
              'db',
              dbServer.driver,
              id,
            ]);
            return {
              id: `${dbServer.driver}:${id}`,
              label: dbServer.host?.trim() || '(no host)',
              driver: dbServer.driver,
              databasesCount,
              href: typeof url === 'string' ? url : undefined,
            };
          }),
        );
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  ngOnDestroy(): void {
    this.load?.unsubscribe();
  }
}
