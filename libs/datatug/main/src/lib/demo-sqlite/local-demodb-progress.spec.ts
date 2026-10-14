import { describe, expect, it } from 'vitest';
import { isDemoDbProgressMessage, progressFetch, type DemoDbProgressMessage } from './local-demodb-progress';
import { ovdbTypeOfDeclared, storageModifiedFlag } from './local-demodb-host';

describe('progressFetch', () => {
  it('reports decoded bytes as the body is read, then the install phase', async () => {
    const messages: DemoDbProgressMessage[] = [];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(3));
        controller.enqueue(new Uint8Array(5));
        controller.close();
      },
    });
    const fetch = progressFetch(
      (message) => messages.push(message),
      async () => new Response(body, { headers: { 'content-encoding': 'gzip', 'content-length': '4' } }),
      0,
    );
    const response = await fetch('https://chinook.demodb.dev/data/chinook.sqlite');
    expect(response.headers.get('content-length')).toBeNull();
    expect((await response.arrayBuffer()).byteLength).toBe(8);
    expect(messages.map((m) => (m.phase === 'download' ? m.loaded : 'install'))).toEqual([0, 3, 8, 8, 'install']);
    expect(messages.every(isDemoDbProgressMessage)).toBe(true);
  });

  it('passes failed responses through untouched', async () => {
    const messages: DemoDbProgressMessage[] = [];
    const failed = new Response('nope', { status: 503 });
    const response = await progressFetch((m) => messages.push(m), async () => failed)('x');
    expect(response).toBe(failed);
    expect(messages).toEqual([]);
  });

  it('recognises only its own messages (the sqlite-wasm worker replies carry an id)', () => {
    expect(isDemoDbProgressMessage({ id: 1, ok: true, value: null })).toBe(false);
    expect(isDemoDbProgressMessage({ type: 'datatug/demodb-progress', phase: 'download' })).toBe(false);
    expect(isDemoDbProgressMessage(null)).toBe(false);
  });
});

describe('local OVDB host helpers', () => {
  it('maps SQLite declared types by affinity', () => {
    expect(['INTEGER', 'NVARCHAR(120)', 'NUMERIC(10,2)', 'REAL', 'BLOB', '', 'DATETIME', 'BOOLEAN'].map(ovdbTypeOfDeclared)).toEqual([
      'integer', 'string', 'decimal', 'number', 'blob', 'unknown', 'string', 'boolean',
    ]);
  });

  it('keeps the modified flag per dataset version and survives blocked storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    const flag = storageModifiedFlag('chinook', 'sha-a', storage);
    expect(flag.get()).toBe(false);
    flag.set(true);
    expect(storageModifiedFlag('chinook', 'sha-a', storage).get()).toBe(true);
    // A new pinned version replaces the old copy and its edits.
    expect(storageModifiedFlag('chinook', 'sha-b', storage).get()).toBe(false);
    flag.set(false);
    expect(values.size).toBe(0);
    const blocked = storageModifiedFlag('chinook', 'sha-a', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    });
    blocked.set(true);
    expect(blocked.get()).toBe(true);
  });
});
