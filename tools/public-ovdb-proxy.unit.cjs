// node --test tools/public-ovdb-proxy.unit.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const proxy = require('./public-ovdb-proxy.cjs');

const fakeRes = () => {
  const res = { statusCode: 0, headers: {}, body: '', ended: false };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.end = (b) => { res.body = b ?? ''; res.ended = true; };
  return res;
};
const request = (url, extra = {}) => ({
  url,
  method: 'GET',
  headers: { host: '127.0.0.1:4200' },
  socket: { remoteAddress: '127.0.0.1', localPort: 4200 },
  ...extra,
});
const entries = () => Object.entries(proxy).filter(([key]) => key.includes('cloud') || key.includes('demodb'));

test('offline mode answers 403 for every public OVDB route and never lets the request through', () => {
  process.env.DATATUG_PUBLIC_OVDB_UPSTREAM = 'refuse';
  try {
    assert.equal(entries().length, 2);
    for (const [key, config] of entries()) {
      const res = fakeRes();
      const target = config.target;
      // a perfectly admissible request, exactly what the app sends
      const path = `/__datatug_public_ovdb/${key.includes('cloud') ? 'cloud' : 'demodb'}/v1/databases/chinook-postgresql`;
      const outcome = config.bypass(request(path), res);
      assert.equal(res.statusCode, 403, key);
      assert.equal(res.ended, true, 'the response is complete, so the dev server does not forward it');
      assert.equal(res.headers['x-datatug-ovdb-refused'], target);
      assert.equal(outcome, path, 'a non-undefined return tells the dev server the request is handled');
    }
  } finally {
    delete process.env.DATATUG_PUBLIC_OVDB_UPSTREAM;
  }
});

test('without the offline switch an admissible request is still forwarded (development unchanged)', () => {
  delete process.env.DATATUG_PUBLIC_OVDB_UPSTREAM;
  const [, config] = entries().find(([key]) => key.includes('cloud'));
  const res = fakeRes();
  const outcome = config.bypass(request('/__datatug_public_ovdb/cloud/v1/databases/chinook-postgresql'), res);
  assert.equal(outcome, undefined);
  assert.equal(res.ended, false);
});

test('the proxy only ever targets the two public OVDB hosts', () => {
  assert.deepEqual(entries().map(([, c]) => c.target).sort(), ['https://cloud.openvaultdb.com', 'https://ovdb.demodb.dev']);
});
