import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the app worker preserves DataTug and serves the Incidentius app hostname', async () => {
  const source = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(source);

  assert.deepEqual(config.routes, [
    { pattern: 'datatug.app', custom_domain: true },
    { pattern: 'app.incidentius.com', custom_domain: true },
  ]);
});
