import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

async function consentPage(saved, storageFails = false) {
  const html = await read('../dist/index.html');
  assert.doesNotMatch(html, /<script[^>]+src="https:\/\/www\.googletagmanager/);
  const source = html.match(
    /<script[^>]*id="incidentius-analytics-consent"[^>]*>([\s\S]*?)<\/script>/,
  )?.[1];
  assert.ok(source, 'Built consent script must be present');
  const elements = new Map();
  const clicks = new Map();
  const requests = [];
  const window = { dataLayer: [] };
  let ready;
  const button = (id) => ({ addEventListener: (_, fn) => clicks.set(id, fn) });
  const document = {
    readyState: 'loading',
    addEventListener: (_, fn) => {
      ready = fn;
    },
    getElementById: (id) => elements.get(id),
    createElement: () => ({
      id: '',
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      remove() {
        elements.delete(this.id);
      },
    }),
    head: { appendChild: (script) => requests.push(script.src) },
    body: {
      appendChild: (element) => {
        elements.set(element.id, element);
        for (const id of ['ga-accept', 'ga-decline'])
          elements.set(id, button(id));
      },
    },
  };
  runInNewContext(source, {
    window,
    document,
    location: {
      origin: 'https://incidentius.com',
      pathname: '/',
      search: '?private=value',
      hash: '#private',
    },
    localStorage: {
      getItem() {
        if (storageFails) throw new Error('Storage unavailable');
        return saved;
      },
      setItem(_, value) {
        if (storageFails) throw new Error('Storage unavailable');
        saved = value;
      },
    },
  });
  assert.equal(
    requests.length,
    0,
    'No analytics while the document is loading',
  );
  ready();
  return { requests, window, elements, clicks, saved: () => saved };
}

for (const saved of [undefined, 'invalid']) {
  test(`analytics waits for explicit acceptance with preference ${saved}`, async () => {
    const page = await consentPage(saved);
    assert.equal(page.requests.length, 0);
    assert.equal(page.window.dataLayer.length, 0);
    assert.ok(page.elements.has('ga-consent-banner'));
    assert.equal(
      page.elements.get('ga-consent-banner').attributes.role,
      'dialog',
    );
    page.clicks.get('ga-accept')();
    page.clicks.get('ga-accept')();
    assert.deepEqual(page.requests, [
      'https://www.googletagmanager.com/gtag/js?id=G-3YFSWSX4T2',
    ]);
    assert.equal(page.saved(), 'granted');
    assert.equal(page.elements.has('ga-consent-banner'), false);
    const config = page.window.dataLayer.find((entry) => entry[0] === 'config');
    assert.equal(config[2].page_location, 'https://incidentius.com/');
  });
}

test('declining analytics stays off after reload', async () => {
  const page = await consentPage();
  page.clicks.get('ga-decline')();
  assert.equal(page.saved(), 'denied');
  assert.equal(page.requests.length, 0);
  const reloaded = await consentPage(page.saved());
  assert.equal(reloaded.requests.length, 0);
  assert.equal(reloaded.elements.has('ga-consent-banner'), false);
});

test('previous explicit acceptance loads only the dedicated analytics property', async () => {
  const page = await consentPage('granted');
  assert.deepEqual(page.requests, [
    'https://www.googletagmanager.com/gtag/js?id=G-3YFSWSX4T2',
  ]);
  assert.equal(page.elements.has('ga-consent-banner'), false);
});

test('unavailable preference storage does not enable analytics', async () => {
  const page = await consentPage(undefined, true);
  assert.equal(page.requests.length, 0);
  assert.ok(page.elements.has('ga-consent-banner'));
  page.clicks.get('ga-decline')();
  assert.equal(page.requests.length, 0);
});

test('built home is indexable, honest, and useful without client JavaScript', async () => {
  const html = await read('../dist/index.html');

  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/incidentius\.com\/"/,
  );
  assert.match(html, /href="https:\/\/app\.incidentius\.com"/);
  assert.match(html, /Open Incidentius/);
  assert.doesNotMatch(html, /coming soon/i);
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
