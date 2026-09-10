import { JsonPipe } from '@angular/common';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonItemGroup,
  IonLabel,
  IonList,
  IonMenuButton,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { DataGridComponent } from '@sneat/datagrid';
import { Subject } from 'rxjs';
import { takeUntil, takeWhile } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { IGridColumn } from '@sneat/grid';
import {
  routingParamEntityId,
  routingParamProjectId,
  routingParamStoreId,
} from '../../../core/datatug-routing-params';
import { RecordsetValue } from '../../../dto/execute';
import {
  EntityContentType,
  IEntity,
} from '../../../models/definition/metapedia/entity';
import { IProjEntity } from '../../../models/definition/project';
import { EntityService } from '../../../services/unsorted/entity.service';

@Component({
  selector: 'sneat-datatug-entity',
  templateUrl: './entity-page.component.html',
  imports: [
    FormsModule,
    DataGridComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonTitle,
    IonContent,
    IonCard,
    IonItem,
    IonLabel,
    IonInput,
    IonButton,
    IonIcon,
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
  public readonly sourceIndex = signal<number | undefined>(undefined);
  readonly sourceData = signal<RecordsetValue[][] | undefined>(undefined);
  readonly sourceCols = signal<IGridColumn[] | undefined>(undefined);
  private destroyed = new Subject<void>();

  constructor() {
    const route = this.route;

    route.paramMap.pipe(takeUntil(this.destroyed)).subscribe((params) => {
      const storeId = params.get(routingParamStoreId) || undefined;
      const projectId = params.get(routingParamProjectId) || undefined;
      const entityId = params.get(routingParamEntityId) || undefined;
      this.storeId.set(storeId);
      this.projectId.set(projectId);
      this.entityId.set(entityId);
      if (!storeId || !projectId || !entityId) {
        return;
      }
      this.entityService
        .getEntity(storeId, projectId, entityId)
        .pipe(
          takeUntil(this.destroyed),
          takeWhile(() => this.entityId() === entityId),
        )
        .subscribe({
          next: (entity) => {
            this.projEntity.set(entity);
            this.entity.set(entity.dbo); // TODO: workaround cast
            const sourcesLen = entity.dbo?.options?.sources?.length;
            const sourceIndex = this.sourceIndex();
            if (!sourcesLen) {
              this.sourceIndex.set(undefined);
            } else if (
              (sourcesLen && sourceIndex === undefined) ||
              (sourceIndex !== undefined && sourceIndex + 1 > sourcesLen)
            ) {
              const newSourceIndex = 0;
              this.sourceIndex.set(newSourceIndex);
              const source =
                entity.dbo.options?.sources &&
                entity.dbo.options?.sources[newSourceIndex];
              if (!source) {
                return;
              }
              this.http
                .get<RecordsetValue[][]>(source.url)
                .pipe(takeUntil(this.destroyed))
                .subscribe({
                  next: (rows) => {
                    this.sourceData.set(rows);
                    this.sourceCols.set([
                      { field: 'region', dbType: 'NVARCHAR', title: 'region' },
                      {
                        field: 'alpha-2',
                        dbType: 'NVARCHAR',
                        title: 'alpha-2',
                      },
                      {
                        field: 'alpha-3',
                        dbType: 'NVARCHAR',
                        title: 'alpha-3',
                      },
                      { field: 'name', dbType: 'NVARCHAR', title: 'name' },
                    ]);
                  },
                  error: this.errorLogger.logErrorHandler(
                    'Failed to get source data',
                  ),
                });
            }
          },
          error: (err) =>
            this.errorLogger.logError(err, 'Failed to get entity by id'),
        });
    });
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
    this.destroyed.next();
    this.destroyed.complete();
  }
}
