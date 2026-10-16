import { BoardWidget } from '@datatug/board-models';
import {
  MAX_NESTED_TAB_DEPTH,
  tabKey,
  widgetAtTabPath,
} from './nested-tab-path';

describe('nested tab path', () => {
  const leaf: BoardWidget = { name: 'SQL', data: { sql: { queryId: 'q' } } };

  it('selects by stable ID and rejects a duplicate ID', () => {
    const widget: BoardWidget = {
      name: 'tabs',
      data: {
        tabs: [
          { id: 'grid', title: 'Data', widget: leaf },
          { id: 'chart', title: 'Data', widget: leaf },
        ],
      },
    };
    expect(widgetAtTabPath(widget, ['id:chart'])).toBe(leaf);
    expect(widgetAtTabPath(widget, ['id:missing'])).toBeUndefined();
    const duplicate: BoardWidget = {
      name: 'tabs',
      data: {
        tabs: [
          { id: 'same', title: 'A', widget: leaf },
          { id: 'same', title: 'B', widget: leaf },
        ],
      },
    };
    expect(widgetAtTabPath(duplicate, ['id:same'])).toBeUndefined();
  });

  it('pins legacy tabs to their position and title', () => {
    const widget: BoardWidget = {
      name: 'tabs',
      data: {
        tabs: [
          { title: 'Data', widget: leaf },
          { title: 'Data', widget: { name: 'HTTP' } },
        ],
      },
    };
    expect(tabKey({ title: 'Data' }, 1)).toBe('legacy:1:Data');
    expect(widgetAtTabPath(widget, ['legacy:0:Data'])).toBe(leaf);
    expect(widgetAtTabPath(widget, ['legacy:1:Data'])?.name).toBe('HTTP');
    expect(widgetAtTabPath(widget, ['legacy:0:Other'])).toBeUndefined();
  });

  it('bounds recursion and rejects crossing a non-tab widget', () => {
    expect(widgetAtTabPath(leaf, ['id:child'])).toBeUndefined();
    expect(
      widgetAtTabPath(leaf, Array(MAX_NESTED_TAB_DEPTH + 1).fill('id:a')),
    ).toBeUndefined();
  });
});
