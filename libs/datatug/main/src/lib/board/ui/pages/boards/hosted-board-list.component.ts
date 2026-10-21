import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { TagFilterComponent } from '../../../../tags/tag-filter.component';
import { TagFilterState } from '../../../../tags/tag-filter-state';
import { matchesTags } from '../../../../tags/tags';
import { IProjBoard } from '../../../../models/definition/project';
import { RouterLink } from '@angular/router';
import {
  IonInput,
  IonBadge,
  IonButton,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
} from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { HostedBoardScope } from '../../../core/hosted-board-scope';
import { ProjectAssetsApiService } from '../../../../services/project/project-assets-api.service';
import { projectPageHref } from '../../../../nav/project-page-href';
import { detectiveErrorMessage } from '../../../../detective/detective-client.service';
@Component({
  selector: 'sneat-datatug-hosted-board-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [HostedBoardScope, TagFilterState],
  imports: [
    RouterLink,
    TagFilterComponent,
    IonInput,
    IonBadge,
    IonButton,
    IonItem,
    IonLabel,
    IonSelect,
    IonSelectOption,
  ],
  template: ` <section aria-label="Hosted boards">
    <ion-item
      ><ion-label>Environment</ion-label
      ><ion-select
        aria-label="Board environment"
        [value]="scope.environment()"
        (ionChange)="scope.choose($event.detail.value)"
      >
        @for (env of scope.environments(); track env) {
          <ion-select-option [value]="env">{{ env }}</ion-select-option>
        }
      </ion-select></ion-item
    >
    @if (scope.loading() || loading()) {
      <p role="status">Loading boards…</p>
    }
    @if (scope.error()) {
      <p role="alert">{{ scope.error() }}</p>
      <ion-button (click)="reload()">Retry project access</ion-button>
    }
    @if (!scope.loading() && !scope.error() && !scope.admitted()) {
      <p role="status">Choose an available environment to view boards.</p>
    }
    @if (error()) {
      <p role="alert">{{ error() }}</p>
      <ion-button (click)="reload()">Retry loading boards</ion-button>
    }
    @if (scope.admitted()) {
      @if (scope.canWrite()) {
        <ion-button
          [routerLink]="newHref()"
          [queryParams]="{ environment: scope.environment() }"
          >Create board</ion-button
        >
      }
      @if (!loading() && !error() && !boards().length) {
        <p>No boards yet.</p>
      }
      <ion-item
        ><ion-input
          aria-label="Filter boards"
          placeholder="Filter boards"
          [value]="filter()"
          (ionInput)="filter.set($event.detail.value || '')"
      /></ion-item>
      <sneat-datatug-tag-filter
        [items]="boards()"
        [selected]="tagFilter.selected()"
        (selectedChange)="tagFilter.set($event)"
      />
      @if (
        !loading() && !error() && boards().length && !filteredBoards().length
      ) {
        <p>No boards match the selected filters.</p>
      }
      <ul aria-label="Project boards">
        @for (board of filteredBoards(); track board.id) {
          <li>
            <a
              [routerLink]="href(board.id)"
              [queryParams]="{ environment: scope.environment() }"
              >{{ board.title || board.id }}</a
            >
            @for (tag of board.tags || []; track tag) {
              <ion-badge color="light">{{ tag }}</ion-badge>
            }
          </li>
        }
      </ul>
    }
  </section>`,
})
export class HostedBoardListComponent {
  readonly scope = inject(HostedBoardScope);
  private readonly api = inject(ProjectAssetsApiService);
  readonly tagFilter = inject(TagFilterState);
  readonly filter = signal('');
  readonly boards = signal<IProjBoard[]>([]);
  readonly filteredBoards = computed(() =>
    this.boards().filter(
      (board) =>
        matchesTags(board, this.tagFilter.selected()) &&
        (board.title || board.id)
          .toLocaleLowerCase()
          .includes(this.filter().trim().toLocaleLowerCase()),
    ),
  );
  readonly error = signal('');
  readonly loading = signal(false);
  private generation = 0;
  reload(): void {
    this.generation++;
    this.boards.set([]);
    this.error.set('');
    this.loading.set(true);
    this.scope.refresh();
  }
  constructor() {
    effect((onCleanup) => {
      const admitted = this.scope.admitted();
      const identity = this.scope.identity();
      const generation = ++this.generation;
      let cancelled = false;
      const current = () =>
        !cancelled &&
        generation === this.generation &&
        this.scope.identity() === identity &&
        this.scope.admitted();
      this.boards.set([]);
      this.error.set('');
      this.loading.set(false);
      if (!admitted) return;
      untracked(() => {
        const ref = this.scope.page.ref();
        if (!ref) return;
        this.loading.set(true);
        void firstValueFrom(this.api.boards(ref, this.scope.environment()))
          .then((boards) => {
            if (current()) this.boards.set(boards);
          })
          .catch((error) => {
            if (current()) this.error.set(detectiveErrorMessage(error, true));
          })
          .finally(() => {
            if (current()) this.loading.set(false);
          });
      });
      onCleanup(() => {
        cancelled = true;
      });
    });
  }
  newHref() {
    return projectPageHref(this.scope.page.ref(), ['boards', 'new']);
  }
  href(id: string) {
    return projectPageHref(this.scope.page.ref(), ['board', id]);
  }
}
