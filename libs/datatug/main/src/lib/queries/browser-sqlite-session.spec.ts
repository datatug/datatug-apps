import { vi } from 'vitest';
import { BrowserSqliteSession } from './browser-sqlite-query.service';

interface FakeWorker {
  onmessage?: (event: MessageEvent) => void;
  onerror?: () => void;
  posted: { id: number; sql: string }[];
  terminated: boolean;
}

describe('BrowserSqliteSession', () => {
  let created: FakeWorker[];
  beforeEach(() => {
    created = [];
    vi.stubGlobal('Worker', class {
      onmessage?: (event: MessageEvent) => void;
      onerror?: () => void;
      posted: { id: number; sql: string }[] = [];
      terminated = false;
      constructor() { created.push(this); }
      postMessage(message: { id: number; sql: string }): void { this.posted.push(message); }
      terminate(): void { this.terminated = true; }
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const reply = (worker: FakeWorker, id: number, rows: unknown[][] = []) =>
    worker.onmessage?.({ data: { ok: true, result: { columns: ['a'], rows }, id } } as MessageEvent);
  const message = (sql: string) => ({ sql, bindings: [], fixture: new Uint8Array([1]) });

  it('runs every statement on one worker and routes replies by id', async () => {
    const session = new BrowserSqliteSession();
    const dispatched = vi.fn();
    const first = session.run(message('select 1'), undefined, dispatched);
    const second = session.run(message('select 2'));
    expect(created).toHaveLength(1);
    const [a, b] = created[0].posted;
    reply(created[0], b.id, [[2]]);
    reply(created[0], a.id, [[1]]);
    reply(created[0], 999);
    created[0].onmessage?.({ data: undefined } as MessageEvent);
    await expect(first).resolves.toMatchObject({ result: { rows: [[1]] } });
    await expect(second).resolves.toMatchObject({ result: { rows: [[2]] } });
    expect(dispatched).toHaveBeenCalledTimes(1);
  });

  it('discards a cancelled statement\'s reply and keeps the worker', async () => {
    const session = new BrowserSqliteSession();
    const controller = new AbortController();
    const cancelled = session.run(message('select 1'), controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    reply(created[0], created[0].posted[0].id);
    await expect(session.run(message('x'), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const next = session.run(message('select 2'));
    reply(created[0], created[0].posted[1].id, [[2]]);
    await expect(next).resolves.toMatchObject({ ok: true });
    expect(created).toHaveLength(1);
    expect(created[0].terminated).toBe(false);
  });

  it('replaces the worker after a timeout or a worker failure', async () => {
    vi.useFakeTimers();
    const session = new BrowserSqliteSession();
    const slow = session.run(message('select 1'));
    const other = session.run(message('select 2'));
    vi.advanceTimersByTime(10_001);
    await expect(slow).rejects.toThrow(/exceeded 10 seconds/u);
    await expect(other).rejects.toThrow(/interrupted|exceeded/u);
    expect(created[0].terminated).toBe(true);
    const failing = session.run(message('select 3'));
    expect(created).toHaveLength(2);
    created[1].onerror?.();
    await expect(failing).rejects.toThrow(/worker failed/u);
    expect(created[1].terminated).toBe(true);
  });

  it('downloads a fixture once, retries a failed download, and refuses work once closed', async () => {
    const session = new BrowserSqliteSession();
    const read = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(new Uint8Array([7]));
    await expect(session.fixture('k', read)).rejects.toThrow('offline');
    await expect(session.fixture('k', read)).resolves.toEqual(new Uint8Array([7]));
    await expect(session.fixture('k', read)).resolves.toEqual(new Uint8Array([7]));
    expect(read).toHaveBeenCalledTimes(2);
    const pending = session.run(message('select 1'));
    session.close();
    await expect(pending).rejects.toThrow(/closed/u);
    expect(created[0].terminated).toBe(true);
    await expect(session.fixture('k', read)).rejects.toThrow(/closed/u);
    await expect(session.run(message('select 2'))).rejects.toThrow(/closed/u);
  });

  it('says when the browser has no workers', async () => {
    vi.stubGlobal('Worker', undefined);
    expect(() => new BrowserSqliteSession().run(message('select 1'))).toThrow(/does not support SQLite query workers/u);
  });
});
