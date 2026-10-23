import {
  anonymousUsagePosthog,
  scrubUsagePath,
  scrubUsagePosthogEvent,
  scrubUsageValue,
} from './usage-privacy';

describe('usage privacy', () => {
  it('keeps page kinds only: owner, repository and every id become placeholders, query and fragment go', () => {
    expect(
      scrubUsagePath(
        '/project/github.com/acme/secret/tree/main/dir/-/query/q1?customer=ALFKI#evidence=x',
      ),
    ).toBe('/project/github.com/:owner/:repo/tree/:id/:id/-/query/:id');
    expect(
      scrubUsagePath(
        '/store/firestore/project/p1/env/prod/db/main/table/Orders',
      ),
    ).toBe('/store/:id/project/:id/env/:id/db/:id/table/:id');
    expect(scrubUsagePath('/demo/logs?order=11045&attempt=2')).toBe(
      '/demo/logs',
    );
    expect(scrubUsagePath('/')).toBe('/');
  });

  it('scrubs absolute addresses and leaves other text alone', () => {
    expect(
      scrubUsageValue('https://datatug.app/project/github.com/a/b?x=1#y'),
    ).toBe('https://datatug.app/project/github.com/:owner/:repo');
    expect(scrubUsageValue('https://www.google.com')).toBe(
      'https://www.google.com/',
    );
    expect(scrubUsageValue('$direct')).toBe('$direct');
    expect(scrubUsageValue('rows')).toBe('rows');
  });

  it('drops every event off the closed list, and every property off the allowlist', () => {
    for (const event of [
      '$identify',
      '$create_alias',
      '$groupidentify',
      '$set',
      '$autocapture',
      '$snapshot',
      '$pageleave',
      'free_text_event',
    ])
      expect(scrubUsagePosthogEvent({ event, properties: {} })).toBeNull();
    expect(scrubUsagePosthogEvent(null)).toBeNull();
    const at = new Date(0);
    const event = scrubUsagePosthogEvent({
      uuid: 'u-1',
      event: '$pageview',
      timestamp: at,
      $set: { email: 'a@b.c' },
      $set_once: { $initial_current_url: 'https://datatug.app/x?y' },
      properties: {
        title: 'acme/secret',
        $title: 'acme/secret',
        $el_text: 'secret',
        $set: { email: 'a@b.c' },
        utm_source: 'newsletter',
        gclid: 'click-1',
        fbclid: 'click-2',
        $referrer: 'https://news.example/?id=7',
        $raw_user_agent: 'UA',
        $initial_current_url: 'https://datatug.app/?gclid=click-1',
        $session_entry_url: 'https://datatug.app/?utm_source=x',
        page_path: '/project/github.com/acme/secret/-/query?x=1',
        $current_url: 'https://datatug.app/demo/logs?order=11045',
        kind: [{ url: 'https://datatug.app/demo/logs?order=11045' }],
        project: {
          a: { b: { c: { d: { e: { f: { g: { h: { i: { j: 'x' } } } } } } } } },
        },
        $screen_width: 1024,
      },
    });
    expect(event).toEqual({
      uuid: 'u-1',
      event: '$pageview',
      timestamp: at,
      properties: {
        page_path: '/project/github.com/:owner/:repo/-/query',
        $current_url: 'https://datatug.app/demo/logs',
        kind: [{ url: 'https://datatug.app/demo/logs' }],
        project: {
          a: { b: { c: { d: { e: { f: { g: { h: undefined } } } } } } },
        },
        $screen_width: 1024,
      },
    });
    expect(scrubUsagePosthogEvent({ event: 'source_reset' } as never)).toEqual({
      event: 'source_reset',
    });
  });

  it('builds anonymous settings with the scrubber last, and nothing without a key', () => {
    expect(anonymousUsagePosthog(undefined)).toBeUndefined();
    expect(anonymousUsagePosthog({ token: '' })).toBeUndefined();
    const settings = anonymousUsagePosthog({
      token: 'phc_x',
      config: {
        api_host: 'https://eu.i.posthog.com',
        person_profiles: 'identified_only',
        autocapture: true,
      },
    });
    expect(settings?.config).toMatchObject({
      api_host: 'https://eu.i.posthog.com',
      person_profiles: 'never',
      autocapture: false,
      disable_session_recording: true,
      capture_pageview: false,
      capture_pageleave: false,
      save_campaign_params: false,
      save_referrer: false,
      mask_personal_data_properties: true,
    });
    const send = settings?.config?.before_send as (e: unknown) => unknown;
    expect(send({ event: '$identify', properties: {} })).toBeNull();
    expect(
      send({
        event: 'source_reset',
        properties: { $current_url: 'https://datatug.app/a?b' },
      }),
    ).toEqual({
      event: 'source_reset',
      properties: { $current_url: 'https://datatug.app/:id' },
    });
  });

  it('runs an earlier before_send first, a function or a list, and stops at its null', () => {
    const seen: string[] = [];
    const one = anonymousUsagePosthog({
      token: 'phc_x',
      config: {
        before_send: (event) => {
          seen.push('fn');
          return event;
        },
      },
    });
    const list = anonymousUsagePosthog({
      token: 'phc_x',
      config: {
        before_send: [
          () => {
            seen.push('a');
            return null;
          },
          (event) => {
            seen.push('b');
            return event;
          },
        ],
      },
    });
    const event = { event: 'source_reset', properties: {} } as never;
    expect(
      (one?.config?.before_send as (e: unknown) => unknown)(event),
    ).toEqual(event);
    expect(
      (list?.config?.before_send as (e: unknown) => unknown)(event),
    ).toBeNull();
    expect(seen).toEqual(['fn', 'a']);
  });
});
