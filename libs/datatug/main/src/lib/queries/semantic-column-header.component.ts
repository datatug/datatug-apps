import { ChangeDetectionStrategy, Component, computed, signal, type OnDestroy } from '@angular/core';
import type { IHeaderAngularComp } from 'ag-grid-angular';
import type { IHeaderParams } from 'ag-grid-community';
type SortDirection = 'asc' | 'desc' | null;

export interface SemanticHeaderParams extends IHeaderParams {
  meaningLabel?: string;
  needsReview?: boolean;
  checking?: boolean;
  openMeaning: () => void;
}
@Component({
  selector: 'sneat-datatug-semantic-column-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="heading">
    <span class="name-row"
      ><span
        class="name"
        [class.sortable]="sortable()"
        [attr.role]="sortable() ? 'button' : null"
        [attr.tabindex]="sortable() ? 0 : null"
        [attr.aria-sort]="ariaSort()"
        data-testid="header-name"
        (click)="sort($event)"
        (keydown.enter)="sort($event)"
        >{{ name() }}</span
      >
      @if (sortLabel()) {
        <span class="sort" aria-hidden="true" data-testid="header-sort">{{ sortLabel() }}</span>
      } @else if (sortable()) {
        <span class="sort idle" aria-hidden="true" data-testid="header-sort-idle">⇅</span>
      }
      @if (menu()) {
        <button
          type="button"
          class="menu"
          [attr.aria-label]="'Column menu of ' + name()"
          data-testid="header-menu"
          (click)="openMenu($event)"
        >
          ⋮
        </button>
      }</span
    ><button
      type="button"
      [class.mapped]="!!meaning()"
      [class.review]="needsReview()"
      [class.checking]="checking()"
      [attr.aria-busy]="checking()"
      [attr.aria-label]="
        (meaning() ? 'Edit meaning of ' : 'Map meaning of ') + name()
      "
      (click)="open($event)"
    >
      {{ meaning() ? '◈ ' + meaning() : '+ Meaning' }}
      @if (checking() && meaning()) {
        <small>Checking meaning…</small>
      } @else if (needsReview()) {
        <small>Needs review</small>
      }
    </button>
  </div>`,
  styles: [
    ':host{width:100%;min-width:0}.heading{display:flex;flex-direction:column;gap:3px;align-items:flex-start}.heading>span{overflow:hidden;text-overflow:ellipsis;max-width:100%}button{font:inherit;font-size:11px;line-height:16px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid var(--ion-color-medium);border-radius:5px;padding:1px 5px;background:transparent;color:var(--ion-color-medium-shade);cursor:pointer}button.mapped{color:var(--ion-color-primary);border-color:var(--ion-color-primary)}button.checking{color:var(--ion-color-medium-shade);border-color:var(--ion-color-medium)}button.review{color:var(--ion-color-warning-shade);border-color:var(--ion-color-warning)}button:focus-visible{outline:2px solid var(--ion-color-primary);outline-offset:2px}small{margin-left:5px}.name-row{display:flex;align-items:center;gap:4px;max-width:100%}.name{overflow:hidden;text-overflow:ellipsis}.name.sortable{cursor:pointer}.sort{font-size:10px}.sort.idle{opacity:.45}button.menu{border:0;padding:0 4px;font-size:14px;line-height:16px;color:var(--ion-color-medium-shade)}',
  ],
})
export class SemanticColumnHeaderComponent implements IHeaderAngularComp, OnDestroy {
  readonly name = signal('');
  readonly meaning = signal('');
  readonly needsReview = signal(false);
  readonly checking = signal(false);
  readonly sortable = signal(false);
  readonly menu = signal(false);
  readonly sortDirection = signal<SortDirection>(null);
  readonly sortLabel = computed(() => {
    const d = this.sortDirection();
    return d === 'asc' ? '▲' : d === 'desc' ? '▼' : '';
  });
  readonly ariaSort = computed(() => {
    if (!this.sortable()) return null;
    const d = this.sortDirection();
    return d === 'asc' ? 'ascending' : d === 'desc' ? 'descending' : 'none';
  });
  private params?: SemanticHeaderParams;
  private column?: SemanticHeaderParams['column'];
  private readonly sortChanged = (): void => {
    this.sortDirection.set(this.column?.getSort?.() ?? null);
  };
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
    this.checking.set(!!params.checking);
    this.action = params.openMeaning;
    this.params = params;
    this.sortable.set(!!params.enableSorting);
    this.menu.set(!!params.enableMenu);
    if (this.column !== params.column) {
      this.column?.removeEventListener?.('sortChanged', this.sortChanged);
      this.column = params.column;
      this.column?.addEventListener?.('sortChanged', this.sortChanged);
    }
    this.sortChanged();
    if (this.headerElement !== params.eGridHeader) {
      this.detachHeader();
      this.headerElement = params.eGridHeader;
      this.headerElement.addEventListener('contextmenu', this.contextMenu);
      this.headerElement.addEventListener('keydown', this.headerKey);
    }
    return true;
  }
  /** The name sorts the column (Shift adds it to a multi-column sort), as AG Grid's own header does. */
  sort(event: Event): void {
    if (!this.sortable()) return;
    event.stopPropagation();
    this.params?.progressSort((event as MouseEvent | KeyboardEvent).shiftKey === true);
  }
  openMenu(event: Event): void {
    event.stopPropagation();
    const source = event.currentTarget as HTMLElement | null;
    if (source) this.params?.showColumnMenu?.(source);
  }
  ngOnDestroy(): void {
    this.column?.removeEventListener?.('sortChanged', this.sortChanged);
    this.column = undefined;
    this.detachHeader();
  }
  private detachHeader(): void {
    this.headerElement?.removeEventListener('contextmenu', this.contextMenu);
    this.headerElement?.removeEventListener('keydown', this.headerKey);
    this.headerElement = undefined;
  }
  open(event: Event): void {
    event.stopPropagation();
    this.action?.();
  }
}
