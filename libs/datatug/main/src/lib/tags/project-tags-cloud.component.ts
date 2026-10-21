import { refreshOutline } from 'ionicons/icons';
import { IDbServer, getDbServerId } from '../models/definition/apis/database';
import { projectTagLink, projectItemLink } from './tag-navigation';
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
  IonList,
  IonIcon,
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
import { HostedBoardScope } from '../board/core/hosted-board-scope';
import { TaggedItem, tagCounts } from './tags';
type Kind = 'boards' | 'queries' | 'servers';
interface CatalogState {
  items?: readonly CatalogItem[];
  error?: string;
}
interface CatalogItem extends TaggedItem {
  readonly id?: string;
  readonly title?: string;
  readonly dbServer?: IDbServer;
}
function queryItems(
  folder: IQueryFolder | null | undefined,
  path: readonly string[] = [],
): CatalogItem[] {
  if (!folder) throw new Error('Query catalog unavailable.');
  return [
    ...(folder.items ?? []).map((item) => ({
      ...item,
      id: [...path, item.id].join('/'),
    })),
    ...(folder.folders ?? []).flatMap((child) =>
      queryItems(child, [...path, child.id]),
    ),
  ];
}
@Component({
  selector: 'sneat-datatug-project-tags-cloud',
  host: {class: 'ph-no-capture ph-mask sentry-mask', 'data-sentry-mask': ''},
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [HostedBoardScope],
  imports: [
    RouterLink,
    IonItemDivider,
    IonButtons,
    IonCard,
    IonChip,
    IonItem,
    IonList,
    IonIcon,
    IonLabel,
    IonButton,
    IonSelect,
    IonSelectOption,
    DatatugServicesUnsortedModule,
  ],
  template: `<ion-card>
    <ion-item-divider color="light"
      ><ion-label
        ><h2>
          {{ selectedTag() === undefined ? 'Tags' : 'Tag: ' + selectedTag() }}
        </h2>
        <p>
          {{
            selectedTag() === undefined
              ? 'Project items, counted once per tag.'
              : 'Matching project items. Open an item to view its details and tag editing access.'
          }}
        </p></ion-label
      ><ion-buttons slot="end"
        ><ion-button
          color="medium"
          fill="clear"
          aria-label="Reload tags"
          title="Reload tags"
          (click)="reload()"
          ><ion-icon
            slot="icon-only"
            [icon]="refreshIcon" /></ion-button></ion-buttons
    ></ion-item-divider>
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
    @if (selectedTag() !== undefined) {
      <ion-list class="tag-items">
        @for (kind of kinds; track kind) {
          <ion-item-divider color="light"
            ><ion-label>{{ labels[kind] }}</ion-label></ion-item-divider
          >
          @if (catalog()[kind].items) {
            @for (item of matchingItems(kind); track itemKey(item)) {
              <ion-item [routerLink]="itemHref(kind, item)" detail="true">
                <ion-label class="ion-text-wrap">{{
                  itemTitle(kind, item)
                }}</ion-label>
              </ion-item>
            } @empty {
              <ion-item lines="none"
                ><ion-label
                  >No matching {{ labels[kind].toLowerCase() }}.</ion-label
                ></ion-item
              >
            }
          }
        }
      </ion-list>
    } @else {
      <ion-list class="tags-cloud">
        @for (entry of entries(); track entry.tag) {
          <ion-item class="tag-row">
            <ion-label class="ion-text-wrap"
              ><a [routerLink]="tagHref(projectRef(), entry.tag)"
                ><strong>{{ entry.tag }}</strong></a
              ></ion-label
            >
            <div
              slot="end"
              class="tag-counts"
              role="group"
              [attr.aria-label]="'Tag ' + entry.tag"
            >
              @for (kind of kinds; track kind) {
                @if (catalog()[kind].items && entry.counts[kind] > 0) {
                  <a [routerLink]="href(kind, entry.tag)">
                    <ion-chip [outline]="true"
                      >{{ labels[kind] }}: {{ entry.counts[kind] }}</ion-chip
                    >
                  </a>
                }
              }
            </div>
          </ion-item>
        } @empty {
          <ion-item lines="none"
            ><ion-label class="ion-text-wrap">
              @if (complete()) {
                No tags yet. Open a board, query, or database server to add
                tags.
              } @else {
                No tags are available from the loaded item catalogs.
              }
            </ion-label></ion-item
          >
        }
      </ion-list>
    }
  </ion-card>`,
  styles: [
    `
      .tag-counts {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        max-width: 100%;
      }
      .tag-counts a {
        text-decoration: none;
      }
      .tag-row::part(native) {
        flex-wrap: wrap;
      }
      .tag-row ion-label {
        min-width: 6rem;
      }
    `,
  ],
})
export class ProjectTagsCloudComponent {
  readonly projectRef = input<IProjectRef>();
  readonly selectedTag = input<string>();
  readonly tagHref = projectTagLink;
  readonly refreshIcon = refreshOutline;
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
      // Project refs can remain unchanged across sign-out/account changes.
      this.scope.page?.identity();
      const subscriptions = new Subscription();
      this.catalog.set({ boards: {}, queries: {}, servers: {} });
      if (!ref) return;
      const load = (kind: Kind, request: Observable<readonly CatalogItem[]>) =>
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
  matchingItems(kind: Kind): readonly CatalogItem[] {
    return (this.catalog()[kind].items ?? []).filter((item) =>
      item.tags?.includes(this.selectedTag() ?? ''),
    );
  }
  itemKey(item: CatalogItem): string {
    return item.dbServer
      ? `${item.dbServer.driver}:${getDbServerId(item.dbServer)}`
      : (item.id ?? '');
  }
  itemTitle(kind: Kind, item: CatalogItem): string {
    return (
      item.title ||
      (kind === 'servers' && item.dbServer
        ? `${item.dbServer.driver}: ${item.dbServer.host || '(no host)'}${item.dbServer.port ? ':' + item.dbServer.port : ''}`
        : item.id) ||
      'Project item'
    );
  }
  itemHref(kind: Kind, item: CatalogItem) {
    const ref = this.projectRef();
    if (kind === 'servers' && item.dbServer)
      return projectItemLink(
        ref,
        ['servers', 'db', item.dbServer.driver, getDbServerId(item.dbServer)],
        item.id ? { definitionId: item.id } : {},
      );
    return projectItemLink(
      ref,
      kind === 'boards'
        ? ['board', item.id ?? '']
        : this.shared()
          ? ['query', item.id ?? '']
          : 'query',
      this.itemParams(kind, item),
    );
  }
  itemParams(kind: Kind, item: CatalogItem) {
    return kind === 'queries'
      ? { id: item.id }
      : kind === 'boards' && this.shared()
        ? { environment: this.scope.environment() }
        : {};
  }
  reload(): void {
    this.scope.refresh();
    this.revision.update((value) => value + 1);
  }
  href(kind: Kind, tag: string) {
    return projectItemLink(this.projectRef(), kind, this.params(kind, tag));
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
