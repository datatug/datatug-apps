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
  imports: [
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
  readonly page = signal(0);
  readonly resultRows = signal<FederatedQueryResult['recordset']['rows']>([]);
  readonly sourcePages = computed(() => {
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
      if (this.running()) void this.federation.dispose().catch(() => undefined);
      this.generation++;
      this.loading.set(false);
      this.connectionLoading.set(false);
      this.connectionsLoaded.set(false);
      this.project.set(value);
      this.connections.set([]);
      this.connection.set(undefined);
      this.fields.set([]);
      this.field.set(undefined);
      this.source.set(undefined);
      this.discovery.set(undefined);
      this.result.set(undefined);
      this.selected.set(undefined);
    });

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
    const generation = ++this.generation;
    this.error.set('');
    this.discovery.set(undefined);
    this.source.set(undefined);
    this.result.set(undefined);
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
    const generation = this.generation;
    const source = this.source();
    const discovery = this.discovery();
    const selected = this.selected();
    if (!source || !discovery || !selected || this.running()) return;
    if (!selected.eligible) {
      this.error.set(selected.reason);
      return;
    }
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
        },
        this.field()?.context,
      );
      const result = await this.federation.run(query, undefined, '', 'full');
      if (generation !== this.generation) return;
      this.result.set(result);
      this.executedPlan.set(query);
      this.resultRows.set(result.recordset.rows);
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'The bounded lookup failed.',
      );
    } finally {
      this.running.set(false);
    }
  }
  async changePage(delta: number): Promise<void> {
    const next = this.page() + delta;
    if (
      next < 0 ||
      next * 100 >=
        (this.result()?.totalRows ?? this.result()?.recordset.rows.length ?? 0)
    )
      return;
    try {
      const rows = await this.federation.getPage(next);
      this.resultRows.set(rows);
      this.page.set(next);
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'Cannot read result page.',
      );
    }
  }
  async continueSource(sourceId: string): Promise<void> {
    const page = this.result()?.runtimeRead?.pages[sourceId];
    if (!page?.possiblyMore || this.running()) return;
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
      this.resultRows.set(result.recordset.rows);
      this.page.set(0);
    } catch (error) {
      this.error.set(
        error instanceof Error
          ? error.message
          : 'The bounded source continuation failed.',
      );
    } finally {
      this.running.set(false);
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
      this.navigation.goQuery(project, saved);
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'Scenario save failed.',
      );
    } finally {
      this.saving.set(false);
    }
  }
  ngOnDestroy(): void {
    this.generation++;
    this.controller?.abort();
    this.subscription.unsubscribe();
    void this.federation.dispose().catch(() => undefined);
  }
}
