import type { Board, BoardCard } from './board';

/** These actions change only a visitor's working copy; the saved Board stays authoritative. */
export type BoardAction =
  | { readonly type: 'add-card'; readonly cardId: string; readonly toRow?: number; readonly toIndex?: number }
  | { readonly type: 'remove-card'; readonly cardId: string }
  | { readonly type: 'move-card'; readonly cardId: string; readonly toRow: number; readonly toIndex: number };

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

interface SavedSession {
  readonly version: 2;
  readonly revision: string;
  /** Action kind, canonical card index, target row and target position; no card contents or IDs. */
  readonly actions: readonly EncodedAction[];
  readonly cursor: number;
  readonly control: TutorialControl;
}

interface RestoredSession {
  readonly actions: readonly BoardAction[];
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

function canonicalCards(board: Board): Map<string, { card: BoardCard; row: number; index: number }> {
  if (!board.id || !board.title || (board.rows?.length ?? 0) > MAX_ROWS)
    throw new Error('This board cannot start a bounded tutorial.');
  const cards = new Map<string, { card: BoardCard; row: number; index: number }>();
  for (const [row, definition] of (board.rows ?? []).entries()) {
    for (const [index, card] of (definition.cards ?? []).entries()) {
      if (!card.id || cards.has(card.id) || cards.size >= MAX_CARDS)
        throw new Error('Tutorial cards need distinct IDs within the supported size.');
      cards.set(card.id, { card, row, index });
    }
  }
  return cards;
}

function canonicalWorkingBoard(canonical: Board, working: Board, cards: ReturnType<typeof canonicalCards>): Board {
  if (working.id !== canonical.id || (working.rows?.length ?? 0) !== (canonical.rows?.length ?? 0))
    throw new Error('Working board does not match the saved board.');
  const seen = new Set<string>();
  return { ...canonical, rows: (canonical.rows ?? []).map((row, index) => ({
    ...row,
    cards: (working.rows?.[index].cards ?? []).map((card) => {
      const saved = cards.get(card.id);
      if (!saved || seen.has(card.id)) throw new Error('Working board contains an unknown or repeated card.');
      seen.add(card.id);
      return saved.card;
    }),
  })) };
}

/** Preserve row layout and board metadata, but never copy canonical cards into the starting view. */
export function emptyTutorialBoard(canonical: Board): Board {
  return emptyFrom(cloneBoard(canonical));
}

function emptyFrom(canonical: Board): Board {
  canonicalCards(canonical);
  return { ...canonical, rows: (canonical.rows ?? []).map((row) => ({ ...row, cards: [] })) };
}

function location(board: Board, cardId: string): { row: number; index: number } | undefined {
  for (const [row, definition] of (board.rows ?? []).entries()) {
    const index = (definition.cards ?? []).findIndex((card) => card.id === cardId);
    if (index >= 0) return { row, index };
  }
  return undefined;
}

function insert(board: Board, card: BoardCard, row: number, index: number): Board {
  return { ...board, rows: (board.rows ?? []).map((definition, rowIndex) => rowIndex === row
    ? { ...definition, cards: [...(definition.cards ?? []).slice(0, index), card, ...(definition.cards ?? []).slice(index)] }
    : definition) };
}

function remove(board: Board, cardId: string): Board {
  return { ...board, rows: (board.rows ?? []).map((definition) => ({
    ...definition, cards: (definition.cards ?? []).filter((card) => card.id !== cardId),
  })) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPosition(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_CARDS;
}

function validAction(value: unknown): value is BoardAction {
  if (!isRecord(value) || typeof value['cardId'] !== 'string' || !value['cardId'] || value['cardId'].length > 256)
    return false;
  const keys = Object.keys(value);
  if (value['type'] === 'remove-card') return keys.every((key) => ['type', 'cardId'].includes(key));
  if (value['type'] === 'add-card')
    return keys.every((key) => ['type', 'cardId', 'toRow', 'toIndex'].includes(key)) &&
      (value['toRow'] === undefined || isPosition(value['toRow'])) &&
      (value['toIndex'] === undefined || isPosition(value['toIndex'])) &&
      (value['toRow'] !== undefined || value['toIndex'] === undefined);
  if (value['type'] === 'move-card')
    return keys.every((key) => ['type', 'cardId', 'toRow', 'toIndex'].includes(key)) &&
      isPosition(value['toRow']) && isPosition(value['toIndex']);
  return false;
}

/** Applies a standard board action using card definitions from the fetched saved board. */
export function applyBoardAction(canonical: Board, working: Board, action: BoardAction): Board {
  return applyFrom(cloneBoard(canonical), working, action);
}

function applyFrom(canonical: Board, working: Board, action: BoardAction): Board {
  if (!validAction(action))
    throw new Error('Invalid tutorial action or board identity.');
  const cards = canonicalCards(canonical);
  const source = cards.get(action.cardId);
  if (!source) throw new Error('The saved board has no such card.');
  const safeWorking = canonicalWorkingBoard(canonical, working, cards);
  const current = location(safeWorking, action.cardId);
  if (action.type === 'remove-card') {
    if (!current) throw new Error('The working board has no such card.');
    return remove(safeWorking, action.cardId);
  }
  if (action.type === 'move-card' && !current)
    throw new Error('Move requires a card already on the working board.');
  if (action.type === 'add-card' && current)
    throw new Error('The working board already contains this card.');
  const targetRow = action.toRow ?? source.row;
  const withoutCard = current ? remove(safeWorking, action.cardId) : safeWorking;
  const rows = withoutCard.rows ?? [];
  if (targetRow >= rows.length) throw new Error('Target row is outside the saved board.');
  const existing = rows[targetRow].cards ?? [];
  const defaultIndex = existing.filter((card) => {
    const candidate = cards.get(card.id);
    return candidate?.row === targetRow && candidate.index < source.index;
  }).length;
  const targetIndex = action.toIndex ?? defaultIndex;
  if (targetIndex > existing.length) throw new Error('Target position is outside the working row.');
  return insert(withoutCard, source.card, targetRow, targetIndex);
}

function replay(canonical: Board, actions: readonly BoardAction[], cursor: number): Board {
  return actions.slice(0, cursor).reduce((board, action) => applyFrom(canonical, board, action), emptyFrom(canonical));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function encodeActions(canonical: Board, actions: readonly BoardAction[]): EncodedAction[] {
  const indexes = new Map([...canonicalCards(canonical).keys()].map((id, index) => [id, index]));
  return actions.map((action) => {
    const index = indexes.get(action.cardId);
    if (index === undefined) throw new Error('Action card is missing from the saved board.');
    if (action.type === 'remove-card') return [1, index, -1, -1];
    if (action.type === 'move-card') return [2, index, action.toRow, action.toIndex];
    return [0, index, action.toRow ?? -1, action.toIndex ?? -1];
  });
}

function decodeAction(canonicalIds: readonly string[], value: unknown): BoardAction | undefined {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isSafeInteger)) return undefined;
  const [kind, index, row, position] = value as number[];
  const cardId = canonicalIds[index];
  if (!cardId || row < -1 || row >= MAX_ROWS || position < -1 || position > MAX_CARDS) return undefined;
  if (kind === 1 && row === -1 && position === -1) return { type: 'remove-card', cardId };
  if (kind === 0 && (row >= 0 || position === -1))
    return { type: 'add-card', cardId, ...(row >= 0 ? { toRow: row } : {}), ...(position >= 0 ? { toIndex: position } : {}) };
  if (kind === 2 && row >= 0 && position >= 0) return { type: 'move-card', cardId, toRow: row, toIndex: position };
  return undefined;
}

/** A digest of the full canonical definition invalidates stale session actions after a saved-board edit. */
export async function canonicalBoardRevision(board: Board): Promise<string> {
  canonicalCards(board);
  const bytes = new TextEncoder().encode(JSON.stringify(board));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseSaved(raw: string | null, revision: string, canonical: Board): RestoredSession | undefined {
  if (!raw || byteLength(raw) > MAX_SAVED_BYTES) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value['version'] !== 2 || value['revision'] !== revision ||
      !Array.isArray(value['actions']) || value['actions'].length > MAX_ACTIONS ||
      !Number.isSafeInteger(value['cursor']) ||
      Number(value['cursor']) < 0 || Number(value['cursor']) > value['actions'].length ||
      (value['control'] !== 'guided' && value['control'] !== 'free')) return undefined;
    const ids = [...canonicalCards(canonical).keys()];
    const actions = value['actions'].map((action) => decodeAction(ids, action));
    if (actions.some((action) => !action)) return undefined;
    replay(canonical, actions as BoardAction[], actions.length);
    return { actions: actions as BoardAction[], cursor: Number(value['cursor']), control: value['control'] };
  } catch {
    return undefined;
  }
}

/** The only mutable state is an action cursor and a bounded browser-session log. */
export class TutorialBoardSession {
  private actions: BoardAction[];
  private cursor: number;
  private controlValue: TutorialControl;

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
  }

  /** Pass sessionStorage or a test double. Never pass localStorage or another persistent store. */
  static async open(canonical: Board, scope: string, storage?: TutorialStorage): Promise<TutorialBoardSession> {
    if (!scope || scope.length > 512) throw new Error('Tutorial needs a project scope.');
    const snapshot = cloneBoard(canonical);
    const revision = await canonicalBoardRevision(snapshot);
    deepFreeze(snapshot);
    const key = JSON.stringify(['datatug-board-tutorial/1', scope, snapshot.id]);
    let raw: string | null = null;
    try { raw = storage?.getItem(key) ?? null; } catch { /* Session storage can be disabled. */ }
    const saved = parseSaved(raw, revision, snapshot);
    if (raw && !saved) {
      try { storage?.removeItem(key); } catch { /* Continue with an empty working board. */ }
    }
    return new TutorialBoardSession(snapshot, revision, key, storage, saved);
  }

  /** Browser entry point: storage expires with the tab's session; unavailable storage falls back to memory. */
  static async openBrowser(canonical: Board, scope: string): Promise<TutorialBoardSession> {
    let storage: TutorialStorage | undefined;
    try { storage = globalThis.sessionStorage; } catch { /* Private browsing may deny storage. */ }
    return this.open(canonical, scope, storage);
  }

  get board(): Board { return cloneBoard(replay(this.canonical, this.actions, this.cursor)); }
  get control(): TutorialControl { return this.controlValue; }
  get canPrevious(): boolean { return this.controlValue === 'guided' && this.cursor > 0; }
  get canNext(): boolean { return this.controlValue === 'guided' && (this.cursor < this.actions.length || !!this.nextCanonicalAction()); }
  get isComplete(): boolean { return !this.nextCanonicalAction(); }

  private save(): void {
    const state: SavedSession = { version: 2, revision: this.revision, actions: encodeActions(this.canonical, this.actions), cursor: this.cursor, control: this.controlValue };
    const json = JSON.stringify(state);
    if (byteLength(json) > MAX_SAVED_BYTES) throw new Error('Tutorial session exceeds its storage bound.');
    try { this.storage?.setItem(this.storageKey, json); } catch { /* Keep working in memory. */ }
  }

  private nextCanonicalAction(): BoardAction | undefined {
    const working = replay(this.canonical, this.actions, this.cursor);
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

  dispatch(action: BoardAction): boolean {
    if (this.cursor >= MAX_ACTIONS) return false;
    const before = replay(this.canonical, this.actions, this.cursor);
    let after: Board;
    try { after = applyFrom(this.canonical, before, action); } catch { return false; }
    if (JSON.stringify(after) === JSON.stringify(before)) return false;
    // Action fields are primitives; an owned frozen copy prevents caller mutation
    // from changing replay after the compact session log has been persisted.
    const ownedAction = Object.freeze({ ...action }) as BoardAction;
    const actions = [...this.actions.slice(0, this.cursor), ownedAction];
    if (byteLength(JSON.stringify(encodeActions(this.canonical, actions))) > MAX_SAVED_BYTES - 256) return false;
    this.actions = actions;
    this.cursor = actions.length;
    this.save();
    return true;
  }

  previous(): boolean {
    if (!this.canPrevious) return false;
    this.cursor--;
    this.save();
    return true;
  }

  next(): boolean {
    if (this.controlValue !== 'guided') return false;
    if (this.cursor < this.actions.length) {
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
    this.save();
  }

  takeControl(): void { this.controlValue = 'free'; this.save(); }
  resume(): void { this.controlValue = 'guided'; this.save(); }
}
