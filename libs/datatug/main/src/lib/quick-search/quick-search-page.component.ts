import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
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
import { Subscription, combineLatest, firstValueFrom, timeout } from 'rxjs';
import { SneatAuthStateService } from '@sneat/auth-core';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import {
  IProjectRef,
  equalProjectRef,
  isSharedProjectRef,
} from '../core/project-context';
import { projectPageHref } from '../nav/project-page-href';
import { QuickSearchApiService } from './quick-search-api.service';
import { QuickSearchSnapshotService } from './quick-search-snapshot.service';
import {
  checkMetadataTarget,
  classifySearchError,
  isCompletionUnknown,
  mutationMessage,
  SearchDocument,
  SearchKind,
  SearchProblem,
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
      "checkDetail() ? 'check' : schemaDetail ? 'schema' : discovery ? 'tags' : 'search'",
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
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
          checkDetail()
            ? 'Check metadata'
            : discovery
              ? 'Tag discovery'
              : schemaDetail
                ? 'Schema metadata'
                : 'Quick Search'
        }}</ion-title
        ><ion-buttons slot="end">
          @if (!discovery && !schemaDetail && !checkDetail()) {
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
        @if (!schemaDetail && !checkDetail()) {
          <form (ngSubmit)="search()">
            <ion-input
              label="Search project names and tags"
              fill="outline"
              labelPlacement="stacked"
              [ngModel]="query()"
              (ngModelChange)="query.set($event)"
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
                (ngModelChange)="tag.set($event)"
                name="tag"
              /><ion-button type="submit" [disabled]="busy()"
                >Search</ion-button
              >
            </div>
          </form>
        }
        @if (settings() && !checkDetail()) {
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
                {{ s.state }}
                @if (s.countsUnavailable) {
                  · Item counts unavailable
                } @else if (s.documentCount === undefined) {
                  · Item count unavailable
                } @else {
                  · Last indexed snapshot: {{ s.documentCount }}
                  {{ s.documentCount === 1 ? 'item' : 'items' }}
                  @if (s.lastIndexedAt) {
                    · indexed {{ s.lastIndexedAt | date: 'd MMM HH:mm' }}
                  }
                }
                @if (s.revision !== undefined) {
                  · Revision {{ s.revision }}
                }
              </p>
              @if (s.sourceCoverage?.length) {
                <ul aria-label="Last indexed snapshot by kind">
                  @for (coverage of s.sourceCoverage; track coverage.kind) {
                    <li>
                      {{ names[coverage.kind] }}:
                      @if (
                        s.countsUnavailable ||
                        coverage.status !== 'complete' ||
                        coverage.count === undefined
                      ) {
                        unavailable
                      } @else {
                        {{ coverage.count }}
                      }
                    </li>
                  }
                </ul>
              }
              <p>
                Audience: {{ s.audience }} · Provider:
                {{ s.provider || 'Not configured' }}
              </p>
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
                  [disabled]="previewBusy() || mutationBusy()"
                  >Preview selected metadata</ion-button
                >
                @if (capacityExceeded()) {
                  <p role="status">
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
                      mutationBusy() ||
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
                      mutationBusy() ||
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
                  [disabled]="mutationBusy() || s.state === 'disabled'"
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
                    [disabled]="mutationBusy()"
                    >Confirm disable and delete</ion-button
                  ><ion-button fill="clear" (click)="confirmDelete.set(false)"
                    >Cancel</ion-button
                  >
                }
                @if (s.state === 'deleting' || s.error) {
                  <ion-button (click)="disable()" [disabled]="mutationBusy()"
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
        @if (working()) {
          <p role="status"><ion-spinner /> Loading…</p>
        }
        @if (statusBusy() && settings()) {
          <p role="status">Loading index status…</p>
        }
        @if (error() && !problem()) {
          <p role="alert">{{ error() }}</p>
        }
        @if (statusError()) {
          <p role="status">{{ statusError() }}</p>
          <ion-button (click)="retry()" fill="clear">Retry status</ion-button>
        }
        @switch (problem()) {
          @case ('reindex') {
            <p role="alert">
              @if (canManage()) {
                This project's index must be refreshed before it can be
                searched. Open Index settings, preview the selected metadata and
                choose Refresh selected snapshot.
              } @else {
                This project's index is being updated and cannot be searched
                yet. A project manager needs to refresh it.
              }
            </p>
            @if (canManage() && !schemaDetail) {
              <ion-button (click)="settings.set(true)"
                >Open Index settings</ion-button
              >
            }
          }
          @case ('unsupported') {
            <p role="alert">
              Quick Search isn't available yet for projects stored in DataTug
              cloud.
            </p>
          }
          @case ('premium') {
            <p role="alert">Quick Search requires a Pro or Business plan.</p>
          }
          @case ('denied') {
            <p role="alert">
              You don't have access to search this project. Check your project
              access.
            </p>
          }
          @case ('conflict') {
            <p role="alert">
              The index is being changed right now. Try again in a moment.
            </p>
            <ion-button fill="clear" (click)="search()"
              >Retry search</ion-button
            >
          }
          @case ('capacity') {
            <p role="alert">This project's index has reached its size limit.</p>
          }
          @case ('invalid') {
            <p role="alert">
              That search isn't valid. Change the query and try again.
            </p>
          }
          @case ('rateLimited') {
            <p role="alert">Too many searches — try again in a moment.</p>
            <ion-button fill="clear" (click)="search()"
              >Retry search</ion-button
            >
          }
          @case ('unavailable') {
            <p role="alert">
              Search is temporarily unavailable. Try again in a moment.
            </p>
            <ion-button fill="clear" (click)="search()"
              >Retry search</ion-button
            >
          }
        }
        @if (status()?.error) {
          <p role="status">{{ status()?.error }}</p>
        }
        @if (
          !checkDetail() &&
          !working() &&
          (status()?.state === 'disabled' || problem() === 'consent')
        ) {
          @if (canManage()) {
            <p role="status">
              Quick Search is disabled. Open Index settings to preview metadata
              and give indexing consent.
            </p>
            @if (!schemaDetail) {
              <ion-button (click)="settings.set(true)"
                >Open Index settings</ion-button
              >
            }
          } @else {
            <p role="status">
              Quick Search is disabled for this project. A project manager can
              enable it.
            </p>
          }
        }
        @if (!checkDetail()) {
          <p aria-live="polite" [hidden]="!showCount()">
            @if (showCount()) {
              @if (submittedQuery()) {
                Results for “{{ submittedQuery() }}” ·
              }
              {{ groups().length }}
              {{ groups().length === 1 ? 'name' : 'names' }} ·
              {{ items().length }} items
            }
          </p>
        }
        @if (
          !checkDetail() &&
          !working() &&
          searched() &&
          !problem() &&
          !groups().length
        ) {
          <p role="status">
            {{
              discovery
                ? 'No items with this tag were found in this index.'
                : submittedQuery()
                  ? 'No matches for “' + submittedQuery() + '”.'
                  : 'No matching items.'
            }}
          </p>
        }
        @if (checkDetail()) {
          <section aria-label="Check metadata">
            @if (items()[0]; as item) {
              <h1>{{ item.name }}</h1>
              <p>Check metadata · Read-only names and tags</p>
              <p>Identifier: {{ item.reference.objectId }}</p>
              @if (item.tags.length) {
                <p>Tags: {{ item.tags.join(', ') }}</p>
              }
            } @else if (!working() && !error() && !statusError()) {
              <p role="status">
                This Check metadata is unavailable for the selected project.
              </p>
            }
          </section>
        } @else {
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
        }
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
      }
      .results > li:not(:last-child) {
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
  /** Busy for search and check/schema reads; status, preview and mutations have their own signals. */
  readonly busy = signal(false);
  readonly previewBusy = signal(false);
  readonly mutationBusy = signal(false);
  readonly working = computed(
    () => this.busy() || this.previewBusy() || this.mutationBusy(),
  );
  readonly showCount = computed(
    () =>
      !this.checkDetail() &&
      (this.searched() || this.schemaDetail) &&
      !this.problem(),
  );
  readonly statusBusy = signal(false);
  readonly statusError = signal('');
  readonly problem = signal<SearchProblem | undefined>(undefined);
  readonly canManage = computed(() => this.status()?.canManage !== false);
  readonly searched = signal(false);
  /** The query the shown results belong to, which may differ from the text being typed. */
  readonly submittedQuery = signal('');
  readonly kinds = searchKinds;
  readonly names = kindNames;
  readonly icons = kindIcons;
  readonly label = searchChipLabel;
  readonly overviewHref = computed(() =>
    projectPageHref(this.project(), ['overview']),
  );
  /** Guards search, check/schema reads and index operations. */
  private generation = 0;
  /** Guards status loads only, so status and search never cancel each other. */
  private statusGeneration = 0;
  /** Guards metadata previews only. */
  private previewGeneration = 0;
  /** Guards enable/refresh/disable only; typing and searching never cancel them. */
  private mutationGeneration = 0;
  private mutationRequest?: Subscription;
  /** Keys of the last started status load and search, so re-entry does not refire. */
  private readonly loaded = { status: '', search: '' };
  private readonly authReady = signal(false);
  private statusRequest?: Subscription;
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
      this.invalidateActor();
      this.cancelStatus();
      this.status.set(undefined);
      this.snapshot.set(undefined);
      this.consent.set(false);
      this.confirmDelete.set(false);
      this.error.set('');
      this.statusError.set('');
      this.authReady.set(auth.status !== 'authenticating');
      if (this.authReady()) {
        this.ensureStatus();
        this.ensureSearch();
      }
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
          this.invalidateAll();
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
      this.invalidateActor();
      this.cancelStatus();
      this.project.set(context?.ref);
      this.status.set(undefined);
      this.snapshot.set(undefined);
      this.consent.set(false);
      this.error.set('');
      this.statusError.set('');
      this.ensureStatus();
      this.ensureSearch();
    });
    this.nav.currentEnv?.pipe(takeUntilDestroyed()).subscribe((environment) => {
      if (this.environmentId() !== environment?.id) {
        // Search does not depend on the environment; only previews do.
        this.invalidatePreview();
        this.environmentId.set(environment?.id);
        this.snapshot.set(undefined);
        this.consent.set(false);
        if (this.checkDetail()) this.loadStatus();
        else if (this.schemaDetail) void this.schemaPreview();
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
        this.invalidateAll();
        this.snapshot.set(undefined);
        this.consent.set(false);
        this.settings.set(false);
        this.query.set(params.get('q') || '');
        this.loadStatus();
        return;
      }
      const query = params.get(this.discovery ? 'name' : 'q') || '';
      if (!this.schemaDetail && !this.checkDetail() && this.query() !== query) {
        this.query.set(query);
        this.invalidateSearch();
        this.search();
      }
    });
    this.destroy.onDestroy(() => {
      this.generation++;
      this.previewGeneration++;
      this.mutationGeneration++;
      this.statusGeneration++;
      this.request?.unsubscribe();
      this.mutationRequest?.unsubscribe();
      this.statusRequest?.unsubscribe();
    });
  }
  /** Fires once per key: the constructor subscriptions and the first entry share one load. */
  ionViewWillEnter(): void {
    this.ensureStatus();
    this.ensureSearch();
  }
  /** Leaving clears cached results, so the next entry reloads status and search. */
  ionViewWillLeave(): void {
    this.invalidateAll();
    this.loaded.status = '';
    this.loaded.search = '';
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
  /** Cancels search state only; never a preview or an index operation. */
  invalidateSearch() {
    this.generation++;
    this.request?.unsubscribe();
    this.items.set([]);
    this.busy.set(false);
    this.searched.set(false);
    this.submittedQuery.set('');
    this.problem.set(undefined);
  }
  private invalidatePreview() {
    this.previewGeneration++;
    this.previewBusy.set(false);
  }
  /** Search and preview, e.g. when the view or route target changes. */
  private invalidateAll() {
    this.invalidateSearch();
    this.invalidatePreview();
  }
  /** Everything an actor or project change must fence, including index operations. */
  private invalidateActor() {
    this.invalidateAll();
    this.mutationGeneration++;
    this.mutationRequest?.unsubscribe();
    this.mutationBusy.set(false);
  }
  private cancelStatus() {
    this.statusGeneration++;
    this.statusRequest?.unsubscribe();
    this.statusBusy.set(false);
  }
  private contextKey() {
    const ref = this.project();
    return ref ? JSON.stringify([ref, this.authKey()]) : '';
  }
  private searchKey() {
    return JSON.stringify([
      this.contextKey(),
      this.query(),
      this.kind(),
      this.tag(),
    ]);
  }
  /** Loads status unless this project and actor already have a load started. */
  private ensureStatus() {
    const key = this.contextKey();
    if (!key || key === this.loaded.status) return;
    this.loadStatus();
  }
  /** Searches unless this exact context and query already ran. */
  private ensureSearch() {
    if (!this.searchable() || this.searchKey() === this.loaded.search) return;
    this.search();
  }
  private searchable() {
    return !this.schemaDetail && !this.checkDetail();
  }
  /** Starts the search for the current query once project and auth are usable; never waits for status. */
  private autoSearch() {
    if (this.searchable()) this.search();
  }
  /** Retries status and, when a query is present, the search too. */
  retry() {
    this.loadStatus();
    this.autoSearch();
  }
  /** Loads index status independently: it never touches search results, busy or generation. */
  loadStatus() {
    const ref = this.project();
    // An index operation's status is authoritative; do not race it.
    if (!ref || this.mutationBusy()) return;
    this.loaded.status = this.contextKey();
    const generation = ++this.statusGeneration;
    this.statusRequest?.unsubscribe();
    this.statusBusy.set(true);
    this.status.set(undefined);
    this.statusError.set('');
    this.statusRequest = this.api.status(ref).subscribe({
      next: (status) => {
        if (generation !== this.statusGeneration) return;
        this.status.set(status);
        this.statusBusy.set(false);
        if (this.checkDetail()) {
          void this.checkMetadata();
          return;
        }
        if (this.schemaDetail) void this.schemaPreview();
      },
      error: () => {
        if (generation === this.statusGeneration) {
          this.loaded.status = '';
          this.statusError.set(
            'Could not load index status. Check your project access and retry.',
          );
          this.statusBusy.set(false);
        }
      },
    });
  }
  search() {
    const ref = this.project();
    if (!ref || !this.authReady() || this.checkDetail() || this.schemaDetail)
      return;
    if (!this.query().trim()) {
      this.invalidateSearch();
      return;
    }
    this.loaded.search = this.searchKey();
    const submitted = this.query().trim();
    const generation = ++this.generation;
    this.request?.unsubscribe();
    this.busy.set(true);
    this.error.set('');
    this.problem.set(undefined);
    this.items.set([]);
    this.searched.set(false);
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
          this.submittedQuery.set(submitted);
          this.searched.set(true);
          this.busy.set(false);
        },
        error: (failure: unknown) => {
          if (generation !== this.generation) return;
          const problem = classifySearchError(failure);
          if (problem === 'failed')
            this.error.set(
              'Search failed. Check your project access and try again.',
            );
          else this.problem.set(problem);
          this.busy.set(false);
        },
      });
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
    // Own counter: a preview never cancels an in-flight search, and vice versa.
    const generation = ++this.previewGeneration;
    this.previewBusy.set(true);
    this.snapshot.set(undefined);
    this.error.set('');
    try {
      const snapshot = this.status()?.supportsMetadataPreview
        ? await firstValueFrom(
            this.api.preview(ref, this.environmentId()).pipe(timeout(15000)),
          )
        : await this.snapshots.preview(ref, this.environmentId());
      if (generation === this.previewGeneration) this.snapshot.set(snapshot);
    } catch {
      if (generation === this.previewGeneration)
        this.error.set(
          'Could not read selected metadata. No metadata was uploaded.',
        );
    } finally {
      if (generation === this.previewGeneration) this.previewBusy.set(false);
    }
  }
  async schemaPreview() {
    const preview = this.preview();
    const generation = this.previewGeneration;
    await preview;
    if (generation !== this.previewGeneration) return;
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
      this.mutationBusy()
    )
      return;
    this.mutate(this.api.enable(ref, snapshot));
  }
  refresh() {
    if (this.checkDetail()) return;
    const ref = this.project(),
      snapshot = this.snapshot();
    if (!ref || !snapshot || this.capacityExceeded() || this.mutationBusy())
      return;
    this.mutate(this.api.refresh(ref, snapshot));
  }
  disable() {
    if (this.checkDetail()) return;
    const ref = this.project();
    if (!ref || this.mutationBusy()) return;
    const before = this.status();
    const hadResults = this.searched();
    this.invalidateSearch();
    this.status.update((status) =>
      status ? { ...status, state: 'deleting' } : status,
    );
    this.mutate(this.api.disable(ref), () => {
      // Roll the optimistic state back; the status reload is authoritative.
      this.status.set(before);
      if (hadResults) this.autoSearch();
    });
  }
  private mutate(
    operation: ReturnType<QuickSearchApiService['disable']>,
    rollback?: () => void,
  ) {
    const generation = ++this.mutationGeneration;
    this.mutationRequest?.unsubscribe();
    // The operation's status is authoritative: cancel any in-flight status load.
    this.cancelStatus();
    this.mutationBusy.set(true);
    this.error.set('');
    this.problem.set(undefined);
    this.mutationRequest = operation.subscribe({
      next: (status) => {
        if (generation !== this.mutationGeneration) return;
        this.status.set(status);
        this.statusError.set('');
        this.mutationBusy.set(false);
        this.confirmDelete.set(false);
        this.consent.set(false);
        if (status.state === 'disabled') this.snapshot.set(undefined);
        if (status.state === 'ready') this.autoSearch();
      },
      error: (failure: unknown) => {
        if (generation !== this.mutationGeneration) return;
        const unknown = isCompletionUnknown(failure);
        this.mutationBusy.set(false);
        // Roll back (which may re-run search and clear errors) before setting
        // the mutation error, so the explanation survives.
        rollback?.();
        this.error.set(
          unknown
            ? 'The operation may have completed — refreshing status…'
            : mutationMessage(classifySearchError(failure)),
        );
        if (unknown) this.loadStatus();
      },
      complete: () => {
        if (generation === this.mutationGeneration)
          this.mutationBusy.set(false);
      },
    });
  }
}
