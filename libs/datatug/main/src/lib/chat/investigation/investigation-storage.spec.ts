import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { IndexedDbDatabase } from '@dalgo/indexeddb';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHAT_SESSION_DATABASE, ChatSessionService } from '../chat-session.service';
import type { TraceStep } from '../chat-trace.types';
import {
  createInvestigationDatabase,
  INVESTIGATION_COLLECTIONS,
  INVESTIGATION_DATABASE,
  INVESTIGATION_DATABASE_NAME,
  INVESTIGATION_DATABASE_VERSION,
  InvestigationStorage,
} from './investigation-storage';

const scope = JSON.stringify(['github.com', 'chinook-demo@datatug@']);
const CHAT = 'datatug-chat-sessions';
const MAIN_CHAT_COLLECTIONS = ['ChatSessions', 'ChatTurns', 'ChatQueries', 'ChatRecordSets', 'ChatBookmarks'];

const realIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB') as PropertyDescriptor;
/** A fresh browser profile: nothing stored, `indexedDB` is this factory. Every database object made after it uses it. */
function newProfile(): IDBFactory {
  const factory = new IDBFactory();
  Object.defineProperty(globalThis, 'indexedDB', { value: factory, configurable: true, writable: true });
  TestBed.resetTestingModule();
  return factory;
}
beforeEach(() => {
  newProfile();
});
afterEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', realIndexedDb);
});

/** `main`'s build of the chat database, written out the way `main`'s `CHAT_SESSION_DATABASE` has always been. */
const mainsChatDatabase = () =>
  new IndexedDbDatabase({ name: CHAT, version: 2, collections: MAIN_CHAT_COLLECTIONS });

/** `main`'s chat page storage: its service over its database. A new call is a new page load. */
function mainsChat(): ChatSessionService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: CHAT_SESSION_DATABASE, useValue: mainsChatDatabase() }] });
  return TestBed.inject(ChatSessionService);
}

/** This build's chat page storage, over the real definition (`CHAT_SESSION_DATABASE` as the app provides it). */
function thisBuildsChat(): ChatSessionService {
  TestBed.resetTestingModule();
  return TestBed.inject(ChatSessionService);
}

const names = async () =>
  (await indexedDB.databases()).map((d) => `${d.name}@${d.version}`).sort();

/** Every record of every object store of a database, read with plain IndexedDB, and the store names. */
async function dump(name: string): Promise<{ stores: string[]; records: Record<string, unknown[]> }> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    const stores = [...db.objectStoreNames].sort();
    const records: Record<string, unknown[]> = {};
    for (const store of stores) {
      records[store] = await new Promise<unknown[]>((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return { stores, records };
  } finally {
    db.close();
  }
}

/** Chats as `main`'s build makes them: one with a finished result and a bookmark, one waiting, one empty. */
async function writeChatsWithMainsBuild(): Promise<string[]> {
  const main = mainsChat();
  const answered = await main.create(scope);
  const turn = await main.appendQuestion(scope, answered.id, 'Sales by country?');
  await main.completeQuery(scope, answered.id, turn.id, {
    dtql: 'from: {}', generatedDtql: '', dtqlYaml: 'from: {}', sql: 'select 1',
    rows: [{ country: 'Ireland', sales: 12 }], columns: ['country', 'sales'],
    metrics: { requestBytes: 1, responseBytes: 2, interpretMs: 3, queryMs: 4 }, source: `${scope}/chinook`,
  });
  const waiting = await main.create(scope);
  await main.appendQuestion(scope, waiting.id, 'Which albums?');
  const empty = await main.create(scope);
  await main.rename(scope, empty.id, 'Empty one');
  return [answered.id, waiting.id, empty.id];
}

const traceStep = (sessionId: string, turnId: string, index: number): TraceStep => ({
  id: `${turnId}:${index}`, sessionId, turnId, index, kind: 'execute', status: 'ok',
  message: { key: 'step.execute.done', params: { rows: 24 } }, evidence: [], startedAt: '2026-10-03T10:00:00.000Z',
});

/** This build runs one investigation, through the storage the way a later task will. */
async function runAnInvestigation(): Promise<{ sessionId: string; turnId: string }> {
  const sessions = await TestBed.inject(InvestigationStorage).sessions();
  if (!sessions) throw new Error('the investigation storage should be there');
  const session = await sessions.create(scope, 'investigation', 'scenario:sales-per-capita');
  const turn = await sessions.appendQuestion(scope, session.id, 'Sales per capita?');
  await sessions.appendTraceStep(scope, traceStep(session.id, turn.id, 0));
  await sessions.completeQuery(scope, session.id, turn.id, {
    dtql: 'from: {}', generatedDtql: '', dtqlYaml: 'from: {}', sql: '', rows: [{ country: 'Iceland', perCapita: 9 }],
    columns: ['country', 'perCapita'], metrics: { requestBytes: 0, responseBytes: 0, interpretMs: 0, queryMs: 1 },
    source: `${scope}/web`,
  });
  return { sessionId: session.id, turnId: turn.id };
}

describe('the databases (design 6.6): the chat one is main\'s, the investigation one is new', () => {
  it('the chat database is defined as main defines it: version 2, five collections, no trace', () => {
    TestBed.resetTestingModule();
    const db = TestBed.inject(CHAT_SESSION_DATABASE) as IndexedDbDatabase;
    expect(db.name).toBe(CHAT);
    expect(db.version).toBe(2);
    const reference = mainsChatDatabase() as unknown as { storeNames(): string[] };
    expect((db as unknown as { storeNames(): string[] }).storeNames()).toEqual(reference.storeNames());
    expect(reference.storeNames()).toEqual(MAIN_CHAT_COLLECTIONS);
  });

  it('the investigation database is its own, version 1, with the chat collections and the trace steps', () => {
    const db = createInvestigationDatabase() as IndexedDbDatabase;
    expect(db.name).toBe('datatug-investigations');
    expect(INVESTIGATION_DATABASE_NAME).toBe('datatug-investigations');
    expect(db.version).toBe(1);
    expect(INVESTIGATION_DATABASE_VERSION).toBe(1);
    expect([...INVESTIGATION_COLLECTIONS]).toEqual([...MAIN_CHAT_COLLECTIONS, 'ChatTraceSteps']);
    expect((db as unknown as { storeNames(): string[] }).storeNames()).toEqual([...INVESTIGATION_COLLECTIONS]);
  });

  it('creating nothing opens nothing: a browser that never asks for an investigation never gets the database', async () => {
    TestBed.inject(InvestigationStorage);
    TestBed.inject(INVESTIGATION_DATABASE);
    thisBuildsChat();
    expect(await names()).toEqual([]);
  });
});

describe('forward (design 6.6 rule 4): this build opens what main\'s build wrote', () => {
  it('lists every chat main wrote, loads each, and keeps writing to them, in a database still at version 2', async () => {
    const ids = await writeChatsWithMainsBuild();
    const before = await dump(CHAT);
    expect(before.stores).toEqual([...MAIN_CHAT_COLLECTIONS].sort());

    const now = thisBuildsChat();
    const listed = await now.list(scope);
    expect(listed.map((s) => s.id).sort()).toEqual([...ids].sort());
    expect(listed.find((s) => s.title === 'Empty one')).toBeTruthy();
    const [answered, waiting] = [await now.load(scope, ids[0]), await now.load(scope, ids[1])];
    expect(answered.turns[0]).toMatchObject({ question: 'Sales by country?', state: 'result', rows: [{ country: 'Ireland', sales: 12 }] });
    expect(answered.turns[0].traceStepIds).toBeUndefined();
    expect(waiting.turns[0]).toMatchObject({ question: 'Which albums?', state: 'error' }); // interrupted, as main shows it
    const follow = await now.appendQuestion(scope, ids[2], 'A new question in an old chat');
    expect(follow.question).toBe('A new question in an old chat');

    expect(await names()).toEqual([`${CHAT}@2`]);
    expect((await dump(CHAT)).stores).toEqual(before.stores);
  });

  it('runs an investigation next to them without touching them: only a database is added', async () => {
    const ids = await writeChatsWithMainsBuild();
    const before = await dump(CHAT);
    const chatBefore = await names();

    await thisBuildsChat().list(scope);
    await runAnInvestigation();

    expect(await names()).toEqual([...chatBefore, `${INVESTIGATION_DATABASE_NAME}@${INVESTIGATION_DATABASE_VERSION}`].sort());
    expect(await dump(CHAT)).toEqual(before);
    expect((await thisBuildsChat().list(scope)).map((s) => s.id).sort()).toEqual([...ids].sort());
  });
});

describe('back (design 6.6 rule 4): a profile in which this build ran an investigation, opened by main\'s build', () => {
  async function profileAfterAnInvestigation() {
    const ids = await writeChatsWithMainsBuild();
    const chatBefore = await dump(CHAT);
    // The new build's chat page is visited (it opens the chat database), an investigation runs, the chat page is visited again.
    await thisBuildsChat().list(scope);
    const investigation = await runAnInvestigation();
    await thisBuildsChat().list(scope);
    return { ids, chatBefore, investigation };
  }

  it('main\'s chat page opens, lists exactly the chats it had, loads each and shows no error', async () => {
    const { ids } = await profileAfterAnInvestigation();

    // The chat page of `main`: its own definition at version 2, which knows nothing of the other database.
    const main = mainsChat();
    const listed = await main.list(scope);
    expect(listed.map((s) => s.id).sort()).toEqual([...ids].sort());
    expect(listed.every((s) => s.kind === undefined)).toBe(true);
    for (const id of ids) {
      const { turns } = await main.load(scope, id);
      expect(turns.filter((t) => t.error && t.state === 'error' && t.question !== 'Which albums?')).toEqual([]);
    }
    // A plain open at version 2 is not refused (that is what a version 3 would have caused).
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(CHAT, 2);
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });
    // And it can write: a chat still works.
    expect((await main.appendQuestion(scope, ids[2], 'after rollback')).state).toBe('loading');
  });

  it('this build with the investigation unused (the flag off) lists exactly the same chats, and shows no investigation', async () => {
    const { ids } = await profileAfterAnInvestigation();
    const now = thisBuildsChat();
    const listed = await now.list(scope);
    expect(listed.map((s) => s.id).sort()).toEqual([...ids].sort());
    expect(listed.some((s) => s.kind === 'investigation')).toBe(false);
  });

  it('nothing of the investigation is in the chat database: same stores, same records, same version', async () => {
    const { chatBefore, investigation } = await profileAfterAnInvestigation();
    const chatAfter = await dump(CHAT);
    expect(chatAfter).toEqual(chatBefore);
    expect(chatAfter.stores).not.toContain('ChatTraceSteps');
    expect(JSON.stringify(chatAfter.records)).not.toContain(investigation.sessionId);
    expect(JSON.stringify(chatAfter.records)).not.toContain('investigation');
    expect(await names()).toEqual([`${CHAT}@2`, `${INVESTIGATION_DATABASE_NAME}@1`].sort());

    // Everything of the investigation is in its own database.
    const own = await dump(INVESTIGATION_DATABASE_NAME);
    expect(own.stores).toEqual([...INVESTIGATION_COLLECTIONS].sort());
    expect(own.records['ChatSessions']).toHaveLength(1);
    expect(own.records['ChatTurns']).toHaveLength(1);
    expect(own.records['ChatRecordSets']).toHaveLength(1);
    expect(own.records['ChatQueries']).toHaveLength(1);
    expect(own.records['ChatTraceSteps']).toHaveLength(1);
  });

  it('the investigation survives a reload of the page, in its own database', async () => {
    const { investigation } = await profileAfterAnInvestigation();
    TestBed.resetTestingModule();
    const sessions = await TestBed.inject(InvestigationStorage).sessions();
    if (!sessions) throw new Error('the investigation storage should be there');
    const listed = await sessions.list(scope);
    expect(listed.map((s) => s.id)).toEqual([investigation.sessionId]);
    const { turns } = await sessions.load(scope, investigation.sessionId);
    expect(turns[0]).toMatchObject({ state: 'result', rows: [{ country: 'Iceland', perCapita: 9 }] });
    expect(await sessions.loadTrace(scope, investigation.sessionId)).toHaveLength(1);
  });
});

describe('storage that is missing, refusing or foreign means no investigation storage, never a failed start', () => {
  const chatStillWorks = async () => {
    const now = thisBuildsChat();
    const session = await now.create(scope);
    expect((await now.list(scope)).map((s) => s.id)).toEqual([session.id]);
  };

  it('with the investigation database present, it answers with the sessions, once, and keeps the answer', async () => {
    const storage = TestBed.inject(InvestigationStorage);
    const first = storage.sessions();
    expect(storage.sessions()).toBe(first);
    expect(await first).toBeInstanceOf(ChatSessionService);
    expect(await first).not.toBe(thisBuildsChat());
  });

  it('is no storage when the browser has no IndexedDB', async () => {
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true, writable: true });
    TestBed.resetTestingModule();
    expect(await TestBed.inject(InvestigationStorage).sessions()).toBeUndefined();
  });

  it('is no storage when the browser refuses even to hand out IndexedDB (blocked site data), and the app starts', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
      configurable: true,
    });
    TestBed.resetTestingModule();
    expect(TestBed.inject(INVESTIGATION_DATABASE)).toBeUndefined();
    expect(await TestBed.inject(InvestigationStorage).sessions()).toBeUndefined();
  });

  it('is no storage when opening the database fails (private mode, disk full, denied)', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: INVESTIGATION_DATABASE, useValue: createInvestigationDatabase(failingFactory()) }] });
    expect(await TestBed.inject(InvestigationStorage).sessions()).toBeUndefined();
  });

  it('is no storage when a later build raised the version of the database (the open is refused), and chat is unaffected', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(INVESTIGATION_DATABASE_NAME, 2);
      req.onupgradeneeded = () => {
        for (const name of INVESTIGATION_COLLECTIONS) req.result.createObjectStore(name, { keyPath: 'path' });
      };
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });
    TestBed.resetTestingModule();
    expect(await TestBed.inject(InvestigationStorage).sessions()).toBeUndefined();
    await chatStillWorks();
  });

  it('is no storage when the database of that name is another application\'s, without the collections this build needs', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(INVESTIGATION_DATABASE_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('something-else', { keyPath: 'id' });
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });
    TestBed.resetTestingModule();
    expect(await TestBed.inject(InvestigationStorage).sessions()).toBeUndefined();
    // Nothing of it was changed.
    expect((await dump(INVESTIGATION_DATABASE_NAME)).stores).toEqual(['something-else']);
    await chatStillWorks();
  });

  it('keeps saying no for the rest of the visit, without opening again', async () => {
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true, writable: true });
    TestBed.resetTestingModule();
    const storage = TestBed.inject(InvestigationStorage);
    const first = storage.sessions();
    // Storage coming back later in the visit does not change the answer.
    Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true, writable: true });
    expect(storage.sessions()).toBe(first);
    expect(await first).toBeUndefined();
  });
});

/** An IndexedDB whose every open fails with an error event, the way a denied or full profile does. */
function failingFactory(): IDBFactory {
  return {
    open: () => {
      const listeners: Record<string, ((event: Event) => void)[]> = {};
      const request = {
        error: new DOMException('denied', 'UnknownError'),
        addEventListener: (type: string, listener: (event: Event) => void) => {
          (listeners[type] ??= []).push(listener);
        },
      };
      queueMicrotask(() => (listeners['error'] ?? []).forEach((listener) => listener(new Event('error'))));
      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}
