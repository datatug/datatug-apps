import { ErrorStateComponent } from '../../../components/error-state/error-state.component';
import { isQueryCreationTime } from '../../../queries/query-creation-time';
import {
  Component,
  Input,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink, UrlTree } from '@angular/router';
import {
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonSegment,
  IonSegmentButton,
} from '@ionic/angular';
import { Observable, Subscription } from 'rxjs';
import {
  textOutline,
  calendarOutline,
  arrowDownOutline,
  arrowUpOutline,
} from 'ionicons/icons';
import type { IProjectRef } from '../../../core/project-context';
import type { IQueryFolder } from '../../../models/definition/query-def';
import { projectPageHref } from '../../../nav/project-page-href';
import { QueriesService } from '../../../queries/queries.service';
import { QueryListItemComponent } from '../../../components/query-list-item/query-list-item.component';
import { QueryTextPreviewService } from '../../../components/query-list-item/query-text-preview.service';
import { queryTypeLabel } from '../../../components/query-type-icon/query-type-icon.component';
import {
  ProjectTabPanelComponent,
  matchesOverviewFilter,
} from './project-tab-panel.component';

interface QueryLink {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly href: UrlTree;
  readonly createdAt: string;
  readonly createdTime: number;
  /** Lazily reads the query text for the row's hover preview. */
  readonly loadText: () => Observable<string | undefined>;
}

const previewLimit = 100;

function queryHref(router: Router, ref: IProjectRef, id: string): UrlTree {
  const page = projectPageHref(ref, ['query', id]);
  const parsed = router.parseUrl(page);
  return new UrlTree(
    parsed.root,
    {
      id,
      ...(ref.projectApi ? { projectApi: ref.projectApi } : {}),
      ...(ref.branch ? { branch: ref.branch } : {}),
    },
    parsed.fragment,
  );
}

function previewQueries(
  router: Router,
  ref: IProjectRef,
  root: IQueryFolder,
  textOf: (id: string, listed?: string) => () => Observable<string | undefined>,
): QueryLink[] {
  const queries: QueryLink[] = [];
  const visit = (folder: IQueryFolder, path: string): void => {
    for (const query of folder.items ?? []) {
      const id = [path, query.id].filter(Boolean).join('/');
      if (!isQueryCreationTime(query.createdAt)) {
        throw new Error('Saved queries require a valid creation timestamp.');
      }
      queries.push({
        id,
        title: query.title || query.id,
        type: query.request.queryType,
        createdAt: query.createdAt,
        createdTime: Date.parse(query.createdAt),
        href: queryHref(router, ref, id),
        loadText: textOf(
          id,
          (query.request as { readonly text?: string } | undefined)?.text,
        ),
      });
    }
    for (const child of folder.folders ?? []) {
      visit(child, [path, child.id].filter(Boolean).join('/'));
    }
  };
  visit(root, '');
  return queries.sort((a, b) => a.title.localeCompare(b.title));
}

/** A read-only overview of the same shared query tree used by the Queries page. */
@Component({
  selector: 'sneat-datatug-project-queries-preview',
  standalone: true,
  imports: [
    ErrorStateComponent,
    RouterLink,
    ProjectTabPanelComponent,
    QueryListItemComponent,
    IonButton,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonSegment,
    IonSegmentButton,
  ],
  template: `
    <sneat-datatug-project-tab-panel
      panelTitle="Queries"
      filterNoun="queries"
      testId="overview-queries-panel"
      [titleHref]="listHref()"
      [filterable]="state() === 'ready'"
      [(filter)]="filter"
    >
      <ng-container tabPanelControls>
        @if (state() === 'ready') {
          <ion-segment
            class="query-sort-segment"
            aria-label="Sort project queries"
            [value]="sortOrder()"
            (ionChange)="setSortOrder($event.detail.value)"
          >
            <ion-segment-button
              value="alphabetical"
              layout="icon-start"
              aria-label="Alphabetically"
              title="Alphabetically"
              ><ion-icon [icon]="textIcon" aria-hidden="true" /><ion-label
                class="query-sort-label"
                >Alphabetically</ion-label
              ><ion-label class="query-sort-short-label" aria-hidden="true"
                >Name</ion-label
              ></ion-segment-button
            >
            <ion-segment-button
              value="newest"
              layout="icon-start"
              aria-label="Last added"
              title="Last added"
              ><ion-icon [icon]="calendarIcon" aria-hidden="true" /><ion-label
                class="query-sort-label"
                >Last added</ion-label
              ><ion-label class="query-sort-short-label" aria-hidden="true"
                >Date</ion-label
              ></ion-segment-button
            >
          </ion-segment>
          <ion-button
            class="query-sort-direction"
            fill="clear"
            size="small"
            color="medium"
            (click)="toggleSortDirection()"
            [attr.aria-label]="directionLabel() + '. Reverse sort order'"
            [attr.title]="directionLabel()"
          >
            <ion-icon
              slot="start"
              [icon]="
                sortDirection() === 'descending'
                  ? descendingIcon
                  : ascendingIcon
              "
              aria-hidden="true"
            />
            <span class="query-sort-direction-label">{{
              directionLabel()
            }}</span>
            <span class="query-sort-direction-short-label" aria-hidden="true">{{
              shortDirectionLabel()
            }}</span>
          </ion-button>
        }
      </ng-container>
      @if (state() === 'loading') {
        <ion-list>
          <ion-item><ion-label>Loading project queries…</ion-label></ion-item>
        </ion-list>
      } @else if (state() === 'error') {
        <sneat-datatug-error-state
          compact
          what="the queries"
          [error]="failure()"
          (retry)="retry()"
        />
      } @else if (state() === 'empty') {
        <ion-list>
          <ion-item
            ><ion-label
              >No shared queries saved in this project yet.</ion-label
            ></ion-item
          >
        </ion-list>
      } @else {
        @if (matchCount() > queries().length) {
          <p class="query-limit" role="status">
            Showing {{ queries().length }} of {{ matchCount() }} queries.
            <a [routerLink]="listHref()">View all queries</a>
          </p>
        }
        <ion-list>
          @for (query of queries(); track query.id) {
            <sneat-datatug-query-list-item
              [queryTitle]="query.title"
              [type]="query.type"
              [createdAt]="query.createdAt"
              [href]="query.href"
              [titleTestId]="'saved-query-' + query.id"
              [loadText]="query.loadText"
            />
          } @empty {
            <ion-item lines="none">
              <ion-label color="medium"
                >No queries match “{{ filter() }}”.</ion-label
              >
            </ion-item>
          }
        </ion-list>
      }
    </sneat-datatug-project-tab-panel>
  `,
  styles: [
    `
      /* Compact, not full width: the segment shares one line with the panel
         title and the direction toggle. */
      /* Ionic lays a segment out as a grid of equal columns up to 360px
         each; a compact segment sizes each button to its content instead. */
      .query-sort-segment {
        display: inline-flex;
        width: auto;
        flex: 0 0 auto;
      }
      .query-sort-segment ion-segment-button {
        flex: 0 0 auto;
        width: auto;
        min-width: 0;
        max-width: none;
        min-height: 36px;
        --padding-start: 10px;
        --padding-end: 10px;
        font-size: 0.75rem;
        letter-spacing: 0.02em;
        text-transform: none;
      }
      .query-sort-direction {
        margin: 0;
        text-transform: none;
        letter-spacing: 0;
      }
      .query-sort-short-label,
      .query-sort-direction-short-label {
        display: none;
      }
      /* Phones: the sort orders keep their icon plus a one-word label
         (Name, Date; Newest, A–Z) so the header keeps one line; the full
         accessible names stay on the buttons. */
      @media (max-width: 575px) {
        .query-sort-segment ion-segment-button .query-sort-label,
        .query-sort-direction-label {
          display: none;
        }
        .query-sort-segment ion-segment-button .query-sort-short-label,
        .query-sort-direction-short-label {
          display: inline;
        }
        .query-sort-segment ion-segment-button {
          --padding-start: 6px;
          --padding-end: 6px;
        }
        .query-sort-direction {
          --padding-start: 4px;
          --padding-end: 4px;
        }
      }
      .query-limit {
        margin: 0 16px 12px;
        color: var(--dt-text-muted);
        font-size: 0.875rem;
      }
    `,
  ],
})
export class ProjectQueriesPreviewComponent implements OnDestroy {
  private readonly queriesService = inject(QueriesService);
  private readonly router = inject(Router);
  private readonly textPreviews = inject(QueryTextPreviewService);
  private load?: Subscription;
  protected readonly state = signal<'loading' | 'ready' | 'empty' | 'error'>(
    'loading',
  );
  private readonly allQueries = signal<readonly QueryLink[]>([]);
  @Input() querySource?: Observable<IQueryFolder | null | undefined>;
  protected readonly sortOrder = signal<'alphabetical' | 'newest'>('newest');
  protected readonly sortDirection = signal<'ascending' | 'descending'>(
    'descending',
  );
  protected readonly textIcon = textOutline;
  protected readonly calendarIcon = calendarOutline;
  protected readonly descendingIcon = arrowDownOutline;
  protected readonly ascendingIcon = arrowUpOutline;
  protected readonly directionLabel = computed(() =>
    this.sortOrder() === 'newest'
      ? this.sortDirection() === 'descending'
        ? 'Newest first'
        : 'Oldest first'
      : this.sortDirection() === 'ascending'
        ? 'A–Z'
        : 'Z–A',
  );
  /** The one-word form phones show next to the direction arrow. */
  protected readonly shortDirectionLabel = computed(() =>
    this.sortOrder() === 'newest'
      ? this.sortDirection() === 'descending'
        ? 'Newest'
        : 'Oldest'
      : this.sortDirection() === 'ascending'
        ? 'A–Z'
        : 'Z–A',
  );
  protected toggleSortDirection(): void {
    this.sortDirection.update((value) =>
      value === 'descending' ? 'ascending' : 'descending',
    );
  }
  /** The quick filter typed in the card; matches a query's title, type or id. */
  readonly filter = signal('');
  private readonly matching = computed(() => {
    const filter = this.filter();
    return this.allQueries().filter((query) =>
      matchesOverviewFilter(
        filter,
        query.title,
        query.type,
        queryTypeLabel(query.type),
        query.id,
      ),
    );
  });
  protected readonly matchCount = computed(() => this.matching().length);
  protected readonly queries = computed(() =>
    [...this.matching()]
      .sort((a, b) => {
        const direction = this.sortDirection() === 'ascending' ? 1 : -1;
        const comparison =
          this.sortOrder() === 'newest' && a.createdTime !== b.createdTime
            ? a.createdTime > b.createdTime
              ? 1
              : -1
            : a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
        return direction * comparison;
      })
      .slice(0, previewLimit),
  );

  /** Choosing a sort field starts it in its natural direction: names A→Z, dates newest first. */
  protected setSortOrder(value: unknown): void {
    if (value !== 'alphabetical' && value !== 'newest') return;
    if (value === this.sortOrder()) return;
    this.sortOrder.set(value);
    this.sortDirection.set(value === 'alphabetical' ? 'ascending' : 'descending');
  }
  protected readonly total = signal(0);
  protected readonly failure = signal<unknown>(undefined);
  private currentRef?: IProjectRef;

  protected retry(): void {
    this.projectRef = this.currentRef;
  }
  protected readonly listHref = signal<UrlTree | undefined>(undefined);

  @Input() set projectRef(ref: IProjectRef | undefined) {
    this.load?.unsubscribe();
    this.currentRef = ref;
    this.failure.set(undefined);
    this.allQueries.set([]);
    this.total.set(0);
    this.filter.set('');
    this.listHref.set(
      ref ? this.router.parseUrl(projectPageHref(ref, 'queries')) : undefined,
    );
    this.state.set('loading');
    if (!ref) return;
    this.load = (
      this.querySource ??
      this.queriesService.getQueriesFolder(ref, '~', 'shared')
    ).subscribe({
      next: (folder) => {
        try {
          const all = folder
            ? previewQueries(this.router, ref, folder, (id, listed) =>
                // The folder listing leaves `text` unset (the body is a sidecar file); read one query on demand.
                this.textPreviews.loader(ref, id, listed),
              )
            : [];
          this.total.set(all.length);
          this.allQueries.set(all);
          this.state.set(all.length ? 'ready' : 'empty');
        } catch (error) {
          this.failure.set(error);
          this.allQueries.set([]);
          this.state.set('error');
        }
      },
      error: (error) => {
        this.failure.set(error);
        this.state.set('error');
      },
    });
  }

  ngOnDestroy(): void {
    this.load?.unsubscribe();
  }
}

export function countProjectQueries(
  folder: IQueryFolder | null | undefined,
): number {
  return (
    (folder?.items?.length ?? 0) +
    (folder?.folders ?? []).reduce(
      (total, child) => total + countProjectQueries(child),
      0,
    )
  );
}
