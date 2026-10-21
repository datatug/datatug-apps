import { Component, Input, OnDestroy, inject, signal } from '@angular/core';
import { Router, RouterLink, UrlTree } from '@angular/router';
import {
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonItem,
  IonLabel,
  IonList,
} from '@ionic/angular';
import { Subscription } from 'rxjs';
import type { IProjectRef } from '../../../core/project-context';
import type { IQueryFolder } from '../../../models/definition/query-def';
import { projectPageHref } from '../../../nav/project-page-href';
import { QueriesService } from '../../../queries/queries.service';

interface QueryLink {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly href: UrlTree;
}

const previewLimit = 5;

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
      queries.push({
        id,
        title: query.title || query.id,
        type: query.request.queryType,
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
    RouterLink,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonItem,
    IonLabel,
    IonList,
  ],
  template: `
    <ion-card>
      <ion-card-header class="saved-query-header">
        <ion-card-title>Saved queries</ion-card-title>
        @if (state() !== 'loading' && listHref()) {
          <div class="saved-query-header-action">
            @if (state() === 'error') {
              <a [routerLink]="listHref()">Open Queries</a>
            } @else {
              <a [routerLink]="listHref()">View all {{ total() }} queries</a>
            }
          </div>
        }
      </ion-card-header>
      @if (state() === 'loading') {
        <ion-item><ion-label>Loading saved queries…</ion-label></ion-item>
      } @else if (state() === 'error') {
        <ion-item
          ><ion-label role="alert"
            >Saved queries could not be loaded. Open Queries to try
            again.</ion-label
          ></ion-item
        >
      } @else if (state() === 'empty') {
        <ion-item
          ><ion-label
            >No shared queries saved in this project yet.</ion-label
          ></ion-item
        >
      } @else {
        <ion-list>
          @for (query of queries(); track query.id) {
            <ion-item
              button
              detail
              [routerLink]="query.href"
              [attr.aria-label]="query.title + ', ' + query.type + ', open saved query'"
            >
              <ion-label>
                <h3 [attr.data-testid]="'saved-query-' + query.id">
                  {{ query.title }}
                </h3>
                <p>{{ query.type }}</p>
              </ion-label>
            </ion-item>
          }
        </ion-list>
      }
    </ion-card>
  `,
  styles: [
    `
      .saved-query-header {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .saved-query-header ion-card-title {
        min-width: 0;
      }

      .saved-query-header-action {
        flex: 0 0 auto;
        margin-left: auto;
        font-size: 0.85rem;
        text-align: right;
      }

      .saved-query-header-action a {
        display: inline-flex;
        min-height: 44px;
        align-items: center;
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
  protected readonly queries = signal<readonly QueryLink[]>([]);
  protected readonly total = signal(0);
  protected readonly listHref = signal<UrlTree | undefined>(undefined);

  @Input() set projectRef(ref: IProjectRef | undefined) {
    this.load?.unsubscribe();
    this.queries.set([]);
    this.total.set(0);
    this.listHref.set(
      ref ? this.router.parseUrl(projectPageHref(ref, 'queries')) : undefined,
    );
    this.state.set('loading');
    if (!ref) return;
    this.load = this.queriesService
      .getQueriesFolder(ref, '~', 'shared')
      .subscribe({
        next: (folder) => {
          const all = folder ? previewQueries(this.router, ref, folder) : [];
          this.total.set(all.length);
          this.queries.set(all.slice(0, previewLimit));
          this.state.set(all.length ? 'ready' : 'empty');
        },
        error: () => this.state.set('error'),
      });
  }

  ngOnDestroy(): void {
    this.load?.unsubscribe();
  }
}
