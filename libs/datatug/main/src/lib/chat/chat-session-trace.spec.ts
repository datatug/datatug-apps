import 'fake-indexeddb/auto';
import { Injector, runInInjectionContext } from '@angular/core';
import { IndexedDbDatabase } from '@dalgo/indexeddb';
import { describe, expect, it } from 'vitest';
import { CHAT_SESSION_DATABASE, ChatSessionService } from './chat-session.service';
import type { TraceStep } from './chat-trace.types';

const scope = JSON.stringify(['demo', 'datatug-demo-project']);
const collections = ['ChatSessions', 'ChatTurns', 'ChatQueries', 'ChatRecordSets', 'ChatBookmarks', 'ChatTraceSteps'];

let counter = 0;
function service(name = `trace-spec-${++counter}`, version = 3): ChatSessionService {
  const database = new IndexedDbDatabase({ name, version, collections: version >= 3 ? collections : collections.slice(0, 5) });
  return runInInjectionContext(Injector.create({ providers: [{ provide: CHAT_SESSION_DATABASE, useValue: database }] }), () => new ChatSessionService());
}

const step = (sessionId: string, turnId: string, index: number, over: Partial<TraceStep> = {}): TraceStep => ({
  id: `${turnId}:${index}`, sessionId, turnId, index, kind: 'understand', status: 'ok',
  message: { key: 'step.understand.recognised', params: { plan: 'p' } }, evidence: [], startedAt: '2026-10-02T10:00:00.000Z', ...over,
});

describe('investigation trace in the chat session store', () => {
  it('stores steps with the turn, in order, and loads them back after a restart', async () => {
    const name = `trace-reload-${++counter}`;
    const first = service(name);
    const session = await first.create(scope, 'investigation', 'scenario:x');
    const turn = await first.appendQuestion(scope, session.id, 'Which countries?');
    await first.appendTraceStep(scope, step(session.id, turn.id, 0));
    const running = await first.appendTraceStep(scope, step(session.id, turn.id, 1, { kind: 'execute', status: 'running' }));
    await first.updateTraceStep(scope, { ...running, status: 'ok', durationMs: 646 });
    await first.appendTraceStep(scope, step(session.id, turn.id, 2, { kind: 'present' }));

    const reopened = service(name);
    const restored = await reopened.load(scope, session.id);
    expect(restored.session.kind).toBe('investigation');
    expect(restored.turns[0].traceStepIds).toEqual([`${turn.id}:0`, `${turn.id}:1`, `${turn.id}:2`]);
    const trace = await reopened.loadTrace(scope, session.id);
    expect(trace.map((item) => [item.index, item.kind, item.status])).toEqual([[0, 'understand', 'ok'], [1, 'execute', 'ok'], [2, 'present', 'ok']]);
    expect(trace[1].durationMs).toBe(646);
  });

  it('keeps the steps when the turn completes with its result', async () => {
    const store = service();
    const session = await store.create(scope, 'investigation');
    const turn = await store.appendQuestion(scope, session.id, 'q');
    await store.appendTraceStep(scope, step(session.id, turn.id, 0));
    await store.completeQuery(scope, session.id, turn.id, { dtql: 'from: {}', generatedDtql: '', dtqlYaml: 'from: {}', sql: '', rows: [{ country: 'Ireland' }], columns: ['country'], metrics: { requestBytes: 0, responseBytes: 0, interpretMs: 0, queryMs: 1 }, source: 'demo:x' });
    const loaded = await store.load(scope, session.id);
    expect(loaded.turns[0]).toMatchObject({ state: 'result', rows: [{ country: 'Ireland' }], traceStepIds: [`${turn.id}:0`] });
    expect(await store.loadTrace(scope, session.id)).toHaveLength(1);
  });

  it('refuses steps for a turn or session that is not there', async () => {
    const store = service();
    const session = await store.create(scope, 'investigation');
    await expect(store.appendTraceStep(scope, step(session.id, 'nope', 0))).rejects.toThrow('no longer available');
    await expect(store.appendTraceStep(JSON.stringify(['other', 'project']), step(session.id, 'nope', 0))).rejects.toThrow('unavailable in this project');
    await expect(store.updateTraceStep(scope, step(session.id, 'nope', 0))).rejects.toThrow('unavailable in this chat session');
  });

  it('removes the steps when the chat is cleared or deleted', async () => {
    const store = service();
    const session = await store.create(scope, 'investigation');
    const turn = await store.appendQuestion(scope, session.id, 'q');
    await store.appendTraceStep(scope, step(session.id, turn.id, 0));
    await store.clear(scope, session.id);
    expect(await store.loadTrace(scope, session.id)).toEqual([]);

    const other = await store.create(scope, 'investigation');
    const second = await store.appendQuestion(scope, other.id, 'q2');
    await store.appendTraceStep(scope, step(other.id, second.id, 0));
    await store.delete(scope, other.id);
    expect(await store.list(scope)).toHaveLength(1);
  });

  it('ordinary chats stay ordinary', async () => {
    const store = service();
    const session = await store.create(scope);
    expect(session.kind).toBeUndefined();
    expect(session.title).toBe('New chat');
  });

  it('upgrades a version 2 database in place: old sessions and bookmarks survive and the trace collection appears', async () => {
    const name = `trace-upgrade-${++counter}`;
    const old = service(name, 2);
    const session = await old.create(scope);
    const turn = await old.appendQuestion(scope, session.id, 'an old question');
    await old.completeQuery(scope, session.id, turn.id, { dtql: 'd', generatedDtql: '', dtqlYaml: 'd', sql: '', rows: [{ a: 1 }], columns: ['a'], metrics: { requestBytes: 0, responseBytes: 0, interpretMs: 0, queryMs: 1 }, source: 'old' });

    const upgraded = service(name, 3);
    const restored = await upgraded.load(scope, session.id);
    expect(restored.turns[0]).toMatchObject({ question: 'an old question', rows: [{ a: 1 }] });
    expect(await upgraded.loadTrace(scope, session.id)).toEqual([]);
    const next = await upgraded.appendQuestion(scope, session.id, 'a new one');
    await upgraded.appendTraceStep(scope, step(session.id, next.id, 0));
    expect(await upgraded.loadTrace(scope, session.id)).toHaveLength(1);
  });
});
