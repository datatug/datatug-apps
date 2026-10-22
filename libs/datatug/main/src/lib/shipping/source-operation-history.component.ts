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
import {
  IonButton,
  IonButtons,
  IonIcon,
  IonSelect,
  IonSelectOption,
} from '@ionic/angular';
import { timeOutline } from 'ionicons/icons';
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
    IonButtons,
    IonIcon,
    IonSelect,
    IonSelectOption,
    RetainedEvidenceViewerComponent,
  ],
  styles: `
    :host {
      display: block;
      margin-block: 1rem;
      color: var(--ion-text-color);
    }
    .history-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    h2 {
      font-size: 1rem;
      margin: 0;
    }
    ion-button {
      --color: var(--ion-text-color);
      font-size: 0.85rem;
    }
    .history-list {
      padding: 0;
      margin: 0.25rem 0;
      list-style: none;
    }
    .history-list li {
      padding-block: 0.5rem;
      border-bottom: 1px solid var(--ion-color-light-shade);
      overflow-wrap: anywhere;
    }
    .operation-heading {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.25rem 0.5rem;
    }
    .operation-heading strong {
      text-transform: capitalize;
    }
    .operation-heading ion-button {
      margin-inline-start: auto;
    }
    .operation-meta {
      margin: 0.1rem 0;
      font-size: 0.8rem;
      color: var(--ion-text-color-step-350, var(--ion-text-color));
    }
    p {
      font-size: 0.85rem;
      line-height: 1.45;
    }
  `,
  template: `<section aria-label="Source operation history">
    <header class="history-header">
      <h2>Source history</h2>
      <ion-buttons slot="end"
        ><ion-button
          fill="clear"
          (click)="load()"
          [disabled]="loading() || !environment()"
          aria-label="Load source operation history"
          ><ion-icon
            [icon]="historyIcon"
            slot="start"
            aria-hidden="true"
          />History</ion-button
        ></ion-buttons
      >
    </header>
    <ion-select
      label="History environment"
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
    @if (loading()) {
      <p role="status">Loading source history…</p>
    } @else if (error()) {
      <p role="alert">{{ error() }}</p>
    } @else if (notice()) {
      <p role="status">{{ notice() }}</p>
    }
    @if (operations(); as items) {
      <ul class="history-list" aria-label="Source operations">
        @for (item of items; track item.reference.operationId) {
          <li>
            <div class="operation-heading">
              <strong>{{ item.action }}</strong
              ><span>{{
                item.outcome === 'already-applied' ? 'No new change' : 'Applied'
              }}</span
              ><ion-button
                size="small"
                fill="clear"
                (click)="open(item)"
                [disabled]="loading()"
                >Open receipt</ion-button
              >
            </div>
            <p class="operation-meta">
              <time [attr.datetime]="item.acceptedAt">{{
                item.acceptedAt
              }}</time>
              · revision {{ item.reference.result.revision }}
            </p>
            <details>
              <summary>Operation identity</summary>
              <p class="operation-meta">
                {{ item.reference.operationId }} · generation
                {{ item.reference.result.generation }}
              </p>
            </details>
          </li>
        } @empty {
          <li>
            No source operations were returned for this account and environment.
          </li>
        }
      </ul>
    }
    @if (target(); as reference) {
      <sneat-datatug-retained-evidence-viewer
        [projectRef]="page.ref()"
        [environment]="environment()"
        [target]="reference"
      />
      <ion-button fill="clear" (click)="selected.set(undefined)"
        >Close receipt</ion-button
      >
    }
  </section>`,
})
export class SourceOperationHistoryComponent {
  readonly environments = input<readonly string[]>([]);
  readonly page = useDetectivePageContext();
  readonly environment = signal('');
  readonly historyIcon = timeOutline;
  readonly loading = signal(false);
  readonly error = signal('');
  readonly notice = signal('Choose an environment, then load History.');
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
            'Source access or state changed. Load History again to review the original operations.',
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
