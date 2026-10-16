import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { Router, RouterLink, UrlTree } from '@angular/router';
import { IonButton } from '@ionic/angular';
import {
  BoardWidget,
  SQLWidgetDef,
  TabsWidgetDef,
} from '@datatug/board-models';
import { IBoardContext } from '../../../../models/definition/board/board';
import { IProjectRef } from '../../../../core/project-context';
import { projectPageHref } from '../../../../nav/project-page-href';
import { QueryType } from '../../../../models/definition/query-def';
import { TabsWidgetComponent } from '../widgets/tabs-widget/tabs-widget.component';

@Component({
  selector: 'sneat-datatug-board-widget',
  templateUrl: './board-widget.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TabsWidgetComponent, RouterLink, IonButton],
})
export class BoardWidgetComponent {
  private readonly router = inject(Router);
  readonly level = input<number>();
  readonly cardTab = input<QueryType | 'grid' | 'card'>();
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly widgetDef = input<BoardWidget>();

  // In boards.go, BoardWidget.data for name "SQL" is the whole SQLWidgetDef
  // ({ title?, parameters?, sql: { query } }), not the inner settings.
  readonly tabsWidgetDef = computed(
    () => this.widgetDef()?.data as TabsWidgetDef | undefined,
  );
  readonly sqlWidgetDef = computed(
    () => this.widgetDef()?.data as SQLWidgetDef | undefined,
  );
  readonly queryId = computed(() => this.sqlWidgetDef()?.sql?.queryId?.trim());
  readonly queryUrlTree = computed<UrlTree | undefined>(() => {
    const ref = this.projectRef();
    const id = this.queryId();
    if (!ref || !id) return undefined;
    const href = projectPageHref(ref, ['query', id]);
    if (href === '/') return undefined;
    const tree = this.router.parseUrl(href);
    tree.queryParams = { ...tree.queryParams, id };
    return tree;
  });

  readonly boardContext = input<IBoardContext>();
  readonly projectRef = input<IProjectRef>();
}
