import {
  HttpClient,
  HttpErrorResponse,
  HttpParams,
} from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { IonButton } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { IProjectRef } from '../core/project-context';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { buildAgentUrl } from '../services/repo/agent-url';
import { TagsEditorComponent } from './tags-editor.component';
interface TagSnapshot {
  kind: 'board' | 'dbserver';
  id: string;
  tags: string[];
  revision: string;
  branchHead: string;
}
@Component({
  selector: 'sneat-datatug-project-item-tags',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TagsEditorComponent, IonButton],
  template: `
    <sneat-datatug-tags-editor
      [tags]="tags()"
      [projectRef]="projectRef()"
      [readOnlyDescription]="
        connectionReadOnly() ? 'are read-only for this project connection' : ''
      "
      [disabled]="loading() || saving()"
      [readonly]="!writable()"
      (tagsChange)="tags.set($event); message.set('')"
    >
      <ng-container tag-actions>
        @if (writable()) {
          <ion-button
            [disabled]="saving() || loading() || !changed()"
            (click)="save()"
            >{{ saving() ? 'Saving tags…' : 'Save tags' }}</ion-button
          >
        }
        @if (projectRef() && !connectionReadOnly()) {
          <ion-button
            fill="clear"
            color="medium"
            [disabled]="saving() || loading()"
            (click)="reload()"
            >Reload tags</ion-button
          >
        }
      </ng-container>
      <div tag-status>
        @if (loading()) {
          <p class="ion-padding-horizontal" role="status">Loading tags…</p>
        }
        @if (message() && !connectionReadOnly()) {
          <p class="ion-padding-horizontal" role="status">{{ message() }}</p>
        }
        @if (error()) {
          <p class="ion-padding-horizontal" role="alert">{{ error() }}</p>
        }
      </div>
    </sneat-datatug-tags-editor>
  `,
})
export class ProjectItemTagsComponent {
  readonly projectRef = input<IProjectRef>();
  readonly kind = input.required<'board' | 'dbserver'>();
  readonly itemId = input.required<string>();
  readonly driver = input<string>();
  readonly initialTags = input<readonly string[]>([]);
  private readonly api = inject(ProjectQueryApiService);
  private readonly http = inject(HttpClient);
  private readonly refresh = signal(0);
  readonly tags = signal<string[]>([]);
  private readonly branch = signal<string | undefined>(undefined);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly connectionReadOnly = computed(
    () => this.message() === 'Tags are read-only for this project connection.',
  );
  readonly snapshot = signal<TagSnapshot | undefined>(undefined);
  readonly supported = signal(false);
  readonly writable = computed(() => this.supported() && !!this.snapshot());
  readonly changed = computed(
    () =>
      JSON.stringify(this.tags()) !==
      JSON.stringify(this.snapshot()?.tags ?? []),
  );
  private generation = 0;
  constructor() {
    effect(() => {
      const initial = this.initialTags();
      if (this.connectionReadOnly()) this.tags.set([...initial]);
    });
    effect((onCleanup) => {
      const ref = this.projectRef(),
        kind = this.kind(),
        id = this.itemId(),
        driver = this.driver();
      const initial = untracked(() => this.initialTags());
      this.refresh();
      const generation = ++this.generation;
      let cancelled = false;
      const current = () => !cancelled && generation === this.generation;
      this.branch.set(undefined);
      this.tags.set([...initial]);
      this.snapshot.set(undefined);
      this.supported.set(false);
      this.error.set('');
      this.message.set('');
      this.saving.set(false);
      this.loading.set(false);
      if (!ref || !id) return;
      if (
        ref.spaceID ||
        ref.projectApi === 'cloud' ||
        ['github', 'github.com', 'firestore'].includes(ref.storeId)
      ) {
        this.message.set('Tags are read-only for this project connection.');
        return;
      }
      this.loading.set(true);
      void (async () => {
        const capabilities = await firstValueFrom(this.api.capabilities(ref));
        if (!current()) return;
        if (
          !(kind === 'board'
            ? capabilities.boardTags
            : capabilities.dbServerTags)
        ) {
          this.message.set(
            'Tag editing requires an updated DataTug CLI agent.',
          );
          return;
        }
        const branches = await firstValueFrom(this.api.branches(ref));
        if (!current()) return;
        if (
          !branches.currentBranch ||
          (ref.branch && ref.branch !== branches.currentBranch)
        )
          throw new Error('Branch mismatch');
        this.branch.set(ref.branch || branches.currentBranch);
        this.supported.set(true);
        const snapshot = await firstValueFrom(
          this.http.get<TagSnapshot>(
            buildAgentUrl(ref.storeId, '/projects/item_tags'),
            {
              params: new HttpParams({
                fromObject: this.scope(ref, kind, id, driver),
              }),
            },
          ),
        );
        if (
          snapshot.id !== id ||
          snapshot.kind !== kind ||
          !Array.isArray(snapshot.tags) ||
          !snapshot.revision ||
          !snapshot.branchHead
        )
          throw new Error('Invalid tag response');
        if (current()) {
          this.snapshot.set(snapshot);
          this.tags.set(snapshot.tags);
        }
      })()
        .catch(() => {
          if (current())
            this.error.set(
              'Tags could not be loaded. Check project access and retry.',
            );
        })
        .finally(() => {
          if (current()) this.loading.set(false);
        });
      onCleanup(() => {
        cancelled = true;
      });
    });
  }
  private scope(
    ref: IProjectRef,
    kind = this.kind(),
    id = this.itemId(),
    driver = this.driver(),
  ) {
    return {
      storage: 'local',
      project: ref.projectId,
      ...(this.branch() ? { branch: this.branch() ?? '' } : {}),
      kind,
      id,
      ...(kind === 'dbserver' && driver ? { driver } : {}),
    };
  }
  reload(): void {
    this.refresh.update((value) => value + 1);
  }
  async save(): Promise<void> {
    const ref = this.projectRef(),
      snapshot = this.snapshot(),
      generation = this.generation;
    if (
      !ref ||
      !snapshot ||
      !this.writable() ||
      this.saving() ||
      !this.changed()
    )
      return;
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    try {
      const saved = await firstValueFrom(
        this.http.put<TagSnapshot>(
          buildAgentUrl(ref.storeId, '/projects/item_tags'),
          {
            ...this.scope(ref),
            tags: [...this.tags()],
            ifMatch: snapshot.revision,
            expectedBranchHead: snapshot.branchHead,
          },
        ),
      );
      if (generation !== this.generation) return;
      if (
        saved.id !== snapshot.id ||
        saved.kind !== snapshot.kind ||
        !saved.revision
      )
        throw new Error('Invalid tag save receipt');
      this.snapshot.set(saved);
      this.tags.set(saved.tags ?? []);
      this.message.set('Tags saved.');
    } catch (error) {
      if (generation !== this.generation) return;
      this.error.set(
        error instanceof HttpErrorResponse && [409, 412].includes(error.status)
          ? 'This item or branch changed. Your draft is preserved. Reload tags to inspect the saved version before editing again.'
          : 'Tags were not confirmed saved. Your draft is preserved. Reload tags to inspect the saved version, then retry.',
      );
    } finally {
      if (generation === this.generation) this.saving.set(false);
    }
  }
}
