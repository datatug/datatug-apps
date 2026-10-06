import { SourceRightsNoticeComponent } from '@sneat/datatug-semantic';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonMenuButton,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { firstValueFrom, Subscription } from 'rxjs';
import { DatatugNavContextService } from '../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import { projectPageHref } from '../../nav/project-page-href';
import type { IProjectContext } from '../../nav/nav-models';
import { QueriesService } from '../queries.service';
import {
  FederatedQueryService,
  type FederatedQueryResult,
  type LocalResultDescriptor,
} from '../federated-query.service';
import {
  PublicDataService,
  type PublicDataDiscovery,
} from './public-data.service';
import { immutableUrl, object, strictJson } from './canonical-metadata';
import type {
  PublicDataSuggestion,
  SourceField,
} from './representation-discovery';
import {
  sameSource,
  REPRESENTATION_PUBLICATION_BLOCKER,
} from './representation-discovery';
import { ConfiguredPublicDataSourcesService } from './configured-public-data-sources.service';
import type {
  ConfiguredPublicSource,
  ConfiguredFieldChoice,
} from './configured-source';
import type { IQueryDef } from '../../models/definition/query-def';
import { saveRuntimePins, runtimePlanIdentity } from './saved-runtime-pins';

@Component({
  selector: 'sneat-datatug-public-data-page',
  templateUrl: './public-data-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .result-scroll { max-width: 100%; overflow: auto; }
    .result-scroll table { border-collapse: collapse; width: max-content; min-width: 100%; }
    .result-scroll th, .result-scroll td { padding: .5rem; text-align: start; vertical-align: top; border-bottom: 1px solid var(--ion-border-color, #ddd); min-width: 6rem; max-width: 24rem; overflow-wrap: anywhere; }
    .result-scroll caption { text-align: start; padding: .5rem; }
    .result-scroll:focus-visible { outline: 2px solid var(--ion-color-primary); }
  `],
  imports: [
    SourceRightsNoticeComponent,
    FormsModule,
    RouterLink,
    IonBackButton,
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonContent,
    IonHeader,
    IonInput,
    IonItem,
    IonMenuButton,
    IonSpinner,
    IonTextarea,
    IonTitle,
    IonToolbar,
  ],
})
export class PublicDataPageComponent implements OnDestroy {
  private readonly metadata = inject(PublicDataService);
  private readonly configured = inject(ConfiguredPublicDataSourcesService);
  private readonly queries = inject(QueriesService);
  private readonly federation = inject(FederatedQueryService);
  private readonly navigation = inject(DatatugNavService);
  private readonly navContext = inject(DatatugNavContextService);
  readonly project = signal<IProjectContext | undefined>(undefined);
  readonly sourceText = signal('');
  readonly connections = signal<readonly ConfiguredPublicSource[]>([]);
  readonly connection = signal<ConfiguredPublicSource | undefined>(undefined);
  readonly fields = signal<readonly ConfiguredFieldChoice[]>([]);
  readonly field = signal<ConfiguredFieldChoice | undefined>(undefined);
  readonly connectionLoading = signal(false);
  readonly connectionsLoaded = signal(false);
  readonly source = signal<SourceField | undefined>(undefined);
  readonly discovery = signal<PublicDataDiscovery | undefined>(undefined);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly running = signal(false);
  readonly result = signal<FederatedQueryResult | undefined>(undefined);
  private readonly executedPlan = signal<IQueryDef | undefined>(undefined);
  readonly selected = signal<PublicDataSuggestion | undefined>(undefined);
  readonly history = signal<readonly LocalResultDescriptor[]>([]);
  readonly historyLoading = signal(false);
  readonly historical = signal(false);
  readonly stoppedAttempt = signal('');
  readonly historyError = signal('');
  private readonly localIds = new Set<string>();
  private viewGeneration = 0;
  readonly page = signal(0);
  readonly resultSet = signal<'affiliations' | 'locations' | 'aliases'>(
    'affiliations',
  );
  readonly aliasesRequested = signal(false);
  readonly activeRecordset = computed(() =>
    this.resultSet() === 'affiliations'
      ? this.result()?.recordset
      : this.result()?.relatedRecordsets?.find(
          (set) => set.id === this.resultSet(),
        )?.recordset,
  );
  readonly activeRowCount = computed(() =>
    this.resultSet() === 'affiliations'
      ? (this.result()?.totalRows ?? this.result()?.recordset.rows.length ?? 0)
      : (this.result()?.relatedRecordsets?.find(
          (set) => set.id === this.resultSet(),
        )?.totalRows ?? 0),
  );
  readonly resultRows = signal<FederatedQueryResult['recordset']['rows']>([]);
  readonly graphStageActions = computed(
    () =>
      this.historical() || this.stoppedAttempt() ? [] : this.result()?.nativeGraph?.stageActions.filter(
        (stage) => stage.state === 'available',
      ) ?? [],
  );
  readonly sourcePages = computed(() => {
    if (this.historical() || this.stoppedAttempt()) return [];
    const driver = this.executedPlan()?.federation?.bounds?.sources[0];
    const driverId = driver ? `${driver.database}.${driver.name}` : undefined;
    return Object.entries(this.result()?.runtimeRead?.pages ?? {}).filter(
      ([id, page]) => id !== driverId && page.possiblyMore,
    );
  });
  readonly hasRorStatuses = computed(
    () =>
      this.result()?.publicDataExceptions?.details.some(
        (row) => !!row.targetStatus,
      ) ?? false,
  );
  readonly error = signal('');
  readonly userRows = signal(100);
  readonly userOffset = signal(0);
  readonly backHref = computed(() => projectPageHref(this.project()?.ref));
  readonly queriesHref = computed(() =>
    projectPageHref(this.project()?.ref, 'queries'),
  );
  readonly compatible = computed(
    () =>
      this.discovery()?.suggestions.filter((value) => value.matchesSource) ??
      [],
  );
  private controller?: AbortController;
  private generation = 0;
  private readonly subscription: Subscription =
    this.navContext.currentProject.subscribe((value) => {
      this.controller?.abort();
      void this.federation.dispose().catch(() => undefined);
      this.generation++;
      this.loading.set(false);
      this.connectionLoading.set(false);
      this.connectionsLoaded.set(false);
      this.project.set(value);
      this.viewGeneration++;
      this.localIds.clear(); this.history.set([]); this.historical.set(false);
      this.stoppedAttempt.set(''); this.historyError.set('');
      this.executedPlan.set(undefined); this.running.set(false); this.saving.set(false); this.historyLoading.set(false);
      this.connections.set([]);
      this.connection.set(undefined);
      this.fields.set([]);
      this.field.set(undefined);
      this.source.set(undefined);
      this.discovery.set(undefined);
      this.result.set(undefined);
      this.selected.set(undefined);
    });

  private invalidateDraft(): void {
    this.generation++; this.viewGeneration++;
    if (this.result()) this.historical.set(true);
    this.running.set(false); this.saving.set(false); this.historyLoading.set(false);
    const generation = this.generation;
    void this.federation.dispose().catch((error: unknown) => { if (generation === this.generation) this.historyError.set(error instanceof Error ? error.message : 'Cannot stop the prior lookup.'); });
  }
  setRows(value: number): void { if (value !== this.userRows()) { this.invalidateDraft(); this.userRows.set(value); } }
  setOffset(value: number): void { if (value !== this.userOffset()) { this.invalidateDraft(); this.userOffset.set(value); } }
  setAliases(value: boolean): void { if (value !== this.aliasesRequested()) { this.invalidateDraft(); this.aliasesRequested.set(value); } }
  selectSuggestion(value: PublicDataSuggestion): void { this.invalidateDraft(); this.selected.set(value); }
  async refreshHistory(): Promise<void> {
    const generation = this.generation, view = this.viewGeneration;
    this.historyLoading.set(true);
    try {
      const entries = await this.federation.listLocalResults(undefined, (message) => { if (generation === this.generation) this.historyError.set(message); });
      if (generation === this.generation && view === this.viewGeneration) this.history.set(entries.filter((entry) => this.localIds.has(entry.id)));
    } catch (error) { if (generation === this.generation) this.historyError.set(error instanceof Error ? error.message : 'Cannot read local results.'); }
    finally { if (generation === this.generation) this.historyLoading.set(false); }
  }
  async openHistory(id: string): Promise<void> {
    if (!this.localIds.has(id)) return;
    this.invalidateDraft();
    const generation = this.generation, view = ++this.viewGeneration;
    this.historyLoading.set(true); this.historyError.set('');
    try {
      const opened = await this.federation.openLocalResult(id);
      if (generation !== this.generation || view !== this.viewGeneration) return;
      this.result.set(opened.result); this.executedPlan.set(opened.executedDefinition);
      this.historical.set(true); this.resultSet.set('affiliations');
      this.page.set(0); this.resultRows.set(opened.result.recordset.rows);
    } catch (error) { if (generation === this.generation && view === this.viewGeneration) this.historyError.set(error instanceof Error ? error.message : 'No local result available.'); }
    finally { if (generation === this.generation && view === this.viewGeneration) this.historyLoading.set(false); }
  }
  async deleteHistory(id: string): Promise<void> {
    if (!this.localIds.has(id)) return;
    const generation = this.generation;
    if (this.result()?.localResult?.id === id) { this.invalidateDraft(); this.result.set(undefined); this.resultRows.set([]); this.executedPlan.set(undefined); }
    const current = this.generation;
    try { await this.federation.deleteLocalResult(id); if (current !== this.generation) return; this.localIds.delete(id); await this.refreshHistory(); }
    catch (error) { if (generation === this.generation || current === this.generation) this.historyError.set(error instanceof Error ? error.message : 'Cannot delete local result.'); }
  }
  async loadConnections(): Promise<void> {
    const project = this.project();
    if (!project || this.connectionLoading()) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller?.abort();
    this.controller = controller;
    const deadline = setTimeout(
      () =>
        controller.abort(new Error('Configured source discovery timed out.')),
      10000,
    );
    this.connectionLoading.set(true);
    this.error.set('');
    try {
      const connections = await this.configured.list(
        project,
        controller.signal,
      );
      if (generation === this.generation) {
        this.connections.set(connections);
        this.connectionsLoaded.set(true);
      }
    } catch (error) {
      if (generation === this.generation)
        this.error.set(
          error instanceof Error
            ? error.message
            : 'Configured source metadata is unavailable.',
        );
    } finally {
      clearTimeout(deadline);
      if (generation === this.generation) this.connectionLoading.set(false);
    }
  }
  async selectConnection(id: string): Promise<void> {
    this.invalidateDraft();
    const connection = this.connections().find((value) => value.id === id);
    const project = this.project();
    if (!connection || !project) return;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const generation = ++this.generation;
    this.connection.set(connection);
    this.fields.set([]);
    this.field.set(undefined);
    this.source.set(undefined);
    this.selected.set(undefined);
    this.discovery.set(undefined);
    this.error.set('');
    this.loading.set(true);
    const deadline = setTimeout(
      () =>
        controller.abort(
          new Error('Configured source metadata inspection timed out.'),
        ),
      10000,
    );
    try {
      const inspected = await this.configured.inspect(
        project,
        connection,
        controller.signal,
      );
      if (generation === this.generation) {
        this.fields.set(inspected.fields);
        this.discovery.set(inspected.discovery);
      }
    } catch (error) {
      if (generation === this.generation)
        this.error.set(
          error instanceof Error
            ? error.message
            : 'Configured source inspection failed.',
        );
    } finally {
      clearTimeout(deadline);
      if (generation === this.generation) this.loading.set(false);
    }
  }
  selectField(id: string): void {
    this.invalidateDraft();
    const field = this.fields().find((value) => value.id === id);
    this.field.set(field);
    this.source.set(field?.source);
    this.selected.set(undefined);
    const discovery = this.discovery();
    if (discovery)
      this.discovery.set({
        ...discovery,
        suggestions: discovery.suggestions.map((value) => {
          const matchesSource =
            !!field?.source &&
            !!value.contract &&
            sameSource(field.source, value.contract.source);
          return {
            ...value,
            matchesSource,
            reason:
              matchesSource && !value.eligible
                ? REPRESENTATION_PUBLICATION_BLOCKER
                : value.reason,
          };
        }),
      });
  }
  previewTable(): void {
    const project = this.project();
    const connection = this.connection();
    const field = this.field();
    if (project && connection && field)
      this.navigation.goTable({
        project,
        env: connection.environment,
        db: connection.catalog,
        schema: field.table.schema,
        name: field.table.name,
      });
  }

  async connect(): Promise<void> {
    if (this.loading()) return;
    this.invalidateDraft();
    const generation = ++this.generation;
    this.error.set('');
    this.discovery.set(undefined);
    this.source.set(undefined);
    this.selected.set(undefined);
    try {
      const record = object(
        strictJson(this.sourceText()),
        'declared source field',
      );
      if (
        Object.keys(record).sort().join(',') !==
          'datatype,entity,module,namespace,property,schema' ||
        record['datatype'] !== 'string' ||
        !['entity', 'module', 'property', 'namespace'].every(
          (key) => typeof record[key] === 'string' && !!record[key],
        )
      )
        throw new Error(
          'Declare the exact schema, module, entity, property, string datatype and raw namespace.',
        );
      const source = record as unknown as SourceField;
      immutableUrl(source.schema);
      this.source.set(source);
      const controller = new AbortController();
      this.controller = controller;
      const deadline = setTimeout(
        () => controller.abort(new Error('Canonical metadata read timed out.')),
        10000,
      );
      this.loading.set(true);
      try {
        const discovery = await this.metadata.discover(
          source,
          controller.signal,
        );
        if (generation === this.generation) this.discovery.set(discovery);
      } finally {
        clearTimeout(deadline);
      }
    } catch (error) {
      if (generation === this.generation)
        this.error.set(
          error instanceof Error
            ? error.message
            : 'Canonical discovery failed.',
        );
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }
  cancel(): void {
    this.controller?.abort(new Error('Discovery cancelled.'));
    if (this.running())
      void this.federation
        .dispose()
        .catch((error: unknown) =>
          this.error.set(
            error instanceof Error
              ? error.message
              : 'Cannot cancel the lookup.',
          ),
        );
  }
  async run(): Promise<void> {
    const source = this.source();
    const discovery = this.discovery();
    const selected = this.selected();
    if (!source || !discovery || !selected || this.running()) return;
    if (!selected.eligible) {
      this.error.set(selected.reason);
      return;
    }
    const generation = ++this.generation;
    this.viewGeneration++; this.historical.set(false); this.stoppedAttempt.set('');
    this.error.set('');
    this.running.set(true);
    this.result.set(undefined);
    this.page.set(0);
    this.resultRows.set([]);
    try {
      const query = this.metadata.scenario(
        source,
        discovery,
        selected,
        {
          userRows: this.userRows(),
          userOffset: this.userOffset(),
          aliases: this.aliasesRequested(),
        },
        this.field()?.context,
      );
      const result = await this.federation.run(query, undefined, '', 'full', undefined, { onHistoryError: (message) => { if (generation === this.generation) this.historyError.set(message); } });
      if (generation !== this.generation) return;
      this.result.set(result);
      this.executedPlan.set(query);
      this.resultSet.set('affiliations');
      this.resultRows.set(result.recordset.rows);
      if (result.localResult) { this.localIds.add(result.localResult.id); await this.refreshHistory(); }
    } catch (error) {
      if (generation !== this.generation) return;
      this.error.set(
        error instanceof Error ? error.message : 'The bounded lookup failed.',
      );
    } finally {
      if (generation === this.generation) this.running.set(false);
    }
  }
  async changePage(delta: number): Promise<void> {
    const next = this.page() + delta;
    if (next < 0 || next * 100 >= this.activeRowCount()) return;
    const view = this.viewGeneration, set = this.resultSet(), ref = this.result()?.localResult;
    try {
      const rows = await this.federation.getPage(next, set, ref);
      if (view !== this.viewGeneration || set !== this.resultSet() || ref?.generation !== this.result()?.localResult?.generation || ref?.id !== this.result()?.localResult?.id) return;
      this.resultRows.set(rows);
      this.page.set(next);
    } catch (error) {
      if (view !== this.viewGeneration) return;
      this.error.set(
        error instanceof Error ? error.message : 'Cannot read result page.',
      );
    }
  }
  selectResultSet(id: 'affiliations' | 'locations' | 'aliases'): void {
    const output = this.result();
    if (!output) return;
    const set =
      id === 'affiliations'
        ? output.recordset
        : output.relatedRecordsets?.find((set) => set.id === id)?.recordset;
    if (!set) return;
    this.viewGeneration++;
    this.resultSet.set(id);
    this.page.set(0);
    this.resultRows.set(set.rows);
  }

  stageLabel(id: string): string {
    return (
      (
        {
          organizations: 'Organizations',
          locations: 'Organization locations',
          places: 'Places',
          countries: 'Countries',
          admin1: 'Region (GeoNames admin1)',
          aliases: 'Alternate names',
        } as Record<string, string>
      )[id] ?? id
    );
  }
  async continueGraphSource(id: string, offset: number): Promise<void> {
    if (this.running() || this.historical() || this.stoppedAttempt()) return;
    const executed = this.executedPlan(),
      plan = executed?.federation?.nativeGraph;
    if (
      !plan ||
      plan.aliases !== this.aliasesRequested() ||
      plan.selection.rows !== this.userRows() ||
      plan.selection.offset !== this.userOffset()
    ) {
      this.error.set(
        'The graph selection changed. Start a fresh explicit run.',
      );
      return;
    }
    const generation = this.generation;
    this.running.set(true);
    this.error.set('');
    try {
      const result = await this.federation.continueSource(id, 1000, offset);
      if (generation !== this.generation) return;
      this.result.set(result);
      this.resultSet.set('affiliations');
      this.page.set(0);
      this.resultRows.set(result.recordset.rows);
    } catch (error) {
      if (generation === this.generation) {
        this.stoppedAttempt.set(error instanceof Error ? error.message : 'The graph source continuation failed.');
        this.error.set(this.stoppedAttempt());
      }
    } finally {
      if (generation === this.generation) this.running.set(false);
    }
  }

  async continueSource(sourceId: string): Promise<void> {
    const page = this.result()?.runtimeRead?.pages[sourceId];
    if (!page?.possiblyMore || this.running() || this.historical() || this.stoppedAttempt()) return;
    const generation = this.generation;
    this.running.set(true);
    this.error.set('');
    try {
      const source = this.source(),
        discovery = this.discovery(),
        selected = this.selected(),
        executed = this.executedPlan();
      if (
        !source ||
        !discovery ||
        !selected ||
        !executed ||
        runtimePlanIdentity(
          this.metadata.scenario(
            source,
            discovery,
            selected,
            { userRows: this.userRows(), userOffset: this.userOffset() },
            this.field()?.context,
          ),
        ) !== runtimePlanIdentity(executed)
      )
        throw new Error(
          'The selected plan changed. Inspect its pins and run explicitly again before reading more sources.',
        );
      const result = await this.federation.continueSource(
        sourceId,
        page.limit,
        page.offset + page.rows,
      );
      if (generation !== this.generation) return;
      this.result.set(result);
      this.resultSet.set('affiliations');
      this.resultRows.set(result.recordset.rows);
      this.page.set(0);
    } catch (error) {
      if (generation === this.generation) {
        this.stoppedAttempt.set(error instanceof Error ? error.message : 'The bounded source continuation failed.');
        this.error.set(this.stoppedAttempt());
      }
    } finally {
      if (generation === this.generation) this.running.set(false);
    }
  }
  async save(suggestion: PublicDataSuggestion): Promise<void> {
    const generation = this.generation;
    const source = this.source();
    const discovery = this.discovery();
    const project = this.project();
    if (!source || !discovery || !project || this.saving()) return;
    this.error.set('');
    this.saving.set(true);
    try {
      let query = this.metadata.scenario(
        source,
        discovery,
        suggestion,
        {
          userRows: this.userRows(),
          userOffset: this.userOffset(),
          aliases: this.aliasesRequested(),
        },
        this.field()?.context,
      );
      const result = this.result(),
        executed = this.executedPlan();
      if (result?.runtimeRead) {
        if (!executed)
          throw new Error(
            'This runtime receipt has no executed plan. Run explicitly again.',
          );
        if (query.federation?.nativeGraph)
          await this.metadata.verifyGraphForSave(query.federation.nativeGraph);
        if (generation !== this.generation) return;
        query = saveRuntimePins(query, executed, result);
      }
      const saved = await firstValueFrom(
        this.queries.createQuery(project.ref, query),
      );
      if (generation !== this.generation) return;
      if (
        !saved.publicData ||
        saved.publicData.attachment.sha256 !==
          query.publicData?.attachment.sha256 ||
        JSON.stringify(saved.federation) !== JSON.stringify(query.federation)
      )
        throw new Error(
          'The query store did not preserve the exact scenario pins. This store cannot save the scenario safely yet.',
        );
      if (result?.localResult) {
        await this.federation.associateLocalResult(project.ref, saved.id, result.localResult);
        if (generation !== this.generation) return;
      }
      this.navigation.goQuery(project, saved);
    } catch (error) {
      if (generation === this.generation) this.error.set(error instanceof Error ? error.message : 'Scenario save failed.');
    } finally {
      if (generation === this.generation) this.saving.set(false);
    }
  }
  ngOnDestroy(): void {
    this.generation++;
    this.controller?.abort();
    this.subscription.unsubscribe();
    void this.federation.dispose().catch(() => undefined);
  }
}
