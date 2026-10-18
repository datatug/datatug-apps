import type { TestInfo } from '@playwright/test';
import { assertNoCredentialCapture } from '../../e2e/fixtures/business-preview-buyer';

/** The slice of Playwright's TestInfo that assertNoCredentialCapture reads. */
function testInfo(
  overrides: {
    trace?: string;
    video?: string;
    screenshot?: string;
    reporters?: string[];
  } = {},
): TestInfo {
  return {
    project: {
      use: {
        trace: overrides.trace ?? 'off',
        video: overrides.video ?? 'off',
        screenshot: overrides.screenshot ?? 'off',
      },
    },
    config: {
      reporter: (overrides.reporters ?? ['list']).map((name) => [name, {}]),
    },
  } as unknown as TestInfo;
}

describe('assertNoCredentialCapture (the TEST buyer sign-in guard)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows a console reporter, no trace/video/screenshot and no DEBUG', () => {
    vi.stubEnv('DEBUG', '');
    for (const reporter of ['list', 'line', 'dot']) {
      expect(() =>
        assertNoCredentialCapture(testInfo({ reporters: [reporter] })),
      ).not.toThrow();
    }
  });

  it('allows a run where DEBUG is not set at all', () => {
    vi.stubEnv('DEBUG', undefined);
    expect(() => assertNoCredentialCapture(testInfo())).not.toThrow();
  });

  it.each(['*', '1', 'pw:api', 'playwright:*', 'express:*', 'a'])(
    'refuses DEBUG=%s: any non-empty value can make Playwright log the filled password',
    (value) => {
      vi.stubEnv('DEBUG', value);
      expect(() => assertNoCredentialCapture(testInfo())).toThrow(
        /no DEBUG variable at all/,
      );
    },
  );

  it.each([
    ['trace', { trace: 'on' }],
    ['video', { video: 'on' }],
    ['screenshot', { screenshot: 'on' }],
    ['an html reporter', { reporters: ['html'] }],
    ['a list reporter beside an html one', { reporters: ['list', 'html'] }],
  ])('refuses %s', (_name, overrides) => {
    vi.stubEnv('DEBUG', '');
    expect(() => assertNoCredentialCapture(testInfo(overrides))).toThrow(
      /requires trace, video and screenshot off/,
    );
  });
});
