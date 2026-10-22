import { InjectionToken, type Signal, type Type } from '@angular/core';
import { type UrlTree } from '@angular/router';
import { type ArtifactRef } from '@sneat/datatug-semantic';
import { type IProjectRef } from '../core/project-context';
import { type ActivityListItem } from '../activity/activity-list-item';

/** Local presentation only. Descriptors/configuration never grant source rights. */
export interface SourceUiScope {
  readonly projectRef: IProjectRef;
  readonly actor: string;
  readonly identity: string;
  readonly sourceId: string;
  readonly environment?: string;
}
export interface SourceFact {
  readonly label: string;
  readonly value: string;
  readonly kind?: 'text' | 'time' | 'hash';
}
export interface SourceDetails {
  readonly title: string;
  readonly summary?: string;
  readonly sections: readonly {
    readonly title: string;
    readonly collapsed?: boolean;
    readonly facts: readonly SourceFact[];
  }[];
}
export type SourceFieldValue =
  | { readonly type: 'integer'; readonly value: string }
  | { readonly type: 'string'; readonly value: string };
export interface SourceActionField {
  readonly id: string;
  readonly label: string;
  readonly type: SourceFieldValue['type'];
  readonly required: boolean;
  readonly choices?: readonly {
    readonly label: string;
    readonly value: string;
  }[];
  readonly maxLength?: number;
}
export interface SourceAction {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly unavailableReason?: string;
}
export interface SourceInteraction {
  readonly reviewId: string;
  readonly actionId: string;
  readonly title: string;
  readonly description: string;
  readonly phase: 'review' | 'uncertain' | 'conflict' | 'acknowledged';
  readonly fields: readonly SourceActionField[];
  readonly submitLabel: string;
  readonly enabled: boolean;
  readonly cancelLabel?: string;
  readonly retryLabel?: string;
  readonly conflictLabel?: string;
}
export interface SourceWorkspaceView {
  readonly title: string;
  readonly description?: string;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error?: string;
  readonly notice?: string;
  readonly actions: readonly SourceAction[];
  readonly interaction?: SourceInteraction;
  readonly current?: SourceDetails;
  readonly details?: SourceDetails;
  readonly links?: readonly {
    readonly label: string;
    readonly destination: UrlTree;
  }[];
  readonly retainedEvidence?: {
    readonly target: ArtifactRef;
    readonly environment: string;
  };
  /** Deployment adapter composition only; never an executable project-file declaration. */
  readonly browser?: {
    readonly component: Type<unknown>;
    readonly inputs: Record<string, unknown>;
  };
  readonly activity?: {
    readonly heading: string;
    readonly actionLabel: string;
    readonly listLabel: string;
    readonly loadingMessage: string;
    readonly emptyMessage: string;
    readonly items?: readonly ActivityListItem[];
    readonly loading: boolean;
    readonly enabled: boolean;
    readonly error?: string;
    readonly notice?: string;
  };
}
export type SourceUiEvent =
  | {
      readonly type:
        | 'refresh'
        | 'cancel-review'
        | 'retry-original'
        | 'review-conflict'
        | 'load-activity'
        | 'close-details';
    }
  | { readonly type: 'prepare-action'; readonly actionId: string }
  | {
      readonly type: 'submit-action';
      readonly actionId: string;
      readonly values: Readonly<Record<string, SourceFieldValue>>;
    }
  | { readonly type: 'open-activity'; readonly itemId: string };
export interface SourceWorkspaceController {
  readonly view: Signal<SourceWorkspaceView>;
  /** Owner validates every event against current rights/state and exact original intent. */
  handle(event: SourceUiEvent): void | Promise<void>;
  /** Clear protected reads synchronously. True keeps only an already in-flight delivery subscribed
   * so a verified acknowledgement can retire its original journal. Never handles identity/environment changes. */
  sourceChanged?(): boolean;
  destroy(): void;
}
/** heterogeneous-sources REQ:source-business-clock: the source's own "now", never the wall clock. */
export interface SourceBusinessClock {
  /** Visitor-facing name chosen by the source, e.g. "Demo clock". */
  readonly label: string;
  /** One RFC 3339 instant ending in `Z`. */
  readonly at: string;
}
export interface SourceAdapterRegistration {
  readonly sourceId: string;
  /** Read-only owner discovery. Metadata selects a source; only current owner reads establish availability. */
  discover?(
    scope: SourceUiScope,
    signal: AbortSignal,
  ): Promise<
    { readonly title: string; readonly description?: string } | undefined
  >;
  /** Optional read-only business clock under the viewer's current rights. Undefined: no clock. */
  businessClock?(
    scope: SourceUiScope,
    signal: AbortSignal,
  ): Promise<SourceBusinessClock | undefined>;
  /** A fresh instance for this host lifetime. Creation may read, never mutate a source. */
  create(scope: SourceUiScope, signal: AbortSignal): SourceWorkspaceController;
}
/** Immutable registration factories only; never singleton mutable controller state. */
export const SOURCE_ADAPTER_REGISTRATIONS = new InjectionToken<
  readonly SourceAdapterRegistration[]
>('source adapter registrations', { providedIn: 'root', factory: () => [] });

/** Optional scoped context for adapter-owned protocol controllers. */
export const SOURCE_UI_SCOPE = new InjectionToken<SourceUiScope>(
  'source UI scope',
);
