import {
  NativeSourceInvalidationService,
  matchesNativeSourceInvalidation,
} from './native-source-invalidation';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { IonButton, IonSelect, IonSelectOption } from '@ionic/angular';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RetainedEvidenceApiService } from './retained-evidence-api.service';
import {
  sameContextScope,
  sameContextSubject,
} from '../session-context/session-context-contract';
import { IProjectRef } from '../core/project-context';
import { useDetectivePageContext } from '../detective/detective-page-context';
import { SessionContextApiService } from '../session-context/session-context-api.service';
import {
  ContextCapabilities,
  ContextSession,
} from '../session-context/session-context-contract';
import {
  AppliedEvidenceChoice,
  appliedEvidenceChoices,
} from './applied-evidence';

/** Explicit selection of current native records. Never creates or applies context. */
@Component({
  selector: 'sneat-datatug-applied-evidence-selector',
  imports: [IonButton, IonSelect, IonSelectOption],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section
    [attr.aria-label]="
      mode() === 'inspect'
        ? 'Choose inspection context'
        : 'Share retained evidence'
    "
  >
    @if (mode() === 'inspect') {
      <p>
        Choose an existing enabled applied Context Bag revision. Inspection does
        not Apply a draft or share a run.
      </p>
    } @else {
      <p>
        Sharing attaches the actual run to Incident {{ incidentRef() }}. Choose
        an existing enabled, applied Context Bag revision. This does not Apply a
        draft.
      </p>
    }
    <ion-button
      (click)="load()"
      [disabled]="disabled() || busy() || !incidentRef()"
      >Choose applied context</ion-button
    >
    <ion-select
      label="Native Session"
      aria-label="Existing native Session"
      [value]="sessionId()"
      (ionChange)="selectSession($event.detail.value)"
      [disabled]="disabled() || busy()"
    >
      <ion-select-option value="">Choose Session</ion-select-option>
      @for (session of sessions(); track session.id) {
        <ion-select-option [value]="session.id">{{
          session.title
        }}</ion-select-option>
      }
    </ion-select>
    @if (nextCursor()) {
      <ion-button
        fill="clear"
        (click)="loadMoreSessions()"
        [disabled]="disabled() || busy()"
        >Load more Sessions</ion-button
      >
    }
    <ion-select
      label="Applied scalar revision"
      aria-label="Applied scalar revision"
      [value]="choiceIndex()"
      (ionChange)="selectChoice($event.detail.value)"
      [disabled]="disabled() || busy()"
    >
      <ion-select-option value="">{{
        mode() === 'inspect' ? 'No revision selected' : 'Do not share this run'
      }}</ion-select-option>
      @for (choice of choices(); track $index) {
        <ion-select-option [value]="String($index)"
          >{{ choice.label }} ·
          {{ choice.evidence.context.scope.identityDomain }}</ion-select-option
        >
      }
    </ion-select>
    @if (error()) {
      <p role="alert">{{ error() }}</p>
    }
    @if (loaded() && !choices().length && sessionId()) {
      <p>
        No currently enabled applied scalar revision is available for this
        environment. Review and Apply in Sessions, then refresh this selection.
      </p>
    }
  </section>`,
})
export class AppliedEvidenceSelectorComponent {
  readonly mode = input<'share' | 'inspect'>('share');
  readonly projectRef = input<IProjectRef>();
  readonly actor = input('');
  readonly environment = input('');
  readonly incidentRef = input('');
  readonly caseId = input<string>();
  readonly disabled = input(false);
  readonly selected = output<AppliedEvidenceChoice | undefined>();
  protected readonly String = String;
  protected readonly nextCursor = signal<string | undefined>(undefined);
  protected readonly sessions = signal<readonly ContextSession[]>([]);
  protected readonly sessionId = signal('');
  protected readonly choices = signal<readonly AppliedEvidenceChoice[]>([]);
  protected readonly choiceIndex = signal('');
  protected readonly busy = signal(false);
  protected readonly loaded = signal(false);
  protected readonly error = signal('');
  private readonly api = inject(SessionContextApiService);
  private readonly evidenceApi = inject(RetainedEvidenceApiService);

  private readonly page = useDetectivePageContext();
  private readonly destroy = inject(DestroyRef);
  private lifetime = new AbortController();
  private capabilities?: ContextCapabilities;
  constructor() {
    inject(NativeSourceInvalidationService)
      .changes$.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (
          matchesNativeSourceInvalidation(
            event,
            this.projectRef(),
            this.actor(),
            {
              sourceId: 'shipping-working-copy',
              environment: this.environment(),
            },
          )
        )
          this.clear();
      });
    effect(() => {
      this.projectRef();
      this.actor();
      this.environment();
      this.incidentRef();
      this.caseId();
      this.clear();
    });
    this.page.scopeChanges$
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.clear());
    this.destroy.onDestroy(() => this.lifetime.abort());
  }
  private clear() {
    this.lifetime.abort();
    this.lifetime = new AbortController();
    this.capabilities = undefined;
    this.sessions.set([]);
    this.nextCursor.set(undefined);
    this.sessionId.set('');
    this.choices.set([]);
    this.choiceIndex.set('');
    this.busy.set(false);
    this.loaded.set(false);
    this.error.set('');
    this.selected.emit(undefined);
  }
  private live(signal: AbortSignal) {
    return !signal.aborted && !this.destroy.destroyed;
  }
  protected async load() {
    const ref = this.projectRef(),
      actor = this.actor();
    if (
      !ref ||
      !actor ||
      !this.environment() ||
      !this.incidentRef() ||
      this.disabled()
    )
      return;
    this.clear();
    const signal = this.lifetime.signal;
    this.busy.set(true);
    try {
      const mapping = await this.evidenceApi.contextScope(
        ref,
        this.environment(),
        signal,
      );
      if (!this.live(signal)) return;
      const capabilities = await this.api.capabilities(ref, signal);
      if (!this.live(signal)) return;
      if (
        capabilities.actorId !== actor ||
        !capabilities.environments.some(
          (scope) => scope.environmentId === this.environment(),
        )
      )
        throw new Error(
          'Current native context is not admitted for this actor and environment.',
        );
      const page = await this.api.list(ref, capabilities, undefined, signal);
      if (!this.live(signal)) return;
      this.capabilities = {
        ...capabilities,
        subjects: capabilities.subjects?.filter(
          (item) =>
            sameContextScope(item.scope, mapping.scope) &&
            sameContextSubject(item.subject, mapping.subject),
        ),
      };
      this.sessions.set(
        page.items.filter(
          (session) => session.owner === actor && session.state === 'active',
        ),
      );
      this.loaded.set(true);
      if (page.hasMore && !page.nextCursor)
        throw new Error('The server returned an invalid Session cursor.');
      this.nextCursor.set(page.hasMore ? page.nextCursor : undefined);
    } catch (error) {
      if (this.live(signal))
        this.error.set(
          error instanceof Error
            ? error.message
            : 'Current Sessions are unavailable.',
        );
    } finally {
      if (this.live(signal)) this.busy.set(false);
    }
  }
  protected async loadMoreSessions(): Promise<void> {
    const ref = this.projectRef(),
      caps = this.capabilities,
      cursor = this.nextCursor(),
      signal = this.lifetime.signal;
    if (!ref || !caps || !cursor || this.busy() || this.disabled()) return;
    this.busy.set(true);
    try {
      const page = await this.api.list(ref, caps, cursor, signal);
      if (!this.live(signal)) return;
      if (page.hasMore && (!page.nextCursor || page.nextCursor === cursor))
        throw new Error('The server did not advance the Session cursor.');
      const sessions = new Map(
        this.sessions().map((session) => [session.id, session]),
      );
      for (const session of page.items)
        if (session.owner === this.actor() && session.state === 'active')
          sessions.set(session.id, session);
      this.sessions.set([...sessions.values()]);
      this.nextCursor.set(page.hasMore ? page.nextCursor : undefined);
    } catch (error) {
      if (this.live(signal)) {
        this.clear();
        this.error.set(
          error instanceof Error
            ? error.message
            : 'Current Sessions are unavailable.',
        );
      }
    } finally {
      if (this.live(signal)) this.busy.set(false);
    }
  }
  protected async selectSession(id: string) {
    if (this.disabled() || this.busy()) return;
    this.choices.set([]);
    this.choiceIndex.set('');
    this.selected.emit(undefined);
    this.sessionId.set(id);
    const ref = this.projectRef(),
      caps = this.capabilities,
      signal = this.lifetime.signal;
    if (!ref || !caps || !this.sessions().some((session) => session.id === id))
      return;
    this.busy.set(true);
    this.error.set('');
    try {
      const snapshot = await this.api.read(ref, caps, id, signal);
      if (this.live(signal) && this.sessionId() === id)
        this.choices.set(
          appliedEvidenceChoices(
            caps,
            snapshot,
            this.environment(),
            this.incidentRef(),
            this.caseId(),
          ),
        );
    } catch (error) {
      if (this.live(signal))
        this.error.set(
          error instanceof Error
            ? error.message
            : 'Applied context is unavailable.',
        );
    } finally {
      if (this.live(signal)) this.busy.set(false);
    }
  }
  protected selectChoice(index: string) {
    if (this.disabled() || this.busy()) return;
    this.choiceIndex.set(index);
    this.selected.emit(
      /^\d+$/.test(index) ? this.choices()[Number(index)] : undefined,
    );
  }
}
