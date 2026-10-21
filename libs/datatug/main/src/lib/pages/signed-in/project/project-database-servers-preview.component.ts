import { Component, Input, OnDestroy, inject, signal } from '@angular/core';
import {
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
} from '@ionic/angular';
import { Subscription } from 'rxjs';
import type { IProjectRef } from '../../../core/project-context';
import { getDbServerId } from '../../../models/definition/apis/database';
import { tryProjectUrl } from '../../../nav/nav-models';
import { DbServerService } from '../../../services/unsorted/db-server.service';

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
  imports: [IonCard, IonCardHeader, IonCardTitle, IonIcon, IonItem, IonLabel, IonList],
  template: `
    <ion-card>
      <ion-card-header>
        <ion-card-title>Database connections</ion-card-title>
      </ion-card-header>
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
          @for (server of servers(); track server.id) {
            <ion-item>
              <ion-icon name="server-outline" slot="start" color="medium" aria-hidden="true" />
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
          }
        </ion-list>
      } @else {
        <ion-item>
          <ion-label
            >No database connections are configured for this project.</ion-label
          >
        </ion-item>
      }
    </ion-card>
  `,
})
export class ProjectDatabaseServersPreviewComponent implements OnDestroy {
  private readonly service = inject(DbServerService);
  private load?: Subscription;
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly servers = signal<readonly ServerLink[]>([]);

  @Input() set projectRef(ref: IProjectRef | undefined) {
    this.load?.unsubscribe();
    this.servers.set([]);
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
