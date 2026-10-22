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
import { refreshOutline, searchOutline } from 'ionicons/icons';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  IonButton,
  IonButtons,
  IonSelect,
  IonSelectOption,
  IonToolbar,
  IonIcon,
} from '@ionic/angular';
import { firstValueFrom, fromEvent, takeUntil } from 'rxjs';
import { useDetectivePageContext } from '../detective/detective-page-context';
import { DetectiveClientService } from '../detective/detective-client.service';
import {
  EvidenceSharePanelComponent,
  EvidenceShareSelection,
} from '../evidence/evidence-share-panel.component';
import {
  NativeSourceInvalidationService,
  matchesNativeSourceInvalidation,
} from '../evidence/native-source-invalidation';
import { ProjectAssetsApiService } from '../services/project/project-assets-api.service';
import { projectPageHref } from '../nav/project-page-href';
import {
  NativeApplicable,
  nativePreflightLabels,
} from './native-check-preflight-contract';
import { NativeSemanticApiService } from './native-semantic-api.service';
import {
  NativeSchema,
  NativeRows,
  NativeSelection,
  NativeRequest,
  NativeMapping,
  NativeResolution,
  NativeRelated,
  NativeLookup,
  EntitySnapshot,
  NativeScope,
  nativeID,
  validateScope,
  validateMapping,
  mappingJournalKey,
  encodeMappingJournal,
  decodeMappingJournal,
} from './native-semantic-contract';

@Component({
  selector: 'sneat-native-semantic-browser',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonButton,
    IonButtons,
    IonSelect,
    IonSelectOption,
    IonToolbar,
    IonIcon,
    EvidenceSharePanelComponent,
  ],
  templateUrl: './native-semantic-browser.component.html',
  styles: [
    `
      :host {
        display: block;
        margin-block: 1.5rem;
      }
      .tables-toolbar {
        --background: var(--ion-color-light);
      }
      .content {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(16rem, 1fr);
        gap: 1rem;
      }
      .scroll {
        overflow-x: auto;
        max-width: 100%;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      th,
      td {
        padding: 0.4rem;
        text-align: start;
        border-bottom: 1px solid var(--ion-color-light-shade);
      }
      td button {
        background: transparent;
        color: inherit;
        padding: 0.35rem;
        white-space: nowrap;
        cursor: pointer;
        border: 2px solid transparent;
      }
      td button[aria-pressed='true'] {
        border-color: var(--ion-color-primary);
      }
      td button:focus-visible {
        outline: 2px solid var(--ion-color-primary);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
      }
      .checks-toolbar {
        --min-height: 2.5rem;
      }
      .checks-toolbar h4 {
        margin: 0;
        font-size: 0.95rem;
        font-weight: 600;
      }
      .checks-intro {
        margin: 0.35rem 0 0.5rem;
        font-size: 0.85rem;
        line-height: 1.45;
      }
      .check-list {
        container-type: inline-size;
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .check-list li {
        padding-block: 0.5rem;
        border-bottom: 1px solid var(--ion-color-light-shade);
        overflow-wrap: anywhere;
      }
      .check-heading {
        display: grid;
        grid-template-columns: minmax(0, 1fr) max-content max-content;
        align-items: center;
        gap: 0.25rem 0.5rem;
      }
      .check-title {
        min-width: 0;
        font-size: 0.9rem;
        line-height: 1.4;
        font-weight: 600;
      }
      .check-state {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        color: var(--ion-text-color);
        font-size: 0.85rem;
        font-weight: 500;
        line-height: 1.4;
      }
      .check-state::before {
        content: '';
        width: 0.4rem;
        height: 0.4rem;
        border: 1px solid currentColor;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .check-heading ion-buttons {
        margin: 0;
        justify-self: end;
      }
      .check-heading ion-button {
        --color: var(--ion-text-color);
        --padding-start: 0.35rem;
        --padding-end: 0.35rem;
        margin: 0;
        min-height: 1.75rem;
        font-size: 0.85rem;
      }
      .check-heading ion-button::part(native) {
        text-decoration: underline;
        text-underline-offset: 0.18em;
      }
      .check-meta {
        margin: 0.1rem 0 0.2rem;
        color: var(--ion-text-color-step-350, var(--ion-text-color));
        font-size: 0.78rem;
        line-height: 1.4;
      }
      .check-details {
        font-size: 0.78rem;
        line-height: 1.4;
      }
      .check-details summary {
        cursor: pointer;
      }
      .check-details p {
        margin: 0.25rem 0;
      }
      @container (max-width: 24rem) {
        .check-heading {
          grid-template-columns: minmax(0, 1fr) max-content;
        }
        .check-title {
          grid-column: 1 / -1;
        }
      }
      details {
        overflow-wrap: anywhere;
      }
      @media (max-width: 400px) {
        .refresh-label {
          display: none;
        }
      }
      @media (max-width: 700px) {
        .content {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    `,
  ],
})
export class NativeSemanticBrowserComponent {
  readonly refreshIcon = refreshOutline;
  readonly findChecksIcon = searchOutline;
  readonly checkLabels = nativePreflightLabels;
  readonly applicable = signal<NativeApplicable | undefined>(undefined);
  readonly checksPending = signal(false);
  readonly checksError = signal('');
  private checksController?: AbortController;
  private checksFence?: string;
  readonly environments = input<readonly string[]>([]);
  readonly canWrite = input(false);
  readonly page = useDetectivePageContext();
  private readonly api = inject(NativeSemanticApiService);
  private readonly assets = inject(ProjectAssetsApiService);
  private readonly detective = inject(DetectiveClientService);
  private readonly destroy = inject(DestroyRef);
  private readonly route = toSignal(inject(ActivatedRoute).queryParamMap);
  readonly environment = signal('');
  readonly selection = signal<EvidenceShareSelection | undefined>(undefined);
  readonly schema = signal<NativeSchema | undefined>(undefined);
  readonly collection = signal('');
  readonly rows = signal<NativeRows | undefined>(undefined);
  readonly selected = signal<NativeSelection | undefined>(undefined);
  readonly resolution = signal<NativeResolution | undefined>(undefined);
  readonly related = signal<NativeRelated | undefined>(undefined);
  readonly relatedRows = signal<NativeRows | undefined>(undefined);
  readonly entity = signal<EntitySnapshot | undefined>(undefined);
  readonly entities = signal<readonly { id: string; title?: string }[]>([]);
  readonly fieldId = signal('');
  readonly picker = signal(false);
  readonly busy = signal(false);
  readonly workStatus = signal('Loading current data…');
  readonly selectedValue = computed(() => {
    const selected = this.selected(),
      rows = this.rows();
    if (!selected || rows?.collection !== selected.collection) return undefined;
    const column = rows.columns.findIndex(
      (item) => item.name === selected.column,
    );
    return column < 0
      ? undefined
      : rows.rows.find((item) => item.rowToken === selected.rowToken)?.cells[
          column
        ];
  });
  readonly error = signal('');
  readonly notice = signal('');
  readonly pending = signal<NativeMapping | undefined>(undefined);
  readonly blocked = signal(false);
  readonly restoring = signal(false);
  readonly reviewed = signal(false);
  readonly conflict = signal(false);
  readonly caseId = computed(() => this.route()?.get('caseId') || undefined);
  readonly journalScope = computed(() => {
    const ref = this.page.ref(),
      actor = this.page.context()?.principal,
      env = this.environment();
    return ref && actor && env
      ? JSON.stringify([
          actor,
          ref.storeId,
          ref.spaceID,
          ref.projectId,
          env,
          'shipping-working-copy',
        ])
      : undefined;
  });
  readonly mappingChoiceAvailable = computed(
    () =>
      this.resolution()?.provenance !== 'declared' ||
      !!this.pending() ||
      this.blocked(),
  );
  readonly saveAllowed = computed(() => {
    const selected = this.selected(),
      resolved = this.resolution(),
      e = this.entity(),
      f = e?.entity.fields.find((f) => f.id === this.fieldId());
    return (
      this.canWrite() &&
      !this.pending() &&
      !this.blocked() &&
      !this.restoring() &&
      !this.busy() &&
      !!selected &&
      !!resolved &&
      resolved.value.type !== 'null' &&
      resolved.provenance !== 'declared' &&
      !!e?.revision &&
      !!f &&
      f.type === resolved.value.type
    );
  });
  private lifetime = new AbortController();
  private focusTarget?: HTMLButtonElement;
  constructor() {
    this.page.scopeChanges$
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.reset());
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
          this.reset();
          const scope = this.journalScope();
          if (scope) {
            this.restoring.set(true);
            void this.restore(scope);
          }
        }
      });
    effect(() => {
      const scope = this.journalScope();
      this.caseId();
      untracked(() => {
        this.reset();
        this.pending.set(undefined);
        this.blocked.set(false);
        this.conflict.set(false);
        this.restoring.set(!!scope);
        if (scope) void this.restore(scope);
      });
    });
    effect(() => {
      const envs = this.environments(),
        current = this.environment();
      if (current && !envs.includes(current)) this.environment.set('');
    });
    effect(() => {
      const current = this.checkFence();
      untracked(() => {
        if (this.checksFence !== undefined && current !== this.checksFence)
          this.clearChecks();
      });
    });
    this.destroy.onDestroy(() => {
      this.clearChecks();
      this.lifetime.abort();
    });
  }
  private reset() {
    this.lifetime.abort();
    this.lifetime = new AbortController();
    this.selection.set(undefined);
    this.schema.set(undefined);
    this.rows.set(undefined);
    this.collection.set('');
    this.clearCell();
    this.busy.set(false);
    this.error.set('');
    this.notice.set('');
    this.reviewed.set(false);
  }
  private clearChecks() {
    this.checksController?.abort();
    this.checksController = undefined;
    this.checksFence = undefined;
    this.applicable.set(undefined);
    this.checksPending.set(false);
    this.checksError.set('');
  }
  private clearCell() {
    this.clearChecks();
    this.selected.set(undefined);
    this.resolution.set(undefined);
    this.related.set(undefined);
    this.relatedRows.set(undefined);
    this.entity.set(undefined);
    this.entities.set([]);
    this.fieldId.set('');
    this.picker.set(false);
    this.reviewed.set(false);
  }
  changeEnvironment(value: string) {
    if (!this.environments().includes(value)) return;
    if (value !== this.environment()) this.reset();
    this.environment.set(value);
  }
  private live(signal: AbortSignal) {
    return !signal.aborted && !this.destroy.destroyed;
  }
  private scoped(): NativeScope {
    const ref = this.page.ref(),
      choice = this.selection();
    if (
      !ref?.spaceID ||
      !choice ||
      choice.identity !== this.page.identity() ||
      choice.environment !== this.environment()
    )
      throw new Error('Choose current Incident and applied context.');
    const scope: NativeScope = {
      spaceID: ref.spaceID,
      projectId: ref.projectId,
      environment: this.environment(),
      sourceId: 'shipping-working-copy',
      evidence: choice.choice.evidence,
    };
    return validateScope(scope);
  }
  private request(): NativeRequest {
    const selection = this.selected();
    if (!selection) throw new Error('Select an actual cell.');
    return { ...this.scoped(), selection };
  }
  private async attempt(
    work: (signal: AbortSignal) => Promise<void>,
    message = 'Loading current data…',
  ) {
    if (this.busy()) return;
    const signal = this.lifetime.signal;
    this.workStatus.set(message);
    this.notice.set('');
    this.busy.set(true);
    this.error.set('');
    try {
      await work(signal);
    } catch {
      if (this.live(signal))
        this.error.set(
          'Unavailable. Current rights, source or selection could not be confirmed. Retry after reviewing the context.',
        );
    } finally {
      if (this.live(signal)) this.busy.set(false);
    }
  }
  async chooseContext(value: EvidenceShareSelection | undefined) {
    if (this.restoring()) return;
    this.lifetime.abort();
    this.lifetime = new AbortController();
    this.busy.set(false);
    this.selection.set(undefined);
    this.schema.set(undefined);
    this.rows.set(undefined);
    this.clearCell();
    this.error.set('');
    if (!value) return;
    await this.attempt(async (signal) => {
      const caseId = this.caseId();
      if (caseId) {
        const context = this.page.context();
        if (!context || !nativeID(caseId))
          throw new Error('Case identity is unavailable.');
        const links = await firstValueFrom(
          this.detective
            .linkedIncidents(context, caseId)
            .pipe(takeUntil(fromEvent(signal, 'abort'))),
        );
        if (!this.live(signal)) return;
        if (
          links.caseId !== caseId ||
          !links.incidents.some(
            (i) =>
              `${i.ref.storeId}/${i.ref.incidentId}` ===
              value.choice.evidence.incidentRef,
          )
        )
          throw new Error('Case does not link this Incident.');
      }
      if (
        !this.live(signal) ||
        value.identity !== this.page.identity() ||
        value.environment !== this.environment()
      )
        return;
      this.selection.set(structuredClone(value));
      this.scoped();
      const ref = this.page.ref();
      if (!ref) return;
      const schema = await this.api.schema(ref, this.environment(), signal);
      if (this.live(signal)) this.schema.set(schema);
    });
  }
  async inspect(name: string) {
    this.rows.set(undefined);
    this.clearCell();
    this.collection.set(name);
    await this.attempt(async (signal) => {
      const schema = this.schema();
      if (!schema || !schema.collections.some((c) => c.name === name))
        throw new Error('Choose an inspected table.');
      const rows = await this.api.browse(
        { ...this.scoped(), schemaToken: schema.schemaToken, collection: name },
        signal,
      );
      if (this.live(signal)) this.rows.set(rows);
    });
  }
  async refresh() {
    const choice = this.selection();
    if (choice) await this.chooseContext(choice);
  }
  async selectCell(row: number, column: number, event?: Event) {
    const rows = this.rows();
    if (!rows?.rows[row] || !rows.columns[column] || this.busy()) return;
    this.clearCell();
    this.focusTarget = event?.currentTarget as HTMLButtonElement | undefined;
    this.selected.set({
      schemaToken: rows.schemaToken,
      collection: rows.collection,
      rowToken: rows.rows[row].rowToken,
      column: rows.columns[column].name,
    });
    if (rows.rows[row].cells[column].type === 'null') {
      this.notice.set('NULL has no nonnull mapping or Related lookup.');
      return;
    }
    this.notice.set('');
    await this.readCell();
  }
  async retryResolution() {
    if (this.selectedValue()?.type !== 'null' && this.selected())
      await this.readCell();
  }
  private async readCell() {
    await this.attempt(async (signal) => {
      const request = this.request(),
        resolution = await this.api.resolve(request, signal);
      if (!this.live(signal)) return;
      const rows = this.rows(),
        matches = rows?.rows.filter(
          (row) => row.rowToken === request.selection.rowToken,
        ),
        index =
          rows?.columns.findIndex(
            (column) => column.name === request.selection.column,
          ) ?? -1;
      if (
        matches?.length !== 1 ||
        index < 0 ||
        JSON.stringify(matches[0].cells[index]) !==
          JSON.stringify(resolution.value)
      )
        throw new Error(
          'Resolved value differs from the selected physical cell.',
        );
      this.resolution.set(resolution);
      if (resolution.entity) {
        const ref = this.page.ref();
        if (!ref) return;
        const entity = await firstValueFrom(
          this.assets
            .entity(ref, this.environment(), resolution.entity)
            .pipe(takeUntil(fromEvent(signal, 'abort'))),
        );
        if (!this.live(signal)) return;
        this.entity.set(entity);
      }
      const related = await this.api.related(request, signal);
      if (this.live(signal)) this.related.set(related);
    });
  }
  private checkFence(): string {
    return JSON.stringify([
      this.page.identity(),
      this.page.ref(),
      this.selection(),
      this.environment(),
      this.selected(),
      this.schema()?.schemaToken,
      this.schema()?.source,
      this.resolution(),
      this.entity()?.revision,
    ]);
  }
  checkHref(id: string): string {
    return projectPageHref(this.page.ref(), ['checks', id]);
  }
  async findChecks() {
    if (this.busy() || !this.selected() || this.restoring()) return;
    this.clearChecks();
    const controller = new AbortController();
    this.checksController = controller;
    this.checksPending.set(true);
    await this.attempt(async (lifetime) => {
      const abort = () => controller.abort();
      lifetime.addEventListener('abort', abort, { once: true });
      try {
        if (lifetime.aborted) controller.abort();
        const request = structuredClone(this.request()),
          fence = this.checkFence();
        this.checksFence = fence;
        const result = await this.api.applicable(request, controller.signal);
        if (
          controller.signal.aborted ||
          !this.live(lifetime) ||
          this.checksController !== controller ||
          fence !== this.checkFence()
        )
          return;
        this.applicable.set(result);
      } catch {
        if (
          !controller.signal.aborted &&
          this.live(lifetime) &&
          this.checksController === controller
        )
          this.checksError.set(
            'Check suggestions are unavailable. Review the current context and try again.',
          );
      } finally {
        lifetime.removeEventListener('abort', abort);
        if (this.checksController === controller) {
          this.checksPending.set(false);
          this.checksController = undefined;
        }
      }
    }, 'Finding checks…');
  }
  async openRelated(lookup: NativeLookup) {
    await this.attempt(async (signal) => {
      if (
        !this.related()?.lookups.some(
          (l) => JSON.stringify(l) === JSON.stringify(lookup),
        )
      )
        throw new Error('Choose a current Related offer.');
      const rows = await this.api.relatedRows(
        { ...this.request(), lookup },
        signal,
      );
      if (this.live(signal)) this.relatedRows.set(rows);
    });
  }
  async openPicker() {
    if (
      this.busy() ||
      !this.resolution() ||
      !this.mappingChoiceAvailable() ||
      this.resolution()?.value.type === 'null'
    )
      return;
    this.picker.set(true);
    this.entity.set(undefined);
    this.fieldId.set('');
    await this.attempt(async (signal) => {
      const ref = this.page.ref();
      if (!ref) return;
      const entities = await firstValueFrom(
        this.assets
          .entities(ref, this.environment())
          .pipe(takeUntil(fromEvent(signal, 'abort'))),
      );
      if (this.live(signal)) this.entities.set(entities);
    });
  }
  async chooseEntity(id: string) {
    this.entity.set(undefined);
    this.fieldId.set('');
    await this.attempt(async (signal) => {
      if (!this.entities().some((e) => e.id === id))
        throw new Error('Choose an existing entity.');
      const ref = this.page.ref();
      if (!ref) return;
      const entity = await firstValueFrom(
        this.assets
          .entity(ref, this.environment(), id)
          .pipe(takeUntil(fromEvent(signal, 'abort'))),
      );
      if (this.live(signal)) this.entity.set(entity);
    });
  }
  cancel() {
    this.picker.set(false);
    this.fieldId.set('');
    this.focusTarget?.focus();
  }
  async save() {
    if (!this.saveAllowed()) return;
    this.clearChecks();
    const scope = this.journalScope(),
      entity = this.entity();
    if (!scope || !entity?.revision) return;
    const request = structuredClone(
      validateMapping({
        ...this.request(),
        operationId: crypto.randomUUID(),
        entityId: entity.entity.id,
        fieldId: this.fieldId(),
        ifMatch: entity.revision,
      }),
    );
    this.workStatus.set('Saving mapping…');
    this.notice.set('');
    this.error.set('');
    this.busy.set(true);
    const signal = this.lifetime.signal;
    try {
      const raw = await encodeMappingJournal(scope, request);
      if (!this.live(signal)) return;
      sessionStorage.setItem(mappingJournalKey(scope), raw);
      if (sessionStorage.getItem(mappingJournalKey(scope)) !== raw)
        throw new Error('Storage did not preserve the operation.');
      this.pending.set(request);
      this.picker.set(false);
    } catch {
      if (this.live(signal)) {
        this.blocked.set(true);
        this.error.set(
          'The mapping intent could not be durably preserved. Nothing was dispatched. Review stored recovery before another write.',
        );
      }
      return;
    } finally {
      if (this.live(signal)) this.busy.set(false);
    }
    await this.retry();
  }
  async retry() {
    const request = this.pending(),
      scope = this.journalScope();
    if (
      !request ||
      !scope ||
      !this.canWrite() ||
      this.busy() ||
      this.conflict() ||
      this.blocked() ||
      this.restoring()
    )
      return;
    if (
      request.spaceID !== this.page.ref()?.spaceID ||
      request.projectId !== this.page.ref()?.projectId ||
      request.environment !== this.environment()
    )
      return;
    await this.attempt(async (signal) => {
      try {
        const stored = sessionStorage.getItem(mappingJournalKey(scope));
        if (
          !stored ||
          JSON.stringify(await decodeMappingJournal(stored, scope)) !==
            JSON.stringify(request)
        )
          throw new Error('Stored operation differs.');
        if (!this.live(signal) || scope !== this.journalScope()) return;
        const ack = await this.api.addMapping(request, signal);
        if (!this.live(signal) || scope !== this.journalScope()) return;
        const ref = this.page.ref();
        if (!ref) return;
        const entity = await firstValueFrom(
          this.assets
            .entity(ref, this.environment(), request.entityId)
            .pipe(takeUntil(fromEvent(signal, 'abort'))),
        );
        if (!this.live(signal)) return;
        this.entity.set(entity);
        // Retire only after verified acknowledgement and successful current read.
        if (ack.receipt !== request.operationId)
          throw new Error('Receipt differs.');
        sessionStorage.removeItem(mappingJournalKey(scope));
        this.pending.set(undefined);
        this.conflict.set(false);
        this.notice.set(
          'Mapping accepted. Refresh and select the actual cell to verify its current declared meaning and Related records.',
        );
        this.schema.set(undefined);
        this.rows.set(undefined);
        this.clearCell();
      } catch (error) {
        if (this.live(signal)) {
          if (
            typeof error === 'object' &&
            error !== null &&
            'status' in error &&
            error.status === 409
          )
            this.conflict.set(true);
          this.notice.set(
            'Delivery may already have committed. The original operation is retained; no new operation was prepared.',
          );
        }
        throw error;
      }
    }, 'Saving mapping…');
    if (
      !this.pending() &&
      !this.blocked() &&
      scope === this.journalScope() &&
      this.selection()
    ) {
      await this.refresh();
      if (scope !== this.journalScope() || !this.schema()) return;
      await this.inspect(request.selection.collection);
      const rows = this.rows(),
        row =
          rows?.rows.findIndex(
            (r) => r.rowToken === request.selection.rowToken,
          ) ?? -1,
        col =
          rows?.columns.findIndex((c) => c.name === request.selection.column) ??
          -1;
      if (row >= 0 && col >= 0) await this.selectCell(row, col);
    }
  }
  private async restore(scope: string) {
    const signal = this.lifetime.signal;
    try {
      const raw = sessionStorage.getItem(mappingJournalKey(scope));
      if (raw) {
        const request = await decodeMappingJournal(raw, scope);
        if (this.live(signal) && scope === this.journalScope())
          this.pending.set(request);
      }
    } catch {
      if (this.live(signal)) {
        this.blocked.set(true);
        this.error.set(
          'The stored mapping cannot be decoded. It is retained and blocks new mapping writes. Inspect current context and review before abandonment.',
        );
      }
    } finally {
      if (this.live(signal)) this.restoring.set(false);
    }
  }
  async reviewPending() {
    if (!this.pending() && !this.blocked()) return;
    this.reviewed.set(false);
    await this.attempt(async (signal) => {
      // Fresh inspect scope/cell is required even for an old/corrupt journal.
      const request = this.request();
      await this.api.resolve(request, signal);
      const ref = this.page.ref(),
        id = this.pending()?.entityId || this.entity()?.entity.id;
      if (!ref || !id)
        throw new Error('Select the current canonical entity for review.');
      const entity = await firstValueFrom(
        this.assets
          .entity(ref, this.environment(), id)
          .pipe(takeUntil(fromEvent(signal, 'abort'))),
      );
      if (this.live(signal)) {
        this.entity.set(entity);
        this.reviewed.set(true);
      }
    }, 'Reviewing mapping recovery…');
  }
  abandon() {
    const scope = this.journalScope();
    if (!scope || !this.reviewed() || this.busy()) return;
    try {
      sessionStorage.removeItem(mappingJournalKey(scope));
      if (sessionStorage.getItem(mappingJournalKey(scope)) !== null)
        throw new Error('Storage retained operation.');
      this.pending.set(undefined);
      this.blocked.set(false);
      this.conflict.set(false);
      this.reviewed.set(false);
      this.notice.set(
        'Only the local retry was retired. The original mapping may already be saved. Review a new intent separately.',
      );
    } catch {
      this.error.set(
        'Stored retry could not be retired. New writes remain blocked.',
      );
    }
  }
  cellText(row: number, col: number) {
    const value = this.rows()?.rows[row]?.cells[col];
    return value?.type === 'null' ? 'NULL' : String(value?.value ?? '');
  }
}
