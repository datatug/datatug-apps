import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('built home is indexable, honest, and useful without client JavaScript', async () => {
  const html = await read('../dist/index.html');

  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/incidentius\.com\/"/,
  );
  assert.match(html, /href="https:\/\/app\.incidentius\.com"/);
  assert.match(html, /App access (?:—|&mdash;) coming soon/);
  assert.match(
    html,
    /Incidentius is an incident-investigation capability of DataTug/,
  );
  assert.match(html, /Conceptual model (?:—|&mdash;) not a product screenshot/);
  assert.doesNotMatch(html, /<script[^>]+type="module"/);
});

test('build contains a useful noindex not-found page', async () => {
  const html = await read('../dist/404.html');

  assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(
    html,
    /Incidentius helps teams investigate incidents from evidence and preserve a defensible resolution record\./,
  );
  assert.doesNotMatch(html, /"description":"The requested Incidentius page/);
  assert.match(html, /This path does not support the hypothesis/);
  assert.match(html, /href="\/"/);
  assert.doesNotMatch(html, /hreflang=/);
});

test('worker config owns only the Incidentius apex domain', async () => {
  const source = await read('../wrangler.jsonc');
  const config = JSON.parse(source.replace(/,\s*([}\]])/g, '$1'));

  assert.equal(config.name, 'incidentius-landing');
  assert.deepEqual(config.routes, [
    { pattern: 'incidentius.com', custom_domain: true },
  ]);
  assert.equal(config.assets.not_found_handling, '404-page');
  assert.doesNotMatch(source, /datatug\.app|app\.incidentius\.com/);
});
