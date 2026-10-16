import {
  DestroyRef,
  Directive,
  inject,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core';
import { ensureAgGrid } from './ag-grid-setup';

/**
 * Structural directive for every `<ag-grid-angular>`: `<ag-grid-angular *datatugAgGridReady ...>`.
 * The grid is created only after `ensureAgGrid()` resolved, i.e. after the community modules (and, with a license
 * key, the lazily imported enterprise modules and key) are registered. Pages without a grid never trigger it.
 */
@Directive({ selector: '[datatugAgGridReady]' })
export class AgGridReadyDirective {
  constructor() {
    const template = inject(TemplateRef);
    const container = inject(ViewContainerRef);
    let destroyed = false;
    inject(DestroyRef).onDestroy(() => (destroyed = true));
    void ensureAgGrid().then(() => {
      if (!destroyed) {
        // Zoneless: a view created from a promise callback must tell Angular to render it.
        container.createEmbeddedView(template).markForCheck();
      }
    });
  }
}
