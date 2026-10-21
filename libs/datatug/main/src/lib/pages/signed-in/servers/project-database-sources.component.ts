import { Component, input, output } from '@angular/core';
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonIcon,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
} from '@ionic/angular';
import { IDbServer } from '../../../models/definition/apis/database';

export interface ProjectDatabaseTarget {
  readonly kind: 'catalog' | 'server';
  readonly environment?: string;
  readonly catalog?: string;
  readonly server?: IDbServer;
}

export interface ProjectDatabaseInstance {
  readonly key: string;
  readonly title: string;
  readonly driver: string;
  readonly detail: string;
  readonly environments: readonly string[];
  readonly availability: string;
  readonly source?: string;
  readonly target?: ProjectDatabaseTarget;
  readonly deleting?: boolean;
}

export interface ProjectDatabaseGroup {
  readonly key: string;
  readonly title: string;
  readonly kind: 'database' | 'server';
  readonly instances: readonly ProjectDatabaseInstance[];
}

@Component({
  selector: 'sneat-datatug-project-database-sources',
  templateUrl: './project-database-sources.component.html',
  styleUrls: ['./project-database-sources.component.scss'],
  imports: [
    IonBadge,
    IonButton,
    IonButtons,
    IonIcon,
    IonItem,
    IonItemDivider,
    IonLabel,
    IonList,
  ],
})
export class ProjectDatabaseSourcesComponent {
  readonly groups = input.required<readonly ProjectDatabaseGroup[]>();
  readonly loading = input(false);
  readonly emptyMessage = input('No databases are configured in this project.');
  readonly environmentsError = input<string>();
  readonly declarationsError = input<string>();
  readonly serversError = input<string>();

  protected databaseCount(): number {
    return this.groups().filter((group) => group.kind === 'database').length;
  }

  protected instanceCount(): number {
    return this.groups().reduce(
      (total, group) => total + group.instances.length,
      0,
    );
  }

  readonly openTarget = output<ProjectDatabaseTarget>();
  readonly retryDeclarations = output<void>();
  readonly retryServers = output<void>();
  readonly addServer = output<void>();
  readonly removeServer = output<{
    readonly event: Event;
    readonly target: ProjectDatabaseTarget;
  }>();
}
