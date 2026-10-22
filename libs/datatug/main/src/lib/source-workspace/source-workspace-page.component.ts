import { BusinessClockChipComponent } from './business-clock-chip.component';
import { NgComponentOutlet } from '@angular/common';
import { RetainedEvidenceViewerComponent } from '../evidence/retained-evidence-viewer.component';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { ActivityListComponent } from '../activity/activity-list.component';
import { useDetectivePageContext } from '../detective/detective-page-context';
import {
  matchesNativeSourceInvalidation,
  NativeSourceInvalidationService,
} from '../evidence/native-source-invalidation';
import { projectPageHref } from '../nav/project-page-href';
import { SourceActionFormComponent } from './source-action-form.component';
import { SourceDetailsComponent } from './source-details.component';
import {
  SOURCE_ADAPTER_REGISTRATIONS,
  type SourceFieldValue,
  type SourceUiEvent,
  type SourceUiScope,
  type SourceWorkspaceController,
} from './source-workspace-contract';

@Component({
  selector: 'sneat-source-workspace-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BusinessClockChipComponent,
    RouterLink,
    NgComponentOutlet,
    RetainedEvidenceViewerComponent,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    ActivityListComponent,
    SourceActionFormComponent,
    SourceDetailsComponent,
  ],
  styles: `
    :host {
      color: var(--ion-text-color);
    }
    .source-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .source-header h2 {
      font-size: 1rem;
      margin: 0;
      overflow-wrap: anywhere;
    }
    .source-links {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.75rem;
      margin-block: 0.5rem;
    }
    .source-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.25rem;
    }
    ion-button {
      --color: var(--ion-text-color);
      font-size: 0.85rem;
    }
    p {
      font-size: 0.85rem;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
  `,
  template: `<ion-header
      ><ion-toolbar
        ><ion-title
          >{{ view()?.title || 'Source'
          }}<sneat-datatug-business-clock /></ion-title></ion-toolbar
    ></ion-header>
    <ion-content class="ion-padding">
      <a [routerLink]="overviewHref()">Back to project overview</a>
      @if (view(); as current) {
        <header class="source-header">
          <h2>{{ current.title }}</h2>
          <ion-buttons slot="end"
            ><ion-button
              fill="clear"
              (click)="dispatch({ type: 'refresh' })"
              [disabled]="current.busy || current.loading"
              >Refresh</ion-button
            ></ion-buttons
          >
        </header>
        @if (current.description) {
          <p>{{ current.description }}</p>
        }
        @if (current.loading) {
          <p role="status">Reading current source state…</p>
        }
        @if (current.error || dispatchError()) {
          <p role="alert">{{ current.error || dispatchError() }}</p>
        }
        @if (current.notice) {
          <p role="status">{{ current.notice }}</p>
        }
        @if (current.current; as details) {
          <sneat-source-details [details]="details" />
        }
        @if (!current.interaction) {
          <div class="source-actions" aria-label="Source actions">
            @for (action of current.actions; track action.id) {
              <ion-button
                (click)="prepare(action.id)"
                [disabled]="current.busy || current.loading || !action.enabled"
                >{{ action.title }}</ion-button
              >
              @if (action.description) {
                <p>{{ action.description }}</p>
              }
              @if (!action.enabled && action.unavailableReason) {
                <p role="status">{{ action.unavailableReason }}</p>
              }
            }
          </div>
        }
        @if (current.links?.length) {
          <nav class="source-links" aria-label="Related project content">
            @for (link of current.links; track link.label) {
              <a [routerLink]="link.destination">{{ link.label }}</a>
            }
          </nav>
        }
        @if (current.interaction; as interaction) {
          <sneat-source-action-form
            [interaction]="interaction"
            [contextKey]="formContextKey()"
            [busy]="current.busy || current.loading"
            (submitted)="submit(interaction.actionId, $event)"
            (cancelReview)="dispatch({ type: 'cancel-review' })"
            (retry)="dispatch({ type: 'retry-original' })"
            (reviewConflict)="dispatch({ type: 'review-conflict' })"
          />
        }
        @if (current.busy) {
          <p role="status">Waiting for acknowledgement…</p>
        }
        @if (current.activity; as activity) {
          <sneat-activity-list
            [heading]="activity.heading"
            [actionLabel]="activity.actionLabel"
            [listLabel]="activity.listLabel"
            [loadingMessage]="activity.loadingMessage"
            [emptyMessage]="activity.emptyMessage"
            [items]="activity.items"
            [loading]="activity.loading"
            [disabled]="current.busy || !activity.enabled"
            [error]="activity.error || ''"
            [notice]="activity.notice || ''"
            (reload)="dispatch({ type: 'load-activity' })"
            (openItem)="openActivity($event)"
          />
        }
        @if (current.retainedEvidence; as evidence) {
          <sneat-datatug-retained-evidence-viewer
            [projectRef]="page.ref()"
            [environment]="evidence.environment"
            [target]="evidence.target"
          />
          <ion-button fill="clear" (click)="dispatch({ type: 'close-details' })"
            >Close evidence</ion-button
          >
        }
        @if (current.browser; as browser) {
          <ng-container
            *ngComponentOutlet="browser.component; inputs: browser.inputs"
          />
        }
        @if (current.details; as details) {
          <sneat-source-details [details]="details" /><ion-button
            fill="clear"
            (click)="dispatch({ type: 'close-details' })"
            >Close details</ion-button
          >
        }
      } @else {
        <p role="status">{{ unavailable() }}</p>
      }
    </ion-content>`,
})
export class SourceWorkspacePageComponent {
  readonly page = useDetectivePageContext();
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly registrations = inject(SOURCE_ADAPTER_REGISTRATIONS);
  private readonly destroy = inject(DestroyRef);
  private readonly generation = signal(0);
  private readonly active = signal<
    | {
        key: string;
        scope: SourceUiScope;
        controller: SourceWorkspaceController;
        abort: AbortController;
      }
    | undefined
  >(undefined);
  readonly dispatchError = signal('');
  readonly unavailable = signal(
    'This source is unavailable. No source adapter is registered for this project context.',
  );
  readonly overviewHref = computed(() =>
    projectPageHref(this.page.ref(), 'overview'),
  );
  private readonly scope = computed<SourceUiScope | undefined>(() => {
    const projectRef = this.page.ref(),
      actor = this.page.context()?.principal,
      identity = this.page.identity();
    const sourceId = this.params().get('sourceId');
    const environment =
      this.query().get('environment') ?? this.page.currentEnvironment()?.id;
    if (
      !projectRef ||
      !actor ||
      !identity ||
      !sourceId ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(sourceId) ||
      (environment !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(environment))
    )
      return undefined;
    return {
      projectRef: structuredClone(projectRef),
      actor,
      identity,
      sourceId,
      ...(environment ? { environment } : {}),
    };
  });
  private readonly key = computed(() =>
    JSON.stringify([
      this.scope(),
      this.generation(),
      this.page.currentEnvironment()?.id,
    ]),
  );
  readonly formContextKey = computed(() => this.key());
  readonly view = computed(() =>
    this.active()?.key === this.key()
      ? this.active()?.controller.view()
      : undefined,
  );
  constructor() {
    this.page.scopeChanges$
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.invalidate());
    inject(NativeSourceInvalidationService)
      .changes$.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        const scope = this.scope();
        if (
          scope &&
          matchesNativeSourceInvalidation(
            event,
            scope.projectRef,
            scope.actor,
            { sourceId: scope.sourceId, environment: scope.environment || '' },
          )
        ) {
          const held = this.active();
          if (held?.key === this.key() && held.controller.sourceChanged?.())
            return;
          this.invalidate();
        }
      });
    effect((cleanup) => {
      const scope = this.scope(),
        key = this.key();
      untracked(() => {
        this.release();
        this.dispatchError.set('');
        if (!scope) {
          this.unavailable.set(
            'Open a signed-in project with a valid source and environment.',
          );
          return;
        }
        const matches = this.registrations.filter(
          (item) => item.sourceId === scope.sourceId,
        );
        if (matches.length !== 1) {
          this.unavailable.set(
            'This source is unavailable. No unique source adapter is registered for this project context.',
          );
          return;
        }
        const abort = new AbortController();
        try {
          this.active.set({
            key,
            scope,
            abort,
            controller: matches[0].create(scope, abort.signal),
          });
        } catch {
          abort.abort();
          this.unavailable.set(
            'Current source access could not be verified. Return to the project and retry.',
          );
        }
      });
      cleanup(() => this.release());
    });
    this.destroy.onDestroy(() => this.release());
  }
  private release() {
    const held = this.active();
    this.active.set(undefined);
    held?.abort.abort();
    held?.controller.destroy();
  }
  private invalidate() {
    this.release();
    this.generation.update((value) => value + 1);
  }
  prepare(actionId: string) {
    const view = this.view();
    if (
      !view ||
      view.busy ||
      view.loading ||
      view.interaction ||
      !view.actions.some((action) => action.id === actionId && action.enabled)
    )
      return;
    this.dispatch({ type: 'prepare-action', actionId });
  }
  submit(actionId: string, values: Readonly<Record<string, SourceFieldValue>>) {
    const interaction = this.view()?.interaction;
    if (
      !interaction ||
      interaction.actionId !== actionId ||
      interaction.phase !== 'review' ||
      !interaction.enabled
    )
      return;
    this.dispatch({ type: 'submit-action', actionId, values });
  }
  openActivity(itemId: string) {
    const activity = this.view()?.activity;
    if (
      !activity?.enabled ||
      activity.loading ||
      !activity.items?.some((item) => item.id === itemId)
    )
      return;
    this.dispatch({ type: 'open-activity', itemId });
  }
  dispatch(event: SourceUiEvent) {
    const held = this.active(),
      view = this.view();
    if (!held || held.key !== this.key() || !view || view.busy || view.loading)
      return;
    if (
      event.type === 'retry-original' &&
      (view.interaction?.phase !== 'uncertain' || !view.interaction.enabled)
    )
      return;
    if (
      event.type === 'review-conflict' &&
      (view.interaction?.phase !== 'conflict' || !view.interaction.enabled)
    )
      return;
    if (
      event.type === 'load-activity' &&
      (!view.activity?.enabled || view.activity.loading)
    )
      return;
    this.dispatchError.set('');
    try {
      void Promise.resolve(held.controller.handle(event)).catch(() => {
        if (this.active() === held && held.key === this.key())
          this.dispatchError.set(
            'The action could not be confirmed. Review current state before retrying.',
          );
      });
    } catch {
      if (this.active() === held)
        this.dispatchError.set(
          'The action could not be confirmed. Review current state before retrying.',
        );
    }
  }
}
