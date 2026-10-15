import { JsonPipe } from '@angular/common';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  IonBackButton,
  IonBadge,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonItem,
  IonItemGroup,
  IonLabel,
  IonList,
  IonMenuButton,
  IonSelect,
  IonSelectOption,
  IonToolbar,
} from '@ionic/angular';
import { DataGridComponent } from '@sneat/datagrid';
import { combineLatest, Subject, Subscription } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { IGridColumn } from '@sneat/grid';
import {
  routingParamEntityId,
  routingParamProjectId,
  routingParamStoreId,
} from '../../../core/datatug-routing-params';
import {
  EntityContentType,
  IEntity,
} from '../../../models/definition/metapedia/entity';
import { IProjEntity } from '../../../models/definition/project';
import { DatatugServicesStoreModule } from '../../../services/repo/datatug-services-store.module';
import { DatatugServicesUnsortedModule } from '../../../services/unsorted/datatug-services-unsorted.module';
import { EntityService } from '../../../services/unsorted/entity.service';
import { SneatDatatugPageTitleComponent } from '../../../components/page-title/sneat-datatug-page-title.component';

@Component({
  selector: 'sneat-datatug-entity',
  templateUrl: './entity-page.component.html',
  imports: [
    // `EntityService` (injected below) is a plain `@Injectable()`, provided
    // by `DatatugServicesUnsortedModule` rather than `providedIn: 'root'`,
    // and itself needs `StoreApiService` (`DatatugServicesStoreModule`).
    // `entity/:id` (this page's own bare route, `datatug-routing-proj.ts`)
    // had no ancestor route or module supplying either, so navigating here
    // (clicking an entity from the Entities list) threw `NG0201: No
    // provider found for \`EntityService\`` (confirmed live, S136) — same
    // fix, same cause, as `EntitiesPageComponent`'s own identical doc
    // comment.
    DatatugServicesStoreModule,
    DatatugServicesUnsortedModule,
    DataGridComponent,
    FormsModule,
    SneatDatatugPageTitleComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonContent,
    IonCard,
    IonItem,
    IonLabel,
    IonList,
    IonItemGroup,
    IonBadge,
    IonSelect,
    IonCardContent,
    IonSelectOption,
    JsonPipe,
    IonMenuButton,
    IonBackButton,
  ],
})
export class EntityPageComponent implements OnDestroy {
  readonly route = inject(ActivatedRoute);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  readonly entityService = inject(EntityService);
  readonly http = inject(HttpClient);

  // Signals, not plain fields: this app is zoneless
  // (provideZonelessChangeDetection(), main.ts) — every one of these is
  // written from inside `.subscribe()` callbacks below, which never
  // trigger change detection on their own for a plain field. See
  // AGENTS.md's "Change detection & state" section and
  // pages/signed-in/project/project-page.component.ts (PR #95) for the
  // established pattern.
  readonly storeId = signal<string | undefined>(undefined);
  readonly projectId = signal<string | undefined>(undefined);
  readonly entityId = signal<string | undefined>(undefined);
  readonly projEntity = signal<IProjEntity>(history.state.entity);
  readonly entity = signal<IEntity | undefined>(undefined);
  readonly entityLoadState = signal<
    'loading' | 'ready' | 'error' | 'unsupported'
  >('loading');
  public readonly sourceIndex = signal<number | undefined>(undefined);
  readonly sourceState = signal<
    'missing' | 'loading' | 'ready' | 'error' | 'unsupported'
  >('missing');
  readonly sourceData = signal<Record<string, unknown>[]>([]);
  readonly sourceCols = signal<IGridColumn[] | undefined>(undefined);
  private destroyed = new Subject<void>();
  private readonly entityRequest = signal<Subscription | undefined>(undefined);
  private readonly sourceRequest = signal<Subscription | undefined>(undefined);

  constructor() {
    const route = this.route;

    combineLatest([route.paramMap, route.queryParamMap])
      .pipe(takeUntil(this.destroyed))
      .subscribe(([params, queryParams]) => {
        const storeId = params.get(routingParamStoreId) || undefined;
        const projectId = params.get(routingParamProjectId) || undefined;
        const entityId = params.get(routingParamEntityId) || undefined;
        this.storeId.set(storeId);
        this.projectId.set(projectId);
        this.entityId.set(entityId);
        this.entityRequest()?.unsubscribe();
        this.sourceRequest()?.unsubscribe();
        this.entity.set(undefined);
        this.sourceIndex.set(undefined);
        this.sourceData.set([]);
        this.sourceCols.set(undefined);
        this.sourceState.set('missing');
        this.entityLoadState.set('loading');
        if (!storeId || !projectId || !entityId) {
          this.entityLoadState.set('error');
          return;
        }
        // The legacy EntityService only accepts store/project IDs. It cannot
        // identify a selected branch or common-API transport, so showing its
        // result in that context would misrepresent which entity was read.
        if (
          queryParams.get('projectApi') !== null ||
          queryParams.get('branch') !== null
        ) {
          this.entityLoadState.set('unsupported');
          return;
        }
        this.entityRequest.set(
          this.entityService.getEntity(storeId, projectId, entityId).subscribe({
            next: (entity) => {
              this.projEntity.set(entity);
              this.entity.set(entity.dbo); // TODO: workaround cast
              this.entityLoadState.set('ready');
              if (entity.dbo?.options?.sources?.length) {
                this.selectSource(0);
              }
            },
            error: (err) => {
              this.entityLoadState.set('error');
              this.errorLogger.logError(err, 'Failed to get entity by id');
            },
          }),
        );
      });
  }

  selectSource(index: number): void {
    this.sourceRequest()?.unsubscribe();
    this.sourceData.set([]);
    this.sourceCols.set(undefined);
    const source = this.entity()?.options?.sources?.[index];
    this.sourceIndex.set(source ? index : undefined);
    if (!source) {
      this.sourceState.set('missing');
      return;
    }
    if (source.contentType !== 'json') {
      this.sourceState.set('unsupported');
      return;
    }
    this.sourceState.set('loading');
    this.sourceRequest.set(
      this.http.get<unknown>(source.url).subscribe({
        next: (value) => {
          try {
            const { rows, columns } = this.parseSourcePreview(value);
            this.sourceData.set(rows);
            this.sourceCols.set(columns);
            this.sourceState.set('ready');
          } catch (error) {
            this.sourceState.set('error');
            this.errorLogger.logError(error, 'Invalid entity source preview');
          }
        },
        error: (error) => {
          this.sourceState.set('error');
          this.errorLogger.logError(error, 'Failed to get source data');
        },
      }),
    );
  }

  private parseSourcePreview(value: unknown): {
    rows: Record<string, unknown>[];
    columns: IGridColumn[];
  } {
    if (!Array.isArray(value)) {
      throw new Error('Source preview must be an array of rows');
    }
    if (!value.length) {
      return { rows: [], columns: [] };
    }
    const first: unknown = value[0];
    if (Array.isArray(first) && value.every(Array.isArray)) {
      const width = Math.max(...value.map((row: unknown[]) => row.length));
      const columns = Array.from(
        { length: width },
        (_, i): IGridColumn => ({
          field: `column_${i + 1}`,
          title: `Column ${i + 1}`,
          dbType: 'NVARCHAR',
        }),
      );
      return {
        rows: value.map((row: unknown[]) =>
          Object.fromEntries(row.map((cell, i) => [`column_${i + 1}`, cell])),
        ),
        columns,
      };
    }
    if (
      first &&
      typeof first === 'object' &&
      !Array.isArray(first) &&
      value.every(
        (row) => !!row && typeof row === 'object' && !Array.isArray(row),
      )
    ) {
      const keys = [
        ...new Set(
          value.flatMap((row: Record<string, unknown>) => Object.keys(row)),
        ),
      ];
      return {
        rows: value as Record<string, unknown>[],
        columns: keys.map(
          (key): IGridColumn => ({
            field: key,
            title: key,
            dbType: 'NVARCHAR',
          }),
        ),
      };
    }
    throw new Error('Source preview rows have an unsupported shape');
  }

  protected getEntityContentType(): EntityContentType | undefined {
    const sourceIndex = this.sourceIndex();
    const entity = this.entity();
    if (sourceIndex === undefined || !entity?.options?.sources) {
      return undefined;
    }
    return entity.options.sources[sourceIndex].contentType;
  }

  ngOnDestroy(): void {
    this.entityRequest()?.unsubscribe();
    this.sourceRequest()?.unsubscribe();
    this.destroyed.next();
    this.destroyed.complete();
  }
}
