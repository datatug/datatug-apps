// Foreground server owned and stopped by the dedicated Watch Playwright lane.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist/apps/datatug-app/browser');
const port = Number(process.env.DATATUG_WATCH_UI_PORT || 18843);
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};
await stat(path.join(root, 'index.html'));
const server = createServer(async (req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }
  let file;
  try {
    file = path.resolve(
      root,
      '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname),
    );
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (!file.startsWith(root + path.sep) && file !== root) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error();
  } catch {
    if (path.extname(file)) {
      res.writeHead(404).end();
      return;
    }
    file = path.join(root, 'index.html');
  }
  try {
    res
      .writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      .end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
server.listen(port, '127.0.0.1');
for (const event of ['SIGTERM', 'SIGINT'])
  process.on(event, () => server.close(() => process.exit(0)));
