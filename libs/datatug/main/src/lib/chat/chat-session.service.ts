import { Injectable, InjectionToken, inject } from '@angular/core';
import { type Database, type ReadwriteTransaction, key } from '@dalgo/core';
import { IndexedDbDatabase } from '@dalgo/indexeddb';
import { ChatJoinChoice, ChatJoinLineage, ChatMetrics, ChatTurn } from './chat.types';
import {
  applyChatWorkspaceAction, chatBookmarkRows, ChatBookmark, ChatRecordSetData, ChatWorkspaceAction, ChatWorkspaceState,
  emptyChatWorkspace,
} from './chat-workspace';

// The session model uses only DALgo's Database contract. Replacing this provider
// can move sessions to another DALgo backend without changing Chat or its model.
export const CHAT_SESSION_DATABASE = new InjectionToken<Database>('Chat session database', {
  providedIn: 'root',
  factory: () => new IndexedDbDatabase({
    name: 'datatug-chat-sessions',
    version: 2,
    collections: ['ChatSessions', 'ChatTurns', 'ChatQueries', 'ChatRecordSets', 'ChatBookmarks'],
  }),
});

export interface ChatSession {
  readonly id: string;
  readonly scope: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly turnIds: readonly string[];
  readonly queryIds: readonly string[];
  readonly recordSetIds: readonly string[];
  readonly workspace?: ChatWorkspaceState;
}

export interface ChatQuery {
  readonly id: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly dtql: string;
  readonly generatedDtql: string;
  readonly parentRecordSetId?: string;
  readonly dtqlYaml: string;
  readonly sql: string;
  readonly source: string;
  readonly executedAt: string;
  readonly columns: readonly string[];
  readonly rowCount: number;
  readonly join?: ChatJoinLineage;
}

export interface ChatRecordSet {
  readonly id: string;
  readonly sessionId: string;
  readonly queryId: string;
  readonly parentRecordSetId?: string;
  readonly source: string;
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
  readonly createdAt: string;
  readonly metrics: ChatMetrics;
  readonly join?: ChatJoinLineage;
}

interface StoredTurn extends Omit<ChatTurn, 'rows'> {
  readonly sessionId: string;
  readonly createdAt: string;
  readonly queryId?: string;
  readonly recordSetId?: string;
}

export interface CompletedChatQuery {
  readonly dtql: string;
  readonly generatedDtql: string;
  readonly parentRecordSetId?: string;
  readonly dtqlYaml: string;
  readonly sql: string;
  readonly rows: readonly Record<string, unknown>[];
  readonly columns: readonly string[];
  readonly metrics: ChatMetrics;
  readonly source: string;
  readonly join?: ChatJoinLineage;
}

const sessionKey = (id: string) => key('ChatSessions', id);
const turnKey = (id: string) => key('ChatTurns', id);
const queryKey = (id: string) => key('ChatQueries', id);
const recordSetKey = (id: string) => key('ChatRecordSets', id);
const bookmarkKey = (id: string) => key('ChatBookmarks', id);
const now = () => new Date().toISOString();

function projectIdFromScope(scope: string): string {
  const parsed = JSON.parse(scope) as unknown;
  if (!Array.isArray(parsed) || typeof parsed[1] !== 'string') throw new Error('The chat project identity is invalid.');
  return parsed[1];
}
function validTitle(value: string): string {
  const title = value.trim().slice(0, 100);
  if (!title) throw new Error('Enter a bookmark name up to 100 characters.');
  return title;
}
function normalizeTag(tag: string): string { return tag.trim().toLowerCase(); }
function normalizeTags(tags: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  return tags.map((tag) => normalizeTag(tag).slice(0, 60)).filter((tag) => tag &&
    ![...tag].some((character) => character.charCodeAt(0) < 32) &&
    !seen.has(normalizeTag(tag)) && !!seen.add(normalizeTag(tag)));
}

@Injectable({ providedIn: 'root' })
export class ChatSessionService {
  private readonly database = inject(CHAT_SESSION_DATABASE);

  async list(scope: string): Promise<readonly ChatSession[]> {
    const page = await this.database.query<ChatSession>({
      source: { kind: 'collection', name: 'ChatSessions' },
      filters: [{ field: 'scope', operator: '==', value: scope }],
      orders: [{ field: 'updatedAt', direction: 'desc' }],
    });
    return page.records.map((record) => record.data);
  }

  async create(scope: string): Promise<ChatSession> {
    const timestamp = now();
    const session: ChatSession = {
      id: crypto.randomUUID(), scope, title: 'New chat', createdAt: timestamp,
      updatedAt: timestamp, turnIds: [], queryIds: [], recordSetIds: [],
      workspace: emptyChatWorkspace(),
    };
    await this.database.runReadwriteTransaction((tx) => tx.insert(sessionKey(session.id), session));
    return session;
  }

  async load(scope: string, id: string): Promise<{ session: ChatSession; turns: readonly ChatTurn[] }> {
    const session = await this.requireSession(scope, id);
    if (!Array.isArray(session.turnIds) || !Array.isArray(session.queryIds) || !Array.isArray(session.recordSetIds)) {
      throw new Error('This chat session has invalid saved metadata.');
    }
    const storedTurns = await this.database.getMany<StoredTurn>(session.turnIds.map(turnKey));
    const queries = await this.database.getMany<ChatQuery>(session.queryIds.map(queryKey));
    const snapshots = await this.database.getMany<ChatRecordSet>(session.recordSetIds.map(recordSetKey));
    if (storedTurns.some((turn) => !turn.exists) || queries.some((query) => !query.exists || query.data.sessionId !== id) ||
        snapshots.some((snapshot) => !snapshot.exists || snapshot.data.sessionId !== id)) {
      throw new Error('This chat session has missing saved messages or result snapshots.');
    }
    const recordSets = new Map(snapshots.map((snapshot) => [snapshot.key.id, snapshot.data]));
    const turns = storedTurns.map((stored) => {
      if (!stored.exists) throw new Error('This chat session has a missing saved message.');
      const data = stored.data;
      if (data.sessionId !== id) throw new Error('This chat session contains a message from another session.');
      const snapshot = data.recordSetId ? recordSets.get(data.recordSetId) : undefined;
      if (data.recordSetId && (!snapshot || snapshot.sessionId !== id || snapshot.queryId !== data.queryId ||
          !session.queryIds.includes(data.queryId || ''))) {
        throw new Error('This chat session has an invalid saved result snapshot.');
      }
      const turn: ChatTurn = {
        id: data.id, question: data.question, state: data.state,
        queryId: data.queryId, recordSetId: data.recordSetId,
        dtql: data.dtql, generatedDtql: data.generatedDtql,
        dtqlYaml: data.dtqlYaml, sql: data.sql,
        error: data.error, metrics: data.metrics, actionSummary: data.actionSummary, join: data.join,
        joinChoices: data.joinChoices,
      };
      return data.state === 'loading'
        ? { ...turn, state: 'error' as const, error: 'This request was interrupted. Ask it again to retry.' }
        : { ...turn, rows: snapshot?.rows, columns: snapshot?.columns };
    });
    return { session, turns };
  }

  async appendQuestion(scope: string, sessionId: string, question: string): Promise<ChatTurn> {
    const timestamp = now();
    const turn: StoredTurn = { id: crypto.randomUUID(), sessionId, question, createdAt: timestamp, state: 'loading' };
    await this.database.runReadwriteTransaction(async (tx) => {
      const session = await this.sessionInTransaction(tx, scope, sessionId);
      await tx.insert(turnKey(turn.id), turn);
      await tx.set(sessionKey(sessionId), {
        ...session,
        title: session.title === 'New chat' ? question.slice(0, 60) : session.title,
        updatedAt: timestamp,
        turnIds: [...session.turnIds, turn.id],
      });
    });
    return turn;
  }

  /** Read only a parent that belongs to this project, session and Chinook source. */
  async joinParent(scope: string, sessionId: string, recordSetId: string): Promise<{ query: ChatQuery; recordSet: ChatRecordSet }> {
    const session = await this.requireSession(scope, sessionId);
    if (!session.recordSetIds.includes(recordSetId)) throw new Error('The selected result is not in this chat session.');
    const stored = await this.database.get<ChatRecordSet>(recordSetKey(recordSetId));
    if (!stored.exists || stored.data.sessionId !== sessionId || stored.data.source !== `${scope}/chinook` ||
        !session.queryIds.includes(stored.data.queryId)) {
      throw new Error('The selected result is unavailable in this project.');
    }
    const query = await this.database.get<ChatQuery>(queryKey(stored.data.queryId));
    if (!query.exists || query.data.sessionId !== sessionId || query.data.source !== stored.data.source ||
        query.data.id !== stored.data.queryId) {
      throw new Error('The selected query is unavailable in this project.');
    }
    return { query: query.data, recordSet: stored.data };
  }

  async bindRecordSet(scope: string, sessionId: string, generatedDtql: string): Promise<{ dtql: string; parentRecordSetId?: string }> {
    let action: Record<string, unknown>;
    try {
      const parsed = JSON.parse(generatedDtql) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { dtql: generatedDtql };
      action = parsed as Record<string, unknown>;
    } catch {
      return { dtql: generatedDtql };
    }
    const where = action['where'];
    if (!where || typeof where !== 'object' || Array.isArray(where)) return { dtql: generatedDtql };
    const condition = where as Record<string, unknown>;
    const right = condition['right'];
    if (!right || typeof right !== 'object' || Array.isArray(right) || (!('recordSet' in right) && !('selection' in right) && !('bookmark' in right))) {
      return { dtql: generatedDtql };
    }
    if (condition['op'] !== 'In') throw new Error('A saved RecordSet reference requires the In operator.');
    const rightObject = right as Record<string, unknown>;
    if (Object.keys(rightObject).length !== 1) throw new Error('The saved context reference has unexpected fields.');
    const isSelection = 'selection' in rightObject;
    const isBookmark = 'bookmark' in rightObject;
    const reference = rightObject[isSelection ? 'selection' : isBookmark ? 'bookmark' : 'recordSet'];
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) throw new Error('The saved RecordSet reference is invalid.');
    const { id, field } = reference as Record<string, unknown>;
    if (Object.keys(reference).sort().join(',') !== 'field,id' || typeof id !== 'string' || typeof field !== 'string') {
      throw new Error('The saved RecordSet reference needs an ID and source column.');
    }
    const session = await this.requireSession(scope, sessionId);
    let recordSetId = id;
    let selectedRows: readonly number[] | undefined;
    if (isSelection) {
      const selection = session.workspace?.selections[id];
      const view = selection && session.workspace?.views[selection.viewId];
      if (!selection || !view || !session.recordSetIds.includes(view.recordSetId) || !selection.columns.includes(field)) {
        throw new Error('The referenced Selection is not in this chat session.');
      }
      const availableToChat = session.workspace?.attachments.some((ref) => ref.kind === 'selection' && ref.objectId === id) ||
        session.workspace?.docks.some((dock) => dock.reference.kind === 'selection' && dock.reference.objectId === id);
      if (!availableToChat) throw new Error('Attach or dock this Selection before using it in a follow-up query.');
      recordSetId = view.recordSetId;
      selectedRows = selection.rows;
    }
    if (isBookmark) {
      const attached = session.workspace?.attachments.some((ref) => ref.kind === 'bookmark' && ref.objectId === id) ||
        session.workspace?.docks.some((dock) => dock.reference.kind === 'bookmark' && dock.reference.objectId === id);
      if (!attached) throw new Error('Attach or dock this Bookmark before using it in a follow-up query.');
      const saved = await this.database.get<ChatBookmark>(bookmarkKey(id));
      if (!saved.exists || saved.data.scope !== scope) throw new Error('The referenced Bookmark is unavailable.');
      if (!saved.data.recordSet.columns.includes(field)) throw new Error('The referenced Bookmark has no such column.');
      const rows = chatBookmarkRows(saved.data);
      const values = [...new Set(rows.filter((row) => Object.prototype.hasOwnProperty.call(row, field)).map((row) => row[field]))];
      if (!values.length || values.length > 1000 || values.some((value) => value !== null && typeof value !== 'string' && typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value)))) throw new Error('The referenced Bookmark has no supported identifier values.');
      return { dtql: JSON.stringify({ ...action, where: { ...condition, right: { values } } }) };
    }
    if (!session.recordSetIds.includes(recordSetId)) throw new Error('The referenced RecordSet is not in this chat session.');
    const stored = await this.database.get<ChatRecordSet>(recordSetKey(recordSetId));
    if (!stored.exists || stored.data.sessionId !== sessionId || stored.data.source !== `${scope}/chinook`) {
      throw new Error('The referenced RecordSet is unavailable for this data source.');
    }
    if (!stored.data.columns.includes(field)) throw new Error('The referenced RecordSet has no such column.');
    const sourceRows = selectedRows ? selectedRows.map((index) => stored.data.rows[index]) : stored.data.rows;
    if (sourceRows.some((row) => !row)) throw new Error('The referenced Selection contains a missing source row.');
    const values = [...new Set(sourceRows.map((row) => row[field]))];
    if (!values.length) throw new Error('The referenced RecordSet has no values to use in this follow-up.');
    if (values.length > 1000 || values.some((value) => value !== null && typeof value !== 'string' &&
        typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value)))) {
      throw new Error('The referenced RecordSet has too many or unsupported identifier values.');
    }
    return {
      dtql: JSON.stringify({ ...action, where: { ...condition, right: { values } } }),
      parentRecordSetId: recordSetId,
    };
  }

  async workspaceAction(scope: string, sessionId: string, action: ChatWorkspaceAction): Promise<ChatWorkspaceState> {
    if (action.kind === 'deleteBookmark') await this.assertBookmarkUnused(scope, action.bookmarkId);
    return this.database.runReadwriteTransaction(async (tx) => {
      const session = await this.sessionInTransaction(tx, scope, sessionId);
      if (action.kind === 'bookmark') {
        const state = await this.createBookmark(tx, scope, session, action);
        await tx.set(sessionKey(sessionId), { ...session, workspace: state, updatedAt: now() });
        return state;
      }
      if (action.kind === 'renameBookmark' || action.kind === 'addBookmarkTag' || action.kind === 'removeBookmarkTag' || action.kind === 'deleteBookmark') {
        const state = await this.updateBookmark(tx, scope, session, action);
        await tx.set(sessionKey(sessionId), { ...session, workspace: state, updatedAt: now() });
        return state;
      }
      const records = await this.recordsForAction(tx, session, action);
      const result = applyChatWorkspaceAction(scope, session.workspace, records, action);
      await tx.set(sessionKey(sessionId), { ...session, workspace: result.state, updatedAt: now() });
      return result.state;
    });
  }

  async listBookmarks(scope: string, search = '', tags: readonly string[] = []): Promise<readonly ChatBookmark[]> {
    const page = await this.database.query<ChatBookmark>({ source: { kind: 'collection', name: 'ChatBookmarks' }, filters: [{ field: 'scope', operator: '==', value: scope }], orders: [{ field: 'updatedAt', direction: 'desc' }] });
    const needle = search.trim().toLowerCase();
    const required = tags.map(normalizeTag).filter(Boolean);
    return page.records.map((record) => record.data).filter((bookmark) =>
      (!needle || `${bookmark.title} ${bookmark.tags.join(' ')}`.toLowerCase().includes(needle)) &&
      required.every((tag) => bookmark.tags.some((saved) => normalizeTag(saved) === tag)),
    );
  }

  private async createBookmark(tx: ReadwriteTransaction, scope: string, session: ChatSession,
    action: Extract<ChatWorkspaceAction, { kind: 'bookmark' }>): Promise<ChatWorkspaceState> {
    const ref = action.reference;
    const projectId = projectIdFromScope(scope);
    if (!['recordset', 'view', 'selection'].includes(ref.kind) || ref.projectId !== projectId) throw new Error('Choose a result, View, or Selection from this project to bookmark.');
    const state = session.workspace || emptyChatWorkspace();
    let recordSetId = ref.objectId;
    let view: ChatBookmark['view'];
    let selection: ChatBookmark['selection'];
    if (ref.kind === 'view') { view = state.views[ref.objectId]; if (!view) throw new Error('The View is unavailable.'); recordSetId = view.recordSetId; }
    if (ref.kind === 'selection') { selection = state.selections[ref.objectId]; view = selection && state.views[selection.viewId]; if (!selection || !view) throw new Error('The Selection is unavailable.'); recordSetId = view.recordSetId; }
    if (!session.recordSetIds.includes(recordSetId)) throw new Error('The RecordSet is unavailable.');
    const stored = await tx.get<ChatRecordSet>(recordSetKey(recordSetId));
    if (!stored.exists || stored.data.sessionId !== session.id) throw new Error('The RecordSet is unavailable.');
    const included = selection ? new Set(selection.rows) : view ? new Set(view.rowIndices) : undefined;
    const columns = selection?.columns || view?.columns || stored.data.columns;
    const cells = selection?.ranges.length ? new Set(selection.ranges.flatMap((range) =>
      range.rowIndices.flatMap((row) => range.columns.map((column) => `${row}\u0000${column}`)))) : undefined;
    const rows = stored.data.rows.map((row, index) => {
      if (included && !included.has(index)) return {};
      return Object.fromEntries(columns.filter((column) => !cells || cells.has(`${index}\u0000${column}`))
        .map((column) => [column, row[column]]));
    });
    const timestamp = now();
    const title = validTitle(action.title || ref.title || `${stored.data.rows.length} rows`);
    const bookmark: ChatBookmark = {
      id: crypto.randomUUID(), scope, projectId, title, tags: normalizeTags(action.tags || []), target: ref.kind as ChatBookmark['target'],
      recordSet: { id: crypto.randomUUID(), source: stored.data.source, columns: [...columns], rows },
      view: view && { ...view, id: crypto.randomUUID(), recordSetId: '' },
      selection: selection && { ...selection, id: crypto.randomUUID(), viewId: '', rows: [...selection.rows], columns: [...selection.columns], ranges: selection.ranges.map((range) => ({ rowIndices: [...range.rowIndices], columns: [...range.columns] })) },
      createdAt: timestamp, updatedAt: timestamp,
    };
    if (bookmark.view) (bookmark.view as { recordSetId: string }).recordSetId = bookmark.recordSet.id;
    if (bookmark.selection && bookmark.view) (bookmark.selection as { viewId: string }).viewId = bookmark.view.id;
    await tx.insert(bookmarkKey(bookmark.id), bookmark);
    return { ...state, activeTab: 'bookmarks' };
  }

  private async updateBookmark(tx: ReadwriteTransaction, scope: string, session: ChatSession,
    action: Extract<ChatWorkspaceAction, { kind: 'renameBookmark' | 'addBookmarkTag' | 'removeBookmarkTag' | 'deleteBookmark' }>): Promise<ChatWorkspaceState> {
    const stored = await tx.get<ChatBookmark>(bookmarkKey(action.bookmarkId));
    if (!stored.exists || stored.data.scope !== scope) throw new Error('This Bookmark is unavailable in the current project.');
    if (action.kind === 'deleteBookmark') {
      const references = [...(session.workspace?.attachments || []), ...(session.workspace?.docks || []).map((dock) => dock.reference)];
      if (references.some((reference) => reference.kind === 'bookmark' && reference.objectId === action.bookmarkId)) {
        throw new Error('Detach or undock this Bookmark before deleting it.');
      }
      await tx.delete(bookmarkKey(action.bookmarkId));
      return { ...(session.workspace || emptyChatWorkspace()), activeTab: 'bookmarks' };
    }
    const bookmark = stored.data;
    const tags = action.kind === 'renameBookmark' ? bookmark.tags : action.kind === 'addBookmarkTag'
      ? normalizeTags([...bookmark.tags, action.tag]) : bookmark.tags.filter((tag) => normalizeTag(tag) !== normalizeTag(action.tag));
    await tx.set(bookmarkKey(bookmark.id), { ...bookmark, title: action.kind === 'renameBookmark' ? validTitle(action.title) : bookmark.title, tags, updatedAt: now() });
    return { ...(session.workspace || emptyChatWorkspace()), activeTab: 'bookmarks' };
  }

  async completeWorkspaceAction(
    scope: string, sessionId: string, turnId: string, action: ChatWorkspaceAction,
    metrics: Omit<ChatMetrics, 'queryMs'>,
  ): Promise<{ turn: ChatTurn; workspace: ChatWorkspaceState }> {
    if (action.kind === 'deleteBookmark') await this.assertBookmarkUnused(scope, action.bookmarkId);
    return this.database.runReadwriteTransaction(async (tx) => {
      const session = await this.sessionInTransaction(tx, scope, sessionId);
      const stored = await tx.get<StoredTurn>(turnKey(turnId));
      if (!stored.exists || stored.data.sessionId !== sessionId || stored.data.state !== 'loading') {
        throw new Error('The pending chat request is no longer available.');
      }
      const state = action.kind === 'bookmark' ? await this.createBookmark(tx, scope, session, action)
        : action.kind === 'renameBookmark' || action.kind === 'addBookmarkTag' || action.kind === 'removeBookmarkTag' || action.kind === 'deleteBookmark'
          ? await this.updateBookmark(tx, scope, session, action)
          : undefined;
      const result = state ? { state } : applyChatWorkspaceAction(scope, session.workspace, await this.recordsForAction(tx, session, action), action);
      const summary = action.kind === 'select'
        ? `Selected ${result.state.selections[result.state.currentSelectionId || '']?.rows.length || 0} rows.`
        : action.kind === 'dockCurrent' || action.kind === 'dock' ? `Docked ${result.reference?.title || 'selection'}.`
          : `Workspace ${action.kind} completed.`;
      const turn: StoredTurn = {
        ...stored.data, state: 'result', actionSummary: summary, metrics: { ...metrics, queryMs: 0 },
      };
      await tx.set(turnKey(turnId), turn);
      await tx.set(sessionKey(sessionId), { ...session, workspace: result.state, updatedAt: now() });
      return { turn, workspace: result.state };
    });
  }

  async completeQuery(scope: string, sessionId: string, turnId: string, result: CompletedChatQuery): Promise<ChatTurn> {
    const timestamp = now();
    const queryId = crypto.randomUUID();
    const recordSetId = crypto.randomUUID();
    const columns = result.columns;
    const query: ChatQuery = {
      id: queryId, sessionId, turnId, dtql: result.dtql, generatedDtql: result.generatedDtql,
      parentRecordSetId: result.parentRecordSetId, dtqlYaml: result.dtqlYaml,
      sql: result.sql, source: result.source, executedAt: timestamp, columns, rowCount: result.rows.length,
      join: result.join,
    };
    const snapshot: ChatRecordSet = {
      id: recordSetId, sessionId, queryId, parentRecordSetId: result.parentRecordSetId,
      source: result.source, columns,
      rows: result.rows.map((row) => ({ ...row })), createdAt: timestamp, metrics: result.metrics,
      join: result.join,
    };
    const replacement: StoredTurn = await this.database.runReadwriteTransaction(async (tx) => {
      const session = await this.sessionInTransaction(tx, scope, sessionId);
      const stored = await tx.get<StoredTurn>(turnKey(turnId));
      if (!stored.exists || stored.data.sessionId !== sessionId || stored.data.state !== 'loading') {
        throw new Error('The pending chat request is no longer available.');
      }
      if (result.parentRecordSetId) {
        if (!session.recordSetIds.includes(result.parentRecordSetId)) {
          throw new Error('The parent RecordSet is not in this chat session.');
        }
        const parent = await tx.get<ChatRecordSet>(recordSetKey(result.parentRecordSetId));
        if (!parent.exists || parent.data.sessionId !== sessionId || parent.data.source !== result.source) {
          throw new Error('The parent RecordSet is unavailable in this project.');
        }
      }
      if (result.join && !result.parentRecordSetId) throw new Error('A JOIN result requires a parent RecordSet.');
      const turn: StoredTurn = {
        ...stored.data, state: result.rows.length ? 'result' : 'empty',
        dtql: result.dtql, generatedDtql: result.generatedDtql,
        dtqlYaml: result.dtqlYaml, sql: result.sql,
        metrics: result.metrics, queryId, recordSetId, join: result.join,
      };
      await tx.insert(queryKey(queryId), query);
      await tx.insert(recordSetKey(recordSetId), snapshot);
      await tx.set(turnKey(turnId), turn);
      await tx.set(sessionKey(sessionId), {
        ...session, updatedAt: timestamp,
        queryIds: [...session.queryIds, queryId],
        recordSetIds: [...session.recordSetIds, recordSetId],
      });
      return turn;
    });
    return { ...replacement, rows: snapshot.rows, columns: snapshot.columns };
  }

  async failQuestion(scope: string, sessionId: string, turnId: string, message: string, joinChoices?: readonly ChatJoinChoice[]): Promise<ChatTurn> {
    return this.database.runReadwriteTransaction(async (tx) => {
      const session = await this.sessionInTransaction(tx, scope, sessionId);
      const stored = await tx.get<StoredTurn>(turnKey(turnId));
      if (!stored.exists || stored.data.sessionId !== sessionId || stored.data.state !== 'loading') {
        throw new Error('The pending chat request is no longer available.');
      }
      const turn: StoredTurn = { ...stored.data, state: 'error', error: message, joinChoices };
      await tx.set(turnKey(turnId), turn);
      await tx.set(sessionKey(sessionId), { ...session, updatedAt: now() });
      return turn;
    });
  }

  async rename(scope: string, id: string, title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed || trimmed.length > 100) throw new Error('Enter a session name up to 100 characters.');
    await this.database.runReadwriteTransaction(async (tx) => {
      const session = await this.sessionInTransaction(tx, scope, id);
      await tx.set(sessionKey(id), { ...session, title: trimmed, updatedAt: now() });
    });
  }

  async activate(scope: string, id: string): Promise<void> {
    await this.database.runReadwriteTransaction(async (tx) => {
      const session = await this.sessionInTransaction(tx, scope, id);
      await tx.set(sessionKey(id), { ...session, updatedAt: now() });
    });
  }

  async clear(scope: string, id: string): Promise<void> {
    await this.database.runReadwriteTransaction(async (tx) => {
      const session = await this.sessionInTransaction(tx, scope, id);
      for (const turnId of session.turnIds) await tx.delete(turnKey(turnId));
      for (const queryId of session.queryIds) await tx.delete(queryKey(queryId));
      for (const recordSetId of session.recordSetIds) await tx.delete(recordSetKey(recordSetId));
      await tx.set(sessionKey(id), {
        ...session, updatedAt: now(), turnIds: [], queryIds: [], recordSetIds: [], workspace: emptyChatWorkspace(),
      });
    });
  }

  async delete(scope: string, id: string): Promise<void> {
    await this.database.runReadwriteTransaction(async (tx) => {
      const session = await this.sessionInTransaction(tx, scope, id);
      for (const turnId of session.turnIds) await tx.delete(turnKey(turnId));
      for (const queryId of session.queryIds) await tx.delete(queryKey(queryId));
      for (const recordSetId of session.recordSetIds) await tx.delete(recordSetKey(recordSetId));
      await tx.delete(sessionKey(id));
    });
  }

  context(turns: readonly ChatTurn[], workspace?: ChatWorkspaceState, projectId = '', bookmarks: readonly ChatBookmark[] = []): string {
    const history = turns.filter((turn) => turn.dtql && turn.recordSetId).slice(-3).map((turn) =>
      `Question: ${turn.question.slice(0, 200)}\nDTQL: ${(turn.generatedDtql || turn.dtql)?.slice(0, 1000)}\n` +
      `RecordSet: ${turn.recordSetId}; columns: ${turn.columns?.join(', ') || ''}; rows: ${turn.rows?.length || 0}`,
    ).join('\n\n');
    const refs = [...(workspace?.attachments || [])];
    for (const dock of workspace?.docks || []) {
      if (!refs.some((ref) => ref.kind === dock.reference.kind && ref.objectId === dock.reference.objectId)) refs.push(dock.reference);
    }
    const attached = refs.map((ref) => {
      if (ref.kind === 'bookmark') {
        const bookmark = bookmarks.find((item) => item.id === ref.objectId && item.projectId === projectId);
        return bookmark
          ? `Attached Bookmark: ${bookmark.title}; id: ${bookmark.id}; project: ${projectId}; columns: ${(bookmark.selection?.columns || bookmark.view?.columns || bookmark.recordSet.columns).join(', ')}; rows: ${chatBookmarkRows(bookmark).length}; tags: ${bookmark.tags.join(', ')}`
          : `Attached Bookmark: ${ref.title}; unavailable`;
      }
      if (ref.kind !== 'selection') return `Attached ${ref.kind}: ${ref.title}; id: ${ref.objectId}; project: ${ref.projectId}; source: ${ref.sourceId || ''}`;
      const selection = workspace?.selections[ref.objectId];
      return selection
        ? `Attached Selection: ${ref.title}; id: ${ref.objectId}; project: ${ref.projectId}; source: ${ref.sourceId || ''}; columns: ${selection.columns.join(', ')}; rows: ${selection.rows.length}`
        : `Attached Selection: ${ref.title}; unavailable`;
    }).join('\n');
    const current = workspace?.currentSelectionId && workspace.selections[workspace.currentSelectionId];
    const currentLine = current ? `Current Selection: ${current.title}; id: ${current.id}; view: ${current.viewId}; rows: ${current.rows.length}` : '';
    const docks = (workspace?.docks || []).map((dock) =>
      `Dock: ${dock.title}; dockId: ${dock.id}; ${dock.reference.kind} id: ${dock.reference.objectId}`,
    ).join('\n');
    const metadata = `Project: ${projectId}\n${attached}\n${currentLine}\n${docks}\n\nRecent results:\n`;
    return metadata + history.slice(0, Math.max(0, 7000 - metadata.length));
  }

  private async requireSession(scope: string, id: string): Promise<ChatSession> {
    const stored = await this.database.get<ChatSession>(sessionKey(id));
    if (!stored.exists || stored.data.scope !== scope) throw new Error('This chat session is unavailable in this project.');
    return stored.data;
  }

  /** A bookmark may not leave an attachment/dock dangling in another durable session. */
  private async assertBookmarkUnused(scope: string, bookmarkId: string): Promise<void> {
    const sessions = await this.database.query<ChatSession>({
      source: { kind: 'collection', name: 'ChatSessions' }, filters: [{ field: 'scope', operator: '==', value: scope }], orders: [],
    });
    const referenced = sessions.records.some(({ data: session }) => [
      ...(session.workspace?.attachments || []), ...(session.workspace?.docks || []).map((dock) => dock.reference),
    ].some((reference) => reference.kind === 'bookmark' && reference.objectId === bookmarkId));
    if (referenced) throw new Error('Detach or undock this Bookmark from every chat before deleting it.');
  }

  private async recordsForAction(
    tx: ReadwriteTransaction, session: ChatSession, action: ChatWorkspaceAction,
  ): Promise<ReadonlyMap<string, ChatRecordSetData>> {
    const id = action.kind === 'select' ? action.recordSetId
      : action.kind === 'sortView' ? session.workspace?.views[action.viewId]?.recordSetId
        : (action.kind === 'attach' || action.kind === 'dock') && (action.reference.kind === 'recordset' || action.reference.kind === 'bookmark')
          ? action.reference.objectId : undefined;
    const records = new Map<string, ChatRecordSetData>();
    if (!id) return records;
    if ((action.kind === 'attach' || action.kind === 'dock') && action.reference.kind === 'bookmark') {
      const saved = await tx.get<ChatBookmark>(bookmarkKey(id));
      if (!saved.exists || saved.data.scope !== session.scope) throw new Error('The referenced Bookmark is unavailable.');
      records.set(id, saved.data.recordSet);
      return records;
    }
    if (!session.recordSetIds.includes(id)) throw new Error('The referenced RecordSet is not in this chat session.');
    const stored = await tx.get<ChatRecordSet>(recordSetKey(id));
    if (!stored.exists || stored.data.sessionId !== session.id) throw new Error('The referenced RecordSet is unavailable.');
    records.set(id, stored.data);
    return records;
  }

  private async sessionInTransaction(tx: ReadwriteTransaction, scope: string, id: string): Promise<ChatSession> {
    const stored = await tx.get<ChatSession>(sessionKey(id));
    if (!stored.exists || stored.data.scope !== scope) throw new Error('This chat session is unavailable in this project.');
    return stored.data;
  }
}
