import { CHINOOK_SCHEMA } from './chat.types';

export type ChatWorkspaceTab = 'project' | 'selected' | 'docked' | 'bookmarks';
export type ChatContextKind = 'project' | 'source' | 'table' | 'query' | 'recordset' | 'view' | 'selection' | 'bookmark';

export interface ChatContextReference {
  readonly kind: ChatContextKind;
  readonly projectId: string;
  readonly sourceId?: string;
  readonly objectId: string;
  readonly title: string;
}

export interface ChatRecordSetView {
  readonly id: string;
  readonly recordSetId: string;
  readonly title: string;
  /** Coordinates in the immutable source RecordSet, even after grid sorting. */
  readonly rowIndices: readonly number[];
  readonly columns: readonly string[];
  readonly createdAt: string;
}

export interface ChatCellRange {
  /** Exact source coordinates, which need not be contiguous after a grid sort. */
  readonly rowIndices: readonly number[];
  readonly columns: readonly string[];
}

export interface ChatSelection {
  readonly id: string;
  readonly viewId: string;
  readonly title: string;
  readonly rows: readonly number[];
  readonly columns: readonly string[];
  readonly ranges: readonly ChatCellRange[];
  readonly createdAt: string;
}

export interface ChatDock {
  readonly id: string;
  readonly reference: ChatContextReference;
  readonly title: string;
}

export interface ChatWorkspaceState {
  readonly views: Readonly<Record<string, ChatRecordSetView>>;
  readonly selections: Readonly<Record<string, ChatSelection>>;
  readonly attachments: readonly ChatContextReference[];
  readonly docks: readonly ChatDock[];
  readonly currentSelectionId?: string;
  readonly activeTab: ChatWorkspaceTab;
}

export interface ChatRecordSetData {
  readonly id: string;
  readonly source: string;
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
}

/** A project-owned, self-contained copy.  It deliberately never points at a session. */
export interface ChatBookmark {
  readonly id: string;
  readonly scope: string;
  readonly projectId: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly target: 'recordset' | 'view' | 'selection';
  readonly recordSet: ChatRecordSetData;
  readonly view?: ChatRecordSetView;
  readonly selection?: ChatSelection;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One effective snapshot view for display and local follow-up binding. */
export function chatBookmarkRows(bookmark: ChatBookmark): readonly Record<string, unknown>[] {
  const { selection, view, recordSet } = bookmark;
  const indices = selection?.rows || view?.rowIndices || recordSet.rows.map((_, index) => index);
  const columns = selection?.columns || view?.columns || recordSet.columns;
  const cells = selection?.ranges.length ? new Set(selection.ranges.flatMap((range) =>
    range.rowIndices.flatMap((row) => range.columns.map((column) => `${row}\u0000${column}`)))) : undefined;
  return indices.flatMap((index) => {
    const row = recordSet.rows[index];
    if (!row) return [];
    return [Object.fromEntries(columns.filter((column) => !cells || cells.has(`${index}\u0000${column}`))
      .map((column) => [column, row[column]]))];
  });
}

export type ChatWorkspaceAction =
  | { readonly kind: 'select'; readonly recordSetId: string; readonly viewId?: string; readonly rows?: readonly number[];
      readonly column?: string; readonly equals?: string; readonly contains?: string; readonly orderBy?: string;
      readonly descending?: boolean; readonly limit?: number; readonly columns?: readonly string[];
      readonly ranges?: readonly ChatCellRange[]; readonly title?: string }
  | { readonly kind: 'attach' | 'detach' | 'dock'; readonly reference: ChatContextReference; readonly title?: string }
  | { readonly kind: 'dockCurrent'; readonly title?: string }
  | { readonly kind: 'undock'; readonly dockId: string }
  | { readonly kind: 'bookmark'; readonly reference: ChatContextReference; readonly title?: string; readonly tags?: readonly string[] }
  | { readonly kind: 'renameBookmark'; readonly bookmarkId: string; readonly title: string }
  | { readonly kind: 'addBookmarkTag' | 'removeBookmarkTag'; readonly bookmarkId: string; readonly tag: string }
  | { readonly kind: 'deleteBookmark'; readonly bookmarkId: string }
  | { readonly kind: 'focusSelection'; readonly selectionId: string }
  | { readonly kind: 'sortView'; readonly viewId: string; readonly column: string; readonly descending?: boolean }
  | { readonly kind: 'clearSelection' }
  | { readonly kind: 'setTab'; readonly tab: ChatWorkspaceTab };

export interface ChatWorkspaceResult {
  readonly state: ChatWorkspaceState;
  readonly reference?: ChatContextReference;
}

export const emptyChatWorkspace = (): ChatWorkspaceState => ({
  views: {}, selections: {}, attachments: [], docks: [], activeTab: 'project',
});

function sameReference(a: ChatContextReference, b: ChatContextReference): boolean {
  return a.kind === b.kind && a.projectId === b.projectId && a.sourceId === b.sourceId && a.objectId === b.objectId;
}

function projectIdFromScope(scope: string): string {
  try {
    const parts = JSON.parse(scope) as unknown;
    if (Array.isArray(parts) && typeof parts[1] === 'string') return parts[1];
  } catch { /* Invalid scopes cannot own project references. */ }
  throw new Error('The chat project identity is invalid.');
}

function validateReference(
  scope: string, state: ChatWorkspaceState, records: ReadonlyMap<string, ChatRecordSetData>, ref: ChatContextReference,
): void {
  const projectId = projectIdFromScope(scope);
  if (ref.projectId !== projectId || !ref.objectId || typeof ref.objectId !== 'string' || ref.objectId.length > 200 ||
      typeof ref.title !== 'string' || !ref.title || ref.title.length > 100) {
    throw new Error('This context object is not in the current project.');
  }
  switch (ref.kind) {
    case 'project':
      if (ref.objectId !== projectId) throw new Error('This project is unavailable.');
      return;
    case 'source':
      if (projectId !== 'datatug-demo-project' || ref.sourceId !== 'chinook' || ref.objectId !== 'chinook') {
        throw new Error('This data source is unavailable.');
      }
      return;
    case 'table':
      if (projectId !== 'datatug-demo-project' || ref.sourceId !== 'chinook' ||
          !CHINOOK_SCHEMA.tables.some((table) => `${table.schema}.${table.name}` === ref.objectId)) {
        throw new Error('This table is unavailable in the current data source.');
      }
      return;
    case 'recordset':
      if (!records.has(ref.objectId)) throw new Error('The referenced RecordSet is unavailable.');
      return;
    case 'view':
      if (!state.views[ref.objectId]) throw new Error('The referenced View is unavailable.');
      return;
    case 'selection':
      if (!state.selections[ref.objectId]) throw new Error('The referenced Selection is unavailable.');
      return;
    case 'bookmark':
      if (!records.has(ref.objectId)) throw new Error('The referenced Bookmark is unavailable.');
      return;
    case 'query':
      throw new Error('This project does not expose saved queries to Chat yet.');
  }
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return scalarText(left).localeCompare(scalarText(right), undefined, { numeric: true, sensitivity: 'base' });
}

function select(
  scope: string, state: ChatWorkspaceState, records: ReadonlyMap<string, ChatRecordSetData>,
  action: Extract<ChatWorkspaceAction, { kind: 'select' }>,
): ChatWorkspaceResult {
  const record = records.get(action.recordSetId);
  if (!record || record.source !== `${scope}/chinook`) throw new Error('The selected RecordSet is unavailable in this project.');
  const parent = action.viewId ? state.views[action.viewId] : undefined;
  if (action.viewId && (!parent || parent.recordSetId !== record.id)) throw new Error('The selected View is unavailable.');
  const allowed = parent?.rowIndices || record.rows.map((_, index) => index);
  let rows = [...allowed];
  const allowedSet = new Set(allowed);
  if (action.rows) {
    if (action.rows.some((index) => !Number.isInteger(index) || index < 0 || index >= record.rows.length || !allowedSet.has(index))) {
      throw new Error('A selected row is outside this RecordSet or View.');
    }
    rows = [...new Set(action.rows)];
  }
  const columns = action.columns?.length ? [...action.columns] : [...(parent?.columns || record.columns)];
  for (const column of [...columns, action.column, action.orderBy].filter((item): item is string => !!item)) {
    if (!record.columns.includes(column) || (parent && !parent.columns.includes(column))) {
      throw new Error(`This RecordSet has no selectable ${column} column.`);
    }
  }
  if (action.column) {
    rows = rows.filter((index) => {
      const text = scalarText(record.rows[index][action.column as string]);
      return (action.equals === undefined || text.toLocaleLowerCase() === action.equals.toLocaleLowerCase()) &&
        (action.contains === undefined || text.toLocaleLowerCase().includes(action.contains.toLocaleLowerCase()));
    });
  }
  if (action.orderBy) {
    const column = action.orderBy;
    rows.sort((a, b) => (action.descending ? -1 : 1) * compareValues(record.rows[a][column], record.rows[b][column]));
  }
  if (action.limit !== undefined) {
    if (!Number.isInteger(action.limit) || action.limit < 1 || action.limit > 1000) throw new Error('Selection limit must be from 1 to 1000.');
    rows = rows.slice(0, action.limit);
  }
  const ranges = [...(action.ranges || [])];
  for (const range of ranges) {
    if (!range.rowIndices.length || !range.columns.length ||
        range.rowIndices.some((index) => !Number.isInteger(index) || !allowedSet.has(index) || !rows.includes(index)) ||
        range.columns.some((column) => !record.columns.includes(column) || !columns.includes(column))) {
      throw new Error('A selected cell range is outside this RecordSet.');
    }
  }
  const title = action.title?.trim().slice(0, 100) || `${action.column && action.equals ? `${action.equals} · ` : ''}${rows.length} selected`;
  const view: ChatRecordSetView = {
    id: crypto.randomUUID(), recordSetId: record.id, title, rowIndices: rows, columns, createdAt: new Date().toISOString(),
  };
  const selection: ChatSelection = {
    id: crypto.randomUUID(), viewId: view.id, title, rows, columns, ranges, createdAt: view.createdAt,
  };
  const ref: ChatContextReference = {
    kind: 'selection', projectId: projectIdFromScope(scope), sourceId: 'chinook', objectId: selection.id, title,
  };
  return {
    state: {
      ...state, views: { ...state.views, [view.id]: view }, selections: { ...state.selections, [selection.id]: selection },
      currentSelectionId: selection.id, activeTab: 'selected',
    },
    reference: ref,
  };
}

export function applyChatWorkspaceAction(
  scope: string, original: ChatWorkspaceState | undefined, records: ReadonlyMap<string, ChatRecordSetData>, action: ChatWorkspaceAction,
): ChatWorkspaceResult {
  const state = original || emptyChatWorkspace();
  switch (action.kind) {
    case 'select': return select(scope, state, records, action);
    case 'clearSelection': return { state: { ...state, currentSelectionId: undefined } };
    case 'focusSelection':
      if (!state.selections[action.selectionId]) throw new Error('The selected Selection is unavailable.');
      return { state: { ...state, currentSelectionId: action.selectionId, activeTab: 'selected' } };
    case 'sortView': {
      const view = state.views[action.viewId];
      const record = view && records.get(view.recordSetId);
      if (!view || !record || !view.columns.includes(action.column)) throw new Error('The View or sort column is unavailable.');
      const rows = [...view.rowIndices].sort((a, b) => (action.descending ? -1 : 1) *
        compareValues(record.rows[a][action.column], record.rows[b][action.column]));
      const selections = { ...state.selections };
      for (const [id, selection] of Object.entries(selections)) {
        if (selection.viewId !== view.id) continue;
        const included = new Set(selection.rows);
        selections[id] = { ...selection, rows: rows.filter((index) => included.has(index)) };
      }
      return { state: { ...state, views: { ...state.views, [view.id]: { ...view, rowIndices: rows } }, selections } };
    }
    case 'setTab':
      if (!['project', 'selected', 'docked', 'bookmarks'].includes(action.tab)) throw new Error('Unknown workspace tab.');
      return { state: { ...state, activeTab: action.tab } };
    case 'attach':
      validateReference(scope, state, records, action.reference);
      if (!state.attachments.some((item) => sameReference(item, action.reference)) && state.attachments.length + state.docks.length >= 12) {
        throw new Error('Detach or undock an item before adding more chat context.');
      }
      return {
        state: { ...state, attachments: state.attachments.some((item) => sameReference(item, action.reference))
          ? state.attachments : [...state.attachments, action.reference] },
        reference: action.reference,
      };
    case 'detach':
      if (!state.attachments.some((item) => sameReference(item, action.reference))) throw new Error('This object is not attached to the chat.');
      return { state: { ...state, attachments: state.attachments.filter((item) => !sameReference(item, action.reference)) } };
    case 'dockCurrent': {
      const selection = state.currentSelectionId && state.selections[state.currentSelectionId];
      if (!selection) throw new Error('Select rows or a cell before docking.');
      const ref: ChatContextReference = {
        kind: 'selection', projectId: projectIdFromScope(scope), sourceId: 'chinook', objectId: selection.id, title: selection.title,
      };
      return applyChatWorkspaceAction(scope, state, records, { kind: 'dock', reference: ref, title: action.title });
    }
    case 'dock': {
      validateReference(scope, state, records, action.reference);
      if (!['recordset', 'view', 'selection', 'bookmark'].includes(action.reference.kind)) throw new Error('Only a result, View, Selection, or Bookmark can be docked.');
      const alreadyDocked = state.docks.some((dock) => sameReference(dock.reference, action.reference));
      if (!alreadyDocked && state.attachments.length + state.docks.length >= 12) {
        throw new Error('Detach or undock an item before adding more chat context.');
      }
      return {
        state: { ...state, docks: alreadyDocked ? state.docks : [...state.docks, {
          id: crypto.randomUUID(), reference: action.reference, title: action.title?.trim().slice(0, 100) || action.reference.title,
        }], activeTab: 'docked' },
        reference: action.reference,
      };
    }
    case 'undock':
      if (!state.docks.some((dock) => dock.id === action.dockId)) throw new Error('This docked item is unavailable.');
      return { state: { ...state, docks: state.docks.filter((dock) => dock.id !== action.dockId) } };
    case 'bookmark':
    case 'renameBookmark':
    case 'addBookmarkTag':
    case 'removeBookmarkTag':
    case 'deleteBookmark':
      throw new Error('Bookmark actions must be applied by the project bookmark service.');
  }
}
