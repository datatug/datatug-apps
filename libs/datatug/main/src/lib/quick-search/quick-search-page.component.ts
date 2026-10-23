import { BusinessClockChipComponent } from '../source-workspace/business-clock-chip.component';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  DestroyRef,
  effect,
  untracked,
  Injector,
} from '@angular/core';
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
  IonCard,
  IonCardContent,
  IonItemDivider,
  IonItemGroup,
  IonItem,
  IonLabel,
  IonList,
  IonBadge,
  IonRouterLink,
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
  optionsOutline,
  closeOutline,
  searchOutline,
} from 'ionicons/icons';
import {
  Subscription,
  combineLatest,
  firstValueFrom,
  of,
  switchMap,
  timeout,
} from 'rxjs';
import {
  takeUntilDestroyed,
  toObservable,
  toSignal,
} from '@angular/core/rxjs-interop';
import { readGithubProjectId } from '@datatug/project-address';
import { ErrorStateComponent } from '../components/error-state/error-state.component';
import { QueryListItemComponent } from '../components/query-list-item/query-list-item.component';
import { QueryTextPreviewService } from '../components/query-list-item/query-text-preview.service';
import {
  ProjectQuickSearchBoxComponent,
  QUICK_SEARCH_DEBOUNCE_MS,
  registerQuickSearchIcons,
} from './project-quick-search-box.component';
import {
  MetadataItem,
  MetadataKind,
  MetadataMatch,
  fold,
  fromSearchDocument,
  groupMatches,
  highlightParts,
  matchMetadata,
  secondaryLines,
  metadataGroupTitles,
  metadataKinds,
  quickSearchErrorMessage,
  isSignedInViewer,
} from './project-metadata-search';
import { debouncedSignal } from './debounced-signal';
import {
  ProjectMetadataSearchService,
  ProjectMetadataState,
} from './project-metadata-search.service';
import { SneatAuthStateService } from '@sneat/auth-core';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import {
  IProjectRef,
  equalProjectRef,
  isSharedProjectRef,
} from '../core/project-context';
import { projectPageHref, withQuery } from '../nav/project-page-href';
import { QuickSearchApiService } from './quick-search-api.service';
import { QuickSearchSnapshotService } from './quick-search-snapshot.service';
import {
  checkMetadataTarget,
  SearchDocument,
  SearchSnapshot,
  SearchStatus,
  groupSearchItems,
  kindIcons,
  kindNames,
  searchChipLabel,
  searchItemHref,
} from './quick-search-model';

@Component({
  selector: 'sneat-datatug-quick-search',
  host: {
    '[attr.data-search-view]':
      "checkDetail() ? 'check' : schemaDetail ? 'schema' : discovery ? 'tags' : 'search'",
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BusinessClockChipComponent,
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
    IonCard,
    IonCardContent,
    IonItemDivider,
    IonItemGroup,
    IonItem,
    IonLabel,
    IonList,
    IonBadge,
    IonRouterLink,
    ErrorStateComponent,
    ProjectQuickSearchBoxComponent,
    QueryListItemComponent,
  ],
  template: ` <ion-header
      ><ion-toolbar
        ><ion-buttons slot="start"
          ><ion-menu-button /><ion-back-button
            [defaultHref]="overviewHref()" /></ion-buttons
        ><ion-title
          >{{
            checkDetail()
              ? 'Check metadata'
              : discovery
                ? 'Tag discovery'
                : schemaDetail
                  ? 'Schema metadata'
                  : 'Quick Search'
          }}<sneat-datatug-business-clock /></ion-title
        ><ion-buttons slot="end">
          @if (!discovery && !schemaDetail && !checkDetail()) {
            <ion-button
              class="index-settings-button"
              color="medium"
              aria-label="Index settings"
              title="Index settings"
              [attr.aria-expanded]="settings()"
              aria-controls="quick-search-index-settings"
              (click)="settings.set(!settings())"
              ><ion-icon
                slot="icon-only"
                name="options-outline"
                aria-hidden="true"
            /></ion-button>
          }</ion-buttons></ion-toolbar
    ></ion-header>
    <ion-content color="light"
      ><main>
        @if (!schemaDetail && !checkDetail()) {
          <ion-card class="search-card">
            <ion-item-divider color="light">
              <ion-label
                ><h2>
                  {{ discovery ? 'Tag · ' + query() : 'Search this project' }}
                </h2></ion-label
              >
            </ion-item-divider>
            <ion-card-content>
              <p class="scope">{{ projectLabel() }}</p>
              @if (discovery) {
                <p class="hint">
                  Items explicitly tagged with this name. Matching names alone
                  do not establish tag membership.
                </p>
              } @else {
                <sneat-datatug-project-quick-search-box
                  label="Search names, titles, tags and descriptions"
                  [projectRef]="project()"
                  [suggestions]="false"
                  [navigateOnSubmit]="false"
                  [query]="query()"
                  (termChange)="onTerm($event)"
                  (submitted)="onTerm($event)"
                />
                <div class="filters">
                  <ion-select
                    label="Type"
                    labelPlacement="stacked"
                    fill="outline"
                    interface="popover"
                    [ngModel]="localKind()"
                    (ngModelChange)="localKind.set($event)"
                    name="kind"
                    ><ion-select-option value="">All types</ion-select-option>
                    @for (value of localKinds; track value) {
                      <ion-select-option [value]="value">{{
                        groupTitles[value]
                      }}</ion-select-option>
                    }</ion-select
                  ><ion-input
                    label="Tag filter"
                    labelPlacement="stacked"
                    fill="outline"
                    placeholder="Any tag"
                    [ngModel]="tag()"
                    (ngModelChange)="tag.set($event)"
                    name="tag"
                  />
                </div>
              }
            </ion-card-content>
          </ion-card>
        }
        @if (settings() && !checkDetail()) {
          <ion-card id="quick-search-index-settings">
            <ion-item-divider color="light">
              <ion-label><h2>Index settings</h2></ion-label>
              <ion-buttons slot="end">
                <ion-button
                  color="medium"
                  aria-label="Close Index settings"
                  title="Close"
                  (click)="settings.set(false)"
                  ><ion-icon
                    slot="icon-only"
                    name="close-outline"
                    aria-hidden="true"
                /></ion-button>
              </ion-buttons>
            </ion-item-divider>
            <ion-card-content>
              <p class="hint">
                Quick Search works without an index: it searches the project
                metadata this page already reads, in your browser. A hosted
                index is optional and only uploads names and tags after a
                project manager consents.
              </p>
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
                  {{
                    s.state === 'disabled'
                      ? 'Hosted index: not enabled'
                      : 'Hosted index: ' + s.state
                  }}
                  · {{ s.documentCount }} indexed items
                  @if (s.revision) {
                    · Revision {{ s.revision }}
                  }
                </p>
                @if (s.lastIndexedAt) {
                  <p>Last indexed: {{ s.lastIndexedAt }}</p>
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
                        !snapshot() ||
                        busy() ||
                        !s.eligible ||
                        capacityExceeded()
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
                  <p class="hint">
                    Only a project manager can enable a hosted index or delete
                    it.
                  </p>
                }
              } @else if (busy()) {
                <p role="status" class="loading">
                  <ion-spinner name="dots" aria-hidden="true" /> Loading…
                </p>
              }
              @if (error()) {
                <p role="alert" class="warning">{{ error() }}</p>
                <ion-button (click)="loadStatus()" fill="clear"
                  >Retry status</ion-button
                >
              }
              @if (status()?.error) {
                <p role="alert" class="warning">{{ statusErrorText() }}</p>
              }
            </ion-card-content>
          </ion-card>
        }
        @if (!schemaDetail && !checkDetail()) {
          <ion-card class="results-card">
            <ion-item-divider color="light">
              <ion-label><h2>Results</h2></ion-label>
              @if (resultCount()) {
                <ion-badge slot="end" color="medium" aria-live="polite">{{
                  resultCount()
                }}</ion-badge>
              }
            </ion-item-divider>
            @if (!discovery && !query().trim()) {
              <div class="state" role="status">
                <ion-icon name="search-outline" aria-hidden="true" />
                <p>
                  Type to search queries, boards, entities, databases, tables,
                  columns and tags.
                </p>
              </div>
            } @else if (resultGroups().length) {
              <ion-list lines="full">
                @for (group of resultGroups(); track group.kind) {
                  <ion-item-group>
                    <ion-item-divider color="light">
                      <ion-icon
                        slot="start"
                        [name]="group.icon"
                        aria-hidden="true"
                      />
                      <ion-label
                        ><h3>{{ group.title }}</h3></ion-label
                      >
                      <ion-badge slot="end" color="medium">{{
                        group.total
                      }}</ion-badge>
                    </ion-item-divider>
                    @for (row of group.rows; track row.key) {
                      @if (row.query; as query) {
                        <sneat-datatug-query-list-item
                          [queryTitle]="row.titleText"
                          [type]="query.type"
                          [createdAt]="query.createdAt"
                          [href]="row.link"
                          [detail]="!!row.link"
                          [highlight]="highlightTerm()"
                          [loadText]="query.loadText"
                          ><span queryRowSubtitle>{{
                            row.secondary
                          }}</span></sneat-datatug-query-list-item
                        >
                      } @else {
                        <ion-item [routerLink]="row.link" [detail]="!!row.link">
                          <ion-icon
                            slot="start"
                            [name]="row.icon"
                            color="primary"
                            aria-hidden="true"
                          />
                          <ion-label class="ion-text-wrap">
                            <h3>
                              @for (part of row.title; track $index) {
                                @if (part.hit) {
                                  <mark>{{ part.text }}</mark>
                                } @else {
                                  <span>{{ part.text }}</span>
                                }
                              }
                            </h3>
                            <p>{{ row.secondary }}</p>
                          </ion-label>
                        </ion-item>
                      }
                    }
                  </ion-item-group>
                }
              </ion-list>
              @if (localState().loading) {
                <p class="note" role="status">
                  <ion-spinner name="dots" aria-hidden="true" /> Still reading
                  project metadata…
                </p>
              }
              @if (localErrorText(); as text) {
                <p class="note warning" role="status">{{ text }}</p>
              }
            } @else if (localState().loading || hostedBusy()) {
              <div class="state" role="status">
                <ion-spinner name="dots" aria-hidden="true" />
                <p>Searching project metadata…</p>
              </div>
            } @else if (localErrorText(); as text) {
              <sneat-datatug-error-state
                compact
                title="Search could not read this project"
                [hint]="text"
                [retryable]="true"
                (retry)="retryMetadata()"
              />
            } @else {
              <div class="state" role="status">
                <ion-icon name="search-outline" aria-hidden="true" />
                <p>
                  {{
                    discovery
                      ? 'No items with this tag yet.'
                      : 'No matches for “' + query().trim() + '”.'
                  }}
                </p>
                @if (!discovery && (localKind() || tag())) {
                  <ion-button fill="clear" (click)="clearFilters()"
                    >Clear filters</ion-button
                  >
                }
              </div>
            }
          </ion-card>
        }
        @if (schemaDetail) {
          <ion-card>
            <ion-item-divider color="light">
              <ion-label
                ><h2>{{ schemaTable() }}</h2>
                <p>Selected schema snapshot · {{ schemaName() }}</p></ion-label
              >
            </ion-item-divider>
            <ion-card-content>
              @if (busy()) {
                <p role="status" class="loading">
                  <ion-spinner name="dots" aria-hidden="true" /> Loading…
                </p>
              }
              @if (error()) {
                <p role="alert" class="warning">{{ error() }}</p>
                <ion-button (click)="loadStatus()" fill="clear"
                  >Retry status</ion-button
                >
              }
              @if (!busy() && searched() && !groups().length) {
                <p role="status">No matching items.</p>
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
            </ion-card-content>
          </ion-card>
        }
        @if (checkDetail()) {
          <ion-card aria-label="Check metadata">
            <ion-item-divider color="light">
              <ion-label
                ><h2>{{ items()[0]?.name || 'Check metadata' }}</h2></ion-label
              >
            </ion-item-divider>
            <ion-card-content>
              @if (busy()) {
                <p role="status" class="loading">
                  <ion-spinner name="dots" aria-hidden="true" /> Loading…
                </p>
              }
              @if (error()) {
                <p role="alert" class="warning">{{ error() }}</p>
                <ion-button (click)="loadStatus()" fill="clear"
                  >Retry status</ion-button
                >
              }
              @if (items()[0]; as item) {
                <p>Check metadata · Read-only names and tags</p>
                <p>Identifier: {{ item.reference.objectId }}</p>
                @if (item.tags.length) {
                  <p>Tags: {{ item.tags.join(', ') }}</p>
                }
              } @else if (!busy() && !error()) {
                <p role="status">
                  This Check metadata is unavailable for the selected project.
                </p>
              }
            </ion-card-content>
          </ion-card>
        }
      </main></ion-content
    >`,
  styles: [
    `
      main {
        max-width: 960px;
        margin: auto;
        padding: 8px 0 24px;
      }
      ion-card {
        margin: 12px 16px;
      }
      ion-card > ion-item-divider h2 {
        margin: 0;
        font-size: 1.05rem;
        font-weight: 600;
      }
      ion-card-content {
        padding: 16px;
      }
      .scope,
      .hint {
        margin: 0 0 12px;
        color: var(--ion-color-medium-shade);
        overflow-wrap: anywhere;
      }
      .filters {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 12px;
        margin-top: 12px;
      }
      .state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 32px 16px;
        text-align: center;
        color: var(--ion-color-medium-shade);
      }
      .state > ion-icon {
        font-size: 32px;
      }
      .state p {
        margin: 0;
      }
      .note,
      .loading {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0;
        padding: 10px 16px;
        font-size: 0.85rem;
        color: var(--ion-color-medium-shade);
      }
      .warning {
        color: var(--ion-color-warning-shade);
      }
      ion-item-group ion-item-divider ion-icon {
        margin-inline-end: 8px;
        color: var(--ion-color-medium-shade);
      }
      ion-item-group ion-item-divider h3 {
        margin: 0;
        font-size: 0.85rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      ion-item ion-label h3 {
        font-weight: 500;
        overflow-wrap: anywhere;
      }
      ion-item ion-label p {
        overflow-wrap: anywhere;
      }
      mark {
        background: rgba(var(--ion-color-warning-rgb), 0.35);
        color: inherit;
        border-radius: 2px;
        padding: 0 1px;
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
        margin: 0;
      }
      .results > li {
        padding: 14px 0;
      }
      .results > li:not(:last-child) {
        border-bottom: 1px solid var(--ion-color-light-shade);
      }
      .name {
        font-weight: 600;
        font-size: 1.05rem;
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
      ion-button {
        max-width: 100%;
        white-space: normal;
      }
      @media (max-width: 480px) {
        ion-card {
          margin: 8px;
        }
        ion-card-content {
          padding: 12px;
        }
        .filters {
          grid-template-columns: minmax(0, 1fr);
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
  readonly detailTarget = signal(
    checkMetadataTarget(this.route.snapshot.queryParamMap),
  );
  readonly checkDetail = computed(
    () =>
      !this.schemaDetail &&
      !this.discovery &&
      this.detailTarget().kind !== 'none',
  );
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
  readonly localKind = signal<MetadataKind | ''>('');
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
  readonly localKinds = metadataKinds;
  readonly groupTitles = metadataGroupTitles;
  readonly names = kindNames;
  readonly icons = kindIcons;
  readonly label = searchChipLabel;
  readonly overviewHref = computed(() =>
    projectPageHref(this.project(), ['overview']),
  );
  readonly projectLabel = computed(() => {
    const ref = this.project();
    if (!ref) return 'Current project';
    if (['github', 'github.com'].includes(ref.storeId)) {
      const address = readGithubProjectId(ref.projectId);
      if (address.ok)
        return (
          'Current project · ' +
          [address.id.org, address.id.repo, address.id.folder]
            .filter(Boolean)
            .join('/')
        );
    }
    return 'Current project · ' + ref.projectId;
  });
  private readonly injector = inject(Injector);
  /** Resolved on first use, so the check and schema views never construct the metadata readers. */
  private get metadataService() {
    return this.injector.get(ProjectMetadataSearchService);
  }
  private readonly metadataRetry = signal(0);
  /** The project metadata the app already reads, searched in the browser: no index, no consent, no upload. */
  readonly localState = toSignal(
    combineLatest([
      toObservable(this.project),
      toObservable(this.metadataRetry),
    ]).pipe(
      switchMap(([ref]) =>
        ref && !this.schemaDetail && !this.checkDetail()
          ? this.metadataService.metadata(ref)
          : of<ProjectMetadataState>({ items: [], loading: false }),
      ),
    ),
    { initialValue: { items: [], loading: true } as ProjectMetadataState },
  );
  /** Hosted-index results, only fetched when an in-memory source failed and a hosted index is ready. */
  readonly hostedItems = signal<MetadataItem[] | undefined>(undefined);
  readonly hostedBusy = signal(false);
  readonly hostedError = signal<unknown>(undefined);
  readonly resultMatches = computed<MetadataMatch[]>(() => {
    const q = this.query().trim();
    if (!q) return [];
    // One row per object: a hosted copy of an in-memory item only adds the tags its full file carries.
    const merged = new Map<string, MetadataItem>();
    for (const item of [
      ...this.localState().items,
      ...(this.hostedItems() || []),
    ]) {
      const key = [item.kind, item.href || item.id, item.title].join('|');
      const known = merged.get(key);
      merged.set(
        key,
        known
          ? { ...known, tags: [...new Set([...known.tags, ...item.tags])] }
          : item,
      );
    }
    const items = [...merged.values()];
    if (this.discovery) {
      const name = fold(q);
      return items
        .filter(
          (item) =>
            item.kind !== 'tag' && item.tags.some((t) => fold(t) === name),
        )
        .map((item) => ({ item, field: 'tag', matched: q, rank: 0 }));
    }
    const kind = this.localKind(),
      tag = fold(this.tag().trim());
    return matchMetadata(items, q).filter(
      (m) =>
        (!kind || m.item.kind === kind) &&
        (!tag || m.item.tags.some((t) => fold(t).includes(tag))),
    );
  });
  readonly resultCount = computed(() => this.resultMatches().length);
  /** The text marked in result titles; tag discovery marks nothing (titles are not what matched). */
  readonly highlightTerm = computed(() => (this.discovery ? '' : this.query()));
  readonly resultGroups = computed(() => {
    const q = this.highlightTerm();
    const ref = this.project();
    return groupMatches(this.resultMatches()).map((group) => {
      const lines = secondaryLines(group.matches);
      return {
        kind: group.kind,
        title: group.title,
        icon: group.icon,
        total: group.total,
        rows: group.matches.map((match, i) => ({
          key: [match.item.kind, match.item.id, match.item.href].join('|'),
          titleText: match.item.title,
          title: highlightParts(match.item.title, q),
          secondary: lines[i],
          icon: match.item.icon || group.icon,
          link: match.item.href
            ? this.router.parseUrl(match.item.href)
            : undefined,
          // Saved queries render as the shared query row: type icon and badge, date, hover preview of the text.
          query:
            match.item.kind === 'query'
              ? {
                  type: match.item.queryType,
                  createdAt: match.item.createdAt,
                  // Resolved on first hover, so a results page that is never hovered reads no query text.
                  loadText: ref
                    ? () =>
                        this.injector
                          .get(QueryTextPreviewService)
                          .loader(ref, match.item.id)()
                    : undefined,
                }
              : undefined,
        })),
      };
    });
  });
  readonly localErrorText = computed(() => {
    const error = this.localState().error;
    // A failed optional index lookup is not news while the in-memory read succeeded.
    if (this.hostedItems() || error === undefined) return '';
    return quickSearchErrorMessage(this.hostedError() ?? error, undefined, {
      signedIn: this.signedIn(),
    });
  });
  readonly statusErrorText = computed(() => {
    const code = this.status()?.error;
    if (!code) return '';
    return quickSearchErrorMessage(
      { error: { error: { code } } },
      'The hosted index reported a problem. Refresh it, or disable and delete it.',
    );
  });
  /** Status, preview and index mutations share this fence; hosted search has its own, so typing never aborts them. */
  private generation = 0;
  private readonly authKey = signal<string | undefined>(undefined);
  readonly signedIn = signal(false);
  private request?: Subscription;
  private searchGeneration = 0;
  private searchRequest?: Subscription;
  /** The tag filter reaches the hosted index only after typing pauses (local filtering is instant). */
  private readonly debouncedTag = debouncedSignal(
    this.tag,
    QUICK_SEARCH_DEBOUNCE_MS,
  );
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
      'options-outline': optionsOutline,
      'close-outline': closeOutline,
      'search-outline': searchOutline,
    });
    registerQuickSearchIcons();
    // Ask a ready hosted index too (see search()).
    effect(() => {
      const q = this.query();
      this.debouncedTag.value();
      this.status();
      untracked(() => {
        const ref = this.project();
        if (ref && q.trim() && !this.schemaDetail && !this.checkDetail())
          this.metadataService.includeColumns(ref);
        this.search();
      });
    });
    this.auth.authState.pipe(takeUntilDestroyed()).subscribe((auth) => {
      const key = JSON.stringify([auth.status, auth.user?.uid]);
      if (key === this.authKey()) return;
      this.authKey.set(key);
      this.signedIn.set(isSignedInViewer(auth));
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
        if (this.checkDetail()) this.loadStatus();
      }
    });
    this.route.queryParamMap?.pipe(takeUntilDestroyed()).subscribe((params) => {
      const target = checkMetadataTarget(params);
      if (
        !this.schemaDetail &&
        !this.discovery &&
        JSON.stringify(target) !== JSON.stringify(this.detailTarget())
      ) {
        this.detailTarget.set(target);
        this.invalidateSearch();
        this.snapshot.set(undefined);
        this.consent.set(false);
        this.settings.set(false);
        this.query.set(params.get('q') || '');
        this.loadStatus();
        return;
      }
      const query = params.get(this.discovery ? 'name' : 'q') || '';
      if (!this.schemaDetail && !this.checkDetail() && this.query() !== query) {
        // The effect asks the hosted index; never fence status, preview or index changes for a new query.
        this.query.set(query);
        this.cancelHostedSearch();
      }
    });
    this.destroy.onDestroy(() => {
      this.generation++;
      this.request?.unsubscribe();
      this.cancelHostedSearch();
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
    this.cancelHostedSearch();
  }
  cancelHostedSearch() {
    this.searchGeneration++;
    this.searchRequest?.unsubscribe();
    this.hostedBusy.set(false);
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
        if (this.checkDetail()) {
          void this.checkMetadata();
          return;
        }
        // A ready status reaches search() through the effect, which watches status().
        if (this.schemaDetail) void this.schemaPreview();
      },
      error: (error: unknown) => {
        if (generation === this.generation) {
          // A GitHub limit, an outage or an expired sign-in is never worded as missing access.
          this.error.set(
            quickSearchErrorMessage(
              error,
              'Could not load the hosted index status. Try again.',
              { signedIn: this.signedIn() },
            ),
          );
          this.busy.set(false);
        }
      },
    });
  }
  /**
   * The hosted index is optional: when a consented index is ready its results are merged with the in-memory ones;
   * otherwise search never calls it.
   */
  search() {
    const ref = this.project();
    if (!ref || this.checkDetail() || this.schemaDetail) return;
    const q = this.query().trim();
    // A ready index adds what in-memory inventories lack (Checks, tags kept only in full item files),
    // and answers when an in-memory source could not be read. Without one, nothing is asked.
    if (!q || this.status()?.state !== 'ready') {
      this.cancelHostedSearch();
      this.hostedItems.set(undefined);
      this.hostedError.set(undefined);
      return;
    }
    this.cancelHostedSearch();
    const generation = this.searchGeneration;
    const tag = this.debouncedTag.value().trim();
    this.hostedBusy.set(true);
    this.hostedError.set(undefined);
    this.searchRequest = this.api
      .search(ref, q, [], this.discovery ? [q] : tag ? [tag] : [])
      .subscribe({
        next: (result) => {
          if (generation !== this.searchGeneration) return;
          this.hostedItems.set(
            result.items
              .map((doc) => fromSearchDocument(ref, doc))
              .filter((item): item is MetadataItem => !!item),
          );
          this.hostedBusy.set(false);
        },
        error: (error: unknown) => {
          if (generation !== this.searchGeneration) return;
          this.hostedItems.set(undefined);
          this.hostedError.set(error);
          this.hostedBusy.set(false);
        },
      });
  }
  onTerm(q: string): void {
    if (q === this.query()) return;
    this.query.set(q);
    this.hostedItems.set(undefined);
    const ref = this.project();
    if (!ref) return;
    const params = q.trim() ? String(new URLSearchParams({ q: q.trim() })) : '';
    // Keep the address shareable without stacking a history entry per pause in typing.
    void this.router
      .navigateByUrl(withQuery(projectPageHref(ref, ['quick-search']), params), {
        replaceUrl: true,
      })
      .catch(() => undefined);
  }
  clearFilters(): void {
    this.localKind.set('');
    this.tag.set('');
  }
  retryMetadata(): void {
    const ref = this.project();
    if (ref) this.metadataService.forget(ref);
    this.hostedError.set(undefined);
    this.metadataRetry.update((n) => n + 1);
  }
  async checkMetadata() {
    const ref = this.project(),
      target = this.detailTarget(),
      environmentId = this.environmentId();
    if (!ref || !this.checkDetail()) return;
    const generation = ++this.generation;
    this.request?.unsubscribe();
    this.items.set([]);
    this.snapshot.set(undefined);
    this.busy.set(true);
    this.error.set('');
    try {
      if (target.kind !== 'check') throw new Error('Invalid metadata target');
      let document: SearchDocument | undefined;
      if (
        ref.projectApi === 'cloud' ||
        isSharedProjectRef(ref) ||
        this.status()?.supportsMetadataPreview
      ) {
        const snapshot = await firstValueFrom(
          this.api.preview(ref, environmentId).pipe(timeout(15000)),
        );
        document = snapshot.documents.find(
          (item) =>
            item.kind === 'check' &&
            item.reference.objectId === target.objectId &&
            (!item.reference.environmentId ||
              item.reference.environmentId === environmentId),
        );
      } else {
        document = await this.snapshots.publicCheckMetadata(
          ref,
          target.objectId,
          () => generation === this.generation,
        );
      }
      if (generation !== this.generation) return;
      this.items.set(document ? [document] : []);
    } catch {
      if (generation === this.generation)
        this.error.set(
          target.kind === 'invalid'
            ? 'Invalid Check metadata link.'
            : 'Could not read this Check metadata. Check project access and retry.',
        );
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
  async preview() {
    const ref = this.project();
    if (!ref || this.checkDetail()) return;
    const generation = ++this.generation;
    this.request?.unsubscribe();
    this.busy.set(true);
    this.snapshot.set(undefined);
    this.error.set('');
    try {
      const snapshot = this.status()?.supportsMetadataPreview
        ? await firstValueFrom(
            this.api.preview(ref, this.environmentId()).pipe(timeout(15000)),
          )
        : await this.snapshots.preview(ref, this.environmentId());
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
    if (this.checkDetail()) return;
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
    if (this.checkDetail()) return;
    const ref = this.project(),
      snapshot = this.snapshot();
    if (!ref || !snapshot || this.capacityExceeded() || this.busy()) return;
    this.mutate(this.api.refresh(ref, snapshot));
  }
  disable() {
    if (this.checkDetail()) return;
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
