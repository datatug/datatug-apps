import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((channel) => parseInt(channel, 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function cssVariable(css, name) {
  return css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function consentPage(saved, storageFails = false, locale = 'en') {
  const html = await read(locale === 'ru' ? '../dist/ru/index.html' : '../dist/index.html');
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
    documentElement: { lang: locale },
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

test('both homepages are localized, indexable and honest about development', async () => {
  for (const [locale, path, status, navLabel, canonical] of [
    ['en', '../dist/index.html', 'Incidentius is in development', 'Investigations', 'https://incidentius.com/'],
    ['ru', '../dist/ru/index.html', 'Incidentius в разработке', 'Расследования', 'https://incidentius.com/ru/'],
  ]) {
    const html = await read(path);
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}"`));
    assert.ok(html.includes(status));
    assert.ok(html.includes(navLabel));
    assert.match(html, new RegExp(`<html[^>]+lang="${locale}"`));
    assert.match(html, /incidentius-harbor-800\.webp/);
    assert.match(html, new RegExp(`href="/${locale}/investigations/"`));
    assert.ok(html.includes(`href="${locale === 'en' ? '/ru/' : '/'}"`));
    assert.doesNotMatch(html, /app\.incidentius\.com|Open Incidentius|Start using Incidentius/i);
  }
});

test('mobile home hero leads with the artwork and keeps navigation in an accessible disclosure', async () => {
  const layout = await read('../src/layouts/BaseLayout.astro');
  const css = await read('../src/styles/global.css');

  assert.match(layout, /createElement\('details'\)/);
  assert.match(layout, /aria-label/);
  assert.match(layout, /event\.key === 'Escape'/);
  assert.match(layout, /matchMedia\('\(max-width: 1199px\)'\)/);
  assert.match(css, /\.site-header \.incidentius-mobile-nav\[open\] \.primary/);
  assert.match(css, /\.hero-art img \{ width: 100%; border: 0; border-radius: 0;/);
  assert.match(css, /:lang\(ru\) \.home-heading h1 \{ font-size: clamp\(/);
  assert.doesNotMatch(css, /art-caption|caption-desktop|caption-mobile/);

  for (const [locale, path, menuLabel, imageAlt] of [
    ['en', '../dist/index.html', 'Open site navigation', 'Illustration of a lighthouse, open logbook and evidence map at a safe harbor'],
    ['ru', '../dist/ru/index.html', 'Открыть меню сайта', 'Маяк, раскрытый журнал и карта доказательств в безопасной гавани'],
  ]) {
    const html = await read(path);
    const heading = html.indexOf('class="home-heading"');
    const art = html.indexOf('<figure class="hero-art">');
    const supportingCopy = html.indexOf('class="home-details"');
    assert.ok(heading >= 0 && heading < art && art < supportingCopy, `${locale} places the image between heading and details`);
    assert.ok(html.includes(`data-mobile-menu-label="${menuLabel}"`), `${locale} menu has a localized accessible label`);
    assert.ok(html.includes('incidentius-harbor-800.webp'));
    assert.ok(html.includes(`alt="${imageAlt}"`), `${locale} retains descriptive image alternative text`);
    assert.doesNotMatch(html, /art-caption|caption-desktop|caption-mobile|Concept art, not a product screenshot|Concept illustration · not a product screenshot|Концепт-арт, не скриншот продукта|Концепт-иллюстрация · не скриншот продукта/);
  }
});

test('desktop home hero fills the viewport with the harbor behind localized copy', async () => {
  const css = await read('../src/styles/global.css');
  const desktopRule = css.match(/@media \(min-width: 1200px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const tabletRule = css.match(/@media \(min-width: 901px\) and \(max-width: 1199px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';

  assert.match(desktopRule, /\.home-hero \{ display: grid; min-height: clamp\(/);
  assert.match(desktopRule, /\.home-grid \{ z-index: 2; width: 100%; max-width: none;/);
  assert.match(desktopRule, /\.hero-art \{ position: absolute; z-index: 0; inset: 0; grid-area: auto;/);
  assert.match(desktopRule, /\.hero-art::after \{ position: absolute; z-index: 1; inset: 0; background: linear-gradient\(/);
  assert.match(desktopRule, /\.home-heading, \.home-details \{ position: relative; z-index: 2;/);
  assert.match(desktopRule, /object-fit: cover; object-position: center 52%/);
  assert.match(tabletRule, /grid-template-areas: 'heading' 'art' 'details'/);
  assert.match(tabletRule, /\.hero-art \{ position: relative;/);

  for (const [locale, path] of [
    ['en', '../dist/index.html'],
    ['ru', '../dist/ru/index.html'],
  ]) {
    const html = await read(path);
    assert.match(html, new RegExp(`<html[^>]+lang="${locale}"`));
    assert.match(html, /<section class="home-hero">[\s\S]*?<figure class="hero-art">[\s\S]*?incidentius-harbor/);
    assert.match(html, /class="home-heading"[\s\S]*?class="home-details"/);
    assert.match(html, /class="button primary"/);
    assert.match(html, /class="button secondary"/);
  }
});

test('all eight interior routes localize navigation, metadata, and product copy', async () => {
  const pages = [
    ['investigations', 'en', 'Investigation method', 'Incidentius is in development'],
    ['context', 'en', 'Context & evidence', 'Incidentius is in development'],
    ['checks', 'en', 'Checks & validators', 'Incidentius is in development'],
    ['platform', 'en', 'DataTug foundation', 'Incidentius is in development'],
    ['investigations', 'ru', 'Метод расследования', 'Продукт в разработке'],
    ['context', 'ru', 'Контекст и доказательства', 'Продукт в разработке'],
    ['checks', 'ru', 'Проверки и валидаторы', 'Продукт в разработке'],
    ['platform', 'ru', 'Основа DataTug', 'Продукт в разработке'],
  ];

  for (const [slug, locale, label, status] of pages) {
    const html = await read(`../dist/${locale}/${slug}/index.html`);
    const canonical = `https://incidentius.com/${locale}/${slug}/`;
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}"`), `${locale}/${slug} canonical`);
    assert.ok(html.includes(status), `${locale}/${slug} status`);
    assert.ok(html.includes(label.replaceAll('&', '&amp;')), `${locale}/${slug} localized label`);
    assert.match(html, new RegExp(`<html[^>]+lang="${locale}"`));
    assert.equal((html.match(/<main\b/g) || []).length, 1, `${locale}/${slug} has one main landmark`);
    const nav = html.match(/<nav[^>]+aria-label="(?:Primary navigation|Основная навигация)"[\s\S]*?<\/nav>/)?.[0];
    const footer = html.match(/<footer[\s\S]*?<\/footer>/)?.[0];
    assert.ok(nav, `${locale}/${slug} has navigation`);
    assert.ok(footer, `${locale}/${slug} has shared footer`);
    for (const navSlug of ['investigations', 'context', 'checks', 'platform']) {
      const href = `/${locale}/${navSlug}/`;
      assert.ok(nav.includes(`href="${href}"`), `${locale}/${slug} header links to ${href}`);
      assert.ok(footer.includes(`href="${href}"`), `${locale}/${slug} footer links to ${href}`);
    }
    const alternate = locale === 'en' ? 'ru' : 'en';
    assert.ok(html.includes(`href="/${alternate}/${slug}/"`), `${locale}/${slug} has a matching language switch`);
    const related = html.match(/<nav[^>]+aria-label="(?:Related pages|Связанные страницы)"[\s\S]*?<\/nav>/)?.[0];
    assert.ok(related, `${locale}/${slug} has related page links`);
    for (const [relatedSlug, relatedLabel] of [
      ['investigations', locale === 'en' ? 'Investigation method' : 'Метод расследования'],
      ['context', locale === 'en' ? 'Context & evidence' : 'Контекст и доказательства'],
      ['checks', locale === 'en' ? 'Checks & validators' : 'Проверки и валидаторы'],
      ['platform', locale === 'en' ? 'DataTug foundation' : 'Основа DataTug'],
    ]) {
      if (relatedSlug === slug) continue;
      const expectedAnchor = new RegExp(`<a[^>]*href="${escapeRegExp(`/${locale}/${relatedSlug}/`)}"[^>]*>${escapeRegExp(relatedLabel.replaceAll('&', '&amp;'))}(?:\\s|<)`);
      assert.match(related, expectedAnchor, `${locale}/${slug} related link target and label ${relatedSlug}`);
    }
    assert.doesNotMatch(html, /app\.incidentius\.com|Open Incidentius|Start using Incidentius/i);
  }
});

test('Russian analytics consent uses Russian controls and copy', async () => {
  const page = await consentPage(undefined, false, 'ru');
  assert.equal(page.requests.length, 0);
  assert.ok(page.elements.has('ga-consent-banner'));
  assert.equal(page.elements.get('ga-consent-banner').attributes['aria-label'], 'Настройки файлов cookie');
});

test('small text and primary actions retain readable contrast', async () => {
  const css = await read('../src/styles/global.css');
  const footer = css.match(/\.site-footer\s*\{([^}]+)\}/)?.[1];
  assert.ok(footer, 'footer palette must be scoped to the dark footer surface');

  const background = cssVariable(css, 'color-bg');
  const bodyText = cssVariable(css, 'color-text');
  const mutedText = cssVariable(css, 'color-text-muted');
  const accentText = cssVariable(css, 'color-accent-strong');
  const buttonBackground = accentText;
  const footerBackground = cssVariable(css, 'color-soft');
  const footerText = footer.match(/--color-text:\s*(#[0-9a-f]{6})/i)?.[1];
  const footerMuted = footer.match(/--color-text-muted:\s*(#[0-9a-f]{6})/i)?.[1];

  for (const [label, foreground, surface] of [
    ['body copy', bodyText, background],
    ['muted copy and navigation', mutedText, background],
    ['accent text links', accentText, background],
    ['primary button text', '#ffffff', buttonBackground],
    ['footer brand text', footerText, footerBackground],
    ['footer links', footerMuted, footerBackground],
    ['skip link text', '#ffffff', buttonBackground],
  ]) {
    assert.ok(contrast(foreground, surface) >= 4.5, `${label} must meet 4.5:1 contrast`);
  }
});

test('build contains a useful noindex not-found page', async () => {
  const html = await read('../dist/404.html');

  assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(
    html,
    /Incidentius is in development/,
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
