import {ChangeDetectionStrategy, Component, DestroyRef, inject} from '@angular/core';
import {KeyValuePipe} from '@angular/common';
import {takeUntilDestroyed, toSignal} from '@angular/core/rxjs-interop';
import {ActivatedRoute, Router, RouterLink, UrlTree} from '@angular/router';
import {IonBackButton, IonButtons, IonContent, IonHeader, IonMenuButton, IonTitle, IonToolbar} from '@ionic/angular';
import {defer, of} from 'rxjs';
import {catchError, distinctUntilChanged, map, startWith, switchMap} from 'rxjs/operators';
import {NativeDataModelsService, type DataModelDetail, type DataModelSummary} from '../../../logical-models/native-data-models.service';

type PageState =
  | {kind: 'loading'}
  | {kind: 'not-configured'}
  | {kind: 'list-loading'}
  | {kind: 'list'; models: readonly DataModelSummary[]}
  | {kind: 'detail-loading'; modelId: string; commit: string}
  | {kind: 'detail'; model: DataModelDetail}
  | {kind: 'error'; message: string};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

@Component({
  selector: 'sneat-datatug-data-models-page',
  standalone: true,
  templateUrl: './data-models-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    KeyValuePipe,
    RouterLink,
    IonBackButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonMenuButton,
    IonTitle,
    IonToolbar,
  ],
})
export class DataModelsPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dataModels = inject(NativeDataModelsService);
  private readonly projectRoute = this.route.parent ?? this.route;

  readonly configured = this.dataModels.configured;
  readonly listUrl: UrlTree = this.router.createUrlTree(['data-models'], {
    relativeTo: this.projectRoute,
  });

  readonly state = toSignal<PageState, PageState>(
    this.route.paramMap.pipe(
      map((params) => ({
        modelId: params.get('modelId') ?? undefined,
        commit: params.get('commit') ?? undefined,
      })),
      distinctUntilChanged(
        (left, right) =>
          left.modelId === right.modelId && left.commit === right.commit,
      ),
      switchMap(({modelId, commit}) => {
        if (!this.dataModels.configured) return of<PageState>({kind: 'not-configured'});
        if (modelId && commit) {
          return defer(() => this.dataModels.detail(modelId, commit)).pipe(
            map((model): PageState => ({kind: 'detail', model})),
            startWith<PageState>({kind: 'detail-loading', modelId, commit}),
            catchError((error: unknown) => of<PageState>({kind: 'error', message: errorMessage(error)})),
          );
        }
        return defer(() => this.dataModels.list()).pipe(
          map((models): PageState => ({kind: 'list', models})),
          startWith<PageState>({kind: 'list-loading'}),
          catchError((error: unknown) => of<PageState>({kind: 'error', message: errorMessage(error)})),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ),
    {initialValue: {kind: 'loading'}},
  );

  modelUrl(model: DataModelSummary): UrlTree {
    return this.router.createUrlTree(
      ['data-models', model.id, 'versions', model.commit],
      {relativeTo: this.projectRoute},
    );
  }
}
