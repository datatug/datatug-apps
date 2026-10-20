const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { once } = require('node:events');
const config = require('./public-ovdb-proxy.cjs');
const route = '/__datatug_public_ovdb/cloud';
const entry = config[`^${route}(?:/|$)`];
const request = (overrides = {}) => ({
  socket: { remoteAddress: '127.0.0.1', localPort: 4330 },
  headers: {
    host: '127.0.0.1:4330',
    origin: 'http://127.0.0.1:4330',
    'content-type': 'application/json',
  },
  method: 'POST',
  url: route + '/v1/dtql',
  ...overrides,
});
function admitted(req) {
  const response = {
    end() {
      this.writableEnded = true;
    },
  };
  const result = entry.bypass(req, response);
  return result === undefined && !response.writableEnded;
}

test('Business preview pairs its environment replacement with the closed public OVDB proxy', () => {
  const project = JSON.parse(
    readFileSync(
      resolve(__dirname, '../apps/datatug-app/project.json'),
      'utf8',
    ),
  );
  const serve = project.targets.serve;
  const preview = serve.configurations['business-preview'];
  assert.equal(preview.buildTarget, 'datatug-app:build:business-preview');
  assert.equal(preview.port, 18782);
  assert.equal(preview.proxyConfig, 'tools/public-ovdb-proxy.cjs');
  assert.equal(
    preview.proxyConfig,
    serve.configurations.development.proxyConfig,
  );
  assert.ok(
    project.targets.build.configurations[
      'business-preview'
    ].fileReplacements.some(
      ({ replace, with: replacement }) =>
        replace === 'apps/datatug-app/src/environments/environment.ts' &&
        replacement ===
          'apps/datatug-app/src/environments/environment.business-preview.ts',
    ),
  );
  // Keep this transport opt-in: production and SSO do not inherit a dev proxy.
  assert.equal(serve.options?.proxyConfig, undefined);
  assert.equal(serve.configurations.production.proxyConfig, undefined);
  assert.equal(serve.configurations['sso-e2e'].proxyConfig, undefined);
  assert.equal(entry.target, 'https://cloud.openvaultdb.com');
  assert.equal(entry.followRedirects, false);
  assert.equal(admitted(request()), true);
  assert.equal(
    admitted(
      request({
        headers: { ...request().headers, authorization: 'Bearer private' },
      }),
    ),
    false,
  );
  assert.equal(admitted(request({ url: route + '/admin' })), false);
});

test('fixed HTTPS targets, redirect refusal and narrow public route admission', () => {
  assert.equal(entry.target, 'https://cloud.openvaultdb.com');
  assert.equal(
    config['^/__datatug_public_ovdb/demodb(?:/|$)'].target,
    'https://ovdb.demodb.dev',
  );
  assert.equal(entry.followRedirects, false);
  assert.equal(entry.ws, false);
  assert.equal(admitted(request()), true);
  assert.equal(
    admitted(
      request({ method: 'GET', url: route + '/v1/databases/northwind' }),
    ),
    true,
  );
  for (const url of [
    '/admin',
    '/v1/dtql?target=https://evil.test',
    '/v1/../dtql',
    '/v1/databases/a%2Fb/dtql',
    '/v1/databases/a/../../dtql',
  ])
    assert.equal(admitted(request({ url: route + url })), false, url);
  for (const method of ['DELETE', 'PUT', 'OPTIONS', 'PATCH'])
    assert.equal(admitted(request({ method })), false);
});

test('rejects remote addresses, forged browser context, credentials and simple POSTs', () => {
  const base = request();
  for (const remoteAddress of ['192.168.1.2', '8.8.8.8', undefined])
    assert.equal(
      admitted(request({ socket: { ...base.socket, remoteAddress } })),
      false,
    );
  for (const headers of [
    { host: 'evil.test:4330' },
    { host: '127.0.0.1:1111' },
    { host: 'localhost@evil.test:4330' },
    { origin: 'https://datatug.app' },
    { origin: undefined },
    { authorization: 'Bearer private' },
    { cookie: 'session=private' },
    { 'content-type': 'text/plain' },
    { 'sec-fetch-site': 'cross-site' },
  ])
    assert.equal(
      admitted(request({ headers: { ...base.headers, ...headers } })),
      false,
      JSON.stringify(headers),
    );
});

async function fixture(t, handler) {
  const upstream = http.createServer(handler);
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root: '/private/tmp',
    logLevel: 'silent',
    server: {
      host: '127.0.0.1',
      port: 0,
      proxy: {
        [`^${route}(?:/|$)`]: {
          ...entry,
          target: `http://127.0.0.1:${upstream.address().port}`,
          secure: false,
        },
      },
    },
  });
  await server.listen();
  t.after(async () => {
    await server.close();
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  return {
    origin,
    headers: {
      Origin: origin,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  };
}

test('normal POST completion preserves streamed response and intended headers', async (t) => {
  let received;
  const { origin, headers } = await fixture(t, (req, res) => {
    let body = '';
    req.on('data', (data) => {
      body += data;
    });
    req.on('end', () => {
      received = { body, headers: req.headers, path: req.url };
      res.setHeader('Set-Cookie', 'upstream=must-not-be-set');
      res.write('first');
      setTimeout(() => res.end('-last'), 40);
    });
  });
  const response = await fetch(origin + route + '/v1/dtql', {
    method: 'POST',
    headers: { ...headers, 'X-Private': 'never-forward' },
    body: '{"query":"public"}',
  });
  assert.equal(await response.text(), 'first-last');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(received.path, '/v1/dtql');
  assert.equal(received.body, '{"query":"public"}');
  assert.equal(received.headers.origin, origin);
  assert.equal(received.headers.accept, 'application/json');
  assert.equal(received.headers['x-private'], undefined);
  assert.equal(received.headers.authorization, undefined);
  assert.equal(received.headers.cookie, undefined);
});

test('disconnect after POST body completion cancels the pending upstream response', async (t) => {
  let bodyComplete = false;
  let resolveClosed;
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  const { origin, headers } = await fixture(t, (req, res) => {
    req.resume();
    req.on('end', () => {
      bodyComplete = true;
      res.write('first');
      res.once('close', resolveClosed);
    });
  });
  const response = await fetch(origin + route + '/v1/dtql', {
    method: 'POST',
    headers,
    body: '{}',
  });
  const reader = response.body.getReader();
  await reader.read();
  assert.equal(bodyComplete, true);
  await reader.cancel();
  await Promise.race([
    closed,
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error('upstream response was not cancelled')),
        2000,
      );
      timer.unref();
    }),
  ]);
});

test('proxy returns upstream refusal/redirect without following it', async (t) => {
  let count = 0;
  const { origin, headers } = await fixture(t, (_req, res) => {
    count++;
    res.writeHead(302, { Location: 'https://evil.test/private' });
    res.end();
  });
  const response = await fetch(origin + route + '/v1/dtql', {
    method: 'POST',
    headers,
    body: '{}',
    redirect: 'manual',
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://evil.test/private');
  assert.equal(count, 1);
});

test('reserves the proxy namespace and keeps production serve unproxied', () => {
  const blocked = config['^/__datatug_public_ovdb(?:/|$)'];
  const response = { end() { this.writableEnded = true; } };
  blocked.bypass(request({ url: '/__datatug_public_ovdb/arbitrary/v1/dtql' }), response);
  assert.equal(response.statusCode, 403);
  assert.equal(response.writableEnded, true);
  const project = require('../apps/datatug-app/project.json');
  assert.equal(project.targets.serve.configurations.development.proxyConfig, 'tools/public-ovdb-proxy.cjs');
  assert.equal(project.targets.serve.configurations.development.host, '127.0.0.1');
  assert.equal(project.targets.serve.configurations.production.proxyConfig, undefined);
});
