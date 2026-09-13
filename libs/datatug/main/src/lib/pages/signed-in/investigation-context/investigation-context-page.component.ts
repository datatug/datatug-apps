import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonMenuButton,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
  IonToggle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline, linkOutline } from 'ionicons/icons';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import {
  AgentContextService,
  Candidate,
  ContextCondition,
  ContextItem,
  FactLayer,
  FactRole,
  contextItemToFact,
  InvestigationContextService,
  isFactSelectedForBinding,
  isOverlayFact,
  normalizedFactLayer,
  SemanticApiService,
  SemanticValue,
  tryDecodeErrorEnvelope,
} from '@sneat/datatug-semantic';
import { getStoreId, IProjectContext } from '../../../nav/nav-models';
import { DatatugCoreModule } from '../../../core/datatug-core.module';
import { IEntityFieldDef } from '../../../models/definition/metapedia/entity';
import { DataType } from '../../../models/definition/types';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugServicesNavModule } from '../../../services/nav/datatug-services-nav.module';
import { DatatugServicesProjectModule } from '../../../services/project/datatug-services-project.module';
import { DatatugServicesStoreModule } from '../../../services/repo/datatug-services-store.module';
import { DatatugServicesUnsortedModule } from '../../../services/unsorted/datatug-services-unsorted.module';
import { EntityService } from '../../../services/unsorted/entity.service';
import { SneatDatatugPageTitleComponent } from '../../../components/page-title/sneat-datatug-page-title.component';
import { incidentContextQueryParams } from '../../../incidents/incident-route-context';

addIcons({ closeOutline, linkOutline });

/** The condition dropdown's fixed option list — founder ruling 2026-09-10 (S156):
 * "conditions like ==, >, >=, etc."; the lead's own assumption note for the exact set
 * (api-contract.md/hub spec still only models `==`, recorded as a follow-up). */
const CONDITIONS: readonly ContextCondition[] = [
  '==',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
];
const FACT_ROLES: readonly FactRole[] = [
  'affected',
  'healthy_control',
  'suspected',
  'excluded',
  'recovered',
];
const LAYER_KINDS = [
  'canonical',
  'hypothesis',
  'participant',
  'question',
] as const;
type LayerKind = (typeof LAYER_KINDS)[number];

/** DataType kinds the "Value" field should render as `type="number"` — see
 * {@link inputTypeForDataType}. */
const NUMERIC_DATA_TYPES = new Set<DataType>([
  'integer',
  'decimal',
  'float',
  'money',
  'number',
]);

/** Picks the "Value" input's HTML `type` from the selected field's declared
 * {@link DataType}, when known — task S156 item 1 ("Value (input; type from the field
 * when known)"). Falls back to plain text for a field whose type has no closer native
 * input type (string/text/boolean/bit/GUID/UUID/binary), or before a field is chosen. */
function inputTypeForDataType(
  dataType: DataType | undefined,
): 'number' | 'date' | 'datetime-local' | 'text' {
  if (dataType && NUMERIC_DATA_TYPES.has(dataType)) {
    return 'number';
  }
  if (dataType === 'date') {
    return 'date';
  }
  if (dataType === 'datetime') {
    return 'datetime-local';
  }
  return 'text';
}

/** Coerces the "Value" input's raw text into the typed {@link SemanticValue}
 * `InvestigationContextService.addValue` expects, from the selected field's declared
 * {@link DataType} when known — mirrors `ContextPanelComponent`'s grid-cell values,
 * which already arrive as real numbers/booleans rather than display strings, so
 * `toTypedValue` (contract/adapt.ts) classifies them correctly (e.g. `integer`, not
 * `string`) instead of every manually-typed value becoming a string fact. */
function toSemanticValue(
  raw: string,
  dataType: DataType | undefined,
): SemanticValue {
  if (dataType && NUMERIC_DATA_TYPES.has(dataType)) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if (dataType === 'boolean' || dataType === 'bit') {
    if (raw === 'true') {
      return true;
    }
    if (raw === 'false') {
      return false;
    }
  }
  return raw;
}

/**
 * REQ:context-basket, REQ:applicable-queries (plan task 9) — the "Variables" route
 * (`datatug-routing-proj.ts`) becomes this screen (A3: the internal name stays
 * `basket`, the user-facing label is "Investigation Context"). It is the full-page
 * counterpart to `InvestigationContextBarComponent` (chips on every project screen,
 * `ProjectMenuTopComponent`): every collected value with its source, an enable/disable
 * toggle and a remove action, and the queries the *enabled* subset of the context makes
 * applicable — same server contract as `ContextPanelComponent`
 * (`POST /datatug/queries/applicable`, plan Task 12 cut-over), no new client-server
 * contract (INTEGRATION.md).
 *
 * `ContextItem` (investigation-context.service.ts) carries `source` (where the value
 * was added from, e.g. "grid", a related-lookup id) and `label` (the rendered
 * `entity.field = value`) — it does not carry the semantic `declared|inferred`
 * provenance from `GET /datatug/semantic/columns` (that lives on the grid-column
 * mapping, not on a context item once added). This screen shows what the model
 * actually carries: label, source and when it was added.
 */
@Component({
  selector: 'sneat-datatug-investigation-context',
  templateUrl: './investigation-context-page.component.html',
  styleUrl: './investigation-context-page.component.scss',
  imports: [
    // `DatatugNavContextService` (injected below) was a plain `@Injectable()`
    // provided by `DatatugServicesNavModule` (it and its whole dependency
    // chain are `providedIn: 'root'` since nav-context-root-singletons),
    // whose own constructor needed
    // `AppContextService` (`DatatugCoreModule`), `ProjectContextService`/
    // `ProjectService` (`DatatugServicesProjectModule`) and
    // `EnvironmentService` (`DatatugServicesUnsortedModule`, itself needing
    // `StoreApiService` from `DatatugServicesStoreModule`) — none of which
    // this page declared, so navigating here from the project side menu's
    // "Investigation Context" item threw `NG0201: No provider found for
    // DatatugNavContextService` (confirmed live, S135, 2026-09-10). Same
    // fix, same cause, as `EnvironmentsPageComponent`/`QueriesPageComponent`
    // (S120 PR #89, S121 Task 17 item B.1) — mirrors the exact module set
    // those pages already declare for the identical transitive chain.
    DatatugCoreModule,
    DatatugServicesNavModule,
    DatatugServicesProjectModule,
    DatatugServicesStoreModule,
    DatatugServicesUnsortedModule,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    SneatDatatugPageTitleComponent,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonToggle,
    IonButton,
    IonIcon,
    IonSpinner,
    IonText,
    IonSelect,
    IonSelectOption,
    IonInput,
  ],
})
export class InvestigationContextPageComponent implements OnDestroy {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly datatugNavContextService = inject(DatatugNavContextService);
  private readonly semanticApi = inject(SemanticApiService);
  private readonly agentContext = inject(AgentContextService);
  private readonly entityService = inject(EntityService);
  private readonly router = inject(Router);
  protected readonly context = inject(InvestigationContextService);

  protected readonly items = this.context.items;
  protected readonly enabledCount = this.context.enabledCount;

  protected readonly applicable = signal<readonly Candidate[]>([]);
  protected readonly notYet = signal<readonly Candidate[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly metadataError = signal<string | undefined>(undefined);

  private readonly project = signal<IProjectContext | undefined>(undefined);
  private readonly environment = signal<string | undefined>(undefined);
  private readonly destroyed = new Subject<void>();

  // --- "Add a context variable" form (S156, founder ruling 2026-09-10) ---

  /** The current project's entity ids, for the Entity select. */
  protected readonly entities = signal<readonly string[]>([]);
  /** The selected entity's declared fields, for the Field select — reloaded whenever
   * {@link selectedEntity} changes; empty before an entity is chosen. */
  protected readonly fields = signal<readonly IEntityFieldDef[]>([]);
  protected readonly selectedEntity = signal<string | undefined>(undefined);
  protected readonly selectedField = signal<string | undefined>(undefined);
  protected readonly selectedCondition = signal<ContextCondition | undefined>(
    undefined,
  );
  protected readonly selectedRole = signal<FactRole | undefined>(undefined);
  protected readonly selectedLayerKind = signal<LayerKind>('canonical');
  protected readonly selectedLayerId = signal('');
  protected readonly valueInput = signal('');
  protected readonly conditions = CONDITIONS;
  protected readonly factRoles = FACT_ROLES;
  protected readonly layerKinds = LAYER_KINDS;

  protected readonly selectedFieldType = computed<DataType | undefined>(
    () => this.fields().find((f) => f.id === this.selectedField())?.type,
  );
  protected readonly valueInputType = computed(() =>
    inputTypeForDataType(this.selectedFieldType()),
  );
  /** Add button stays disabled until Entity, Field, Condition and Value are all set —
   * task S156 item 1. */
  protected readonly canAdd = computed(
    () =>
      !!this.selectedEntity() &&
      !!this.selectedField() &&
      !!this.selectedCondition() &&
      (this.selectedLayerKind() === 'canonical' ||
        this.selectedLayerId().trim().length > 0) &&
      this.valueInput().trim().length > 0,
  );

  protected readonly makeIncidentQueryParams = computed(() => {
    const project = this.project();
    const environment = this.environment();
    const securityContextId = this.agentContext.securityContextId();
    if (!project || !environment || !securityContextId) {
      return undefined;
    }
    return incidentContextQueryParams({
      agentStoreId: project.ref.storeId,
      scope: {
        storeId: project.ref.projectId,
        project: project.ref.projectId,
        environment,
      },
    });
  });

  /** Guards the effect below against re-entering itself: `handleLoadError` clears the
   * Investigation Context on `STALE_CONTEXT`, and this effect also depends on
   * `context.items()` — see ContextPanelComponent's identical guard/comment for the
   * reproduced infinite-effect-recursion this prevents. */
  private suppressNextReload = false;

  constructor() {
    this.datatugNavContextService.currentProject
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (currentProject) => {
          this.project.set(currentProject);
          // A new project means the previous one's entity/field selection (if any) no
          // longer applies — reset the form before loading the new project's entities.
          this.selectedEntity.set(undefined);
          this.selectedField.set(undefined);
          this.fields.set([]);
          this.loadEntities(currentProject);
        },
        error: (err) =>
          this.errorLogger.logError(
            err,
            'Failed to get current project for the Investigation Context page',
          ),
      });
    this.datatugNavContextService.currentEnv
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (currentEnv) => this.environment.set(currentEnv?.id),
        error: (err) =>
          this.errorLogger.logError(
            err,
            'Failed to get current environment for the Investigation Context page',
          ),
      });

    // Re-resolve applicable queries whenever the project/environment or the enabled
    // context set changes (add/remove/enable/disable) — REQ:applicable-queries.
    effect(() => {
      const project = this.project();
      const environment = this.environment();
      const securityContextId = this.agentContext.securityContextId();
      const projectId = project?.ref.projectId;
      // Task 15 item 2/4 — switch (or open) this scope's own basket before reading
      // `context.items()` below, same ordering/reasoning as ContextPanelComponent's
      // identical effect.
      if (projectId && environment && securityContextId) {
        this.context.setScope({
          project: projectId,
          environment,
          securityContextId,
        });
      }
      const enabledItems = this.context
        .items()
        .filter((item) => item.enabled && isFactSelectedForBinding(item));
      if (this.suppressNextReload) {
        this.suppressNextReload = false;
        return;
      }
      this.loadApplicable(
        project,
        environment,
        securityContextId,
        enabledItems,
      );
    });
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }

  protected addedAtLabel(item: ContextItem): string {
    try {
      return new Date(item.addedAt).toLocaleString();
    } catch {
      return item.addedAt;
    }
  }

  protected toggle(item: ContextItem): void {
    this.context.setEnabled(
      item.id,
      !item.enabled,
      normalizedFactLayer(item.layer),
    );
  }

  protected makeIncident(): void {
    const queryParams = this.makeIncidentQueryParams();
    if (!queryParams) {
      return;
    }
    this.router
      .navigate(['/incidents/new'], { queryParams })
      .catch((err) =>
        this.errorLogger.logError(
          err,
          'Failed to open incident creation from Investigation Context',
        ),
      );
  }

  protected remove(item: ContextItem): void {
    this.context.removeValue(item.id, normalizedFactLayer(item.layer));
  }

  protected itemTrackKey(item: ContextItem): string {
    return `${item.id}\0${normalizedFactLayer(item.layer)}`;
  }

  protected itemLayer(item: ContextItem): FactLayer {
    return normalizedFactLayer(item.layer);
  }

  protected isOverlay(item: ContextItem): boolean {
    return isOverlayFact(item);
  }

  protected isSelectedForBinding(item: ContextItem): boolean {
    return isFactSelectedForBinding(item);
  }

  protected onItemRoleChange(
    item: ContextItem,
    role: FactRole | '' | undefined,
  ): void {
    const layer = normalizedFactLayer(item.layer);
    this.context.setMetadata(item.id, role || undefined, layer, layer);
  }

  protected onItemLayerChange(
    item: ContextItem,
    raw: string | null | undefined,
  ): void {
    const layer = raw || '';
    if (!isValidLayer(layer)) {
      this.metadataError.set(
        'Layer must be canonical or hypothesis:, participant:, or question: followed by an ID.',
      );
      return;
    }
    this.metadataError.set(undefined);
    this.context.setMetadata(
      item.id,
      item.role,
      layer as FactLayer,
      normalizedFactLayer(item.layer),
    );
  }

  protected toggleOverlayBinding(item: ContextItem): void {
    if (!item.layer) {
      return;
    }
    this.context.setOverlaySelectedForBinding(
      item.id,
      item.layer,
      !item.selectedForBinding,
    );
  }

  /** Entity select change — resets the (now stale) Field selection and loads the newly
   * chosen entity's fields (task S156 item 1: "Field options follow the Entity
   * choice"). */
  protected onEntityChange(entityId: string | null | undefined): void {
    const id = entityId || undefined;
    this.selectedEntity.set(id);
    this.selectedField.set(undefined);
    this.fields.set([]);
    if (id) {
      this.loadFields(id);
    }
  }

  protected onFieldChange(fieldId: string | null | undefined): void {
    this.selectedField.set(fieldId || undefined);
  }

  protected onConditionChange(
    condition: ContextCondition | null | undefined,
  ): void {
    this.selectedCondition.set(condition || undefined);
  }

  protected onRoleChange(role: FactRole | null | undefined): void {
    this.selectedRole.set(role || undefined);
  }

  protected onLayerKindChange(kind: LayerKind | null | undefined): void {
    this.selectedLayerKind.set(kind || 'canonical');
  }

  protected onLayerIdChange(value: string | null | undefined): void {
    this.selectedLayerId.set(value ?? '');
  }

  protected onValueChange(value: string | null | undefined): void {
    this.valueInput.set(value ?? '');
  }

  /** Adds the form's Entity.Field/condition/value as a new context variable to the
   * SAME basket the grid's "Add to context" action and `ContextPanelComponent` write to
   * (`InvestigationContextService.addValue`) — so both surfaces show one list. `source:
   * 'manual'` records where this item came from (`ContextItemInput.source`'s own doc
   * comment); `origin`/`enabled` are the service's own fixed `'context'`/`true` for
   * every basket entry, added value or not. */
  protected add(): void {
    const entity = this.selectedEntity();
    const field = this.selectedField();
    const condition = this.selectedCondition();
    const raw = this.valueInput().trim();
    if (!entity || !field || !condition || !raw) {
      return;
    }
    const value = toSemanticValue(raw, this.selectedFieldType());
    const layerKind = this.selectedLayerKind();
    const layer =
      layerKind === 'canonical'
        ? undefined
        : (`${layerKind}:${this.selectedLayerId().trim()}` as FactLayer);
    this.context.addValue({
      entityField: { entity, field },
      value,
      label: `${entity}.${field} ${condition} ${raw}`,
      source: 'manual',
      condition,
      ...(this.selectedRole() ? { role: this.selectedRole() } : {}),
      ...(layer ? { layer } : {}),
    });
    this.valueInput.set('');
  }

  private loadEntities(project: IProjectContext | undefined): void {
    if (!project) {
      this.entities.set([]);
      return;
    }
    this.entityService
      .getAllEntities(project.ref)
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (records) =>
          this.entities.set(records.map((record) => record.id).toSorted()),
        error: (err) =>
          this.errorLogger.logError(
            err,
            'Failed to load project entities for the Investigation Context form',
          ),
      });
  }

  private loadFields(entityId: string): void {
    const project = this.project();
    if (!project) {
      return;
    }
    this.entityService
      .getEntity(project.ref.storeId, project.ref.projectId, entityId)
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (record) => {
          // Discard a late response for an entity the user has since changed away from
          // (same "late response discarded" shape as this page's own scope guards).
          if (this.selectedEntity() !== entityId) {
            return;
          }
          this.fields.set(record.dbo?.fields ?? []);
        },
        error: (err) =>
          this.errorLogger.logError(
            err,
            `Failed to load fields for entity "${entityId}"`,
          ),
      });
  }

  protected chainText(chain: Candidate['chain']): string {
    return chain.map((step) => step.explanation).join(' → ');
  }

  protected missingText(missing: readonly string[]): string {
    return missing.join(', ');
  }

  protected isOpenable(candidate: Candidate): boolean {
    return candidate.state === 'needs-target';
  }

  /** Opens an applicable (or needs-target) query with its resolved wire bindings/targets
   * — same router-state contract as `EnvDbTablePageComponent.onOpenQuery`
   * (INTEGRATION.md §3): this shared library deliberately doesn't depend on
   * `@angular/router`, so navigating is a host-page job. */
  protected onOpenApplicable(candidate: Candidate): void {
    const project = this.project();
    if (!project) {
      return;
    }
    this.router
      .navigate(
        [
          '/store',
          getStoreId(project.ref.storeId),
          'project',
          project.ref.projectId,
          'query',
          // `encodeURIComponent` — `candidate.queryId` may be folder-qualified
          // (e.g. `customers/customer-invoices`, per `queries/applicable`'s
          // `Candidate.queryId` contract, datatug-cli#219). See
          // `EnvDbTablePageComponent.onOpenQuery`'s matching comment for why.
          encodeURIComponent(candidate.queryId),
        ],
        {
          // QueryPageComponent.trackQueryParams() resolves the query it opens from the
          // `id` query-string param, not the `:queryId` path segment — see
          // EnvDbTablePageComponent.onOpenQuery's own comment on this contract.
          // `id` is passed RAW (not encoded) — it's a query-string value, already
          // form-encoded on the way out.
          queryParams: { id: candidate.queryId },
          state: {
            bindings: candidate.bindings,
            targets: candidate.targets,
            selectedSource: candidate.selectedSource,
          },
        },
      )
      .catch((err) =>
        this.errorLogger.logError(err, 'Failed to open applicable query'),
      );
  }

  protected onOpenNotYet(candidate: Candidate): void {
    if (this.isOpenable(candidate)) {
      this.onOpenApplicable(candidate);
    }
  }

  private loadApplicable(
    project: IProjectContext | undefined,
    environment: string | undefined,
    securityContextId: string | undefined,
    enabledItems: readonly ContextItem[],
  ): void {
    const projectId = project?.ref.projectId;
    if (
      !projectId ||
      !environment ||
      !securityContextId ||
      !enabledItems.length
    ) {
      // Guarded (skip if already at the target value) — this runs inside an
      // `effect()`; see ContextPanelComponent's identical guard/comment for why an
      // unconditional `.set()` on every run risks a change-detection fixed point never
      // being reached (reproduced directly in QueryPageComponent's own effect).
      if (this.applicable().length) this.applicable.set([]);
      if (this.notYet().length) this.notYet.set([]);
      if (this.loading()) this.loading.set(false);
      if (this.error() !== undefined) this.error.set(undefined);
      return;
    }
    this.loading.set(true);
    this.error.set(undefined);
    // Task 15 item 2 — `enabledItems` are already wire-shaped Facts (`origin: 'context'`)
    // straight from InvestigationContextService; contextItemToFact() narrows off the
    // UI-local fields (label/source/addedAt) and carries `condition` through only when
    // it isn't the default `'=='` (S162 — api-contract.md's Fact.condition paragraph).
    const values = enabledItems.map(contextItemToFact);
    const requestScope = { project: projectId, environment, securityContextId };
    this.semanticApi
      .getApplicableQueries({ ...requestScope, values })
      .subscribe({
        next: (response) => {
          // Task 15 item 4 — discard a late response for a scope the user has since
          // left (project/environment/principal switch mid-flight).
          if (!this.context.isCurrentScope(requestScope)) {
            return;
          }
          this.applicable.set(response.applicable);
          this.notYet.set(response.notYet);
          this.loading.set(false);
        },
        error: (err: unknown) => this.handleLoadError(err, requestScope),
      });
  }

  private handleLoadError(
    err: unknown,
    requestScope: {
      project: string;
      environment: string;
      securityContextId: string;
    },
  ): void {
    if (!this.context.isCurrentScope(requestScope)) {
      // Late error response for a scope we've already left — same discard rule as a
      // late success response.
      return;
    }
    this.loading.set(false);
    const envelope =
      err instanceof HttpErrorResponse
        ? tryDecodeErrorEnvelope(err.error)
        : undefined;
    if (envelope?.error.code === 'STALE_CONTEXT') {
      this.suppressNextReload = true;
      this.context.clear();
      this.agentContext.refresh().subscribe({ error: () => undefined });
      this.error.set(
        'Your session changed — context was cleared, please retry.',
      );
      return;
    }
    this.error.set('Failed to load applicable queries');
    this.errorLogger.logError(err, 'Failed to load applicable queries');
  }
}

function isValidLayer(layer: string): boolean {
  if (layer === 'canonical') {
    return true;
  }
  const match = /^(hypothesis|participant|question):(.*)$/u.exec(layer);
  const ownerId = match?.[2];
  return !!ownerId && ownerId.trim() === ownerId && !/\p{Cc}/u.test(ownerId);
}
