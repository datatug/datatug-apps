import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { datatugAppEnvironmentConfig as devEnvironment } from '../environments/environment';
import { datatugAppEnvironmentConfig as prodEnvironment } from '../environments/environment.prod';
import { datatugAppEnvironmentConfig as ssoEnvironment } from '../environments/environment.sso-e2e';

/**
 * What this guards, and what it cannot do.
 *
 * The browser keeps a Navigation Timing entry for the page load, and its `name` is the URL the page was loaded
 * with, query string and all: `/demo?q=<the visitor's question>`. `history.replaceState` (what
 * demo-handoff-capture.ts and index.html do) changes the address bar and `location`, not that entry, and nothing
 * can clear it. So the question stays reachable for any code that reads `performance.getEntriesByType(
 * 'navigation')`.
 *
 * Today nothing in this app does: Sentry is initialised without browser tracing, and PostHog without session
 * replay (the two tools that would read or report the entry). This spec fails the day either is switched on in
 * the app's own init code, until a scrubber that removes the hand-off query from that entry's name is added and
 * named in the same file (SCRUBBER below), so that turning tracing or replay on cannot quietly start sending the
 * question.
 */

/** The identifier a file must use when it turns on tracing or replay: the function that scrubs the hand-off query. */
const SCRUBBER = 'scrubHandoffQuery';

/** Matches `<name>: <a number above zero>`. */
function aboveZero(name: string): { test(source: string): boolean } {
  const pattern = new RegExp(`\\b${name}\\s*:\\s*([0-9.]+)`, 'g');
  return {
    test: (source) =>
      [...source.matchAll(pattern)].some((match) => Number(match[1]) > 0),
  };
}

const ENABLES_TRACING_OR_REPLAY: readonly [
  { test(source: string): boolean },
  string,
][] = [
  [
    /browserTracingIntegration/,
    'Sentry browser tracing (browserTracingIntegration)',
  ],
  [
    /\breplayIntegration\b|replayCanvasIntegration/,
    'Sentry session replay (replayIntegration)',
  ],
  [aboveZero('tracesSampleRate'), 'Sentry tracesSampleRate above 0'],
  [/\btracesSampler\b/, 'Sentry tracesSampler'],
  [/\benableTracing\s*:\s*true/, 'Sentry enableTracing'],
  [aboveZero('replaysSessionSampleRate'), 'Sentry replay sample rate above 0'],
  [aboveZero('replaysOnErrorSampleRate'), 'Sentry replay sample rate above 0'],
  [
    /disable_session_recording\s*:\s*false/,
    'PostHog session recording (disable_session_recording: false)',
  ],
  [/\bsession_recording\s*:/, 'PostHog session_recording options'],
  [/startSessionRecording\s*\(/, 'PostHog startSessionRecording()'],
];

/** What `source` turns on that reads or reports the navigation entry, without naming the scrubber. */
export function unscrubbedTelemetry(source: string): string[] {
  if (source.includes(SCRUBBER)) return [];
  return ENABLES_TRACING_OR_REPLAY.filter(([pattern]) =>
    pattern.test(source),
  ).map(([, what]) => what);
}

function appSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return appSources(path);
    return /\.ts$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : [];
  });
}

describe('the navigation-timing entry keeps the question (it cannot be cleared), so nothing may read it', () => {
  describe('the detector', () => {
    it.each([
      [
        'Sentry.init({ integrations: [Sentry.browserTracingIntegration()] })',
        'Sentry browser tracing',
      ],
      ['Sentry.init({ tracesSampleRate: 0.1 })', 'tracesSampleRate above 0'],
      ['Sentry.init({ tracesSampleRate: 1 })', 'tracesSampleRate above 0'],
      ['Sentry.init({ tracesSampler: () => 1 })', 'tracesSampler'],
      [
        'Sentry.init({ integrations: [Sentry.replayIntegration()] })',
        'session replay',
      ],
      ['Sentry.init({ replaysSessionSampleRate: 0.5 })', 'replay sample rate'],
      ['Sentry.init({ replaysOnErrorSampleRate: 1.0 })', 'replay sample rate'],
      [
        'posthog.init(token, { disable_session_recording: false })',
        'PostHog session recording',
      ],
      [
        'posthog.init(token, { session_recording: { maskAllInputs: true } })',
        'PostHog session_recording',
      ],
      ['posthog.startSessionRecording()', 'startSessionRecording'],
    ])('flags %s', (source, what) => {
      expect(unscrubbedTelemetry(source).join(' ')).toContain(
        what.split(' ')[0],
      );
      expect(unscrubbedTelemetry(source).length).toBeGreaterThan(0);
    });

    it('lets the same code through when the file names the scrubber', () => {
      expect(
        unscrubbedTelemetry(
          `import { ${SCRUBBER} } from './x'; Sentry.init({ tracesSampleRate: 1, beforeSendTransaction: ${SCRUBBER} })`,
        ),
      ).toEqual([]);
    });

    it.each([
      'Sentry.init({ dsn: "x" })',
      'Sentry.init({ tracesSampleRate: 0 })',
      'Sentry.init({ replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 0 })',
      'posthog.init(token, { disable_session_recording: true })',
      "posthog.init(token, { api_host: 'x', person_profiles: 'identified_only' })",
    ])('does not flag %s', (source) => {
      expect(unscrubbedTelemetry(source)).toEqual([]);
    });
  });

  describe("the app's own init code", () => {
    const files = appSources(join(__dirname, '..'));

    it('is found: main.ts, register-posthog.ts and the environments are among the files scanned', () => {
      const names = files.map((f) =>
        f.replace(join(__dirname, '..') + '/', ''),
      );
      expect(names).toEqual(
        expect.arrayContaining([
          'main.ts',
          'register-posthog.ts',
          'environments/environment.ts',
          'environments/environment.prod.ts',
          'environments/environment.sso-e2e.ts',
        ]),
      );
    });

    it('enables no browser tracing and no session replay without the scrubber', () => {
      const found = files.flatMap((file) =>
        unscrubbedTelemetry(readFileSync(file, 'utf8')).map(
          (what) => `${file}: ${what}`,
        ),
      );
      expect(found).toEqual([]);
    });

    it.each([
      ['environment.ts', devEnvironment],
      ['environment.prod.ts', prodEnvironment],
      ['environment.sso-e2e.ts', ssoEnvironment],
    ])(
      '%s configures Sentry and PostHog with neither tracing nor replay',
      (_name, environment) => {
        const sentry = (environment.sentry ?? {}) as Record<string, unknown>;
        const posthog = (environment.posthog?.config ?? {}) as Record<
          string,
          unknown
        >;
        expect(Number(sentry['tracesSampleRate'] ?? 0)).toBe(0);
        expect(sentry['tracesSampler']).toBeUndefined();
        expect(sentry['integrations']).toBeUndefined();
        expect(Number(sentry['replaysSessionSampleRate'] ?? 0)).toBe(0);
        expect(Number(sentry['replaysOnErrorSampleRate'] ?? 0)).toBe(0);
        expect(posthog['disable_session_recording']).not.toBe(false);
        expect(posthog['session_recording']).toBeUndefined();
      },
    );
  });
});
