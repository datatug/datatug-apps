import { BoardWidget, TabsWidgetDef } from '@datatug/board-models';

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
  for (const key of path) {
    if (current?.name !== 'tabs') return undefined;
    const tabs = (current.data as TabsWidgetDef | undefined)?.tabs;
    if (!Array.isArray(tabs)) return undefined;
    const matches = tabs.filter((tab, index) => tabKey(tab, index) === key);
    if (matches.length !== 1) return undefined;
    current = matches[0].widget;
  }
  return current;
}
