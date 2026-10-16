import type { Board, BoardCard } from './board';
import type { BoardWidget } from './board-widget';
import type { ChartSpec, ChartWidgetDef } from './widget-chart';
import type { TabWidget, TabsWidgetDef } from './widget-tabs';

/** These actions change only a visitor's working copy; the saved Board stays authoritative. */
export type BoardAction =
  | {
      readonly type: 'add-card';
      readonly cardId: string;
      readonly toRow?: number;
      readonly toIndex?: number;
    }
  | { readonly type: 'remove-card'; readonly cardId: string }
  | {
      readonly type: 'move-card';
      readonly cardId: string;
      readonly toRow: number;
      readonly toIndex: number;
    };

/** Stable tab keys use `id:<id>`; legacy keys use `legacy:<index>:<title>`. */
interface WidgetActionTarget {
  readonly cardId: string;
  readonly widgetPath?: readonly string[];
}

/**
 * Presentation edits reference saved queries already present in the canonical board.
 * These wire-level operations never authorize execution or implement multi-source
 * composition. Core permits multiple sources on bars, but exactly one on races.
 */
export type BoardEditAction = WidgetActionTarget &
  (
    | {
        readonly type: 'add-tab';
        readonly tabId: string;
        readonly title: string;
        readonly queryId: string;
        readonly toIndex?: number;
      }
    | { readonly type: 'remove-tab' | 'select-tab'; readonly tabKey: string }
    | {
        readonly type: 'reorder-tab';
        readonly tabKey: string;
        readonly toIndex: number;
      }
    | {
        readonly type: 'set-tab-query';
        readonly tabKey: string;
        readonly queryId: string;
      }
    | { readonly type: 'set-chart-spec'; readonly spec: ChartSpec }
    | { readonly type: 'set-view'; readonly view: 'chart' | 'grid' }
    | {
        readonly type: 'add-chart-source';
        readonly sourceId: string;
        readonly queryId: string;
      }
    | { readonly type: 'remove-chart-source'; readonly sourceId: string }
  );

export type BoardSessionAction = BoardAction | BoardEditAction;

/** Selection is session presentation state, never an extra Board wire field. Keys encode [cardId, ...widgetPath]. */
export interface BoardSessionState {
  readonly board: Board;
  readonly selectedTabs: Readonly<Record<string, string>>;
}

export type TutorialControl = 'guided' | 'free';
/** Supply window.sessionStorage only. Persistent storage would outlive the visitor's tutorial session. */
export interface TutorialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const MAX_ROWS = 100;
const MAX_CARDS = 200;
const MAX_ACTIONS = 256;
const MAX_SAVED_BYTES = 16_384;

type EncodedAction = readonly [number, number, number, number];
type EncodedEdit = readonly [
  number,
  number,
  readonly string[],
  Record<string, unknown>,
];

interface SavedSession {
  readonly version: 2 | 3;
  readonly revision: string;
  /** Action kind, canonical card index, target row and target position; no card contents or IDs. */
  readonly actions: readonly (EncodedAction | EncodedEdit)[];
  readonly cursor: number;
  readonly control: TutorialControl;
}

interface RestoredSession {
  readonly actions: readonly BoardSessionAction[];
  readonly cursor: number;
  readonly control: TutorialControl;
}

function cloneBoard(board: Board): Board {
  return JSON.parse(JSON.stringify(board)) as Board;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function canonicalCards(
  board: Board,
): Map<string, { card: BoardCard; row: number; index: number }> {
  if (!board.id || !board.title || (board.rows?.length ?? 0) > MAX_ROWS)
    throw new Error('This board cannot start a bounded tutorial.');
  const cards = new Map<
    string,
    { card: BoardCard; row: number; index: number }
  >();
  for (const [row, definition] of (board.rows ?? []).entries()) {
    for (const [index, card] of (definition.cards ?? []).entries()) {
      if (!card.id || cards.has(card.id) || cards.size >= MAX_CARDS)
        throw new Error(
          'Tutorial cards need distinct IDs within the supported size.',
        );
      cards.set(card.id, { card, row, index });
    }
  }
  return cards;
}

function canonicalWorkingBoard(
  canonical: Board,
  working: Board,
  cards: ReturnType<typeof canonicalCards>,
  preserveEdits = false,
): Board {
  if (
    working.id !== canonical.id ||
    (working.rows?.length ?? 0) !== (canonical.rows?.length ?? 0)
  )
    throw new Error('Working board does not match the saved board.');
  const seen = new Set<string>();
  return {
    ...canonical,
    rows: (canonical.rows ?? []).map((row, index) => ({
      ...row,
      cards: (working.rows?.[index].cards ?? []).map((card) => {
        const saved = cards.get(card.id);
        if (!saved || seen.has(card.id))
          throw new Error(
            'Working board contains an unknown or repeated card.',
          );
        seen.add(card.id);
        return preserveEdits ? card : saved.card;
      }),
    })),
  };
}

/** Preserve row layout and board metadata, but never copy canonical cards into the starting view. */
export function emptyTutorialBoard(canonical: Board): Board {
  return emptyFrom(cloneBoard(canonical));
}

function emptyFrom(canonical: Board): Board {
  canonicalCards(canonical);
  return {
    ...canonical,
    rows: (canonical.rows ?? []).map((row) => ({ ...row, cards: [] })),
  };
}

function location(
  board: Board,
  cardId: string,
): { row: number; index: number } | undefined {
  for (const [row, definition] of (board.rows ?? []).entries()) {
    const index = (definition.cards ?? []).findIndex(
      (card) => card.id === cardId,
    );
    if (index >= 0) return { row, index };
  }
  return undefined;
}

function insert(
  board: Board,
  card: BoardCard,
  row: number,
  index: number,
): Board {
  return {
    ...board,
    rows: (board.rows ?? []).map((definition, rowIndex) =>
      rowIndex === row
        ? {
            ...definition,
            cards: [
              ...(definition.cards ?? []).slice(0, index),
              card,
              ...(definition.cards ?? []).slice(index),
            ],
          }
        : definition,
    ),
  };
}

function remove(board: Board, cardId: string): Board {
  return {
    ...board,
    rows: (board.rows ?? []).map((definition) => ({
      ...definition,
      cards: (definition.cards ?? []).filter((card) => card.id !== cardId),
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPosition(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= 0 &&
    Number(value) <= MAX_CARDS
  );
}

function validAction(value: unknown): value is BoardAction {
  if (
    !isRecord(value) ||
    typeof value['cardId'] !== 'string' ||
    !value['cardId'] ||
    value['cardId'].length > 256
  )
    return false;
  const keys = Object.keys(value);
  if (value['type'] === 'remove-card')
    return keys.every((key) => ['type', 'cardId'].includes(key));
  if (value['type'] === 'add-card')
    return (
      keys.every((key) =>
        ['type', 'cardId', 'toRow', 'toIndex'].includes(key),
      ) &&
      (value['toRow'] === undefined || isPosition(value['toRow'])) &&
      (value['toIndex'] === undefined || isPosition(value['toIndex'])) &&
      (value['toRow'] !== undefined || value['toIndex'] === undefined)
    );
  if (value['type'] === 'move-card')
    return (
      keys.every((key) =>
        ['type', 'cardId', 'toRow', 'toIndex'].includes(key),
      ) &&
      isPosition(value['toRow']) &&
      isPosition(value['toIndex'])
    );
  return false;
}

/** Applies a standard board action using card definitions from the fetched saved board. */
export function applyBoardAction(
  canonical: Board,
  working: Board,
  action: BoardAction,
): Board {
  return applyFrom(cloneBoard(canonical), working, action);
}

function applyFrom(
  canonical: Board,
  working: Board,
  action: BoardAction,
  preserveEdits = false,
): Board {
  if (!validAction(action))
    throw new Error('Invalid tutorial action or board identity.');
  const cards = canonicalCards(canonical);
  const source = cards.get(action.cardId);
  if (!source) throw new Error('The saved board has no such card.');
  const safeWorking = canonicalWorkingBoard(
    canonical,
    working,
    cards,
    preserveEdits,
  );
  const current = location(safeWorking, action.cardId);
  if (action.type === 'remove-card') {
    if (!current) throw new Error('The working board has no such card.');
    return remove(safeWorking, action.cardId);
  }
  if (action.type === 'move-card' && !current)
    throw new Error('Move requires a card already on the working board.');
  if (action.type === 'add-card' && current)
    throw new Error('The working board already contains this card.');
  const currentCard =
    current && safeWorking.rows?.[current.row]?.cards?.[current.index];
  const card = preserveEdits && currentCard ? currentCard : source.card;
  const targetRow = action.toRow ?? source.row;
  const withoutCard = current
    ? remove(safeWorking, action.cardId)
    : safeWorking;
  const rows = withoutCard.rows ?? [];
  if (targetRow >= rows.length)
    throw new Error('Target row is outside the saved board.');
  const existing = rows[targetRow].cards ?? [];
  const defaultIndex = existing.filter((card) => {
    const candidate = cards.get(card.id);
    return candidate?.row === targetRow && candidate.index < source.index;
  }).length;
  const targetIndex = action.toIndex ?? defaultIndex;
  if (targetIndex > existing.length)
    throw new Error('Target position is outside the working row.');
  return insert(withoutCard, card, targetRow, targetIndex);
}

const editKinds = [
  'add-tab',
  'remove-tab',
  'reorder-tab',
  'select-tab',
  'set-tab-query',
  'set-chart-spec',
  'set-view',
  'add-chart-source',
  'remove-chart-source',
] as const;
const MAX_TAB_DEPTH = 8;

function text(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value
  );
}

function identifier(value: unknown): value is string {
  return text(value) && !/\s/.test(value);
}

function validChartSpec(value: unknown): value is ChartSpec {
  if (
    !isRecord(value) ||
    !text(value['categoryColumn']) ||
    !text(value['valueColumn']) ||
    value['categoryColumn'] === value['valueColumn']
  )
    return false;
  if (
    value['unit'] !== undefined &&
    value['unit'] !== '' &&
    !text(value['unit'])
  )
    return false;
  const common = ['type', 'categoryColumn', 'valueColumn', 'unit'];
  if (value['type'] === 'bar')
    return Object.keys(value).every((key) => common.includes(key));
  return (
    value['type'] === 'bar-race' &&
    text(value['periodColumn']) &&
    text(value['unit']) &&
    value['periodColumn'] !== value['categoryColumn'] &&
    value['periodColumn'] !== value['valueColumn'] &&
    value['grain'] === 'month' &&
    (value['onDuplicate'] === 'sum' || value['onDuplicate'] === 'reject') &&
    (value['mode'] === 'period' || value['mode'] === 'cumulative') &&
    Number.isInteger(value['topN']) &&
    Number(value['topN']) >= 1 &&
    Number(value['topN']) <= 100 &&
    Object.keys(value).every((key) =>
      [
        ...common,
        'periodColumn',
        'grain',
        'onDuplicate',
        'mode',
        'topN',
      ].includes(key),
    )
  );
}

function validEdit(value: unknown): value is BoardEditAction {
  if (
    !isRecord(value) ||
    !text(value['cardId']) ||
    (value['widgetPath'] !== undefined &&
      (!Array.isArray(value['widgetPath']) ||
        value['widgetPath'].length > MAX_TAB_DEPTH ||
        value['widgetPath'].some(
          (key) => typeof key !== 'string' || !key || key.length > 520,
        )))
  )
    return false;
  const keys: Record<string, readonly string[]> = {
    'add-tab': ['tabId', 'title', 'queryId', 'toIndex'],
    'remove-tab': ['tabKey'],
    'select-tab': ['tabKey'],
    'reorder-tab': ['tabKey', 'toIndex'],
    'set-tab-query': ['tabKey', 'queryId'],
    'set-chart-spec': ['spec'],
    'set-view': ['view'],
    'add-chart-source': ['sourceId', 'queryId'],
    'remove-chart-source': ['sourceId'],
  };
  const kind = value['type'];
  if (
    typeof kind !== 'string' ||
    !Object.hasOwn(keys, kind) ||
    !Object.keys(value).every((key) =>
      ['type', 'cardId', 'widgetPath', ...keys[kind]].includes(key),
    )
  )
    return false;
  switch (kind) {
    case 'add-tab':
      return (
        identifier(value['tabId']) &&
        text(value['title']) &&
        identifier(value['queryId']) &&
        (value['toIndex'] === undefined || isPosition(value['toIndex']))
      );
    case 'remove-tab':
    case 'select-tab':
      return (
        typeof value['tabKey'] === 'string' &&
        !!value['tabKey'] &&
        value['tabKey'].length <= 520
      );
    case 'reorder-tab':
      return (
        typeof value['tabKey'] === 'string' &&
        !!value['tabKey'] &&
        value['tabKey'].length <= 520 &&
        isPosition(value['toIndex'])
      );
    case 'set-tab-query':
      return (
        typeof value['tabKey'] === 'string' &&
        !!value['tabKey'] &&
        value['tabKey'].length <= 520 &&
        identifier(value['queryId'])
      );
    case 'set-chart-spec':
      return validChartSpec(value['spec']);
    case 'set-view':
      return value['view'] === 'chart' || value['view'] === 'grid';
    case 'add-chart-source':
      return identifier(value['sourceId']) && identifier(value['queryId']);
    default:
      return identifier(value['sourceId']);
  }
}

function tabKey(tab: TabWidget, index: number): string {
  return tab.id ? `id:${tab.id}` : `legacy:${index}:${tab.title}`;
}

function tabsDefinition(widget: BoardWidget | undefined): TabsWidgetDef {
  if (
    widget?.name !== 'tabs' ||
    !isRecord(widget.data) ||
    !Array.isArray(widget.data['tabs']) ||
    widget.data['tabs'].length > MAX_CARDS
  )
    throw new Error('This operation requires bounded tabs.');
  const tabs = widget.data['tabs'] as TabWidget[];
  const keys = new Set<string>();
  for (const [index, tab] of tabs.entries()) {
    if (
      !isRecord(tab) ||
      typeof tab.title !== 'string' ||
      (tab.id !== undefined && tab.id !== '' && !identifier(tab.id))
    )
      throw new Error('Malformed tab identity.');
    const key = tabKey(tab, index);
    if (keys.has(key)) throw new Error('Tabs need distinct stable IDs.');
    keys.add(key);
  }
  return widget.data as unknown as TabsWidgetDef;
}

function tabIndex(tabs: readonly TabWidget[], key: string): number {
  const matches = tabs
    .map((tab, index) => (tabKey(tab, index) === key ? index : -1))
    .filter((index) => index >= 0);
  if (matches.length !== 1)
    throw new Error('The selected tab no longer exists.');
  return matches[0];
}

function widgetAtPath(
  widget: BoardWidget | undefined,
  path: readonly string[],
): BoardWidget | undefined {
  if (path.length > MAX_TAB_DEPTH) throw new Error('Too many nested tabs.');
  for (const key of path) {
    const tabs = tabsDefinition(widget).tabs;
    widget = tabs[tabIndex(tabs, key)].widget;
  }
  return widget;
}

function changeWidget(
  widget: BoardWidget | undefined,
  path: readonly string[],
  change: (widget: BoardWidget | undefined) => BoardWidget,
): BoardWidget {
  if (!path.length) return change(widget);
  const data = tabsDefinition(widget);
  const index = tabIndex(data.tabs, path[0]);
  return {
    name: 'tabs',
    data: {
      ...data,
      tabs: data.tabs.map((tab, i) =>
        i === index
          ? { ...tab, widget: changeWidget(tab.widget, path.slice(1), change) }
          : tab,
      ),
    },
  };
}

/** Query choices come from canonical bindings, not arbitrary IDs, text, results or endpoints in actions. */
export function canonicalBoardQueryIds(canonical: Board): readonly string[] {
  const queries = new Set<string>();
  const visit = (widget: BoardWidget | undefined, depth: number): void => {
    if (!widget || !isRecord(widget.data)) return;
    if (depth > MAX_TAB_DEPTH) throw new Error('Too many nested tabs.');
    if (
      widget.name === 'SQL' &&
      isRecord(widget.data['sql']) &&
      identifier(widget.data['sql']['queryId'])
    )
      queries.add(widget.data['sql']['queryId']);
    if (widget.name === 'chart' && Array.isArray(widget.data['sources'])) {
      for (const source of widget.data['sources'])
        if (isRecord(source) && identifier(source['queryId']))
          queries.add(source['queryId']);
    }
    if (widget.name === 'tabs')
      for (const tab of tabsDefinition(widget).tabs)
        visit(tab.widget, depth + 1);
  };
  for (const { card } of canonicalCards(canonical).values())
    visit(card.widget, 0);
  return [...queries].sort();
}

function chartDefinition(widget: BoardWidget | undefined): ChartWidgetDef {
  if (widget?.name !== 'chart' || !isRecord(widget.data))
    throw new Error('This operation requires a chart widget.');
  const data = widget.data as unknown as ChartWidgetDef;
  if (
    !validChartSpec(data.chart) ||
    !Array.isArray(data.sources) ||
    !data.sources.length ||
    data.sources.length > MAX_CARDS
  )
    throw new Error('Invalid chart configuration.');
  const ids = new Set<string>();
  for (const source of data.sources) {
    if (
      !isRecord(source) ||
      !identifier(source.id) ||
      !identifier(source.queryId) ||
      ids.has(source.id)
    )
      throw new Error('Chart sources need distinct IDs and saved queries.');
    ids.add(source.id);
    if (
      source.transform &&
      (source.transform.name !== 'orders-monthly-country-count' ||
        data.chart.type !== 'bar-race' ||
        data.chart.periodColumn !== 'period' ||
        data.chart.categoryColumn !== 'category' ||
        data.chart.valueColumn !== 'value' ||
        data.chart.onDuplicate !== 'reject')
    )
      throw new Error(
        'The Orders transform requires its canonical race mapping.',
      );
  }
  if (data.chart.type === 'bar-race' && data.sources.length !== 1)
    throw new Error(
      'The board wire contract requires one source for a bar race.',
    );
  return data;
}

function selectionKey(cardId: string, path: readonly string[]): string {
  return JSON.stringify([cardId, ...path]);
}

function pruneSelections(
  board: Board,
  selections: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(selections).filter(([key, selected]) => {
      try {
        const [cardId, ...path] = JSON.parse(key) as string[];
        const position = location(board, cardId);
        const widget =
          position && board.rows?.[position.row].cards?.[position.index].widget;
        const tabs = tabsDefinition(widgetAtPath(widget, path)).tabs;
        return tabs.some((tab, index) => tabKey(tab, index) === selected);
      } catch {
        return false;
      }
    }),
  );
}

function applySessionAction(
  canonical: Board,
  state: BoardSessionState,
  action: BoardSessionAction,
): BoardSessionState {
  if (validAction(action)) {
    const board = applyFrom(canonical, state.board, action, true);
    return { board, selectedTabs: pruneSelections(board, state.selectedTabs) };
  }
  if (!validEdit(action)) throw new Error('Invalid session board edit.');
  if (
    'queryId' in action &&
    !canonicalBoardQueryIds(canonical).includes(action.queryId)
  )
    throw new Error('Choose a saved query referenced by the canonical board.');
  const position = location(state.board, action.cardId);
  if (!position) throw new Error('The card must be on the working board.');
  const path = action.widgetPath ?? [];
  const card = state.board.rows?.[position.row]?.cards?.[position.index];
  if (!card) throw new Error('The working card no longer exists.');
  const selectedTabs = { ...state.selectedTabs };
  const widget = changeWidget(card.widget, path, (current) => {
    if (
      [
        'add-tab',
        'remove-tab',
        'reorder-tab',
        'select-tab',
        'set-tab-query',
      ].includes(action.type)
    ) {
      const data = tabsDefinition(current);
      const tabs = [...data.tabs];
      if (action.type === 'add-tab') {
        if (
          tabs.length >= MAX_CARDS ||
          tabs.some((tab) => tab.id === action.tabId)
        )
          throw new Error('Duplicate tab ID or tab bound exceeded.');
        const index = action.toIndex ?? tabs.length;
        if (index > tabs.length)
          throw new Error('Tab position is outside the card.');
        tabs.splice(index, 0, {
          id: action.tabId,
          title: action.title,
          widget: { name: 'SQL', data: { sql: { queryId: action.queryId } } },
        });
      } else if ('tabKey' in action) {
        const index = tabIndex(tabs, action.tabKey);
        if (action.type === 'select-tab')
          selectedTabs[selectionKey(action.cardId, path)] = action.tabKey;
        if (action.type === 'remove-tab') tabs.splice(index, 1);
        if (action.type === 'reorder-tab') {
          if (action.toIndex >= tabs.length)
            throw new Error('Tab position is outside the card.');
          tabs.splice(action.toIndex, 0, tabs.splice(index, 1)[0]);
        }
        if (action.type === 'set-tab-query') {
          const previous = tabs[index].widget;
          if (
            previous &&
            previous.name !== 'SQL' &&
            (previous.name || previous.data != null)
          )
            throw new Error(
              'Saved query replacement supports SQL widgets and empty tabs only.',
            );
          tabs[index] = {
            ...tabs[index],
            widget: { name: 'SQL', data: { sql: { queryId: action.queryId } } },
          };
        }
      }
      return { name: 'tabs', data: { ...data, tabs } };
    }
    const data = chartDefinition(current);
    let edited: ChartWidgetDef;
    if (action.type === 'set-chart-spec')
      edited = { ...data, chart: action.spec };
    else if (action.type === 'set-view')
      edited = { ...data, defaultView: action.view };
    else if (action.type === 'add-chart-source') {
      if (
        data.sources.some(
          (source) =>
            source.id === action.sourceId || source.queryId === action.queryId,
        )
      )
        throw new Error(
          'The chart already contains this source ID or saved query.',
        );
      edited = {
        ...data,
        sources: [
          ...data.sources,
          { id: action.sourceId, queryId: action.queryId },
        ],
      };
    } else if (action.type === 'remove-chart-source') {
      if (
        data.sources.filter((source) => source.id === action.sourceId)
          .length !== 1
      )
        throw new Error('The chart source no longer exists.');
      edited = {
        ...data,
        sources: data.sources.filter((source) => source.id !== action.sourceId),
      };
    } else throw new Error('Unsupported widget edit.');
    const result = { name: 'chart', data: edited };
    chartDefinition(result);
    return result;
  });
  const board = {
    ...state.board,
    rows: (state.board.rows ?? []).map((row, i) =>
      i === position.row
        ? {
            ...row,
            cards: (row.cards ?? []).map((item, j) =>
              j === position.index ? { ...item, widget } : item,
            ),
          }
        : row,
    ),
  };
  return { board, selectedTabs: pruneSelections(board, selectedTabs) };
}

function replay(
  canonical: Board,
  actions: readonly BoardSessionAction[],
  cursor: number,
): BoardSessionState {
  return actions
    .slice(0, cursor)
    .reduce((state, action) => applySessionAction(canonical, state, action), {
      board: emptyFrom(canonical),
      selectedTabs: {},
    } as BoardSessionState);
}

/** Reusable standard session reducer: all content is rebuilt from canonical definitions and validated actions. */
export function replayBoardActions(
  canonical: Board,
  actions: readonly BoardSessionAction[],
  cursor = actions.length,
): BoardSessionState {
  if (
    !Array.isArray(actions) ||
    actions.length > MAX_ACTIONS ||
    !Number.isSafeInteger(cursor) ||
    cursor < 0 ||
    cursor > actions.length
  )
    throw new Error('Invalid session action log.');
  const snapshot = cloneBoard(canonical);
  const owned = actions.map((action) => {
    if (!validAction(action) && !validEdit(action))
      throw new Error('Invalid session action.');
    return JSON.parse(JSON.stringify(action)) as BoardSessionAction;
  });
  // Validate the entire log, including any redo tail, before returning the selected cursor.
  replay(snapshot, owned, owned.length);
  const state = replay(snapshot, owned, cursor);
  return {
    board: cloneBoard(state.board),
    selectedTabs: { ...state.selectedTabs },
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function encodeActions(
  canonical: Board,
  actions: readonly BoardSessionAction[],
): (EncodedAction | EncodedEdit)[] {
  const indexes = new Map(
    [...canonicalCards(canonical).keys()].map((id, index) => [id, index]),
  );
  return actions.map((action) => {
    const index = indexes.get(action.cardId);
    if (index === undefined)
      throw new Error('Action card is missing from the saved board.');
    if (action.type === 'remove-card') return [1, index, -1, -1];
    if (action.type === 'move-card')
      return [2, index, action.toRow, action.toIndex];
    if (action.type === 'add-card')
      return [0, index, action.toRow ?? -1, action.toIndex ?? -1];
    const payload: Record<string, unknown> = { ...action };
    delete payload['type'];
    delete payload['cardId'];
    delete payload['widgetPath'];
    if ('queryId' in action) {
      delete payload['queryId'];
      payload['queryIndex'] = canonicalBoardQueryIds(canonical).indexOf(
        action.queryId,
      );
    }
    return [
      3 + editKinds.indexOf(action.type),
      index,
      [...(action.widgetPath ?? [])],
      payload,
    ];
  });
}

function decodeAction(
  canonicalIds: readonly string[],
  value: unknown,
): BoardAction | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(Number.isSafeInteger)
  )
    return undefined;
  const [kind, index, row, position] = value as number[];
  const cardId = canonicalIds[index];
  if (
    !cardId ||
    row < -1 ||
    row >= MAX_ROWS ||
    position < -1 ||
    position > MAX_CARDS
  )
    return undefined;
  if (kind === 1 && row === -1 && position === -1)
    return { type: 'remove-card', cardId };
  if (kind === 0 && (row >= 0 || position === -1))
    return {
      type: 'add-card',
      cardId,
      ...(row >= 0 ? { toRow: row } : {}),
      ...(position >= 0 ? { toIndex: position } : {}),
    };
  if (kind === 2 && row >= 0 && position >= 0)
    return { type: 'move-card', cardId, toRow: row, toIndex: position };
  return undefined;
}

function decodeSessionAction(
  canonical: Board,
  value: unknown,
  version: number,
): BoardSessionAction | undefined {
  const ids = [...canonicalCards(canonical).keys()];
  const legacy = decodeAction(ids, value);
  if (legacy || version === 2) return legacy;
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !Number.isSafeInteger(value[0]) ||
    !Number.isSafeInteger(value[1]) ||
    !Array.isArray(value[2]) ||
    !isRecord(value[3])
  )
    return undefined;
  const type = editKinds[value[0] - 3];
  const cardId = ids[value[1]];
  const settings = { ...value[3] };
  if (Object.hasOwn(settings, 'queryId')) return undefined;
  if (Object.hasOwn(settings, 'queryIndex')) {
    if (!Number.isSafeInteger(settings['queryIndex'])) return undefined;
    settings['queryId'] =
      canonicalBoardQueryIds(canonical)[Number(settings['queryIndex'])];
    delete settings['queryIndex'];
  }
  // Envelope fields must never be overwritten by a forged persisted payload.
  if (
    Object.keys(settings).some((key) =>
      ['type', 'cardId', 'widgetPath'].includes(key),
    )
  )
    return undefined;
  const action = { type, cardId, widgetPath: value[2], ...settings };
  return validEdit(action) ? action : undefined;
}

/** A digest of the full canonical definition invalidates stale session actions after a saved-board edit. */
export async function canonicalBoardRevision(board: Board): Promise<string> {
  canonicalCards(board);
  const bytes = new TextEncoder().encode(JSON.stringify(board));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function parseSaved(
  raw: string | null,
  revision: string,
  canonical: Board,
): RestoredSession | undefined {
  if (!raw || byteLength(raw) > MAX_SAVED_BYTES) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      (value['version'] !== 2 && value['version'] !== 3) ||
      value['revision'] !== revision ||
      !Array.isArray(value['actions']) ||
      value['actions'].length > MAX_ACTIONS ||
      !Number.isSafeInteger(value['cursor']) ||
      Number(value['cursor']) < 0 ||
      Number(value['cursor']) > value['actions'].length ||
      (value['control'] !== 'guided' && value['control'] !== 'free')
    )
      return undefined;
    const actions = value['actions'].map((action) =>
      decodeSessionAction(canonical, action, Number(value['version'])),
    );
    if (actions.some((action) => !action)) return undefined;
    replay(canonical, actions as BoardSessionAction[], actions.length);
    return {
      actions: actions as BoardSessionAction[],
      cursor: Number(value['cursor']),
      control: value['control'],
    };
  } catch {
    return undefined;
  }
}

/** The only mutable state is an action cursor and a bounded browser-session log. */
export class TutorialBoardSession {
  private actions: BoardSessionAction[];
  private cursor: number;
  private controlValue: TutorialControl;
  private workingBoard: Board;
  private selectedTabs: Readonly<Record<string, string>>;

  private constructor(
    readonly canonical: Board,
    readonly revision: string,
    readonly storageKey: string,
    private readonly storage: TutorialStorage | undefined,
    saved?: RestoredSession,
  ) {
    this.actions = [...(saved?.actions ?? [])];
    this.cursor = saved?.cursor ?? 0;
    this.controlValue = saved?.control ?? 'guided';
    const state = replay(canonical, this.actions, this.cursor);
    this.workingBoard = state.board;
    this.selectedTabs = state.selectedTabs;
  }

  /** Pass sessionStorage or a test double. Never pass localStorage or another persistent store. */
  static async open(
    canonical: Board,
    scope: string,
    storage?: TutorialStorage,
  ): Promise<TutorialBoardSession> {
    if (!scope || scope.length > 512)
      throw new Error('Tutorial needs a project scope.');
    const snapshot = cloneBoard(canonical);
    const revision = await canonicalBoardRevision(snapshot);
    deepFreeze(snapshot);
    const key = JSON.stringify([
      'datatug-board-tutorial/1',
      scope,
      snapshot.id,
    ]);
    let raw: string | null = null;
    try {
      raw = storage?.getItem(key) ?? null;
    } catch {
      /* Session storage can be disabled. */
    }
    const saved = parseSaved(raw, revision, snapshot);
    if (raw && !saved) {
      try {
        storage?.removeItem(key);
      } catch {
        /* Continue with an empty working board. */
      }
    }
    return new TutorialBoardSession(snapshot, revision, key, storage, saved);
  }

  /** Browser entry point: storage expires with the tab's session; unavailable storage falls back to memory. */
  static async openBrowser(
    canonical: Board,
    scope: string,
  ): Promise<TutorialBoardSession> {
    let storage: TutorialStorage | undefined;
    try {
      storage = globalThis.sessionStorage;
    } catch {
      /* Private browsing may deny storage. */
    }
    return this.open(canonical, scope, storage);
  }

  get board(): Board {
    return cloneBoard(this.workingBoard);
  }
  get presentation(): Readonly<Record<string, string>> {
    return { ...this.selectedTabs };
  }
  /** Owned replay input for execution admission and guide progress; never includes results. */
  get history(): {
    readonly actions: readonly BoardSessionAction[];
    readonly cursor: number;
  } {
    return {
      actions: JSON.parse(JSON.stringify(this.actions)) as BoardSessionAction[],
      cursor: this.cursor,
    };
  }
  selectedTab(
    cardId: string,
    widgetPath: readonly string[] = [],
  ): string | undefined {
    return this.selectedTabs[selectionKey(cardId, widgetPath)];
  }
  get control(): TutorialControl {
    return this.controlValue;
  }
  get canPrevious(): boolean {
    return this.controlValue === 'guided' && this.cursor > 0;
  }
  get canNext(): boolean {
    return (
      this.controlValue === 'guided' &&
      (this.cursor < this.actions.length ||
        (this.cursor < MAX_ACTIONS && !!this.nextCanonicalAction()))
    );
  }
  /** Complete means canonical card placement; presentation edits remain until Restart. */
  get isComplete(): boolean {
    return !this.nextCanonicalAction();
  }
  get hasEdits(): boolean {
    return this.actions
      .slice(0, this.cursor)
      .some((action) => !validAction(action));
  }

  private save(): void {
    const state: SavedSession = {
      version: this.actions.some((action) => !validAction(action)) ? 3 : 2,
      revision: this.revision,
      actions: encodeActions(this.canonical, this.actions),
      cursor: this.cursor,
      control: this.controlValue,
    };
    const json = JSON.stringify(state);
    if (byteLength(json) > MAX_SAVED_BYTES)
      throw new Error('Tutorial session exceeds its storage bound.');
    try {
      this.storage?.setItem(this.storageKey, json);
    } catch {
      /* Keep working in memory. */
    }
  }

  private nextCanonicalAction(): BoardAction | undefined {
    const working = this.workingBoard;
    for (const [row, definition] of (this.canonical.rows ?? []).entries()) {
      for (const [index, card] of (definition.cards ?? []).entries()) {
        if (working.rows?.[row]?.cards?.[index]?.id === card.id) continue;
        return location(working, card.id)
          ? { type: 'move-card', cardId: card.id, toRow: row, toIndex: index }
          : { type: 'add-card', cardId: card.id, toRow: row, toIndex: index };
      }
    }
    return undefined;
  }

  dispatch(action: BoardSessionAction): boolean {
    if (this.cursor >= MAX_ACTIONS) return false;
    const before = {
      board: this.workingBoard,
      selectedTabs: this.selectedTabs,
    };
    let after: BoardSessionState;
    let ownedAction: BoardSessionAction;
    try {
      // Validate before JSON cloning so unknown/undefined properties cannot disappear.
      if (!validAction(action) && !validEdit(action)) return false;
      ownedAction = deepFreeze(
        JSON.parse(JSON.stringify(action)) as BoardSessionAction,
      );
      after = applySessionAction(this.canonical, before, ownedAction);
    } catch {
      return false;
    }
    if (JSON.stringify(after) === JSON.stringify(before)) return false;
    const actions = [...this.actions.slice(0, this.cursor), ownedAction];
    if (
      byteLength(JSON.stringify(encodeActions(this.canonical, actions))) >
      MAX_SAVED_BYTES - 256
    )
      return false;
    this.actions = actions;
    this.cursor = actions.length;
    this.workingBoard = after.board;
    this.selectedTabs = after.selectedTabs;
    this.save();
    return true;
  }

  previous(): boolean {
    if (!this.canPrevious) return false;
    this.cursor--;
    const state = replay(this.canonical, this.actions, this.cursor);
    this.workingBoard = state.board;
    this.selectedTabs = state.selectedTabs;
    this.save();
    return true;
  }

  next(): boolean {
    if (this.controlValue !== 'guided') return false;
    if (this.cursor < this.actions.length) {
      const state = applySessionAction(
        this.canonical,
        { board: this.workingBoard, selectedTabs: this.selectedTabs },
        this.actions[this.cursor],
      );
      this.workingBoard = state.board;
      this.selectedTabs = state.selectedTabs;
      this.cursor++;
      this.save();
      return true;
    }
    const action = this.nextCanonicalAction();
    return action ? this.dispatch(action) : false;
  }

  restart(): void {
    this.actions = [];
    this.cursor = 0;
    this.controlValue = 'guided';
    this.workingBoard = emptyFrom(this.canonical);
    this.selectedTabs = {};
    this.save();
  }

  takeControl(): void {
    this.controlValue = 'free';
    this.save();
  }
  resume(): void {
    this.controlValue = 'guided';
    this.save();
  }
}
