import { ChangeDetectionStrategy, Component, signal, type OnDestroy } from '@angular/core';
import type { IHeaderAngularComp } from 'ag-grid-angular';
import type { IHeaderParams } from 'ag-grid-community';
export interface SemanticHeaderParams extends IHeaderParams {
  meaningLabel?: string;
  needsReview?: boolean;
  openMeaning: () => void;
}
@Component({
  selector: 'sneat-datatug-semantic-column-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="heading">
    <span>{{ name() }}</span
    ><button
      type="button"
      [class.mapped]="!!meaning()"
      [class.review]="needsReview()"
      [attr.aria-label]="
        (meaning() ? 'Edit meaning of ' : 'Map meaning of ') + name()
      "
      (click)="open($event)"
    >
      {{ meaning() ? '◈ ' + meaning() : '+ Meaning' }}
      @if (needsReview()) {
        <small>Needs review</small>
      }
    </button>
  </div>`,
  styles: [
    ':host{width:100%;min-width:0}.heading{display:flex;flex-direction:column;gap:3px;align-items:flex-start}.heading>span{overflow:hidden;text-overflow:ellipsis;max-width:100%}button{font:inherit;font-size:11px;line-height:16px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid var(--ion-color-medium);border-radius:5px;padding:1px 5px;background:transparent;color:var(--ion-color-medium-shade);cursor:pointer}button.mapped{color:var(--ion-color-primary);border-color:var(--ion-color-primary)}button.review{color:var(--ion-color-warning-shade);border-color:var(--ion-color-warning)}button:focus-visible{outline:2px solid var(--ion-color-primary);outline-offset:2px}small{margin-left:5px}',
  ],
})
export class SemanticColumnHeaderComponent implements IHeaderAngularComp, OnDestroy {
  readonly name = signal('');
  readonly meaning = signal('');
  readonly needsReview = signal(false);
  private action?: () => void;
  private headerElement?: HTMLElement;
  private readonly contextMenu = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    this.action?.();
  };
  private readonly headerKey = (event: KeyboardEvent): void => {
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))
      this.contextMenu(event);
  };
  agInit(params: SemanticHeaderParams): void {
    this.refresh(params);
  }
  refresh(params: SemanticHeaderParams): boolean {
    this.name.set(params.displayName);
    this.meaning.set(params.meaningLabel ?? '');
    this.needsReview.set(!!params.needsReview);
    this.action = params.openMeaning;
    if (this.headerElement !== params.eGridHeader) {
      this.ngOnDestroy();
      this.headerElement = params.eGridHeader;
      this.headerElement.addEventListener('contextmenu', this.contextMenu);
      this.headerElement.addEventListener('keydown', this.headerKey);
    }
    return true;
  }
  ngOnDestroy(): void {
    this.headerElement?.removeEventListener('contextmenu', this.contextMenu);
    this.headerElement?.removeEventListener('keydown', this.headerKey);
    this.headerElement = undefined;
  }
  open(event: Event): void {
    event.stopPropagation();
    this.action?.();
  }
}
