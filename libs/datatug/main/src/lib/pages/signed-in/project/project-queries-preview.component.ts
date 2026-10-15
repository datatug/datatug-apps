import { Component, Input, OnDestroy, inject, signal } from '@angular/core';
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
  readonly href: string;
}

const previewLimit = 5;

function queryHref(ref: IProjectRef, id: string): string {
  const page = projectPageHref(ref, ['query', id]);
  const params = new URLSearchParams({ id });
  if (ref.projectApi) params.set('projectApi', ref.projectApi);
  if (ref.branch) params.set('branch', ref.branch);
  return `${page}?${params}`;
}

function previewQueries(ref: IProjectRef, root: IQueryFolder): QueryLink[] {
  const queries: QueryLink[] = [];
  const visit = (folder: IQueryFolder, path: string): void => {
    for (const query of folder.items ?? []) {
      const id = [path, query.id].filter(Boolean).join('/');
      queries.push({
        id,
        title: query.title || query.id,
        type: query.request.queryType,
        href: queryHref(ref, id),
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
  imports: [IonCard, IonCardHeader, IonCardTitle, IonItem, IonLabel, IonList],
  template: `
    <ion-card>
      <ion-card-header
        ><ion-card-title>Saved queries</ion-card-title></ion-card-header
      >
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
            <ion-item>
              <ion-label>
                <a
                  [href]="query.href"
                  [attr.data-testid]="'saved-query-' + query.id"
                  >{{ query.title }}</a
                >
                <p>{{ query.type }} · Open saved query</p>
              </ion-label>
            </ion-item>
          }
        </ion-list>
        @if (total() > queries().length) {
          <ion-item
            ><ion-label
              >Showing {{ queries().length }} of {{ total() }} saved
              queries.</ion-label
            ></ion-item
          >
        }
      }
      @if (listHref()) {
        <ion-item
          ><ion-label
            ><a [href]="listHref()">Browse all queries</a></ion-label
          ></ion-item
        >
      }
    </ion-card>
  `,
})
export class ProjectQueriesPreviewComponent implements OnDestroy {
  private readonly queriesService = inject(QueriesService);
  private load?: Subscription;
  protected readonly state = signal<'loading' | 'ready' | 'empty' | 'error'>(
    'loading',
  );
  protected readonly queries = signal<readonly QueryLink[]>([]);
  protected readonly total = signal(0);
  protected readonly listHref = signal('');

  @Input() set projectRef(ref: IProjectRef | undefined) {
    this.load?.unsubscribe();
    this.queries.set([]);
    this.total.set(0);
    this.listHref.set(ref ? projectPageHref(ref, 'queries') : '');
    this.state.set('loading');
    if (!ref) return;
    this.load = this.queriesService
      .getQueriesFolder(ref, '~', 'shared')
      .subscribe({
        next: (folder) => {
          const all = folder ? previewQueries(ref, folder) : [];
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
