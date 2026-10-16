import { describe, it, expect, vi } from 'vitest';
import {
  SemanticColumnHeaderComponent,
  type SemanticHeaderParams,
} from './semantic-column-header.component';
describe('meaning header contextual actions', () => {
  it('opens from right click, ContextMenu and Shift+F10 without consuming ordinary typing; cleans listeners', () => {
    const header = document.createElement('div'),
      openMeaning = vi.fn();
    const component = new SemanticColumnHeaderComponent();
    // AG Grid owns the remaining callbacks; this fixture exercises header actions.
    component.agInit({
      displayName: 'InvoiceId',
      eGridHeader: header,
      openMeaning,
    } as unknown as SemanticHeaderParams);
    const context = new MouseEvent('contextmenu', { cancelable: true });
    header.dispatchEvent(context);
    expect(context.defaultPrevented).toBe(true);
    expect(openMeaning).toHaveBeenCalledTimes(1);
    header.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ContextMenu', cancelable: true }),
    );
    header.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        cancelable: true,
      }),
    );
    const typing = new KeyboardEvent('keydown', { key: 'a', cancelable: true });
    header.dispatchEvent(typing);
    expect(typing.defaultPrevented).toBe(false);
    expect(openMeaning).toHaveBeenCalledTimes(3);
    component.ngOnDestroy();
    header.dispatchEvent(new MouseEvent('contextmenu'));
    expect(openMeaning).toHaveBeenCalledTimes(3);
  });
});

describe('meaning header sorting and column menu', () => {
  const column = () => {
    let sort: 'asc' | 'desc' | null = null;
    const listeners = new Set<() => void>();
    return {
      getSort: () => sort,
      setSort: (value: 'asc' | 'desc' | null) => {
        sort = value;
        listeners.forEach((l) => l());
      },
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
      listeners,
    };
  };

  it('sorts from the name, shows the direction, opens the column menu and lets go of the column', () => {
    const col = column();
    const progressSort = vi.fn();
    const showColumnMenu = vi.fn();
    const component = new SemanticColumnHeaderComponent();
    component.agInit({
      displayName: 'Total',
      eGridHeader: document.createElement('div'),
      openMeaning: vi.fn(),
      enableSorting: true,
      enableMenu: true,
      column: col,
      progressSort,
      showColumnMenu,
    } as unknown as SemanticHeaderParams);
    expect(component.sortable()).toBe(true);
    expect(component.menu()).toBe(true);
    expect(component.sortLabel()).toBe('');
    expect(component.ariaSort()).toBe('none');
    const stop = vi.fn();
    component.sort({ stopPropagation: stop, shiftKey: false } as unknown as Event);
    expect(progressSort).toHaveBeenLastCalledWith(false);
    component.sort({ stopPropagation: stop, shiftKey: true } as unknown as Event);
    expect(progressSort).toHaveBeenLastCalledWith(true);
    col.setSort('asc');
    expect(component.sortLabel()).toBe('▲');
    expect(component.ariaSort()).toBe('ascending');
    col.setSort('desc');
    expect(component.sortLabel()).toBe('▼');
    expect(component.ariaSort()).toBe('descending');
    const button = document.createElement('button');
    component.openMenu({ stopPropagation: stop, currentTarget: button } as unknown as Event);
    expect(showColumnMenu).toHaveBeenCalledWith(button);
    expect(col.listeners.size).toBe(1);
    component.ngOnDestroy();
    expect(col.listeners.size).toBe(0);
  });

  it('does nothing for a column that cannot sort and has no menu', () => {
    const progressSort = vi.fn();
    const component = new SemanticColumnHeaderComponent();
    component.agInit({
      displayName: 'Plain',
      eGridHeader: document.createElement('div'),
      openMeaning: vi.fn(),
      enableSorting: false,
      enableMenu: false,
      progressSort,
    } as unknown as SemanticHeaderParams);
    component.sort({ stopPropagation: vi.fn() } as unknown as Event);
    expect(progressSort).not.toHaveBeenCalled();
    expect(component.ariaSort()).toBeNull();
    component.openMenu({ stopPropagation: vi.fn(), currentTarget: null } as unknown as Event);
    expect(component.menu()).toBe(false);
  });

  it('follows a new column on refresh', () => {
    const first = column();
    const second = column();
    const component = new SemanticColumnHeaderComponent();
    const base = { displayName: 'A', eGridHeader: document.createElement('div'), openMeaning: vi.fn() };
    component.agInit({ ...base, column: first } as unknown as SemanticHeaderParams);
    component.refresh({ ...base, column: second } as unknown as SemanticHeaderParams);
    expect(first.listeners.size).toBe(0);
    expect(second.listeners.size).toBe(1);
  });
});
