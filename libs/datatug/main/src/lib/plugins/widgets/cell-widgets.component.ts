import { Component, input } from '@angular/core';
import { ICellWidgetDef } from '../../models/definition/cell-widget';
import { CellHrefWidgetComponent } from './cell-href-widget';

@Component({
  selector: 'sneat-datatug-cell-widgets',
  templateUrl: 'cell-widgets.component.html',
  imports: [CellHrefWidgetComponent],
})
export class CellWidgetsComponent {
  readonly v = input<unknown>();
  readonly def = input<ICellWidgetDef>();
  readonly settings = input<unknown>();
}
