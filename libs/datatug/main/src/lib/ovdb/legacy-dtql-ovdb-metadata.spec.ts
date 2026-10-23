import { describe, expect, it } from 'vitest';
import {
  capabilityListOffersTugql,
  tugqlEndpoint,
  tugqlQueryFormat,
  withTugqlCapabilities,
} from './legacy-dtql-ovdb-metadata';

describe('legacy dtql OVDB metadata (removed in TugQL cutover step 9)', () => {
  it('reads old-only capabilities as tugql', () => {
    expect(withTugqlCapabilities({ dtql: true, dtqlStreaming: true, dtqlStreamingErrors: true, read: true })).toMatchObject({
      tugql: true, tugqlStreaming: true, tugqlStreamingErrors: true, read: true,
    });
  });
  it('reads new-only capabilities unchanged', () => {
    const caps = { tugql: true, tugqlStreaming: false };
    expect(withTugqlCapabilities(caps)).toEqual(caps);
  });
  it('lets tugql win when both are advertised', () => {
    expect(withTugqlCapabilities({ tugql: false, dtql: true })).toMatchObject({ tugql: false });
    expect(withTugqlCapabilities({ tugql: true, dtql: false })).toMatchObject({ tugql: true });
  });
  it('recognises either name in a capability list', () => {
    expect(capabilityListOffersTugql(['read', 'dtql'])).toBe(true);
    expect(capabilityListOffersTugql(['tugql'])).toBe(true);
    expect(capabilityListOffersTugql(['read'])).toBe(false);
  });
  it('picks the endpoint, always on the /tugql route', () => {
    expect(tugqlEndpoint({ dtql: 'https://x.test/v1/databases/chinook/dtql' })).toBe('https://x.test/v1/databases/chinook/tugql');
    expect(tugqlEndpoint({ tugql: 'https://x.test/a/tugql' })).toBe('https://x.test/a/tugql');
    expect(tugqlEndpoint({ tugql: 'https://x.test/new/tugql', dtql: 'https://x.test/old/dtql' })).toBe('https://x.test/new/tugql');
    expect(tugqlEndpoint({})).toBeUndefined();
    expect(tugqlEndpoint(undefined)).toBeUndefined();
  });
  it('accepts either query format name', () => {
    expect(tugqlQueryFormat('dtql-yaml+json')).toBe('tugql-yaml+json');
    expect(tugqlQueryFormat('tugql-yaml+json')).toBe('tugql-yaml+json');
    expect(tugqlQueryFormat('dtql-yaml')).toBe('tugql-yaml');
    expect(tugqlQueryFormat(undefined)).toBeUndefined();
  });
});
