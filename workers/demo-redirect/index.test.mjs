import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';
import { DEMO_URL, REDIRECT_STATUS, demoRedirectLocation } from './redirect.mjs';

const visit = (url, init) => worker.fetch(new Request(url, init));

test('the root redirects to datatug.app/demo', async () => {
  const response = await visit('https://demo.datatug.app/');
  assert.equal(response.status, REDIRECT_STATUS);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://datatug.app/demo');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), '');
});

test('the path and the query string are kept', () => {
  for (const [from, to] of [
    ['https://demo.datatug.app', 'https://datatug.app/demo'],
    ['https://demo.datatug.app/?utm_source=x&utm_medium=y', 'https://datatug.app/demo?utm_source=x&utm_medium=y'],
    ['https://demo.datatug.app/sqlite', 'https://datatug.app/demo/sqlite'],
    ['https://demo.datatug.app/sqlite/chinook?a=1', 'https://datatug.app/demo/sqlite/chinook?a=1'],
    ['https://demo.datatug.app/?q=hello%20world&lang=ru', 'https://datatug.app/demo?q=hello%20world&lang=ru'],
    ['http://demo.datatug.app/x', 'https://datatug.app/demo/x'],
  ])
    assert.equal(demoRedirectLocation(from), to, from);
});

test('nothing in the request can change the destination host', () => {
  for (const url of [
    'https://demo.datatug.app//evil.example/x',
    'https://demo.datatug.app/@evil.example',
    'https://demo.datatug.app/%2F%2Fevil.example',
    'https://demo.datatug.app/?next=https://evil.example',
  ]) {
    const location = demoRedirectLocation(url);
    assert.ok(location.startsWith(DEMO_URL), location);
    assert.equal(new URL(location).host, 'datatug.app', url);
  }
});

test('every method is redirected, a HEAD as well', async () => {
  for (const method of ['GET', 'HEAD', 'POST']) {
    const response = await visit('https://demo.datatug.app/?a=1', { method });
    assert.equal(response.status, 302, method);
    assert.equal(response.headers.get('location'), 'https://datatug.app/demo?a=1', method);
  }
});

test('the entry module exports only the handler: the Workers runtime refuses any other named export', async () => {
  assert.deepEqual(Object.keys(await import('./index.mjs')), ['default']);
});
