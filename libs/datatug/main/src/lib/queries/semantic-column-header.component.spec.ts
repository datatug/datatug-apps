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
