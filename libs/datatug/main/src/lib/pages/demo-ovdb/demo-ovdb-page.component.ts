// /demo/ovdb/:database — "Explore PostgreSQL in DataTug" from a DemoDB.dev database page.
//
// Entry: the DemoDB site's link (https://datatug.app/demo/ovdb/<dataset>-postgresql), the demo project's
// "Database connections" card, and this page's own list. No sign-in, nothing to create: the page opens the hosted
// PostgreSQL edition THROUGH the public OpenVaultDB server (cloud.openvaultdb.com), never Neon directly, and
// lands in its table list. The edition is read-only: every control is decided by the descriptor's capabilities
// (OvdbDatabaseBrowserComponent), which for these databases offer browsing only.
//
//   /demo/ovdb                                 list of the hosted editions
//   /demo/ovdb/<unknown>                       "no such database" + list
//   /demo/ovdb/<dataset>-postgresql            connecting → table list (OvdbDatabaseBrowserComponent)
//   /demo/ovdb/<dataset>-postgresql/table/<t>  rows + record view (read-only)
//
// Failures: a database that is still mounting is retried with a back-off (retryingOvdbFetch); when that is not
// enough the page says so and offers "Try again".
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { map } from 'rxjs';
import {
  DEMO_POSTGRESQL_LABEL,
  demoPostgresqlCatalog,
  demoPostgresqlDatasetIds,
  findDemoPostgresqlEdition,
  type DemoPostgresqlCatalogEntry,
} from '../../demo-postgresql/demo-postgresql-catalog';
import { openDemoPostgresql } from '../../demo-postgresql/demo-postgresql-connection';
import type { OvdbConnection } from '../../ovdb/ovdb-connection';
import { OvdbDatabaseBrowserComponent } from '../../ovdb/ovdb-database-browser.component';
import { describeOvdbError } from '../../ovdb/ovdb-records';

type OpenState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'connecting' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly connection: OvdbConnection };

@Component({
  selector: 'sneat-datatug-demo-ovdb-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonBackButton,
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonContent,
    IonHeader,
    IonItem,
    IonLabel,
    IonList,
    IonMenuButton,
    IonNote,
    IonSpinner,
    IonTitle,
    IonToolbar,
    OvdbDatabaseBrowserComponent,
  ],
  styles: `
    /* The back button leads to the table list: say so where there is room, keep the arrow only on a phone. */
    @media (max-width: 575px) { .back-to-tables::part(text) { display: none; } }
  `,
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-menu-button />
          <ion-back-button class="back-to-tables" [defaultHref]="backHref()" [text]="tableParam() ? 'All tables' : undefined" />
        </ion-buttons>
        <ion-title>{{
          entry()
            ? entry()!.title + ' · hosted PostgreSQL'
            : 'DemoDB in DataTug'
        }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content color="light">
      @if (!entry()) {
        <ion-card data-testid="demo-ovdb-editions">
          <ion-card-header>
            <ion-card-title>{{
              databaseParam()
                ? 'There is no hosted DemoDB database “' + databaseParam() + '”'
                : 'Explore a hosted PostgreSQL DemoDB'
            }}</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <p>
              {{ label }}: browse a sample database that lives on PostgreSQL,
              served by the public OpenVaultDB server. No sign-in needed.
            </p>
          </ion-card-content>
          <ion-list lines="full">
            @for (edition of editions; track edition.dataset) {
              <ion-item
                [routerLink]="['/demo', 'ovdb', edition.databaseId]"
                [attr.data-testid]="'edition-' + edition.dataset"
              >
                <ion-label>{{ edition.title }}</ion-label>
                <ion-note slot="end">{{ edition.tableCount }} tables</ion-note>
              </ion-item>
            }
          </ion-list>
        </ion-card>
      } @else {
        @switch (state().kind) {
          @case ('failed') {
            <ion-card data-testid="demo-ovdb-failed">
              <ion-card-content>
                <p role="alert">{{ failure() }}</p>
                <ion-button data-testid="demo-ovdb-retry" (click)="retry()"
                  >Try again</ion-button
                >
              </ion-card-content>
            </ion-card>
          }
          @case ('ready') {
            <ion-card data-testid="demo-ovdb-readonly">
              <ion-card-content>
                <p>
                  <strong>{{ label }}.</strong>
                  {{ entry()!.title }} is read from a PostgreSQL database that
                  is served through the public OpenVaultDB server. Nothing here
                  can change it, and this page holds no database credentials.
                  <a
                    [routerLink]="['/demo', 'sqlite', entry()!.dataset]"
                    data-testid="demo-ovdb-sqlite-link"
                    >Open an editable SQLite copy in this browser instead</a
                  >.
                </p>
              </ion-card-content>
            </ion-card>
            @if (connection(); as connection) {
              <sneat-datatug-ovdb-database-browser
                [connection]="connection"
                [basePath]="basePath()"
                [table]="tableParam()"
                [statusText]="label"
                [showTitle]="false"
              />
            }
          }
          @default {
            <ion-card data-testid="demo-ovdb-connecting">
              <ion-item lines="none">
                <ion-spinner slot="start" />
                <ion-label class="ion-text-wrap" role="status">
                  Connecting to {{ entry()!.title }} through OpenVaultDB… A
                  hosted database that has been idle can take a few seconds to
                  wake up.
                </ion-label>
              </ion-item>
            </ion-card>
          }
        }
      }
    </ion-content>
  `,
})
export class DemoOvdbPageComponent {
  private readonly route = inject(ActivatedRoute);

  protected readonly label = DEMO_POSTGRESQL_LABEL;
  protected readonly editions = demoPostgresqlDatasetIds.map(
    (id) => demoPostgresqlCatalog[id],
  );
  protected readonly databaseParam = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('database') ?? '')),
    {
      initialValue: this.route.snapshot.paramMap.get('database') ?? '',
    },
  );
  protected readonly tableParam = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('table') ?? undefined)),
    {
      initialValue: this.route.snapshot.paramMap.get('table') ?? undefined,
    },
  );
  protected readonly entry = computed<DemoPostgresqlCatalogEntry | undefined>(
    () => findDemoPostgresqlEdition(this.databaseParam()),
  );
  protected readonly state = signal<OpenState>({ kind: 'idle' });
  protected readonly connection = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? state.connection : undefined;
  });
  protected readonly failure = computed(() => {
    const state = this.state();
    return state.kind === 'failed' ? state.message : '';
  });
  protected readonly basePath = computed(() => [
    '/demo',
    'ovdb',
    this.entry()?.databaseId ?? '',
  ]);
  protected readonly backHref = computed(() => {
    const entry = this.entry();
    return entry && this.tableParam() ? entry.route : '/demo/ovdb';
  });
  readonly #attempt = signal(0);
  #epoch = 0;

  constructor() {
    // One connection per database (`entry` keeps its identity while only the table changes). "Try again" opens it again.
    effect(() => {
      const entry = this.entry();
      this.#attempt();
      untracked(() => void this.open(entry));
    });
  }

  private async open(
    entry: DemoPostgresqlCatalogEntry | undefined,
  ): Promise<void> {
    const epoch = ++this.#epoch;
    if (!entry) {
      this.state.set({ kind: 'idle' });
      return;
    }
    this.state.set({ kind: 'connecting' });
    try {
      const connection = await openDemoPostgresql(entry);
      if (epoch === this.#epoch) this.state.set({ kind: 'ready', connection });
    } catch (error) {
      if (epoch === this.#epoch)
        this.state.set({
          kind: 'failed',
          message: describeOvdbError(error, 'load'),
        });
    }
  }

  protected retry(): void {
    this.#attempt.update((n) => n + 1);
  }
}
