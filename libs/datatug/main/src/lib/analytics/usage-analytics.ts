import { DestroyRef, Injectable, InjectionToken, inject } from '@angular/core';
import { SneatAuthStateService } from '@sneat/auth-core';
import { AnalyticsService } from '@sneat/core';
import { NativeSourceInvalidationService } from '../evidence/native-source-invalidation';

/**
 * Anonymous product-usage events (public-demo REQ:demo-usage-analytics, project-walkthroughs
 * REQ:walkthrough-analytics). Privacy is by construction: every event has a fixed name and a fixed
 * set of parameter keys, and each value is either an author-declared identifier (project address,
 * walkthrough/chapter/step ID) or one of a closed set of words. Nothing here takes a user ID,
 * a record key, a parameter or captured value, query text or a result value, so none can be sent.
 * Events go through the shared `AnalyticsService.logEvent`; the app gates that service on the visitor's analytics
 * consent, so nothing is sent before a grant and an event raised before it is dropped, not queued.
 */
export type UsageEventName =
  | 'walkthrough_chapter_entered'
  | 'walkthrough_chapter_completed'
  | 'walkthrough_step_entered'
  | 'walkthrough_step_completed'
  | 'walkthrough_signin_prompted'
  | 'walkthrough_signin_completed'
  | 'walkthrough_reset'
  | 'signin_prompted'
  | 'signin_completed'
  | 'source_reset';

export type UsageEventParams = Readonly<Record<string, string>>;

/** Where usage events go: the shared `AnalyticsService` when the app provides one, else nowhere. */
export interface UsageAnalyticsSink {
  send(name: UsageEventName, params: UsageEventParams): void;
}

export const NOOP_USAGE_ANALYTICS_SINK: UsageAnalyticsSink = {
  send: () => undefined,
};

export const USAGE_ANALYTICS_SINK = new InjectionToken<UsageAnalyticsSink>(
  'usage analytics sink',
  {
    providedIn: 'root',
    factory: () => {
      const analytics = inject(AnalyticsService, { optional: true });
      return analytics
        ? { send: (name, params) => analytics.logEvent(name, params) }
        : NOOP_USAGE_ANALYTICS_SINK;
    },
  },
);

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
  return {
    project: declaredUsageValue(context.project),
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
    const auth = inject(SneatAuthStateService).authState.subscribe((state) => {
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
      auth.unsubscribe();
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
      this.sink.send(name, value);
    } catch {
      return;
    }
  }
}
