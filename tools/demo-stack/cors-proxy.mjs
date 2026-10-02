#!/usr/bin/env node
/**
 * A tiny CORS shim in front of the local OVDB server, for `pnpm demo:up`.
 *
 * The browser's federated executor pages through OVDB with the request headers OVDB-Page-Size,
 * OVDB-Page-Token and OVDB-Page-Close. ovdb 0.19.0 answers the CORS preflight with
 * `Access-Control-Allow-Headers: Authorization,Content-Type` only, so a browser on another origin
 * (the app at localhost:4200) is refused before the first row. This proxy answers the preflight with the
 * headers the executor uses and forwards everything else untouched.
 *
 * Remove it when OVDB's own CORS handling allows the OVDB-Page-* headers (hosted OVDB needs the same fix).
 *
 *   node cors-proxy.mjs --listen 50501 --upstream 50511 --origin http://localhost:4200
 */
import http from 'node:http';

const arg = (name) => process.argv[process.argv.indexOf(`--${name}`) + 1];
const listen = Number(arg('listen'));
const upstream = Number(arg('upstream'));
const allowed = new Set(String(arg('origin') || '').split(',').filter(Boolean));
if (!listen || !upstream) { console.error('usage: cors-proxy.mjs --listen <port> --upstream <port> --origin <origin[,origin]>'); process.exit(2); }

const ALLOW_HEADERS = 'Authorization,Content-Type,Accept,OVDB-Page-Size,OVDB-Page-Token,OVDB-Page-Close';

http.createServer((request, response) => {
  const origin = request.headers.origin;
  const cors = origin && allowed.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET,HEAD,POST', 'Access-Control-Allow-Headers': ALLOW_HEADERS, 'Access-Control-Max-Age': '600' });
    response.end();
    return;
  }
  const forward = http.request({ host: '127.0.0.1', port: upstream, path: request.url, method: request.method, headers: { ...request.headers, host: `127.0.0.1:${upstream}` } }, (reply) => {
    response.writeHead(reply.statusCode ?? 502, { ...reply.headers, ...cors });
    reply.pipe(response);
  });
  forward.on('error', () => { response.writeHead(502, cors); response.end(); });
  request.pipe(forward);
}).listen(listen, '127.0.0.1', () => console.log(`cors-proxy 127.0.0.1:${listen} -> 127.0.0.1:${upstream}`));
