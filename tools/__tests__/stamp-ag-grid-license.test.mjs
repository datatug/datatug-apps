import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generatedSource,
  keyFromEnvFile,
  resolveKey,
} from '../stamp-ag-grid-license.mjs';

test('no key anywhere gives an empty (community-only) key', () => {
  assert.equal(resolveKey({}, ''), '');
  assert.equal(resolveKey({ AG_GRID_LICENSE_KEY: '  ' }, undefined), '');
});

test('environment wins over .env.local', () => {
  assert.equal(
    resolveKey({ AG_GRID_LICENSE_KEY: 'from-env' }, 'AG_GRID_LICENSE_KEY=file'),
    'from-env',
  );
});

test('reads quoted and exported .env.local values', () => {
  assert.equal(
    keyFromEnvFile('X=1\nexport AG_GRID_LICENSE_KEY="abc def"\n'),
    'abc def',
  );
  assert.equal(keyFromEnvFile("AG_GRID_LICENSE_KEY='k'"), 'k');
});

test('generated source escapes the key as a string literal', () => {
  assert.match(generatedSource('a"b'), /= "a\\"b";/);
  assert.match(generatedSource(''), /= "";/);
});
