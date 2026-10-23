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
import {
  QueryItemHeadingComponent,
  formatQueryTimestamp,
} from '../../../queries/query-list-item/query-list-item';
import {
  QueryTypeIconComponent,
  queryTypeLabel,
} from '../../../components/query-type-icon/query-type-icon.component';
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
    QueryTypeIconComponent,
    QueryItemHeadingComponent,
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
                >Alphabetically</ion-label
              ></ion-segment-button
            >
            <ion-segment-button
              value="newest"
              layout="icon-start"
              aria-label="Last added"
              title="Last added"
              ><ion-icon [icon]="calendarIcon" aria-hidden="true" /><ion-label
                >Last added</ion-label
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
            {{ directionLabel() }}
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
            <ion-item
              button
              detail
              [routerLink]="query.href"
              [attr.aria-label]="
                query.title +
                ', ' +
                typeLabel(query.type) +
                ' query, open saved query' +
                (query.createdAt ? '. ' + timestampText(query.createdAt) : '')
              "
            >
              <sneat-datatug-query-type-icon slot="start" [type]="query.type" />
              <ion-label>
                <sneat-datatug-query-item-heading
                  [queryTitle]="query.title"
                  [createdAt]="query.createdAt"
                  [testId]="'saved-query-' + query.id"
                />
              </ion-label>
            </ion-item>
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
      /* Phones: the sort orders collapse to their icons (the accessible
         names stay on the buttons) so the header keeps one line. */
      @media (max-width: 575px) {
        .query-sort-segment ion-segment-button ion-label {
          display: none;
        }
        .query-sort-segment ion-segment-button ion-icon {
          margin: 0;
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

  protected readonly typeLabel = queryTypeLabel;
  protected timestampText(createdAt: string): string {
    return formatQueryTimestamp(createdAt)?.full ?? '';
  }

  protected setSortOrder(value: unknown): void {
    if (value === 'alphabetical' || value === 'newest')
      this.sortOrder.set(value);
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
          const all = folder ? previewQueries(this.router, ref, folder) : [];
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
