import { ErrorStateComponent } from '../../../components/error-state/error-state.component';
import { isQueryCreationTime } from '../../../queries/query-creation-time';
import { DatePipe } from '@angular/common';
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
  ProjectOverviewCardComponent,
  matchesOverviewFilter,
} from './project-overview-card.component';

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
    DatePipe,
    RouterLink,
    ProjectOverviewCardComponent,
    IonButton,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonSegment,
    IonSegmentButton,
  ],
  template: `
    <sneat-datatug-project-overview-card
      cardTitle="Queries"
      filterNoun="queries"
      testId="overview-queries-card"
      [titleHref]="listHref()"
      [filterable]="state() === 'ready'"
      [(filter)]="filter"
    >
      @if (state() === 'ready') {
        <ion-button
          overviewCardAction
          color="medium"
          (click)="toggleSortDirection()"
          [attr.aria-label]="directionLabel() + '. Reverse sort order'"
          [attr.title]="directionLabel()"
        >
          <ion-icon
            slot="start"
            [icon]="
              sortDirection() === 'descending' ? descendingIcon : ascendingIcon
            "
            aria-hidden="true"
          />
          {{ directionLabel() }}
        </ion-button>
      }
      @if (state() === 'loading') {
        <ion-item><ion-label>Loading project queries…</ion-label></ion-item>
      } @else if (state() === 'error') {
        <sneat-datatug-error-state
          compact
          what="the queries"
          [error]="failure()"
          (retry)="retry()"
        />
      } @else if (state() === 'empty') {
        <ion-item
          ><ion-label
            >No shared queries saved in this project yet.</ion-label
          ></ion-item
        >
      } @else {
        <div class="query-sort-toolbar">
          <ion-segment
            aria-label="Sort project queries"
            [value]="sortOrder()"
            (ionChange)="setSortOrder($event.detail.value)"
          >
            <ion-segment-button value="alphabetical" layout="icon-start"
              ><ion-icon [icon]="textIcon" aria-hidden="true" /><ion-label
                >Alphabetically</ion-label
              ></ion-segment-button
            >
            <ion-segment-button value="newest" layout="icon-start"
              ><ion-icon [icon]="calendarIcon" aria-hidden="true" /><ion-label
                >Last added</ion-label
              ></ion-segment-button
            >
          </ion-segment>
        </div>
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
                query.title + ', ' + query.type + ', open saved query'
              "
            >
              <ion-icon
                name="document-text-outline"
                slot="start"
                color="medium"
                aria-hidden="true"
              />
              <ion-label>
                <h3 [attr.data-testid]="'saved-query-' + query.id">
                  {{ query.title }}
                </h3>
                <p>
                  {{ query.type }}
                  @if (query.createdAt) {
                    · Added {{ query.createdAt | date: 'mediumDate' }}
                  }
                </p>
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
    </sneat-datatug-project-overview-card>
  `,
  styles: [
    `
      .query-sort-toolbar {
        padding: 8px 16px;
      }
      /* Full width: the two sort orders share the card width evenly, so the
         row never wraps or leaves a ragged gap; the direction toggle is a
         header action (slot="end"). */
      .query-sort-toolbar ion-segment {
        width: 100%;
      }
      .query-sort-toolbar ion-segment-button {
        max-width: none;
        --padding-start: 6px;
        --padding-end: 6px;
        font-size: 0.75rem;
        letter-spacing: 0.02em;
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
      matchesOverviewFilter(filter, query.title, query.type, query.id),
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
