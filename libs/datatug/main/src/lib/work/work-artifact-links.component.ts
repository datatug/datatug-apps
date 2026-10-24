import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  IonCard,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
} from '@ionic/angular';
import { SneatAuthStateService } from '@sneat/auth-core';
import { IProjectRef, isSharedProjectRef } from '../core/project-context';
import { projectPageHref } from '../nav/project-page-href';
import { WorkApiService } from './work-api.service';
import { WorkItem, WorkLink, workTypeLabel } from './work.models';

/** Read-only backreferences. The server admits the project and artefact definition; execution access remains separate. */
@Component({
  selector: 'sneat-work-artifact-links',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonCard, IonItem, IonItemDivider, IonLabel, IonList, RouterLink],
  template: `@if (items().length) {
    <ion-card
      ><ion-item-divider color="light"
        ><ion-label>Related work</ion-label></ion-item-divider
      ><ion-list aria-label="Work referencing this artefact">
        @for (item of items(); track item.id) {
          <ion-item [routerLink]="href(item)" detail
            ><ion-label class="ion-text-wrap"
              ><h3>{{ item.title }}</h3>
              <p>
                {{ typeLabel(item.type) }} · {{ item.status }} ·
                {{ environments(item.id) }}
              </p></ion-label
            ></ion-item
          >
        }
      </ion-list></ion-card
    >
  }`,
})
export class WorkArtifactLinksComponent {
  readonly project = input<IProjectRef>();
  readonly kind = input.required<'check' | 'query' | 'watch'>();
  /** A query may use its existing folder-qualified identity. */
  readonly identifier = input.required<string>();
  readonly environment = input('');
  private readonly injector = inject(Injector);
  private readonly authService = inject(SneatAuthStateService);
  private readonly auth = toSignal(this.authService.authState);
  private readonly key = computed(() =>
    JSON.stringify([
      this.project(),
      this.kind(),
      this.identifier(),
      this.environment(),
      this.auth()?.user?.uid,
    ]),
  );
  readonly items = signal<WorkItem[]>([]);
  readonly links = signal<WorkLink[]>([]);
  readonly typeLabel = workTypeLabel;
  private controller = new AbortController();
  constructor() {
    let actor = this.auth()?.user?.uid;
    this.authService.authState.pipe(takeUntilDestroyed()).subscribe((state) => {
      if (state.user?.uid !== actor) {
        actor = state.user?.uid;
        this.controller.abort();
        this.items.set([]);
        this.links.set([]);
      }
    });
    effect(() => {
      const key = this.key(),
        project = this.project(),
        identifier = this.identifier(),
        actor = this.auth()?.user?.uid;
      this.controller.abort();
      this.controller = new AbortController();
      this.items.set([]);
      this.links.set([]);
      if (!project || !isSharedProjectRef(project) || !identifier || !actor)
        return;
      if (this.kind() === 'watch' && !this.environment()) return;
      const signal = this.controller.signal;
      const slash = this.kind() === 'query' ? identifier.lastIndexOf('/') : -1;
      const folder = slash < 0 ? '' : identifier.slice(0, slash),
        id = identifier.slice(slash + 1);
      void this.injector
        .get(WorkApiService)
        .artifactLinks(
          { spaceID: project.spaceID, projectID: project.projectId },
          this.kind(),
          id,
          folder,
          signal,
          this.environment(),
        )
        .then((result) => {
          if (key === this.key() && !signal.aborted) {
            this.items.set(result.items);
            this.links.set(result.links);
          }
        })
        .catch(() => {
          if (key === this.key() && !signal.aborted) {
            this.items.set([]);
            this.links.set([]);
          }
        });
    });
    inject(DestroyRef).onDestroy(() => this.controller.abort());
  }
  href(item: WorkItem): string {
    return projectPageHref(
      {
        storeId: 'firestore',
        spaceID: item.spaceID,
        projectId: item.projectID,
      },
      ['work', item.id],
    );
  }
  environments(id: string): string {
    return [
      ...new Set(
        this.links()
          .filter((link) => link.sourceId === id)
          .map((link) => link.target.environment)
          .filter(Boolean),
      ),
    ].join(', ');
  }
}
