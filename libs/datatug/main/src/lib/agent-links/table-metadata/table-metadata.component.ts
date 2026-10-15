import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  IonBadge,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonItem,
  IonLabel,
  IonList,
  IonText,
} from '@ionic/angular';
import { Subscription } from 'rxjs';
import {
  AgentLinkApiService,
  AgentTableRef,
  AgentTableSchema,
  LinkProblem,
  classifyAgentError,
} from '../agent-link-api.service';

/**
 * The metadata of a table read live from its registered source through the agent (Feature claude-mod-web-links,
 * Task 7): its columns with their types, the primary key and the tables that reference it. A source that was never
 * scanned shows the same, since the agent reads the schema from the source itself.
 */
@Component({
  selector: 'sneat-datatug-table-metadata',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    IonText,
    IonBadge,
  ],
  template: `
    @if (schema(); as s) {
      <ion-card>
        <ion-card-header>
          <ion-card-title>Columns</ion-card-title>
        </ion-card-header>
        <ion-list data-testid="table-metadata-columns">
          @for (col of s.columns; track col.name) {
            <ion-item>
              <ion-label>{{ col.name }}</ion-label>
              @if (s.primaryKey.includes(col.name)) {
                <ion-badge slot="end" color="primary">PK</ion-badge>
              }
              <ion-text slot="end" color="medium">{{ col.type }}</ion-text>
            </ion-item>
          }
        </ion-list>
      </ion-card>
      <ion-card>
        <ion-card-header>
          <ion-card-title>Primary key</ion-card-title>
        </ion-card-header>
        <ion-card-content data-testid="table-metadata-pk">
          @if (s.primaryKey.length) {
            {{ s.primaryKey.join(', ') }}
          } @else {
            <ion-text color="medium">No primary key.</ion-text>
          }
        </ion-card-content>
      </ion-card>
      <ion-card>
        <ion-card-header>
          <ion-card-title>Foreign keys</ion-card-title>
        </ion-card-header>
        <ion-card-content data-testid="table-metadata-foreign-keys">
          @for (fk of s.foreignKeys; track fk.name + $index) {
            <p>
              {{ fk.name }}: ({{ fk.columns.join(', ') }}) &rarr;
              {{ fk.refTable.schema ? fk.refTable.schema + '.' : '' }}{{ fk.refTable.name }}
              ({{ fk.refColumns.join(', ') }})
            </p>
          } @empty {
            <ion-text color="medium">No foreign keys.</ion-text>
          }
        </ion-card-content>
      </ion-card>
      <ion-card>
        <ion-card-header>
          <ion-card-title>Referenced by</ion-card-title>
        </ion-card-header>
        <ion-card-content data-testid="table-metadata-referenced-by">
          @if (s.referencedBy.length) {
            {{ s.referencedBy.join(', ') }}
          } @else {
            <ion-text color="medium">No table references it.</ion-text>
          }
        </ion-card-content>
      </ion-card>
    } @else if (problem(); as p) {
      <ion-card>
        <ion-card-content data-testid="table-metadata-problem">
          <ion-text color="danger">The table metadata cannot be shown: {{ p }}</ion-text>
        </ion-card-content>
      </ion-card>
    } @else {
      <ion-card>
        <ion-card-content>
          <ion-text color="medium">Loading table metadata…</ion-text>
        </ion-card-content>
      </ion-card>
    }
  `,
})
export class TableMetadataComponent {
  private readonly api = inject(AgentLinkApiService);

  readonly tableRef = input.required<AgentTableRef>();

  readonly schema = signal<AgentTableSchema | undefined>(undefined);
  readonly problem = signal<LinkProblem | undefined>(undefined);

  private subscription?: Subscription;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.subscription?.unsubscribe());
    effect(() => this.load(this.tableRef()));
  }

  /** Reads the schema again (the page's "Check again"). */
  reload(): void {
    this.load(this.tableRef());
  }

  private load(ref: AgentTableRef): void {
    this.subscription?.unsubscribe();
    this.schema.set(undefined);
    this.problem.set(undefined);
    this.subscription = this.api.tableSchema(ref).subscribe({
      next: (schema) => this.schema.set(schema),
      error: (err: unknown) => this.problem.set(classifyAgentError(err)),
    });
  }
}
