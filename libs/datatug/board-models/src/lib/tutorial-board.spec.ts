import { describe, expect, it, vi } from 'vitest';
import type { Board } from './board';
import { applyBoardAction, canonicalBoardRevision, emptyTutorialBoard, TutorialBoardSession, type TutorialStorage } from './tutorial-board';

const canonical: Board = {
  id: 'showcase', title: 'Saved showcase',
  rows: [
    { minHeight: '8rem', cards: [
      { id: 'orders', title: 'Orders', cols: 6, widget: { name: 'SQL', data: { sql: { queryId: 'demodb/orders' } } } },
      { id: 'countries', title: 'Countries', cols: 6, widget: { name: 'SQL', data: { sql: { queryId: 'demodb/countries' } } } },
    ] },
    { cards: [{ id: 'detail', title: 'Detail', cols: 12, widget: { name: 'tabs', data: { tabs: [] } } }] },
  ],
};

class MemoryStorage implements TutorialStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const ids = (board: Board): string[][] => (board.rows ?? []).map((row) => (row.cards ?? []).map((card) => card.id));

describe('canonical tutorial board actions', () => {
  it('starts empty while preserving the saved row shell and adds only canonical card definitions', () => {
    const initial = emptyTutorialBoard(canonical);
    expect(ids(initial)).toEqual([[], []]);
    expect(initial.rows?.[0].minHeight).toBe('8rem');
    const added = applyBoardAction(canonical, initial, { type: 'add-card', cardId: 'countries' });
    expect(ids(added)).toEqual([['countries'], []]);
    expect(added.rows?.[0].cards?.[0]).toEqual(canonical.rows?.[0].cards?.[1]);
    expect(ids(initial)).toEqual([[], []]);
  });

  it('moves and removes cards without changing the saved board or inventing content', () => {
    const a = applyBoardAction(canonical, emptyTutorialBoard(canonical), { type: 'add-card', cardId: 'orders' });
    const b = applyBoardAction(canonical, a, { type: 'add-card', cardId: 'detail', toRow: 0, toIndex: 1 });
    const c = applyBoardAction(canonical, b, { type: 'move-card', cardId: 'detail', toRow: 1, toIndex: 0 });
    const d = applyBoardAction(canonical, c, { type: 'remove-card', cardId: 'orders' });
    expect(ids(d)).toEqual([[], ['detail']]);
    expect(ids(canonical)).toEqual([['orders', 'countries'], ['detail']]);
    expect(() => applyBoardAction(canonical, d, { type: 'add-card', cardId: 'unknown' })).toThrow();
    expect(() => applyBoardAction(canonical, c, { type: 'add-card', cardId: 'detail' })).toThrow();
    expect(() => applyBoardAction(canonical, d, { type: 'move-card', cardId: 'orders', toRow: 4, toIndex: 0 })).toThrow();
    const forged: Board = { ...a, rows: [{ cards: [{ id: 'orders', title: 'Forged', widget: { name: 'SQL', data: { rows: ['fake'] } } }] }, { cards: [] }] };
    const sanitized = applyBoardAction(canonical, forged, { type: 'add-card', cardId: 'countries' });
    expect(sanitized.rows?.[0].cards?.[0]).toEqual(canonical.rows?.[0].cards?.[0]);
    const unknown: Board = { ...a, rows: [{ cards: [{ id: 'intruder', title: 'Intruder' }] }, { cards: [] }] };
    expect(() => applyBoardAction(canonical, unknown, { type: 'add-card', cardId: 'countries' })).toThrow();
  });
});

describe('TutorialBoardSession', () => {
  it('steps from the saved board in canonical order, then Previous/Next and Restart are deterministic', async () => {
    const storage = new MemoryStorage();
    const session = await TutorialBoardSession.open(canonical, 'project-a', storage);
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
    const first = await TutorialBoardSession.open(canonical, 'project-a', storage);
    first.next();
    first.takeControl();
    expect(first.next()).toBe(false);
    expect(first.dispatch({ type: 'add-card', cardId: 'detail', toRow: 0, toIndex: 1 })).toBe(true);
    const stored = storage.getItem(first.storageKey) ?? '';
    expect(JSON.parse(stored)).toMatchObject({ version: 2, actions: [[0, 0, 0, 0], [0, 2, 0, 1]] });
    expect(stored).not.toContain('demodb/orders');
    expect(stored).not.toContain('orders');
    expect(stored).not.toContain('detail');
    expect(stored).not.toContain('Saved showcase');
    const reopened = await TutorialBoardSession.open(canonical, 'project-a', storage);
    expect(reopened.control).toBe('free');
    expect(ids(reopened.board)).toEqual([['orders', 'detail'], []]);
    reopened.resume();
    expect(reopened.next()).toBe(true);
    expect(ids(reopened.board)).toEqual([['orders', 'countries', 'detail'], []]);
    expect(reopened.next()).toBe(true);
    expect(ids(reopened.board)).toEqual(ids(canonical));
    expect(reopened.isComplete).toBe(true);
  });

  it('invalidates stale or malformed logs, without trusting a forged card payload', async () => {
    const storage = new MemoryStorage();
    const first = await TutorialBoardSession.open(canonical, 'project-a', storage);
    first.next();
    const modified: Board = { ...canonical, title: 'Updated saved showcase' };
    expect(await canonicalBoardRevision(modified)).not.toBe(first.revision);
    const stale = await TutorialBoardSession.open(modified, 'project-a', storage);
    expect(ids(stale.board)).toEqual([[], []]);
    storage.setItem(stale.storageKey, JSON.stringify({ version: 2, revision: stale.revision,
      cursor: 1, control: 'guided', actions: [[0, 0, 0, 0, ['forged']]] }));
    const rejected = await TutorialBoardSession.open(modified, 'project-a', storage);
    expect(ids(rejected.board)).toEqual([[], []]);
    expect(storage.getItem(stale.storageKey)).toBeNull();
  });

  it('keeps project scopes separate and continues in memory when browser storage is denied', async () => {
    const storage = new MemoryStorage();
    const first = await TutorialBoardSession.open(canonical, 'project-a', storage);
    first.next();
    expect(ids((await TutorialBoardSession.open(canonical, 'project-b', storage)).board)).toEqual([[], []]);
    const denied: TutorialStorage = { getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    const inMemory = await TutorialBoardSession.open(canonical, 'project-a', denied);
    expect(inMemory.next()).toBe(true);
    expect(ids(inMemory.board)).toEqual([['orders'], []]);
  });

  it('completes a 200-card board with long IDs inside the fixed session byte bound', async () => {
    const large: Board = { id: 'large', title: 'Large', rows: [{ cards: Array.from({ length: 200 }, (_, index) => ({
      id: `card-${String(index).padStart(3, '0')}-${'x'.repeat(247)}`, title: `Card ${index}`,
    })) }] };
    const storage = new MemoryStorage();
    const session = await TutorialBoardSession.open(large, 'project-a', storage);
    for (let i = 0; i < 200; i++) {
      expect(session.canNext).toBe(true);
      expect(session.next()).toBe(true);
    }
    expect(session.isComplete).toBe(true);
    expect(session.canNext).toBe(false);
    expect(ids(session.board)).toEqual(ids(large));
    expect(new TextEncoder().encode(storage.getItem(session.storageKey) ?? '').length).toBeLessThan(16_384);
    expect(ids((await TutorialBoardSession.open(large, 'project-a', storage)).board)).toEqual(ids(large));
  });

  it('does not expose mutable references to canonical cards or session authority', async () => {
    const source: Board = JSON.parse(JSON.stringify(canonical)) as Board;
    const initial = emptyTutorialBoard(source);
    initial.rows?.[0].cards?.push({ id: 'invented', title: 'Invented' });
    expect(ids(source)).toEqual([['orders', 'countries'], ['detail']]);
    const applied = applyBoardAction(source, emptyTutorialBoard(source), { type: 'add-card', cardId: 'orders' });
    if (applied.rows?.[0].cards?.[0]) applied.rows[0].cards[0].title = 'Altered copy';
    expect(source.rows?.[0].cards?.[0].title).toBe('Orders');
    const session = await TutorialBoardSession.open(source, 'project-a');
    if (source.rows?.[0].cards?.[0]) source.rows[0].cards[0].title = 'Mutated source';
    expect(Reflect.set(session.canonical.rows?.[0].cards?.[0] ?? {}, 'title', 'Forged')).toBe(false);
    session.next();
    const exposed = session.board;
    if (exposed.rows?.[0].cards?.[0]) exposed.rows[0].cards[0].title = 'Changed view';
    expect(session.board.rows?.[0].cards?.[0].title).toBe('Orders');
    expect(session.canonical.rows?.[0].cards?.[0].title).toBe('Orders');
  });

  it('uses only the browser session store and starts fresh in a new browser session', async () => {
    const firstStorage = new MemoryStorage();
    vi.stubGlobal('sessionStorage', firstStorage);
    try {
      const first = await TutorialBoardSession.openBrowser(canonical, 'project-a');
      first.next();
      expect(ids((await TutorialBoardSession.openBrowser(canonical, 'project-a')).board)).toEqual([['orders'], []]);
      vi.stubGlobal('sessionStorage', new MemoryStorage());
      expect(ids((await TutorialBoardSession.openBrowser(canonical, 'project-a')).board)).toEqual([[], []]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
