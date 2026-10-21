import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
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
  selector: 'datatug-hosted-board-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [HostedBoardScope],
  imports: [
    RouterLink,
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
      <ion-button (click)="scope.refresh()">Retry project access</ion-button>
    }
    @if (!scope.loading() && !scope.error() && !scope.admitted()) {
      <p role="status">Choose an available environment to view boards.</p>
    }
    @if (error()) {
      <p role="alert">{{ error() }}</p>
      <ion-button (click)="scope.refresh()">Retry loading boards</ion-button>
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
      <ul aria-label="Project boards">
        @for (board of boards(); track board.id) {
          <li>
            <a
              [routerLink]="href(board.id)"
              [queryParams]="{ environment: scope.environment() }"
              >{{ board.title || board.id }}</a
            >
          </li>
        }
      </ul>
    }
  </section>`,
})
export class HostedBoardListComponent {
  readonly scope = inject(HostedBoardScope);
  private readonly api = inject(ProjectAssetsApiService);
  readonly boards = signal<{ id: string; title?: string }[]>([]);
  readonly error = signal('');
  readonly loading = signal(false);
  constructor() {
    effect((onCleanup) => {
      const admitted = this.scope.admitted();
      this.scope.identity();
      let cancelled = false;
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
            if (!cancelled) this.boards.set(boards);
          })
          .catch((error) => {
            if (!cancelled) this.error.set(detectiveErrorMessage(error, true));
          })
          .finally(() => {
            if (!cancelled) this.loading.set(false);
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
