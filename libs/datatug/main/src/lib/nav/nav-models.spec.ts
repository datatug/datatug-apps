import { describe, expect, it } from 'vitest';
import { parseDatatugStoreRef } from './nav-models';

describe('parseDatatugStoreRef', () => {
  it('accepts a bare host:port store id as an agent store', () => {
    expect(parseDatatugStoreRef('localhost:8989')).toEqual({
      type: 'agent',
      url: 'localhost:8989',
    });
  });

  it('accepts a remote host:port store id', () => {
    expect(parseDatatugStoreRef('192.168.1.10:8989')).toEqual({
      type: 'agent',
      url: '192.168.1.10:8989',
    });
  });

  it('still delegates the firestore store id to @sneat/core', () => {
    expect(parseDatatugStoreRef('firestore')).toEqual({ type: 'firestore' });
  });

  it('still delegates the github store id to @sneat/core', () => {
    expect(parseDatatugStoreRef('github.com')).toEqual({ type: 'github' });
  });

  it('still delegates an http- prefixed store id to @sneat/core', () => {
    expect(parseDatatugStoreRef('http-example.com')).toEqual({
      type: 'agent',
      url: 'http://example.com',
    });
  });

  it('still throws for a genuinely unsupported store id', () => {
    expect(() => parseDatatugStoreRef('not-a-recognised-format')).toThrow(
      'unsupported format of store id:not-a-recognised-format',
    );
  });

  it('still throws for an undefined store id, matching @sneat/core', () => {
    expect(() => parseDatatugStoreRef(undefined)).toThrow(
      'storeId is a required parameter',
    );
  });
});
