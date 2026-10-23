import {
  ApplicationInitStatus,
  provideZonelessChangeDetection,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { USAGE_EVENT_SINK } from '@datatug/product-profiles';
import { AnalyticsService } from '@sneat/core';
import { Subject } from 'rxjs';
import type { AnalyticsConsent } from './analytics-consent';
import { ANALYTICS_CONSENT } from './analytics-consent.token';
import { actPageOf, provideUsageEvents } from './usage-events.provider';

const DEMO =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-';

describe('actPageOf', () => {
  it('names the act page kind and whether it is the public demo, nothing else', () => {
    expect(actPageOf(DEMO + '/board/showcase?x=1')).toEqual({
      page: 'board',
      project: 'demo',
    });
    expect(actPageOf('/demo/logs?order=11045')).toEqual({
      page: 'logs',
      project: 'demo',
    });
    expect(actPageOf('/store/firestore/project/p1/query?result=r1')).toEqual({
      page: 'query',
      project: 'other',
    });
    expect(
      actPageOf('/project/github.com/acme/secret/tree/HEAD/x/-/checks'),
    ).toEqual({
      page: 'checks',
      project: 'other',
    });
    expect(actPageOf('/demo')).toBeUndefined();
    expect(actPageOf('/pricing')).toBeUndefined();
    expect(
      actPageOf('/project/github.com/acme/secret/tree/HEAD/x/-/settings'),
    ).toBeUndefined();
  });
});

describe('provideUsageEvents', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function setup(initiallyGranted: boolean) {
    let granted = initiallyGranted;
    const listeners = new Set<() => void>();
    const consent = {
      granted: () => granted,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    } as unknown as AnalyticsConsent;
    const events = new Subject<unknown>();
    const logEvent = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ANALYTICS_CONSENT, useValue: consent },
        { provide: AnalyticsService, useValue: { logEvent } },
        { provide: Router, useValue: { events } },
        provideUsageEvents(),
      ],
    });
    await TestBed.inject(ApplicationInitStatus).donePromise;
    return {
      logEvent,
      navigate: (url: string) => events.next(new NavigationEnd(1, url, url)),
      grant(value: boolean) {
        granted = value;
        for (const listener of [...listeners]) listener();
      },
    };
  }

  it('records act page views once per page kind, and nothing for other pages', async () => {
    const { logEvent, navigate } = await setup(true);
    navigate(DEMO + '/board/showcase');
    navigate(DEMO + '/board/other');
    navigate('/pricing');
    navigate(DEMO + '/board/showcase');
    navigate('/project/github.com/acme/secret/tree/HEAD/x/-/query');
    expect(logEvent.mock.calls).toEqual([
      ['act_page_viewed', { page: 'board', project: 'demo' }],
      ['act_page_viewed', { page: 'board', project: 'demo' }],
      ['act_page_viewed', { page: 'query', project: 'other' }],
    ]);
  });

  it('records a consent given when the visitor accepts, not for a stored grant', async () => {
    const stored = await setup(true);
    stored.grant(true);
    expect(stored.logEvent).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    const fresh = await setup(false);
    fresh.grant(true);
    fresh.grant(true);
    fresh.grant(false);
    expect(fresh.logEvent.mock.calls).toEqual([
      ['analytics_consent_given', {}],
    ]);
  });

  it('provides the usage sink over the shared AnalyticsService', async () => {
    const { logEvent } = await setup(true);
    TestBed.inject(USAGE_EVENT_SINK).send('source_reset', {});
    expect(logEvent).toHaveBeenCalledWith('source_reset', {});
  });
});
