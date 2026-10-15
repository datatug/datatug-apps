import { describe, expect, it } from 'vitest';
import { ovdbTypeOfDeclared, storageModifiedFlag } from './local-demodb-host';

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
