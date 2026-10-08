import {
  CHECKOUT_GA_IDS,
  CHECKOUT_PRIVACY_FLAG,
  disableCheckoutAnalytics,
} from './app/checkout/checkout-privacy-state';
const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  stopSessionRecording: vi.fn(),
  set_config: vi.fn(),
}));
vi.mock('posthog-js', () => ({ default: sdk }));
import { registerPosthog, stopPosthogForCheckout } from './register-posthog';

const target = window as unknown as Record<string, unknown>;
beforeEach(() => {
  delete target[CHECKOUT_PRIVACY_FLAG];
  sdk.init.mockClear();
  sdk.stopSessionRecording.mockClear();
  sdk.set_config.mockClear();
});
afterEach(() => {
  delete target[CHECKOUT_PRIVACY_FLAG];
  for (const id of CHECKOUT_GA_IDS) delete target['ga-disable-' + id];
});

it('does not initialize PostHog on a cold checkout, including before Angular starts', () => {
  disableCheckoutAnalytics(
    '/pricing/return?mode=test&session_id=cs_test_paid',
    target,
  );
  registerPosthog({ token: 'public-fixture', config: {} });
  expect(sdk.init).not.toHaveBeenCalled();
});
it('drops manual and autocapture events and stops recordings for this document after checkout navigation', () => {
  registerPosthog({ token: 'public-fixture', config: {} });
  const config = sdk.init.mock.calls[0][1];
  const event = {
    event: '$pageview',
    properties: { $current_url: 'https://datatug.app/' },
  };
  expect(config.before_send(event)).toBe(event);
  disableCheckoutAnalytics(
    '/subscribe?plan=pro&period=monthly&checkout=test',
    target,
  );
  stopPosthogForCheckout();
  expect(sdk.stopSessionRecording).toHaveBeenCalledOnce();
  expect(sdk.set_config).toHaveBeenCalledWith({
    autocapture: false,
    disable_session_recording: true,
    capture_pageview: false,
  });
  for (const name of ['$pageview', '$autocapture', 'manual_event', '$snapshot'])
    expect(config.before_send({ ...event, event: name })).toBeNull();
  disableCheckoutAnalytics('/', target);
  expect(config.before_send(event)).toBeNull();
});
