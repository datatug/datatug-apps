import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { IonButton } from '@ionic/angular';
import { tabStorage } from '@datatug/product-profiles';
import { SneatAuthStateService } from '@sneat/auth-core';
import { UsageAnalyticsService } from '../analytics/usage-analytics';
import type { IProjectRef } from '../core/project-context';
import {
  EVIDENCE_LINK_PREFIX,
  parseEvidenceFragment,
  type EvidenceLink,
} from './evidence-link';
import { RetainedEvidenceViewerComponent } from './retained-evidence-viewer.component';

/** This tab only: the link an anonymous visitor asked to open, so sign-in can return to it. */
export const PENDING_EVIDENCE_LINK_KEY = 'datatug.evidence-link.pending.v1';
const PENDING_MAX_AGE_MS = 30 * 60 * 1000;

interface PendingLink {
  readonly path: string;
  readonly fragment: string;
  readonly createdAt: number;
}

type LinkState =
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'sign-in'; readonly fragment: string }
  | { readonly kind: 'open'; readonly link: EvidenceLink };

/**
 * Signing out, on any page, forgets the evidence link an anonymous visitor asked to open (REQ:shareable-evidence-links:
 * "cleared on sign-out"). Run once per app from the DataTug routes' environment injector, which outlives every page.
 */
export function clearPendingEvidenceLinkOnSignOut(): void {
  let signedIn = false;
  const auth = inject(SneatAuthStateService, { optional: true });
  if (!auth) return;
  const subscription = auth.authState.subscribe((state) => {
    const now =
      state?.status === 'authenticated' &&
      !!state.user?.uid &&
      state.user.isAnonymous !== true;
    if (signedIn && !now && state?.status !== 'authenticating')
      tabStorage()?.removeItem(PENDING_EVIDENCE_LINK_KEY);
    if (state?.status !== 'authenticating') signedIn = now;
  });
  inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
}

/**
 * Opens a copied evidence link (evidence-records REQ:copyable-evidence-link) on the project overview. Signed-in
 * readers see the run through the ordinary retained viewer, which re-checks their current rights; anonymous
 * visitors see a sign-in prompt and no content, and no evidence read is made for them or for a bad link.
 */
@Component({
  selector: 'sneat-datatug-shared-evidence-link',
  imports: [IonButton, RetainedEvidenceViewerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@switch (state().kind) {
    @case ('invalid') {
      <section class="shared-evidence" aria-labelledby="shared-evidence-title">
        <h2 id="shared-evidence-title">Shared evidence</h2>
        <p role="alert">
          This evidence link can't be opened. Ask whoever shared it for a new
          link.
        </p>
      </section>
    }
    @case ('checking') {
      <section class="shared-evidence" aria-labelledby="shared-evidence-title">
        <h2 id="shared-evidence-title">Shared evidence</h2>
        <p role="status">Checking this link…</p>
      </section>
    }
    @case ('sign-in') {
      <section class="shared-evidence" aria-labelledby="shared-evidence-title">
        <h2 id="shared-evidence-title">Shared evidence</h2>
        <p>
          Sign in to open this shared evidence. The link gives no access by
          itself: you will see the run only if your account can already see it.
        </p>
        <ion-button (click)="signIn()">Sign in to open</ion-button>
      </section>
    }
    @case ('open') {
      @if (openLink(); as link) {
        <section
          class="shared-evidence"
          aria-labelledby="shared-evidence-title"
        >
          <div class="heading">
            <h2 id="shared-evidence-title">Shared evidence</h2>
            <ion-button size="small" fill="clear" (click)="close()"
              >Close</ion-button
            >
          </div>
          <sneat-datatug-retained-evidence-viewer
            [projectRef]="projectRef()"
            [environment]="link.environment"
            [target]="link.target"
          />
        </section>
      }
    }
  }`,
  styles: `
    :host {
      display: block;
    }
    .shared-evidence {
      margin: 0.75rem;
      padding: 0.5rem 0.75rem 0.75rem;
      border-radius: 8px;
      background: var(--ion-item-background, var(--ion-background-color));
      color: var(--ion-text-color);
    }
    .heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    h2 {
      font-size: 1.05rem;
      margin: 0.25rem 0;
    }
  `,
})
export class SharedEvidenceLinkComponent {
  readonly projectRef = input<IProjectRef>();
  private readonly router = inject(Router);
  private readonly usage = inject(UsageAnalyticsService);
  private readonly route = inject(ActivatedRoute);
  private readonly fragment = toSignal(this.route.fragment, {
    initialValue: null,
  });
  private readonly auth = toSignal(inject(SneatAuthStateService).authState, {
    initialValue: undefined,
  });
  private readonly authKind = computed(() => {
    const state = this.auth();
    if (!state || state.status === 'authenticating') return 'checking';
    return state.status === 'authenticated' &&
      !!state.user?.uid &&
      state.user.isAnonymous !== true
      ? 'signed-in'
      : 'signed-out';
  });
  protected readonly state = computed<LinkState>(() => {
    const fragment = this.fragment();
    if (!fragment?.startsWith(EVIDENCE_LINK_PREFIX)) return { kind: 'none' };
    // The project identity arrives after the route; never judge a link before it.
    if (!this.projectRef()) return { kind: 'checking' };
    let link: EvidenceLink | undefined;
    try {
      link = parseEvidenceFragment(fragment, this.projectRef());
    } catch {
      return { kind: 'invalid' };
    }
    /* v8 ignore next -- a fragment with the prefix always parses to a link or throws */
    if (!link) return { kind: 'none' };
    const auth = this.authKind();
    if (auth === 'checking') return { kind: 'checking' };
    return auth === 'signed-in'
      ? { kind: 'open', link }
      : { kind: 'sign-in', fragment };
  });
  protected readonly openLink = computed(() => {
    const state = this.state();
    return state.kind === 'open' ? state.link : undefined;
  });
  private promptedFor = '';
  private reportedFor = '';

  constructor() {
    effect(() => {
      const state = this.state(),
        auth = this.authKind();
      untracked(() => {
        // Signing out forgets a link kept for this tab: clearPendingEvidenceLinkOnSignOut, on every page.
        const opened = this.openedFor(state);
        if (opened && opened.key !== this.reportedFor) {
          this.reportedFor = opened.key;
          this.usage.evidenceLinkOpened(opened.access, this.projectRef());
        }
        if (state.kind === 'sign-in' && state.fragment !== this.promptedFor) {
          this.promptedFor = state.fragment;
          this.usage.signInPrompted('evidence-link');
        }
        if (state.kind === 'none' && auth === 'signed-in' && this.projectRef())
          this.restorePending();
      });
    });
  }

  /** The link this state shows and what it led to, once per link; nothing while checking or without a link. */
  private openedFor(
    state: LinkState,
  ): { key: string; access: 'open' | 'sign-in' | 'invalid' } | undefined {
    const fragment = this.fragment() ?? '';
    if (state.kind === 'open')
      return { key: 'open:' + fragment, access: 'open' };
    if (state.kind === 'sign-in')
      return { key: 'sign-in:' + fragment, access: 'sign-in' };
    if (state.kind === 'invalid')
      return { key: 'invalid:' + fragment, access: 'invalid' };
    return undefined;
  }

  private currentPath(): string {
    return this.router.url.split(/[?#]/u)[0];
  }

  /** After sign-in returns here, put the kept link back into this address once. */
  private restorePending() {
    const store = tabStorage();
    let pending: PendingLink | undefined;
    try {
      pending = JSON.parse(store?.getItem(PENDING_EVIDENCE_LINK_KEY) || 'null');
    } catch {
      pending = undefined;
    }
    if (!pending) return;
    store?.removeItem(PENDING_EVIDENCE_LINK_KEY);
    if (
      typeof pending.fragment !== 'string' ||
      !pending.fragment.startsWith(EVIDENCE_LINK_PREFIX) ||
      pending.path !== this.currentPath() ||
      !(Date.now() - pending.createdAt < PENDING_MAX_AGE_MS)
    )
      return;
    void this.router.navigate([], {
      relativeTo: this.route,
      fragment: pending.fragment,
      queryParamsHandling: 'preserve',
      replaceUrl: true,
    });
  }

  protected signIn() {
    const state = this.state();
    if (state.kind !== 'sign-in') return;
    const path = this.currentPath();
    try {
      tabStorage()?.setItem(
        PENDING_EVIDENCE_LINK_KEY,
        JSON.stringify({
          path,
          fragment: state.fragment,
          createdAt: Date.now(),
        } satisfies PendingLink),
      );
    } catch {
      // Without tab storage the visitor opens the link again after signing in.
    }
    // Only the overview path goes to sign-in: never the fragment, never a query.
    void this.router.navigate(['/login'], { queryParams: { returnTo: path } });
  }

  protected close() {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParamsHandling: 'preserve',
      replaceUrl: true,
    });
  }
}
