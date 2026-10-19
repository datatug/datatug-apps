import { describe, expect, it, vi } from 'vitest';
import type { Board } from './board';
import {
  applyBoardAction,
  canonicalBoardRevision,
  emptyTutorialBoard,
  replayBoardActions,
  TutorialBoardSession,
  type BoardSessionAction,
  type TutorialStorage,
} from './tutorial-board';
import type { ChartWidgetDef } from './widget-chart';
import type { TabsWidgetDef } from './widget-tabs';

const canonical: Board = {
  id: 'showcase',
  title: 'Saved showcase',
  rows: [
    {
      minHeight: '8rem',
      cards: [
        {
          id: 'orders',
          title: 'Orders',
          cols: 6,
          widget: { name: 'SQL', data: { sql: { queryId: 'demodb/orders' } } },
        },
        {
          id: 'countries',
          title: 'Countries',
          cols: 6,
          widget: {
            name: 'SQL',
            data: { sql: { queryId: 'demodb/countries' } },
          },
        },
      ],
    },
    {
      cards: [
        {
          id: 'detail',
          title: 'Detail',
          cols: 12,
          widget: { name: 'tabs', data: { tabs: [] } },
        },
      ],
    },
  ],
};

class MemoryStorage implements TutorialStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const ids = (board: Board): string[][] =>
  (board.rows ?? []).map((row) => (row.cards ?? []).map((card) => card.id));

describe('canonical tutorial board actions', () => {
  it('starts empty while preserving the saved row shell and adds only canonical card definitions', () => {
    const initial = emptyTutorialBoard(canonical);
    expect(ids(initial)).toEqual([[], []]);
    expect(initial.rows?.[0].minHeight).toBe('8rem');
    const added = applyBoardAction(canonical, initial, {
      type: 'add-card',
      cardId: 'countries',
    });
    expect(ids(added)).toEqual([['countries'], []]);
    expect(added.rows?.[0].cards?.[0]).toEqual(canonical.rows?.[0].cards?.[1]);
    expect(ids(initial)).toEqual([[], []]);
  });

  it('moves and removes cards without changing the saved board or inventing content', () => {
    const a = applyBoardAction(canonical, emptyTutorialBoard(canonical), {
      type: 'add-card',
      cardId: 'orders',
    });
    const b = applyBoardAction(canonical, a, {
      type: 'add-card',
      cardId: 'detail',
      toRow: 0,
      toIndex: 1,
    });
    const c = applyBoardAction(canonical, b, {
      type: 'move-card',
      cardId: 'detail',
      toRow: 1,
      toIndex: 0,
    });
    const d = applyBoardAction(canonical, c, {
      type: 'remove-card',
      cardId: 'orders',
    });
    expect(ids(d)).toEqual([[], ['detail']]);
    expect(ids(canonical)).toEqual([['orders', 'countries'], ['detail']]);
    expect(() =>
      applyBoardAction(canonical, d, { type: 'add-card', cardId: 'unknown' }),
    ).toThrow();
    expect(() =>
      applyBoardAction(canonical, c, { type: 'add-card', cardId: 'detail' }),
    ).toThrow();
    expect(() =>
      applyBoardAction(canonical, d, {
        type: 'move-card',
        cardId: 'orders',
        toRow: 4,
        toIndex: 0,
      }),
    ).toThrow();
    const forged: Board = {
      ...a,
      rows: [
        {
          cards: [
            {
              id: 'orders',
              title: 'Forged',
              widget: { name: 'SQL', data: { rows: ['fake'] } },
            },
          ],
        },
        { cards: [] },
      ],
    };
    const sanitized = applyBoardAction(canonical, forged, {
      type: 'add-card',
      cardId: 'countries',
    });
    expect(sanitized.rows?.[0].cards?.[0]).toEqual(
      canonical.rows?.[0].cards?.[0],
    );
    const unknown: Board = {
      ...a,
      rows: [{ cards: [{ id: 'intruder', title: 'Intruder' }] }, { cards: [] }],
    };
    expect(() =>
      applyBoardAction(canonical, unknown, {
        type: 'add-card',
        cardId: 'countries',
      }),
    ).toThrow();
  });
});

describe('TutorialBoardSession', () => {
  it('steps from the saved board in canonical order, then Previous/Next and Restart are deterministic', async () => {
    const storage = new MemoryStorage();
    const session = await TutorialBoardSession.open(
      canonical,
      'project-a',
      storage,
    );
    expect(ids(session.board)).toEqual([[], []]);
    expect(session.canPrevious).toBe(false);
    expect(session.next()).toBe(true);
    expect(ids(session.board)).toEqual([['orders'], []]);
    expect(session.next()).toBe(true);
    expect(ids(session.board)).toEqual([['orders', 'countries'], []]);
    expect(session.previous()).toBe(true);
    expect(ids(session.board)).toEqual([['orders'], []]);
    expect(session.next()).toBe(true);
    expect(ids(session.board)).toEqual([['orders', 'countries'], []]);
    expect(session.next()).toBe(true);
    expect(ids(session.board)).toEqual(ids(canonical));
    expect(session.isComplete).toBe(true);
    expect(session.next()).toBe(false);
    session.restart();
    expect(ids(session.board)).toEqual([[], []]);
    expect(session.canPrevious).toBe(false);
  });

  it('stores bounded actions and revision only, and resumes a browser session without a saved-board copy', async () => {
    const storage = new MemoryStorage();
    const first = await TutorialBoardSession.open(
      canonical,
      'project-a',
      storage,
    );
    first.next();
    first.takeControl();
    expect(first.next()).toBe(false);
    expect(
      first.dispatch({
        type: 'add-card',
        cardId: 'detail',
        toRow: 0,
        toIndex: 1,
      }),
    ).toBe(true);
    const stored = storage.getItem(first.storageKey) ?? '';
    expect(JSON.parse(stored)).toMatchObject({
      version: 2,
      actions: [
        [0, 0, 0, 0],
        [0, 2, 0, 1],
      ],
    });
    expect(stored).not.toContain('demodb/orders');
    expect(stored).not.toContain('orders');
    expect(stored).not.toContain('detail');
    expect(stored).not.toContain('Saved showcase');
    const reopened = await TutorialBoardSession.open(
      canonical,
      'project-a',
      storage,
    );
    expect(reopened.control).toBe('free');
    expect(ids(reopened.board)).toEqual([['orders', 'detail'], []]);
    reopened.resume();
    expect(reopened.next()).toBe(true);
    expect(ids(reopened.board)).toEqual([
      ['orders', 'countries', 'detail'],
      [],
    ]);
    expect(reopened.next()).toBe(true);
    expect(ids(reopened.board)).toEqual(ids(canonical));
    expect(reopened.isComplete).toBe(true);
  });

  it('owns dispatched actions so later caller mutation cannot change replay or persisted state', async () => {
    const storage = new MemoryStorage();
    const session = await TutorialBoardSession.open(
      canonical,
      'project-a',
      storage,
    );
    const action = {
      type: 'add-card' as const,
      cardId: 'orders',
      toRow: 0,
      toIndex: 0,
    };
    expect(session.dispatch(action)).toBe(true);
    const persisted = storage.getItem(session.storageKey);
    action.cardId = 'detail';
    action.toRow = 1;
    expect(ids(session.board)).toEqual([['orders'], []]);
    expect(session.previous()).toBe(true);
    expect(session.next()).toBe(true);
    expect(ids(session.board)).toEqual([['orders'], []]);
    expect(storage.getItem(session.storageKey)).toBe(persisted);
    expect(
      ids(
        (await TutorialBoardSession.open(canonical, 'project-a', storage))
          .board,
      ),
    ).toEqual([['orders'], []]);
  });

  it('invalidates stale or malformed logs, without trusting a forged card payload', async () => {
    const storage = new MemoryStorage();
    const first = await TutorialBoardSession.open(
      canonical,
      'project-a',
      storage,
    );
    first.next();
    const modified: Board = { ...canonical, title: 'Updated saved showcase' };
    expect(await canonicalBoardRevision(modified)).not.toBe(first.revision);
    const stale = await TutorialBoardSession.open(
      modified,
      'project-a',
      storage,
    );
    expect(ids(stale.board)).toEqual([[], []]);
    storage.setItem(
      stale.storageKey,
      JSON.stringify({
        version: 2,
        revision: stale.revision,
        cursor: 1,
        control: 'guided',
        actions: [[0, 0, 0, 0, ['forged']]],
      }),
    );
    const rejected = await TutorialBoardSession.open(
      modified,
      'project-a',
      storage,
    );
    expect(ids(rejected.board)).toEqual([[], []]);
    expect(storage.getItem(stale.storageKey)).toBeNull();
  });

  it('keeps project scopes separate and continues in memory when browser storage is denied', async () => {
    const storage = new MemoryStorage();
    const first = await TutorialBoardSession.open(
      canonical,
      'project-a',
      storage,
    );
    first.next();
    expect(
      ids(
        (await TutorialBoardSession.open(canonical, 'project-b', storage))
          .board,
      ),
    ).toEqual([[], []]);
    const denied: TutorialStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const inMemory = await TutorialBoardSession.open(
      canonical,
      'project-a',
      denied,
    );
    expect(inMemory.next()).toBe(true);
    expect(ids(inMemory.board)).toEqual([['orders'], []]);
  });

  it('completes a 200-card board with long IDs inside the fixed session byte bound', async () => {
    const large: Board = {
      id: 'large',
      title: 'Large',
      rows: [
        {
          cards: Array.from({ length: 200 }, (_, index) => ({
            id: `card-${String(index).padStart(3, '0')}-${'x'.repeat(247)}`,
            title: `Card ${index}`,
          })),
        },
      ],
    };
    const storage = new MemoryStorage();
    const session = await TutorialBoardSession.open(
      large,
      'project-a',
      storage,
    );
    for (let i = 0; i < 200; i++) {
      expect(session.canNext).toBe(true);
      expect(session.next()).toBe(true);
    }
    expect(session.isComplete).toBe(true);
    expect(session.canNext).toBe(false);
    expect(ids(session.board)).toEqual(ids(large));
    expect(
      new TextEncoder().encode(storage.getItem(session.storageKey) ?? '')
        .length,
    ).toBeLessThan(16_384);
    expect(
      ids((await TutorialBoardSession.open(large, 'project-a', storage)).board),
    ).toEqual(ids(large));
  });

  it('does not expose mutable references to canonical cards or session authority', async () => {
    const source: Board = JSON.parse(JSON.stringify(canonical)) as Board;
    const initial = emptyTutorialBoard(source);
    initial.rows?.[0].cards?.push({ id: 'invented', title: 'Invented' });
    expect(ids(source)).toEqual([['orders', 'countries'], ['detail']]);
    const applied = applyBoardAction(source, emptyTutorialBoard(source), {
      type: 'add-card',
      cardId: 'orders',
    });
    if (applied.rows?.[0].cards?.[0])
      applied.rows[0].cards[0].title = 'Altered copy';
    expect(source.rows?.[0].cards?.[0].title).toBe('Orders');
    const session = await TutorialBoardSession.open(source, 'project-a');
    if (source.rows?.[0].cards?.[0])
      source.rows[0].cards[0].title = 'Mutated source';
    expect(
      Reflect.set(
        session.canonical.rows?.[0].cards?.[0] ?? {},
        'title',
        'Forged',
      ),
    ).toBe(false);
    session.next();
    const exposed = session.board;
    if (exposed.rows?.[0].cards?.[0])
      exposed.rows[0].cards[0].title = 'Changed view';
    expect(session.board.rows?.[0].cards?.[0].title).toBe('Orders');
    expect(session.canonical.rows?.[0].cards?.[0].title).toBe('Orders');
  });

  it('uses only the browser session store and starts fresh in a new browser session', async () => {
    const firstStorage = new MemoryStorage();
    vi.stubGlobal('sessionStorage', firstStorage);
    try {
      const first = await TutorialBoardSession.openBrowser(
        canonical,
        'project-a',
      );
      first.next();
      expect(
        ids(
          (await TutorialBoardSession.openBrowser(canonical, 'project-a'))
            .board,
        ),
      ).toEqual([['orders'], []]);
      vi.stubGlobal('sessionStorage', new MemoryStorage());
      expect(
        ids(
          (await TutorialBoardSession.openBrowser(canonical, 'project-a'))
            .board,
        ),
      ).toEqual([[], []]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

const editable: Board = {
  id: 'editable',
  title: 'Canonical editable board',
  rows: [
    {
      cards: [
        {
          id: 'tabs',
          title: 'Inspector',
          widget: {
            name: 'tabs',
            data: {
              tabs: [
                {
                  id: 'orders',
                  title: 'Data',
                  widget: {
                    name: 'SQL',
                    data: { sql: { queryId: 'demodb/orders' } },
                  },
                },
                {
                  id: 'nested',
                  title: 'Data',
                  widget: {
                    name: 'tabs',
                    data: {
                      tabs: [
                        {
                          title: 'Legacy',
                          widget: {
                            name: 'SQL',
                            data: { sql: { queryId: 'demodb/countries' } },
                          },
                        },
                      ],
                    },
                  },
                },
                {
                  id: 'http',
                  title: 'Request',
                  widget: { name: 'HTTP', data: {} },
                },
              ],
            },
          },
        },
        {
          id: 'chart',
          title: 'Countries',
          widget: {
            name: 'chart',
            data: {
              sources: [{ id: 'countries', queryId: 'demodb/countries' }],
              chart: {
                type: 'bar',
                categoryColumn: 'country',
                valueColumn: 'orders',
                unit: 'orders',
              },
              defaultView: 'chart',
            },
          },
        },
        {
          id: 'race',
          title: 'Race',
          widget: {
            name: 'chart',
            data: {
              sources: [
                {
                  id: 'orders',
                  queryId: 'demodb/orders',
                  transform: {
                    name: 'orders-monthly-country-count',
                    orderIdColumn: 'OrderID',
                    dateColumn: 'OrderDate',
                    countryColumn: 'ShipCountry',
                  },
                },
              ],
              chart: {
                type: 'bar-race',
                categoryColumn: 'category',
                valueColumn: 'value',
                periodColumn: 'period',
                unit: 'orders',
                grain: 'month',
                onDuplicate: 'reject',
                mode: 'period',
                topN: 10,
              },
            },
          },
        },
      ],
    },
  ],
};
const reveal: BoardSessionAction[] = ['tabs', 'chart', 'race'].map(
  (cardId) => ({ type: 'add-card', cardId }),
);
const cardWidget = (board: Board, cardId: string) =>
  board.rows
    ?.flatMap((row) => row.cards ?? [])
    .find((card) => card.id === cardId)?.widget;
const chartData = (board: Board, cardId = 'chart') =>
  cardWidget(board, cardId)?.data as ChartWidgetDef;
const tabData = (board: Board) =>
  cardWidget(board, 'tabs')?.data as TabsWidgetDef;
const unsafeAction = (action: unknown) => action as BoardSessionAction;

describe('standard session editing actions', () => {
  it('replays tab addition, query binding, selection, reordering and removal without changing canonical data', () => {
    const original = JSON.stringify(editable);
    const actions: BoardSessionAction[] = [
      ...reveal,
      {
        type: 'add-tab',
        cardId: 'tabs',
        tabId: 'new',
        title: 'Data',
        queryId: 'demodb/countries',
        toIndex: 1,
      },
      { type: 'select-tab', cardId: 'tabs', tabKey: 'id:new' },
      {
        type: 'set-tab-query',
        cardId: 'tabs',
        tabKey: 'id:new',
        queryId: 'demodb/orders',
      },
      { type: 'reorder-tab', cardId: 'tabs', tabKey: 'id:new', toIndex: 0 },
    ];
    const edited = replayBoardActions(editable, actions);
    expect(tabData(edited.board).tabs.map((tab) => tab.id)).toEqual([
      'new',
      'orders',
      'nested',
      'http',
    ]);
    expect(tabData(edited.board).tabs[0].widget?.data).toEqual({
      sql: { queryId: 'demodb/orders' },
    });
    expect(edited.selectedTabs[JSON.stringify(['tabs'])]).toBe('id:new');
    expect(edited.board).not.toHaveProperty('selectedTabs');
    const removed = replayBoardActions(editable, [
      ...actions,
      { type: 'remove-tab', cardId: 'tabs', tabKey: 'id:new' },
    ]);
    expect(tabData(removed.board).tabs).toHaveLength(3);
    expect(removed.selectedTabs).toEqual({});
    expect(JSON.stringify(editable)).toBe(original);
    expect(() =>
      replayBoardActions(
        editable,
        [
          ...actions,
          { type: 'remove-tab', cardId: 'tabs', tabKey: 'id:missing' },
        ],
        0,
      ),
    ).toThrow();
  });

  it('edits nested legacy tabs with exact positional keys and refuses ambiguous stable IDs or unsupported widgets', () => {
    const nested: BoardSessionAction[] = [
      ...reveal,
      {
        type: 'set-tab-query',
        cardId: 'tabs',
        widgetPath: ['id:nested'],
        tabKey: 'legacy:0:Legacy',
        queryId: 'demodb/orders',
      },
      {
        type: 'select-tab',
        cardId: 'tabs',
        widgetPath: ['id:nested'],
        tabKey: 'legacy:0:Legacy',
      },
    ];
    const state = replayBoardActions(editable, nested);
    const data = tabData(state.board).tabs[1].widget?.data as TabsWidgetDef;
    expect(data.tabs[0].widget?.data).toEqual({
      sql: { queryId: 'demodb/orders' },
    });
    expect(state.selectedTabs[JSON.stringify(['tabs', 'id:nested'])]).toBe(
      'legacy:0:Legacy',
    );
    expect(() =>
      replayBoardActions(editable, [
        ...reveal,
        {
          type: 'set-tab-query',
          cardId: 'tabs',
          tabKey: 'id:http',
          queryId: 'demodb/orders',
        },
      ]),
    ).toThrow(/SQL widgets/);
    expect(() =>
      replayBoardActions(editable, [
        ...reveal,
        {
          type: 'set-tab-query',
          cardId: 'tabs',
          widgetPath: ['id:nested'],
          tabKey: 'legacy:0:Renamed',
          queryId: 'demodb/orders',
        },
      ]),
    ).toThrow();
    const duplicate = structuredClone(editable);
    tabData(duplicate).tabs[1].id = 'orders';
    expect(() =>
      replayBoardActions(duplicate, [
        ...reveal,
        { type: 'select-tab', cardId: 'tabs', tabKey: 'id:orders' },
      ]),
    ).toThrow(/distinct stable IDs/);
  });

  it('persists edits separately from old reveal logs and restores selection, undo, redo and deep-owned chart settings', async () => {
    const storage = new MemoryStorage();
    const session = await TutorialBoardSession.open(
      editable,
      'project',
      storage,
    );
    for (const action of reveal) expect(session.dispatch(action)).toBe(true);
    expect(JSON.parse(storage.getItem(session.storageKey) ?? '').version).toBe(
      2,
    );
    const spec = {
      type: 'bar' as const,
      categoryColumn: 'country',
      valueColumn: 'orders',
      unit: 'count',
    };
    expect(
      session.dispatch({ type: 'set-chart-spec', cardId: 'chart', spec }),
    ).toBe(true);
    spec.unit = 'forged after dispatch';
    expect(
      session.dispatch({
        type: 'select-tab',
        cardId: 'tabs',
        tabKey: 'id:nested',
      }),
    ).toBe(true);
    expect(session.selectedTab('tabs')).toBe('id:nested');
    expect(session.previous()).toBe(true);
    expect(session.selectedTab('tabs')).toBeUndefined();
    expect(session.next()).toBe(true);
    expect(session.selectedTab('tabs')).toBe('id:nested');
    const stored = storage.getItem(session.storageKey) ?? '';
    expect(JSON.parse(stored).version).toBe(3);
    expect(stored).not.toContain('demodb/');
    const restored = await TutorialBoardSession.open(
      editable,
      'project',
      storage,
    );
    expect(chartData(restored.board).chart.unit).toBe('count');
    expect(restored.presentation).toEqual(session.presentation);
    expect(restored.board).toEqual(session.board);
    restored.restart();
    expect(restored.presentation).toEqual({});
    expect(ids(restored.board)).toEqual([[]]);
  });

  it('preserves authored widgets through later card movement and reveal while keeping the legacy sanitizer', () => {
    const actions: BoardSessionAction[] = [
      reveal[0],
      {
        type: 'add-tab',
        cardId: 'tabs',
        tabId: 'new',
        title: 'Second query',
        queryId: 'demodb/countries',
      },
      reveal[1],
      { type: 'move-card', cardId: 'tabs', toRow: 0, toIndex: 1 },
      reveal[2],
    ];
    expect(
      tabData(replayBoardActions(editable, actions).board).tabs,
    ).toHaveLength(4);
    const externallyChanged = replayBoardActions(editable, actions).board;
    tabData(externallyChanged).tabs.push({ id: 'forged', title: 'Forged' });
    expect(
      tabData(
        applyBoardAction(editable, externallyChanged, {
          type: 'remove-card',
          cardId: 'chart',
        }),
      ).tabs,
    ).toHaveLength(3);
  });

  it('adds independently identified saved sources to bars and changes only working-copy chart presentation', () => {
    const actions: BoardSessionAction[] = [
      ...reveal,
      {
        type: 'add-chart-source',
        cardId: 'chart',
        sourceId: 'orders-second',
        queryId: 'demodb/orders',
      },
      { type: 'set-view', cardId: 'chart', view: 'grid' },
    ];
    const twoSources = replayBoardActions(editable, actions).board;
    expect(chartData(twoSources).sources).toEqual([
      { id: 'countries', queryId: 'demodb/countries' },
      { id: 'orders-second', queryId: 'demodb/orders' },
    ]);
    expect(chartData(twoSources).defaultView).toBe('grid');
    expect(chartData(editable).sources).toHaveLength(1);
    const removed = replayBoardActions(editable, [
      ...actions,
      { type: 'remove-chart-source', cardId: 'chart', sourceId: 'countries' },
    ]).board;
    expect(chartData(removed).sources.map((source) => source.id)).toEqual([
      'orders-second',
    ]);
    expect(() =>
      replayBoardActions(editable, [
        ...actions,
        { type: 'remove-chart-source', cardId: 'chart', sourceId: 'countries' },
        {
          type: 'remove-chart-source',
          cardId: 'chart',
          sourceId: 'orders-second',
        },
      ]),
    ).toThrow(/Invalid chart configuration/);
    expect(() =>
      replayBoardActions(editable, [
        ...reveal,
        {
          type: 'add-chart-source',
          cardId: 'race',
          sourceId: 'second',
          queryId: 'demodb/countries',
        },
      ]),
    ).toThrow(/one source for a bar race/);
    expect(() =>
      replayBoardActions(editable, [
        ...reveal,
        {
          type: 'set-chart-spec',
          cardId: 'race',
          spec: {
            type: 'bar',
            categoryColumn: 'category',
            valueColumn: 'value',
          },
        },
      ]),
    ).toThrow(/canonical race mapping/);
  });

  it('rejects forged query bindings, duplicate identities, invalid settings, paths and unknown payload fields without changing state', async () => {
    const session = await TutorialBoardSession.open(editable, 'project');
    for (const action of reveal) session.dispatch(action);
    const before = session.board;
    const malformed = [
      {
        type: 'add-tab',
        cardId: 'tabs',
        tabId: 'orders',
        title: 'Duplicate',
        queryId: 'demodb/orders',
      },
      {
        type: 'add-tab',
        cardId: 'tabs',
        tabId: 'new',
        title: 'New',
        queryId: 'unlisted/query',
      },
      {
        type: 'add-tab',
        cardId: 'tabs',
        tabId: 'new',
        title: 'New',
        queryId: 'demodb/orders',
        rows: [],
      },
      {
        type: 'set-tab-query',
        cardId: 'tabs',
        tabKey: 'id:orders',
        queryId: 'demodb/countries',
        queryText: 'select 1',
      },
      {
        type: 'select-tab',
        cardId: 'tabs',
        widgetPath: Array(9).fill('id:nested'),
        tabKey: 'id:orders',
      },
      { type: 'select-tab', cardId: 'chart', tabKey: 'id:orders' },
      { type: 'reorder-tab', cardId: 'tabs', tabKey: 'id:orders', toIndex: 99 },
      {
        type: 'add-chart-source',
        cardId: 'chart',
        sourceId: 'countries',
        queryId: 'demodb/orders',
      },
      {
        type: 'add-chart-source',
        cardId: 'chart',
        sourceId: 'duplicate-query',
        queryId: 'demodb/countries',
      },
      { type: 'set-view', cardId: 'chart', view: 'iframe' },
      {
        type: 'set-chart-spec',
        cardId: 'chart',
        spec: { type: 'bar', categoryColumn: 'same', valueColumn: 'same' },
      },
      {
        type: 'set-chart-spec',
        cardId: 'chart',
        spec: {
          type: 'bar',
          categoryColumn: 'country',
          valueColumn: 'orders',
          data: [42],
        },
      },
      {
        type: 'set-chart-spec',
        cardId: 'chart',
        spec: {
          type: 'bar-race',
          categoryColumn: 'country',
          valueColumn: 'orders',
          periodColumn: 'month',
          unit: 'orders',
          grain: 'month',
          onDuplicate: 'reject',
          mode: 'period',
          topN: 101,
        },
      },
      { type: 'remove-chart-source', cardId: 'chart', sourceId: 'missing' },
    ];
    for (const action of malformed) {
      expect(
        session.dispatch(unsafeAction(action)),
        JSON.stringify(action),
      ).toBe(false);
      expect(session.board).toEqual(before);
    }
  });

  it('rejects forged persisted edit envelopes and saved-query indexes including invalid redo tails', async () => {
    const storage = new MemoryStorage();
    const first = await TutorialBoardSession.open(editable, 'project', storage);
    first.dispatch(reveal[0]);
    first.dispatch({
      type: 'add-tab',
      cardId: 'tabs',
      tabId: 'new',
      title: 'New',
      queryId: 'demodb/countries',
    });
    const saved = JSON.parse(storage.getItem(first.storageKey) ?? '');
    for (const payload of [
      { tabId: 'new', title: 'New', queryIndex: 999 },
      { tabId: 'new', title: 'New', queryIndex: 0, type: 'remove-card' },
      { tabId: 'new', title: 'New', queryIndex: 0, rows: ['forged'] },
      { tabId: 'new', title: 'New', queryId: 'demodb/countries' },
    ]) {
      const forged = structuredClone(saved);
      forged.cursor = 1;
      forged.actions[1][3] = payload;
      storage.setItem(first.storageKey, JSON.stringify(forged));
      const restored = await TutorialBoardSession.open(
        editable,
        'project',
        storage,
      );
      expect(ids(restored.board)).toEqual([[]]);
      expect(storage.getItem(first.storageKey)).toBeNull();
    }
  });

  it('refuses action-count overflow atomically and enables redo after stepping back from the limit', async () => {
    const storage = new MemoryStorage();
    const session = await TutorialBoardSession.open(
      editable,
      'project',
      storage,
    );
    expect(session.dispatch(reveal[1])).toBe(true);
    for (let index = 0; index < 255; index++)
      expect(
        session.dispatch({
          type: 'set-view',
          cardId: 'chart',
          view: index % 2 ? 'chart' : 'grid',
        }),
      ).toBe(true);
    const before = storage.getItem(session.storageKey);
    expect(session.canNext).toBe(false);
    expect(session.canAppendAction).toBe(false);
    expect(session.next()).toBe(false);
    expect(session.dispatch(reveal[0])).toBe(false);
    expect(storage.getItem(session.storageKey)).toBe(before);
    expect(session.previous()).toBe(true);
    expect(session.canNext).toBe(true);
    expect(session.canAppendAction).toBe(true);
    expect(session.next()).toBe(true);
    expect(storage.getItem(session.storageKey)).toBe(before);
  });

  it('refuses session byte overflow without mutating the board or its persisted cursor', async () => {
    const storage = new MemoryStorage();
    const session = await TutorialBoardSession.open(
      editable,
      'project',
      storage,
    );
    session.dispatch(reveal[0]);
    let refused = false;
    for (let index = 0; index < 255; index++) {
      const before = session.board;
      const saved = storage.getItem(session.storageKey);
      if (
        !session.dispatch({
          type: 'add-tab',
          cardId: 'tabs',
          tabId: `new-${index}`,
          title: 'x'.repeat(256),
          queryId: 'demodb/orders',
        })
      ) {
        expect(session.board).toEqual(before);
        expect(storage.getItem(session.storageKey)).toBe(saved);
        refused = true;
        break;
      }
    }
    expect(refused).toBe(true);
    expect(
      new TextEncoder().encode(storage.getItem(session.storageKey) ?? '')
        .length,
    ).toBeLessThan(16_384);
    expect(
      (await TutorialBoardSession.open(editable, 'project', storage)).board,
    ).toEqual(session.board);
  });
});

describe('tutorial-only held presentation views', () => {
  it('replays trend/rows/race without modifying the Board wire, preserves old set-view and restores the cursor', async () => {
    const storage = new MemoryStorage();
    const session = await TutorialBoardSession.open(
      editable,
      'presentation',
      storage,
    );
    for (const action of reveal) session.dispatch(action);
    const before = JSON.stringify(session.board);
    expect(
      session.dispatch({
        type: 'set-presentation-view',
        cardId: 'race',
        view: 'trend',
      }),
    ).toBe(true);
    expect(session.presentationView('race')).toBe('trend');
    expect(JSON.stringify(session.board)).toBe(before);
    const restored = await TutorialBoardSession.open(
      editable,
      'presentation',
      storage,
    );
    expect(restored.presentationView('race')).toBe('trend');
    expect(
      restored.dispatch({
        type: 'set-presentation-view',
        cardId: 'race',
        view: 'grid',
      }),
    ).toBe(true);
    expect(restored.presentationView('race')).toBe('grid');
    expect(restored.previous()).toBe(true);
    expect(restored.presentationView('race')).toBe('trend');
    expect(restored.next()).toBe(true);
    expect(
      restored.dispatch({
        type: 'set-presentation-view',
        cardId: 'race',
        view: 'chart',
      }),
    ).toBe(true);
    expect(JSON.stringify(restored.board)).toBe(before);
    expect(
      restored.dispatch({ type: 'set-view', cardId: 'chart', view: 'grid' }),
    ).toBe(true);
    expect(chartData(restored.board).defaultView).toBe('grid');
    expect(restored.dispatch({ type: 'remove-card', cardId: 'race' })).toBe(
      true,
    );
    expect(restored.presentationView('race')).toBeUndefined();
    restored.restart();
    expect(restored.presentationView('race')).toBeUndefined();
  });

  it('lets a Result view edit supersede only its guided overlay and replays that choice', async () => {
    const storage = new MemoryStorage();
    const session = await TutorialBoardSession.open(
      editable,
      'view-edit',
      storage,
    );
    for (const action of reveal) session.dispatch(action);
    session.dispatch({
      type: 'set-presentation-view',
      cardId: 'race',
      view: 'trend',
    });
    session.dispatch({
      type: 'set-presentation-view',
      cardId: 'chart',
      view: 'grid',
    });
    expect(
      session.dispatch({ type: 'set-view', cardId: 'race', view: 'grid' }),
    ).toBe(true);
    expect(session.presentationView('race')).toBeUndefined();
    expect(session.presentationView('chart')).toBe('grid');
    expect(session.previous()).toBe(true);
    expect(session.presentationView('race')).toBe('trend');
    expect(session.next()).toBe(true);
    expect(session.presentationView('race')).toBeUndefined();
    const restored = await TutorialBoardSession.open(
      editable,
      'view-edit',
      storage,
    );
    expect(restored.presentationView('race')).toBeUndefined();
    expect(restored.presentationView('chart')).toBe('grid');
    const race = restored.board.rows
      ?.flatMap((row) => row.cards ?? [])
      .find((card) => card.id === 'race');
    expect((race?.widget?.data as ChartWidgetDef).defaultView).toBe('grid');
  });

  it('clears an edited nested view without clearing its sibling or another card', async () => {
    const race = editable.rows
      ?.flatMap((row) => row.cards ?? [])
      .find((card) => card.id === 'race');
    if (!race?.widget) throw new Error('Missing race fixture');
    const board: Board = {
      ...editable,
      rows: [
        ...(editable.rows ?? []),
        {
          cards: [
            {
              id: 'nested',
              widget: {
                name: 'tabs',
                data: {
                  tabs: [
                    { id: 'left', title: 'Left', widget: race.widget },
                    { id: 'right', title: 'Right', widget: race.widget },
                  ],
                },
              },
            },
          ],
        },
      ],
    };
    const before = JSON.stringify(board);
    const session = await TutorialBoardSession.open(board, 'nested-view-edit');
    for (const action of reveal) session.dispatch(action);
    session.dispatch({ type: 'add-card', cardId: 'nested' });
    session.dispatch({
      type: 'set-presentation-view',
      cardId: 'race',
      view: 'trend',
    });
    session.dispatch({
      type: 'set-presentation-view',
      cardId: 'nested',
      widgetPath: ['id:left'],
      view: 'grid',
    });
    session.dispatch({
      type: 'set-presentation-view',
      cardId: 'nested',
      widgetPath: ['id:right'],
      view: 'trend',
    });
    expect(
      session.dispatch({
        type: 'set-view',
        cardId: 'nested',
        widgetPath: ['id:left'],
        view: 'chart',
      }),
    ).toBe(true);
    expect(session.presentationView('nested', ['id:left'])).toBeUndefined();
    expect(session.presentationView('nested', ['id:right'])).toBe('trend');
    expect(session.presentationView('race')).toBe('trend');
    expect(JSON.stringify(board)).toBe(before);
  });

  it('rejects unsupported or forged presentation views and requires a present raw Orders race for trend', async () => {
    const session = await TutorialBoardSession.open(editable, 'presentation');
    expect(
      session.dispatch({
        type: 'set-presentation-view',
        cardId: 'race',
        view: 'trend',
      }),
    ).toBe(false);
    for (const action of reveal) session.dispatch(action);
    expect(
      session.dispatch({
        type: 'set-presentation-view',
        cardId: 'chart',
        view: 'trend',
      }),
    ).toBe(false);
    expect(
      session.dispatch(
        unsafeAction({
          type: 'set-presentation-view',
          cardId: 'race',
          view: 'javascript',
        }),
      ),
    ).toBe(false);
    expect(
      session.dispatch(
        unsafeAction({
          type: 'set-presentation-view',
          cardId: 'race',
          view: 'trend',
          unknown: true,
        }),
      ),
    ).toBe(false);
    expect(session.presentationView('constructor')).toBeUndefined();
  });
});
