// Development-only Angular/Vite transport. No arbitrary target or credentials.
const loopbacks = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const hosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
const prefix = '/__datatug_public_ovdb/';

function admitted(req, route) {
  if (!loopbacks.has(req.socket.remoteAddress)) return false;
  const host = req.headers.host;
  if (typeof host !== 'string') return false;
  let local;
  try {
    local = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (
    !hosts.has(local.hostname) ||
    local.username ||
    local.password ||
    local.pathname !== '/' ||
    local.search ||
    local.hash ||
    local.port !== String(req.socket.localPort)
  )
    return false;
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== local.origin) return false;
  if (
    req.headers['sec-fetch-site'] === 'cross-site' ||
    req.headers.authorization !== undefined ||
    req.headers.cookie !== undefined
  )
    return false;
  const path = req.url;
  if (typeof path !== 'string' || !path.startsWith(route)) return false;
  const relative = path.slice(route.length);
  if (req.method === 'GET')
    return /^\/v1\/databases\/[A-Za-z0-9_-]+$/.test(relative);
  if (
    req.method !== 'POST' ||
    origin === undefined ||
    !/^\/v1\/(?:dtql|databases\/[A-Za-z0-9_-]+\/dtql)$/.test(relative)
  )
    return false;
  return /^(?:application\/(?:json|yaml)|text\/yaml)(?:\s*;.*)?$/i.test(
    req.headers['content-type'] ?? '',
  );
}

function publicProxy(route, target) {
  return {
    target,
    secure: true,
    changeOrigin: true,
    ws: false,
    followRedirects: false,
    proxyTimeout: 30_000,
    timeout: 30_000,
    bypass(req, res) {
      if (admitted(req, route)) return undefined;
      res.statusCode = 403;
      res.end('Public OVDB development transport refused this request.');
      return req.url; // Vite exits here because the response is already complete.
    },
    rewrite(path) {
      return path.slice(route.length);
    },
    configure(proxy) {
      proxy.on('proxyReq', (upstream, req, res) => {
        const allowed = new Set([
          'host',
          'accept',
          'content-type',
          'content-length',
          'origin',
          'ovdb-page-snapshot',
          'ovdb-page-offset',
          'ovdb-page-limit',
          'ovdb-page-close',
        ]);
        for (const name of upstream.getHeaderNames()) {
          if (!allowed.has(name.toLowerCase())) upstream.removeHeader(name);
        }
        // IncomingMessage.close also fires for normal POST completion. Only a
        // body abort or an unfinished outgoing response signals cancellation.
        const abort = () => {
          cleanup();
          upstream.destroy();
        };
        const responseClosed = () => {
          if (!res.writableFinished) abort();
          else cleanup();
        };
        const cleanup = () => {
          req.off('aborted', abort);
          res.off('close', responseClosed);
          res.off('finish', cleanup);
        };
        req.once('aborted', abort);
        res.once('close', responseClosed);
        res.once('finish', cleanup);
      });
      proxy.on('proxyRes', (response) => {
        delete response.headers['set-cookie'];
      });
    },
  };
}

module.exports = {
  [`^${prefix}cloud(?:/|$)`]: publicProxy(
    `${prefix}cloud`,
    'https://cloud.openvaultdb.com',
  ),
  [`^${prefix}demodb(?:/|$)`]: publicProxy(
    `${prefix}demodb`,
    'https://ovdb.demodb.dev',
  ),
  // Reserve the namespace: unknown target enums never fall through to the SPA.
  [`^${prefix.slice(0, -1)}(?:/|$)`]: {
    target: 'https://cloud.openvaultdb.com', ws: false,
    bypass(req, res) {
      res.statusCode = 403;
      res.end('Unknown public OVDB development route.');
      return req.url;
    },
  },
};
