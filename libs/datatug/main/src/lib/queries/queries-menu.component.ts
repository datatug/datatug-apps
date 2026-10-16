import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink, UrlTree } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonIcon,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonMenuToggle,
} from '@ionic/angular';
import { IQueryState } from '../editor/models';
import { ProjectContextService } from '../services/project/project-context.service';
import { QueryEditorStateService } from './query-editor-state-service';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { QueriesUiService } from './queries-ui.service';
import { projectPageHref } from '../nav/project-page-href';

@Component({
  selector: 'sneat-datatug-queries-menu',
  templateUrl: './queries-menu.component.html',
  imports: [
    IonItem,
    IonItemDivider,
    IonIcon,
    IonButton,
    IonButtons,
    IonLabel,
    IonMenuToggle,
    RouterLink,
  ],
})
export class QueriesMenuComponent {
  readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly queriesUiService = inject(QueriesUiService);
  private readonly queryEditorStateService = inject(QueryEditorStateService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly projectRef = toSignal(this.projectContextService.current$, {
    initialValue: this.projectContextService.current,
  });

  readonly currentQueryId = signal<string | undefined>(undefined);
  readonly queries = signal<ReadonlyArray<IQueryState> | undefined>(undefined);

  constructor() {
    this.setupQueryEditorStateTracking();
  }

  private setupQueryEditorStateTracking(): void {
    try {
      this.queryEditorStateService.queryEditorState
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (state) => {
            this.currentQueryId.set(state?.currentQueryId);
            this.queries.set(state?.activeQueries);
          },
          error: this.errorLogger.logErrorHandler(
            'failed to get query editor stage',
          ),
        });
    } catch (err) {
      this.errorLogger.logError(
        err,
        'failed to subscribe for query queryEditorStateService.queryEditorState',
      );
    }
  }

  selectQuery(id?: string): void {
    if (id) {
      this.queryEditorStateService.setCurrentQuery(id);
    }
  }

  closeQuery(event: Event, query: IQueryState): void {
    event.stopPropagation();
    this.queryEditorStateService.closeQuery(query);
  }

  hasProject(): boolean {
    return !!this.projectRef();
  }

  queriesLink(): UrlTree | undefined {
    const ref = this.projectRef();
    return ref
      ? this.router.parseUrl(projectPageHref(ref, 'queries', this.router.url))
      : undefined;
  }

  newQuery(): void {
    const ref = this.projectRef();
    if (!ref) {
      return;
    }
    this.queriesUiService
      .openNewQuery(ref)
      .catch(this.errorLogger.logErrorHandler('failed to open new query'));
  }
}
