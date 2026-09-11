import { describe, expect, it } from 'vitest';
import { getStoreId, parseDatatugStoreRef } from '../nav/nav-models';
import {
  allUserStoresAsFlatList,
  isLocalhostAgentStoreId,
  LOCALHOST_AGENT_STORE_ID,
  LOCALHOST_AGENT_URL,
} from './interfaces';

describe('allUserStoresAsFlatList', () => {
  // Regression: the default local-agent store used to be keyed by its full
  // URL (`http://localhost:8989`), which `parseDatatugStoreRef()` rejects,
  // so choosing "localhost:8989" on the home page threw
  // `unsupported format of store id:http://localhost:8989` in `goStore()`.
  it('adds the default localhost agent store with a parseable canonical id', () => {
    const stores = allUserStoresAsFlatList(undefined);
    const local = stores.find((s) => s.id === LOCALHOST_AGENT_STORE_ID);
    expect(local).toBeDefined();
    expect(local?.type).toBe('agent');
    expect(local?.url).toBe(LOCALHOST_AGENT_URL);
    expect(local?.title).toBe('localhost:8989');
    expect(parseDatatugStoreRef(local?.id)).toEqual({
      type: 'agent',
      url: LOCALHOST_AGENT_URL,
    });
  });

  it('round-trips the default localhost agent id through the route-segment form', () => {
    const ref = parseDatatugStoreRef(LOCALHOST_AGENT_STORE_ID);
    expect(getStoreId(ref.url as string)).toBe(LOCALHOST_AGENT_STORE_ID);
  });

  it.each([
    'http-localhost:8989',
    'localhost:8989',
    'http://localhost:8989',
  ])('does not add a second localhost store when the user already has %s', (id) => {
    const stores = allUserStoresAsFlatList({
      [id]: { type: 'agent', title: 'my agent' },
    });
    const localhostStores = stores.filter((s) => isLocalhostAgentStoreId(s.id));
    expect(localhostStores.map((s) => s.id)).toEqual([id]);
  });

  it('always includes the cloud and GitHub stores', () => {
    const ids = allUserStoresAsFlatList(undefined).map((s) => s.id);
    expect(ids).toContain('firestore');
    expect(ids).toContain('github.com');
  });

  // S165: a user record may still hold a legacy full-URL key predating
  // PR #109's switch to the canonical dash-prefixed id.
  // `allUserStoresAsFlatList()` already recognises it as "a localhost store
  // exists" (via `isLocalhostAgentStoreId()`, tested above), but
  // `MyStoresComponent.goStore()` → `parseDatatugStoreRef(brief.id)` used to
  // throw for it regardless (founder, 2026-09-11 follow-up 5). Assert the
  // flattened entry's id now parses without throwing.
  it('produces an entry whose legacy full-URL id parses without throwing', () => {
    const stores = allUserStoresAsFlatList({
      'http://localhost:8989': { type: 'agent', title: 'my agent' },
    });
    const local = stores.find((s) => s.id === 'http://localhost:8989');
    expect(local).toBeDefined();
    expect(() => parseDatatugStoreRef(local?.id)).not.toThrow();
    expect(parseDatatugStoreRef(local?.id)).toEqual({
      type: 'agent',
      url: 'http://localhost:8989',
    });
  });
});

describe('isLocalhostAgentStoreId', () => {
  it.each([
    ['http-localhost:8989', true],
    ['https-localhost:8443', true],
    ['localhost:8989', true],
    ['http://localhost:8989', true],
    ['http-192.168.1.10:8989', false],
    ['github.com', false],
    ['firestore', false],
  ])('%s → %s', (id, expected) => {
    expect(isLocalhostAgentStoreId(id)).toBe(expected);
  });
});
