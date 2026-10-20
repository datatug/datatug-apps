import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playwrightDecodableHeaders } from './live-fetch-headers.ts';

test('zstd is never advertised on a passed-through live request', () => {
  const out = playwrightDecodableHeaders({
    accept: 'application/json',
    'accept-encoding': 'gzip, deflate, br, zstd',
  });
  assert.equal(out['accept-encoding'], 'gzip, deflate, br');
  assert.doesNotMatch(out['accept-encoding'] ?? '', /zstd/);
  assert.equal(out['accept'], 'application/json');
});

test('a request without accept-encoding, or with a differently cased one, ends with exactly one', () => {
  assert.equal(
    playwrightDecodableHeaders({})['accept-encoding'],
    'gzip, deflate, br',
  );
  const out = playwrightDecodableHeaders({ 'Accept-Encoding': 'zstd' });
  assert.deepEqual(Object.keys(out), ['accept-encoding']);
  assert.equal(out['accept-encoding'], 'gzip, deflate, br');
});
