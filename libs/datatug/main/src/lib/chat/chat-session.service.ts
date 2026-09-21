import { Injectable, InjectionToken, inject } from '@angular/core';
import { type Database, type ReadwriteTransaction, key } from '@dalgo/core';
import { IndexedDbDatabase } from '@dalgo/indexeddb';
import { ChatMetrics, ChatTurn } from './chat.types';

// The session model uses only DALgo's Database contract. Replacing this provider
// can move sessions to another DALgo backend without changing Chat or its model.
export const CHAT_SESSION_DATABASE = new InjectionToken<Database>('Chat session database', {
  providedIn: 'root',
  factory: () => new IndexedDbDatabase({
    name: 'datatug-chat-sessions',
    version: 1,
    collections: ['ChatSessions', 'ChatTurns', 'ChatQueries', 'ChatRecordSets'],
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
}

export interface ChatQuery {
  readonly id: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly dtql: string;
  readonly dtqlYaml: string;
  readonly sql: string;
  readonly source: string;
  readonly executedAt: string;
  readonly columns: readonly string[];
  readonly rowCount: number;
}

export interface ChatRecordSet {
  readonly id: string;
  readonly sessionId: string;
  readonly queryId: string;
  readonly source: string;
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
  readonly createdAt: string;
  readonly metrics: ChatMetrics;
}

interface StoredTurn extends Omit<ChatTurn, 'rows'> {
  readonly sessionId: string;
  readonly createdAt: string;
  readonly queryId?: string;
  readonly recordSetId?: string;
}

export interface CompletedChatQuery {
  readonly dtql: string;
  readonly dtqlYaml: string;
  readonly sql: string;
  readonly rows: readonly Record<string, unknown>[];
  readonly columns: readonly string[];
  readonly metrics: ChatMetrics;
  readonly source: string;
}

const sessionKey = (id: string) => key('ChatSessions', id);
const turnKey = (id: string) => key('ChatTurns', id);
const queryKey = (id: string) => key('ChatQueries', id);
const recordSetKey = (id: string) => key('ChatRecordSets', id);
const now = () => new Date().toISOString();

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
        dtql: data.dtql, dtqlYaml: data.dtqlYaml, sql: data.sql,
        error: data.error, metrics: data.metrics,
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

  async completeQuery(scope: string, sessionId: string, turnId: string, result: CompletedChatQuery): Promise<ChatTurn> {
    const timestamp = now();
    const queryId = crypto.randomUUID();
    const recordSetId = crypto.randomUUID();
    const columns = result.columns;
    const query: ChatQuery = {
      id: queryId, sessionId, turnId, dtql: result.dtql, dtqlYaml: result.dtqlYaml,
      sql: result.sql, source: result.source, executedAt: timestamp, columns, rowCount: result.rows.length,
    };
    const snapshot: ChatRecordSet = {
      id: recordSetId, sessionId, queryId, source: result.source, columns,
      rows: result.rows.map((row) => ({ ...row })), createdAt: timestamp, metrics: result.metrics,
    };
    const replacement: StoredTurn = await this.database.runReadwriteTransaction(async (tx) => {
      const session = await this.sessionInTransaction(tx, scope, sessionId);
      const stored = await tx.get<StoredTurn>(turnKey(turnId));
      if (!stored.exists || stored.data.sessionId !== sessionId || stored.data.state !== 'loading') {
        throw new Error('The pending chat request is no longer available.');
      }
      const turn: StoredTurn = {
        ...stored.data, state: result.rows.length ? 'result' : 'empty',
        dtql: result.dtql, dtqlYaml: result.dtqlYaml, sql: result.sql,
        metrics: result.metrics, queryId, recordSetId,
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

  async failQuestion(scope: string, sessionId: string, turnId: string, message: string): Promise<ChatTurn> {
    return this.database.runReadwriteTransaction(async (tx) => {
      const session = await this.sessionInTransaction(tx, scope, sessionId);
      const stored = await tx.get<StoredTurn>(turnKey(turnId));
      if (!stored.exists || stored.data.sessionId !== sessionId || stored.data.state !== 'loading') {
        throw new Error('The pending chat request is no longer available.');
      }
      const turn: StoredTurn = { ...stored.data, state: 'error', error: message };
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
        ...session, updatedAt: now(), turnIds: [], queryIds: [], recordSetIds: [],
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

  context(turns: readonly ChatTurn[]): string {
    return turns.filter((turn) => turn.dtql && turn.recordSetId).slice(-5).map((turn) =>
      `Question: ${turn.question.slice(0, 200)}\nDTQL: ${turn.dtql?.slice(0, 2000)}\n` +
      `RecordSet: ${turn.recordSetId}; columns: ${turn.columns?.join(', ') || ''}; rows: ${turn.rows?.length || 0}`,
    ).join('\n\n').slice(0, 7000);
  }

  private async requireSession(scope: string, id: string): Promise<ChatSession> {
    const stored = await this.database.get<ChatSession>(sessionKey(id));
    if (!stored.exists || stored.data.scope !== scope) throw new Error('This chat session is unavailable in this project.');
    return stored.data;
  }

  private async sessionInTransaction(tx: ReadwriteTransaction, scope: string, id: string): Promise<ChatSession> {
    const stored = await tx.get<ChatSession>(sessionKey(id));
    if (!stored.exists || stored.data.scope !== scope) throw new Error('This chat session is unavailable in this project.');
    return stored.data;
  }
}
