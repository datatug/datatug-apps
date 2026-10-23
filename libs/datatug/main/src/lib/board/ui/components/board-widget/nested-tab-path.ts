import { BoardWidget, TabsWidgetDef } from '@datatug/board-models';

/** Path key of the `index`th entry of a tab's `widgets[]`. Legacy `widget` has no key. */
export function stackedWidgetKey(index: number): string {
  return `w:${index}`;
}

export const MAX_NESTED_TAB_DEPTH = 8;

type IdentifiedTab = NonNullable<TabsWidgetDef['tabs']>[number] & {
  id?: string;
};

/** The positional legacy key also carries the title, so a changed tab fails closed. */
export function tabKey(tab: IdentifiedTab, index: number): string {
  return tab.id?.trim()
    ? `id:${tab.id.trim()}`
    : `legacy:${index}:${tab.title}`;
}

export function widgetAtTabPath(
  widget: BoardWidget | undefined,
  path: readonly string[],
): BoardWidget | undefined {
  if (path.length > MAX_NESTED_TAB_DEPTH) return undefined;
  let current = widget;
  let tab: IdentifiedTab | undefined;
  for (const key of path) {
    const stacked = /^w:(0|[1-9][0-9]*)$/.exec(key);
    if (stacked) {
      if (!tab || !Array.isArray(tab.widgets)) return undefined;
      current = tab.widgets[Number(stacked[1])];
      tab = undefined;
      if (!current) return undefined;
      continue;
    }
    if (current?.name !== 'tabs') return undefined;
    const tabs = (current.data as TabsWidgetDef | undefined)?.tabs;
    if (!Array.isArray(tabs)) return undefined;
    const matches = tabs.filter((candidate, index) => tabKey(candidate, index) === key);
    if (matches.length !== 1) return undefined;
    tab = matches[0];
    current = tab.widget;
  }
  return current;
}
