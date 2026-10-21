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

  it('the query result page: events hold no result id, view, row, code or row text', () => {
    const page = '/store/http-127.0.0.1:8989/result/qr-7f3a9c';
    const config = start(`${page}?view=record&row=2`);
    expect(config.autocapture).toBe(false);
    expect(config.disable_session_recording).toBe(true);
    const out = config.before_send({
      event: '$pageview',
      properties: {
        $current_url: `https://datatug.app${page}?view=record&row=2#code=${CODE}`,
        $pathname: page,
        $referrer: `https://datatug.app${page}?view=table`,
        $el_text: ROW,
      },
    }) as { properties: Record<string, unknown> };
    const text = JSON.stringify(out);
    for (const secret of ['qr-7f3a9c', ROW, CODE, 'view=', 'row=', 'code=']) {
      expect(text).not.toContain(secret);
    }
    expect(out.properties['$current_url']).toBe('https://datatug.app/store/http-127.0.0.1:8989/result/:resultId');
    expect(out.properties['$pathname']).toBe('/store/http-127.0.0.1:8989/result/:resultId');
    expect(config.before_send({ event: '$autocapture', properties: {} })).toBeNull();
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

const SEARCH_PRIVACY_PAGES = [
  '/store/private-agent/project/private-project/quick-search',
  '/space/private-space/store/firestore/project/private-project/tags',
  '/project/github.com/private-owner/private-repo/tree/private-ref/private-folder/-/search-schema/private-model',
];
describe('Quick Search project metadata privacy', () => {
  it.each(SEARCH_PRIVACY_PAGES)(
    '%s suppresses capture/replay and removes URLs and result DOM',
    (path) => {
      const query =
        '?q=private-query&name=private-tag&schema=private-schema&table=private-table&column=private-column';
      const config = start(path + query);
      expect(config.autocapture).toBe(false);
      expect(config.disable_session_recording).toBe(true);
      const out = config.before_send({
        event: '$pageview',
        properties: {
          $current_url: 'https://datatug.app' + path + query,
          $pathname: path,
          $referrer: 'https://datatug.app' + path + query,
          $el_text: 'private-result',
          $elements: [{ text: 'private-result' }],
          $elements_chain: 'private-result',
        },
      });
      const serialized = JSON.stringify(out);
      for (const secret of [
        'private-agent',
        'private-project',
        'private-space',
        'private-owner',
        'private-repo',
        'private-ref',
        'private-folder',
        'private-model',
        'private-query',
        'private-tag',
        'private-schema',
        'private-table',
        'private-column',
        'private-result',
      ])
        expect(serialized).not.toContain(secret);
      expect(
        config.before_send({
          event: '$autocapture',
          properties: { $el_text: 'private-result' },
        }),
      ).toBeNull();
      expect(
        config.before_send({
          event: '$snapshot',
          properties: { $snapshot_data: 'private-result' },
        }),
      ).toBeNull();
    },
  );
  it('turns capture and recording off when navigation enters Quick Search', () => {
    start('/');
    applyPosthogRoutePrivacy(SEARCH_PRIVACY_PAGES[0]);
    expect(sdk.stopSessionRecording).toHaveBeenCalledOnce();
    expect(sdk.set_config).toHaveBeenLastCalledWith({
      autocapture: false,
      disable_session_recording: true,
    });
  });
});

describe('queued Quick Search PostHog events after leaving the page',()=>{
  it.each(SEARCH_PRIVACY_PAGES)('retains origin privacy for %s on Home',path=>{
    const config=start(path+'?q=private-query');
    history.replaceState(null,'','/home');applyPosthogRoutePrivacy('/home');
    const properties={$current_url:'https://datatug.app'+path+'?q=private-query&name=private-tag',$el_text:'private-result',$elements:[{text:'private-result'}],$elements_chain:'private-result'};
    const result=config.before_send({event:'manual_event',properties});
    for(const secret of ['private-query','private-tag','private-project','private-owner','private-result'])expect(JSON.stringify(result)).not.toContain(secret);
    expect(config.before_send({event:'$autocapture',properties})).toBeNull();
    expect(config.before_send({event:'$snapshot',properties:{...properties,$snapshot_data:'private-result'}})).toBeNull();
    expect(config.before_send({event:'public_event',properties:{$current_url:'https://datatug.app/home',label:'public-label'}})).toEqual({event:'public_event',properties:{$current_url:'https://datatug.app/home',label:'public-label'}});
  });
});

describe('queued authenticated metadata preview privacy',()=>{
  it('drops queued DOM capture and scrubs private preview scope after navigation to Home',()=>{
    const config=start('/home');
    const properties={$current_url:'https://api.sneat.cloud/v0/datatug/project/quick-search/preview?storage=github.com&project=private-repo%40private-owner%40private-folder&branch=private-ref',$el_text:'private-table',$elements:[{text:'private-column'}],$elements_chain:'private-result'};
    expect(config.before_send({event:'$autocapture',properties})).toBeNull();
    expect(config.before_send({event:'$snapshot',properties:{...properties,$snapshot_data:'private-result'}})).toBeNull();
    const out=config.before_send({event:'manual_event',properties});
    for(const secret of ['private-repo','private-owner','private-folder','private-ref','private-table','private-column','private-result']) expect(JSON.stringify(out)).not.toContain(secret);
  });
});
