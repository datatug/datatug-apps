import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BrowserPlatformLocation,
  Location,
  PlatformLocation,
} from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import * as Sentry from '@sentry/browser';
import posthog from 'posthog-js';
import { datatugAppEnvironmentConfig } from '../environments/environment.prod';
import {
  captureDemoHandoff,
  DEMO_HANDOFF_KEY,
  resetDemoHandoffForTests,
} from './demo-handoff-capture';
import { routes } from './datatug-app-routes';

/**
 * The visitor's question must not leave the browser in any analytics or error report. These tests play a
 * hand-off the way a browser would (index.html's inline script, then the first statement of main.ts), then start
 * the real reporters with the production configuration and record what each of them would send.
 */
const MARKER = 'ZEBRA-SECRET-QUESTION-7731';
const QUESTION = `Which countries ${MARKER} listen to jazz?`;
const HANDOFF_URL = `https://datatug.app/demo?scenario=jazz-artists&q=${encodeURIComponent(QUESTION)}&lang=en`;

interface HappyDomWindow {
  happyDOM: { setURL(url: string): void };
}

/** Everything a reporter might leak the question in: the plain text and the common encodings of it. */
function leaks(payload: unknown): string[] {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return [
    MARKER,
    encodeURIComponent(MARKER),
    'q=' + encodeURIComponent('Which'),
    'q=Which',
    'jazz-artists',
  ].filter((needle) => text.includes(needle));
}

function playHandoff(url: string): void {
  (window as unknown as HappyDomWindow).happyDOM.setURL(url);
  const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
  const stash =
    /<script id="datatug-handoff-stash">([\s\S]*?)<\/script>/.exec(html)?.[1] ??
    '';
  new Function(stash)(); // index.html, first script in <head>: runs on the real location and history
  captureDemoHandoff(); // main.ts, first statement
}

describe('the visitor question never reaches an analytics or error report', () => {
  beforeEach(() => {
    resetDemoHandoffForTests();
    window.sessionStorage.clear();
    delete (window as unknown as Record<string, unknown>)[
      '__datatugHandoffSearch'
    ];
  });

  it('the address bar is clean before anything else runs', () => {
    playHandoff(HANDOFF_URL);
    expect(window.location.href).toBe('https://datatug.app/demo');
    expect(window.history.length).toBeGreaterThan(0);
  });

  it('a Sentry event, breadcrumbs and a navigation breadcrumb carry neither the question nor the scenario', async () => {
    playHandoff(HANDOFF_URL);
    const sent: unknown[] = [];
    // The production configuration (DSN included), the SDK's own default integrations, a recording transport.
    Sentry.init({
      ...datatugAppEnvironmentConfig.sentry,
      transport: () => ({
        send: async (envelope) => {
          sent.push(envelope);
          return {};
        },
        flush: async () => true,
      }),
    });
    Sentry.addBreadcrumb({ category: 'ui.click', message: 'a link' });
    window.history.pushState({}, '', '/store/github.com/project/p'); // an in-app navigation, as the router does
    window.history.pushState({}, '', '/demo');
    Sentry.captureException(new Error('boom'));
    Sentry.captureMessage('hello');
    await Sentry.flush(2000);
    await Sentry.close(2000);

    expect(sent.length).toBeGreaterThan(0); // the recorder saw the events: the assertion below is not vacuous
    expect(leaks(sent)).toEqual([]);
    expect(JSON.stringify(sent)).toContain('https://datatug.app/demo'); // the URL it did report is the clean one
  });

  it('PostHog events (page view, a custom event, autocaptured properties) carry neither the question nor the scenario', async () => {
    playHandoff(HANDOFF_URL);
    const events: unknown[] = [];
    posthog.init('phc_test_token', {
      ...datatugAppEnvironmentConfig.posthog?.config,
      api_host: 'http://127.0.0.1:9',
      capture_pageview: false,
      disable_session_recording: true,
      disable_external_dependency_loading: true, // happy-dom cannot load scripts
      opt_out_useragent_filter: true, // the test browser identifies as a bot, and PostHog would drop every event
      before_send: (event) => {
        events.push(event);
        return null; // never leaves the test
      },
    });
    posthog.capture('$pageview');
    posthog.capture('some_event', { page: window.location.pathname });
    expect(events.length).toBeGreaterThan(0);
    expect(leaks(events)).toEqual([]);
    expect(JSON.stringify(events)).toContain('https://datatug.app/demo');
  });

  it('the router, which feeds navigation events and Google Analytics page views, only ever sees /demo', async () => {
    playHandoff(HANDOFF_URL);
    // TestBed swaps in a mock location by default; the router must read the real (happy-dom) one, as in the browser.
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: PlatformLocation, useClass: BrowserPlatformLocation },
      ],
    });
    const router = TestBed.inject(Router);
    const seen: string[] = [];
    router.events.subscribe(
      (e) => e instanceof NavigationEnd && seen.push(e.urlAfterRedirects),
    );
    router.initialNavigation();
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0), {
      timeout: 5000,
    });
    expect(seen).toEqual(['/demo']);
    expect(TestBed.inject(Location).path(true)).toBe('/demo');
    expect(
      leaks([seen, router.url, window.location.href, document.referrer]),
    ).toEqual([]);
  });

  it('keeps the question only where the visitor can see it back: memory and this tab sessionStorage', () => {
    playHandoff(HANDOFF_URL);
    const keys = Array.from({ length: window.sessionStorage.length }, (_, i) =>
      window.sessionStorage.key(i),
    );
    expect(keys).toEqual([DEMO_HANDOFF_KEY]);
    expect(leaks(Object.entries(window.localStorage))).toEqual([]); // e.g. PostHog's own persisted properties
    expect(leaks(document.cookie)).toEqual([]); // PostHog keeps its own cookie
  });
});
