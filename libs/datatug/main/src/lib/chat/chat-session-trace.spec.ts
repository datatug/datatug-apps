import 'fake-indexeddb/auto';
import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { key } from '@dalgo/core';
import { IndexedDbDatabase } from '@dalgo/indexeddb';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { CHAT_SESSION_DATABASE, ChatSessionService, type CompletedChatQuery } from './chat-session.service';
import type { TraceStep } from './chat-trace.types';
import { createInvestigationDatabase, createInvestigationSessions } from './investigation/investigation-storage';

const scope = JSON.stringify(['github.com', 'chinook-demo@datatug@']);
const otherScope = JSON.stringify(['github.com', 'someone-else@repo@']);

let factory: IDBFactory;
beforeEach(() => {
  factory = new IDBFactory();
  TestBed.resetTestingModule();
});

/** The service over the investigation database, a second instance of the chat's. A new call is a restart. */
function investigations(): ChatSessionService {
  return createInvestigationSessions(createInvestigationDatabase(factory), TestBed.inject(Injector));
}

/** The chat's own service over `main`'s chat database definition (version 2, five collections). */
function chat(): ChatSessionService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{
      provide: CHAT_SESSION_DATABASE,
      useValue: new IndexedDbDatabase({
        name: 'datatug-chat-sessions', version: 2, factory,
        collections: ['ChatSessions', 'ChatTurns', 'ChatQueries', 'ChatRecordSets', 'ChatBookmarks'],
      }),
    }],
  });
  return TestBed.inject(ChatSessionService);
}

const step = (sessionId: string, turnId: string, index: number, over: Partial<TraceStep> = {}): TraceStep => ({
  id: `${turnId}:${index}`, sessionId, turnId, index, kind: 'understand', status: 'ok',
  message: { key: 'step.understand.recognised', params: { plan: 'p' } }, evidence: [], startedAt: '2026-10-02T10:00:00.000Z', ...over,
});

const result = (source: string, rows: Record<string, unknown>[] = [{ country: 'Ireland' }]): CompletedChatQuery => ({
  dtql: 'from: {}', generatedDtql: '', dtqlYaml: 'from: {}', sql: '', rows, columns: Object.keys(rows[0] ?? {}),
  metrics: { requestBytes: 0, responseBytes: 0, interpretMs: 0, queryMs: 1 }, source,
});

/** How many records one object store of a database holds, read with plain IndexedDB. */
async function count(database: string, store: string): Promise<number> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(database);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    return await new Promise<number>((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

describe('investigation trace in the investigation database', () => {
  it('stores steps with the turn, in order, and loads them back after a restart', async () => {
    const first = investigations();
    const session = await first.create(scope, 'investigation', 'scenario:x');
    const turn = await first.appendQuestion(scope, session.id, 'Which countries?');
    await first.appendTraceStep(scope, step(session.id, turn.id, 0));
    const running = await first.appendTraceStep(scope, step(session.id, turn.id, 1, { kind: 'execute', status: 'running' }));
    await first.updateTraceStep(scope, { ...running, status: 'ok', durationMs: 646 });
    await first.appendTraceStep(scope, step(session.id, turn.id, 2, { kind: 'present' }));

    const reopened = investigations();
    const restored = await reopened.load(scope, session.id);
    expect(restored.session.kind).toBe('investigation');
    expect(restored.session.title).toBe('scenario:x');
    expect(restored.turns[0].traceStepIds).toEqual([`${turn.id}:0`, `${turn.id}:1`, `${turn.id}:2`]);
    const trace = await reopened.loadTrace(scope, session.id);
    expect(trace.map((item) => [item.index, item.kind, item.status])).toEqual([[0, 'understand', 'ok'], [1, 'execute', 'ok'], [2, 'present', 'ok']]);
    expect(trace[1].durationMs).toBe(646);
  });

  it('keeps the steps when the turn completes with its result, and when it fails', async () => {
    const store = investigations();
    const session = await store.create(scope, 'investigation');
    const turn = await store.appendQuestion(scope, session.id, 'q');
    await store.appendTraceStep(scope, step(session.id, turn.id, 0));
    await store.completeQuery(scope, session.id, turn.id, result(`${scope}/web`));
    const loaded = await store.load(scope, session.id);
    expect(loaded.turns[0]).toMatchObject({ state: 'result', rows: [{ country: 'Ireland' }], traceStepIds: [`${turn.id}:0`] });
    expect(await store.loadTrace(scope, session.id)).toHaveLength(1);

    const failing = await store.appendQuestion(scope, session.id, 'q2');
    await store.appendTraceStep(scope, step(session.id, failing.id, 0, { status: 'failed' }));
    await store.failQuestion(scope, session.id, failing.id, 'The source did not answer.');
    const after = await store.load(scope, session.id);
    expect(after.turns[1]).toMatchObject({ state: 'error', traceStepIds: [`${failing.id}:0`] });
    expect((await store.loadTrace(scope, session.id)).map((item) => item.status)).toEqual(['ok', 'failed']);
  });

  it('refuses steps for a turn, a session or a project that is not there', async () => {
    const store = investigations();
    const session = await store.create(scope, 'investigation');
    await expect(store.appendTraceStep(scope, step(session.id, 'nope', 0))).rejects.toThrow('no longer available');
    await expect(store.appendTraceStep(otherScope, step(session.id, 'nope', 0))).rejects.toThrow('unavailable in this project');
    await expect(store.updateTraceStep(scope, step(session.id, 'nope', 0))).rejects.toThrow('unavailable in this chat session');
    await expect(store.updateTraceStep(otherScope, step(session.id, 'nope', 0))).rejects.toThrow('unavailable in this project');
    expect(await count('datatug-investigations', 'ChatTraceSteps')).toBe(0);
  });

  it('refuses a step that names a turn of another session, or a step that moves to another turn', async () => {
    const store = investigations();
    const mine = await store.create(scope, 'investigation');
    const theirs = await store.create(scope, 'investigation');
    const theirTurn = await store.appendQuestion(scope, theirs.id, 'theirs');
    await expect(store.appendTraceStep(scope, step(mine.id, theirTurn.id, 0))).rejects.toThrow('no longer available');
    const myTurn = await store.appendQuestion(scope, mine.id, 'mine');
    const added = await store.appendTraceStep(scope, step(mine.id, myTurn.id, 0));
    await expect(store.updateTraceStep(scope, { ...added, turnId: theirTurn.id })).rejects.toThrow('unavailable in this chat session');
    await expect(store.updateTraceStep(scope, { ...added, sessionId: theirs.id })).rejects.toThrow('unavailable in this chat session');
  });

  it('reports steps that are missing or foreign instead of returning a partial trace', async () => {
    const store = investigations();
    const session = await store.create(scope, 'investigation');
    const turn = await store.appendQuestion(scope, session.id, 'q');
    await store.appendTraceStep(scope, step(session.id, turn.id, 0));
    // A step that went missing from its store, behind the service's back.
    const raw = createInvestigationDatabase(factory) as IndexedDbDatabase;
    await raw.runReadwriteTransaction(async (tx) => {
      await tx.delete(key('ChatTraceSteps', `${turn.id}:0`));
    });
    await expect(store.loadTrace(scope, session.id)).rejects.toThrow('missing or foreign trace steps');
  });

  it('reports a step of another session instead of returning it', async () => {
    const store = investigations();
    const session = await store.create(scope, 'investigation');
    const turn = await store.appendQuestion(scope, session.id, 'q');
    await store.appendTraceStep(scope, step(session.id, turn.id, 0));
    await createInvestigationDatabase(factory).runReadwriteTransaction((tx) =>
      tx.set(key('ChatTraceSteps', `${turn.id}:0`), step('another-session', turn.id, 0)));
    await expect(store.loadTrace(scope, session.id)).rejects.toThrow('missing or foreign trace steps');
  });

  it('a turn without steps, or one that is gone, has no trace and does not stop the investigation being deleted', async () => {
    const store = investigations();
    const session = await store.create(scope, 'investigation');
    const quiet = await store.appendQuestion(scope, session.id, 'no steps here');
    const gone = await store.appendQuestion(scope, session.id, 'gone');
    const loud = await store.appendQuestion(scope, session.id, 'steps here');
    await store.appendTraceStep(scope, step(session.id, loud.id, 0));
    expect(quiet.id).not.toBe(loud.id);
    expect((await store.loadTrace(scope, session.id)).map((item) => item.turnId)).toEqual([loud.id]);
    await createInvestigationDatabase(factory).runReadwriteTransaction((tx) => tx.delete(key('ChatTurns', gone.id)));
    expect((await store.loadTrace(scope, session.id)).map((item) => item.turnId)).toEqual([loud.id]);
    await store.delete(scope, session.id);
    expect(await count('datatug-investigations', 'ChatTraceSteps')).toBe(0);
    expect(await store.list(scope)).toEqual([]);
  });

  it('removes the steps when an investigation is cleared or deleted', async () => {
    const store = investigations();
    const session = await store.create(scope, 'investigation');
    const turn = await store.appendQuestion(scope, session.id, 'q');
    await store.appendTraceStep(scope, step(session.id, turn.id, 0));
    await store.appendTraceStep(scope, step(session.id, turn.id, 1));
    expect(await count('datatug-investigations', 'ChatTraceSteps')).toBe(2);
    await store.clear(scope, session.id);
    expect(await store.loadTrace(scope, session.id)).toEqual([]);
    expect(await count('datatug-investigations', 'ChatTraceSteps')).toBe(0);

    const other = await store.create(scope, 'investigation');
    const second = await store.appendQuestion(scope, other.id, 'q2');
    await store.appendTraceStep(scope, step(other.id, second.id, 0));
    await store.delete(scope, other.id);
    expect(await count('datatug-investigations', 'ChatTraceSteps')).toBe(0);
    expect(await count('datatug-investigations', 'ChatTurns')).toBe(0);
    expect((await store.list(scope)).map((s) => s.id)).toEqual([session.id]);
  });

  it('an ordinary chat stays ordinary, and its database cannot take a trace step', async () => {
    const store = chat();
    const session = await store.create(scope);
    expect(session.kind).toBeUndefined();
    expect(session.title).toBe('New chat');
    expect(Object.keys(session)).not.toContain('kind');
    const turn = await store.appendQuestion(scope, session.id, 'q');
    await expect(store.appendTraceStep(scope, step(session.id, turn.id, 0))).rejects.toThrow('collection is not configured');
    const loaded = await store.load(scope, session.id);
    expect(loaded.turns[0].traceStepIds).toBeUndefined();
    // Clearing and deleting a chat does not look for trace steps (there is no such collection to look in).
    await store.clear(scope, session.id);
    await store.delete(scope, session.id);
    expect(await store.list(scope)).toEqual([]);
  });

  it('the first question of an investigation keeps the title it was created with', async () => {
    const store = investigations();
    const session = await store.create(scope, 'investigation', 'Sales per capita');
    await store.appendQuestion(scope, session.id, 'A long question that would otherwise become the title');
    expect((await store.list(scope))[0].title).toBe('Sales per capita');
  });
});

describe('the RecordSet source check', () => {
  const bindFollowUp = (id: string) =>
    JSON.stringify({ where: { op: 'In', left: 'country', right: { recordSet: { id, field: 'country' } } } });

  async function withResult(store: ChatSessionService, source: string, kind?: 'investigation') {
    const session = await store.create(scope, kind);
    const turn = await store.appendQuestion(scope, session.id, 'q');
    const done = await store.completeQuery(scope, session.id, turn.id, result(source));
    return { session, recordSetId: done.recordSetId as string };
  }

  it('an ordinary chat accepts only the Chinook source of its project, as it always did', async () => {
    const store = chat();
    const ok = await withResult(store, `${scope}/chinook`);
    expect((await store.joinParent(scope, ok.session.id, ok.recordSetId)).recordSet.source).toBe(`${scope}/chinook`);
    expect((await store.bindRecordSet(scope, ok.session.id, bindFollowUp(ok.recordSetId))).parentRecordSetId).toBe(ok.recordSetId);

    const other = await withResult(store, `${scope}/web`);
    await expect(store.joinParent(scope, other.session.id, other.recordSetId)).rejects.toThrow('unavailable in this project');
    await expect(store.bindRecordSet(scope, other.session.id, bindFollowUp(other.recordSetId))).rejects.toThrow('unavailable for this data source');
  });

  it('an investigation accepts any source of its own project, and no source of another project', async () => {
    const store = investigations();
    const web = await withResult(store, `${scope}/web`, 'investigation');
    expect((await store.joinParent(scope, web.session.id, web.recordSetId)).recordSet.source).toBe(`${scope}/web`);
    expect((await store.bindRecordSet(scope, web.session.id, bindFollowUp(web.recordSetId))).parentRecordSetId).toBe(web.recordSetId);

    const foreign = await withResult(store, `${otherScope}/web`, 'investigation');
    await expect(store.joinParent(scope, foreign.session.id, foreign.recordSetId)).rejects.toThrow('unavailable in this project');
    await expect(store.bindRecordSet(scope, foreign.session.id, bindFollowUp(foreign.recordSetId))).rejects.toThrow('unavailable for this data source');
    // A source that only starts the same way as the scope is not in it.
    const lookalike = await withResult(store, `${scope}x/web`, 'investigation');
    await expect(store.joinParent(scope, lookalike.session.id, lookalike.recordSetId)).rejects.toThrow('unavailable in this project');
  });
});
