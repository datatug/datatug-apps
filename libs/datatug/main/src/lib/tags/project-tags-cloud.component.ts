import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonItemDivider,
  IonButtons,
  IonButton,
  IonCard,
  IonChip,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
} from '@ionic/angular';
import { Observable, Subscription, map, throwError } from 'rxjs';
import { IProjectRef, isSharedProjectRef } from '../core/project-context';
import { ProjectAssetsReadService } from '../services/project/project-assets-read.service';
import { QueriesService } from '../queries/queries.service';
import { DbServerService } from '../services/unsorted/db-server.service';
import { DatatugServicesUnsortedModule } from '../services/unsorted/datatug-services-unsorted.module';
import { IQueryFolder } from '../models/definition/query-def';
import { projectPageHref } from '../nav/project-page-href';
import { HostedBoardScope } from '../board/core/hosted-board-scope';
import { TaggedItem, tagCounts } from './tags';
type Kind = 'boards' | 'queries' | 'servers';
interface CatalogState {
  items?: readonly TaggedItem[];
  error?: string;
}
function queryItems(folder: IQueryFolder | null | undefined): TaggedItem[] {
  if (!folder) throw new Error('Query catalog unavailable.');
  return [
    ...(folder.items ?? []),
    ...(folder.folders ?? []).flatMap(queryItems),
  ];
}
@Component({
  selector: 'sneat-datatug-project-tags-cloud',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [HostedBoardScope],
  imports: [
    RouterLink,
    IonItemDivider,
    IonButtons,
    IonCard,
    IonChip,
    IonItem,
    IonLabel,
    IonButton,
    IonSelect,
    IonSelectOption,
    DatatugServicesUnsortedModule,
  ],
  template: `<ion-card>
    <ion-item-divider color="light"
      ><ion-label
        ><h2>Tags</h2>
        <p>Project items, counted once per tag.</p></ion-label
      ><ion-buttons slot="end"
        ><ion-button color="medium" fill="clear" (click)="reload()"
          >Reload tags</ion-button
        ></ion-buttons
      ></ion-item-divider
    >
    @if (shared()) {
      <ion-item
        ><ion-select
          label="Board environment"
          [value]="scope.environment()"
          (ionChange)="scope.choose($event.detail.value)"
        >
          @for (environment of scope.environments(); track environment) {
            <ion-select-option [value]="environment">{{
              environment
            }}</ion-select-option>
          }
        </ion-select></ion-item
      >
      @if (scope.loading()) {
        <p class="ion-padding-horizontal" role="status">
          Loading project access…
        </p>
      }
      @if (scope.error()) {
        <p class="ion-padding-horizontal" role="alert">{{ scope.error() }}</p>
      }
    }
    @for (kind of kinds; track kind) {
      @if (catalog()[kind].error; as error) {
        <p class="ion-padding-horizontal" role="status">
          {{ labels[kind] }}: {{ error }}
        </p>
      } @else if (!catalog()[kind].items) {
        <p class="ion-padding-horizontal" role="status">
          Loading {{ labels[kind].toLowerCase() }} tags…
        </p>
      }
    }
    <div class="tags-cloud">
      @for (entry of entries(); track entry.tag) {
        <section [attr.aria-label]="'Tag ' + entry.tag">
          <strong>{{ entry.tag }}</strong>
          @for (kind of kinds; track kind) {
            @if (catalog()[kind].items) {
              <a
                [routerLink]="href(kind)"
                [queryParams]="params(kind, entry.tag)"
                ><ion-chip [outline]="true"
                  >{{ labels[kind] }}: {{ entry.counts[kind] }}</ion-chip
                ></a
              >
            }
          }
        </section>
      } @empty {
        @if (complete()) {
          <p>
            No tags yet. Open a board, query, or database server to add tags.
          </p>
        } @else {
          <p>No tags are available from the loaded item catalogs.</p>
        }
      }
    </div>
  </ion-card>`,
  styles: [
    `
      .tags-cloud {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        padding: 0 1rem 1rem;
      }
      .tags-cloud section {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.25rem;
      }
      .tags-cloud a {
        text-decoration: none;
      }
    `,
  ],
})
export class ProjectTagsCloudComponent {
  readonly projectRef = input<IProjectRef>();
  readonly scope = inject(HostedBoardScope);
  private readonly assets = inject(ProjectAssetsReadService);
  private readonly queries = inject(QueriesService);
  private readonly servers = inject(DbServerService);
  readonly kinds: Kind[] = ['boards', 'queries', 'servers'];
  readonly labels = {
    boards: 'Boards',
    queries: 'Queries',
    servers: 'Database servers',
  };
  readonly shared = computed(() => {
    const ref = this.projectRef();
    return !!ref && isSharedProjectRef(ref);
  });
  readonly catalog = signal<Record<Kind, CatalogState>>({
    boards: {},
    queries: {},
    servers: {},
  });
  private readonly revision = signal(0);
  readonly complete = computed(() =>
    this.kinds.every((kind) => !!this.catalog()[kind].items),
  );
  readonly entries = computed(() => {
    const byTag = new Map<
      string,
      { tag: string; counts: Record<Kind, number> }
    >();
    for (const kind of this.kinds)
      for (const { tag, count } of tagCounts(
        this.catalog()[kind].items ?? [],
      )) {
        const entry = byTag.get(tag) ?? {
          tag,
          counts: { boards: 0, queries: 0, servers: 0 },
        };
        entry.counts[kind] = count;
        byTag.set(tag, entry);
      }
    return [...byTag.values()].sort((a, b) => a.tag.localeCompare(b.tag));
  });
  constructor() {
    effect((onCleanup) => {
      const ref = this.projectRef();
      this.revision();
      const environment = this.scope.environment();
      const admitted = this.scope.admitted();
      const subscriptions = new Subscription();
      this.catalog.set({ boards: {}, queries: {}, servers: {} });
      if (!ref) return;
      const load = (kind: Kind, request: Observable<readonly TaggedItem[]>) =>
        subscriptions.add(
          request.subscribe({
            next: (items) =>
              this.catalog.update((value) => ({ ...value, [kind]: { items } })),
            error: () =>
              this.catalog.update((value) => ({
                ...value,
                [kind]: {
                  error: 'Unavailable. Check project access and reload.',
                },
              })),
          }),
        );
      load(
        'boards',
        this.shared() && !admitted
          ? throwError(() => new Error('Choose an admitted environment.'))
          : this.assets.boards(ref, environment),
      );
      load(
        'queries',
        this.queries.getQueriesFolder(ref, '~', 'shared').pipe(mapQueryItems()),
      );
      load(
        'servers',
        ref.spaceID
          ? throwError(
              () =>
                new Error('Server catalogs unavailable for this connection.'),
            )
          : this.servers.getDbServers(ref),
      );
      onCleanup(() => subscriptions.unsubscribe());
    });
  }
  reload(): void {
    this.scope.refresh();
    this.revision.update((value) => value + 1);
  }
  href(kind: Kind): string {
    return projectPageHref(this.projectRef(), kind);
  }
  params(kind: Kind, tag: string) {
    return {
      tag,
      ...(kind === 'queries' ? { tab: 'shared', folder: null } : {}),
      ...(kind === 'boards' && this.shared()
        ? { environment: this.scope.environment() }
        : {}),
    };
  }
}
function mapQueryItems() {
  return map((folder: IQueryFolder | null | undefined) => queryItems(folder));
}
