import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const origin = 'https://incidentius.com';
const routes = ['', 'ru/', ...['en', 'ru'].flatMap((locale) =>
  ['investigations', 'context', 'checks', 'platform'].map((page) => `${locale}/${page}/`))];
const dist = new URL('../dist/', import.meta.url);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function verify() {
  for (const route of routes) {
    const expected = await readFile(new URL(`${route}index.html`, dist), 'utf8');
    const response = await fetch(`${origin}/${route}`, { signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200, `${route || '/'} status`);
    const html = await response.text();
    // Match the build's page identity and content, while allowing edge-added markup.
    for (const pattern of [/<title>.*?<\/title>/s, /<h1\b[^>]*>.*?<\/h1>/s]) {
      const fragment = expected.match(pattern)?.[0];
      assert.ok(fragment, `built ${route} has ${pattern}`);
      assert.ok(html.includes(fragment), `live ${route} matches the built page identity`);
    }
    assert.match(html, route.startsWith('ru/') ? /в разработке/i : /in development/i, `${route} discloses product readiness`);
    assert.doesNotMatch(html, /href="https:\/\/app\.incidentius\.com/, `${route} avoids a premature workspace CTA`);
  }
  const asset = 'illustrations/incidentius-harbor.webp';
  const response = await fetch(`${origin}/${asset}`, { signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200, 'hero asset status');
  assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(await readFile(new URL(asset, dist))), 'live hero matches this build');
  const missing = await fetch(`${origin}/__incidentius-deployment-check-missing__`, { signal: AbortSignal.timeout(15_000) });
  assert.equal(missing.status, 404, 'unknown routes serve a real 404');
}

for (let attempt = 1; ; attempt += 1) {
  try {
    await verify();
    console.log('Incidentius deployment verified: ten localized pages, future-product status, exact hero asset, and 404.');
    break;
  } catch (error) {
    if (attempt >= 12) throw error;
    console.log(`Waiting for Incidentius deployment propagation (${attempt}/12): ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
