import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IonButton, IonSelect, IonSelectOption } from '@ionic/angular';
import { ActivityListComponent } from '../activity/activity-list.component';
import { type ActivityListItem } from '../activity/activity-list-item';
import { type ArtifactRef } from '@sneat/datatug-semantic';
import { useDetectivePageContext } from '../detective/detective-page-context';
import {
  NativeSourceInvalidationService,
  matchesNativeSourceInvalidation,
} from '../evidence/native-source-invalidation';
import { RetainedEvidenceApiService } from '../evidence/retained-evidence-api.service';
import { RetainedEvidenceViewerComponent } from '../evidence/retained-evidence-viewer.component';
import { type SourceOperationSummary } from '../evidence/source-operation-contract';

@Component({
  selector: 'sneat-source-operation-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonButton,
    IonSelect,
    IonSelectOption,
    RetainedEvidenceViewerComponent,
    ActivityListComponent,
  ],
  styles: `
    :host {
      display: block;
      margin-block: 1rem;
      color: var(--ion-text-color);
    }
    ion-button {
      --color: var(--ion-text-color);
    }
    p {
      font-size: 0.85rem;
      line-height: 1.45;
    }
  `,
  template: `<sneat-activity-list
      heading="Shipping activity"
      actionLabel="Activity"
      listLabel="Source operations"
      loadingMessage="Loading source history…"
      emptyMessage="No source operations were returned for this account and environment."
      [items]="activityItems()"
      [loading]="loading()"
      [disabled]="!environment()"
      [error]="error()"
      [notice]="notice()"
      (reload)="load()"
      (openItem)="openActivity($event)"
    >
      <ion-select
        label="Activity environment"
        [value]="environment()"
        (ionChange)="chooseEnvironment($event.detail.value)"
      >
        <ion-select-option value="">Choose environment</ion-select-option>
        @for (item of environments(); track item) {
          <ion-select-option [value]="item">{{ item }}</ion-select-option>
        }
      </ion-select>
      <p>
        Original operations for your current account. Opening a receipt makes no
        source change and does not prove recovery.
      </p>
    </sneat-activity-list>
    @if (target(); as reference) {
      <sneat-datatug-retained-evidence-viewer
        [projectRef]="page.ref()"
        [environment]="environment()"
        [target]="reference"
      />
      <ion-button fill="clear" (click)="selected.set(undefined)"
        >Close receipt</ion-button
      >
    } `,
})
export class SourceOperationHistoryComponent {
  readonly environments = input<readonly string[]>([]);
  readonly page = useDetectivePageContext();
  readonly environment = signal('');
  readonly loading = signal(false);
  readonly error = signal('');
  readonly notice = signal('Choose an environment, then load Activity.');
  private readonly api = inject(RetainedEvidenceApiService);
  private readonly destroy = inject(DestroyRef);
  private controller?: AbortController;
  private activeKey?: string;
  private readonly key = computed(() =>
    JSON.stringify([this.page.identity(), this.page.ref(), this.environment()]),
  );
  private readonly held = signal<
    { key: string; items: SourceOperationSummary[] } | undefined
  >(undefined);
  readonly selected = signal<
    | {
        key: string;
        reference: Extract<ArtifactRef, { kind: 'source-operation' }>;
      }
    | undefined
  >(undefined);
  readonly operations = computed(() =>
    this.held()?.key === this.key() ? this.held()?.items : undefined,
  );
  readonly activityItems = computed<readonly ActivityListItem[] | undefined>(
    () =>
      this.operations()?.map((item) => ({
        id: item.reference.operationId,
        title: item.action,
        outcome:
          item.outcome === 'already-applied' ? 'No new change' : 'Applied',
        acceptedAt: item.acceptedAt,
        metadata: `revision ${item.reference.result.revision}`,
        detail: {
          label: 'Operation identity',
          text: `${item.reference.operationId} · generation ${item.reference.result.generation}`,
        },
        openLabel: 'Open receipt',
      })),
  );
  openActivity(id: string) {
    const item = this.operations()?.find(
      (candidate) => candidate.reference.operationId === id,
    );
    if (item) this.open(item);
  }
  readonly target = computed(() =>
    this.selected()?.key === this.key()
      ? this.selected()?.reference
      : undefined,
  );
  constructor() {
    this.page.scopeChanges$
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.clear());
    inject(NativeSourceInvalidationService)
      .changes$.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (
          matchesNativeSourceInvalidation(
            event,
            this.page.ref(),
            this.page.context()?.principal || '',
            {
              sourceId: 'shipping-working-copy',
              environment: this.environment(),
            },
          )
        ) {
          this.clear();
          this.notice.set(
            'Source access or state changed. Load Activity again to review the original operations.',
          );
        }
      });
    effect(() => {
      const key = this.key();
      untracked(() => {
        if (this.activeKey !== undefined && key !== this.activeKey)
          this.clear();
      });
    });
    effect(() => {
      if (
        this.environment() &&
        !this.environments().includes(this.environment())
      )
        this.chooseEnvironment('');
    });
    this.destroy.onDestroy(() => this.clear());
  }
  private clear() {
    this.controller?.abort();
    this.controller = undefined;
    this.activeKey = undefined;
    this.held.set(undefined);
    this.selected.set(undefined);
    this.loading.set(false);
    this.error.set('');
    this.notice.set('');
  }
  chooseEnvironment(value: string) {
    if (value && !this.environments().includes(value)) return;
    this.clear();
    this.environment.set(value);
  }
  async load(): Promise<void> {
    if (this.loading() || !this.environment()) return;
    this.clear();
    const controller = new AbortController();
    this.controller = controller;
    const key = this.key(),
      ref = this.page.ref(),
      actor = this.page.context()?.principal;
    if (!ref || !actor) {
      this.error.set('Sign in to a native project to read source history.');
      return;
    }
    this.activeKey = key;
    this.loading.set(true);
    try {
      const items = await this.api.sourceOperations(
        {
          projectRef: structuredClone(ref),
          environment: this.environment(),
          actor,
        },
        controller.signal,
      );
      if (
        !controller.signal.aborted &&
        !this.destroy.destroyed &&
        key === this.key() &&
        this.controller === controller
      )
        this.held.set({ key, items });
    } catch {
      if (
        !controller.signal.aborted &&
        !this.destroy.destroyed &&
        key === this.key() &&
        this.controller === controller
      )
        this.error.set(
          'Source history is unavailable. Review current account, project and source access, then try again.',
        );
    } finally {
      if (this.controller === controller) {
        this.loading.set(false);
        this.controller = undefined;
      }
    }
  }
  open(item: SourceOperationSummary) {
    if (
      !this.operations()?.some(
        (current) => JSON.stringify(current) === JSON.stringify(item),
      )
    )
      return;
    this.selected.set({
      key: this.key(),
      reference: {
        kind: 'source-operation',
        sourceOperation: structuredClone(item.reference),
      },
    });
  }
}
