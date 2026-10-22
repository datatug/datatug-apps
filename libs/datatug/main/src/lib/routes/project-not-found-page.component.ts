import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonMenuButton,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { ErrorStateComponent } from '../components/error-state/error-state.component';
import {
  routingParamProjectId,
  routingParamStoreId,
} from '../core/datatug-routing-params';
import { projectPageHref } from '../nav/project-page-href';

/**
 * What a project address that no page answers shows: a 404 inside the project, with a way back to its Boards and
 * Queries. A router miss must never reach Sentry's crash dialog (`NG04002`), and a mistyped address is not a crash.
 * `data.what` ('page' | 'query') names the missing thing.
 */
@Component({
  selector: 'sneat-datatug-project-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ErrorStateComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonMenuButton,
    IonTitle,
    IonContent,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-menu-button />
          <ion-back-button [defaultHref]="ref() ? boardsHref() : '/'" />
        </ion-buttons>
        <ion-title>{{
          isQuery ? 'Query not found' : 'Page not found'
        }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <sneat-datatug-error-state
        [title]="
          isQuery ? 'This query does not exist' : 'This page does not exist'
        "
        [hint]="
          isQuery
            ? 'The link may be mistyped, or the query was renamed or deleted. Open it from the list of queries.'
            : ref()
              ? 'The link may be mistyped or out of date. Continue from the boards of this project.'
              : 'The link may be mistyped or out of date. Start again from the home page.'
        "
        kindHint="not-found"
        [retryable]="false"
        [links]="links()"
      />
    </ion-content>
  `,
})
export class ProjectNotFoundPageComponent {
  private readonly route = inject(ActivatedRoute);
  protected readonly isQuery = this.route.snapshot.data['what'] === 'query';
  protected readonly ref = computed(() => {
    const params: Record<string, string> = {};
    for (const snapshot of this.route.snapshot.pathFromRoot)
      Object.assign(params, snapshot.params);
    const storeId = params[routingParamStoreId];
    const projectId = params[routingParamProjectId];
    return storeId && projectId ? { storeId, projectId } : undefined;
  });
  protected readonly links = computed(() =>
    this.ref()
      ? [
          this.isQuery
            ? { label: 'Go to Queries', href: this.queriesHref() }
            : { label: 'Go to Boards', href: this.boardsHref() },
        ]
      : [{ label: 'Go to the home page', href: '/' }],
  );
  protected readonly boardsHref = computed(() =>
    projectPageHref(this.ref(), 'boards'),
  );
  protected readonly queriesHref = computed(() =>
    projectPageHref(this.ref(), 'queries'),
  );
}
