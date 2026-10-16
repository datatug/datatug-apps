const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  stopSessionRecording: vi.fn(),
  set_config: vi.fn(),
}));
vi.mock('posthog-js', () => ({ default: sdk }));
import { applyPosthogRoutePrivacy, registerPosthog } from './register-posthog';
import { withPosthogLinkPrivacy } from './app/telemetry/link-telemetry-privacy';

const BASE = '/store/http-127.0.0.1:8989/project/demo/env/local/db/chinook';
const LINK_PAGES = [
  `${BASE}/table/Album`,
  `${BASE}/view/AlbumView`,
  `${BASE}/table/Album/records`,
  `${BASE}/table/PlaylistTrack/record`,
];
const KEY = '9007199254740993';
const ROW = 'For Those About To Rock';
const CODE = 'v1.1792095344.nonce.signature';
const previous = location.pathname + location.search + location.hash;

type Config = {
  before_send: (e: unknown) => unknown;
  autocapture?: boolean;
  disable_session_recording?: boolean;
};

function start(path: string): Config {
  history.replaceState(null, '', path);
  sdk.init.mockClear();
  registerPosthog(
    withPosthogLinkPrivacy({ token: 'public-fixture', config: {} }),
  );
  return sdk.init.mock.calls[0][1] as Config;
}

beforeEach(() => {
  for (const fn of Object.values(sdk)) fn.mockClear();
});
afterAll(() => history.replaceState(null, '', previous));

describe('PostHog on the pages a card link opens', () => {
  it.each(LINK_PAGES)('%s: events hold no fragment, key, query or element text', (path) => {
    const config = start(`${path}?schema=#pk=${KEY}`);
    expect(config.autocapture).toBe(false);
    expect(config.disable_session_recording).toBe(true);
    const event = {
      event: 'manual_event',
      properties: {
        $current_url: `https://datatug.app${path}?schema=#code=${CODE}&pk=${KEY}`,
        $pathname: path,
        $el_text: ROW,
        $elements_chain: `span:text="${ROW}"`,
        screen_name: `${path}?schema=#pk=${KEY}`,
      },
    };
    const out = config.before_send(event) as typeof event;
    const text = JSON.stringify(out);
    for (const secret of [KEY, ROW, CODE, 'pk=', 'code=', 'schema=']) {
      expect(text).not.toContain(secret);
    }
    expect(out.properties.$current_url).toBe(`https://datatug.app${path}`);
    expect(
      config.before_send({ event: '$autocapture', properties: { $el_text: ROW } }),
    ).toBeNull();
    expect(config.before_send({ event: '$snapshot', properties: { $snapshot_data: ROW } })).toBeNull();
  });

  it('turns autocapture and recording off on a link page and back on after, unlike the one-way checkout switch', () => {
    start('/store/http-127.0.0.1:8989/project/demo');
    applyPosthogRoutePrivacy(LINK_PAGES[2]);
    expect(sdk.stopSessionRecording).toHaveBeenCalledOnce();
    expect(sdk.set_config).toHaveBeenLastCalledWith({
      autocapture: false,
      disable_session_recording: true,
    });
    applyPosthogRoutePrivacy(LINK_PAGES[3]);
    expect(sdk.set_config).toHaveBeenCalledOnce();
    applyPosthogRoutePrivacy('/store/http-127.0.0.1:8989/project/demo');
    expect(sdk.set_config).toHaveBeenLastCalledWith({ autocapture: true });
  });

  it('keeps a fragment out of events on any page', () => {
    const config = start('/');
    const out = config.before_send({
      event: 'x',
      properties: { $current_url: 'https://datatug.app/#code=abc' },
    }) as { properties: Record<string, unknown> };
    expect(out.properties['$current_url']).toBe('https://datatug.app/');
  });

});
