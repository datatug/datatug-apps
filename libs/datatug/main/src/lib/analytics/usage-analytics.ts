import { DestroyRef, Injectable, InjectionToken, inject } from '@angular/core';
import { DEMO_PROJECT_REF } from '@datatug/project-address';
import {
  NOOP_USAGE_EVENT_SINK,
  USAGE_EVENT_SINK,
  type UsageEventName,
  type UsageEventParams,
  type UsageEventSink,
} from '@datatug/product-profiles';
import { SneatAuthStateService } from '@sneat/auth-core';
import { NativeSourceInvalidationService } from '../evidence/native-source-invalidation';
import type { IProjectRef } from '../core/project-context';

/**
 * Anonymous product-usage events (public-demo REQ:demo-usage-analytics, project-walkthroughs
 * REQ:walkthrough-analytics). Privacy is by construction: every event is on the closed list
 * (`USAGE_EVENT_NAMES`, @datatug/product-profiles) and has a fixed set of parameter keys whose values are closed
 * words. `project` is only `demo` (the public demo project) or `other`, never a repository or account name, and
 * walkthrough, chapter and step ids are sent for the public demo only. Nothing here takes a user ID, a record key, a
 * parameter or captured value, query text or a result value, so none can be sent, and nothing identifies the visitor.
 * Events go to USAGE_EVENT_SINK: the app provides it only where a consented, anonymous backend runs, gated on the
 * visitor's analytics consent, so nothing is sent before a grant and an event raised before it is dropped, not queued.
 */
export type {
  UsageEventName,
  UsageEventParams,
} from '@datatug/product-profiles';

/** Where usage events go: the app's USAGE_EVENT_SINK, else nowhere. */
export type UsageAnalyticsSink = UsageEventSink;

export const NOOP_USAGE_ANALYTICS_SINK: UsageAnalyticsSink =
  NOOP_USAGE_EVENT_SINK;

export const USAGE_ANALYTICS_SINK = new InjectionToken<UsageAnalyticsSink>(
  'usage analytics sink',
  { providedIn: 'root', factory: () => inject(USAGE_EVENT_SINK) },
);

/** The only values the `project` parameter takes. */
export type UsageProject = 'demo' | 'other';

/** The public demo project's address, as walkthroughs declare it. */
const DEMO_PROJECT_ADDRESS =
  /^github\.com\/datatug\/datatug-demo-project(?:\/|$)/u;

/** `demo` for the public demo project (a ref or its declared address), `other` for anything else. */
export function usageProject(
  project: IProjectRef | string | undefined | null,
): UsageProject {
  if (typeof project === 'string')
    return DEMO_PROJECT_ADDRESS.test(project) ? 'demo' : 'other';
  // The public original only (its legacy `github` store id included): never a branch, a working copy or a shared copy.
  return project &&
    (project.storeId === DEMO_PROJECT_REF.storeId ||
      project.storeId === 'github') &&
    project.projectId === DEMO_PROJECT_REF.projectId &&
    !project.spaceID &&
    !project.projectApi &&
    !project.branch
    ? 'demo'
    : 'other';
}

/** How a query run ended. */
export type QueryRunOutcome = 'rows' | 'empty' | 'error' | 'cancelled';
/** What an evidence link points at. */
export type EvidenceLinkKind = 'execution' | 'check-run';
/** What opening an evidence link led to. */
export type EvidenceLinkAccess = 'open' | 'sign-in' | 'invalid';

/** The public walkthrough an event belongs to. Only author-declared identifiers. */
export interface WalkthroughAnalyticsContext {
  /** The public project's address, e.g. `github.com/datatug/datatug-demo-project`. */
  readonly project: string;
  readonly walkthroughId: string;
  /** Declaration revision, e.g. a SHA-256 of the canonical JSON. */
  readonly walkthroughVersion?: string;
  readonly mode?: string;
}

/** Why the visitor was asked to sign in: a closed set, never free text. */
export type SignInPromptReason = 'walkthrough' | 'evidence-link';
export type StepOutcome = 'completed' | 'skipped';

/** One declared identifier or address: letters, digits and `._:/-`, at most 128 characters. */
const DECLARED = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

export function declaredUsageValue(value: string): string {
  if (typeof value !== 'string' || !DECLARED.test(value))
    throw new Error('Usage analytics accept declared identifiers only.');
  return value;
}

function contextParams(
  context: WalkthroughAnalyticsContext,
): Record<string, string> {
  const project = usageProject(context.project);
  // A walkthrough of any other project is counted, but its author-declared ids are never sent.
  if (project !== 'demo') return { project };
  return {
    project,
    walkthrough_id: declaredUsageValue(context.walkthroughId),
    ...(context.walkthroughVersion === undefined
      ? {}
      : {
          walkthrough_version: declaredUsageValue(context.walkthroughVersion),
        }),
    ...(context.mode === undefined
      ? {}
      : { mode: declaredUsageValue(context.mode) }),
  };
}

export const PENDING_SIGN_IN_KEY = 'datatug.usage.signin-pending.v1';

interface PendingSignIn {
  readonly reason: SignInPromptReason;
  readonly params: UsageEventParams;
}

function readPending(value: string | null): PendingSignIn | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as PendingSignIn;
    if (
      (parsed.reason !== 'walkthrough' && parsed.reason !== 'evidence-link') ||
      !parsed.params ||
      typeof parsed.params !== 'object' ||
      Object.values(parsed.params).some(
        (item) => typeof item !== 'string' || !DECLARED.test(item),
      )
    )
      return undefined;
    return { reason: parsed.reason, params: { ...parsed.params } };
  } catch {
    return undefined;
  }
}

/**
 * The one hook product features call to record usage. Walkthroughs call the chapter/step/sign-in
 * methods; act events of the public demo are its walkthrough's chapter events. A source reset is
 * recorded from the verified source receipt, with no identifiers.
 */
@Injectable({ providedIn: 'root' })
export class UsageAnalyticsService {
  private readonly sink = inject(USAGE_ANALYTICS_SINK);
  private memoryPending: string | null = null;
  private signedIn = false;

  constructor() {
    const destroy = inject(DestroyRef);
    // Optional: a page rendered without the auth state (tests, embeds) still records its events.
    const auth = inject(SneatAuthStateService, {
      optional: true,
    })?.authState.subscribe((state) => {
      this.signedIn =
        state?.status === 'authenticated' &&
        !!state.user &&
        state.user.isAnonymous !== true;
      if (this.signedIn) this.completePendingSignIn();
    });
    const resets = inject(NativeSourceInvalidationService).changes$.subscribe(
      (event) => {
        if (event.action === 'reset') this.emit('source_reset', {});
      },
    );
    destroy.onDestroy(() => {
      auth?.unsubscribe();
      resets.unsubscribe();
    });
  }

  chapterEntered(context: WalkthroughAnalyticsContext, chapterId: string) {
    this.emit('walkthrough_chapter_entered', () => ({
      ...contextParams(context),
      chapter_id: declaredUsageValue(chapterId),
    }));
  }

  chapterCompleted(context: WalkthroughAnalyticsContext, chapterId: string) {
    this.emit('walkthrough_chapter_completed', () => ({
      ...contextParams(context),
      chapter_id: declaredUsageValue(chapterId),
    }));
  }

  stepEntered(
    context: WalkthroughAnalyticsContext,
    chapterId: string,
    stepId: string,
    requirement?: string,
  ) {
    this.emit('walkthrough_step_entered', () => ({
      ...contextParams(context),
      chapter_id: declaredUsageValue(chapterId),
      step_id: declaredUsageValue(stepId),
      ...(requirement === undefined
        ? {}
        : { requirement: declaredUsageValue(requirement) }),
    }));
  }

  stepCompleted(
    context: WalkthroughAnalyticsContext,
    chapterId: string,
    stepId: string,
    outcome: StepOutcome,
  ) {
    this.emit('walkthrough_step_completed', () => {
      if (outcome !== 'completed' && outcome !== 'skipped')
        throw new Error('Unknown step outcome.');
      return {
        ...contextParams(context),
        chapter_id: declaredUsageValue(chapterId),
        step_id: declaredUsageValue(stepId),
        outcome,
      };
    });
  }

  /** A parameter value was picked with the lookup. */
  lookupUsed(project: IProjectRef | undefined) {
    this.emit('parameter_lookup_used', () => ({
      project: usageProject(project),
    }));
  }

  /** A query run ended; only the kind of outcome is recorded, never the query, its parameters or its rows. */
  queryRunFinished(outcome: QueryRunOutcome, project: IProjectRef | undefined) {
    this.emit('query_run_finished', () => {
      if (!['rows', 'empty', 'error', 'cancelled'].includes(outcome))
        throw new Error('Unknown query run outcome.');
      return { outcome, project: usageProject(project) };
    });
  }

  /** An evidence link was copied. */
  evidenceLinkCopied(kind: EvidenceLinkKind, project: IProjectRef | undefined) {
    this.emit('evidence_link_copied', () => {
      if (kind !== 'execution' && kind !== 'check-run')
        throw new Error('Unknown evidence link kind.');
      return { kind, project: usageProject(project) };
    });
  }

  /** An evidence link was opened, and what it led to. */
  evidenceLinkOpened(
    access: EvidenceLinkAccess,
    project: IProjectRef | undefined,
  ) {
    this.emit('evidence_link_opened', () => {
      if (!['open', 'sign-in', 'invalid'].includes(access))
        throw new Error('Unknown evidence link access.');
      return { access, project: usageProject(project) };
    });
  }

  /** The walkthrough's own Restart (this tab's progress), not a source reset. */
  walkthroughReset(context: WalkthroughAnalyticsContext) {
    this.emit('walkthrough_reset', () => contextParams(context));
  }

  /**
   * The visitor was asked to sign in. A later sign-in in this tab records the matching completed
   * event once. A visitor who is already signed in is never prompted, so nothing is recorded.
   */
  signInPrompted(
    reason: SignInPromptReason,
    context?: WalkthroughAnalyticsContext,
    chapterId?: string,
  ) {
    if (this.signedIn) return;
    let params: Record<string, string>;
    try {
      if (reason !== 'walkthrough' && reason !== 'evidence-link')
        throw new Error('Unknown sign-in reason.');
      params = context
        ? {
            ...contextParams(context),
            ...(chapterId === undefined
              ? {}
              : { chapter_id: declaredUsageValue(chapterId) }),
          }
        : { reason };
    } catch {
      return;
    }
    this.writePending(JSON.stringify({ reason, params }));
    this.emit(
      context ? 'walkthrough_signin_prompted' : 'signin_prompted',
      params,
    );
  }

  private completePendingSignIn() {
    const pending = readPending(this.readPending());
    if (!pending) return;
    this.writePending(null);
    this.emit(
      pending.params['walkthrough_id']
        ? 'walkthrough_signin_completed'
        : 'signin_completed',
      pending.params,
    );
  }

  private readPending(): string | null {
    try {
      return globalThis.sessionStorage.getItem(PENDING_SIGN_IN_KEY);
    } catch {
      return this.memoryPending;
    }
  }

  private writePending(value: string | null) {
    this.memoryPending = value;
    try {
      if (value === null)
        globalThis.sessionStorage.removeItem(PENDING_SIGN_IN_KEY);
      else globalThis.sessionStorage.setItem(PENDING_SIGN_IN_KEY, value);
    } catch {
      // Storage refused (private mode): the in-memory copy covers this page.
    }
  }

  /** A malformed identifier drops the event; analytics never breaks the product. */
  private emit(
    name: UsageEventName,
    params: UsageEventParams | (() => UsageEventParams),
  ) {
    let value: UsageEventParams;
    try {
      value = typeof params === 'function' ? params() : params;
      // A walkthrough of any project but the public demo is counted, its author-declared ids never sent.
      if (name.startsWith('walkthrough_') && value['project'] !== 'demo')
        value = { project: 'other' };
      this.sink.send(name, value);
    } catch {
      return;
    }
  }
}
