import { describe, expect, it } from 'vitest';
import {
  isAgentStoreId,
  parseDatatugStoreRef,
  storeIdToDisplayLabel,
} from './nav-models';

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

  it('still delegates an http- prefixed store id (no port) to @sneat/core', () => {
    expect(parseDatatugStoreRef('http-example.com')).toEqual({
      type: 'agent',
      url: 'http://example.com',
    });
  });

  // Regression: `datatug serve` (datatug-cli PR #198) prints the web link
  // as `http-<host>:<port>` — WITH a port. `HOST_PORT_STORE_ID` used to
  // match this form too (a `-` is not excluded by its character class),
  // short-circuiting before `parseStoreRef()` ever ran, so `.url` came
  // back as the raw dash-prefixed id instead of a real `http://` URL.
  it('converts an http- prefixed host:port store id (as printed by `datatug serve`) to a real URL', () => {
    expect(parseDatatugStoreRef('http-localhost:8989')).toEqual({
      type: 'agent',
      url: 'http://localhost:8989',
    });
  });

  it('converts an https- prefixed host:port store id to a real URL', () => {
    expect(parseDatatugStoreRef('https-agent.example.com:8443')).toEqual({
      type: 'agent',
      url: 'https://agent.example.com:8443',
    });
  });

  it('converts an http- prefixed configured non-localhost host:port store id to a real URL', () => {
    expect(parseDatatugStoreRef('http-192.168.1.10:8989')).toEqual({
      type: 'agent',
      url: 'http://192.168.1.10:8989',
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

describe('storeIdToDisplayLabel', () => {
  // A bare host:port id has no explicit scheme to show (its `.url` from
  // `parseDatatugStoreRef` is the id unchanged, per the `HOST_PORT_STORE_ID`
  // short-circuit) — there is no correct scheme to invent for display, so
  // it is shown as-is, same as `getStoreUrl()` (`@sneat/api`) treats it as
  // protocol-relative rather than assuming one.
  it('shows a bare host:port agent store unchanged, with no scheme to display', () => {
    expect(storeIdToDisplayLabel('localhost:8989')).toBe('localhost:8989');
  });

  it('shows an http-prefixed host:port agent store as a real URL', () => {
    expect(storeIdToDisplayLabel('http-localhost:8989')).toBe(
      'http://localhost:8989',
    );
  });

  it('shows an https-prefixed host:port agent store as a real URL', () => {
    expect(storeIdToDisplayLabel('https-agent.example.com:8443')).toBe(
      'https://agent.example.com:8443',
    );
  });

  it('shows a configured non-localhost host:port agent store as a real URL', () => {
    expect(storeIdToDisplayLabel('http-192.168.1.10:8989')).toBe(
      'http://192.168.1.10:8989',
    );
  });

  it('shows the id unchanged for a firestore store, which has no url', () => {
    expect(storeIdToDisplayLabel('firestore')).toBe('firestore');
  });

  it('shows the id unchanged for a github store, which has no url', () => {
    expect(storeIdToDisplayLabel('github.com')).toBe('github.com');
  });

  it('falls back to the raw id for an unparseable store id rather than throwing', () => {
    expect(storeIdToDisplayLabel('not-a-recognised-format')).toBe(
      'not-a-recognised-format',
    );
  });

  it('returns an empty string for a missing store id', () => {
    expect(storeIdToDisplayLabel(undefined)).toBe('');
    expect(storeIdToDisplayLabel(null)).toBe('');
  });
});

describe('isAgentStoreId', () => {
  it.each([
    'localhost:8989',
    '127.0.0.1:8989',
    '192.168.1.10:8989',
    'http-localhost:8989',
    'https-agent.example.com:8443',
    'http-example.com',
  ])('is true for the agent store id %s', (storeId) => {
    expect(isAgentStoreId(storeId)).toBe(true);
  });

  it.each(['firestore', 'github', 'github.com'])(
    'is false for the non-agent store id %s',
    (storeId) => {
      expect(isAgentStoreId(storeId)).toBe(false);
    },
  );

  it('is false, not a throw, for an unparseable store id', () => {
    expect(() => isAgentStoreId('gitlab.example.com')).not.toThrow();
    expect(isAgentStoreId('gitlab.example.com')).toBe(false);
  });

  it('is false for an empty or undefined store id', () => {
    expect(isAgentStoreId('')).toBe(false);
    expect(isAgentStoreId(undefined)).toBe(false);
  });
});
