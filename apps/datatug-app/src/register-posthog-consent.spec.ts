const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  stopSessionRecording: vi.fn(),
  set_config: vi.fn(),
  opt_out_capturing: vi.fn(),
  opt_in_capturing: vi.fn(),
  has_opted_out_capturing: vi.fn(() => false),
}));
vi.mock('posthog-js', () => ({ default: sdk }));
import {
  pausePosthogForConsent,
  posthogStarted,
  registerPosthog,
  resumePosthogForConsent,
} from './register-posthog';

it('follows a consent withdrawal and a new grant only once PostHog was started', () => {
  pausePosthogForConsent();
  resumePosthogForConsent();
  expect(posthogStarted()).toBe(false);
  expect(sdk.opt_out_capturing).not.toHaveBeenCalled();
  expect(sdk.has_opted_out_capturing).not.toHaveBeenCalled();

  registerPosthog({ token: 'public-fixture', config: {} });
  expect(posthogStarted()).toBe(true);
  // A fresh grant with no persisted opt-out leaves PostHog as it is.
  resumePosthogForConsent();
  expect(sdk.opt_in_capturing).not.toHaveBeenCalled();

  pausePosthogForConsent();
  expect(sdk.opt_out_capturing).toHaveBeenCalledOnce();
  expect(sdk.stopSessionRecording).toHaveBeenCalledOnce();

  sdk.has_opted_out_capturing.mockReturnValue(true);
  resumePosthogForConsent();
  expect(sdk.opt_in_capturing).toHaveBeenCalledOnce();
});
