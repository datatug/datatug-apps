import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonMenuButton,
  IonBackButton,
  IonContent,
  IonButton,
  IonInput,
  IonCheckbox,
  IonSelect,
  IonSelectOption,
  IonIcon,
  IonSpinner,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  pricetagOutline,
  gridOutline,
  listOutline,
  eyeOutline,
  codeSlashOutline,
  barChartOutline,
  checkmarkCircleOutline,
  cubeOutline,
  serverOutline,
  layersOutline,
} from 'ionicons/icons';
import { Subscription, combineLatest } from 'rxjs';
import { SneatAuthStateService } from '@sneat/auth-core';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { IProjectRef, equalProjectRef } from '../core/project-context';
import { projectPageHref } from '../nav/project-page-href';
import { QuickSearchApiService } from './quick-search-api.service';
import { QuickSearchSnapshotService } from './quick-search-snapshot.service';
import {
  SearchDocument,
  SearchKind,
  SearchSnapshot,
  SearchStatus,
  groupSearchItems,
  kindIcons,
  kindNames,
  searchChipLabel,
  searchItemHref,
  searchKinds,
} from './quick-search-model';

@Component({
  selector: 'sneat-datatug-quick-search',
  host: {
    '[attr.data-search-view]':
      "schemaDetail ? 'schema' : discovery ? 'tags' : 'search'",
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    IonContent,
    IonButton,
    IonInput,
    IonCheckbox,
    IonSelect,
    IonSelectOption,
    IonIcon,
    IonSpinner,
  ],
  template: ` <ion-header
      ><ion-toolbar
        ><ion-buttons slot="start"
          ><ion-menu-button /><ion-back-button
            [defaultHref]="overviewHref()" /></ion-buttons
        ><ion-title>{{
          discovery
            ? 'Tag discovery'
            : schemaDetail
              ? 'Schema metadata'
              : 'Quick Search'
        }}</ion-title
        ><ion-buttons slot="end">
          @if (!discovery && !schemaDetail) {
            <ion-button (click)="settings.set(!settings())"
              >Index settings</ion-button
            >
          }
        </ion-buttons></ion-toolbar
      ></ion-header
    >
    <ion-content
      ><main>
        <p class="scope">Current project · {{ project()?.projectId }}</p>
        @if (discovery) {
          <h1>{{ query() }}</h1>
          <p>
            Items explicitly tagged with this name appear below. Matching names
            alone do not establish tag membership.
          </p>
        }
        @if (schemaDetail) {
          <h1>{{ schemaTable() }}</h1>
          <p>Selected schema snapshot · {{ schemaName() }}</p>
        }
        @if (!schemaDetail) {
          <form (ngSubmit)="search()">
            <ion-input
              label="Search project names and tags"
              fill="outline"
              labelPlacement="stacked"
              [ngModel]="query()"
              (ngModelChange)="query.set($event); invalidateSearch()"
              name="search"
            />
            <div class="filters">
              <ion-select
                label="Kind"
                [ngModel]="kind()"
                (ngModelChange)="kind.set($event); search()"
                name="kind"
                ><ion-select-option value="">All kinds</ion-select-option>
                @for (value of kinds; track value) {
                  <ion-select-option [value]="value">{{
                    names[value]
                  }}</ion-select-option>
                }</ion-select
              ><ion-input
                label="Tag filter"
                fill="outline"
                [ngModel]="tag()"
                (ngModelChange)="tag.set($event); invalidateSearch()"
                name="tag"
              /><ion-button
                type="submit"
                [disabled]="busy() || status()?.state !== 'ready'"
                >Search</ion-button
              >
            </div>
          </form>
        }
        @if (settings()) {
          <section aria-label="Index settings">
            <h2>Index settings</h2>
            @if (project()?.spaceID) {
              <p>
                Selected environment:
                {{
                  environmentId() ||
                    'None. Select an environment in project navigation to index its saved objects.'
                }}
              </p>
            }
            @if (status(); as s) {
              <p role="status">
                {{ s.state }} · {{ s.documentCount }} indexed items
                @if (s.revision !== undefined) {
                  · Revision {{ s.revision }}
                }
              </p>
              <p>
                Audience: {{ s.audience }} · Provider:
                {{ s.provider || 'Not configured' }}
              </p>
              @if (s.lastIndexedAt) {
                <p>Last indexed: {{ s.lastIndexedAt }}</p>
              }
              @if (!s.eligible) {
                <p>
                  Quick Search requires a public project or a current Pro or
                  Business account with project access.
                </p>
              }
              @if (s.canManage) {
                <ion-button
                  fill="outline"
                  (click)="preview()"
                  [disabled]="busy()"
                  >Preview selected metadata</ion-button
                >
                @if (capacityExceeded()) {
                  <p role="alert">
                    This selected snapshot exceeds the Quick Search limit of
                    1,000 items including tags or 1 MiB. Reduce the source
                    metadata before indexing.
                  </p>
                }
                @if (snapshot(); as snapshot) {
                  <p>
                    {{ snapshot.documents.length }} selected items. Fields:
                    kind, name, identifier, source, parent, tags and typed
                    reference.
                  </p>
                  <ul>
                    @for (
                      coverage of snapshot.sourceCoverage;
                      track coverage.kind
                    ) {
                      <li>
                        {{ names[coverage.kind] }}: {{ coverage.status }} ({{
                          coverage.count
                        }})
                      </li>
                    }
                  </ul>
                  <details>
                    <summary>Actual metadata preview</summary>
                    <ul>
                      @for (item of snapshot.documents; track $index) {
                        <li>
                          {{ names[item.kind] }} · {{ item.name }} ·
                          {{ item.id }}
                          @if (item.parentName) {
                            · Parent: {{ item.parentName }}
                          }
                          @if (item.tags.length) {
                            · Tags: {{ item.tags.join(', ') }}
                          }
                        </li>
                      }
                    </ul>
                  </details>
                }
                @if (s.state === 'disabled' || !s.consentVersion) {
                  <ion-checkbox
                    labelPlacement="end"
                    alignment="start"
                    [checked]="consent()"
                    (ionChange)="consent.set($event.detail.checked)"
                    >Upload selected project metadata to DataTug Quick Search,
                    powered by Typesense. This includes object names,
                    identifiers, database structure, and tags. Database rows,
                    credentials, query results, SQL text, descriptions, and
                    dashboard configuration are excluded.
                    {{
                      s.audience === 'public'
                        ? 'Anyone can search this public project.'
                        : 'Only people with current project access can find these indexed items.'
                    }}
                    You can disable search and delete the index at any
                    time.</ion-checkbox
                  ><ion-button
                    (click)="enable()"
                    [disabled]="
                      !consent() ||
                      !snapshot() ||
                      busy() ||
                      !s.eligible ||
                      capacityExceeded()
                    "
                    >Enable and index</ion-button
                  >
                } @else {
                  <ion-button
                    (click)="refresh()"
                    [disabled]="
                      !snapshot() || busy() || !s.eligible || capacityExceeded()
                    "
                    >Refresh selected snapshot</ion-button
                  >
                }
                <ion-button
                  color="danger"
                  fill="outline"
                  (click)="confirmDelete.set(true)"
                  [disabled]="busy() || s.state === 'disabled'"
                  >Disable and delete index</ion-button
                >
                @if (confirmDelete()) {
                  <p>
                    Disable search immediately and permanently delete uploaded
                    metadata?
                  </p>
                  <ion-button
                    color="danger"
                    (click)="disable()"
                    [disabled]="busy()"
                    >Confirm disable and delete</ion-button
                  ><ion-button fill="clear" (click)="confirmDelete.set(false)"
                    >Cancel</ion-button
                  >
                }
                @if (s.state === 'deleting' || s.error) {
                  <ion-button (click)="disable()" [disabled]="busy()"
                    >Retry deletion</ion-button
                  >
                }
              } @else {
                <p>
                  Only a project manager can enable indexing or delete this
                  index.
                </p>
              }
            }
          </section>
        }
        @if (busy()) {
          <p role="status"><ion-spinner /> Loading…</p>
        }
        @if (error()) {
          <p role="alert">{{ error() }}</p>
          <ion-button (click)="loadStatus()" fill="clear"
            >Retry status</ion-button
          >
        }
        @if (status()?.error) {
          <p role="alert">{{ status()?.error }}</p>
        }
        @if (!busy() && status()?.state === 'disabled') {
          <p role="status">
            Quick Search is disabled. Open Index settings to preview metadata
            and give indexing consent.
          </p>
        }
        <p aria-live="polite">
          {{ groups().length }} {{ groups().length === 1 ? 'name' : 'names' }} ·
          {{ items().length }} items
        </p>
        @if (!busy() && searched() && !groups().length) {
          <p role="status">
            {{
              discovery
                ? 'No items with this tag were found in this index.'
                : 'No matching items.'
            }}
          </p>
        }
        <ul class="results">
          @for (group of groups(); track group.key) {
            <li>
              <a class="name" [routerLink]="groupHref(group.name)">{{
                group.name
              }}</a>
              <div class="chips">
                @for (item of group.items; track $index) {
                  @if (itemHref(item); as href) {
                    <a
                      class="chip"
                      [routerLink]="href"
                      [attr.aria-label]="label(item, group)"
                      ><ion-icon
                        [name]="icons[item.kind]"
                        aria-hidden="true"
                      />{{ label(item, group) }}</a
                    >
                  } @else {
                    <span class="chip"
                      >{{ label(item, group) }} · unavailable</span
                    >
                  }
                }
              </div>
            </li>
          }
        </ul>
      </main></ion-content
    >`,
  styles: [
    `
      main {
        max-width: 960px;
        margin: auto;
        padding: 20px;
      }
      .scope {
        color: var(--ion-color-medium-shade);
        overflow-wrap: anywhere;
      }
      .filters {
        display: flex;
        gap: 12px;
        align-items: end;
        flex-wrap: wrap;
      }
      form > ion-input {
        margin-bottom: 16px;
      }
      .filters ion-select,
      .filters ion-input {
        flex: 1;
        min-width: 180px;
      }
      .filters ion-button {
        flex: none;
      }
      section {
        margin: 20px 0;
        padding: 20px 0;
        border-block: 1px solid var(--ion-color-light-shade);
      }
      ion-checkbox {
        display: block;
        margin: 20px 0;
        line-height: 1.6;
      }
      ion-checkbox::part(label) {
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
      }
      .results {
        list-style: none;
        padding: 0;
      }
      .results > li {
        padding: 18px 0;
        border-bottom: 1px solid var(--ion-color-light-shade);
      }
      .name {
        font-weight: 600;
        font-size: 1.1rem;
      }
      .chips {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 10px;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--ion-color-primary);
        border-radius: 20px;
        padding: 6px 10px;
        text-decoration: none;
        overflow-wrap: anywhere;
      }
      .chip:focus-visible,
      .name:focus-visible {
        outline: 3px solid var(--ion-color-primary);
        outline-offset: 3px;
      }
      @media (max-width: 480px) {
        main {
          padding: 14px;
        }
        .filters {
          display: block;
        }
        ion-button {
          max-width: 100%;
          white-space: normal;
        }
      }
    `,
  ],
})
export class QuickSearchPageComponent {
  private readonly auth = inject(SneatAuthStateService);
  private readonly api = inject(QuickSearchApiService);
  private readonly snapshots = inject(QuickSearchSnapshotService);
  private readonly nav = inject(DatatugNavContextService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  readonly discovery = this.route.snapshot.data['discovery'] === true;
  readonly schemaDetail = this.route.snapshot.data['schemaDetail'] === true;
  readonly project = signal<IProjectRef | undefined>(undefined);
  readonly environmentId = signal<string | undefined>(undefined);
  readonly query = signal(
    this.route.snapshot.queryParamMap.get(
      this.route.snapshot.data['discovery'] ? 'name' : 'q',
    ) || '',
  );
  readonly schemaModel = signal(
    this.route.snapshot.paramMap.get('dbModelId') || '',
  );
  readonly schemaTable = signal(
    this.route.snapshot.queryParamMap.get('table') || '',
  );
  readonly schemaColumn = signal(
    this.route.snapshot.queryParamMap.get('column') || '',
  );
  readonly schemaName = signal(
    this.route.snapshot.queryParamMap.get('schema') || '',
  );
  readonly kind = signal<SearchKind | ''>('');
  readonly tag = signal('');
  readonly status = signal<SearchStatus | undefined>(undefined);
  readonly snapshot = signal<SearchSnapshot | undefined>(undefined);
  readonly capacityExceeded = computed(() => {
    const snapshot = this.snapshot();
    if (!snapshot) return false;
    const tags = new Set(snapshot.documents.flatMap((item) => item.tags));
    return (
      snapshot.documents.length + tags.size > 1000 ||
      new TextEncoder().encode(JSON.stringify(snapshot)).byteLength >
        1024 * 1024
    );
  });
  readonly items = signal<SearchDocument[]>([]);
  readonly groups = computed(() => groupSearchItems(this.items()));
  readonly settings = signal(false);
  readonly consent = signal(false);
  readonly confirmDelete = signal(false);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly searched = signal(false);
  readonly kinds = searchKinds;
  readonly names = kindNames;
  readonly icons = kindIcons;
  readonly label = searchChipLabel;
  readonly overviewHref = computed(() =>
    projectPageHref(this.project(), ['overview']),
  );
  private generation = 0;
  private readonly authKey = signal<string | undefined>(undefined);
  private request?: Subscription;
  constructor() {
    addIcons({
      'pricetag-outline': pricetagOutline,
      'grid-outline': gridOutline,
      'list-outline': listOutline,
      'eye-outline': eyeOutline,
      'code-slash-outline': codeSlashOutline,
      'bar-chart-outline': barChartOutline,
      'checkmark-circle-outline': checkmarkCircleOutline,
      'cube-outline': cubeOutline,
      'server-outline': serverOutline,
      'layers-outline': layersOutline,
    });
    this.auth.authState.pipe(takeUntilDestroyed()).subscribe((auth) => {
      const key = JSON.stringify([auth.status, auth.user?.uid]);
      if (key === this.authKey()) return;
      this.authKey.set(key);
      this.invalidateSearch();
      this.status.set(undefined);
      this.snapshot.set(undefined);
      this.consent.set(false);
      this.confirmDelete.set(false);
      this.error.set('');
      if (auth.status !== 'authenticating') this.loadStatus();
    });
    if (this.schemaDetail && this.route.paramMap && this.route.queryParamMap) {
      combineLatest([this.route.paramMap, this.route.queryParamMap])
        .pipe(takeUntilDestroyed())
        .subscribe(([params, query]) => {
          const model = params.get('dbModelId') || '',
            schema = query.get('schema') || '',
            table = query.get('table') || '',
            column = query.get('column') || '';
          if (
            model === this.schemaModel() &&
            schema === this.schemaName() &&
            table === this.schemaTable() &&
            column === this.schemaColumn()
          )
            return;
          this.invalidateSearch();
          this.snapshot.set(undefined);
          this.schemaModel.set(model);
          this.schemaName.set(schema);
          this.schemaTable.set(table);
          this.schemaColumn.set(column);
          this.loadStatus();
        });
    }
    this.nav.currentProject.pipe(takeUntilDestroyed()).subscribe((context) => {
      if (equalProjectRef(this.project(), context?.ref)) return;
      this.generation++;
      this.request?.unsubscribe();
      this.project.set(context?.ref);
      this.status.set(undefined);
      this.items.set([]);
      this.snapshot.set(undefined);
      this.consent.set(false);
      this.error.set('');
      this.busy.set(false);
      this.loadStatus();
    });
    this.nav.currentEnv?.pipe(takeUntilDestroyed()).subscribe((environment) => {
      if (this.environmentId() !== environment?.id) {
        this.invalidateSearch();
        this.environmentId.set(environment?.id);
        this.snapshot.set(undefined);
        this.consent.set(false);
      }
    });
    this.route.queryParamMap?.pipe(takeUntilDestroyed()).subscribe((params) => {
      const query = params.get(this.discovery ? 'name' : 'q') || '';
      if (!this.schemaDetail && this.query() !== query) {
        this.query.set(query);
        this.invalidateSearch();
        this.search();
      }
    });
    this.destroy.onDestroy(() => {
      this.generation++;
      this.request?.unsubscribe();
    });
  }
  ionViewWillEnter(): void {
    this.loadStatus();
  }
  ionViewWillLeave(): void {
    this.invalidateSearch();
    this.snapshot.set(undefined);
    this.consent.set(false);
  }
  groupHref(name: string) {
    return this.itemHref({
      kind: 'tag',
      id: name,
      name,
      tags: [],
      reference: { objectId: name },
    });
  }
  itemHref(item: SearchDocument) {
    const ref = this.project();
    const href = ref ? searchItemHref(ref, item) : undefined;
    return href ? this.router.parseUrl(href) : undefined;
  }
  invalidateSearch() {
    this.generation++;
    this.request?.unsubscribe();
    this.items.set([]);
    this.busy.set(false);
    this.searched.set(false);
  }
  loadStatus() {
    const ref = this.project();
    if (!ref) return;
    const generation = ++this.generation;
    this.request?.unsubscribe();
    this.busy.set(true);
    this.items.set([]);
    this.status.set(undefined);
    this.error.set('');
    this.request = this.api.status(ref).subscribe({
      next: (status) => {
        if (generation !== this.generation) return;
        this.status.set(status);
        this.busy.set(false);
        if (!this.schemaDetail && status.state === 'ready') this.search();
        if (this.schemaDetail) void this.schemaPreview();
      },
      error: () => {
        if (generation === this.generation) {
          this.error.set(
            'Could not load index status. Check your project access and retry.',
          );
          this.busy.set(false);
        }
      },
    });
  }
  search() {
    const ref = this.project();
    if (!ref || this.status()?.state !== 'ready') return;
    if (!this.query().trim()) {
      this.invalidateSearch();
      return;
    }
    const generation = ++this.generation;
    this.request?.unsubscribe();
    this.busy.set(true);
    this.error.set('');
    this.items.set([]);
    this.request = this.api
      .search(
        ref,
        this.query(),
        this.kind() ? [this.kind() as SearchKind] : [],
        this.discovery ? [this.query()] : this.tag() ? [this.tag()] : [],
      )
      .subscribe({
        next: (result) => {
          if (generation !== this.generation) return;
          this.items.set(result.items);
          this.searched.set(true);
          this.busy.set(false);
        },
        error: () => {
          if (generation === this.generation) {
            this.error.set(
              'Search failed. Check your project access and try again.',
            );
            this.busy.set(false);
          }
        },
      });
  }
  async preview() {
    const ref = this.project();
    if (!ref) return;
    const generation = ++this.generation;
    this.request?.unsubscribe();
    this.busy.set(true);
    this.snapshot.set(undefined);
    this.error.set('');
    try {
      const snapshot = await this.snapshots.preview(ref, this.environmentId());
      if (generation === this.generation) this.snapshot.set(snapshot);
    } catch {
      if (generation === this.generation)
        this.error.set(
          'Could not read selected metadata. No metadata was uploaded.',
        );
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
  async schemaPreview() {
    const preview = this.preview();
    const generation = this.generation;
    await preview;
    if (generation !== this.generation) return;
    const model = this.schemaModel();
    this.items.set(
      (this.snapshot()?.documents || []).filter(
        (item) =>
          item.reference.dbModelId === model &&
          item.reference.schema === this.schemaName() &&
          item.reference.table === this.schemaTable() &&
          (!this.schemaColumn() ||
            item.reference.column === this.schemaColumn()),
      ),
    );
    this.searched.set(true);
  }
  enable() {
    const ref = this.project(),
      snapshot = this.snapshot();
    if (
      !ref ||
      !snapshot ||
      !this.consent() ||
      this.capacityExceeded() ||
      this.busy()
    )
      return;
    this.mutate(this.api.enable(ref, snapshot));
  }
  refresh() {
    const ref = this.project(),
      snapshot = this.snapshot();
    if (!ref || !snapshot || this.capacityExceeded() || this.busy()) return;
    this.mutate(this.api.refresh(ref, snapshot));
  }
  disable() {
    const ref = this.project();
    if (!ref || this.busy()) return;
    this.items.set([]);
    this.status.update((status) =>
      status ? { ...status, state: 'deleting' } : status,
    );
    this.mutate(this.api.disable(ref));
  }
  private mutate(operation: ReturnType<QuickSearchApiService['disable']>) {
    const generation = ++this.generation;
    this.request?.unsubscribe();
    this.busy.set(true);
    this.error.set('');
    this.request = operation.subscribe({
      next: (status) => {
        if (generation !== this.generation) return;
        this.status.set(status);
        this.busy.set(false);
        this.confirmDelete.set(false);
        this.consent.set(false);
        if (status.state === 'disabled') this.snapshot.set(undefined);
      },
      error: () => {
        if (generation === this.generation) {
          this.error.set(
            'Index operation failed. Retry the operation; deletion remains available.',
          );
          this.busy.set(false);
        }
      },
    });
  }
}
